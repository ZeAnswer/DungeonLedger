// packages/engine/test/golden.test.ts — the v4 engine must reproduce the v3 numbers captured in Task 0.
import { readFileSync } from 'node:fs';
import { PackSchema, emptyLibrary, mergePack, resolveAttack, resolveStat, attackProfiles, listAttackModes, availableActions, logAttack, newBattle, addCombatant, setDistance, type EvalContext } from '../src';

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-v3.json', import.meta.url), 'utf8'));
let lib = emptyLibrary();
for (const f of ['core-3.5e', 'memento']) lib = mergePack(lib, PackSchema.parse(JSON.parse(readFileSync(new URL(`../../../packs/${f}.json`, import.meta.url), 'utf8')))).library;
const ch = (lib as { characters?: Record<string, EvalContext['character']> }).characters!['memento']!;

/**
 * Two eligibility flags — and only these two — mean something different in v4, by design (the
 * activation probe runs the activation's `always` scripts; v3 also counted its `onUse` blocks and
 * called the activation eligible as soon as *any* block's condition passed):
 * - `monster-blow`: its unconditional `onUse` block ("spend a charge") masked the activation's own
 *   gate, so v3 said "eligible" even with no target at all. v4 probes the gate and reports
 *   "Needs: target type is one of your chosen types".
 * - `monster-knowledge`: its `onUse` block's `when` (Knowledge check ≥ 16 → reveal) gated the whole
 *   action in v3, so the action read as ineligible until the check was entered. In v4 the action is
 *   always available; only the reveal inside it is conditional.
 * No number is affected: every attack line and stat below is compared strictly against the v3 capture.
 */
const ELIGIBILITY_CHANGED_IN_V4: Record<string, boolean> = { 'monster-blow': false, 'monster-knowledge': true };

for (const sc of golden.scenarios) test(`golden: ${sc.name}`, () => {
  let ctx: EvalContext = { character: ch, library: lib };
  if (sc.tags) {
    let battle = addCombatant(newBattle('g'), { name: 'T', tags: sc.tags, size: 'large' });
    if (sc.distance !== undefined) battle = setDistance(battle, battle.combatants[0]!.id, sc.distance);
    ctx = { ...ctx, battle, target: battle.combatants[0] };
    for (let i = 0; i < (sc.misses ?? 0); i++) {
      const r = logAttack(ctx, { targetId: ctx.target!.id, profileId: 'weapon:strong-arm-composite-longbow-1', modeId: 'full', attackIndex: i + 1, result: 'miss' });
      ctx = { ...ctx, battle: r.battle, character: r.character, target: r.battle.combatants[0] };
    }
  }
  const results = attackProfiles(ctx).flatMap((p) => listAttackModes(ctx, p.id).map((m) => {
    const r = resolveAttack(ctx, { profileId: p.id, modeId: m.modeId });
    return { profileId: p.id, modeId: m.modeId, attacks: r.attacks.map((a) => ({ attackBonus: a.attackBonus, damageFlat: a.damage.flat, damageDice: a.damage.dice.map((d) => d.dice), critRange: a.critRange, critMult: a.critMult })) };
  }));
  expect(results).toEqual(sc.results);
  expect(Object.fromEntries(Object.keys(sc.stats).map((s) => [s, resolveStat(ctx, s).total]))).toEqual(sc.stats);
  const expectedActions = (sc.actions as { activationId: string; usable: boolean; eligible: boolean }[])
    .map((a) => (a.activationId in ELIGIBILITY_CHANGED_IN_V4 ? { ...a, eligible: ELIGIBILITY_CHANGED_IN_V4[a.activationId]! } : a));
  expect(availableActions(ctx).map((a) => ({ activationId: a.activationId, usable: a.usable, eligible: a.eligible }))).toEqual(expectedActions);
});
