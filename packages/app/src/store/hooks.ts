import { useMemo } from 'react';
import { activationsOf, compile, type EvalContext, type Script } from '@hl/engine';
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
  const add = (id: string, abilityName: string) => {
    const e = map.get(id) ?? new Set<string>();
    e.add(abilityName);
    map.set(id, e);
  };
  const scan = (source: string, abilityName: string, paramNames?: string[]) => {
    if (!source.trim()) return undefined;
    const c = compile(source, paramNames);
    if (!c.ok) return undefined;
    for (const id of c.toggles) add(id, abilityName);
    return c;
  };
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const a = ctx.library.abilities[inst.abilityId];
    if (!a) continue;
    const scanScript = (s: Script) => {
      if (!s.enabled) return;
      if (s.call) {
        const call = s.call;
        const def = ctx.library.functions[call.fn];
        if (!def) return;
        const c = scan(def.source, a.name, def.params.map((p) => p.name));
        // A toggle name the function's own body can't know statically (it reads one of its params, e.g.
        // `bonusWhenSwitch`'s `battle.on(switchName)`) is still discoverable when this call passes it as
        // a plain literal string — `ref`/`expr` arguments stay undiscoverable, same as any other dynamic value.
        for (const name of c?.toggleParams ?? []) {
          const arg = call.args[name];
          if (arg?.k === 'lit' && typeof arg.v === 'string') add(arg.v, a.name);
        }
        return;
      }
      scan(s.source, a.name);
    };
    a.scripts.forEach(scanScript);
    for (const act of activationsOf(a)) act.scripts.forEach(scanScript);
  }
  return [...map.entries()].map(([id, abilities]) => ({ id, abilities: [...abilities] }));
}
