import type { Condition, HistoryFilter } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, cx, inputCls } from '../ui';
import { SelectorPicker, valueKindOf, type ValueKind } from './SelectorPicker';
import { TagSelect } from './StatSelect';

/** A one-click starter condition offered next to `+ add condition` at the top level. */
export type Preset = { label: string; make: () => Condition };

/**
 * Conditions are edited as a flat list of rows joined by ALL (default) or ANY; a row is a state test
 * (selector + operator + value), a history test, or a nested group. The stored JSON keeps the engine
 * forms (`is` / `not` / `exists` / `compare` / `in` / `history` / `all` / `any` / `none` / `count`).
 */
type GroupMode = 'all' | 'any' | 'none' | 'count';
type Group = { all: Condition[] } | { any: Condition[] } | { none: Condition[] } | { count: Condition[]; atLeast: number };
type RowKind = 'state' | 'history' | 'group';

const SIZES = ['fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'];
const HURTS = ['unhurt', 'scratched', 'bloodied', 'nearDeath'];
const CMP = ['=', '!=', '<', '<=', '>', '>='] as const;
const CMP_LABEL: Record<(typeof CMP)[number], string> = { '=': 'is', '!=': 'is not', '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least' };

/** Operators offered for a selector, by the kind of value it reads. */
type Op = 'is' | 'isNot' | 'exists' | 'in' | 'inParam' | (typeof CMP)[number];
function opsFor(kind: ValueKind): { id: Op; label: string }[] {
  switch (kind) {
    case 'boolean': return [{ id: 'is', label: 'is true' }, { id: 'isNot', label: 'is false' }, { id: 'exists', label: 'has a value' }];
    case 'string': return [{ id: '=', label: 'is' }, { id: '!=', label: 'is not' }, { id: 'in', label: 'is one of' }, { id: 'inParam', label: 'is one of my chosen types' }, { id: 'exists', label: 'has a value' }];
    case 'list': return [{ id: 'in', label: 'includes any of' }, { id: 'inParam', label: 'includes my chosen types' }, { id: 'exists', label: 'is not empty' }];
    default: return [...CMP.map((c) => ({ id: c, label: CMP_LABEL[c] })), { id: 'exists', label: 'has a value' }];
  }
}

function isGroup(c: Condition): c is Group {
  return 'all' in c || 'any' in c || 'none' in c || 'count' in c;
}
function groupMode(g: Group): GroupMode {
  return 'all' in g ? 'all' : 'any' in g ? 'any' : 'none' in g ? 'none' : 'count';
}
function groupItems(g: Group): Condition[] {
  return 'all' in g ? g.all : 'any' in g ? g.any : 'none' in g ? g.none : g.count;
}
function makeGroup(mode: GroupMode, items: Condition[], atLeast = 1): Group {
  return mode === 'all' ? { all: items } : mode === 'any' ? { any: items } : mode === 'none' ? { none: items } : { count: items, atLeast };
}

/** Every condition is shown as a group at the root; a bare leaf or `not` is wrapped so it can grow rows. */
function asGroup(c: Condition): Group {
  if (isGroup(c)) return c;
  if ('not' in c) return isGroup(c.not) && groupMode(c.not) === 'all' ? { none: groupItems(c.not) } : { none: [c.not] };
  return { all: [c] };
}

function rowKind(c: Condition): RowKind {
  if ('history' in c) return 'history';
  if (isGroup(c) || ('not' in c && !('is' in c.not))) return 'group';
  return 'state';
}

/** Read a state row back into selector + operator + value. */
function readState(c: Condition): { sel: string; op: Op; value: unknown; set?: string[]; param?: string } {
  if ('is' in c) return { sel: c.is, op: 'is', value: true };
  if ('not' in c && 'is' in c.not) return { sel: c.not.is, op: 'isNot', value: false };
  if ('exists' in c) return { sel: c.exists, op: 'exists', value: undefined };
  if ('compare' in c) return { sel: c.compare, op: c.op, value: c.value };
  if ('in' in c) return { sel: c.in, op: c.param ? 'inParam' : 'in', value: undefined, ...(c.set ? { set: c.set } : {}), ...(c.param ? { param: c.param } : {}) };
  return { sel: 'target.tag.aquatic', op: 'is', value: true };
}

function defaultValueFor(kind: ValueKind): number | string {
  return kind === 'ordinal-size' ? 'large' : kind === 'ordinal-hurt' ? 'bloodied' : kind === 'string' ? '' : 0;
}

/** Build the stored condition from selector + operator (+ carried value). */
function writeState(sel: string, op: Op, prev: ReturnType<typeof readState>, params: string[]): Condition {
  const kind = valueKindOf(sel);
  switch (op) {
    case 'is': return { is: sel };
    case 'isNot': return { not: { is: sel } };
    case 'exists': return { exists: sel };
    case 'in': return { in: sel, set: prev.set ?? [] };
    case 'inParam': return { in: sel, param: prev.param ?? params[0] ?? 'types' };
    default: {
      const carried = prev.op === op || CMP.includes(prev.op as never) ? prev.value : undefined;
      const value = typeof carried === 'number' || typeof carried === 'string' ? carried : defaultValueFor(kind);
      return { compare: sel, op, value };
    }
  }
}

