import { useState } from 'react';
import { AbilitySchema, SLOTS, type Ability, type Condition, type Feature, type Item, type ItemCategory, type Spell, type Status } from '@hl/engine';
import { Button, Chip, Field, cx, inputCls } from '../ui';
import { BlocksEditor } from './BlocksEditor';
import { ActivationEditor } from './ActivationEditor';
import { DurationPicker } from './EffectEditor';
import type { Preset } from './ConditionEditor';
import { useStore } from '../../store/store';

const ITEM_CATEGORIES: ItemCategory[] = ['weapon', 'armor', 'shield', 'ammunition', 'wondrous', 'potion', 'scroll', 'wand', 'tool', 'trophy', 'material', 'gear'];
const SLOTTED: Partial<Record<ItemCategory, readonly string[]>> = { weapon: ['mainHand', 'offHand'], armor: ['armor'], shield: ['offHand', 'buckler'], ammunition: ['quiver'], wondrous: SLOTS.map((s) => s.id), trophy: SLOTS.map((s) => s.id), tool: ['mainHand', 'offHand', 'none'] };
const RESETS = ['round', 'encounter', 'day', 'never'] as const;

export function freshRecord(kind: Ability['kind'], over: Partial<Item['item']> = {}): Ability {
  const id = `${kind}-${Date.now().toString(36)}`;
  switch (kind) {
    case 'feature': return { id, name: '', kind, acquired: { kind: 'feat' }, enabledByDefault: true, effects: [], activations: [], pools: [] };
    case 'item': return { id, name: '', kind, item: { category: 'gear', tags: [], ...over }, effects: [], activations: [], pools: [] };
    case 'spell': return { id, name: '', kind, castingAction: 'standard', effects: [] };
    case 'status': return { id, name: '', kind, harmful: false, effects: [] };
  }
}

