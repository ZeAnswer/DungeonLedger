import { AbilitySchema, PackSchema, ConditionSchema, BattleSchema, activationsOf, poolsOf } from '../src/schema';

const woodlandArcher = {
  id: 'woodland-archer', name: 'Woodland Archer', kind: 'feature',
  effects: [{ id: 'adjust-for-range', label: 'Adjust for Range', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', vs: 'current', scope: 'thisRound' } }] }, do: [{ verb: 'modify', to: 'attack', value: 4 }] }],
};

test('accepts a well-formed feature with defaults', () => {
  const a = AbilitySchema.parse(woodlandArcher);
  expect(a.kind).toBe('feature');
  if (a.kind !== 'feature') throw new Error('kind');
  expect(a.acquired).toEqual({ kind: 'feat' });
  expect(a.activations).toEqual([]);
  expect(a.pools).toEqual([]);
  expect(a.enabledByDefault).toBe(true);
  expect(a.effects[0]).toMatchObject({ trigger: 'always' });
});

test('item requires item meta; activation defaults; charges is optional (at will)', () => {
  expect(AbilitySchema.safeParse({ id: 'x', name: 'X', kind: 'item' }).success).toBe(false);
  const hog = AbilitySchema.parse({
    id: 'hand-of-glory', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' },
    effects: [{ id: 'slot', do: [{ verb: 'slot', slot: 'ring' }] }],
    activations: [
      { id: 'hog-daylight', name: 'Daylight', charges: { max: 1 }, spell: 'daylight' },
      { id: 'hog-torch', name: 'Torch', action: 'free' },
    ],
  });
  expect(activationsOf(hog)[0]).toMatchObject({ id: 'hog-daylight', action: 'standard', charges: { max: 1, resetOn: 'day' }, cost: [], onUse: [], whileActive: [] });
  expect(activationsOf(hog)[1]!.charges).toBeUndefined();
  expect(poolsOf(hog)).toEqual([]);
});

test('spell and status carry only their own fields', () => {
  const s = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', level: 3, duration: { minutes: 50 } });
  expect(s).toMatchObject({ kind: 'spell', castingAction: 'standard', level: 3 });
  expect(AbilitySchema.safeParse({ id: 'd', name: 'D', kind: 'spell', activations: [] }).success).toBe(false);
  const st = AbilitySchema.parse({ id: 'shaken', name: 'Shaken', kind: 'status', harmful: true, effects: [{ id: 's', do: [{ verb: 'modify', to: 'attack', value: -2 }] }] });
  expect(st).toMatchObject({ kind: 'status', harmful: true });
  expect(activationsOf(st)).toEqual([]);
});

test('rejects dropped vocabulary: origin, binding, old durations, old resets, old triggers', () => {
  expect(AbilitySchema.safeParse({ ...woodlandArcher, origin: 'feat' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ ...woodlandArcher, binding: 'none' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'h', name: 'H', kind: 'status', duration: 'endOfRound' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'i', name: 'I', kind: 'item', item: { category: 'gear' }, activations: [{ id: 'a', charges: { max: 1, resetOn: 'rest' } }] }).success).toBe(false);
  expect(AbilitySchema.safeParse({ ...woodlandArcher, effects: [{ id: 'e', trigger: 'onUse', do: [{ verb: 'note', text: 'x' }] }] }).success).toBe(false);
});

test('rejects unknown condition forms and bad selectors', () => {
  expect(ConditionSchema.safeParse({ kind: 'target.isRed' }).success).toBe(false);
  expect(ConditionSchema.safeParse({ is: 'nowhere.x' }).success).toBe(false);
  expect(ConditionSchema.safeParse({ is: 'target.tag.red' }).success).toBe(true);
});

test('battle has statuses and buffs carry activation id and expiry', () => {
  const b = BattleSchema.parse({ id: 'b', startedAt: 'now', activeBuffs: [{ instanceId: 'x', abilityId: 'boots', activationId: 'boots-rounds', expires: 'untilMyNextTurn', remainingRounds: 1 }] });
  expect(b.statuses).toEqual([]);
  expect(b.activeBuffs[0]).toMatchObject({ activationId: 'boots-rounds', expires: 'untilMyNextTurn', suppressed: false });
});

test('pack parses v3 records', () => {
  const r = PackSchema.safeParse({ id: 'p', name: 'P', version: 1, tags: [{ id: 'aquatic', label: 'Aquatic', category: 'habitat' }], abilities: [woodlandArcher] });
  expect(r.success).toBe(true);
});
