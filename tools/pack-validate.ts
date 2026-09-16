/**
 * Validates every packs/*.json: schema, cross-references (abilities, tags, skills, classes),
 * every rules-v4 script (it compiles, its `fn` and `params` references resolve, its custom events
 * are emitted somewhere), and that every expression evaluates for each character.
 * Run: npm run validate-packs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PackSchema, compile, emptyLibrary, mergePack, evalExpr, exprVars, resolveStat, resolveAttack, listAttackModes, attackProfiles, activationsOf, poolsOf, type EvalContext, type Pack, type Script } from '../packages/engine/src';

const dir = new URL('../packs/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const problems: string[] = [];
const warnings: string[] = [];
let lib = emptyLibrary();
const parsed: Pack[] = [];

for (const f of files) {
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const r = PackSchema.safeParse(raw);
  if (!r.success) { problems.push(`${f}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`); continue; }
  parsed.push(r.data);
  const m = mergePack(lib, r.data);
  lib = m.library;
  for (const c of m.report.conflicts) problems.push(`${f}: conflict ${c.key} (already from ${c.existingPack})`);
  console.log(`${f}: +${m.report.added.length} added, ${m.report.updated.length} updated, ${m.report.conflicts.length} conflicts`);
}

const monsters = (lib as { monsters?: Record<string, unknown> }).monsters ?? {};
const characters = (lib as { characters?: Record<string, Pack['characters'][number]> }).characters ?? {};

// ---------- rules v4: scripts ----------
// Static checks only. A script's *strings* — tag, skill, stat and record ids inside `bonus('skill.spot', …)`,
// `target.is('aquatic')`, `grant('haste')` — are deliberately NOT resolved here: they are ordinary values a
// script may also compute at runtime, and the engine validates them when it runs (StatIdSchema, BonusTypeSchema,
// library lookups). What is checked is what can be known without running: the source parses, every function it
// calls exists with its required arguments, and every `params.x` it reads is declared on the record.
const FN_REF = /\bfn\.([A-Za-z_][\w-]*)|fn\[['"]([^'"]+)['"]\]/g;
const PARAM_REF = /\bparams\.([A-Za-z_][\w-]*)|params\[['"]([^'"]+)['"]\]/g;
const emitted = new Set<string>(); // every `emit('name')` found in any script or function
const customEvents = new Map<string, string[]>(); // custom event name → the scripts listening for it
/** Which pack defines each function: a pack may only call its own functions and the core pack's. */
const CORE = 'core-3.5e';
const fnPack = new Map<string, string>();
for (const p of parsed) for (const f of p.functions) if (!fnPack.has(f.id)) fnPack.set(f.id, p.id);

let compiled = 0;
/** Compiles one source and checks its `fn.<id>` references; `params` are checked only where a record owns them. */
const checkSource = (packId: string, owner: string, source: string, paramNames: string[] = [], declaredParams?: Set<string>) => {
  if (!source.trim()) return;
  compiled++;
  const c = compile(source, paramNames);
  if (!c.ok) { problems.push(`${owner}: ${c.error}${c.line !== undefined ? ` (line ${c.line})` : ''}`); return; }
  for (const e of c.emits) emitted.add(e);
  for (const m of source.matchAll(FN_REF)) {
    const id = m[1] ?? m[2]!;
    const from = fnPack.get(id);
    if (!from) problems.push(`${owner}: unknown function "fn.${id}"`);
    else if (from !== packId && from !== CORE) problems.push(`${owner}: calls "fn.${id}", defined in pack "${from}" — a pack may only call its own functions or ${CORE}'s`);
  }
  if (!declaredParams) return;
  for (const m of source.matchAll(PARAM_REF)) {
    const name = m[1] ?? m[2]!;
    if (!declaredParams.has(name)) problems.push(`${owner}: reads params.${name}, which the record does not declare`);
  }
};

/** A stored call (`script.call`) is the form the function editor round-trips; it compiles to `fn["id"]({ … })`. */
const checkCall = (packId: string, owner: string, call: NonNullable<Script['call']>, declaredParams: Set<string>) => {
  const def = lib.functions[call.fn];
  if (!def) { problems.push(`${owner}: calls unknown function "${call.fn}"`); return; }
  const known = new Set(def.params.map((p) => p.name));
  for (const name of Object.keys(call.args)) if (!known.has(name)) problems.push(`${owner}: ${def.id} has no parameter "${name}"`);
  for (const p of def.params) if (p.required && call.args[p.name] === undefined && p.default === undefined) problems.push(`${owner}: call to ${def.id} is missing required argument "${p.name}"`);
  // `ref` and `expr` arguments are spliced into the generated source, so compile them the way the engine will.
  const parts = def.params.map((p) => { const a = call.args[p.name]; return a ? `${p.name}: ${a.k === 'lit' ? JSON.stringify(a.v) : a.v}` : undefined; }).filter((x) => x !== undefined);
  checkSource(packId, owner, `fn[${JSON.stringify(def.id)}]({ ${parts.join(', ')} });`, [], declaredParams);
};

