import { logAttack, useAbility, nextRound, addStatus, editLogEvent, deleteLogEvent, undoLastEvent, longRest, setPrompt, addCombatant } from '../src/battle';
import { resolveAttack, availableActions } from '../src/resolve';
import { ROUND } from '../src/scripts/units';
import { makeCtx, makeBattle, makeCombatant, makeAbility, makeCharacter } from './fixtures';
import { AbilitySchema, type Battle } from '../src/schema';

const distracting = makeAbility({
  id: 'distracting-attack', name: 'Distracting Attack', kind: 'feature',
  scripts: [{ id: 'flank', events: ['hit'], source: "target.mark('flanked', UNTIL_MY_NEXT_TURN)" }],
});
const sneak = makeAbility({ id: 'sneak', kind: 'feature', scripts: [{ id: 's', source: "if (target.is('flanked')) dice('1d6', undefined, { as: 'Sneak' })" }] });
const monsterBlow = makeAbility({
  id: 'monster-blow', name: 'Monster Blow', kind: 'feature', acquired: { kind: 'class' },
  activations: [{ id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: 1, resetOn: 'day' }, scripts: [{ id: 'mb', events: ['use'], source: 'charges("monster-blow").use()' }] }],
});
const haste = makeAbility({ id: 'haste', name: 'Haste', kind: 'status', duration: 2 * ROUND, scripts: [{ id: 'h', source: "bonus('attack', 1, 'dodge')" }] });
const bootsOfSpeed = makeAbility({
  id: 'boots-of-speed', name: 'Boots of Speed', kind: 'item', item: { category: 'wondrous', slot: 'feet' },
  pools: [{ id: 'boots-rounds', label: 'Haste rounds', max: 10, resetOn: 'day' }],
  activations: [{ id: 'boots-of-speed', action: 'free', scripts: [{ id: 'go', events: ['use'], source: "charges('boots-rounds').use(2); condition('self', 'hasted', 2 * ROUND)" }] }],
});
const monsterKnowledge = makeAbility({
  id: 'monster-knowledge', name: 'Monster Knowledge', kind: 'feature',
  activations: [{ id: 'monster-knowledge', scripts: [{ id: 'r', events: ['use'], source: "need(battle.prompts.knowledge >= 16, 'a Knowledge check of 16+'); target.reveal();" }] }],
});

const chuul = makeCombatant({ id: 'c1', name: 'Chuul', tags: ['aberration', 'aquatic'], size: 'large' });

function ctx() {
  const c = makeCtx({
    character: makeCharacter({ abilities: ['distracting-attack', 'sneak', 'monster-blow', 'boots-of-speed', 'monster-knowledge'].map((id) => ({ abilityId: id, enabled: true, paramValues: {} })) }),
    battle: makeBattle({ combatants: [chuul] }),
    target: chuul,
  });
  for (const a of [distracting, sneak, monsterBlow, haste, bootsOfSpeed, monsterKnowledge]) c.library.abilities[a.id] = a;
  return c;
}

test('logAttack appends an attack event with round and sequence', () => {
  const c = ctx();
  const { battle } = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'miss' });
  expect(battle.log).toHaveLength(1);
  expect(battle.log[0]).toMatchObject({ kind: 'attack', round: 1, seq: 1, targetId: 'c1', result: 'miss', attackIndex: 1 });
  expect(c.battle!.log).toHaveLength(0); // input not mutated
});

test('a hit script applies a condition to the target that later scripts can see', () => {
  const c = ctx();
  const { battle } = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'hit' });
  const target = battle.combatants[0]!;
  expect(target.conditions).toEqual([{ tag: 'flanked', expires: 'untilMyNextTurn', appliedRound: 1, source: 'distracting-attack' }]);
  const r = resolveAttack({ ...c, battle, target }, { profileId: 'bow', modeId: 'full' });
  expect(r.attacks[0]!.damage.dice.some((d) => d.label === 'Sneak')).toBe(true);
});

test('miss does not fire hit scripts', () => {
  const c = ctx();
  const { battle } = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'miss' });
  expect(battle.combatants[0]!.conditions).toEqual([]);
});

