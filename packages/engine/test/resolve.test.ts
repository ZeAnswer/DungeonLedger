import { resolveStat, resolveAttack, attackProfiles, availableActions, listAttackModes, listPools, activeSources } from '../src/resolve';
import { makeCtx, makeBattle, makeCombatant, makeAbility, makeCharacter, ev } from './fixtures';
import { AbilitySchema, type Ability } from '../src/schema';

// ---- content used across tests ----
const aqua = makeAbility({
  id: 'memento-aqua', name: 'Memento Aqua', source: 'memory',
  effects: [
    { id: 'atk', when: { kind: 'target.hasTag', tag: 'aquatic' }, do: [{ kind: 'bonus', to: 'attack', value: 2 }, { kind: 'bonus', to: 'damage', value: 2 }] },
    { id: 'swim', do: [{ kind: 'bonus', to: 'skill.swim', value: 2 }] },
  ],
});
const woodland = makeAbility({
  id: 'woodland-archer', name: 'Woodland Archer',
  effects: [
    {
      id: 'adjust', label: 'Adjust for Range',
      when: { kind: 'all', of: [{ kind: 'attack.kind', attackKind: 'ranged' }, { kind: 'log', event: 'miss', target: 'current', scope: 'thisRound' }] },
      do: [{ kind: 'bonus', to: 'attack', value: 4 }],
    },
    { id: 'sniper', label: 'Moving Sniper', do: [{ kind: 'note', text: 'After a successful sniping attack you may move once before re-hiding.' }] },
  ],
});
const favored = makeAbility({
  id: 'favored-enemy', name: 'Favored Enemy',
  params: { types: { kind: 'tags', category: 'creatureType' } },
  effects: [{ id: 'dmg', when: { kind: 'param', name: 'types', includesTargetTag: true }, do: [{ kind: 'bonus', to: 'damage', value: 2 }] }],
});
const knowledgeDevotion = makeAbility({
  id: 'knowledge-devotion', name: 'Knowledge Devotion',
  effects: [{
    id: 'kd', do: [
      { kind: 'bonusFromTable', promptId: 'knowledge', perTagCategory: 'creatureType', to: 'attack', bonusType: 'insight', table: [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { upTo: 30, value: 3 }, { upTo: 35, value: 4 }, { value: 5 }] },
      { kind: 'bonusFromTable', promptId: 'knowledge', perTagCategory: 'creatureType', to: 'damage', bonusType: 'insight', table: [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { upTo: 30, value: 3 }, { upTo: 35, value: 4 }, { value: 5 }] },
    ],
  }],
});
const bracers = makeAbility({ id: 'bracers-archery', name: 'Bracers of Archery', source: 'item', effects: [{ id: 'b', do: [{ kind: 'bonus', to: 'attack', value: 1, bonusType: 'competence', attackKind: 'ranged' }] }] });
const bracers2 = makeAbility({ id: 'bracers-archery-greater', name: 'Greater Bracers', source: 'item', effects: [{ id: 'b', do: [{ kind: 'bonus', to: 'attack', value: 2, bonusType: 'competence', attackKind: 'ranged' }] }] });
const ringProt = makeAbility({ id: 'ring-protection', source: 'item', effects: [{ id: 'r', do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'deflection' }] }] });
const bracersArmor = makeAbility({ id: 'bracers-armor', source: 'item', effects: [{ id: 'r', do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'armor' }] }] });
const ringSwim = makeAbility({ id: 'ring-swimming', source: 'item', effects: [{ id: 'r', do: [{ kind: 'bonus', to: 'skill.swim', value: 5, bonusType: 'competence' }] }] });
const formido = makeAbility({
  id: 'memento-formido', source: 'memory', params: { types: { kind: 'tags' } },
  effects: [{ id: 'w', when: { kind: 'param', name: 'types', includesTargetTag: true }, do: [{ kind: 'bonus', to: 'save.will', value: 2 }] }],
});
const rapidShot = makeAbility({ id: 'rapid-shot', effects: [{ id: 'm', do: [{ kind: 'attackMode', modeId: 'rapid-shot', label: 'Rapid Shot', base: 'full', extraAttacksAtTop: 1, penalty: -2, attackKind: 'ranged' }] }] });
const haste = makeAbility({
  id: 'haste', source: 'buff', duration: { rounds: 10 },
  effects: [{ id: 'h', do: [{ kind: 'extraAttack', appliesToBase: 'full' }, { kind: 'bonus', to: 'attack', value: 1, bonusType: 'dodge' }, { kind: 'bonus', to: 'ac', value: 1, bonusType: 'dodge' }] }],
});
const monsterBlow = makeAbility({
  id: 'monster-blow', name: 'Monster Blow', source: 'class', activation: 'declare',
  params: { types: { kind: 'tags', category: 'creatureType' } },
  resources: [{ id: 'monster-blow', max: 1, per: 'day' }],
  effects: [{
    id: 'mb', when: { kind: 'all', of: [{ kind: 'toggle', id: 'monster-blow' }, { kind: 'param', name: 'types', includesTargetTag: true }, { kind: 'target.hurtAtMost', hurt: 'bloodied' }] },
    do: [{ kind: 'note', text: 'On hit: Fort save DC = damage + MH level + Wis mod or die.' }],
  }],
});
const flaming = makeAbility({ id: 'flaming', source: 'item', effects: [{ id: 'f', do: [{ kind: 'extraDice', dice: '1d6', damageType: 'fire', label: 'Flaming' }] }] });

