import { resolveAttack, attackProfiles, availableActions, resolveStat, resolveFlags } from '../src/resolve';
import { nextRound, useAbility, logEnemyAction, setDistance } from '../src/battle';
import { countHistory } from '../src/history';
import { ROUND } from '../src/scripts/units';
import { makeCtx, makeCharacter, makeAbility, makeBattle, makeCombatant } from './fixtures';
import type { Ability } from '../src/schema';

const bow = makeAbility({ id: 'bow', name: 'Strong-Arm Longbow +1', kind: 'item', item: { category: 'weapon', slot: 'mainHand', tags: ['bow', 'longbow'], weapon: { kind: 'ranged', dice: '1d8', critMult: 3, rangeIncrement: 110, attackAbility: 'dex', damageAbility: 'str', maxDamageAbilityBonus: 4, enhancement: 1 } } });
const weaponFocus = makeAbility({ id: 'wf-longbow', name: 'Weapon Focus (longbow)', kind: 'feature', scripts: [{ id: 'e', source: "if (attack.weapon.is('longbow')) bonus('attack', 1)" }] });
// `binding: thisWeapon` in v3 became an explicit weapon-id check in the script.
const flaming = makeAbility({ id: 'flaming-bow', name: 'Flaming', kind: 'item', item: { category: 'weapon', slot: 'mainHand', weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex' } }, scripts: [{ id: 'f', source: "if (attack.weapon.id === 'flaming-bow') dice('1d6', 'fire')" }] });
const pbs = makeAbility({ id: 'pbs', name: 'Point Blank Shot', kind: 'feature', scripts: [{ id: 'e', source: "if (attack.isRanged && target.within(30)) { bonus('attack', 1); bonus('damage', 1); }" }] });
const boots = makeAbility({
  id: 'boots', name: 'Boots of Speed', kind: 'item', item: { category: 'wondrous', slot: 'feet' },
  pools: [{ id: 'boots-rounds', label: 'Haste rounds', max: 10, resetOn: 'day' }],
  activations: [{
    id: 'boots', action: 'free', duration: 'untilMyNextTurn', cost: [{ kind: 'charge', resourceId: 'boots-rounds' }],
    scripts: [{ id: 'haste', source: "extraAttack(1, { base: 'full' }); bonus('attack', 1, 'dodge');" }],
  }],
});
const hog = makeAbility({
  id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' },
  scripts: [{ id: 's', source: "slot('ring', 1)" }],
  activations: [{ id: 'hog-daylight', spell: 'hog-daylight', charges: { max: 1 } }, { id: 'hog-see-invis', spell: 'hog-see-invis', charges: { max: 1 } }],
});
const daylight = makeAbility({ id: 'hog-daylight', name: 'Daylight', kind: 'spell' });
const seeInvis = makeAbility({ id: 'hog-see-invis', name: 'See Invisibility', kind: 'spell' });
const horror = makeAbility({
  id: 'horror', name: 'Monster Horror', kind: 'feature', params: { types: { kind: 'tags' } },
  scripts: [{ id: 'h', source: "if (target.isOneOf(params.types)) bonus('attack', max(2, 2 * player.equipped.tag['trophy-aberration']))" }],
});
const gloves = makeAbility({ id: 'gloves', name: 'Chuul gloves', kind: 'item', item: { category: 'trophy', slot: 'hands', tags: ['trophy-aberration'] } });
const rage = makeAbility({ id: 'rage', name: 'Rage', kind: 'status', duration: 5 * ROUND, scripts: [{ id: 'r', source: "bonus('ability.str', 4, 'morale')" }] });
const helm = makeAbility({
  id: 'helm', name: 'Minotaur helm', kind: 'item', item: { category: 'trophy', slot: 'head' },
  scripts: [{ id: 'nf', source: "flag('neverFlatFooted')" }],
  pools: [{ id: 'helm-rage', max: 1, resetOn: 'day' }],
  activations: [{ id: 'helm', action: 'free', cost: [{ kind: 'charge', resourceId: 'helm-rage' }], scripts: [{ id: 'use', events: ['use'], source: "grant('rage')" }] }],
});
const potion = makeAbility({
  id: 'potion-cmw', name: 'Potion of CMW', kind: 'item', item: { category: 'potion' },
  activations: [{ id: 'potion-cmw', cost: [{ kind: 'item', abilityId: 'potion-cmw' }], scripts: [{ id: 'h', events: ['use'], source: 'heal(10)' }] }],
});
const revenge = makeAbility({ id: 'revenge', name: 'Revenge', kind: 'feature', scripts: [{ id: 'r', source: "if (history('hit', { by: 'target', since: 'lastRound' }) >= 1) bonus('attack', 2)" }] });

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

test('equipped weapon items provide attack profiles; weapon tags drive Weapon Focus; a weapon-id check scopes dice', () => {
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
  expect(r.attacks[0]!.nearMiss[0]!.failed).toMatch(/within 30 ft/);
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

test('scripts can read equipped-trophy counts by tag', () => {
  const c = ctxWith([bow, horror, gloves], { equipped: ['bow', 'gloves'], params: { horror: { types: ['aberration'] } } });
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10 + 2);
});

test('flags and grant(): never flat-footed flag; using the helm grants Rage as a buff', () => {
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

test('enemy events: "it hit me" is logged, damages HP, and feeds history predicates', () => {
  let c = ctxWith([bow, revenge], { equipped: ['bow'] });
  const st = logEnemyAction(c, { actorId: 'c1', result: 'hit', damage: 5 });
  c = { ...c, ...st };
  expect(c.character.hp.current).toBe(15);
  c = { ...c, ...nextRound(c) };
  c.target = c.battle!.combatants[0];
  expect(countHistory(c, { event: 'hit', by: 'target', vs: 'current', scope: 'lastRound' })).toBe(1);
  expect(resolveAttack(c, { profileId: 'weapon:bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(12);
});

test('setStat and scale', () => {
  const setSpeed = makeAbility({ id: 'slow', kind: 'status', scripts: [{ id: 's', source: "setStat('speed', 20)" }] });
  const doubleSpeed = makeAbility({ id: 'dbl', kind: 'status', scripts: [{ id: 's', source: "scale('speed', 2)" }] });
  const c0 = ctxWith([]);
  c0.library.abilities['slow'] = setSpeed; c0.library.abilities['dbl'] = doubleSpeed;
  const c = { ...c0, battle: { ...c0.battle!, activeBuffs: [{ instanceId: 'a', abilityId: 'slow', owner: 'self', suppressed: false }, { instanceId: 'b', abilityId: 'dbl', owner: 'self', suppressed: false }] } };
  expect(resolveStat(c, 'speed').total).toBe(40);
});
