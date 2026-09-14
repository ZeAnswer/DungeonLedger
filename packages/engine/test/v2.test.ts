import { resolveAttack, attackProfiles, availableActions, resolveStat, resolveFlags } from '../src/resolve';
import { evalCondition } from '../src/conditions';
import { nextRound, useAbility, logEnemyAction, setDistance } from '../src/battle';
import { makeCtx, makeCharacter, makeAbility, makeBattle, makeCombatant } from './fixtures';
import type { Ability } from '../src/schema';

const bow = makeAbility({ id: 'bow', name: 'Strong-Arm Longbow +1', origin: 'item', item: { category: 'weapon', slot: 'mainHand', tags: ['bow', 'longbow'], weapon: { kind: 'ranged', dice: '1d8', critMult: 3, rangeIncrement: 110, attackAbility: 'dex', damageAbility: 'str', maxDamageAbilityBonus: 4, enhancement: 1 } } });
const weaponFocus = makeAbility({ id: 'wf-longbow', name: 'Weapon Focus (longbow)', origin: 'feat', effects: [{ id: 'e', when: { is: 'attack.weapon.tag.longbow' }, do: [{ verb: 'modify', to: 'attack', value: 1 }] }] });
const flaming = makeAbility({ id: 'flaming-bow', name: 'Flaming', origin: 'item', binding: 'thisWeapon', item: { category: 'weapon', slot: 'mainHand', weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex' } }, effects: [{ id: 'f', do: [{ verb: 'dice', dice: '1d6', damageType: 'fire' }] }] });
const pbs = makeAbility({ id: 'pbs', name: 'Point Blank Shot', origin: 'feat', effects: [{ id: 'e', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { compare: 'target.distance', op: '<=', value: 30 }] }, do: [{ verb: 'modify', to: 'attack', value: 1 }, { verb: 'modify', to: 'damage', value: 1 }] }] });
const boots = makeAbility({
  id: 'boots', name: 'Boots of Speed', origin: 'item', activation: { action: 'free' }, duration: 'endOfRound', item: { category: 'wondrous', slot: 'feet' },
  resources: [{ id: 'boots-rounds', label: 'Haste rounds', max: 10, resetOn: 'day' }], cost: [{ kind: 'charge', resourceId: 'boots-rounds' }],
  effects: [{ id: 'haste', do: [{ verb: 'attack', extraAttacks: 1, appliesToBase: 'full' }, { verb: 'modify', to: 'attack', value: 1, type: 'dodge' }] }],
});
// v3 directly: makeAbility has no sibling lookup, so the granted spells become explicit activations here.
const hog = makeAbility({
  id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' },
  effects: [{ id: 's', do: [{ verb: 'slot', slot: 'ring' }] }],
  activations: [{ id: 'hog-daylight', spell: 'hog-daylight', charges: { max: 1 } }, { id: 'hog-see-invis', spell: 'hog-see-invis', charges: { max: 1 } }],
});
const daylight = makeAbility({ id: 'hog-daylight', name: 'Daylight', kind: 'spell' });
const seeInvis = makeAbility({ id: 'hog-see-invis', name: 'See Invisibility', kind: 'spell' });
const horror = makeAbility({ id: 'horror', name: 'Monster Horror', origin: 'classFeature', effects: [{ id: 'h', when: { in: 'target.tags', param: 'types' }, do: [{ verb: 'modify', to: 'attack', value: 'max(2, 2 * sel(self.equipped.count.tag.trophy-aberration))' }] }] });
const gloves = makeAbility({ id: 'gloves', name: 'Chuul gloves', origin: 'item', item: { category: 'trophy', slot: 'hands', tags: ['trophy-aberration'] } });
const rage = makeAbility({ id: 'rage', name: 'Rage', origin: 'buff', duration: { rounds: 5 }, effects: [{ id: 'r', do: [{ verb: 'modify', to: 'ability.str', value: 4, type: 'morale' }] }] });
const helm = makeAbility({ id: 'helm', name: 'Minotaur helm', origin: 'item', activation: { action: 'free' }, item: { category: 'trophy', slot: 'head' }, resources: [{ id: 'helm-rage', max: 1, resetOn: 'day' }], effects: [{ id: 'nf', do: [{ verb: 'flag', flag: 'neverFlatFooted' }] }, { id: 'use', trigger: 'onUse', do: [{ verb: 'grant', ability: 'rage' }] }] });
const potion = makeAbility({ id: 'potion-cmw', name: 'Potion of CMW', origin: 'item', activation: { action: 'standard' }, item: { category: 'potion' }, cost: [{ kind: 'item', abilityId: 'potion-cmw' }], effects: [{ id: 'h', trigger: 'onUse', do: [{ verb: 'hp', op: 'heal', amount: 10 }] }] });
const revenge = makeAbility({ id: 'revenge', name: 'Revenge', origin: 'feat', effects: [{ id: 'r', when: { history: { event: 'hit', by: 'target', vs: 'current', scope: 'lastRound' } }, do: [{ verb: 'modify', to: 'attack', value: 2 }] }] });

function ctxWith(abilities: Ability[], opts: { equipped?: string[]; params?: Record<string, Record<string, string[]>> } = {}) {
  const equipped = new Set(opts.equipped ?? []);
  const items = abilities.filter((a) => a.kind === 'item');
  const c = makeCtx({
    character: makeCharacter({
      hp: { max: 44, current: 20, temp: 0, nonlethal: 0 },
      attackProfiles: [],
      abilities: abilities.filter((a) => a.kind !== 'status' && a.kind !== 'spell').map((a) => ({ abilityId: a.id, enabled: a.kind !== 'item' || equipped.has(a.id), paramValues: opts.params?.[a.id] ?? {} })),
      inventory: items.map((a) => ({ id: `i-${a.id}`, abilityId: a.id, quantity: 1, equipped: equipped.has(a.id) })),
    }),
    battle: makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration'], distanceFeet: 20 })] }),
  });
  for (const a of abilities) c.library.abilities[a.id] = a;
  c.target = c.battle!.combatants[0];
  return c;
}

test('equipped weapon items provide attack profiles; weapon tags drive Weapon Focus; thisWeapon binding scopes dice', () => {
  const c = ctxWith([bow, weaponFocus, flaming], { equipped: ['bow'] });
  const profiles = attackProfiles(c);
  expect(profiles.map((p) => p.id)).toEqual(['weapon:bow']);
  const r = resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' });
  expect(r.attacks[0]!.attackBonus).toBe(6 + 3 + 1 + 1); // bab, dex, enh, weapon focus
  expect(r.attacks[0]!.damage.flat).toBe(1 + 1); // enhancement + str 1 (cap 4)
  expect(r.attacks[0]!.damage.dice.map((d) => d.label)).toEqual(['Strong-Arm Longbow +1']); // flaming is bound to the other bow
  const c2 = ctxWith([bow, flaming], { equipped: ['flaming-bow'] });
  expect(resolveAttack(c2, { profileId: 'weapon:flaming-bow', modeId: 'single' }).attacks[0]!.damage.dice.some((d) => d.damageType === 'fire')).toBe(true);
});

test('distance per combatant drives range conditions', () => {
  const c = ctxWith([bow, pbs], { equipped: ['bow'] });
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(11);
  const far = { ...c, battle: setDistance(c.battle!, 'c1', 60) };
  far.target = far.battle!.combatants[0];
  const r = resolveAttack(far, { profileId: 'weapon:bow', modeId: 'single' });
  expect(r.attacks[0]!.attackBonus).toBe(10);
  expect(r.attacks[0]!.nearMiss[0]!.failed).toMatch(/distance.*at most 30/);
});

test('per-round charged ability: Use spends a charge and the effect lasts this round only', () => {
  let c = ctxWith([bow, boots], { equipped: ['bow', 'boots'] });
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'full' }).attacks.length).toBe(2);
  expect(availableActions(c).find((a) => a.abilityId === 'boots')).toMatchObject({ usable: true, active: false });
  c = { ...c, ...useAbility(c, { abilityId: 'boots' }) };
  expect(c.character.resourceState['boots-rounds']).toEqual({ used: 1 });
  expect(c.battle!.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'boots', remainingRounds: 1 })]);
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'full' }).attacks.length).toBe(3);
  expect(availableActions(c).find((a) => a.abilityId === 'boots')?.active).toBe(true);
  c = { ...c, ...nextRound(c) };
  expect(c.battle!.activeBuffs).toEqual([]); // expired: choose again this round
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'full' }).attacks.length).toBe(2);
  c.character.resourceState['boots-rounds'] = { used: 10 };
  expect(availableActions(c).find((a) => a.abilityId === 'boots')?.usable).toBe(false);
});