export function RecordEditor({ initial, onSave, onDelete, onCancel }: { initial: Ability; onSave: (a: Ability) => void; onDelete?: () => void; onCancel: () => void }) {
  const [a, setA] = useState<Ability>(initial);
  const [tab, setTab] = useState<'builder' | 'json'>('builder');
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [err, setErr] = useState<string | undefined>();
  const set = (patch: Partial<Ability>) => setA({ ...a, ...patch } as Ability);
  const switchTab = (t: 'builder' | 'json') => {
    if (t === 'json') setJson(JSON.stringify(a, null, 2));
    else { try { setA(AbilitySchema.parse(JSON.parse(json))); setErr(undefined); } catch (e) { setErr((e as Error).message); return; } }
    setTab(t);
  };
  const save = () => {
    try {
      const parsed = AbilitySchema.parse(tab === 'json' ? JSON.parse(json) : a);
      if (parsed.kind !== initial.kind) throw new Error(`This is the ${initial.kind} editor; kind cannot change`);
      if (!parsed.id.trim()) throw new Error('id required');
      if (!parsed.name.trim()) throw new Error('name required');
      if (parsed.kind === 'item' && SLOTTED[parsed.item.category] && !parsed.item.slot) throw new Error(`Choose a body slot for this ${parsed.item.category}`);
      onSave(parsed);
    } catch (e) { setErr((e as Error).message); }
  };
  const presets: Preset[] = [
    ...(a.kind === 'item' ? [{ label: 'only with this weapon', make: (): Condition => ({ compare: 'attack.weapon.id', op: '=', value: a.id }) }] : []),
    { label: 'only while a slot is filled', make: (): Condition => ({ compare: 'self.equipped.slot.arms', op: '>=', value: 1 }) },
  ];
  const KIND_TITLE = { feature: 'Feature', item: 'Item', spell: 'Spell', status: 'Status' }[a.kind];

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl bg-zinc-900 p-1">{(['builder', 'json'] as const).map((t) => <button key={t} type="button" onClick={() => switchTab(t)} className={cx('flex-1 rounded-lg py-1.5 text-sm', tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>{t === 'builder' ? KIND_TITLE : 'JSON'}</button>)}</div>
      {tab === 'json' ? (
        <textarea className={inputCls + ' h-[55vh] font-mono text-xs'} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" htmlFor="ab-name"><input id="ab-name" className={inputCls} value={a.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Id (stable, no spaces)" htmlFor="ab-id"><input id="ab-id" className={inputCls} value={a.id} onChange={(e) => set({ id: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} /></Field>
          </div>
          {a.kind === 'feature' && <FeatureFields a={a} set={set} />}
          {a.kind === 'item' && <ItemFields a={a} set={set} />}
          {a.kind === 'spell' && <SpellFields a={a} set={set} />}
          {a.kind === 'status' && <StatusFields a={a} set={set} />}
          <Field label="Rules text"><textarea className={inputCls} value={a.text ?? ''} onChange={(e) => set({ text: e.target.value || undefined })} /></Field>
          <Field label="Source reference"><input className={inputCls} value={a.sourceRef ?? ''} onChange={(e) => set({ sourceRef: e.target.value || undefined })} placeholder="PHB p.98, DM card…" /></Field>

          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{{ feature: 'Passive effects (while enabled)', item: 'Passive effects (while equipped)', spell: 'Effects (while the spell lasts; instant spells apply them once)', status: 'Effects (while active)' }[a.kind]}</div>
          <BlocksEditor value={a.effects} onChange={(effects) => set({ effects })} presets={presets} />

          {(a.kind === 'feature' || a.kind === 'item') && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Activations (things you do with it)</div>
              <div className="space-y-3">
                {a.activations.map((act, i) => <ActivationEditor key={i} value={act} presets={presets} onChange={(n) => set({ activations: a.activations.map((x, j) => (j === i ? n : x)) } as Partial<Ability>)} onRemove={() => set({ activations: a.activations.filter((_, j) => j !== i) } as Partial<Ability>)} />)}
                <Button onClick={() => set({ activations: [...a.activations, { id: a.activations.length ? `${a.id}-${a.activations.length + 1}` : a.id, action: 'standard', cost: [], onUse: [], whileActive: [] }] } as Partial<Ability>)}>+ add activation</Button>
              </div>
              <Field label="Shared pools (only when several activations or records spend the same charges)">
                {a.pools.map((p, i) => (
                  <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
                    <input className={inputCls + ' w-32 py-1.5'} placeholder="id" value={p.id} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) } as Partial<Ability>)} />
                    <input className={inputCls + ' w-28 py-1.5'} placeholder="label" value={p.label ?? ''} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) } as Partial<Ability>)} />
                    <input className={inputCls + ' w-24 py-1.5'} placeholder="max" value={String(p.max)} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, max: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value } : x)) } as Partial<Ability>)} />
                    <select className={inputCls + ' w-auto py-1.5'} value={p.resetOn} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, resetOn: e.target.value as never } : x)) } as Partial<Ability>)}>{RESETS.map((k) => <option key={k} value={k}>per {k}</option>)}</select>
                    <button type="button" className="px-2 text-zinc-500" onClick={() => set({ pools: a.pools.filter((_, j) => j !== i) } as Partial<Ability>)}>✕</button>
                  </div>
                ))}
                <button type="button" className="text-sm text-amber-300" onClick={() => set({ pools: [...a.pools, { id: `${a.id}-pool`, max: 1, resetOn: 'day' }] } as Partial<Ability>)}>+ add pool</button>
              </Field>
            </div>
          )}
          <Field label="Todo / open question"><input className={inputCls} value={a.todo ?? ''} onChange={(e) => set({ todo: e.target.value || undefined })} /></Field>
        </div>
      )}
      {err && <pre className="mt-2 whitespace-pre-wrap text-xs text-red-300">{err}</pre>}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={save}>Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {onDelete && <Button variant="danger" className="ml-auto" onClick={onDelete}>Delete</Button>}
      </div>
    </div>
  );
}

