import { logAttack, undoEvent } from '../src/battle';
import { resolveAttack } from '../src/resolve';
import { readSelector } from '../src/selectors';
import { evalExpr } from '../src/expr';
import { exprVars } from '../src/vars';
import { makeCtx, makeCharacter, makeAbility, makeBattle, makeCombatant } from './fixtures';

const woodland = makeAbility({
  id: 'woodland', name: 'Woodland Archer', kind: 'feature',
  scripts: [{ id: 'adjust', label: 'Adjust for Range', source: "if (attack.isRanged) { need(history('miss') >= 1, 'you missed this target this round'); bonus('attack', 4 * history('miss')); }" }],
});
const distracting = makeAbility({ id: 'distracting', kind: 'feature', scripts: [{ id: 'f', events: ['hit'], source: "target.mark('flanked', UNTIL_MY_NEXT_TURN)" }] });
const tally = makeAbility({
  id: 'tally', name: 'Tally', kind: 'feature',
  scripts: [{ id: 't', events: ['hit'], source: "setVar('hits', (vars.hits ?? 0) + 1); setVar('lastFoe', target.name)" }],
});

function ctx(extra: string[] = []) {
  const c = makeCtx({ character: makeCharacter({ abilities: ['woodland', 'distracting', ...extra].map((id) => ({ abilityId: id, enabled: true, paramValues: {} })), vars: { hits: 0 } }), battle: makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration'] })] }) });
  for (const a of [woodland, distracting, tally]) c.library.abilities[a.id] = a;
  c.target = c.battle!.combatants[0];
  return c;
}

test('history selector counts events and is usable in expressions; Adjust for Range stacks per miss', () => {
  let c = ctx();
  expect(readSelector(c, 'history.miss.me.current.round')).toBe(0);
  c = { ...c, ...logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'miss' }) };
  c = { ...c, ...logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 2, result: 'miss' }) };
  c.target = c.battle!.combatants[0];
  expect(evalExpr('sel(history.miss.me.current.round)', exprVars(c))).toBe(2);
  expect(resolveAttack(c, { profileId: 'bow', modeId: 'full' }).attacks[0]!.attackBonus).toBe(10 + 8);
});

test('logAttack stores a snapshot and what it changed; undoEvent reverts the change and removes the event', () => {
  let c = ctx();
  const r = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'hit', damage: 9 }, { attackBonus: 10, damageText: '1d8 +2' });
  c = { ...c, ...r };
  const ev = c.battle!.log.at(-1)!;
  expect(ev.snapshot).toEqual({ attackBonus: 10, damageText: '1d8 +2' });
  expect(c.battle!.combatants[0]!.conditions.map((x) => x.tag)).toEqual(['flanked']);
  expect(ev.undo?.targetConditions).toEqual([{ combatantId: 'c1', tag: 'flanked' }]);
  const u = undoEvent(c, ev.id);
  expect(u.battle.log).toEqual([]);
  expect(u.battle.combatants[0]!.conditions).toEqual([]);
});

test('setVar is undoable: a character var goes back to its old value, a new global disappears', () => {
  let c = ctx(['tally']);
  const r = logAttack(c, { targetId: 'c1', profileId: 'bow', modeId: 'full', attackIndex: 1, result: 'hit', damage: 4 });
  c = { ...c, character: r.character, battle: r.battle, library: { ...c.library, globals: r.globals ?? {} } };
  expect(c.character.vars.hits).toBe(1); // the character already had `hits`
  expect(c.library.globals['lastFoe']).toBe('c1'); // a new name lands in globals
  const ev = c.battle!.log.at(-1)!;
  expect(ev.undo?.vars).toEqual([
    { scope: 'character', name: 'hits', before: 0 },
    { scope: 'global', name: 'lastFoe' },
  ]);
  const u = undoEvent(c, ev.id);
  expect(u.character.vars.hits).toBe(0);
  expect(u.globals).toEqual({});
});
