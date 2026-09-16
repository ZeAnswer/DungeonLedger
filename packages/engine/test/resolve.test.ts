import { resolveStat, resolveAttack, attackProfiles, availableActions, listAttackModes, listPools } from '../src/resolve';
import { activeSources } from '../src/scripts/compute';
import { makeCtx, makeBattle, makeCombatant, makeAbility, makeCharacter, ev } from './fixtures';
import { AbilitySchema, type Ability } from '../src/schema';

// ---- content used across tests (rules format v4: scripts, not blocks) ----
const aqua = makeAbility({
  id: 'memento-aqua', name: 'Memento Aqua', kind: 'feature',
  scripts: [
    { id: 'atk', source: "if (target.is('aquatic')) { bonus('attack', 2); bonus('damage', 2); }" },
    { id: 'swim', source: "bonus('skill.swim', 2)" },
  ],
});
const woodland = makeAbility({
  id: 'woodland-archer', name: 'Woodland Archer', kind: 'feature',
  scripts: [
    { id: 'adjust', label: 'Adjust for Range', source: "if (attack.isRanged) { need(history('miss') >= 1, 'you missed this target this round'); bonus('attack', 4 * history('miss'), 'untyped', { as: 'Adjust for Range' }); }" },
    { id: 'sniper', label: 'Moving Sniper', source: "note('After a successful sniping attack you may move once before re-hiding.')" },
  ],
});
const favored = makeAbility({
  id: 'favored-enemy', name: 'Favored Enemy', kind: 'feature',
  params: { types: { kind: 'tags', category: 'creatureType' } },
  scripts: [{ id: 'dmg', source: "if (target.isOneOf(params.types)) bonus('damage', 2)" }],
});
const KD_TIERS = 'tier(knowledge, [15, 1], [25, 2], [30, 3], [35, 4], [Infinity, 5])';
const knowledgeDevotion = makeAbility({
  id: 'knowledge-devotion', name: 'Knowledge Devotion', kind: 'feature',
  scripts: [{ id: 'kd', source: `const knowledge = ask('knowledge', { per: 'creatureType' });\nif (knowledge) { bonus('attack', ${KD_TIERS}, 'insight'); bonus('damage', ${KD_TIERS}, 'insight'); }` }],
});
const wondrous = (id: string, scripts: unknown[], name?: string) =>
  makeAbility({ id, ...(name ? { name } : {}), kind: 'item', item: { category: 'wondrous' }, scripts });
const bracers = wondrous('bracers-archery', [{ id: 'b', source: "if (attack.isRanged) bonus('attack', 1, 'competence')" }], 'Bracers of Archery');
const bracers2 = wondrous('bracers-archery-greater', [{ id: 'b', source: "if (attack.isRanged) bonus('attack', 2, 'competence')" }], 'Greater Bracers');
const ringProt = wondrous('ring-protection', [{ id: 'r', source: "bonus('ac', 1, 'deflection')" }]);
const bracersArmor = wondrous('bracers-armor', [{ id: 'r', source: "bonus('ac', 1, 'armor')" }]);
const ringSwim = wondrous('ring-swimming', [{ id: 'r', source: "bonus('skill.swim', 5, 'competence')" }]);
const flaming = wondrous('flaming', [{ id: 'f', source: "dice('1d6', 'fire', { as: 'Flaming' })" }]);
const formido = makeAbility({
  id: 'memento-formido', kind: 'feature', params: { types: { kind: 'tags' } },
  scripts: [{ id: 'w', source: "if (target.isOneOf(params.types)) bonus('save.will', 2)" }],
});
const rapidShot = makeAbility({
  id: 'rapid-shot', kind: 'feature',
  scripts: [{ id: 'm', source: "attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' })" }],
});
const haste = makeAbility({
  id: 'haste', kind: 'status', duration: 60,
  scripts: [{ id: 'h', source: "extraAttack(1, { base: 'full' }); bonus('attack', 1, 'dodge'); bonus('ac', 1, 'dodge');" }],
});
const monsterBlow = makeAbility({
  id: 'monster-blow', name: 'Monster Blow', kind: 'feature', acquired: { kind: 'class', classId: 'monster-hunter' },
  params: { types: { kind: 'tags', category: 'creatureType' } },
  activations: [{
    id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: 1, resetOn: 'day' },
    scripts: [{ id: 'mb', source: "if (target.isOneOf(params.types) && target.hurt >= HURT.BLOODIED) note('On hit: Fort save DC = damage + MH level + Wis mod or die.')" }],
  }],
});

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
  const c0 = ctxWith([rapidShot, haste]);
  const c = { ...c0, battle: { ...c0.battle!, activeBuffs: [{ instanceId: 'h', abilityId: 'haste', owner: 'self', remainingRounds: 9, suppressed: false }] } };
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
  expect(miss.nearMiss).toEqual([expect.objectContaining({ source: 'memento-aqua', failed: expect.stringMatching(/aquatic/i) })]);
});