test('a crit runs the hit scripts and then the crit scripts', () => {
  const brutal = makeAbility({
    id: 'brutal', name: 'Brutal', kind: 'feature',
    scripts: [{ id: 'h', events: ['hit'], source: "log('hit')" }, { id: 'c', events: ['crit'], source: "log('crit')" }],
  });
  const c = ctx();
  c.library.abilities['brutal'] = brutal;
  const withBrutal = { ...c, character: { ...c.character, abilities: [...c.character.abilities, { abilityId: 'brutal', enabled: true, paramValues: {} }] } };
  const { battle } = logAttack(withBrutal, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'crit' });
  expect(battle.log.filter((e) => e.kind === 'note').map((e) => e.text)).toEqual(['hit', 'crit']);
});

test('useAbility logs the activation, consumes its per-day charge and runs the declared activation for this attack', () => {
  const c = ctx();
  const { battle, character } = useAbility(c, { abilityId: 'monster-blow', targetId: 'c1' });
  expect(battle.log[0]).toMatchObject({ kind: 'use', abilityId: 'monster-blow', activationId: 'monster-blow', targetId: 'c1' });
  expect(character.resourceState['monster-blow']).toEqual({ used: 1 });
  expect(battle.activeBuffs[0]).toMatchObject({ activationId: 'monster-blow', expires: 'thisAttack' });
  expect(availableActions({ ...c, battle, character }).find((a) => a.abilityId === 'monster-blow')!.usable).toBe(false);
});

test('a status has no activation and applies from the battle\'s active buffs', () => {
  const c = ctx();
  expect(haste.kind).toBe('status');
  const battle: Battle = { ...c.battle!, activeBuffs: [{ instanceId: 'x', abilityId: 'haste', owner: 'self', suppressed: false, remainingRounds: 2 }] };
  expect(resolveAttack({ ...c, battle }, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(11);
  expect(() => useAbility({ ...c, battle }, { abilityId: 'haste' })).toThrow(/no activation/);
});

test('use scripts: consume an amount, add a self condition in seconds, reveal the target', () => {
  const c = ctx();
  const r1 = useAbility(c, { abilityId: 'boots-of-speed' });
  expect(r1.character.resourceState['boots-rounds']).toEqual({ used: 2 });
  expect(r1.battle.selfConditions).toEqual([{ tag: 'hasted', expires: 12, appliedRound: 1, source: 'boots-of-speed' }]);

  const withPrompt = setPrompt(c, { id: 'knowledge', perTagCategory: 'creatureType', value: 18 });
  const r2 = useAbility({ ...c, battle: withPrompt }, { abilityId: 'monster-knowledge', targetId: 'c1' });
  expect(r2.battle.combatants[0]!.revealed).toBe(true);
  expect(r2.battle.prompts).toEqual({ 'knowledge:aberration': 18 });

  const r3 = useAbility(c, { abilityId: 'monster-knowledge', targetId: 'c1' });
  expect(r3.battle.combatants[0]!.revealed).toBe(false);
});

test('nextRound increments, logs roundStart, ticks buffs and expires conditions', () => {
  const c = ctx();
  let battle: Battle = { ...c.battle!, activeBuffs: [{ instanceId: 'x', abilityId: 'haste', owner: 'self', suppressed: false, remainingRounds: 2 }] };
  battle = logAttack({ ...c, battle }, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'hit' }).battle;
  battle = useAbility({ ...c, battle }, { abilityId: 'boots-of-speed' }).battle;
  battle = { ...battle, toggles: { 'in-aura': true }, roundResources: { x: 1 } };

  const r2 = nextRound({ ...c, battle }).battle;
  expect(r2.round).toBe(2);
  expect(r2.log.at(-1)).toMatchObject({ kind: 'roundStart', round: 2 });
  expect(r2.activeBuffs[0]!.remainingRounds).toBe(1);
  expect(r2.combatants[0]!.conditions).toHaveLength(1); // untilMyNextTurn: still on during round 2
  expect(r2.selfConditions).toHaveLength(1);
  expect(r2.toggles['in-aura']).toBe(true); // manual toggles persist
  expect(r2.roundResources).toEqual({});

  const r3 = nextRound({ ...c, battle: r2 }).battle;
  expect(r3.round).toBe(3);
  expect(r3.activeBuffs).toEqual([]); // haste expired
  expect(r3.combatants[0]!.conditions).toEqual([]); // flanked expired
  expect(r3.selfConditions).toEqual([]);
});

test('nextRound runs roundEnd scripts before the increment and roundStart after', () => {
  const ticker = makeAbility({
    id: 'ticker', name: 'Ticker', kind: 'feature',
    scripts: [
      { id: 'e', events: ['roundEnd'], source: 'log(`end ${battle.round}`)' },
      { id: 's', events: ['roundStart'], source: 'log(`start ${battle.round}`)' },
    ],
  });
  const c = ctx();
  c.library.abilities['ticker'] = ticker;
  const withTicker = { ...c, character: { ...c.character, abilities: [{ abilityId: 'ticker', enabled: true, paramValues: {} }] } };
  const { battle } = nextRound(withTicker);
  expect(battle.log.filter((e) => e.kind === 'note').map((e) => e.text)).toEqual(['end 1', 'start 2']);
});

test('addStatus on self creates a status + buff that affects attacks; on a combatant adds a condition', () => {
  const c = ctx();
  const b1 = addStatus(c, { label: 'DM: darkness', target: 'self', to: 'attack', value: -2, duration: 3 * ROUND });
  expect(b1.statuses).toHaveLength(1);
  expect(b1.activeBuffs[0]).toMatchObject({ abilityId: b1.statuses[0]!.id, remainingRounds: 3 });
  expect(resolveAttack({ ...c, battle: b1 }, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(8);

  const b2 = addStatus(c, { label: 'Entangled', target: 'c1', tag: 'entangled', duration: 'untilRemoved' });
  expect(b2.combatants[0]!.conditions).toEqual([{ tag: 'entangled', expires: 'untilRemoved', appliedRound: 1, source: 'situational' }]);
});

test('log edit, delete and undo', () => {
  const c = ctx();
  let battle = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'miss' }).battle;
  battle = logAttack({ ...c, battle }, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 2, result: 'hit', damage: 7 }).battle;
  const id = battle.log[0]!.id;
  const edited = editLogEvent(battle, id, { result: 'hit', damage: 5 });
  expect(edited.log[0]).toMatchObject({ result: 'hit', damage: 5 });
  expect(edited.log[0]!.editedAt).toBeDefined();
  expect(deleteLogEvent(battle, id).log).toHaveLength(1);
  expect(undoLastEvent(battle).log).toHaveLength(1);
  expect(undoLastEvent(battle).log[0]!.id).toBe(id);
});

