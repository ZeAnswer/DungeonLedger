import { AbilitySchema } from '../../src/schema';
import { applyPatches, runEventScripts } from '../../src/scripts/events';
import { ROUND } from '../../src/scripts/units';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

test('hit scripts queue patches; emit wakes custom scripts in the same run; patches apply immutably', () => {
  const distract = AbilitySchema.parse({ id: 'distract', name: 'Distracting Attack', kind: 'feature', scripts: [{ id: 's', events: ['hit', 'crit'], source: "target.mark('flanked', UNTIL_MY_NEXT_TURN); emit('flanked-someone', { by: 'me' })" }] });
  const counter = AbilitySchema.parse({ id: 'counter', name: 'Counter', kind: 'feature', scripts: [{ id: 's', events: ['custom:flanked-someone'], source: "setVar('flanks', (vars.flanks ?? 0) + 1); log(`flanked by ${event.payload.by}`)" }] });
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'distract', enabled: true, paramValues: {} }, { abilityId: 'counter', enabled: true, paramValues: {} }] }), battle, target: battle.combatants[0] });
  c.library.abilities['distract'] = distract;
  c.library.abilities['counter'] = counter;
  c.library.globals = {};
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.patches.map((p) => p.k)).toEqual(['tag', 'emit', 'setVar', 'log']);
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, distract, 'c1');
  expect(st.battle.combatants[0]!.conditions[0]).toMatchObject({ tag: 'flanked', expires: 'untilMyNextTurn' });
  expect(st.globals?.flanks ?? st.character.vars.flanks).toBe(1);
  expect(st.battle.log.at(-1)).toMatchObject({ kind: 'note', text: 'flanked by me' });
  expect(c.battle!.combatants[0]!.conditions).toEqual([]);
});

test('durations in seconds become rounds on conditions and buffs', () => {
  const rec = AbilitySchema.parse({ id: 'r', name: 'R', kind: 'feature', scripts: [{ id: 's', events: ['use'], source: "condition('self', 'hasted', 3 * ROUND); grant('bless', 10 * ROUND)" }] });
  const bless = AbilitySchema.parse({ id: 'bless', name: 'Bless', kind: 'status', duration: 10 * ROUND });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'r', enabled: true, paramValues: {} }] }), battle: makeBattle() });
  c.library.abilities['r'] = rec;
  c.library.abilities['bless'] = bless;
  const r = runEventScripts(c, { kind: 'use', abilityId: 'r' }, { only: { abilityId: 'r' } });
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, rec);
  expect(st.battle.selfConditions[0]).toMatchObject({ tag: 'hasted', expires: 18 });
  expect(st.battle.activeBuffs[0]).toMatchObject({ abilityId: 'bless', remainingRounds: 10, expires: 60, appliedRound: 1 });
});

test('only restricts the initial event to one record (its activation, for use) while emits still reach everyone', () => {
  const wand = AbilitySchema.parse({
    id: 'wand', name: 'Wand', kind: 'item', item: { category: 'wand', slot: 'mainHand' },
    scripts: [{ id: 'rec', events: ['use'], source: "log('record')" }],
    activations: [{ id: 'zap', scripts: [{ id: 's', events: ['use'], source: "log('zap'); emit('zapped')" }] }],
  });
  const witness = AbilitySchema.parse({ id: 'witness', name: 'Witness', kind: 'feature', scripts: [{ id: 'u', events: ['use'], source: "log('other use')" }, { id: 'c', events: ['custom:zapped'], source: "log('saw a zap')" }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'wand', enabled: true, paramValues: {} }, { abilityId: 'witness', enabled: true, paramValues: {} }] }), battle: makeBattle() });
  c.library.abilities['wand'] = wand;
  c.library.abilities['witness'] = witness;
  const r = runEventScripts(c, { kind: 'use', abilityId: 'wand', activationId: 'zap' }, { only: { abilityId: 'wand', activationId: 'zap' } });
  expect(r.patches.map((p) => (p.k === 'log' ? p.text : p.k))).toEqual(['record', 'zap', 'emit', 'saw a zap']);

  // Same two scripts, once each, when the activation is already running as a buff (a second source).
  const running = { ...c, battle: { ...c.battle!, activeBuffs: [{ instanceId: 'b', abilityId: 'wand', activationId: 'zap', owner: 'self', suppressed: false }] } };
  const r2 = runEventScripts(running, { kind: 'use', abilityId: 'wand', activationId: 'zap' }, { only: { abilityId: 'wand', activationId: 'zap' } });
  expect(r2.patches.map((p) => (p.k === 'log' ? p.text : p.k))).toEqual(['record', 'zap', 'emit', 'saw a zap']);
});

