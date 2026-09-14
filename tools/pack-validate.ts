/**
 * Validates every packs/*.json: schema, cross-references (abilities, tags, skills, classes),
 * and that every expression evaluates for each character. Run: npm run validate-packs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PackSchema, emptyLibrary, mergePack, evalExpr, exprVars, resolveStat, resolveAttack, listAttackModes, attackProfiles, activationsOf, poolsOf, type EvalContext, type Pack } from '../packages/engine/src';

const dir = new URL('../packs/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const problems: string[] = [];
let lib = emptyLibrary();
const packs: Pack[] = [];

for (const f of files) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = PackSchema.safeParse(raw);
  if (!r.success) { problems.push(`${f}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`); continue; }
  packs.push(r.data);
  const m = mergePack(lib, r.data);
  lib = m.library;
  for (const c of m.report.conflicts) problems.push(`${f}: conflict ${c.key} (already from ${c.existingPack})`);
  console.log(`${f}: +${m.report.added.length} added, ${m.report.updated.length} updated, ${m.report.conflicts.length} conflicts`);
}

const monsters = (lib as { monsters?: Record<string, unknown> }).monsters ?? {};
const characters = (lib as { characters?: Record<string, Pack['characters'][number]> }).characters ?? {};

const checkSelector = (owner: string, sel: string) => {
  const p = sel.split('.');
  if (p[0] === 'target' && (p[1] === 'tag' || p[1] === 'condition') && !lib.tags[p.slice(2).join('.')]) problems.push(`${owner}: unknown tag in selector "${sel}"`);
  if (p[0] === 'self' && p[1] === 'tag' && !lib.tags[p.slice(2).join('.')]) problems.push(`${owner}: unknown tag in selector "${sel}"`);
  if (p[0] === 'self' && p[1] === 'skill' && !lib.skills[p.slice(2, -1).join('.')]) problems.push(`${owner}: unknown skill in selector "${sel}"`);
  if (p[0] === 'self' && p[1] === 'ability' && !lib.abilities[p.slice(2, -1).join('.')]) problems.push(`${owner}: unknown ability in selector "${sel}"`);
  if (p[0] === 'self' && p[1] === 'class' && !lib.classTables[p.slice(2, -1).join('.')]) problems.push(`${owner}: unknown class in selector "${sel}"`);
};
let owner = '';
const walk = (c: unknown): void => {
  if (!c || typeof c !== 'object') return;
  const o = c as Record<string, unknown>;
  for (const k of ['is', 'exists', 'compare', 'in']) if (typeof o[k] === 'string') checkSelector(owner, o[k] as string);
  if (Array.isArray(o.set)) for (const t of o.set as string[]) if (!lib.tags[t]) problems.push(`${owner}: unknown tag "${t}"`);
  for (const k of ['all', 'any', 'none', 'count']) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(walk);
  if (o.not) walk(o.not);
};
const activationIds = new Map<string, string>();
for (const a of Object.values(lib.abilities)) {
  owner = `ability ${a.id}`;
  const blocks = [...a.effects, ...activationsOf(a).flatMap((x) => [...x.onUse, ...x.whileActive])];
  for (const b of blocks) {
    walk(b.when);
    for (const e of b.do) {
      if (e.verb === 'modify' && e.to.startsWith('skill.') && !lib.skills[e.to.slice(6)]) problems.push(`${a.id}: unknown skill "${e.to}"`);
      if (e.verb === 'tag' && !lib.tags[e.tag]) problems.push(`${a.id}: tag verb unknown tag "${e.tag}"`);
      if ((e.verb === 'grant' || e.verb === 'suppress') && !lib.abilities[e.ability]) problems.push(`${a.id}: ${e.verb} unknown ability "${e.ability}"`);
    }
  }
  const poolIds = new Set(poolsOf(a).map((p) => p.id));
  for (const act of activationsOf(a)) {
    const prev = activationIds.get(act.id);
    if (prev) problems.push(`${a.id}: activation id "${act.id}" already used by ${prev}`); else activationIds.set(act.id, a.id);
    if (act.spell && lib.abilities[act.spell]?.kind !== 'spell') problems.push(`${a.id}/${act.id}: spell "${act.spell}" is not a spell record`);
    for (const c of act.cost) {
      if (c.kind === 'charge' && !poolIds.has(c.resourceId) && !Object.values(lib.abilities).some((x) => poolsOf(x).some((p) => p.id === c.resourceId) || activationsOf(x).some((y) => y.id === c.resourceId && y.charges))) problems.push(`${a.id}/${act.id}: charge cost unknown pool "${c.resourceId}"`);
      if (c.kind === 'item' && lib.abilities[c.abilityId]?.kind !== 'item') problems.push(`${a.id}/${act.id}: item cost "${c.abilityId}" is not an item`);
    }
  }
}
for (const m of Object.values(monsters) as { id: string; tags: string[] }[]) for (const t of m.tags) if (!lib.tags[t]) problems.push(`monster ${m.id}: unknown tag "${t}"`);

for (const ch of Object.values(characters)) {
  for (const cl of ch.classLevels) if (!lib.classTables[cl.classId]) problems.push(`character ${ch.id}: unknown class "${cl.classId}"`);
  for (const sk of Object.keys(ch.skills)) if (!lib.skills[sk]) problems.push(`character ${ch.id}: unknown skill "${sk}"`);
  const ctx: EvalContext = { character: ch, library: lib };
  const vars = exprVars(ctx);
  for (const inst of ch.abilities) {
    const a = lib.abilities[inst.abilityId];
    if (!a) { problems.push(`character ${ch.id}: unknown ability "${inst.abilityId}"`); continue; }
    for (const [p, def] of Object.entries(a.params ?? {})) {
      const vals = inst.paramValues[p];
      if (!vals?.length) problems.push(`character ${ch.id}: ${a.id} param "${p}" not chosen`);
      for (const v of vals ?? []) { const t = lib.tags[v]; if (!t) problems.push(`character ${ch.id}: ${a.id} param "${p}" unknown tag "${v}"`); else if (def.category && t.category !== def.category) problems.push(`character ${ch.id}: ${a.id} param "${p}" tag "${v}" is ${t.category}, expected ${def.category}`); }
    }
    for (const act of activationsOf(a)) { if (act.charges) { try { evalExpr(act.charges.max, vars); } catch (e) { problems.push(`${a.id}/${act.id}: ${(e as Error).message}`); } } }
    for (const p of poolsOf(a)) { try { evalExpr(p.max, vars); } catch (e) { problems.push(`${a.id} pool ${p.id}: ${(e as Error).message}`); } }
    for (const b of a.effects) for (const e of b.do) if (e.verb === 'modify' && typeof e.value === 'string') { try { evalExpr(e.value, vars); } catch (err) { problems.push(`${a.id}/${b.id}: ${(err as Error).message}`); } }
  }
  // smoke: every stat and attack mode resolves
  for (const stat of ['ac', 'ac.touch', 'ac.flatFooted', 'save.fort', 'save.ref', 'save.will', 'init', ...Object.keys(ch.skills).map((s) => `skill.${s}`)]) {
    const r = resolveStat(ctx, stat);
    for (const w of r.warnings) problems.push(`character ${ch.id} ${stat}: ${w}`);
  }
  for (const p of attackProfiles(ctx)) for (const m of listAttackModes(ctx, p.id)) {
    const r = resolveAttack(ctx, { profileId: p.id, modeId: m.modeId });
    console.log(`  ${ch.name} ${p.name} / ${m.label}: ${r.attacks.map((a) => `+${a.attackBonus}`).join('/')}  dmg ${r.attacks[0]?.damage.dice.map((d) => d.dice).join('+')}+${r.attacks[0]?.damage.flat}`);
  }
}

if (problems.length) { console.error('\nPROBLEMS:\n' + problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
console.log(`\nOK: ${Object.keys(lib.abilities).length} abilities, ${Object.keys(lib.tags).length} tags, ${Object.keys(lib.skills).length} skills, ${Object.keys(monsters).length} monsters, ${Object.keys(characters).length} characters`);