const chuul = makeCombatant({ id: 'c1', name: 'Chuul', tags: ['aberration', 'aquatic'], size: 'large', hurt: 'bloodied' });
const gargoyle = makeCombatant({ id: 'g1', name: 'Gargoyle', tags: ['monstrous-humanoid'] });

function ctxWith(abilities: Ability[], over: Parameters<typeof makeCtx>[0] = {}, params: Record<string, Record<string, string[]>> = {}) {
  const character = makeCharacter({
    abilities: abilities.map((a) => ({ abilityId: a.id, enabled: true, paramValues: params[a.id] ?? {} })),
    skills: { swim: { ranks: 2 }, spot: { ranks: 9 } },
  });
  const c = makeCtx({ character, battle: makeBattle({ combatants: [chuul, gargoyle] }), target: chuul, ...over });
  for (const a of abilities) c.library.abilities[a.id] = a;
  return c;
}

// ---- attack basics ----
test('full attack: iteratives with BAB, dex, enhancement; damage with capped str and enhancement', () => {
  const r = resolveAttack(ctxWith([]), { profileId: 'bow', modeId: 'full' });
  expect(r.attacks.map((a) => a.attackBonus)).toEqual([10, 5]);
  expect(r.attacks[0]!.damage.flat).toBe(2);
  expect(r.attacks[0]!.damage.dice).toEqual([{ dice: '1d8', label: 'Composite Longbow +1' }]);
  expect(r.attacks[0]!.critRange).toBe(20);
  expect(r.attacks[0]!.critMult).toBe(3);
});

test('single mode has one attack at top BAB', () => {
  const r = resolveAttack(ctxWith([]), { profileId: 'bow', modeId: 'single' });
  expect(r.attacks.map((a) => a.attackBonus)).toEqual([10]);
});

test('melee uses str for attack', () => {
  const r = resolveAttack(ctxWith([]), { profileId: 'sword', modeId: 'single' });
  expect(r.attacks[0]!.attackBonus).toBe(7);
  expect(r.attacks[0]!.critRange).toBe(19);
});

test('rapid shot mode: extra attack at top, -2 on all; only for ranged', () => {
  const c = ctxWith([rapidShot]);
  const r = resolveAttack(c, { profileId: 'bow', modeId: 'rapid-shot' });
  expect(r.attacks.map((a) => a.attackBonus)).toEqual([8, 8, 3]);
  expect(listAttackModes(c, 'bow').map((m) => m.modeId)).toEqual(['single', 'full', 'rapid-shot']);
  expect(listAttackModes(c, 'sword').map((m) => m.modeId)).toEqual(['single', 'full']);
});

