// tools/golden-capture.ts — run BEFORE any engine change; output is the behavioural contract for v4.
import { readFileSync, writeFileSync } from 'node:fs';
import { PackSchema, emptyLibrary, mergePack, resolveAttack, resolveStat, attackProfiles, listAttackModes, availableActions, logAttack, newBattle, addCombatant, setDistance, type EvalContext } from '../packages/engine/src';

let lib = emptyLibrary();
for (const f of ['core-3.5e', 'memento']) lib = mergePack(lib, PackSchema.parse(JSON.parse(readFileSync(new URL(`../packs/${f}.json`, import.meta.url), 'utf8')))).library;
const ch = (lib as { characters?: Record<string, EvalContext['character']> }).characters!['memento']!;
const STATS = ['ac', 'ac.touch', 'ac.flatFooted', 'save.fort', 'save.ref', 'save.will', 'init', 'speed', 'hp.max', 'ability.str', 'ability.con', 'skill.spot', 'skill.survival', 'skill.swim', 'skill.knowledge-monsters'];

function scenario(name: string, opts: { tags?: string[]; distance?: number; misses?: number }) {
  let ctx: EvalContext = { character: ch, library: lib };
  if (opts.tags) {
    let battle = addCombatant(newBattle('g'), { name: 'T', tags: opts.tags, size: 'large' });
    if (opts.distance !== undefined) battle = setDistance(battle, battle.combatants[0]!.id, opts.distance);
    ctx = { ...ctx, battle, target: battle.combatants[0] };
    for (let i = 0; i < (opts.misses ?? 0); i++) { const r = logAttack(ctx, { targetId: ctx.target!.id, profileId: 'weapon:strong-arm-composite-longbow-1', modeId: 'full', attackIndex: i + 1, result: 'miss' }); ctx = { ...ctx, battle: r.battle, character: r.character, target: r.battle.combatants[0] }; }
  }
  const results = attackProfiles(ctx).flatMap((p) => listAttackModes(ctx, p.id).map((m) => { const r = resolveAttack(ctx, { profileId: p.id, modeId: m.modeId }); return { profileId: p.id, modeId: m.modeId, attacks: r.attacks.map((a) => ({ attackBonus: a.attackBonus, damageFlat: a.damage.flat, damageDice: a.damage.dice.map((d) => d.dice), critRange: a.critRange, critMult: a.critMult })) }; }));
  const stats = Object.fromEntries(STATS.map((s) => [s, resolveStat(ctx, s).total]));
  const actions = availableActions(ctx).map((a) => ({ activationId: a.activationId, usable: a.usable, eligible: a.eligible }));
  return { name, ...opts, results, stats, actions };
}

const out = { scenarios: [
  scenario('no target', {}),
  scenario('aberration at 20 ft', { tags: ['aberration'], distance: 20 }),
  scenario('aquatic aberration at 60 ft', { tags: ['aberration', 'aquatic'], distance: 60 }),
  scenario('monstrous humanoid after two misses', { tags: ['monstrous-humanoid'], distance: 20, misses: 2 }),
] };
writeFileSync(new URL('../packages/engine/test/fixtures/golden-v3.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`golden: ${out.scenarios.length} scenarios`);
