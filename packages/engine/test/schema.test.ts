import { AbilitySchema, PackSchema, ScriptSchema, FunctionDefSchema, DurationSchema, BattleSchema, activationsOf } from '../src/schema';

test('a feature carries scripts; always cannot mix with events; call form validates', () => {
  const a = AbilitySchema.parse({ id: 'pbs', name: 'Point Blank Shot', kind: 'feature', scripts: [{ id: 's1', source: "if (attack.isRanged && target.within(30)) bonus(['attack','damage'], 1)" }] });
  if (a.kind !== 'feature') throw new Error();
  expect(a.scripts[0]).toMatchObject({ events: ['always'], enabled: true, priority: 0 });
  expect(ScriptSchema.safeParse({ id: 'x', events: ['always', 'hit'], source: '' }).success).toBe(false);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['hit', 'crit'], source: 'target.mark("flanked", UNTIL_MY_NEXT_TURN)' }).success).toBe(true);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['custom:rage-ended'], source: '' }).success).toBe(true);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['bogus'], source: '' }).success).toBe(false);
  expect(ScriptSchema.parse({ id: 'c', call: { fn: 'favoredEnemy', args: { types: { k: 'ref', v: 'params.types' }, amount: { k: 'lit', v: 4 } } } }).call?.fn).toBe('favoredEnemy');
});

test('activations carry scripts instead of onUse/whileActive; old keys are rejected', () => {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', charges: { max: 10 }, duration: 6, scripts: [{ id: 'h', source: 'extraAttack(1); bonus(["attack","ac","save.ref"], 1, "dodge"); bonus("speed", 30)' }] }] });
  expect(activationsOf(boots)[0]!.scripts).toHaveLength(1);
  expect(AbilitySchema.safeParse({ id: 'b', name: 'B', kind: 'feature', effects: [] }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'b', name: 'B', kind: 'item', item: { category: 'gear' }, activations: [{ id: 'a', onUse: [] }] }).success).toBe(false);
});

test('durations are seconds or a sentinel', () => {
  expect(DurationSchema.parse(50 * 60)).toBe(3000);
  expect(DurationSchema.parse('untilMyNextTurn')).toBe('untilMyNextTurn');
  expect(DurationSchema.safeParse({ rounds: 3 }).success).toBe(false);
  expect(DurationSchema.safeParse('endOfRound').success).toBe(false);
});

test('function definitions, globals and widened vars', () => {
  const f = FunctionDefSchema.parse({ id: 'trophy', name: 'Trophy bonus', params: [{ name: 'stat', type: 'stat' }, { name: 'base', type: 'number', default: 2 }], source: 'bonus(stat, base * vars.trophyMultiplier, "enhancement")' });
  expect(f.params[1]).toMatchObject({ required: false, default: 2 });
  const p = PackSchema.parse({ id: 'p', name: 'P', version: 1, functions: [f], globals: { season: 'winter', dm: true, roundsPerMinute: 10 } });
  expect(p.globals.season).toBe('winter');
  expect(PackSchema.parse({ id: 'q', name: 'Q', version: 1, characters: [{ id: 'c', name: 'C', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, hp: { max: 1, current: 1 }, vars: { flag: true, note: 'x' } }] }).characters[0]!.vars).toEqual({ flag: true, note: 'x' });
});

test('battle undo records var changes', () => {
  const b = BattleSchema.parse({ id: 'b', startedAt: 'now', log: [{ id: 'e', round: 1, seq: 1, kind: 'use', undo: { vars: [{ scope: 'global', name: 'x', before: 1 }] } }] });
  expect(b.log[0]!.undo!.vars[0]).toEqual({ scope: 'global', name: 'x', before: 1 });
});