test('longRest resets per-day resources', () => {
  const c = ctx();
  c.character.resourceState = { 'monster-blow': { used: 1 }, 'boots-rounds': { used: 6 } };
  expect(longRest(c.character, c.library).resourceState).toEqual({});
});

test('addCombatant from a monster copies tags and size, numbers duplicate names', () => {
  const c = ctx();
  const monster = { id: 'gargoyle', name: 'Gargoyle', tags: ['monstrous-humanoid', 'earth'], size: 'medium' as const, lore: { sections: [] } };
  let battle = addCombatant(c.battle!, { monster });
  battle = addCombatant(battle, { monster });
  expect(battle.combatants.slice(1).map((x) => x.name)).toEqual(['Gargoyle', 'Gargoyle 2']);
  expect(battle.combatants[1]).toMatchObject({ monsterId: 'gargoyle', tags: ['monstrous-humanoid', 'earth'], size: 'medium' });
  const quick = addCombatant(battle, { name: 'Red thing', tags: ['red'], size: 'huge' });
  expect(quick.combatants.at(-1)).toMatchObject({ name: 'Red thing', tags: ['red'], size: 'huge', hurt: 'unhurt' });
});

// ---- activations, spells and pools ----
function actCtx() {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots of Speed', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', action: 'free', charges: { max: 10 }, duration: 'untilMyNextTurn', scripts: [{ id: 'h', source: "bonus('attack', 1, 'dodge')" }] }] });
  const blow = AbilitySchema.parse({ id: 'monster-blow', name: 'Monster Blow', kind: 'feature', activations: [{ id: 'monster-blow', action: 'free', charges: { max: 1 }, duration: 'thisAttack', scripts: [{ id: 'n', source: "note('BLOW')" }] }] });
  const hog = AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, activations: [{ id: 'hog-daylight', spell: 'daylight', charges: { max: 1 } }, { id: 'hog-cure', spell: 'cure', charges: { max: 2 } }] });
  const daylight = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', duration: 50 * 60, scripts: [{ id: 'l', source: "flag('sense.light')" }] });
  const cure = AbilitySchema.parse({ id: 'cure', name: 'Cure', kind: 'spell', scripts: [{ id: 'h', events: ['use'], source: 'heal(5)' }] });
  const wand = AbilitySchema.parse({ id: 'wand', name: 'Wand', kind: 'item', item: { category: 'wand' }, pools: [{ id: 'wand-charges', max: 50, resetOn: 'never' }], activations: [{ id: 'wand-cure', spell: 'cure', cost: [{ kind: 'charge', resourceId: 'wand-charges' }] }] });
  const c = makeCtx({
    character: makeCharacter({ hp: { max: 44, current: 20, temp: 0, nonlethal: 0 }, abilities: ['boots', 'monster-blow', 'hog', 'wand'].map((id) => ({ abilityId: id, enabled: true, paramValues: {} })) }),
    battle: makeBattle({ combatants: [makeCombatant({ id: 'c1' })] }),
  });
  for (const a of [boots, blow, hog, daylight, cure, wand]) c.library.abilities[a.id] = a;
  c.target = c.battle!.combatants[0];
  return c;
}

