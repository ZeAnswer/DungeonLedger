import type { EvalContext } from './context';
import { newId } from './ids';
import { activeSources } from './resolve';
import { SLOT_IDS, type Ability, type Character, type SlotId } from './schema';

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

/** Slot capacities: base counts plus extraSlot effects from everything currently active. */
export function slotCapacity(ctx: EvalContext): Record<SlotId, number> {
  const cap = Object.fromEntries(SLOTS.map((s) => [s.id, s.base])) as Record<SlotId, number>;
  for (const src of activeSources(ctx)) for (const b of src.blocks) if (b.trigger === 'always') for (const e of b.do) if (e.verb === 'slot') cap[e.slot] += e.count;
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

export type EquipResult = { ok: boolean; reason?: string; character: Character };

export function unequipItem(ctx: EvalContext, itemId: string): EquipResult {
  const entry = ctx.character.inventory.find((i) => i.id === itemId);
  if (!entry) return { ok: false, reason: 'No such item', character: ctx.character };
  let c: Character = { ...ctx.character, inventory: ctx.character.inventory.map((i) => (i.id === itemId ? { ...i, equipped: false, slotIndex: undefined } : i)) };
  c = setAbilityEnabled(c, entry.abilityId, false);
  return { ok: true, character: c };
}

/** Equip into the item's slot. Fails when the slot is full unless replace (then the highest-index occupant is unequipped). */
export function equipItem(ctx: EvalContext, itemId: string, opts: { replace?: boolean } = {}): EquipResult {
  const entry = ctx.character.inventory.find((i) => i.id === itemId);
  if (!entry) return { ok: false, reason: 'No such item', character: ctx.character };
  const ability = itemAbility(ctx, entry);
  const slot = slotOf(ability);
  let c = ctx.character;
  let slotIndex: number | undefined;
  if (slot && slot !== 'none') {
    const cap = slotCapacity(ctx)[slot];
    const occupants = slotOccupants(ctx, slot).filter((o) => o.id !== itemId);
    if (occupants.length >= cap) {
      if (!opts.replace) return { ok: false, reason: `${SLOTS.find((s) => s.id === slot)?.label ?? slot} slot is full`, character: c };
      const out = occupants[occupants.length - 1]!;
      c = unequipItem({ ...ctx, character: c }, out.id).character;
    }
    const used = new Set(c.inventory.filter((i) => i.equipped && i.id !== itemId && slotOf(itemAbility(ctx, i)) === slot).map((i) => i.slotIndex ?? 0));
    slotIndex = 0;
    while (used.has(slotIndex)) slotIndex++;
  }
  c = { ...c, inventory: c.inventory.map((i) => (i.id === itemId ? { ...i, equipped: true, ...(slotIndex !== undefined ? { slotIndex } : { slotIndex: undefined }) } : i)) };
  c = setAbilityEnabled(c, entry.abilityId, true);
  return { ok: true, character: c };
}

/** Add an instance of a library item to the character. */
export function addItemInstance(character: Character, abilityId: string, opts: { quantity?: number; notes?: string } = {}): Character {
  return { ...character, inventory: [...character.inventory, { id: newId('item'), abilityId, quantity: opts.quantity ?? 1, equipped: false, ...(opts.notes ? { notes: opts.notes } : {}) }] };
}

export function removeItemInstance(ctx: EvalContext, itemId: string): Character {
  const c = unequipItem(ctx, itemId).character;
  return { ...c, inventory: c.inventory.filter((i) => i.id !== itemId) };
}

export { SLOT_IDS };
