import { useMemo } from 'react';
import { activationsOf, type Condition, type EvalContext } from '@hl/engine';
import { useStore } from './store';

export function useCtx(): EvalContext | undefined {
  const character = useStore((s) => s.character);
  const library = useStore((s) => s.library);
  const battle = useStore((s) => s.battle);
  const targetId = useStore((s) => s.targetId);
  return useMemo(() => {
    if (!character) return undefined;
    const target = battle?.combatants.find((c) => c.id === targetId);
    return { character, library, ...(battle ? { battle } : {}), ...(target ? { target } : {}) };
  }, [character, library, battle, targetId]);
}

/** Every manual toggle id referenced by the character's active abilities (conditions `is battle.toggle.<id>`). */
export function collectToggles(ctx: EvalContext): { id: string; abilities: string[] }[] {
  const map = new Map<string, Set<string>>();
  const walk = (c: Condition, abilityName: string) => {
    if ('is' in c && c.is.startsWith('battle.toggle.')) {
      const id = c.is.slice('battle.toggle.'.length);
      const e = map.get(id) ?? new Set<string>();
      e.add(abilityName);
      map.set(id, e);
    } else if ('all' in c) c.all.forEach((x) => walk(x, abilityName));
    else if ('any' in c) c.any.forEach((x) => walk(x, abilityName));
    else if ('none' in c) c.none.forEach((x) => walk(x, abilityName));
    else if ('count' in c) c.count.forEach((x) => walk(x, abilityName));
    else if ('not' in c) walk(c.not, abilityName);
  };
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const a = ctx.library.abilities[inst.abilityId];
    if (!a) continue;
    for (const b of a.effects) walk(b.when, a.name);
    for (const act of activationsOf(a)) for (const b of [...act.onUse, ...act.whileActive]) walk(b.when, a.name);
  }
  return [...map.entries()].map(([id, abilities]) => ({ id, abilities: [...abilities] }));
}