test('a record with several activations lists one action per activation, each with its own charges', () => {
  const c = ctxWith([hog, daylight, seeInvis], { equipped: ['hog'] });
  const actions = availableActions(c);
  expect(actions.map((a) => [a.activationId, a.abilityId])).toEqual([['hog-daylight', 'hog'], ['hog-see-invis', 'hog']]);
  const after = useAbility(c, { abilityId: 'hog', activationId: 'hog-daylight' });
  expect(after.character.resourceState).toEqual({ 'hog-daylight': { used: 1 } });
});

test('expressions can read selectors (count of equipped trophies by tag)', () => {
  const c = ctxWith([bow, horror, gloves], { equipped: ['bow', 'gloves'], params: { horror: { types: ['aberration'] } } });
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10 + 2);
});

test('flags and grant verb: never flat-footed flag; using the helm grants Rage as a buff', () => {
  const c = ctxWith([helm], { equipped: ['helm'] });
  c.library.abilities['rage'] = rage;
  expect(resolveFlags(c)).toEqual({ neverFlatFooted: true });
  const after = useAbility(c, { abilityId: 'helm' });
  expect(after.battle.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'rage', remainingRounds: 5 })]);
  const c2 = { ...c, ...after };
  expect(resolveStat(c2, 'ability.str').total).toBe(16);
});

