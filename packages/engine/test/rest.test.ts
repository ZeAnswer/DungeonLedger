import { AbilitySchema } from '../src/schema';
import { listCharges, rest, setChargesUsed } from '../src/rest';
import { makeBattle, makeCharacter, makeCtx } from './fixtures';

function ctx() {
  const blow = AbilitySchema.parse({ id: 'monster-blow', name: 'Monster Blow', kind: 'feature', activations: [{ id: 'monster-blow', charges: { max: 1 } }] });
  const wand = AbilitySchema.parse({ id: 'wand', name: 'Wand of Cure', kind: 'item', item: { category: 'wand' }, pools: [{ id: 'wand-charges', label: 'Wand charges', max: 50, resetOn: 'never' }] });
  const fury = AbilitySchema.parse({ id: 'fury', name: 'Fury', kind: 'feature', activations: [{ id: 'fury', charges: { max: 2, resetOn: 'encounter' } }] });
  const c = makeCtx({
    character: makeCharacter({ hp: { max: 44, current: 20, temp: 5, nonlethal: 9 }, abilities: ['monster-blow', 'wand', 'fury'].map((id) => ({ abilityId: id, enabled: true, paramValues: {} })), resourceState: { 'monster-blow': { used: 1 }, 'wand-charges': { used: 3 } } }),
    battle: makeBattle({ encounterResources: { fury: 2 } }),
  });
  for (const a of [blow, wand, fury]) c.library.abilities[a.id] = a;
  return c;
}

test('listCharges shows inline activation charges and pools with what is left', () => {
  expect(listCharges(ctx()).map((r) => [r.id, r.ownerName, r.remaining, r.max, r.resetOn])).toEqual([
    ['monster-blow', 'Monster Blow', 0, 1, 'day'],
    ['wand-charges', 'Wand of Cure', 47, 50, 'never'],
    ['fury', 'Fury', 0, 2, 'encounter'],
  ]);
});

test('setChargesUsed edits day pools on the character and encounter pools on the battle, clamped to 0..max', () => {
  const c = ctx();
  const a = setChargesUsed(c, 'wand-charges', 10);
  expect(a.character.resourceState['wand-charges']).toEqual({ used: 10 });
  const b = setChargesUsed(c, 'fury', 0);
  expect(b.battle!.encounterResources['fury']).toBe(0);
  expect(setChargesUsed(c, 'monster-blow', 5).character.resourceState['monster-blow']).toEqual({ used: 1 });
  expect(setChargesUsed(c, 'monster-blow', -2).character.resourceState['monster-blow']).toEqual({ used: 0 });
});

test('short rest: encounter charges refill, nonlethal heals level per hour, hp untouched', () => {
  const r = rest(ctx(), 'short');
  expect(r.battle!.encounterResources).toEqual({});
  expect(r.character.hp).toEqual({ max: 44, current: 20, temp: 5, nonlethal: 3 });
  expect(r.character.resourceState['monster-blow']).toEqual({ used: 1 });
  expect(r.character.journal.at(-1)).toMatchObject({ kind: 'rest' });
  expect(r.summary).toMatch(/encounter/i);
});

test('long rest: per-day charges refill, hp +level capped at max, temp and nonlethal cleared, never pools kept', () => {
  const r = rest(ctx(), 'long');
  expect(r.character.resourceState).toEqual({ 'wand-charges': { used: 3 } });
  expect(r.character.hp).toEqual({ max: 44, current: 26, temp: 0, nonlethal: 0 });
  expect(r.battle!.encounterResources).toEqual({});
  expect(rest({ ...ctx(), character: makeCharacter({ hp: { max: 44, current: 43, temp: 0, nonlethal: 0 } }) }, 'long').character.hp.current).toBe(44);
  expect(r.summary).toMatch(/\+6 hp/);
});
