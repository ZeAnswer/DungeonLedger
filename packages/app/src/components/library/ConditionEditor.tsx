import type { Condition, HistoryFilter } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, cx, inputCls } from '../ui';
import { SelectorPicker, valueKindOf } from './SelectorPicker';
import { TagSelect } from './StatSelect';

type Form = 'all' | 'any' | 'none' | 'not' | 'count' | 'is' | 'exists' | 'compare' | 'in' | 'history';
const FORMS: { id: Form; label: string; group: string }[] = [
  { id: 'all', label: 'ALL of', group: 'Combine' }, { id: 'any', label: 'ANY of', group: 'Combine' }, { id: 'none', label: 'NONE of', group: 'Combine' }, { id: 'not', label: 'NOT', group: 'Combine' }, { id: 'count', label: 'At least N of', group: 'Combine' },
  { id: 'is', label: 'State is true', group: 'State' }, { id: 'compare', label: 'Compare a value', group: 'State' }, { id: 'in', label: 'Target type is one of', group: 'State' }, { id: 'exists', label: 'Value exists', group: 'State' },
  { id: 'history', label: 'Something happened (history)', group: 'Memory' },
];
/** A one-click starter condition offered next to `+ add condition` at the top level. */
export type Preset = { label: string; make: () => Condition };

const OPS = ['=', '!=', '<', '<=', '>', '>='] as const;
const SIZES = ['fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'];
const HURTS = ['unhurt', 'scratched', 'bloodied', 'nearDeath'];

export function formOf(c: Condition): Form {
  return (Object.keys(c).find((k) => FORMS.some((f) => f.id === k)) ?? 'all') as Form;
}