function defaultRow(kind: RowKind): Condition {
  switch (kind) {
    case 'state': return { is: 'target.tag.aquatic' };
    case 'history': return { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' }, op: '>=', value: 1 };
    case 'group': return { any: [] };
  }
}

/** Root editor for a block's `when`: rows joined by all/any, presets at the top level. */
export function ConditionEditor({ value, onChange, presets }: { value: Condition; onChange: (c: Condition) => void; presets?: Preset[] }) {
  return <GroupEditor value={asGroup(value)} onChange={onChange} presets={presets} depth={0} />;
}

function GroupEditor({ value, onChange, onRemove, presets, depth }: { value: Group; onChange: (c: Condition) => void; onRemove?: () => void; presets?: Preset[]; depth: number }) {
  const mode = groupMode(value);
  const items = groupItems(value);
  const atLeast = 'count' in value ? value.atLeast : 1;
  const setItems = (next: Condition[]) => onChange(makeGroup(mode, next, atLeast));
  const setMode = (m: GroupMode) => onChange(makeGroup(m, items, atLeast));
  const root = depth === 0;
  const modes: { id: GroupMode; label: string }[] = root ? [{ id: 'all', label: 'all of' }, { id: 'any', label: 'any of' }] : [{ id: 'all', label: 'all of' }, { id: 'any', label: 'any of' }, { id: 'none', label: 'none of' }, { id: 'count', label: 'at least N of' }];
  return (
    <div className={cx(!root && 'rounded-xl border border-zinc-700 bg-zinc-900 p-2')}>
      <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        {items.length > 1 || !root ? <>{modes.map((m) => <Chip key={m.id} tone="blue" active={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</Chip>)}</> : <span>{items.length === 0 ? 'always' : 'if'}</span>}
        {mode === 'count' && <input data-role="cond-atleast" className={inputCls + ' w-14 py-1'} inputMode="numeric" value={atLeast} onChange={(e) => onChange(makeGroup('count', items, Number(e.target.value) || 1))} />}
        {onRemove && <button type="button" className="ml-auto px-2 text-zinc-500" onClick={onRemove}>✕</button>}
      </div>
      <div className="space-y-2">
        {items.map((c, i) => <RowEditor key={i} value={c} depth={depth + 1} onChange={(n) => setItems(items.map((x, j) => (j === i ? n : x)))} onRemove={() => setItems(items.filter((_, j) => j !== i))} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <button type="button" className="text-sm text-amber-300" onClick={() => setItems([...items, defaultRow('state')])}>+ add condition</button>
        <button type="button" className="text-sm text-amber-300" onClick={() => setItems([...items, defaultRow('history')])}>+ something happened</button>
        {depth < 3 && <button type="button" className="text-sm text-zinc-400" onClick={() => setItems([...items, defaultRow('group')])}>+ group</button>}
        {root && presets?.map((p) => <button key={p.label} type="button" className="text-sm text-sky-300" onClick={() => setItems([...items, p.make()])}>+ {p.label}</button>)}
      </div>
    </div>
  );
}

function RowEditor({ value, onChange, onRemove, depth }: { value: Condition; onChange: (c: Condition) => void; onRemove: () => void; depth: number }) {
  const kind = rowKind(value);
  if (kind === 'group') return <GroupEditor value={asGroup(value)} onChange={onChange} onRemove={onRemove} depth={depth} />;
  return (
    <div data-role="cond-row" data-kind={kind} className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{kind === 'history' ? <HistoryRow value={value as Extract<Condition, { history: HistoryFilter }>} onChange={onChange} /> : <StateRow value={value} onChange={onChange} />}</div>
        <button type="button" className="px-1 text-zinc-500" onClick={onRemove}>✕</button>
      </div>
    </div>
  );
}

function StateRow({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const params = [...new Set(Object.values(abilities).flatMap((a) => (a.kind === 'feature' ? Object.keys(a.params ?? {}) : [])))];
  const cur = readState(value);
  const kind = valueKindOf(cur.sel);
  const ops = opsFor(kind);
  const op: Op = ops.some((o) => o.id === cur.op) ? cur.op : ops[0]!.id;
  const setSel = (sel: string) => {
    const nextOps = opsFor(valueKindOf(sel));
    const keep = nextOps.some((o) => o.id === op) ? op : nextOps[0]!.id;
    onChange(writeState(sel, keep, cur, params));
  };
  const setOp = (next: Op) => onChange(writeState(cur.sel, next, cur, params));
  const setValue = (v: number | string) => onChange({ compare: cur.sel, op: op as (typeof CMP)[number], value: v });
  const cmp = CMP.includes(op as never);
  return (
    <div className="space-y-1">
      <SelectorPicker value={cur.sel} onChange={setSel} />
      <div className="flex flex-wrap items-center gap-1">
        <select data-role="cond-op" className={inputCls + ' w-auto py-1.5 text-sm'} value={op} onChange={(e) => setOp(e.target.value as Op)}>{ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        {cmp && kind === 'ordinal-size' && <select data-role="cond-value" className={inputCls + ' w-auto py-1.5 text-sm'} value={String(cur.value)} onChange={(e) => setValue(e.target.value)}>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        {cmp && kind === 'ordinal-hurt' && <select data-role="cond-value" className={inputCls + ' w-auto py-1.5 text-sm'} value={String(cur.value)} onChange={(e) => setValue(e.target.value)}>{HURTS.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        {cmp && kind === 'string' && cur.sel === 'attack.kind' && <select data-role="cond-value" className={inputCls + ' w-auto py-1.5 text-sm'} value={String(cur.value)} onChange={(e) => setValue(e.target.value)}><option value="ranged">ranged</option><option value="melee">melee</option></select>}
        {cmp && kind === 'string' && cur.sel !== 'attack.kind' && <input data-role="cond-value" className={inputCls + ' w-40 py-1.5 text-sm'} value={String(cur.value)} onChange={(e) => setValue(e.target.value)} />}
        {cmp && (kind === 'number' || kind === 'boolean' || kind === 'list') && <input data-role="cond-value" className={inputCls + ' w-40 py-1.5 text-sm'} placeholder="number or expression" value={String(cur.value ?? '')} onChange={(e) => setValue(/^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value)} />}
        {op === 'inParam' && <select className={inputCls + ' w-auto py-1.5 text-sm'} value={cur.param ?? ''} onChange={(e) => onChange({ in: cur.sel, param: e.target.value })}>{[...new Set([...params, ...(cur.param ? [cur.param] : [])])].map((p) => <option key={p} value={p}>{p}</option>)}</select>}
      </div>
      {op === 'in' && (
        <div>
          <div className="mb-1 flex flex-wrap gap-1">{(cur.set ?? []).map((t) => <Chip key={t} active onClick={() => onChange({ in: cur.sel, set: (cur.set ?? []).filter((x) => x !== t) })}>{tags[t]?.label ?? t} ✕</Chip>)}</div>
          <TagSelect value="" placeholder="+ add tag…" onChange={(v) => v && !(cur.set ?? []).includes(v) && onChange({ in: cur.sel, set: [...(cur.set ?? []), v] })} />
        </div>
      )}
    </div>
  );
}

function HistoryRow({ value, onChange }: { value: Extract<Condition, { history: HistoryFilter }>; onChange: (c: Condition) => void }) {
  const abilities = useStore((s) => s.library.abilities);
  const h = value.history;
  const setH = (p: Partial<HistoryFilter>) => onChange({ ...value, history: { ...h, ...p } });
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <select className={inputCls + ' w-auto py-1.5'} value={h.by} onChange={(e) => setH({ by: e.target.value as HistoryFilter['by'] })}><option value="me">I</option><option value="target">the target</option><option value="any">anyone</option></select>
        <select className={inputCls + ' w-auto py-1.5'} value={h.event} onChange={(e) => setH({ event: e.target.value as HistoryFilter['event'] })}>
          {(['hit', 'miss', 'crit', 'attack', 'used', 'activated', 'damaged', 'moved'] as const).map((ev) => <option key={ev} value={ev}>{{ hit: 'hit', miss: 'missed', crit: 'critted', attack: 'attacked', used: 'used ability', activated: 'activated', damaged: 'damaged', moved: 'moved' }[ev]}</option>)}
        </select>
        <select className={inputCls + ' w-auto py-1.5'} value={h.vs} onChange={(e) => setH({ vs: e.target.value as HistoryFilter['vs'] })}><option value="current">this target</option><option value="any">anyone</option><option value="sameCategory">same category as target</option></select>
        <select className={inputCls + ' w-auto py-1.5'} value={h.scope} onChange={(e) => setH({ scope: e.target.value as HistoryFilter['scope'] })}><option value="thisRound">this round</option><option value="lastRound">last round</option><option value="encounter">this battle</option><option value="day">today</option></select>
      </div>
      {h.event === 'used' && <select className={inputCls} value={h.abilityId ?? ''} onChange={(e) => setH({ abilityId: e.target.value || undefined })}><option value="">any ability</option>{Object.values(abilities).sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
      {h.vs === 'sameCategory' && <input className={inputCls} placeholder="tag category, e.g. creatureType" value={h.category ?? ''} onChange={(e) => setH({ category: e.target.value || undefined })} />}
      <div className="flex items-center gap-1 text-xs text-zinc-400">
        <select className={inputCls + ' w-auto py-1'} value={value.op ?? '>='} onChange={(e) => onChange({ ...value, op: e.target.value as (typeof CMP)[number] })}>{CMP.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={value.value ?? 1} onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })} /> times
      </div>
    </div>
  );
}
