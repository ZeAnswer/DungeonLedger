import { useMemo } from 'react';
import { activationsOf, compile, type EvalContext } from '@hl/engine';
import { ctxLibrary, useStore } from './store';

export function useCtx(): EvalContext | undefined {
  const character = useStore((s) => s.character);
  const library = useStore((s) => s.library);
  const globals = useStore((s) => s.globals);
  const battle = useStore((s) => s.battle);
  const targetId = useStore((s) => s.targetId);
  // Not read below: flipping safe mode changes script mode and clears the engine's compute cache
  // (see `setSafeMode`), but none of the fields above change identity when that happens. Including
  // it here forces a fresh `ctx` object so every `useMemo` keyed on `ctx` re-runs and picks up the
  // new script mode immediately, instead of only after something else remounts the screen.
  const safeMode = useStore((s) => s.safeMode);
  return useMemo(() => {
    if (!character) return undefined;
    const target = battle?.combatants.find((c) => c.id === targetId);
    return { character, library: ctxLibrary({ library, globals }), ...(battle ? { battle } : {}), ...(target ? { target } : {}) };
  }, [character, library, globals, battle, targetId, safeMode]);
}

/**
 * Every manual switch the character's active scripts read (`battle.on('<id>')` or `battle.toggles.<id>`), for the chips above
 * the attack rows. The engine's instrumenter already finds them while compiling, and `compile` caches by
 * source, so re-scanning on every render costs a Map lookup per script.
 */
export function collectToggles(ctx: EvalContext): { id: string; abilities: string[] }[] {
  const map = new Map<string, Set<string>>();
  const scan = (source: string, abilityName: string) => {
    if (!source.trim()) return;
    const c = compile(source);
    if (!c.ok) return;
    for (const id of c.toggles) {
      const e = map.get(id) ?? new Set<string>();
      e.add(abilityName);
      map.set(id, e);
    }
  };
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const a = ctx.library.abilities[inst.abilityId];
    if (!a) continue;
    for (const s of a.scripts) if (s.enabled) scan(s.source, a.name);
    for (const act of activationsOf(a)) for (const s of act.scripts) if (s.enabled) scan(s.source, a.name);
  }
  return [...map.entries()].map(([id, abilities]) => ({ id, abilities: [...abilities] }));
}