test('haste buff adds attack in full-based modes plus dodge bonuses', () => {
  const c = ctxWith([rapidShot, haste]);
  c.battle!.activeBuffs.push({ instanceId: 'h', abilityId: 'haste', owner: 'self', remainingRounds: 9, suppressed: false });
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'full' }).attacks.map((a) => a.attackBonus)).toEqual([11, 11, 6]);
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'rapid-shot' }).attacks.map((a) => a.attackBonus)).toEqual([9, 9, 9, 4]);
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks.map((a) => a.attackBonus)).toEqual([11]);
  expect(resolveStat(c, 'ac').total).toBe(14);
});

// ---- conditional bonuses ----
test('Memento Aqua applies vs aquatic target and shows as near-miss otherwise', () => {
  const hit = resolveAttack(ctxWith([aqua]), { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(hit.attackBonus).toBe(12);
  expect(hit.damage.flat).toBe(4);
  expect(hit.attackBreakdown.find((e) => e.source === 'memento-aqua')).toMatchObject({ value: 2, applied: true });

  const miss = resolveAttack(ctxWith([aqua], { target: gargoyle }), { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(miss.attackBonus).toBe(10);
  expect(miss.nearMiss).toEqual([expect.objectContaining({ source: 'memento-aqua', summary: '+2 attack, +2 damage', failed: expect.stringMatching(/aquatic/i) })]);
});

test('Woodland Archer: +4 ranged after a logged miss on the same target this round', () => {
  const c = ctxWith([woodland]);
  const before = resolveAttack(c, { profileId: 'bow', modeId: 'full' });
  expect(before.attacks[0]!.attackBonus).toBe(10);
  c.battle!.log.push(ev({ kind: 'attack', round: 1, targetId: 'c1', result: 'miss', profileId: 'bow', attackIndex: 1 }));
  const after = resolveAttack(c, { profileId: 'bow', modeId: 'full' });
  expect(after.attacks[1]!.attackBonus).toBe(9); // 5 + 4
  expect(after.attacks[1]!.attackBreakdown.find((e) => e.source === 'woodland-archer')).toMatchObject({ label: 'Adjust for Range', value: 4 });
  expect(resolveAttack(c, { profileId: 'sword', modeId: 'single' }).attacks[0]!.attackBonus).toBe(7);
  expect(after.notes).toContain('After a successful sniping attack you may move once before re-hiding.');
});

test('favored enemy damage uses the character param selection', () => {
  const c = ctxWith([favored], {}, { 'favored-enemy': { types: ['aberration', 'magical-beast'] } });
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.damage.flat).toBe(4);
  expect(resolveAttack(ctxWith([favored], { target: gargoyle }, { 'favored-enemy': { types: ['aberration'] } }), { profileId: 'bow', modeId: 'single' }).attacks[0]!.damage.flat).toBe(2);
});

test('Knowledge Devotion reads per-creature-type prompt; missing prompt yields a warning', () => {
  const c = ctxWith([knowledgeDevotion]);
  const none = resolveAttack(c, { profileId: 'bow', modeId: 'single' });
  expect(none.attacks[0]!.attackBonus).toBe(10);
  expect(none.warnings.join(' ')).toMatch(/Knowledge Devotion.*Knowledge check/);
  c.battle!.prompts['knowledge:aberration'] = 22;
  const withCheck = resolveAttack(c, { profileId: 'bow', modeId: 'single' });
  expect(withCheck.attacks[0]!.attackBonus).toBe(12);
  expect(withCheck.attacks[0]!.damage.flat).toBe(4);
  c.battle!.prompts['knowledge:aberration'] = 40;
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(15);
});

test('typed bonuses do not stack; breakdown says why', () => {
  const r = resolveAttack(ctxWith([bracers, bracers2]), { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(r.attackBonus).toBe(12);
  expect(r.attackBreakdown.find((e) => e.source === 'bracers-archery')).toMatchObject({ applied: false, reason: expect.stringMatching(/competence/) });
});

test('ranged-only item bonus does not apply to melee', () => {
  expect(resolveAttack(ctxWith([bracers]), { profileId: 'sword', modeId: 'single' }).attacks[0]!.attackBonus).toBe(7);
});

test('suppressed or disabled abilities contribute nothing', () => {
  const c = ctxWith([aqua]);
  c.battle!.suppressedAbilities.push('memento-aqua');
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10);
  const d = ctxWith([aqua]);
  d.character.abilities[0]!.enabled = false;
  expect(resolveAttack(d, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10);
});

test('a status record stored on the battle applies like any ability', () => {
  const c = ctxWith([]);
  const sit = makeAbility({ id: 'sit-1', name: 'DM: darkness', source: 'situational', effects: [{ id: 'x', do: [{ kind: 'bonus', to: 'attack', value: -2 }] }] });
  if (sit.kind !== 'status') throw new Error('expected a status record');
  c.battle!.statuses.push(sit);
  c.battle!.activeBuffs.push({ instanceId: 'b1', abilityId: 'sit-1', owner: 'self', suppressed: false });
  const r = resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(r.attackBonus).toBe(8);
  expect(r.attackBreakdown.find((e) => e.source === 'sit-1')).toMatchObject({ sourceName: 'DM: darkness', value: -2 });
});

test('extra damage dice listed with label and type', () => {
  const r = resolveAttack(ctxWith([flaming]), { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(r.damage.dice).toEqual([{ dice: '1d8', label: 'Composite Longbow +1' }, { dice: '1d6', label: 'Flaming', damageType: 'fire' }]);
});

// ---- other stats ----
test('AC, touch and flat-footed', () => {
  const c = ctxWith([ringProt, bracersArmor]);
  expect(resolveStat(c, 'ac').total).toBe(15);
  expect(resolveStat(c, 'ac.touch').total).toBe(14);
  expect(resolveStat(c, 'ac.flatFooted').total).toBe(12);
});

test('saves from class tables plus ability mods, conditional will bonus', () => {
  const c = ctxWith([formido], {}, { 'memento-formido': { types: ['aberration'] } });
  expect(resolveStat(c, 'save.fort').total).toBe(7);
  expect(resolveStat(c, 'save.ref').total).toBe(7);
  expect(resolveStat(c, 'save.will').total).toBe(6);
  expect(resolveStat({ ...c, target: gargoyle }, 'save.will').total).toBe(4);
});

test('skills: ranks + ability + bonuses; unknown skill warns', () => {
  const c = ctxWith([aqua, ringSwim]);
  const swim = resolveStat(c, 'skill.swim');
  expect(swim.total).toBe(10);
  expect(resolveStat(c, 'skill.spot').total).toBe(12);
  expect(resolveStat(c, 'skill.bogus').warnings[0]).toMatch(/bogus/);
});

test('initiative and hp.max', () => {
  const c = ctxWith([]);
  expect(resolveStat(c, 'init').total).toBe(3);
  expect(resolveStat(c, 'hp.max').total).toBe(44);
});

// ---- actions ----
test('availableActions reports charges and eligibility reasons', () => {
  const c = ctxWith([monsterBlow], {}, { 'monster-blow': { types: ['aberration'] } });
  const [mb] = availableActions(c);
  expect(mb).toMatchObject({ abilityId: 'monster-blow', activationId: 'monster-blow', usable: true, eligible: true, charges: { id: 'monster-blow', remaining: 1, max: 1, resetOn: 'day' } });

  const spent = ctxWith([monsterBlow], {}, { 'monster-blow': { types: ['aberration'] } });
  spent.character.resourceState['monster-blow'] = { used: 1 };
  expect(availableActions(spent)[0]).toMatchObject({ usable: false, reasons: [expect.stringMatching(/no charges/i)] });

  const wrongTarget = ctxWith([monsterBlow], { target: gargoyle }, { 'monster-blow': { types: ['aberration'] } });
  const a = availableActions(wrongTarget)[0]!;
  expect(a.usable).toBe(true);
  expect(a.eligible).toBe(false);
  expect(a.reasons.join(' ')).toMatch(/types/);
});

test('missing prompt is reported structurally with the target tag label', () => {
  const r = resolveAttack(ctxWith([knowledgeDevotion]), { profileId: 'bow', modeId: 'single' });
  expect(r.promptsNeeded).toEqual([{ promptId: 'knowledge', perTagCategory: 'creatureType', tag: 'aberration', source: 'knowledge-devotion', sourceName: 'Knowledge Devotion' }]);
  expect(r.warnings[0]).toBe('Knowledge Devotion: needs a Knowledge check vs Aberration');
});

test('availableActions lists activations with charges, spell name and declare flag; pools are listed separately', () => {
  const hog = AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, activations: [{ id: 'hog-daylight', spell: 'daylight', charges: { max: 1 } }, { id: 'hog-torch', name: 'Torch' }] });
  const daylight = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', duration: { minutes: 50 } });
  const blow = AbilitySchema.parse({ id: 'monster-blow', name: 'Monster Blow', kind: 'feature', acquired: { kind: 'class', classId: 'monster-hunter' }, pools: [{ id: 'trophies', max: 4, resetOn: 'never' }], activations: [{ id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: 1 } }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'hog', enabled: true, paramValues: {} }, { abilityId: 'monster-blow', enabled: true, paramValues: {} }], resourceState: { 'hog-daylight': { used: 1 } } }), battle: makeBattle() });
  for (const a of [hog, daylight, blow]) c.library.abilities[a.id] = a;
  const actions = availableActions(c);
  expect(actions.map((a) => [a.abilityId, a.activationId, a.name, a.usable, a.declare])).toEqual([
    ['hog', 'hog-daylight', 'Daylight', false, false],
    ['hog', 'hog-torch', 'Torch', true, false],
    ['monster-blow', 'monster-blow', 'Monster Blow', true, true],
  ]);
  expect(actions[0]!.charges).toMatchObject({ id: 'hog-daylight', remaining: 0, max: 1, resetOn: 'day' });
  expect(actions[1]!.charges).toBeUndefined();
  expect(actions[2]!.acquired).toEqual({ kind: 'class', classId: 'monster-hunter' });
  expect(listPools(c)).toEqual([{ id: 'trophies', label: 'Monster Blow', remaining: 4, max: 4, resetOn: 'never', abilityId: 'monster-blow' }]);
  c.battle!.activeBuffs.push({ instanceId: 'b', abilityId: 'hog', activationId: 'hog-daylight', owner: 'self', suppressed: false });
  const src = activeSources(c).find((s) => s.kind === 'activation');
  expect(src).toMatchObject({ label: 'Daylight', activation: { id: 'hog-daylight' } });
  expect(src!.blocks).toEqual(daylight.effects);
  c.battle!.suppressedAbilities.push('monster-blow');
  expect(listPools(c)).toEqual([]);
});

test('a manual attack profile that duplicates an equipped weapon by name is hidden', () => {
  const bow = AbilitySchema.parse({ id: 'bow-x', name: 'Composite Longbow +1', kind: 'item', item: { category: 'weapon', slot: 'mainHand', tags: ['bow'], weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex', enhancement: 1 } } });
  const c = makeCtx({ character: makeCharacter({ attackProfiles: [{ id: 'old', name: 'composite longbow +1', kind: 'ranged', baseDice: '1d8', enhancement: 1, critRange: 20, critMult: 3, attackAbility: 'dex', damageAbilityMultiplier: 1 }, { id: 'sword', name: 'Longsword', kind: 'melee', baseDice: '1d8', enhancement: 0, critRange: 19, critMult: 2, attackAbility: 'str', damageAbilityMultiplier: 1 }], inventory: [{ id: 'i', abilityId: 'bow-x', quantity: 1, equipped: true }], abilities: [{ abilityId: 'bow-x', enabled: true, paramValues: {} }] }) });
  c.library.abilities['bow-x'] = bow;
  expect(attackProfiles(c).map((p) => p.id)).toEqual(['weapon:bow-x', 'sword']);
});
