import type { EvalContext } from '../context';
import { activationsOf, type Script } from '../schema';
import { makeApi, ScriptSkip, type Patch, type RunContext, type RunSource, type Trace } from './api';
import { Budget, ScriptTimeout } from './budget';
import { compile } from './compile';
import { diagnostics, getScriptMode } from './diagnostics';
import { newSink, type Sink } from './sink';

export type ScriptSource = RunSource & { kind: 'ability' | 'buff' | 'activation'; scripts: Script[] };

/** Every record/activation currently contributing scripts (same gating as the v3 activeSources). */
export function activeSources(ctx: EvalContext, warnings: string[] = []): ScriptSource[] {
  const out: ScriptSource[] = [];
  const seen = new Set<string>();
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  const push = (key: string, s: ScriptSource) => { if (!seen.has(key)) { seen.add(key); out.push(s); } };
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) { warnings.push(`Unknown ability "${inst.abilityId}" on character; ignored.`); continue; }
    if (ability.kind === 'status' || ability.kind === 'spell') continue; // only while active
    push(ability.id, { ability, instance: inst, kind: 'ability', scripts: ability.scripts, label: ability.name });
  }
  for (const buff of ctx.battle?.activeBuffs ?? []) {
    if (buff.owner !== 'self' || buff.suppressed || suppressed.has(buff.abilityId)) continue;
    const ability = ctx.library.abilities[buff.abilityId] ?? ctx.battle?.statuses.find((s) => s.id === buff.abilityId);
    if (!ability) { warnings.push(`Unknown buff "${buff.abilityId}"; ignored.`); continue; }
    const instance = ctx.character.abilities.find((a) => a.abilityId === buff.abilityId);
    if (buff.activationId) {
      const activation = activationsOf(ability).find((x) => x.id === buff.activationId);
      if (!activation) { warnings.push(`${ability.name} has no activation "${buff.activationId}"; ignored.`); continue; }
      const spell = activation.spell ? ctx.library.abilities[activation.spell] : undefined;
      push(`${ability.id}/${activation.id}`, {
        ability, instance, activation, kind: 'activation',
        scripts: [...activation.scripts, ...(spell?.kind === 'spell' ? spell.scripts : [])],
        label: activation.name ?? spell?.name ?? ability.name,
      });
    } else push(ability.id, { ability, instance, kind: 'buff', scripts: ability.scripts, label: ability.name });
  }
  return out;
}

/**
 * Run order: `priority` ascending, then the record's kind (feature, item, spell, status), then the
 * order `activeSources` produced — character abilities in sheet order, then active buffs in order.
 * `Array.prototype.sort` is stable, so equal keys keep that source order.
 */
const KIND_ORDER = { feature: 0, item: 1, spell: 2, status: 3 } as const;
function ordered(sources: ScriptSource[]): { src: ScriptSource; script: Script }[] {
  const rows = sources.flatMap((src) => src.scripts.map((script) => ({ src, script })));
  return rows.sort((a, b) => a.script.priority - b.script.priority || KIND_ORDER[a.src.ability.kind] - KIND_ORDER[b.src.ability.kind]);
}

/** character → battle → library → pass key. A library edit (new object) is a new pass, like a new character. */
type Cache = WeakMap<object, WeakMap<object, WeakMap<object, Map<string, Sink>>>>;
let cache: Cache = new WeakMap();
const NO_BATTLE = {};
const passKey = (ctx: EvalContext) => {
  const a = ctx.attack;
  return `${getScriptMode()}|${ctx.target?.id ?? '-'}|${a ? `${a.profile.id}:${a.modeId}:${a.index}:${a.kind}` : '-'}|${ctx.lastDamage ?? ''}`;
};

/**
 * Run every `always` script once for this context and collect what they contribute.
 * Cached by identity of character, battle and library plus the target/attack key: a new (immutable)
 * character, battle or library object is a new pass. The sink is put in the cache *before* the scripts
 * run, so a script that reads a stat — which resolves through the pass again — sees what earlier
 * scripts contributed instead of recursing forever.
 *
 * `ctx.abilityInstance` is deliberately *not* part of the key and not used by the pass: `runOne` sets
 * the instance of each source itself, so the sink does not depend on which record the caller was
 * looking at — and a stat read from inside a script (whose context carries that record's instance)
 * lands on the same cached pass instead of starting a second one.
 */
export function computePass(ctx: EvalContext): Sink {
  let byBattle = cache.get(ctx.character);
  if (!byBattle) { byBattle = new WeakMap(); cache.set(ctx.character, byBattle); }
  const bkey: object = ctx.battle ?? NO_BATTLE;
  let byLibrary = byBattle.get(bkey);
  if (!byLibrary) { byLibrary = new WeakMap(); byBattle.set(bkey, byLibrary); }
  let byKey = byLibrary.get(ctx.library);
  if (!byKey) { byKey = new Map(); byLibrary.set(ctx.library, byKey); }
  const key = passKey(ctx);
  const hit = byKey.get(key);
  if (hit) return hit;
  const sink = newSink();
  byKey.set(key, sink); // partial sink is visible to nested stat reads (re-entrancy)
  if (getScriptMode() === 'off') return sink;
  const base = ctx.abilityInstance === undefined ? ctx : { ...ctx, abilityInstance: undefined };
  const sources = activeSources(base, sink.warnings);
  for (const { src, script } of ordered(sources)) {
    if (!script.enabled || !script.events.includes('always')) continue;
    runOne(base, { phase: 'always', source: src, script }, sink, []);
  }
  return sink;
}