function FeatureFields({ a, set }: { a: Feature; set: (p: Partial<Ability>) => void }) {
  const library = useStore((s) => s.library);
  const acq = a.acquired;
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <Field label="How it was acquired">
        <div className="flex flex-wrap gap-1">
          {([['feat', 'general feat'], ['class', 'class feature'], ['race', 'racial'], ['dm', 'DM grant / memory']] as const).map(([k, l]) => <Chip key={k} active={acq.kind === k} onClick={() => set({ acquired: k === 'class' ? { kind: 'class' } : { kind: k } })}>{l}</Chip>)}
        </div>
        {acq.kind === 'class' && <div className="mt-1 grid grid-cols-2 gap-2"><select className={inputCls} value={acq.classId ?? ''} onChange={(e) => set({ acquired: { ...acq, classId: e.target.value || undefined } })}><option value="">— class —</option>{Object.values(library.classTables).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input className={inputCls} placeholder="class level" inputMode="numeric" value={acq.level ?? ''} onChange={(e) => set({ acquired: { ...acq, level: e.target.value === '' ? undefined : Number(e.target.value) } })} /></div>}
      </Field>
      <Field label="Choices made at level-up (favored enemy types, weapon…)">
        {Object.entries(a.params ?? {}).map(([name, def]) => (
          <div key={name} className="mb-1 flex items-center gap-1">
            <input className={inputCls + ' w-28'} value={name} onChange={(e) => { const p = { ...a.params }; delete p[name]; p[e.target.value] = def; set({ params: p }); }} />
            <select className={inputCls + ' w-auto'} value={def.kind} onChange={(e) => set({ params: { ...a.params, [name]: e.target.value === 'tags' ? { kind: 'tags', category: 'creatureType' } : e.target.value === 'number' ? { kind: 'number' } : { kind: 'choice', options: [] } } })}><option value="tags">tags</option><option value="number">number</option><option value="choice">choice</option></select>
            {def.kind === 'tags' && <input className={inputCls} placeholder="tag category" value={def.category ?? ''} onChange={(e) => set({ params: { ...a.params, [name]: { ...def, category: e.target.value || undefined } } })} />}
            {def.kind === 'choice' && <input className={inputCls} placeholder="options, comma separated" value={def.options.join(', ')} onChange={(e) => set({ params: { ...a.params, [name]: { ...def, options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } } })} />}
            <button type="button" className="px-2 text-zinc-500" onClick={() => { const p = { ...a.params }; delete p[name]; set({ params: Object.keys(p).length ? p : undefined }); }}>✕</button>
          </div>
        ))}
        <button type="button" className="text-sm text-amber-300" onClick={() => set({ params: { ...a.params, types: { kind: 'tags', category: 'creatureType' } } })}>+ add choice</button>
      </Field>
      <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={a.enabledByDefault} onChange={(e) => set({ enabledByDefault: e.target.checked })} /> enabled when added to a character</label>
    </div>
  );
}

