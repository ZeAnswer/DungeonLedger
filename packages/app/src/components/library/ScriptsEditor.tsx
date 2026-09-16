import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { callSource, type Ability, type EvalContext, type Script, type ScriptError, activationsOf } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, inputCls } from '../ui';
import { ScriptPreview } from './ScriptPreview';
import { FunctionCallForm } from './FunctionCallForm';

// CodeMirror (and its ~150 kB gzip of packages) is only ever needed once a record's Scripts section is
// open, so it's split into its own chunk (see vite.config.ts's manualChunks) and loaded on demand instead
// of shipping in the main entry for screens that never touch a script editor.
const ScriptEditor = lazy(() => import('./ScriptEditor').then((m) => ({ default: m.ScriptEditor })));
const EDITOR_FALLBACK = <div className="flex h-16 items-center justify-center rounded-xl border border-zinc-700 text-sm text-zinc-500">loading editor…</div>;

/** The one event a script runs on, as the row's dropdown shows it. `always` is the compute phase and
 * cannot be combined with the others; `custom` reveals a name box and stores `custom:<name>`. */
export const EVENT_OPTIONS = [
  { value: 'always', label: 'Always' },
  { value: 'hit', label: 'When I hit' },
  { value: 'miss', label: 'When I miss' },
  { value: 'crit', label: 'When I crit' },
  { value: 'damaged', label: "When I'm hit" },
  { value: 'roundStart', label: 'Round start' },
  { value: 'roundEnd', label: 'Round end' },
  { value: 'use', label: 'When used' },
  { value: 'equip', label: 'When equipped' },
  { value: 'unequip', label: 'When unequipped' },
  { value: 'custom', label: 'Custom…' },
] as const;

/** `base` if free, else `base-2`, `base-3`, … Ids must not collide: activation ids double as pool ids. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

export function newScript(taken: string[]): Script {
  return { id: uniqueId('s1', taken), events: ['always'], source: '', enabled: true, priority: 0 };
}

/** The dropdown's own value for a script's `events`: `custom` when the first event is `custom:<name>`, else the first event (default `always`). */
const dropdownValue = (events: string[]): string => {
  const first = events[0] ?? 'always';
  return first.startsWith('custom:') ? 'custom' : first;
};