/**
 * Drop every cached pass. The cache keys on character/battle/library identity, so editing a record in
 * place (or changing globals without replacing the library object) still needs this hammer.
 */
export function clearComputeCache(): void {
  cache = new WeakMap();
}

export type RunOutcome = 'ok' | 'skipped' | 'error';

/**
 * Compile (or synthesize from `call`) and run one script; errors go to the sink and diagnostics, skips
 * to `sink.skipped`. The outcome tells the caller whether the script finished: a skipped or failed
 * script must not leave half its patches behind.
 */
export function runOne(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[]): RunOutcome {
  const key = [run.source.ability.id, run.source.activation?.id, run.script.id].filter(Boolean).join('/');
  if (!run.probe && diagnostics.quarantined(key)) return 'error';
  const near = (failed: string) => sink.skipped.push({ source: run.source.ability.id, sourceName: run.source.label, label: run.script.label ?? run.source.label, summary: '', failed });
  const fail = (phase: 'compile' | 'run', message: string, line?: number) => {
    const e = { recordId: run.source.ability.id, scriptId: run.script.id, label: run.script.label ?? run.source.label, phase, message, ...(line !== undefined ? { line } : {}) };
    sink.errors.push(e);
    if (run.probe) return; // a probe run is not the script's real turn: it must not quarantine it
    diagnostics.record(e);
    diagnostics.noteFailure(key);
  };
  const source = run.script.call ? callSource(ctx, run.script.call) : run.script.source;
  if (source === undefined) { fail('compile', `unknown function "${run.script.call?.fn}"`); return 'error'; }
  const compiled = compile(source);
  if (!compiled.ok) { fail('compile', compiled.error, compiled.line); return 'error'; }
  const trace: Trace = { emitted: false };
  // A fresh budget per script run: a nested pass (a script reading a stat) must not reset the outer one.
  const budget = new Budget();
  // This record's own instance, so `sel('self.param.x')` and the api read this record's choices.
  const rctx: EvalContext = { ...ctx, abilityInstance: run.source.instance };
  const fns = fnTable(rctx, run, sink, patches, trace, 0, budget);
  const api = makeApi(rctx, { ...run, fns }, sink, patches, trace);
  budget.start(run.phase === 'always' ? 4 : 16);
  try {
    compiled.run(api, compiled.noguard ? () => {} : budget.tick);
  } catch (e) {
    if (e instanceof ScriptSkip) { near(e.because); return 'skipped'; }
    fail('run', e instanceof ScriptTimeout || e instanceof Error ? (e as Error).message : String(e));
    return 'error';
  }
  // Nothing contributed and the last predicate was false: that predicate is the "needs …" reason.
  if (run.phase === 'always' && !trace.emitted && trace.last && !trace.last.result) near(trace.last.text);
  return 'ok';
}

const startedBudget = () => { const b = new Budget(); b.start(16); return b; };

/** `fn.name({ args })`: compiled library functions sharing this run's sink, patches and budget. Depth-capped at 8. */
export function fnTable(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[], trace: Trace, depth: number, budget: Budget = startedBudget()): Record<string, (args: Record<string, unknown>) => void> {
  const table: Record<string, (args: Record<string, unknown>) => void> = {};
  for (const def of Object.values(ctx.library.functions ?? {})) {
    table[def.id] = (args = {}) => {
      if (depth >= 8) throw new Error(`function call depth exceeded at ${def.id} (recursive?)`);
      const compiled = compile(def.source, def.params.map((p) => p.name));
      if (!compiled.ok) throw new Error(`function ${def.id}: ${compiled.error}`);
      const filled: Record<string, unknown> = {};
      for (const p of def.params) {
        const v = args[p.name] ?? p.default;
        if (v === undefined && p.required) throw new Error(`function ${def.id}: missing argument "${p.name}"`);
        filled[p.name] = v;
      }
      const api = makeApi(ctx, { ...run, args: filled, fns: fnTable(ctx, run, sink, patches, trace, depth + 1, budget) }, sink, patches, trace);
      compiled.run(api, compiled.noguard ? () => {} : budget.tick);
    };
  }
  return table;
}

/** Synthesize the source for a stored function call: `fn["id"]({ a: <lit|ref|expr>, … })`. */
export function callSource(ctx: EvalContext, call: NonNullable<Script['call']>): string | undefined {
  const def = ctx.library.functions?.[call.fn];
  if (!def) return undefined;
  const parts = def.params
    .map((p) => { const a = call.args[p.name]; return a ? `${p.name}: ${a.k === 'lit' ? JSON.stringify(a.v) : a.v}` : undefined; })
    .filter((x): x is string => x !== undefined);
  return `fn[${JSON.stringify(def.id)}]({ ${parts.join(', ')} });`;
}