const checkScripts = (packId: string, owner: string, scripts: Script[], declaredParams: Set<string>) => {
  for (const s of scripts) {
    const id = `${owner}/${s.id}`;
    if (s.call) checkCall(packId, id, s.call, declaredParams);
    checkSource(packId, id, s.source, [], declaredParams);
    for (const e of s.events) if (e.startsWith('custom:')) customEvents.set(e.slice(7), [...(customEvents.get(e.slice(7)) ?? []), id]);
  }
};

// Scripts are checked per pack, not over the merged library, so every `fn.<id>` can be judged against
// the pack that owns the record: a pack that calls another pack's function breaks when installed alone.
for (const p of parsed) {
  for (const f of p.functions) checkSource(p.id, `${p.id} function ${f.id}`, f.source, f.params.map((x) => x.name));
  for (const a of p.abilities) {
    const declaredParams = new Set(Object.keys(a.params ?? {}));
    checkScripts(p.id, `${p.id} ability ${a.id}`, a.scripts, declaredParams);
    for (const act of activationsOf(a)) checkScripts(p.id, `${p.id} ability ${a.id}/${act.id}`, act.scripts, declaredParams);
  }
}

const resourceIds = new Map<string, string>(); // activation ids and pool ids share one namespace (findResourceDef looks in both)
for (const a of Object.values(lib.abilities)) {
  const poolIds = new Set(poolsOf(a).map((p) => p.id));
  for (const p of poolsOf(a)) {
    const prev = resourceIds.get(p.id);
    if (prev) problems.push(`${a.id}: pool id "${p.id}" already used by ${prev}`); else resourceIds.set(p.id, a.id);
  }
  for (const act of activationsOf(a)) {
    const prev = resourceIds.get(act.id);
    if (prev) problems.push(`${a.id}: activation id "${act.id}" already used by ${prev}`); else resourceIds.set(act.id, a.id);
    if (act.spell && lib.abilities[act.spell]?.kind !== 'spell') problems.push(`${a.id}/${act.id}: spell "${act.spell}" is not a spell record`);
    for (const c of act.cost) {
      if (c.kind === 'charge' && !poolIds.has(c.resourceId) && !Object.values(lib.abilities).some((x) => poolsOf(x).some((p) => p.id === c.resourceId) || activationsOf(x).some((y) => y.id === c.resourceId && y.charges))) problems.push(`${a.id}/${act.id}: charge cost unknown pool "${c.resourceId}"`);
      if (c.kind === 'item' && lib.abilities[c.abilityId]?.kind !== 'item') problems.push(`${a.id}/${act.id}: item cost "${c.abilityId}" is not an item`);
    }
  }
}
// A listener with no emitter is a warning, not an error: the emitter may live in another pack or in the app.
for (const [name, listeners] of customEvents) if (!emitted.has(name)) warnings.push(`custom event "${name}" is listened for by ${listeners.join(', ')} but nothing emits it`);

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
    // Values inside scripts are JavaScript, not `ExprSchema` strings: they are compiled above and run by the engine.
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

// A green run says what it actually looked at, so "0 problems" is never mistaken for "nothing ran".
console.log(`\ncross-reference checks: ${compiled} script sources compiled (records, activations, ${Object.keys(lib.functions).length} functions), fn/call references resolvable from the calling pack (own or core) with their required arguments, params.<x> declared on the record, custom events emitted, activation and pool id uniqueness, charge and pool expressions, character classes/skills/ability params, every stat and attack mode resolved. Not checked statically: tag, skill and stat ids written as strings inside a script.`);
if (warnings.length) console.warn('\nWARNINGS:\n' + warnings.map((w) => ' - ' + w).join('\n'));
if (problems.length) { console.error('\nPROBLEMS:\n' + problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
console.log(`\nOK: ${Object.keys(lib.functions).length} functions, ${Object.keys(lib.abilities).length} abilities, ${Object.keys(lib.tags).length} tags, ${Object.keys(lib.skills).length} skills, ${Object.keys(monsters).length} monsters, ${Object.keys(characters).length} characters`);
