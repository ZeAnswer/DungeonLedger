import { evalCondition } from '../src/conditions';
import { convertCondition } from '../src/migrate';
import { AbilitySchema } from '../src/schema';
import { readSelector } from '../src/selectors';
import { describeSelector } from '../src/describe';
import { makeCtx, makeBattle, makeCombatant, makeCharacter, ev } from './fixtures';

const gargoyle = makeCombatant({ id: 'g1', tags: ['monstrous-humanoid'], size: 'medium', hurt: 'bloodied' });
const chuul = makeCombatant({ id: 'c1', tags: ['aberration', 'aquatic'], size: 'large', conditions: [{ tag: 'flanked' }] });

// NOTE: makeAbility (fixtures.ts) only converts v1 -> v2 and no longer parses against the v3 AbilitySchema;
// it's slated for a fixtures update in a later task. Build these two records directly against v3 in the meantime.
const monsterBlow = AbilitySchema.parse({ id: 'monster-blow', name: 'monster-blow', kind: 'feature', pools: [{ id: 'monster-blow', max: 1, resetOn: 'day' }] });
const favored = AbilitySchema.parse({ id: 'favored-enemy', name: 'favored-enemy', kind: 'feature', params: { types: { kind: 'tags', category: 'creatureType', count: 2 } } });

function ctx(over: Parameters<typeof makeCtx>[0] = {}) {
  const battle = makeBattle({ round: 2, combatants: [gargoyle, chuul], toggles: { flanking: true }, prompts: { 'knowledge:aberration': 22 } });
  const character = makeCharacter({
    abilities: [{ abilityId: 'favored-enemy', enabled: true, paramValues: { types: ['aberration', 'magical-beast'] } }, { abilityId: 'monster-blow', enabled: true, paramValues: {} }],
    resourceState: { 'monster-blow': { used: 0 } },
  });
  const c = makeCtx({ character, battle, target: chuul, ...over });
  c.library.abilities['monster-blow'] = monsterBlow;
  c.library.abilities['favored-enemy'] = favored;
  return c;
}
const t = (cond: unknown, c = ctx()) => evalCondition(convertCondition(cond), c);

test('always / all / any / not', () => {
  expect(t({ kind: 'always' })).toBe(true);
  expect(t({ kind: 'not', of: { kind: 'always' } })).toBe(false);
  expect(t({ kind: 'all', of: [{ kind: 'always' }, { kind: 'not', of: { kind: 'always' } }] })).toBe(false);
  expect(t({ kind: 'any', of: [{ kind: 'always' }, { kind: 'not', of: { kind: 'always' } }] })).toBe(true);
});

test('target tag leaves', () => {
  expect(t({ kind: 'target.hasTag', tag: 'aquatic' })).toBe(true);
  expect(t({ kind: 'target.hasTag', tag: 'red' })).toBe(false);
  expect(t({ kind: 'target.tagIn', tags: ['red', 'aberration'] })).toBe(true);
  expect(t({ kind: 'target.hasTag', tag: 'aquatic' }, ctx({ target: undefined }))).toBe(false);
});

test('target size and hurt', () => {
  expect(t({ kind: 'target.sizeAtLeast', size: 'large' })).toBe(true);
  expect(t({ kind: 'target.sizeAtLeast', size: 'huge' })).toBe(false);
  expect(t({ kind: 'target.hurtAtMost', hurt: 'bloodied' }, ctx({ target: gargoyle }))).toBe(true);
  expect(t({ kind: 'target.hurtAtMost', hurt: 'nearDeath' }, ctx({ target: gargoyle }))).toBe(false);
});

test('target condition counts as a tag too', () => {
  expect(t({ kind: 'target.hasCondition', condition: 'flanked' })).toBe(true);
  expect(t({ kind: 'target.hasTag', tag: 'flanked' })).toBe(true);
});

test('self buff, self condition, ability enabled', () => {
  const c = ctx();
  c.battle!.activeBuffs.push({ instanceId: 'h1', abilityId: 'haste', owner: 'self', suppressed: false });
  c.battle!.selfConditions.push({ tag: 'prone' });
  expect(t({ kind: 'self.hasBuff', abilityId: 'haste' }, c)).toBe(true);
  expect(t({ kind: 'self.hasCondition', condition: 'prone' }, c)).toBe(true);
  expect(t({ kind: 'self.abilityEnabled', abilityId: 'favored-enemy' }, c)).toBe(true);
  expect(t({ kind: 'self.abilityEnabled', abilityId: 'nope' }, c)).toBe(false);
});

test('suppressed buff does not count', () => {
  const c = ctx();
  c.battle!.activeBuffs.push({ instanceId: 'h1', abilityId: 'haste', owner: 'self', suppressed: true });
  expect(t({ kind: 'self.hasBuff', abilityId: 'haste' }, c)).toBe(false);
});

