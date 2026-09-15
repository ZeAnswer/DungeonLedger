import { ROUND, MINUTE, HOUR, DAY, SIZE, HURT, toRounds, THIS_ATTACK } from '../../src/scripts/units';
test('time units in seconds and rounds', () => {
  expect([ROUND, MINUTE, HOUR, DAY]).toEqual([6, 60, 3600, 86400]);
  expect(toRounds(3 * ROUND)).toBe(3); expect(toRounds(50 * MINUTE)).toBe(500); expect(toRounds(1)).toBe(1); expect(toRounds(0)).toBe(0);
  expect(THIS_ATTACK).toBe('thisAttack');
});
test('size and hurt enums are ordinal numbers', () => {
  expect(SIZE.LARGE).toBe(5); expect(SIZE.MEDIUM < SIZE.LARGE).toBe(true); expect(HURT.BLOODIED).toBe(2); expect(HURT.NEAR_DEATH).toBe(3);
});
