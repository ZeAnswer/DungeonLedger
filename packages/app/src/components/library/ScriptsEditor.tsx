import { useState } from 'react';
import { callSource, type Ability, type EvalContext, type Script, type ScriptError } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, inputCls } from '../ui';
import { ScriptEditor } from './ScriptEditor';
import { ScriptPreview } from './ScriptPreview';
import { FunctionCallForm } from './FunctionCallForm';

/** Events a script may listen to. `always` is the compute phase and cannot be combined with the others. */
export const EVENTS = ['always', 'hit', 'miss', 'crit', 'damaged', 'roundStart', 'roundEnd', 'use', 'equip', 'unequip'] as const;

/** `base` if free, else `base-2`, `base-3`, … Ids must not collide: activation ids double as pool ids. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

export function newScript(taken: string[]): Script {
  return { id: uniqueId('s1', taken), events: ['always'], source: '', enabled: true, priority: 0 };
}

export function ScriptsEditor({ value, onChange, addLabel = '+ add script', errors = [], ability }: { value: Script[]; onChange: (s: Script[]) => void; addLabel?: string; errors?: ScriptError[]; ability?: Ability }) {
  const functions = useStore((s) => s.library.functions);
  const set = (i: number, patch: Partial<Script>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggleEvent = (i: number, ev: string) => {
    const s = value[i]!;
    const next = ev === 'always'
      ? ['always']
      : s.events.includes(ev) ? s.events.filter((x) => x !== ev) : [...s.events.filter((x) => x !== 'always'), ev];
    set(i, { events: next.length ? next : ['always'] });
  };
  // Switching back to code must not lose the call: synthesize its `fn.<id>({...})` text into `source`.
  const dropCall = (i: number) => {
    const s = value[i]!;
    const synthesized = s.call ? callSource({ library: { functions } } as EvalContext, s.call) : undefined;
    set(i, { call: undefined, source: synthesized ?? s.source });
  };
  return (
    <div className="space-y-3">
      {value.map((s, i) => (
        <div key={i} data-role="script" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
          <div className="mb-2 flex items-center gap-2">
            <input className={inputCls + ' flex-1 py-1.5'} placeholder="label (names the bonus in the breakdown)" value={s.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} />
            <input className={inputCls + ' w-24 py-1.5'} placeholder="id" value={s.id} onChange={(e) => set(i, { id: e.target.value.trim() })} />
            <button type="button" className="px-2 text-zinc-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1" data-role="script-events">
            {EVENTS.map((ev) => <Chip key={ev} tone={ev === 'always' ? 'amber' : 'blue'} active={s.events.includes(ev)} onClick={() => toggleEvent(i, ev)}>{ev}</Chip>)}
            {s.events.filter((e) => e.startsWith('custom:')).map((ev) => <Chip key={ev} tone="green" active onClick={() => toggleEvent(i, ev)}>{ev}</Chip>)}
            <CustomEvent onAdd={(name) => set(i, { events: [...s.events.filter((x) => x !== 'always'), `custom:${name}`] })} />
          </div>
          <div className="mb-1 flex gap-1">
            <Chip active={!s.call} onClick={() => dropCall(i)}>code</Chip>
            <Chip active={!!s.call} onClick={() => set(i, { call: s.call ?? { fn: '', args: {} } })}>call a function</Chip>
          </div>
          {s.call
            ? <FunctionCallForm value={s.call} onChange={(call) => set(i, { call })} />
            : <ScriptEditor value={s.source} onChange={(source) => set(i, { source })} errors={errors.filter((e) => e.scriptId === s.id)} />}
          {errors.filter((e) => e.scriptId === s.id).map((e) => <div key={e.message} className="mt-1 rounded-lg border border-red-900 bg-red-950/40 px-2 py-1 text-xs text-red-200">{e.phase === 'compile' ? 'Does not compile' : 'Failed'}{e.line !== undefined ? ` (line ${e.line})` : ''}: {e.message}</div>)}
          {ability && <ScriptPreview ability={ability} script={s} />}
          <div className="mt-1 flex items-center gap-4 text-xs text-zinc-400">
            <label className="flex items-center gap-1"><input type="checkbox" checked={s.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /> enabled</label>
            <label className="flex items-center gap-1">priority <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={s.priority} onChange={(e) => set(i, { priority: Number(e.target.value) || 0 })} /></label>
          </div>
        </div>
      ))}
      <Button onClick={() => onChange([...value, newScript(value.map((s) => s.id))])}>{addLabel}</Button>
    </div>
  );
}

function CustomEvent({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <Chip tone="green" onClick={() => setOpen(true)}>+ custom…</Chip>;
  return (
    <span className="flex items-center gap-1">
      <input autoFocus className={inputCls + ' w-32 py-1'} placeholder="event name" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
      <Chip tone="green" onClick={() => { if (name) onAdd(name); setName(''); setOpen(false); }}>add</Chip>
    </span>
  );
}