test('useAbility by activation: spends inline charges, starts a buff keyed by activation with expiry', () => {
  let c = actCtx();
  c = { ...c, ...useAbility(c, { abilityId: 'boots', activationId: 'boots-rounds' }) };
  expect(c.character.resourceState['boots-rounds']).toEqual({ used: 1 });
  expect(c.battle!.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'boots', activationId: 'boots-rounds', expires: 'untilMyNextTurn', remainingRounds: 1 })]);
  expect(c.battle!.log.at(-1)).toMatchObject({ kind: 'use', abilityId: 'boots', activationId: 'boots-rounds' });
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(11);
});

test('a declared activation lasts one attack: gone after logAttack, charge stays spent', () => {
  let c = actCtx();
  c = { ...c, ...useAbility(c, { abilityId: 'monster-blow', targetId: 'c1' }) };
  expect(availableActions(c).find((a) => a.activationId === 'monster-blow')).toMatchObject({ active: true, usable: false });
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).notes).toContain('BLOW');
  c = { ...c, ...logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'single', attackIndex: 1, result: 'hit' }) };
  expect(c.battle!.activeBuffs).toEqual([]);
  expect(c.character.resourceState['monster-blow']).toEqual({ used: 1 });
});

test('spell activations: a spell with a duration runs as a buff; an instant spell applies once; pool costs are spent', () => {
  let c = actCtx();
  c = { ...c, ...useAbility(c, { abilityId: 'hog', activationId: 'hog-daylight' }) };
  expect(c.battle!.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'hog', activationId: 'hog-daylight', remainingRounds: 500, label: 'Daylight' })]);
  expect(c.character.resourceState['hog-daylight']).toEqual({ used: 1 });
  c = { ...c, ...useAbility(c, { abilityId: 'hog', activationId: 'hog-cure' }) };
  expect(c.character.hp.current).toBe(25);
  expect(c.battle!.activeBuffs).toHaveLength(1);
  c = { ...c, ...useAbility(c, { abilityId: 'wand', activationId: 'wand-cure' }) };
  expect(c.character.hp.current).toBe(30);
  expect(c.character.resourceState['wand-charges']).toEqual({ used: 1 });
  expect(longRest(c.character, c.library).resourceState).toEqual({ 'wand-charges': { used: 1 } });
});

test('addStatus stores a status record on the battle and activates it', () => {
  const c = actCtx();
  const b = addStatus(c, { label: 'DM: darkness', target: 'self', to: 'attack', value: -2, duration: 3 * ROUND });
  expect(b.statuses[0]).toMatchObject({ kind: 'status', name: 'DM: darkness', harmful: true });
  expect(b.activeBuffs[0]).toMatchObject({ abilityId: b.statuses[0]!.id, remainingRounds: 3, expires: 3 * ROUND });
  expect(resolveAttack({ ...c, battle: b }, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(8);
});
