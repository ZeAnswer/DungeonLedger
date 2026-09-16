import { activationsOf, poolsOf, type Ability, type AttackKind, type AttackProfile, type Battle, type Character, type ClassTable, type Combatant, type Expr, type FunctionDef, type ResetOn, type Skill, type Tag, type VarValue } from './schema';
export type { ResetOn };

export type Library = {
  abilities: Record<string, Ability>;
  tags: Record<string, Tag>;
  skills: Record<string, Skill>;
  classTables: Record<string, ClassTable>;
  xpTable: { level: number; xp: number }[];
  functions: Record<string, FunctionDef>;
  globals: Record<string, VarValue>;
};

export type AttackCtx = {
  profile: AttackProfile;
  kind: AttackKind;
  /** 1-based attack number within the sequence */
  index: number;
  modeId: string;
  /** Library id of the weapon item this profile comes from, if any. */
  weaponAbilityId?: string;
};

export type AbilityInstance = Character['abilities'][number];

export type EvalContext = {
  character: Character;
  library: Library;
  battle?: Battle;
  target?: Combatant;
  attack?: AttackCtx;
  /** The character's instance of the ability currently being evaluated (for params). */
  abilityInstance?: AbilityInstance;
  /** Damage just dealt (for DC formulas and hp effects in triggers). */
  lastDamage?: number;
};

export const SIZE_ORDER = ['fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'] as const;
export const HURT_ORDER = ['unhurt', 'scratched', 'bloodied', 'nearDeath'] as const;

/** 3.5e size modifier to attack rolls and AC. */
export const SIZE_MOD: Record<(typeof SIZE_ORDER)[number], number> = {
  fine: 8, diminutive: 4, tiny: 2, small: 1, medium: 0, large: -1, huge: -2, gargantuan: -4, colossal: -8,
};

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** All tags on a combatant, including active conditions. */
export function targetTags(target: Combatant): string[] {
  return [...target.tags, ...target.conditions.map((c) => c.tag)];
}

/** The target's tag(s) in a given category, e.g. its creature type. */
export function targetTagsInCategory(ctx: EvalContext, target: Combatant, category: string): string[] {
  return targetTags(target).filter((t) => ctx.library.tags[t]?.category === category);
}

/** Key under which a per-category prompt value is stored, e.g. "knowledge:aberration". */
export function promptKey(ctx: EvalContext, promptId: string, perTagCategory?: string, target = ctx.target): string | undefined {
  if (!perTagCategory) return promptId;
  if (!target) return undefined;
  const cat = targetTagsInCategory(ctx, target, perTagCategory)[0];
  return cat ? `${promptId}:${cat}` : undefined;
}

export type ResourceDef = { id: string; label?: string; max: Expr; resetOn: ResetOn };

/** A charge definition by pool id, activation id, or record id (first activation with charges, else first pool). */
export function findResourceDef(ctx: EvalContext, id: string): { def: ResourceDef; abilityId: string } | undefined {
  const records = [...Object.values(ctx.library.abilities), ...(ctx.battle?.statuses ?? [])];
  for (const a of records) {
    for (const act of activationsOf(a)) if (act.id === id && act.charges) return { def: { id: act.id, ...(act.charges.label ? { label: act.charges.label } : {}), max: act.charges.max, resetOn: act.charges.resetOn }, abilityId: a.id };
    for (const p of poolsOf(a)) if (p.id === id) return { def: p, abilityId: a.id };
  }
  const rec = ctx.library.abilities[id];
  if (rec) {
    const act = activationsOf(rec).find((x) => x.charges);
    if (act) return findResourceDef(ctx, act.id);
    const pool = poolsOf(rec)[0];
    if (pool) return { def: pool, abilityId: rec.id };
  }
  return undefined;
}

/** Where a resource's usage counter lives: round/encounter on the battle, everything else on the character. */
export function resourceUsed(ctx: EvalContext, resourceId: string, resetOn: ResetOn): number {
  if (resetOn === 'round') return ctx.battle?.roundResources[resourceId] ?? 0;
  if (resetOn === 'encounter') return ctx.battle?.encounterResources[resourceId] ?? 0;
  return ctx.character.resourceState[resourceId]?.used ?? 0;
}