test('Woodland Archer: +4 ranged per logged miss on the same target this round', () => {
  const c = ctxWith([woodland]);
  const before = resolveAttack(c, { profileId: 'bow', modeId: 'full' });
  expect(before.attacks[0]!.attackBonus).toBe(10);
  // The compute pass is cached by battle identity, so a new log entry means a new battle object (as in the app).
  const logged = { ...c, battle: { ...c.battle!, log: [ev({ kind: 'attack', round: 1, targetId: 'c1', result: 'miss', profileId: 'bow', attackIndex: 1 })] } };
  const after = resolveAttack(logged, { profileId: 'bow', modeId: 'full' });
  expect(after.attacks[1]!.attackBonus).toBe(9); // 5 + 4
  expect(after.attacks[1]!.attackBreakdown.find((e) => e.source === 'woodland-archer')).toMatchObject({ label: 'Adjust for Range', value: 4 });
  expect(resolveAttack(logged, { profileId: 'sword', modeId: 'single' }).attacks[0]!.attackBonus).toBe(7);
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
  const at22 = { ...c, battle: { ...c.battle!, prompts: { 'knowledge:aberration': 22 } } };
  const withCheck = resolveAttack(at22, { profileId: 'bow', modeId: 'single' });
  expect(withCheck.attacks[0]!.attackBonus).toBe(12);
  expect(withCheck.attacks[0]!.damage.flat).toBe(4);
  const at40 = { ...c, battle: { ...c.battle!, prompts: { 'knowledge:aberration': 40 } } };
  expect(resolveAttack(at40, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(15);
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
  const c0 = ctxWith([aqua]);
  const c = { ...c0, battle: { ...c0.battle!, suppressedAbilities: ['memento-aqua'] } };
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10);
  const d = ctxWith([aqua]);
  d.character.abilities[0]!.enabled = false;
  expect(resolveAttack(d, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(10);
});

test('a status record stored on the battle applies like any ability', () => {
  const c0 = ctxWith([]);
  const sit = makeAbility({ id: 'sit-1', name: 'DM: darkness', kind: 'status', scripts: [{ id: 'x', source: "bonus('attack', -2)" }] });
  if (sit.kind !== 'status') throw new Error('expected a status record');
  const c = { ...c0, battle: { ...c0.battle!, statuses: [sit], activeBuffs: [{ instanceId: 'b1', abilityId: 'sit-1', owner: 'self', suppressed: false }] } };
  const r = resolveAttack(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(r.attackBonus).toBe(8);
  expect(r.attackBreakdown.find((e) => e.source === 'sit-1')).toMatchObject({ sourceName: 'DM: darkness', value: -2 });
});

test('extra damage dice listed with label and type', () => {
  const r = resolveAttack(ctxWith([flaming]), { profileId: 'bow', modeId: 'single' }).attacks[0]!;
  expect(r.damage.dice).toEqual([{ dice: '1d8', label: 'Composite Longbow +1' }, { dice: '1d6', label: 'Flaming', damageType: 'fire' }]);
});

test('naturalAttack() adds an attack profile named after the record', () => {
  const claws = makeAbility({ id: 'claws', name: 'Beast Claws', kind: 'feature', scripts: [{ id: 'n', source: "naturalAttack({ name: 'Claw', dice: '1d4', count: 2, attackBonus: 1 })" }] });
  const p = attackProfiles(ctxWith([claws])).find((x) => x.id.startsWith('natural:'));
  expect(p).toMatchObject({ id: 'natural:claws:Claw', name: 'Claw (Beast Claws)', baseDice: '1d4', enhancement: 1, kind: 'melee' });
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
  expect(resolveStat(c, 'skill.swim').total).toBe(10);
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
  expect(mb!.notes).toEqual(['On hit: Fort save DC = damage + MH level + Wis mod or die.']);

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

test('prompts are surfaced on attack and damage only, not on other stats', () => {
  const c = ctxWith([knowledgeDevotion]);
  for (const stat of ['attack', 'damage'] as const) {
    const r = resolveStat(c, stat);
    expect(r.promptsNeeded).toEqual([{ promptId: 'knowledge', perTagCategory: 'creatureType', tag: 'aberration', source: 'knowledge-devotion', sourceName: 'Knowledge Devotion' }]);
    expect(r.warnings).toContain('Knowledge Devotion: needs a Knowledge check vs Aberration');
  }
  for (const stat of ['ac', 'save.will', 'init', 'skill.swim'] as const) {
    const r = resolveStat(c, stat);
    expect(r.promptsNeeded).toEqual([]);
    expect(r.warnings).toEqual([]);
  }
});

test('availableActions lists activations with charges, spell name and declare flag; pools are listed separately', () => {
  const hog = AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, activations: [{ id: 'hog-daylight', spell: 'daylight', charges: { max: 1 } }, { id: 'hog-torch', name: 'Torch' }] });
  const daylight = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', duration: 3000, scripts: [{ id: 'l', source: "flag('sense.light')" }] });
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
  const running = { ...c, battle: { ...c.battle!, activeBuffs: [{ instanceId: 'b', abilityId: 'hog', activationId: 'hog-daylight', owner: 'self', suppressed: false }] } };
  const src = activeSources(running).find((s) => s.kind === 'activation');
  expect(src).toMatchObject({ label: 'Daylight', activation: { id: 'hog-daylight' } });
  expect(src!.scripts).toEqual(daylight.scripts); // the cast spell's scripts run while the activation is up
  const suppressed = { ...c, battle: { ...c.battle!, suppressedAbilities: ['monster-blow'] } };
  expect(listPools(suppressed)).toEqual([]);
});

test('a manual attack profile that duplicates an equipped weapon by name is hidden', () => {
  const bow = AbilitySchema.parse({ id: 'bow-x', name: 'Composite Longbow +1', kind: 'item', item: { category: 'weapon', slot: 'mainHand', tags: ['bow'], weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex', enhancement: 1 } } });
  const c = makeCtx({ character: makeCharacter({ attackProfiles: [{ id: 'old', name: 'composite longbow +1', kind: 'ranged', baseDice: '1d8', enhancement: 1, critRange: 20, critMult: 3, attackAbility: 'dex', damageAbilityMultiplier: 1 }, { id: 'sword', name: 'Longsword', kind: 'melee', baseDice: '1d8', enhancement: 0, critRange: 19, critMult: 2, attackAbility: 'str', damageAbilityMultiplier: 1 }], inventory: [{ id: 'i', abilityId: 'bow-x', quantity: 1, equipped: true }], abilities: [{ abilityId: 'bow-x', enabled: true, paramValues: {} }] }) });
  c.library.abilities['bow-x'] = bow;
  expect(attackProfiles(c).map((p) => p.id)).toEqual(['weapon:bow-x', 'sword']);
});
