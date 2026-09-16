import type { EvalContext } from '../../src/context';
import { AbilitySchema } from '../../src/schema';
import { computePass } from '../../src/scripts/compute';
import type { Sink } from '../../src/scripts/sink';
import { readSelector } from '../../src/selectors';
import { describeSelector } from '../../src/describe';
import { makeBattle, makeCharacter, makeCombatant, makeCtx, ev } from '../fixtures';

/**
 * The truths the old condition tree was tested for, now expressed as script predicates and asserted
 * through the compute pass: each case is a script that grants `bonus('init', 1)` when it holds.
 */
const gargoyle = makeCombatant({ id: 'g1', tags: ['monstrous-humanoid'], size: 'medium', hurt: 'bloodied' });
const chuul = makeCombatant({ id: 'c1', tags: ['aberration', 'aquatic'], size: 'large', conditions: [{ tag: 'flanked' }] });

const monsterBlow = AbilitySchema.parse({ id: 'monster-blow', name: 'monster-blow', kind: 'feature', pools: [{ id: 'monster-blow', max: 1, resetOn: 'day' }] });
const favored = AbilitySchema.parse({ id: 'favored-enemy', name: 'favored-enemy', kind: 'feature', params: { types: { kind: 'tags', category: 'creatureType', count: 2 } } });

type Over = Partial<EvalContext> & { params?: Record<string, string[]> };

/** A fresh context every call — the compute pass caches by character/battle/library identity. */
function ctx(over: Over = {}) {
  const battle = over.battle ?? makeBattle({ round: 2, combatants: [gargoyle, chuul], toggles: { flanking: true }, prompts: { 'knowledge:aberration': 22 } });
  const character = makeCharacter({
    abilities: [
      { abilityId: 'favored-enemy', enabled: true, paramValues: { types: ['aberration', 'magical-beast'] } },
      { abilityId: 'monster-blow', enabled: true, paramValues: {} },
      { abilityId: 'probe', enabled: true, paramValues: over.params ?? { types: ['aberration', 'magical-beast'] } },
    ],
    resourceState: { 'monster-blow': { used: 0 } },
  });
  const { params: _p, ...rest } = over;
  const c = makeCtx({ character, battle, target: chuul, ...rest });
  c.library.abilities['monster-blow'] = monsterBlow;
  c.library.abilities['favored-enemy'] = favored;
  return c;
}

function run(source: string, over: Over = {}): Sink {
  const c = ctx(over);
  c.library.abilities['probe'] = AbilitySchema.parse({ id: 'probe', name: 'Probe', kind: 'feature', scripts: [{ id: 'p', source }] });
  return computePass(c);
}

const holds = (expr: string, over: Over = {}) => run(`if (${expr}) bonus('init', 1)`, over).bonuses.some((b) => b.stat === 'init');

test('boolean shapes: always, and, or, not', () => {
  expect(holds('true')).toBe(true);
  expect(holds('!true')).toBe(false);
  expect(holds('true && !true')).toBe(false);
  expect(holds('true || !true')).toBe(true);
});

test('target tag predicates', () => {
  expect(holds("target.is('aquatic')")).toBe(true);
  expect(holds("target.is('red')")).toBe(false);
  expect(holds("target.isOneOf(['red', 'aberration'])")).toBe(true);
  expect(holds("target.is('aquatic')", { target: undefined })).toBe(false);
});

test('target size and hurt use the SIZE / HURT enums', () => {
  expect(holds('target.size >= SIZE.LARGE')).toBe(true);
  expect(holds('target.size >= SIZE.HUGE')).toBe(false);
  expect(holds('target.hurt >= HURT.BLOODIED', { target: gargoyle })).toBe(true);
  expect(holds('target.hurt >= HURT.NEAR_DEATH', { target: gargoyle })).toBe(false);
});

test('a condition on the target counts as a tag too', () => {
  expect(holds("target.is('flanked')")).toBe(true);
});

test('own buff, own condition, record on the sheet', () => {
  const battle = makeBattle({ round: 2, combatants: [gargoyle, chuul], activeBuffs: [{ instanceId: 'h1', abilityId: 'haste', owner: 'self', suppressed: false }], selfConditions: [{ tag: 'prone' }] });
  expect(holds("player.active('haste') !== null", { battle })).toBe(true);
  expect(holds("player.is('prone')", { battle })).toBe(true);
  expect(holds("player.has('favored-enemy')", { battle })).toBe(true);
  expect(holds("player.has('nope')", { battle })).toBe(false);
});

