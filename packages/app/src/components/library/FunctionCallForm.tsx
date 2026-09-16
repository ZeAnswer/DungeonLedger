import { BonusTypeSchema, PATHS, type ArgValue, type Script } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, cx, inputCls } from '../ui';
import { StatSelect } from './StatSelect';
import { DurationPicker } from './DurationPicker';

type Call = NonNullable<Script['call']>;
const EVENTS = ['always', 'hit', 'miss', 'crit', 'damaged', 'roundStart', 'roundEnd', 'use', 'equip', 'unequip'];

const litOf = (a: ArgValue | undefined, fallback: number | string | boolean | string[]) => (a?.k === 'lit' ? a.v : fallback);

/**
 * A stored `script.call`: the function's typed parameters as form controls, each with an ƒx switch that
 * turns the box into a raw expression (`{ k: 'expr' }`). `path`-typed parameters store `{ k: 'ref' }`.
 */
export function FunctionCallForm({ value, onChange }: { value: Call; onChange: (c: Call) => void }) {
  const functions = useStore((s) => s.library.functions);
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const def = functions[value.fn];
  const setArg = (name: string, a: ArgValue | undefined) => {
    const args = { ...value.args };
    if (a === undefined) delete args[name]; else args[name] = a;
    onChange({ ...value, args });
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
      <select data-role="call-fn" className={inputCls} value={value.fn} onChange={(e) => onChange({ fn: e.target.value, args: {} })}>
        <option value="">— pick a function —</option>
        {Object.values(functions).sort((a, b) => a.name.localeCompare(b.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {def?.description && <p className="mt-1 text-xs text-zinc-500">{def.description}</p>}
      {def?.params.map((p) => {
        const arg = value.args[p.name];
        const raw = arg?.k === 'expr' || arg?.k === 'ref';
        const kind = p.type === 'path' || p.type === 'ref' ? 'ref' as const : 'expr' as const;
        return (
          <div key={p.name} data-role={`arg-${p.name}`} className="mt-2">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
              <span>{p.label ?? p.name}{p.required ? ' *' : ''}</span>
              <span className="text-zinc-600">{p.type}</span>
              <button type="button" onClick={() => setArg(p.name, raw ? { k: 'lit', v: (p.default ?? (p.type === 'number' ? 0 : '')) } : { k: kind, v: String(litOf(arg, '')) })} className={cx('ml-auto rounded-full border px-2 py-0.5', raw ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-400')}>ƒx</button>
            </div>
            {raw ? (
              <input className={inputCls + ' font-mono text-sm'} list="hl-paths" placeholder="player.mod.str" value={String(arg.v)} onChange={(e) => setArg(p.name, { k: kind, v: e.target.value })} />
            ) : p.type === 'number' ? (
              <input className={inputCls} inputMode="numeric" value={String(litOf(arg, p.default ?? 0))} onChange={(e) => setArg(p.name, { k: 'lit', v: Number(e.target.value) || 0 })} />
            ) : p.type === 'bool' ? (
              <Chip tone="green" active={!!litOf(arg, p.default ?? false)} onClick={() => setArg(p.name, { k: 'lit', v: !litOf(arg, false) })}>{litOf(arg, false) ? 'true' : 'false'}</Chip>
            ) : p.type === 'stat' ? (
              <StatSelect value={String(litOf(arg, p.default ?? 'attack'))} onChange={(v) => setArg(p.name, { k: 'lit', v })} />
            ) : p.type === 'bonusType' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'untyped'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{BonusTypeSchema.options.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            ) : p.type === 'duration' ? (
              <DurationPicker value={typeof litOf(arg, p.default ?? 'encounter') === 'number' ? (litOf(arg, 0) as number) : (litOf(arg, 'encounter') as 'encounter')} onChange={(d) => setArg(p.name, { k: 'lit', v: d })} />
            ) : p.type === 'tag' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}><option value="">— pick tag —</option>{Object.values(tags).sort((a, b) => a.label.localeCompare(b.label)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
            ) : p.type === 'tags' ? (
              <div className="flex flex-wrap gap-1">
                {Object.values(tags).filter((t) => t.category === 'creatureType').map((t) => {
                  const list = (litOf(arg, (p.default as string[] | undefined) ?? []) as string[]);
                  return <Chip key={t.id} tone="amber" active={list.includes(t.id)} onClick={() => setArg(p.name, { k: 'lit', v: list.includes(t.id) ? list.filter((x) => x !== t.id) : [...list, t.id] })}>{t.label}</Chip>;
                })}
              </div>
            ) : p.type === 'recordId' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}><option value="">— pick record —</option>{Object.values(abilities).sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            ) : p.type === 'event' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'always'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}</select>
            ) : (
              <input className={inputCls} placeholder={p.type === 'dice' ? '1d6' : ''} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })} />
            )}
          </div>
        );
      })}
      <datalist id="hl-paths">{PATHS.map((p) => <option key={p.path} value={p.path} />)}</datalist>
    </div>
  );
}
