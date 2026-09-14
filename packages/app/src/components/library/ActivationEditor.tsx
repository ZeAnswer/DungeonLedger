import type { Activation, Cost } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, Field, inputCls } from '../ui';
import { DurationPicker } from './EffectEditor';
import { BlocksEditor } from './BlocksEditor';
import type { Preset } from './ConditionEditor';

const ACTIONS = ['free', 'swift', 'immediate', 'move', 'standard', 'fullRound'] as const;
const RESETS = ['round', 'encounter', 'day', 'never'] as const;
const COST_LABELS: Record<Cost['kind'], string> = { charge: 'from a pool', hp: 'hit points', item: 'consume an item', spellSlot: 'spell slot', gold: 'gold', xp: 'XP' };

export function ActivationEditor({ value, onChange, onRemove, presets }: { value: Activation; onChange: (a: Activation) => void; onRemove: () => void; presets?: Preset[] }) {
  const abilities = useStore((s) => s.library.abilities);
  const set = (patch: Partial<Activation>) => onChange({ ...value, ...patch });
  const spells = Object.values(abilities).filter((a) => a.kind === 'spell').sort((a, b) => a.name.localeCompare(b.name));
  const items = Object.values(abilities).filter((a) => a.kind === 'item').sort((a, b) => a.name.localeCompare(b.name));
  const setCost = (i: number, c: Cost) => set({ cost: value.cost.map((x, j) => (j === i ? c : x)) });
  const numOrExpr = (s: string) => (/^\d+$/.test(s) ? Number(s) : s);
  return (
    <div className="rounded-2xl border border-amber-900/60 bg-zinc-900 p-2">
      <div className="mb-2 flex items-center gap-2">
        <input className={inputCls + ' flex-1'} placeholder="name (blank = record name)" value={value.name ?? ''} onChange={(e) => set({ name: e.target.value || undefined })} />
        <input className={inputCls + ' w-36'} placeholder="id" value={value.id} onChange={(e) => set({ id: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} />
        <button type="button" className="px-2 text-zinc-500" onClick={onRemove}>✕</button>
      </div>
      <Field label="Action">
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((k) => <Chip key={k} tone="blue" active={value.action === k} onClick={() => set({ action: k })}>{k}</Chip>)}
          <Chip tone="blue" active={typeof value.action === 'object'} onClick={() => set({ action: { minutes: 1 } })}>minutes…</Chip>
          {typeof value.action === 'object' && 'minutes' in value.action && <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={value.action.minutes} onChange={(e) => set({ action: { minutes: Number(e.target.value) || 1 } })} />}
        </div>
      </Field>
      <Field label="Charges (blank = at will)">
        {value.charges ? (
          <div className="flex flex-wrap items-center gap-1">
            <input className={inputCls + ' w-28 py-1.5'} placeholder="max" value={String(value.charges.max)} onChange={(e) => set({ charges: { ...value.charges!, max: numOrExpr(e.target.value) } })} />
            <select className={inputCls + ' w-auto py-1.5'} value={value.charges.resetOn} onChange={(e) => set({ charges: { ...value.charges!, resetOn: e.target.value as never } })}>{RESETS.map((r) => <option key={r} value={r}>per {r}</option>)}</select>
            <input className={inputCls + ' w-32 py-1.5'} placeholder="label" value={value.charges.label ?? ''} onChange={(e) => set({ charges: { ...value.charges!, label: e.target.value || undefined } })} />
            <button type="button" className="text-xs text-zinc-500" onClick={() => set({ charges: undefined })}>at will</button>
          </div>
        ) : <button type="button" className="text-sm text-amber-300" onClick={() => set({ charges: { max: 1, resetOn: 'day' } })}>+ limit uses</button>}
      </Field>
      <Field label="Other costs">
        {value.cost.map((c, i) => (
          <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
            <select className={inputCls + ' w-auto py-1.5'} value={c.kind} onChange={(e) => { const k = e.target.value as Cost['kind']; setCost(i, k === 'charge' ? { kind: 'charge', resourceId: '', amount: 1 } : k === 'item' ? { kind: 'item', abilityId: items[0]?.id ?? '', quantity: 1 } : k === 'spellSlot' ? { kind: 'spellSlot', level: 1 } : ({ kind: k, amount: 1 } as Cost)); }}>{(['charge', 'hp', 'item', 'spellSlot', 'gold', 'xp'] as const).map((k) => <option key={k} value={k}>{COST_LABELS[k]}</option>)}</select>
            {c.kind === 'charge' && <><input className={inputCls + ' w-32 py-1.5'} placeholder="pool id" value={c.resourceId} onChange={(e) => setCost(i, { ...c, resourceId: e.target.value })} /><input className={inputCls + ' w-16 py-1.5'} value={String(c.amount)} onChange={(e) => setCost(i, { ...c, amount: numOrExpr(e.target.value) })} /></>}
            {c.kind === 'hp' && <input className={inputCls + ' w-24 py-1.5'} value={String(c.amount)} onChange={(e) => setCost(i, { ...c, amount: numOrExpr(e.target.value) })} />}
            {(c.kind === 'gold' || c.kind === 'xp') && <input className={inputCls + ' w-24 py-1.5'} inputMode="numeric" value={c.amount} onChange={(e) => setCost(i, { ...c, amount: Number(e.target.value) || 0 })} />}
            {c.kind === 'item' && <><select className={inputCls + ' w-40 py-1.5'} value={c.abilityId} onChange={(e) => setCost(i, { ...c, abilityId: e.target.value })}>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><input className={inputCls + ' w-16 py-1.5'} inputMode="numeric" value={c.quantity} onChange={(e) => setCost(i, { ...c, quantity: Number(e.target.value) || 1 })} /></>}
            {c.kind === 'spellSlot' && <input className={inputCls + ' w-16 py-1.5'} inputMode="numeric" value={c.level} onChange={(e) => setCost(i, { ...c, level: Number(e.target.value) || 1 })} />}
            <button type="button" className="px-2 text-zinc-500" onClick={() => set({ cost: value.cost.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="text-sm text-amber-300" onClick={() => set({ cost: [...value.cost, { kind: 'charge', resourceId: '', amount: 1 }] })}>+ add cost</button>
      </Field>
      <Field label="Casts a spell">
        <select className={inputCls} value={value.spell ?? ''} onChange={(e) => set({ spell: e.target.value || undefined })}><option value="">— none —</option>{spells.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <Field label="Lasts (blank = instant; 'this attack' shows as a pre-roll chip)">
        {value.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={value.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: 'untilMyNextTurn' })}>+ set duration</button>}
      </Field>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">When used</div>
      <BlocksEditor value={value.onUse} onChange={(b) => set({ onUse: b })} showTrigger={false} family="when" presets={presets} addLabel="+ add on-use block" />
      {value.duration !== undefined && <>
        <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">While active</div>
        <BlocksEditor value={value.whileActive} onChange={(b) => set({ whileActive: b })} showTrigger={false} family="while" presets={presets} addLabel="+ add while-active block" />
      </>}
    </div>
  );
}
