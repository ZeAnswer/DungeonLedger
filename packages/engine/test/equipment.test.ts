import { equipItem, unequipItem, slotCapacity, slotOf, SLOTS } from '../src/equipment';
import { makeCtx, makeCharacter, makeAbility } from './fixtures';
import type { Ability } from '../src/schema';

const ring1 = makeAbility({ id: 'ring-a', source: 'item', item: { category: 'wondrous', slot: 'ring' }, effects: [{ id: 'e', do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'deflection' }] }] });
const ring2 = makeAbility({ id: 'ring-b', source: 'item', item: { category: 'wondrous', slot: 'ring' } });
const ring3 = makeAbility({ id: 'ring-c', source: 'item', item: { category: 'wondrous', slot: 'ring' } });
const handOfGlory = makeAbility({ id: 'hog', source: 'item', item: { category: 'wondrous', slot: 'neck' }, effects: [{ id: 's', do: [{ kind: 'extraSlot', slot: 'ring', count: 1 }] }] });
const bracersA = makeAbility({ id: 'bracers-a', source: 'item', item: { category: 'wondrous', slot: 'arms' } });
const bracersB = makeAbility({ id: 'bracers-b', source: 'item', item: { category: 'wondrous', slot: 'arms' } });
const potion = makeAbility({ id: 'potion', source: 'item', item: { category: 'potion' } });
const manual = makeAbility({ id: 'manual', source: 'item', item: { category: 'wondrous', slot: 'none' } });

function ctxWith(items: Ability[], inventory: { id: string; abilityId: string; equipped?: boolean }[]) {
  const c = makeCtx({ character: makeCharacter({ inventory: inventory.map((i) => ({ ...i, quantity: 1, equipped: i.equipped ?? false })) }) });
  for (const a of items) c.library.abilities[a.id] = a;
  return c;
}

test('slot list and lookups', () => {
  expect(SLOTS.map((s) => s.id)).toContain('mainHand');
  expect(slotOf(ring1)).toBe('ring');
  expect(slotOf(potion)).toBeUndefined();
});

test('equipping fills the slot and enables the rules; ring has two slots', () => {
  let ctx = ctxWith([ring1, ring2, ring3], [{ id: 'i1', abilityId: 'ring-a' }, { id: 'i2', abilityId: 'ring-b' }, { id: 'i3', abilityId: 'ring-c' }]);
  let r = equipItem(ctx, 'i1');
  expect(r.ok).toBe(true);
  ctx = { ...ctx, character: r.character };
  expect(ctx.character.inventory[0]).toMatchObject({ equipped: true, slotIndex: 0 });
  expect(ctx.character.abilities.find((a) => a.abilityId === 'ring-a')?.enabled).toBe(true);
  r = equipItem(ctx, 'i2'); ctx = { ...ctx, character: r.character };
  expect(ctx.character.inventory[1]).toMatchObject({ equipped: true, slotIndex: 1 });
  r = equipItem(ctx, 'i3');
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/ring.*full/i);
});

test('replace: equipping into a full single slot swaps the old item out', () => {
  let ctx = ctxWith([bracersA, bracersB], [{ id: 'a', abilityId: 'bracers-a', equipped: true }, { id: 'b', abilityId: 'bracers-b' }]);
  const r = equipItem(ctx, 'b', { replace: true });
  ctx = { ...ctx, character: r.character };
  expect(ctx.character.inventory.map((i) => i.equipped)).toEqual([false, true]);
});

test('an extraSlot effect from an equipped item raises capacity', () => {
  let ctx = ctxWith([ring1, ring2, ring3, handOfGlory], [{ id: 'i1', abilityId: 'ring-a', equipped: true }, { id: 'i2', abilityId: 'ring-b', equipped: true }, { id: 'i3', abilityId: 'ring-c' }, { id: 'h', abilityId: 'hog' }]);
  ctx.character.abilities = [{ abilityId: 'ring-a', enabled: true, paramValues: {} }, { abilityId: 'ring-b', enabled: true, paramValues: {} }];
  expect(slotCapacity(ctx).ring).toBe(2);
  ctx = { ...ctx, character: equipItem(ctx, 'h').character };
  expect(slotCapacity(ctx).ring).toBe(3);
  expect(equipItem(ctx, 'i3').ok).toBe(true);
});

test('slotless items (potions, manuals) toggle "carried/active" without a slot; unequip disables rules', () => {
  let ctx = ctxWith([manual, ring1], [{ id: 'm', abilityId: 'manual' }, { id: 'i1', abilityId: 'ring-a', equipped: true }]);
  ctx.character.abilities = [{ abilityId: 'ring-a', enabled: true, paramValues: {} }];
  ctx = { ...ctx, character: equipItem(ctx, 'm').character };
  expect(ctx.character.inventory[0]!.equipped).toBe(true);
  ctx = { ...ctx, character: unequipItem(ctx, 'i1').character };
  expect(ctx.character.abilities.find((a) => a.abilityId === 'ring-a')?.enabled).toBe(false);
});

import { AbilitySchema as AS2 } from '../src/schema';
import { equipItem as equip2, unequipItem as unequip2, twoHandedInMainHand } from '../src/equipment';
import { makeCharacter as mkChar2, makeCtx as mkCtx2 } from './fixtures';

function handsCtx() {
  const bow = AS2.parse({ id: 'bow2h', name: 'Longbow', kind: 'item', item: { category: 'weapon', slot: 'mainHand', weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex', twoHanded: true } } });
  const sword = AS2.parse({ id: 'sword1h', name: 'Shortsword', kind: 'item', item: { category: 'weapon', slot: 'mainHand', weapon: { kind: 'melee', dice: '1d6', attackAbility: 'str' } } });
  const shield = AS2.parse({ id: 'shield', name: 'Heavy Shield', kind: 'item', item: { category: 'shield', slot: 'offHand' } });
  const c = mkCtx2({ character: mkChar2({ attackProfiles: [], inventory: [{ id: 'i-bow', abilityId: 'bow2h', quantity: 1, equipped: false }, { id: 'i-shield', abilityId: 'shield', quantity: 1, equipped: false }, { id: 'i-sword', abilityId: 'sword1h', quantity: 1, equipped: false }] }) });
  for (const a of [bow, sword, shield]) c.library.abilities[a.id] = a;
  return c;
}

test('a two-handed weapon needs a free off hand and blocks the off hand while held', () => {
  let c = handsCtx();
  c = { ...c, character: equip2(c, 'i-shield').character };
  const r = equip2(c, 'i-bow');
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/off hand/i);
  c = { ...c, character: equip2(c, 'i-bow', { replace: true }).character };
  expect(c.character.inventory.find((i) => i.id === 'i-shield')!.equipped).toBe(false);
  expect(twoHandedInMainHand(c)?.id).toBe('i-bow');
  const r2 = equip2(c, 'i-shield');
  expect(r2.ok).toBe(false);
  expect(r2.reason).toMatch(/both hands/i);
  c = { ...c, character: equip2(c, 'i-shield', { replace: true }).character };
  expect(c.character.inventory.find((i) => i.id === 'i-bow')!.equipped).toBe(false);
  expect(twoHandedInMainHand(c)).toBeUndefined();
  c = { ...c, character: unequip2(c, 'i-shield').character };
  c = { ...c, character: equip2(c, 'i-sword').character };
  expect(equip2(c, 'i-shield').ok).toBe(true);
});
