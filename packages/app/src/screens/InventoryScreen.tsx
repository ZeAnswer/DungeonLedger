import { useMemo, useState } from 'react';
import { SLOTS, activationsOf, addItemInstance, equipItem, itemAbility, removeItemInstance, slotCapacity, slotOccupants, slotOf, twoHandedInMainHand, unequipItem, type Ability, type EvalContext, type InventoryEntry, type Item, type ItemCategory, type SlotId } from '@hl/engine';
import { useStore } from '../store/store';
import { useCtx } from '../store/hooks';
import { usePathLongPress } from '../hooks/usePathLongPress';
import { Button, Chip, Field, Sheet, cx, humanize, inputCls } from '../components/ui';
import { RecordEditor, freshRecord } from '../components/library/RecordEditor';
import { AbilitySheet } from '../components/character/AbilitySheet';

const CATEGORIES: ItemCategory[] = ['weapon', 'armor', 'shield', 'ammunition', 'wondrous', 'potion', 'scroll', 'wand', 'tool', 'trophy', 'material', 'gear'];

function entryName(ctx: EvalContext, e: InventoryEntry) { return itemAbility(ctx, e)?.name ?? e.name ?? '(unknown item)'; }
function entryCategory(ctx: EvalContext, e: InventoryEntry) { const a = itemAbility(ctx, e); return (a?.kind === 'item' ? a.item.category : undefined) ?? (e.category as ItemCategory | undefined) ?? 'gear'; }

/** The item's name, long-pressable for the path a script checks it with. */
function ItemName({ abilityId, name }: { abilityId?: string; name: string }) {
  const press = usePathLongPress(`player.wearing('${abilityId ?? ''}')`, name);
  return <span {...(abilityId ? press : {})} className="truncate">{name}</span>;
}

