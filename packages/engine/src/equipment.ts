import type { EvalContext } from './context';
import { newId } from './ids';
import { computePass } from './scripts/compute';
import { applyPatches, runEventScripts } from './scripts/events';
import { SLOT_IDS, type Ability, type Battle, type Character, type SlotId, type VarValue } from './schema';

export const SLOTS: { id: SlotId; label: string; base: number }[] = [
  { id: 'mainHand', label: 'Main hand', base: 1 }, { id: 'offHand', label: 'Off hand', base: 1 }, { id: 'buckler', label: 'Buckler', base: 1 }, { id: 'quiver', label: 'Quiver', base: 1 },
  { id: 'armor', label: 'Armor', base: 1 }, { id: 'head', label: 'Head', base: 1 }, { id: 'eyes', label: 'Eyes', base: 1 }, { id: 'neck', label: 'Neck', base: 1 }, { id: 'shoulders', label: 'Shoulders', base: 1 },
  { id: 'torso', label: 'Torso', base: 1 }, { id: 'arms', label: 'Arms', base: 1 }, { id: 'hands', label: 'Hands', base: 1 }, { id: 'ring', label: 'Ring', base: 2 }, { id: 'waist', label: 'Waist', base: 1 }, { id: 'feet', label: 'Feet', base: 1 },
];

export type InventoryEntry = Character['inventory'][number];

/** Body slot an item occupies; undefined = not equippable (materials, potions); 'none' = active while carried. */
export function slotOf(ability: Ability | undefined): SlotId | 'none' | undefined {
  return ability && ability.kind === 'item' ? ability.item.slot : undefined;
}

export function itemAbility(ctx: EvalContext, entry: InventoryEntry): Ability | undefined {
  return entry.abilityId ? ctx.library.abilities[entry.abilityId] : undefined;
}

/** Slot capacities: base counts plus `slot()` calls from every active script. */
export function slotCapacity(ctx: EvalContext): Record<SlotId, number> {
  const cap = Object.fromEntries(SLOTS.map((s) => [s.id, s.base])) as Record<SlotId, number>;
  for (const [id, n] of Object.entries(computePass(ctx).slots)) cap[id as SlotId] += n ?? 0;
  return cap;
}

/** Equipped entries occupying a slot, ordered by slotIndex. */
export function slotOccupants(ctx: EvalContext, slot: SlotId): InventoryEntry[] {
  return ctx.character.inventory.filter((i) => i.equipped && slotOf(itemAbility(ctx, i)) === slot).sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
}

function setAbilityEnabled(c: Character, abilityId: string | undefined, enabled: boolean): Character {
  if (!abilityId) return c;
  const has = c.abilities.some((a) => a.abilityId === abilityId);
  return { ...c, abilities: has ? c.abilities.map((a) => (a.abilityId === abilityId ? { ...a, enabled } : a)) : [...c.abilities, { abilityId, enabled, paramValues: {} }] };
}

/** The equipped main-hand entry whose weapon is two-handed, if any: it occupies the off hand too. */
export function twoHandedInMainHand(ctx: EvalContext): InventoryEntry | undefined {
  return ctx.character.inventory.find((i) => { const a = itemAbility(ctx, i); return i.equipped && a?.kind === 'item' && a.item.slot === 'mainHand' && !!a.item.weapon?.twoHanded; });
}

export type EquipResult = { ok: boolean; reason?: string; character: Character; battle?: Battle; globals?: Record<string, VarValue> };

/**
 * Run the item's `equip` / `unequip` scripts. They queue patches, and patches land on a battle, so
 * without one in the context the scripts are skipped entirely (documented limitation: gear changes
 * outside combat do not fire them). `globals` is threaded in, not re-read from the library, so a
 * swap (unequip A, equip B) accumulates both scripts' `setVar` writes.
 */
function runItemEvent(ctx: EvalContext, character: Character, battle: Battle | undefined, kind: 'equip' | 'unequip', abilityId: string | undefined, globals: Record<string, VarValue> = ctx.library.globals ?? {}): { character: Character; battle?: Battle; globals?: Record<string, VarValue> } {
  const ability = abilityId ? ctx.library.abilities[abilityId] : undefined;
  if (!ability || !battle) return { character };
  const ectx: EvalContext = { ...ctx, character, battle, library: { ...ctx.library, globals } };
  const r = runEventScripts(ectx, { kind, abilityId: ability.id }, { only: { abilityId: ability.id } });
  if (!r.patches.length) return { character, battle };
  const st = applyPatches(ectx, { battle, character, globals }, r.patches, ability);
  return { character: st.character, battle: st.battle, globals: st.globals };
}