function ItemFields({ a, set }: { a: Item; set: (p: Partial<Ability>) => void }) {
  const item = a.item;
  const itemSet = (patch: Partial<Item['item']>) => set({ item: { ...item, ...patch } });
  const cat = item.category; const slots = SLOTTED[cat];
  const w = item.weapon ?? { kind: 'melee' as const, dice: '1d8', critRange: 20, critMult: 2, attackAbility: 'str' as const, damageAbility: 'str' as const, damageAbilityMultiplier: 1, enhancement: 0, tags: [] as string[] };
  const ws = (p: Partial<typeof w>) => itemSet({ weapon: { ...w, ...p } });
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <Field label="Item category" htmlFor="item-cat"><select id="item-cat" className={inputCls} value={cat} onChange={(e) => { const nc = e.target.value as ItemCategory; const ns = SLOTTED[nc]; itemSet({ category: nc, slot: ns ? (ns.length === 1 ? (ns[0] as never) : undefined) : undefined }); }}>{ITEM_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      {slots && (
        <Field label={`Body slot${item.slot ? '' : ' — choose one'}`}>
          <div className="flex flex-wrap gap-1">
            {slots.map((id) => <Chip key={id} tone="amber" active={item.slot === id} onClick={() => itemSet({ slot: id as never })}>{id === 'none' ? 'No slot (active when carried)' : SLOTS.find((s) => s.id === id)?.label ?? id}</Chip>)}
            {(cat === 'wondrous' || cat === 'trophy') && <Chip tone="amber" active={item.slot === 'none'} onClick={() => itemSet({ slot: 'none' })}>No slot (active when carried)</Chip>}
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Weight (lb)"><input className={inputCls} inputMode="decimal" value={item.weight ?? ''} onChange={(e) => itemSet({ weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        <Field label="Price"><input className={inputCls} value={item.price ?? ''} onChange={(e) => itemSet({ price: e.target.value || undefined })} /></Field>
      </div>
      <Field label="Item tags (bow, longbow, trophy-aberration…)"><input className={inputCls} value={item.tags.join(', ')} onChange={(e) => itemSet({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
      {cat === 'weapon' && (
        <div className="rounded-xl bg-zinc-950 p-2">
          <div className="mb-1 text-xs uppercase text-zinc-500">Weapon profile</div>
          <div className="mb-1 flex flex-wrap gap-1">{(['melee', 'ranged'] as const).map((k) => <Chip key={k} active={w.kind === k} onClick={() => ws({ kind: k, attackAbility: k === 'ranged' ? 'dex' : 'str' })}>{k}</Chip>)}</div>
          <div className="grid grid-cols-3 gap-1">
            <input className={inputCls} placeholder="dice 1d8" value={w.dice} onChange={(e) => ws({ dice: e.target.value })} />
            <input className={inputCls} placeholder="crit from (20)" inputMode="numeric" value={w.critRange} onChange={(e) => ws({ critRange: Number(e.target.value) || 20 })} />
            <input className={inputCls} placeholder="×mult" inputMode="numeric" value={w.critMult} onChange={(e) => ws({ critMult: Number(e.target.value) || 2 })} />
            <input className={inputCls} placeholder="enhancement" inputMode="numeric" value={w.enhancement} onChange={(e) => ws({ enhancement: Number(e.target.value) || 0 })} />
            <input className={inputCls} placeholder="range ft" inputMode="numeric" value={w.rangeIncrement ?? ''} onChange={(e) => ws({ rangeIncrement: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className={inputCls} placeholder="max Str to dmg" inputMode="numeric" value={w.maxDamageAbilityBonus ?? ''} onChange={(e) => ws({ maxDamageAbilityBonus: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-400">attack uses <select className={inputCls + ' w-auto py-1'} value={w.attackAbility} onChange={(e) => ws({ attackAbility: e.target.value as 'str' })}>{['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select> damage uses <select className={inputCls + ' w-auto py-1'} value={w.damageAbility ?? ''} onChange={(e) => ws({ damageAbility: (e.target.value || undefined) as 'str' | undefined })}><option value="">none</option>{['str', 'dex'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select> ×<input className={inputCls + ' w-14 py-1'} value={w.damageAbilityMultiplier} onChange={(e) => ws({ damageAbilityMultiplier: Number(e.target.value) || 1 })} /></div>
        </div>
      )}
    </div>
  );
}

function SpellFields({ a, set }: { a: Spell; set: (p: Partial<Ability>) => void }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 p-2">
      <Field label="Spell level"><input className={inputCls} inputMode="numeric" value={a.level ?? ''} onChange={(e) => set({ level: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      <Field label="Casting action"><select className={inputCls} value={typeof a.castingAction === 'string' ? a.castingAction : 'minutes'} onChange={(e) => set({ castingAction: e.target.value === 'minutes' ? { minutes: 1 } : (e.target.value as 'standard') })}>{['free', 'swift', 'immediate', 'move', 'standard', 'fullRound', 'minutes'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      <div className="col-span-2"><Field label="Duration (blank = instant)">{a.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={a.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: { rounds: 10 } })}>+ set duration</button>}</Field></div>
    </div>
  );
}

function StatusFields({ a, set }: { a: Status; set: (p: Partial<Ability>) => void }) {
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <div className="mb-2 flex gap-1"><Chip tone="green" active={!a.harmful} onClick={() => set({ harmful: false })}>buff</Chip><Chip tone="red" active={a.harmful} onClick={() => set({ harmful: true })}>harmful condition</Chip></div>
      <Field label="Default duration (blank = until removed)">{a.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={a.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: { rounds: 10 } })}>+ set duration</button>}</Field>
    </div>
  );
}