export function ScriptsEditor({ value, onChange, addLabel = '+ add script', errors = [], ability }: { value: Script[]; onChange: (s: Script[]) => void; addLabel?: string; errors?: ScriptError[]; ability?: Ability }) {
  const functions = useStore((s) => s.library.functions);
  // Ids stay unique across the whole record (its own scripts and every activation's), so an error line names one script only.
  const takenIds = ability ? [...ability.scripts, ...activationsOf(ability).flatMap((x) => x.scripts), ...value].map((s) => s.id) : value.map((s) => s.id);
  const set = (i: number, patch: Partial<Script>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // Switching back to code must not lose the call: synthesize its `fn.<id>({...})` text into `source`.
  const dropCall = (i: number) => {
    const s = value[i]!;
    const synthesized = s.call ? callSource({ library: { functions } } as EvalContext, s.call) : undefined;
    set(i, { call: undefined, source: synthesized ?? s.source });
  };
  // Switching to "call a function" must not leave the old `source` sitting around dead (the engine
  // prefers `call` over `source`, so it would silently never run again) — clear it. Seed `fn` with the
  // first available function, since an empty selection fails validation with a raw zod dump on Save.
  const toCall = (i: number) => {
    const s = value[i]!;
    if (s.call) return;
    const firstFn = Object.values(functions).sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? '';
    set(i, { call: { fn: firstFn, args: {} }, source: '' });
  };
  return (
    <div className="space-y-3">
      {value.map((s, i) => (
        <ScriptRow
          key={i}
          script={s}
          set={(patch) => set(i, patch)}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
          onDropCall={() => dropCall(i)}
          onToCall={() => toCall(i)}
          errors={errors.filter((e) => e.scriptId === s.id)}
          ability={ability}
        />
      ))}
      <Button onClick={() => onChange([...value, newScript(takenIds)])}>{addLabel}</Button>
    </div>
  );
}

/** One script row: `[ event ▾ ]  ⋯  ✕`, then the code (or call form) and "Right now". Label, id, enabled,
 * priority and the code/call switch fold behind `⋯`, closed by default for every row (including a new one). */
function ScriptRow({ script: s, set, onRemove, onDropCall, onToCall, errors, ability }: {
  script: Script; set: (patch: Partial<Script>) => void; onRemove: () => void; onDropCall: () => void; onToCall: () => void; errors: ScriptError[]; ability?: Ability;
}) {
  const [open, setOpen] = useState(false);
  const dropdown = dropdownValue(s.events);
  const legacyExtra = s.events.length - 1;
  const onEventChange = (v: string) => {
    if (v === 'custom') {
      const existing = s.events.find((e) => e.startsWith('custom:'));
      set({ events: [existing ?? 'custom:'] });
    } else {
      set({ events: [v] });
    }
  };
  const setCustomName = (name: string) => set({ events: [`custom:${name.replace(/[^A-Za-z0-9_-]/g, '')}`] });
  return (
    <div data-role="script" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
      <div className="mb-2 flex items-center gap-2">
        <select data-role="script-event" className={inputCls + ' flex-1 py-1.5'} value={dropdown} onChange={(e) => onEventChange(e.target.value)}>
          {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {legacyExtra > 0 && <span className="shrink-0 text-xs text-zinc-500">+{legacyExtra} more</span>}
        <button type="button" data-role="script-more" className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-zinc-400" onClick={() => setOpen((v) => !v)}>⋯</button>
        <button type="button" className="shrink-0 px-2 text-zinc-500" onClick={onRemove}>✕</button>
      </div>
      {dropdown === 'custom' && (
        <input className={inputCls + ' mb-2 py-1.5'} placeholder="event name" value={s.events[0]?.startsWith('custom:') ? s.events[0].slice(7) : ''} onChange={(e) => setCustomName(e.target.value)} />
      )}
      {open && (
        <div className="mb-2 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-2">
          <input className={inputCls + ' py-1.5'} placeholder="label (names the bonus in the breakdown)" value={s.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} />
          <div className="text-xs text-zinc-500">id: <span className="font-mono text-zinc-400">{s.id}</span></div>
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <label className="flex items-center gap-1"><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> enabled</label>
            <label className="flex items-center gap-1">priority <PriorityInput value={s.priority} onCommit={(n) => set({ priority: n })} /></label>
          </div>
          <div className="flex gap-1">
            <Chip active={!s.call} onClick={onDropCall}>code</Chip>
            <Chip active={!!s.call} onClick={onToCall}>call a function</Chip>
          </div>
        </div>
      )}
      {s.call
        ? <FunctionCallForm value={s.call} onChange={(call) => set({ call })} />
        : <Suspense fallback={EDITOR_FALLBACK}><ScriptEditor value={s.source} onChange={(source) => set({ source })} errors={errors} /></Suspense>}
      <button type="button" className="mt-1 text-xs text-zinc-500 underline" onClick={s.call ? onDropCall : onToCall}>{s.call ? 'write code instead' : 'use a function instead'}</button>
      {errors.map((e) => <div key={e.message} className="mt-1 rounded-lg border border-red-900 bg-red-950/40 px-2 py-1 text-xs text-red-200">{e.phase === 'compile' ? 'Does not compile' : 'Failed'}{e.line !== undefined ? ` (line ${e.line})` : ''}: {e.message}</div>)}
      {ability && <ScriptPreview ability={ability} script={s} />}
    </div>
  );
}

/** A signed integer, edited freely (a leading `-` used to be eaten by a per-keystroke `Number(...) || 0`,
 * making "run before everything else" only reachable through the JSON tab); commits on blur/Enter. */
function PriorityInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && !Number.isNaN(n)) onCommit(Math.trunc(n));
    else setText(String(value));
  };
  return (
    <input
      data-role="script-priority"
      className={inputCls + ' w-16 py-1'}
      inputMode="numeric"
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}