test('a script that skips or throws contributes no patches', () => {
  const half = AbilitySchema.parse({ id: 'half', name: 'Half', kind: 'feature', scripts: [{ id: 's', events: ['hit'], source: "target.mark('x'); need(false, 'never');" }] });
  const boom = AbilitySchema.parse({ id: 'boom', name: 'Boom', kind: 'feature', scripts: [{ id: 's', events: ['hit'], source: "target.mark('y'); throw new Error('nope');" }] });
  const good = AbilitySchema.parse({ id: 'good', name: 'Good', kind: 'feature', scripts: [{ id: 's', events: ['hit'], source: "target.mark('z')" }] });
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })] });
  const c = makeCtx({ character: makeCharacter({ abilities: [half, boom, good].map((a) => ({ abilityId: a.id, enabled: true, paramValues: {} })) }), battle, target: battle.combatants[0] });
  for (const a of [half, boom, good]) c.library.abilities[a.id] = a;
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.patches.flatMap((p) => (p.k === 'tag' ? [p.tag] : []))).toEqual(['z']);
  expect(r.errors.map((e) => e.recordId)).toEqual(['boom']);
});

test('check() ("for the monster") attaches to the event currently being logged', () => {
  const gloves = AbilitySchema.parse({ id: 'gloves', name: 'Chuul Gloves', kind: 'feature', scripts: [{ id: 's', events: ['hit'], source: "check('Chuul Gloves: paralysis', { save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' })" }] });
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })], log: [{ id: 'ev1', round: 1, seq: 1, kind: 'attack', actor: 'self', result: 'hit' }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'gloves', enabled: true, paramValues: {} }] }), battle, target: battle.combatants[0] });
  c.library.abilities['gloves'] = gloves;
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.patches).toEqual([{ k: 'check', name: 'Chuul Gloves: paralysis', save: 'fort', dc: 15, effect: 'paralysed (Fort negates)', src: 'gloves' }]);
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, gloves, 'c1', 'ev1');
  expect(st.battle.log).toHaveLength(1); // attached, not a new entry
  expect(st.battle.log[0]!.checks).toEqual([{ name: 'Chuul Gloves: paralysis', save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' }]);
  expect(c.battle!.log[0]!.checks).toBeUndefined(); // immutable
});

test('check() attaches to the event by id even when a log() patch in the same batch appends a later note', () => {
  const gloves = AbilitySchema.parse({
    id: 'gloves', name: 'Chuul Gloves', kind: 'feature',
    scripts: [{ id: 's', events: ['hit'], source: "log('a note'); check('Chuul Gloves: paralysis', { save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' })" }],
  });
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })], log: [{ id: 'ev1', round: 1, seq: 1, kind: 'attack', actor: 'self', result: 'hit' }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'gloves', enabled: true, paramValues: {} }] }), battle, target: battle.combatants[0] });
  c.library.abilities['gloves'] = gloves;
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.patches.map((p) => p.k)).toEqual(['log', 'check']); // log's patch precedes check's in the batch
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, gloves, 'c1', 'ev1');
  expect(st.battle.log).toHaveLength(2); // the attack event, plus the note log() appended
  const attackEvent = st.battle.log.find((e) => e.id === 'ev1')!;
  expect(attackEvent.checks).toEqual([{ name: 'Chuul Gloves: paralysis', save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' }]);
  const noteEvent = st.battle.log.find((e) => e.id !== 'ev1')!;
  expect(noteEvent).toMatchObject({ kind: 'note', text: 'a note' });
  expect(noteEvent.checks).toBeUndefined(); // the check landed on the attack, not the note
});

test('a broad emit cascade is stopped by the run cap instead of running away', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `r${i}`);
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })] });
  const c = makeCtx({ character: makeCharacter({ abilities: ids.map((id) => ({ abilityId: id, enabled: true, paramValues: {} })) }), battle, target: battle.combatants[0] });
  for (const id of ids) c.library.abilities[id] = AbilitySchema.parse({ id, name: id, kind: 'feature', scripts: [{ id: 's', events: ['hit', 'custom:go'], source: "emit('go')" }] });
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.errors.at(-1)?.message).toMatch(/emit cascade exceeded 500 script runs/);
  expect(r.patches.length).toBeLessThanOrEqual(500);
});