test('item cost: drinking a potion heals and consumes one', () => {
  const c = ctxWith([potion]);
  c.character.abilities = [{ abilityId: 'potion-cmw', enabled: true, paramValues: {} }];
  const after = useAbility(c, { abilityId: 'potion-cmw' });
  expect(after.character.hp.current).toBe(30);
  expect(after.character.inventory[0]!.quantity).toBe(0);
});

test('enemy events: "it hit me" is logged, damages HP, and feeds history conditions', () => {
  let c = ctxWith([bow, revenge], { equipped: ['bow'] });
  const st = logEnemyAction(c, { actorId: 'c1', result: 'hit', damage: 5 });
  c = { ...c, ...st };
  expect(c.character.hp.current).toBe(15);
  c = { ...c, ...nextRound(c) };
  c.target = c.battle!.combatants[0];
  expect(evalCondition({ history: { event: 'hit', by: 'target', vs: 'current', scope: 'lastRound' } }, c)).toBe(true);
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(12);
});

test('set and multiply modes', () => {
  const setSpeed = makeAbility({ id: 'slow', origin: 'condition', effects: [{ id: 's', do: [{ verb: 'modify', to: 'speed', value: 20, mode: 'set' }] }] });
  const doubleSpeed = makeAbility({ id: 'dbl', origin: 'buff', effects: [{ id: 's', do: [{ verb: 'modify', to: 'speed', value: 2, mode: 'multiply' }] }] });
  const c = ctxWith([]);
  c.library.abilities['slow'] = setSpeed; c.library.abilities['dbl'] = doubleSpeed;
  c.battle!.activeBuffs.push({ instanceId: 'a', abilityId: 'slow', owner: 'self', suppressed: false }, { instanceId: 'b', abilityId: 'dbl', owner: 'self', suppressed: false });
  expect(resolveStat(c, 'speed').total).toBe(40);
});