export function unequipItem(ctx: EvalContext, itemId: string, carried?: Record<string, VarValue>): EquipResult {
  const entry = ctx.character.inventory.find((i) => i.id === itemId);
  if (!entry) return { ok: false, reason: 'No such item', character: ctx.character };
  // While the item is still equipped, so its scripts are still an active source.
  const ev = runItemEvent(ctx, ctx.character, ctx.battle, 'unequip', entry.abilityId, carried ?? ctx.library.globals ?? {});
  let c: Character = { ...ev.character, inventory: ev.character.inventory.map((i) => (i.id === itemId ? { ...i, equipped: false, slotIndex: undefined } : i)) };
  c = setAbilityEnabled(c, entry.abilityId, false);
  return { ok: true, character: c, ...(ev.battle ? { battle: ev.battle } : {}), ...(ev.globals ? { globals: ev.globals } : {}) };
}

/** Equip into the item's slot. Fails when the slot is full unless replace (then the highest-index occupant is unequipped). */
export function equipItem(ctx: EvalContext, itemId: string, opts: { replace?: boolean } = {}): EquipResult {
  const entry = ctx.character.inventory.find((i) => i.id === itemId);
  if (!entry) return { ok: false, reason: 'No such item', character: ctx.character };
  const ability = itemAbility(ctx, entry);
  const slot = slotOf(ability);
  let c = ctx.character;
  let battle = ctx.battle;
  const globals0: Record<string, VarValue> = ctx.library.globals ?? {};
  let globals = globals0;
  /** Take an item off, carrying its `unequip` scripts' effects along. */
  const takeOff = (id: string) => {
    const r = unequipItem({ ...ctx, character: c, ...(battle ? { battle } : {}) }, id, globals);
    c = r.character;
    if (r.battle) battle = r.battle;
    if (r.globals) globals = r.globals;
  };
  let slotIndex: number | undefined;
  const twoHanded = ability?.kind === 'item' && !!ability.item.weapon?.twoHanded;
  if (slot === 'mainHand' && twoHanded) {
    const off = slotOccupants(ctx, 'offHand').filter((o) => o.id !== itemId);
    if (off.length) {
      if (!opts.replace) return { ok: false, reason: `Off hand holds ${off.map((o) => itemAbility(ctx, o)?.name ?? o.name ?? 'an item').join(', ')}; a two-handed weapon needs both hands`, character: c };
      for (const o of off) takeOff(o.id);
    }
  }
  if (slot === 'offHand') {
    const held = twoHandedInMainHand(ctx);
    if (held && held.id !== itemId) {
      if (!opts.replace) return { ok: false, reason: `Both hands hold ${itemAbility(ctx, held)?.name ?? 'a two-handed weapon'}`, character: c };
      takeOff(held.id);
    }
  }
  if (slot && slot !== 'none') {
    const cap = slotCapacity({ ...ctx, character: c })[slot];
    const occupants = slotOccupants({ ...ctx, character: c }, slot).filter((o) => o.id !== itemId);
    if (occupants.length >= cap) {
      if (!opts.replace) return { ok: false, reason: `${SLOTS.find((s) => s.id === slot)?.label ?? slot} slot is full`, character: c };
      takeOff(occupants[occupants.length - 1]!.id);
    }
    const used = new Set(c.inventory.filter((i) => i.equipped && i.id !== itemId && slotOf(itemAbility(ctx, i)) === slot).map((i) => i.slotIndex ?? 0));
    slotIndex = 0;
    while (used.has(slotIndex)) slotIndex++;
  }
  c = { ...c, inventory: c.inventory.map((i) => (i.id === itemId ? { ...i, equipped: true, ...(slotIndex !== undefined ? { slotIndex } : { slotIndex: undefined }) } : i)) };
  c = setAbilityEnabled(c, entry.abilityId, true);
  // After enabling, so the item's own scripts are an active source when its `equip` scripts run.
  const ev = runItemEvent({ ...ctx, ...(battle ? { battle } : {}) }, c, battle, 'equip', entry.abilityId, globals);
  c = ev.character;
  if (ev.battle) battle = ev.battle;
  if (ev.globals) globals = ev.globals;
  return { ok: true, character: c, ...(battle && battle !== ctx.battle ? { battle } : {}), ...(globals !== globals0 ? { globals } : {}) };
}

/** Add an instance of a library item to the character. */
export function addItemInstance(character: Character, abilityId: string, opts: { quantity?: number; notes?: string } = {}): Character {
  return { ...character, inventory: [...character.inventory, { id: newId('item'), abilityId, quantity: opts.quantity ?? 1, equipped: false, ...(opts.notes ? { notes: opts.notes } : {}) }] };
}

/** Unequip (running the item's `unequip` scripts) and drop the entry; the scripts' battle and globals come back too. */
export function removeItemInstance(ctx: EvalContext, itemId: string): EquipResult {
  const r = unequipItem(ctx, itemId);
  const c = r.character;
  return { ...r, character: { ...c, inventory: c.inventory.filter((i) => i.id !== itemId) } };
}

export { SLOT_IDS };
