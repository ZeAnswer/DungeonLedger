import { findResourceDef, resourceUsed, type EvalContext, type ResetOn } from './context';
import type { Battle, Character } from './schema';

type State = { battle: Battle; character: Character };

/** How often a resource resets; unknown pools fall back to per-day. */
export function findPer(ctx: EvalContext, resourceId: string): ResetOn {
  return findResourceDef(ctx, resourceId)?.def.resetOn ?? 'day';
}

/**
 * Spend (`delta > 0`), restore (`delta < 0`) or `set` a resource's used-count, immutably.
 * Round and encounter pools live on the battle; everything longer lives on the character.
 */
export function changeResource(ctx: EvalContext, state: State, resourceId: string, delta: number, set?: number): State {
  const per = findPer({ ...ctx, battle: state.battle }, resourceId);
  const current = resourceUsed({ ...ctx, battle: state.battle, character: state.character }, resourceId, per);
  const used = Math.max(0, set !== undefined ? set : current + delta);
  if (per === 'round' || per === 'encounter') {
    const key = per === 'encounter' ? 'encounterResources' : 'roundResources';
    return { ...state, battle: { ...state.battle, [key]: { ...state.battle[key], [resourceId]: used } } };
  }
  return { ...state, character: { ...state.character, resourceState: { ...state.character.resourceState, [resourceId]: { used } } } };
}
