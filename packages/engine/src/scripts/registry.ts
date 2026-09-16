import type { EvalContext } from '../context';

/**
 * Stat resolution used by the script api and by `self.mod.*`, injected instead of imported:
 * `resolve.ts` runs the compute pass, so importing it here would close a cycle.
 * The engine entry point registers the real `resolveStat`; unregistered, reads throw
 * and callers that can fall back (selectors' `mod`) do.
 */
export type StatResolver = (ctx: EvalContext, stat: string) => { total: number };

let resolver: StatResolver = () => { throw new Error('stat resolver not registered'); };

export function setStatResolver(fn: StatResolver): void { resolver = fn; }
export function resolveStatVia(ctx: EvalContext, stat: string): { total: number } { return resolver(ctx, stat); }
