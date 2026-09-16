import type { EvalContext } from '../context';

/**
 * Stat resolution used by the script api and by `self.mod.*`, injected instead of imported:
 * `resolve.ts` runs the compute pass, so importing it here would close a cycle.
 * The engine entry point registers the real `resolveStat`; unregistered, reads throw
 * and callers that can fall back (selectors' `mod`) do.
 */
export type StatResolver = (ctx: EvalContext, stat: string) => { total: number };

let resolver: StatResolver | undefined;

export function setStatResolver(fn: StatResolver): void { resolver = fn; }
/** Callers that can fall back should branch on this rather than catching, so real resolver errors surface. */
export function hasStatResolver(): boolean { return !!resolver; }
export function resolveStatVia(ctx: EvalContext, stat: string): { total: number } {
  if (!resolver) throw new Error('stat resolver not registered');
  return resolver(ctx, stat);
}
