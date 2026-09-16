import { AbilityKeySchema, BonusTypeSchema, PATHS, type ArgValue, type Script } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, cx, inputCls } from '../ui';
import { FunctionStatSelect } from './StatSelect';
import { DurationPicker } from './DurationPicker';
import { EVENT_OPTIONS } from './events';

type Call = NonNullable<Script['call']>;

const ABILITY_LABELS: Record<string, string> = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };

const litOf = (a: ArgValue | undefined, fallback: number | string | boolean | string[]) => (a?.k === 'lit' ? a.v : fallback);
const refOf = (a: ArgValue | undefined, fallback: string) => (a?.k === 'ref' ? a.v : fallback);

/** The zero-ish value for a param's type, used when neither an arg nor a `default` is set. */
const zeroOf = (type: string): number | string | boolean | string[] =>
  type === 'number' ? 0 : type === 'bool' ? false : type === 'tags' ? [] : type === 'ability' ? 'ability.str' : type === 'attackKind' ? 'any' : '';

/** Does a JSON-parsed expression's shape match what this param's `lit` value should be? */
function litMatches(type: string, v: unknown): v is number | string | boolean | string[] {
  switch (type) {
    case 'number': return typeof v === 'number';
    case 'bool': return typeof v === 'boolean';
    case 'tags': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'duration': return typeof v === 'number' || typeof v === 'string';
    default: return typeof v === 'string';
  }
}

/**
 * A stored `script.call`: the function's typed parameters as form controls, each with an ƒx switch that
 * turns the box into a raw expression (`{ k: 'expr' }`). `path`/`ref`-typed parameters default instead to
 * a bare reference (`{ k: 'ref' }`, e.g. `player.mod.str`) — the ƒx switch is what turns those into `expr`.
 * Toggling ƒx on a typed (`lit`) param seeds the expression box with a JSON-valid literal (quoted strings,
 * arrays, booleans; bare digits for numbers); toggling back tries to parse that text as JSON and keep it if
 * its shape still matches the param's type, else falls back to the param's default.
 */
export function FunctionCallForm({ value, onChange }: { value: Call; onChange: (c: Call) => void }) {
  const functions = useStore((s) => s.library.functions);
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const skills = useStore((s) => s.library.skills);
  const def = functions[value.fn];
  const setArg = (name: string, a: ArgValue | undefined) => {
    const args = { ...value.args };
    if (a === undefined) delete args[name]; else args[name] = a;
    onChange({ ...value, args });
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
      {Object.keys(functions).length === 0 ? (
        <p className="text-sm text-amber-300">No functions defined — add one in Library › Functions first.</p>
      ) : (
        <select data-role="call-fn" className={inputCls} value={value.fn} onChange={(e) => onChange({ fn: e.target.value, args: {} })}>
          <option value="">— pick a function —</option>
          {Object.values(functions).sort((a, b) => a.name.localeCompare(b.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      {def?.description && <p className="mt-1 text-xs text-zinc-500">{def.description}</p>}
      {def?.params.map((p) => {
        const arg = value.args[p.name];
        const isRef = p.type === 'path' || p.type === 'ref';
        const expr = arg?.k === 'expr';
        const toExpr = () => {
          const text = isRef
            ? refOf(arg, '')
            : (() => { const v = litOf(arg, p.default ?? zeroOf(p.type)); return typeof v === 'number' ? String(v) : JSON.stringify(v); })();
          setArg(p.name, { k: 'expr', v: text });
        };
        const toTyped = () => {
          const text = arg?.k === 'expr' ? arg.v : '';
          if (isRef) { setArg(p.name, { k: 'ref', v: text }); return; }
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = undefined; }
          setArg(p.name, { k: 'lit', v: litMatches(p.type, parsed) ? parsed : (p.default ?? zeroOf(p.type)) });
        };
        return (
          <div key={p.name} data-role={`arg-${p.name}`} className="mt-2">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
              <span>{p.label ?? p.name}{p.required ? ' *' : ''}</span>
              <span className="text-zinc-600">{p.type}</span>
              <button type="button" onClick={expr ? toTyped : toExpr} className={cx('ml-auto text-xs underline', expr ? 'text-amber-300' : 'text-zinc-500')}>ƒx</button>
            </div>
            {expr ? (
              <input className={inputCls + ' font-mono text-sm'} list="hl-paths" placeholder="player.mod.str" value={arg.v} onChange={(e) => setArg(p.name, { k: 'expr', v: e.target.value })} />
            ) : isRef ? (
              <input className={inputCls + ' font-mono text-sm'} list="hl-paths" placeholder="player.mod.str" value={refOf(arg, '')} onChange={(e) => setArg(p.name, { k: 'ref', v: e.target.value })} />
            ) : p.type === 'number' ? (
              <input className={inputCls} inputMode="numeric" value={String(litOf(arg, p.default ?? 0))} onChange={(e) => setArg(p.name, { k: 'lit', v: Number(e.target.value) || 0 })} />
            ) : p.type === 'bool' ? (
              <Chip tone="green" active={!!litOf(arg, p.default ?? false)} onClick={() => setArg(p.name, { k: 'lit', v: !litOf(arg, false) })}>{litOf(arg, false) ? 'true' : 'false'}</Chip>
            ) : p.type === 'stat' ? (
              <FunctionStatSelect value={String(litOf(arg, p.default ?? 'attack'))} onChange={(v) => setArg(p.name, { k: 'lit', v })} />
            ) : p.type === 'ability' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'ability.str'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{AbilityKeySchema.options.map((k) => <option key={k} value={`ability.${k}`}>{ABILITY_LABELS[k]}</option>)}</select>
            ) : p.type === 'skill' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}><option value="">— pick skill —</option>{Object.values(skills).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            ) : p.type === 'attackKind' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'any'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>
                <option value="any">Any</option>
                <option value="ranged">Ranged</option>
                <option value="melee">Melee</option>
              </select>
            ) : p.type === 'bonusType' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'untyped'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{BonusTypeSchema.options.map((t) => <option key={t} value={t}>{t === 'untyped' ? 'not specified' : t}</option>)}</select>
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
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'always'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{EVENT_OPTIONS.filter((o) => o.value !== 'custom').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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
