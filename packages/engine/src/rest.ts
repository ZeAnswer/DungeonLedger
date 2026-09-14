import { findResourceDef, resourceUsed, type EvalContext } from './context';
import { evalExpr } from './expr';
import { applyHp } from './hp';
import { derivedFromLevels } from './levels';
import { resolveStat } from './resolve';
import { activationsOf, poolsOf, type Battle, type Character, type ResetOn } from './schema';
import { exprVars } from './vars';

export type ChargeRow = { id: string; label: string; ownerId: string; ownerName: string; used: number; remaining: number; max: number; resetOn: ResetOn };

/** Every charge pool the character can spend: inline activation charges and record pools of enabled records, in sheet order. */
export function listCharges(ctx: EvalContext): ChargeRow[] {
  const out: ChargeRow[] = [];
  const vars = exprVars(ctx);
  const seen = new Set<string>();
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled) continue;
    const a = ctx.library.abilities[inst.abilityId];
    if (!a) continue;
    const push = (id: string, label: string, max: number, resetOn: ResetOn) => {
      if (seen.has(id)) return;
      seen.add(id);
      const used = resourceUsed(ctx, id, resetOn);
      out.push({ id, label, ownerId: a.id, ownerName: a.name, used, remaining: max - used, max, resetOn });
    };
    for (const act of activationsOf(a)) if (act.charges) push(act.id, act.charges.label ?? act.name ?? a.name, evalExpr(act.charges.max, vars), act.charges.resetOn);
    for (const p of poolsOf(a)) push(p.id, p.label ?? a.name, evalExpr(p.max, vars), p.resetOn);
  }
  return out;
}

export type RestState = { character: Character; battle?: Battle };

/** Set how many charges of a pool are spent, clamped to 0..max. Round/encounter pools live on the battle (no battle: no-op). */
export function setChargesUsed(ctx: EvalContext, id: string, used: number): RestState {
  const def = findResourceDef(ctx, id);
  if (!def) return { character: ctx.character, ...(ctx.battle ? { battle: ctx.battle } : {}) };
  const max = evalExpr(def.def.max, exprVars(ctx));
  const n = Math.max(0, Math.min(max, Math.round(used)));
  const per = def.def.resetOn;
  if (per === 'round' || per === 'encounter') {
    if (!ctx.battle) return { character: ctx.character };
    const key = per === 'encounter' ? 'encounterResources' : 'roundResources';
    return { character: ctx.character, battle: { ...ctx.battle, [key]: { ...ctx.battle[key], [def.def.id]: n } } };
  }
  return { character: { ...ctx.character, resourceState: { ...ctx.character.resourceState, [def.def.id]: { used: n } } }, ...(ctx.battle ? { battle: ctx.battle } : {}) };
}

export type RestKind = 'short' | 'long';

/**
 * Short rest (about an hour): per-encounter charges refill; nonlethal damage heals 1 per character level.
 * Long rest (a night): per-day charges refill (pools that never reset are kept); HP heals 1 per character level, capped at max; temp HP and nonlethal cleared.
 */
export function rest(ctx: EvalContext, kind: RestKind): RestState & { summary: string } {
  const level = Math.max(1, derivedFromLevels(ctx.character, ctx.library).level);
  const parts: string[] = [];
  let character = ctx.character;
  let battle = ctx.battle;
  if (battle && Object.keys(battle.encounterResources).length) { battle = { ...battle, encounterResources: {} }; parts.push('encounter charges restored'); }
  else if (kind === 'short') parts.push('encounter charges restored');
  if (kind === 'short') {
    if (character.hp.nonlethal > 0) { character = applyHp(character, { healNonlethal: level }); parts.push(`nonlethal −${Math.min(level, ctx.character.hp.nonlethal)}`); }
  } else {
    const keep: Character['resourceState'] = {};
    for (const [id, st] of Object.entries(character.resourceState)) if (findResourceDef(ctx, id)?.def.resetOn === 'never') keep[id] = st;
    character = { ...character, resourceState: keep };
    parts.push('daily charges restored');
    const max = resolveStat(ctx, 'hp.max').total;
    const before = character.hp.current;
    character = applyHp(character, { heal: level }, max);
    character = { ...character, hp: { ...character.hp, temp: 0, nonlethal: 0 } };
    const gained = character.hp.current - before;
    if (gained > 0) parts.push(`+${gained} hp`);
    if (ctx.character.hp.temp || ctx.character.hp.nonlethal) parts.push('temp and nonlethal cleared');
  }
  const summary = `${kind === 'short' ? 'Short rest' : 'Long rest'}: ${parts.join(', ')}`;
  character = { ...character, journal: [...character.journal, { at: new Date().toISOString(), kind: 'rest', text: summary }] };
  return { character, ...(battle ? { battle } : {}), summary };
}