function defaultFor(form: Form): Condition {
  switch (form) {
    case 'all': return { all: [] };
    case 'any': return { any: [] };
    case 'none': return { none: [] };
    case 'not': return { not: { all: [] } };
    case 'count': return { count: [], atLeast: 1 };
    case 'is': return { is: 'target.tag.aquatic' };
    case 'exists': return { exists: 'target.exists' };
    case 'compare': return { compare: 'target.distance', op: '<=', value: 30 };
    case 'in': return { in: 'target.tags', set: [] };
    case 'history': return { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' }, op: '>=', value: 1 };
  }
}

export function ConditionEditor({ value, onChange, onRemove, depth = 0, presets }: { value: Condition; onChange: (c: Condition) => void; onRemove?: () => void; depth?: number; presets?: Preset[] }) {
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const form = formOf(value);
  const set = (patch: Record<string, unknown>) => onChange({ ...(value as object), ...patch } as Condition);
  const list = (arr: Condition[], key: string) => (
    <div className="space-y-2">
      {arr.map((c, i) => <ConditionEditor key={i} value={c} depth={depth + 1} onChange={(n) => set({ [key]: arr.map((x, j) => (j === i ? n : x)) })} onRemove={() => set({ [key]: arr.filter((_, j) => j !== i) })} />)}
      <div>
        <button type="button" className="text-sm text-amber-300" onClick={() => set({ [key]: [...arr, { is: 'target.tag.aquatic' }] })}>+ add condition</button>
        {depth === 0 && presets?.map((p) => <button key={p.label} type="button" className="ml-2 text-sm text-sky-300" onClick={() => set({ [key]: [...arr, p.make()] })}>+ {p.label}</button>)}
      </div>
    </div>
  );

  let body: React.ReactNode = null;
  if ('all' in value) body = list(value.all, 'all');
  else if ('any' in value) body = list(value.any, 'any');
  else if ('none' in value) body = list(value.none, 'none');
  else if ('not' in value) body = <ConditionEditor value={value.not} depth={depth + 1} onChange={(n) => set({ not: n })} />;
  else if ('count' in value) body = <div><div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">at least <input className={inputCls + ' w-16'} inputMode="numeric" value={value.atLeast} onChange={(e) => set({ atLeast: Number(e.target.value) || 1 })} /> of:</div>{list(value.count, 'count')}</div>;
  else if ('is' in value) body = <SelectorPicker value={value.is} onChange={(s) => set({ is: s })} />;
  else if ('exists' in value) body = <SelectorPicker value={value.exists} onChange={(s) => set({ exists: s })} />;
  else if ('compare' in value) {
    const kind = valueKindOf(value.compare);
    body = (
      <div className="space-y-1">
        <SelectorPicker value={value.compare} onChange={(s) => set({ compare: s, value: kind === valueKindOf(s) ? value.value : valueKindOf(s) === 'ordinal-size' ? 'large' : valueKindOf(s) === 'ordinal-hurt' ? 'bloodied' : valueKindOf(s) === 'string' ? '' : 0 })} />
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-zinc-500">is</span>
          <select data-role="cond-op" className={inputCls + ' w-auto py-1.5 text-sm'} value={value.op} onChange={(e) => set({ op: e.target.value })}>{OPS.map((o) => <option key={o} value={o}>{{ '=': 'equal to', '!=': 'not', '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least' }[o]}</option>)}</select>
          {kind === 'ordinal-size' && <select className={inputCls + ' w-auto py-1.5 text-sm'} value={String(value.value)} onChange={(e) => set({ value: e.target.value })}>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
          {kind === 'ordinal-hurt' && <select className={inputCls + ' w-auto py-1.5 text-sm'} value={String(value.value)} onChange={(e) => set({ value: e.target.value })}>{HURTS.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
          {kind === 'string' && value.compare === 'attack.kind' && <select data-role="cond-value" className={inputCls + ' w-auto py-1.5 text-sm'} value={String(value.value)} onChange={(e) => set({ value: e.target.value })}><option value="ranged">ranged</option><option value="melee">melee</option></select>}
          {kind === 'string' && value.compare !== 'attack.kind' && <input className={inputCls + ' w-40 py-1.5 text-sm'} value={String(value.value)} onChange={(e) => set({ value: e.target.value })} />}
          {(kind === 'number' || kind === 'boolean' || kind === 'list') && <input className={inputCls + ' w-40 py-1.5 text-sm'} placeholder="number or expression" value={String(value.value)} onChange={(e) => set({ value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} />}
        </div>
      </div>
    );
  } else if ('in' in value) {
    const params = [...new Set(Object.values(abilities).flatMap((a) => (a.kind === 'feature' ? Object.keys(a.params ?? {}) : [])))];
    body = (
      <div className="space-y-1">
        <SelectorPicker value={value.in} onChange={(s) => set({ in: s })} />
        <div className="flex flex-wrap gap-1">
          <Chip active={!value.param} onClick={() => set({ param: undefined, set: value.set ?? [] })}>a fixed set</Chip>
          <Chip active={!!value.param} onClick={() => set({ param: params[0] ?? 'types', set: undefined })}>my chosen types (param)</Chip>
        </div>
        {value.param ? (
          <select className={inputCls} value={value.param} onChange={(e) => set({ param: e.target.value })}>{params.map((p) => <option key={p} value={p}>{p}</option>)}<option value={value.param}>{value.param}</option></select>
        ) : (
          <div>
            <div className="mb-1 flex flex-wrap gap-1">{(value.set ?? []).map((t) => <Chip key={t} active onClick={() => set({ set: (value.set ?? []).filter((x) => x !== t) })}>{tags[t]?.label ?? t} ✕</Chip>)}</div>
            <TagSelect value="" placeholder="+ add tag…" onChange={(v) => v && !(value.set ?? []).includes(v) && set({ set: [...(value.set ?? []), v] })} />
          </div>
        )}
      </div>
    );
  } else if ('history' in value) {
    const h = value.history;
    const setH = (p: Partial<HistoryFilter>) => set({ history: { ...h, ...p } });
    body = (
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
          <select className={inputCls + ' w-auto py-1'} value={value.op ?? '>='} onChange={(e) => set({ op: e.target.value })}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={value.value ?? 1} onChange={(e) => set({ value: Number(e.target.value) || 0 })} /> times
        </div>
      </div>
    );
  }

  return (
    <div className={cx('rounded-xl border p-2', depth % 2 ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-950')}>
      <div className="mb-1 flex items-center gap-2">
        <select data-role="cond-form" className={inputCls + ' flex-1 py-1.5 text-sm'} value={form} onChange={(e) => onChange(defaultFor(e.target.value as Form))}>
          {[...new Set(FORMS.map((f) => f.group))].map((g) => <optgroup key={g} label={g}>{FORMS.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>)}
        </select>
        {onRemove && <button type="button" className="px-2 text-zinc-500" onClick={onRemove}>✕</button>}
      </div>
      {body}
    </div>
  );
}