export function InventoryScreen() {
  const ctx = useCtx();
  const setCharacter = useStore((s) => s.setCharacter);
  const applyState = useStore((s) => s.applyState);
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const showToast = useStore((s) => s.showToast);
  const [tab, setTab] = useState<'equipped' | 'storage'>('equipped');
  const [open, setOpen] = useState<InventoryEntry | undefined>();
  const [pickFor, setPickFor] = useState<SlotId | 'any' | undefined>();
  const [creating, setCreating] = useState<Ability | undefined>();
  const [editingRules, setEditingRules] = useState<Ability | undefined>();
  const [viewRules, setViewRules] = useState<Ability | undefined>();
  const cap = useMemo(() => (ctx ? slotCapacity(ctx) : undefined), [ctx]);
  if (!ctx || !cap) return <div className="p-4 text-zinc-500">No character.</div>;
  const c = ctx.character;

  const doEquip = (e: InventoryEntry) => {
    const r = equipItem(ctx, e.id);
    if (!r.ok) {
      if (confirm(`${r.reason}. Replace what is there?`)) { const r2 = equipItem(ctx, e.id, { replace: true }); applyState(r2); showToast(`${entryName(ctx, e)} equipped`); }
      return;
    }
    applyState(r); showToast(`${entryName(ctx, e)} equipped`);
  };
  const doUnequip = (e: InventoryEntry) => { const r = unequipItem(ctx, e.id); applyState(r); showToast(`${entryName(ctx, e)} unequipped`); };
  const saveNew = (a: Ability) => {
    setLibrary({ ...library, abilities: { ...library.abilities, [a.id]: a } });
    setCharacter(addItemInstance(c, a.id));
    setCreating(undefined); showToast(`${a.name} added`);
  };
  const saveRules = (a: Ability) => {
    const rest = { ...library.abilities }; if (editingRules && a.id !== editingRules.id) delete rest[editingRules.id];
    setLibrary({ ...library, abilities: { ...rest, [a.id]: a } });
    if (editingRules && a.id !== editingRules.id) setCharacter({ ...c, inventory: c.inventory.map((i) => (i.abilityId === editingRules.id ? { ...i, abilityId: a.id } : i)), abilities: c.abilities.map((x) => (x.abilityId === editingRules.id ? { ...x, abilityId: a.id } : x)) });
    setEditingRules(undefined); showToast('Saved');
  };

  const storage = [...c.inventory].sort((a, b) => entryName(ctx, a).localeCompare(entryName(ctx, b)));
  const byCat = CATEGORIES.map((cat) => ({ cat, items: storage.filter((i) => entryCategory(ctx, i) === cat) })).filter((g) => g.items.length);
  const carried = c.inventory.filter((i) => slotOf(itemAbility(ctx, i)) === 'none');

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-1"><Button size="sm" onClick={() => setPickFor('any')}>From library</Button><Button size="sm" variant="primary" onClick={() => setCreating(freshRecord('item'))}>+ New item</Button></div>
      </div>
      <div className="mb-3 flex gap-1 rounded-xl bg-zinc-900 p-1">
        {(['equipped', 'storage'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx('flex-1 rounded-lg py-1.5 text-sm', tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>{t === 'equipped' ? 'Equipped' : `All items (${c.inventory.length})`}</button>)}
      </div>

      {tab === 'equipped' ? (
        <div className="space-y-1">
          {SLOTS.map((s) => {
            const occ = slotOccupants(ctx, s.id);
            const n = cap[s.id];
            const held = s.id === 'offHand' ? twoHandedInMainHand(ctx) : undefined;
            return Array.from({ length: n }, (_, idx) => {
              const e = occ.find((o) => (o.slotIndex ?? 0) === idx) ?? occ[idx];
              if (!e && held && idx === 0) return (
                <div key={`${s.id}-${idx}`} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900/60 px-3 py-2 text-zinc-500">
                  <div className="w-24 shrink-0 text-xs uppercase tracking-wide">{s.label}</div>
                  <span className="min-w-0 flex-1 truncate italic">{entryName(ctx, held)} (two-handed)</span>
                </div>
              );
              return (
                <div key={`${s.id}-${idx}`} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2">
                  <div className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">{s.label}{n > 1 ? ` ${idx + 1}` : ''}</div>
                  {e ? (
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(e)}><ItemName abilityId={e.abilityId} name={entryName(ctx, e)} />{itemAbility(ctx, e)?.scripts.length ? <span className="ml-1 text-amber-400">✦</span> : null}</button>
                  ) : (
                    <button type="button" className="min-w-0 flex-1 text-left text-zinc-600" onClick={() => setPickFor(s.id)}>— empty —</button>
                  )}
                  {e ? <Button size="sm" variant="ghost" onClick={() => doUnequip(e)}>Unequip</Button> : <Button size="sm" variant="ghost" onClick={() => setPickFor(s.id)}>Equip…</Button>}
                </div>
              );
            });
          })}
          {carried.length > 0 && (
            <div className="pt-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Carried, no slot (active when carried)</div>
              {carried.map((e) => (
                <div key={e.id} className="mb-1 flex items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(e)}>{e.equipped ? '✓ ' : ''}{entryName(ctx, e)}</button>
                  <Button size="sm" variant="ghost" onClick={() => (e.equipped ? doUnequip(e) : doEquip(e))}>{e.equipped ? 'Deactivate' : 'Activate'}</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {byCat.map((g) => (
            <div key={g.cat} className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{humanize(g.cat)}</div>
              <div className="space-y-1">
                {g.items.map((e) => { const a = itemAbility(ctx, e); const slot = slotOf(a); return (
                  <button key={e.id} type="button" onClick={() => setOpen(e)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-left">
                    <span className="min-w-0 flex-1 truncate"><span className={cx('mr-2', e.equipped ? 'text-emerald-400' : 'text-zinc-700')}>{e.equipped ? '✓' : '○'}</span><ItemName abilityId={e.abilityId} name={entryName(ctx, e)} />{e.quantity !== 1 ? <span className="ml-1 text-zinc-400">×{e.quantity}</span> : null}{a?.scripts.length ? <span className="ml-1 text-amber-400">✦</span> : null}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{slot && slot !== 'none' ? SLOTS.find((s) => s.id === slot)?.label : slot === 'none' ? 'no slot' : ''}</span>
                  </button>
                ); })}
              </div>
            </div>
          ))}
          {c.inventory.length === 0 && <p className="text-sm text-zinc-500">No items yet.</p>}
        </div>
      )}

      {/* item instance sheet */}
      {open && (() => { const e = c.inventory.find((i) => i.id === open.id); if (!e) return null; const a = itemAbility(ctx, e); const slot = slotOf(a); return (
        <Sheet open onClose={() => setOpen(undefined)} title={entryName(ctx, e)}>
          <div className="mb-2 text-xs text-zinc-500">{humanize(entryCategory(ctx, e))}{slot ? ` · ${slot === 'none' ? 'no slot' : SLOTS.find((s) => s.id === slot)?.label}` : ' · not equippable'}{a?.kind === 'item' && a.item.weight !== undefined ? ` · ${a.item.weight} lb` : ''}{a?.kind === 'item' && a.item.price ? ` · ${a.item.price}` : ''}</div>
          {a?.text && <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-300">{a.text}</p>}
          {a?.todo && <p className="mb-3 rounded-xl border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">⚑ {a.todo}</p>}
          <div className="mb-3 flex flex-wrap gap-2">
            {slot && (e.equipped ? <Button variant="ghost" onClick={() => doUnequip(e)}>{slot === 'none' ? 'Deactivate' : 'Unequip'}</Button> : <Button variant="primary" onClick={() => doEquip(e)}>{slot === 'none' ? 'Activate' : 'Equip'}</Button>)}
            {a && (a.scripts.length > 0 || activationsOf(a).length > 0) && <Button onClick={() => setViewRules(a)}>Rules & charges</Button>}
            {a && <Button onClick={() => setEditingRules(a)}>Edit item</Button>}
          </div>
          <Field label="Quantity"><input className={inputCls + ' w-24'} inputMode="numeric" value={e.quantity} onChange={(ev) => setCharacter({ ...c, inventory: c.inventory.map((i) => (i.id === e.id ? { ...i, quantity: Number(ev.target.value) || 0 } : i)) })} /></Field>
          <Field label="Notes (this copy)"><textarea className={inputCls} value={e.notes ?? ''} onChange={(ev) => setCharacter({ ...c, inventory: c.inventory.map((i) => (i.id === e.id ? { ...i, notes: ev.target.value || undefined } : i)) })} /></Field>
          <Button variant="danger" onClick={() => { if (confirm(`Remove ${entryName(ctx, e)} from ${c.name}? (stays in the library)`)) { const r = removeItemInstance(ctx, e.id); applyState(r); setOpen(undefined); } }}>Remove from character</Button>
        </Sheet>
      ); })()}

      {/* pick from library / storage for a slot */}
      {pickFor && <PickSheet ctx={ctx} slot={pickFor} onClose={() => setPickFor(undefined)} onEquipExisting={(e) => { doEquip(e); setPickFor(undefined); }} onAddFromLibrary={(a, equip) => { const next = addItemInstance(c, a.id); if (equip) { applyState(equipItem({ ...ctx, character: next }, next.inventory.at(-1)!.id, { replace: true })); } else { applyState({ character: next }); } showToast(`${a.name} added`); setPickFor(undefined); }} onCreate={() => { setPickFor(undefined); setCreating(freshRecord('item', { category: pickFor === 'any' ? 'gear' : 'wondrous', ...(pickFor !== 'any' ? { slot: pickFor } : {}) })); }} />}

      <Sheet open={!!creating} onClose={() => setCreating(undefined)} title="New item" tall>
        {creating && <RecordEditor key={creating.id} initial={creating} onSave={saveNew} onCancel={() => setCreating(undefined)} />}
      </Sheet>
      <Sheet open={!!editingRules} onClose={() => setEditingRules(undefined)} title={editingRules?.name} tall>
        {editingRules && <RecordEditor key={editingRules.id} initial={editingRules} onSave={saveRules} onCancel={() => setEditingRules(undefined)} />}
      </Sheet>
      {viewRules && <AbilitySheet ctx={ctx} ability={viewRules} onClose={() => setViewRules(undefined)} />}
    </div>
  );
}

function PickSheet({ ctx, slot, onClose, onEquipExisting, onAddFromLibrary, onCreate }: { ctx: EvalContext; slot: SlotId | 'any'; onClose: () => void; onEquipExisting: (e: InventoryEntry) => void; onAddFromLibrary: (a: Ability, equip: boolean) => void; onCreate: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ItemCategory | undefined>();
  const fits = (a: Ability | undefined) => !!a && (slot === 'any' || slotOf(a) === slot);
  const owned = ctx.character.inventory.filter((e) => !e.equipped && fits(itemAbility(ctx, e)) && (!q || entryName(ctx, e).toLowerCase().includes(q.toLowerCase())));
  const ownedIds = new Set(ctx.character.inventory.map((e) => e.abilityId));
  const libraryItems = Object.values(ctx.library.abilities).filter((a): a is Item => a.kind === 'item' && fits(a) && (!cat || a.item.category === cat) && (!q || a.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const label = slot === 'any' ? 'Add item' : `Equip: ${SLOTS.find((s) => s.id === slot)?.label}`;
  return (
    <Sheet open onClose={onClose} title={label} tall>
      <input className={inputCls + ' mb-2'} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {slot !== 'any' && (
        <Field label="From your items">
          {owned.length === 0 && <div className="text-sm text-zinc-500">Nothing in storage fits this slot.</div>}
          <div className="space-y-1">{owned.map((e) => <button key={e.id} type="button" onClick={() => onEquipExisting(e)} className="flex w-full items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-left"><span>{entryName(ctx, e)}</span><span className="text-xs text-amber-300">Equip</span></button>)}</div>
        </Field>
      )}
      <Field label="From the library">
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1"><Chip active={!cat} onClick={() => setCat(undefined)}>all</Chip>{CATEGORIES.map((k) => <Chip key={k} active={cat === k} onClick={() => setCat(cat === k ? undefined : k)}>{humanize(k)}</Chip>)}</div>
        <div className="max-h-[40vh] space-y-1 overflow-y-auto">
          {libraryItems.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2">
              <div className="min-w-0"><div className="truncate">{a.name}{ownedIds.has(a.id) ? <span className="ml-1 text-xs text-zinc-500">(owned)</span> : null}</div><div className="text-xs text-zinc-500">{humanize(a.item.category)}{a.item.slot ? ` · ${a.item.slot === 'none' ? 'no slot' : SLOTS.find((s) => s.id === a.item.slot)?.label}` : ''}</div></div>
              <div className="flex gap-1"><Button size="sm" onClick={() => onAddFromLibrary(a, false)}>Add</Button>{slot !== 'any' && <Button size="sm" variant="primary" onClick={() => onAddFromLibrary(a, true)}>Add & equip</Button>}</div>
            </div>
          ))}
          {libraryItems.length === 0 && <div className="text-sm text-zinc-500">No library items match.</div>}
        </div>
      </Field>
      <Button className="w-full" onClick={onCreate}>+ Create a new item</Button>
    </Sheet>
  );
}