test('a suppressed buff does not count', () => {
  const battle = makeBattle({ round: 2, activeBuffs: [{ instanceId: 'h1', abilityId: 'haste', owner: 'self', suppressed: true }] });
  expect(holds("player.active('haste') !== null", { battle })).toBe(false);
});

test('attack predicates', () => {
  const attack = { profile: makeCharacter().attackProfiles[0]!, kind: 'ranged' as const, index: 1, modeId: 'full' };
  const near = { attack, target: { ...chuul, distanceFeet: 20 } };
  expect(holds('attack.isRanged', near)).toBe(true);
  expect(holds('attack.isMelee', near)).toBe(false);
  expect(holds('target.within(30)', near)).toBe(true);
  expect(holds('attack.index === 1', near)).toBe(true);
  expect(holds('attack.isFirstThisRound', near)).toBe(true);
  expect(holds('attack.isRanged')).toBe(false); // no attack in the context
});

test('history: missed the current target this round', () => {
  const battle = makeBattle({ round: 2, combatants: [gargoyle, chuul], log: [ev({ kind: 'attack', round: 2, targetId: 'c1', result: 'miss' })] });
  expect(holds("history('miss') >= 1", { battle })).toBe(true);
  expect(holds("history('miss', { since: 'lastRound' }) >= 1", { battle })).toBe(false);
  expect(holds("history('miss') >= 1", { battle, target: gargoyle })).toBe(false);
  expect(holds("history('miss', { vs: 'any' }) >= 1", { battle, target: gargoyle })).toBe(true);
});

test('history: uses of a record, per encounter and per creature type', () => {
  const battle = makeBattle({ round: 2, combatants: [gargoyle, chuul], log: [ev({ kind: 'use', round: 1, abilityId: 'knowledge-devotion', targetId: 'c1' })] });
  const used = (opts: string) => `history('used', { ability: 'knowledge-devotion', ${opts} }) >= 1`;
  expect(holds(used("vs: 'any', since: 'encounter'"), { battle })).toBe(true);
  expect(holds(used("vs: 'any', since: 'round'"), { battle })).toBe(false);
  // same creature type as c1 (aberration) → used ; gargoyle is a monstrous humanoid → not used
  expect(holds(used("vs: 'sameCategory', category: 'creatureType', since: 'encounter'"), { battle })).toBe(true);
  expect(holds(used("vs: 'sameCategory', category: 'creatureType', since: 'encounter'"), { battle, target: gargoyle })).toBe(false);
});

test('charges left read the per-day state on the character', () => {
  expect(holds("player.left('monster-blow') >= 1")).toBe(true);
  const spent = ctx();
  spent.character.resourceState['monster-blow'] = { used: 1 };
  spent.library.abilities['probe'] = AbilitySchema.parse({ id: 'probe', name: 'Probe', kind: 'feature', scripts: [{ id: 'p', source: "if (player.left('monster-blow') >= 1) bonus('init', 1)" }] });
  expect(computePass(spent).bonuses).toEqual([]);
});

test('toggle, prompt (keyed by the target category) and round', () => {
  expect(holds("battle.on('flanking')")).toBe(true);
  expect(holds("battle.on('aura')")).toBe(false);
  expect(holds('battle.prompts.knowledge >= 16')).toBe(true);
  expect(holds('battle.prompts.knowledge >= 26')).toBe(false);
  expect(holds('battle.prompts.knowledge >= 16', { target: gargoyle })).toBe(false);
  expect(holds('battle.round >= 2')).toBe(true);
  expect(holds('battle.round <= 1')).toBe(false);
});

test('params match the character selections against target tags', () => {
  expect(holds('target.isOneOf(params.types)')).toBe(true);
  expect(holds('target.isOneOf(params.types)', { target: gargoyle })).toBe(false);
});

test('a failed predicate becomes the near-miss reason', () => {
  const sink = run("if (target.is('red')) bonus('init', 1)");
  expect(sink.skipped[0]).toMatchObject({ source: 'probe', failed: 'target is Red' });
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