test('attack leaves', () => {
  const c = ctx({ attack: { profile: makeCharacter().attackProfiles[0]!, kind: 'ranged', index: 1, modeId: 'full' }, target: { ...chuul, distanceFeet: 20 } });
  expect(t({ kind: 'attack.kind', attackKind: 'ranged' }, c)).toBe(true);
  expect(t({ kind: 'attack.kind', attackKind: 'melee' }, c)).toBe(false);
  expect(t({ kind: 'attack.withinFeet', feet: 30 }, c)).toBe(true);
  expect(t({ kind: 'attack.index', index: 1 }, c)).toBe(true);
  expect(t({ kind: 'attack.isFirstThisRound' }, c)).toBe(true);
  expect(t({ kind: 'attack.kind', attackKind: 'ranged' })).toBe(false); // no attack in ctx
});

test('log leaf: missed current target this round', () => {
  const c = ctx();
  c.battle!.log.push(ev({ kind: 'attack', round: 2, targetId: 'c1', result: 'miss' }));
  expect(t({ kind: 'log', event: 'miss', target: 'current', scope: 'thisRound' }, c)).toBe(true);
  expect(t({ kind: 'log', event: 'miss', target: 'current', scope: 'lastRound' }, c)).toBe(false);
  expect(t({ kind: 'log', event: 'miss', target: 'current', scope: 'thisRound' }, ctx({ target: gargoyle, battle: c.battle }))).toBe(false);
  expect(t({ kind: 'log', event: 'miss', target: 'any', scope: 'thisRound' }, ctx({ target: gargoyle, battle: c.battle }))).toBe(true);
});

test('used leaf per encounter and per creature type category', () => {
  const c = ctx();
  c.battle!.log.push(ev({ kind: 'use', round: 1, abilityId: 'knowledge-devotion', targetId: 'c1' }));
  expect(t({ kind: 'used', abilityId: 'knowledge-devotion', scope: 'encounter' }, c)).toBe(true);
  expect(t({ kind: 'used', abilityId: 'knowledge-devotion', scope: 'round' }, c)).toBe(false);
  // same creature type as c1 (aberration) → used ; gargoyle is monstrous humanoid → not used
  expect(t({ kind: 'used', abilityId: 'knowledge-devotion', scope: 'encounter', perTagCategory: 'creatureType' }, c)).toBe(true);
  expect(t({ kind: 'used', abilityId: 'knowledge-devotion', scope: 'encounter', perTagCategory: 'creatureType' }, ctx({ target: gargoyle, battle: c.battle }))).toBe(false);
});

test('resource leaf reads per-day state from character', () => {
  expect(t({ kind: 'resource', id: 'monster-blow', remainingAtLeast: 1 })).toBe(true);
  const c = ctx();
  c.character.resourceState['monster-blow'] = { used: 1 };
  expect(t({ kind: 'resource', id: 'monster-blow', remainingAtLeast: 1 }, c)).toBe(false);
});

test('toggle, prompt (with per-category key), round', () => {
  expect(t({ kind: 'toggle', id: 'flanking' })).toBe(true);
  expect(t({ kind: 'toggle', id: 'aura' })).toBe(false);
  expect(t({ kind: 'prompt', id: 'knowledge', perTagCategory: 'creatureType', atLeast: 16 })).toBe(true);
  expect(t({ kind: 'prompt', id: 'knowledge', perTagCategory: 'creatureType', atLeast: 26 })).toBe(false);
  expect(t({ kind: 'prompt', id: 'knowledge', perTagCategory: 'creatureType' }, ctx({ target: gargoyle }))).toBe(false);
  expect(t({ kind: 'round', atLeast: 2 })).toBe(true);
  expect(t({ kind: 'round', atMost: 1 })).toBe(false);
});

test('param leaf matches character selections against target tags', () => {
  const c = ctx({ abilityInstance: { abilityId: 'favored-enemy', enabled: true, paramValues: { types: ['aberration', 'magical-beast'] } } });
  expect(t({ kind: 'param', name: 'types', includesTargetTag: true }, c)).toBe(true);
  const g = ctx({ target: gargoyle, abilityInstance: { abilityId: 'favored-enemy', enabled: true, paramValues: { types: ['aberration', 'magical-beast'] } } });
  expect(t({ kind: 'param', name: 'types', includesTargetTag: true }, g)).toBe(false);
});

test('self.ability.<id> reads activation and record state; usesLeft by pool, activation or record id', () => {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', action: 'free', charges: { max: 10 }, duration: 'untilMyNextTurn' }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'boots', enabled: true, paramValues: {} }], resourceState: { 'boots-rounds': { used: 3 } } }), battle: makeBattle({ activeBuffs: [{ instanceId: 'i', abilityId: 'boots', activationId: 'boots-rounds', owner: 'self', suppressed: false, remainingRounds: 1 }] }) });
  c.library.abilities['boots'] = boots;
  expect(readSelector(c, 'self.ability.boots.active')).toBe(true);
  expect(readSelector(c, 'self.ability.boots-rounds.active')).toBe(true);
  expect(readSelector(c, 'self.ability.boots.usesLeft')).toBe(7);
  expect(readSelector(c, 'self.ability.boots-rounds.used')).toBe(3);
  expect(readSelector(c, 'self.resource.boots-rounds.left')).toBe(7);
  expect(describeSelector(c, 'self.ability.boots-rounds.active')).toBe('Boots is active');
});
