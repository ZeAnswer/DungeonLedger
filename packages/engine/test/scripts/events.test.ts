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
  expect(r.patches.map((p) => (p.k === 'log' ? p.text : p.k))).toEqual(['zap', 'emit', 'saw a zap']);
});
