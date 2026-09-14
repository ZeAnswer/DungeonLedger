import { findResourceDef, targetTags, targetTagsInCategory, type EvalContext } from './context';
import type { Battle, HistoryFilter, LogEvent } from './schema';

function inScope(e: LogEvent, battle: Battle, scope: HistoryFilter['scope']): boolean {
  switch (scope) {
    case 'thisRound': case 'thisAttackSequence': return e.round === battle.round;
    case 'lastRound': return e.round === battle.round - 1;
    default: return true;
  }
}

/** Count battle-log events matching a history filter. Missing battle or target → 0. */
export function countHistory(ctx: EvalContext, f: HistoryFilter): number {
  const b = ctx.battle;
  if (!b) return 0;
  if (f.vs !== 'any' && !ctx.target) return 0;
  const sameCategory = (id: string | undefined) => {
    if (!ctx.target || !f.category) return false;
    const c = b.combatants.find((x) => x.id === id);
    const wanted = new Set(targetTagsInCategory(ctx, ctx.target, f.category));
    return !!c && targetTagsInCategory(ctx, c, f.category).some((t) => wanted.has(t));
  };
  const vsOk = (id: string | undefined) => (f.vs === 'any' ? true : f.vs === 'current' ? id === ctx.target!.id : sameCategory(id));
  let n = 0;
  for (const e of b.log) {
    if (!inScope(e, b, f.scope)) continue;
    const byMe = e.actor === 'self';
    if (f.by === 'me' && !byMe) continue;
    if (f.by === 'target' && (byMe || (ctx.target && e.actor !== ctx.target.id))) continue;
    switch (f.event) {
      case 'attack': if (!((e.kind === 'attack' && vsOk(e.targetId)) || (e.kind === 'enemy' && vsOk(e.actor)))) continue; break;
      case 'hit': if (!((e.kind === 'attack' && (e.result === 'hit' || e.result === 'crit') && vsOk(e.targetId)) || (e.kind === 'enemy' && (e.result === 'hit' || e.result === 'crit') && vsOk(e.actor)))) continue; break;
      case 'miss': if (!((e.kind === 'attack' && e.result === 'miss' && vsOk(e.targetId)) || (e.kind === 'enemy' && e.result === 'miss' && vsOk(e.actor)))) continue; break;
      case 'crit': if (!((e.kind === 'attack' && e.result === 'crit' && vsOk(e.targetId)) || (e.kind === 'enemy' && e.result === 'crit' && vsOk(e.actor)))) continue; break;
      case 'damaged': if (!(e.kind === 'enemy' && (e.damage ?? 0) > 0 && vsOk(e.actor))) continue; break;
      case 'used': if (!(e.kind === 'use' && (!f.abilityId || e.abilityId === f.abilityId || e.activationId === f.abilityId) && (f.vs === 'any' || vsOk(e.targetId)))) continue; break;
      case 'activated': if (!(e.kind === 'activate' && (!f.abilityId || e.abilityId === f.abilityId))) continue; break;
      case 'moved': if (e.kind !== 'move') continue; break;
    }
    n++;
  }
  // 'day' scope: also count today's uses recorded on the character (previous battles)
  if (f.scope === 'day' && f.event === 'used' && f.abilityId && f.vs === 'any') {
    const def = findResourceDef(ctx, f.abilityId);
    if (def && def.def.resetOn === 'day') n = Math.max(n, ctx.character.resourceState[def.def.id]?.used ?? 0);
  }
  return n;
}

export function isFirstAttackThisRound(battle: Battle, actor = 'self'): boolean {
  return !battle.log.some((e) => e.kind === 'attack' && e.round === battle.round && e.actor === actor);
}

export { targetTags };
