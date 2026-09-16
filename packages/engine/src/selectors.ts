import { HURT_ORDER, SIZE_ORDER, abilityMod, findResourceDef, resourceUsed, targetTags, targetTagsInCategory, type EvalContext } from './context';
import { evalExpr } from './expr';
import { derivedFromLevels } from './levels';
import { resolveFlags, resolveStat } from './resolve';
import { countHistory } from './history';
import { resolveStatVia } from './scripts/registry';
import { ROUND } from './scripts/units';
import type { Ability } from './schema';

export type SelValue = number | boolean | string | string[] | undefined;

/** Ordinal scales for string-valued selectors so `compare` can use >= on them. */
export const ORDINALS: Record<string, readonly string[]> = { 'target.size': SIZE_ORDER, 'target.hurt': HURT_ORDER, 'self.size': SIZE_ORDER };

function equippedItems(ctx: EvalContext): { ability: Ability; entry: EvalContext['character']['inventory'][number] }[] {
  return ctx.character.inventory.filter((i) => i.equipped && i.abilityId).map((i) => ({ ability: ctx.library.abilities[i.abilityId!]!, entry: i })).filter((x) => !!x.ability);
}

function itemMeta(a: Ability | undefined) { return a && a.kind === 'item' ? a.item : undefined; }

/** Read a dot-path selector against the current context. Unknown paths return undefined. */
export function readSelector(ctx: EvalContext, sel: string): SelValue {
  const p = sel.split('.');
  const [domain, field] = p;
  const rest = p.slice(2).join('.');
  switch (domain) {
    case 'self': {
      const c = ctx.character;
      switch (field) {
        case 'stat': return resolveStat(ctx, rest).total;
        case 'skill': {
          const [id, what] = [p.slice(2, -1).join('.'), p[p.length - 1]];
          const d = derivedFromLevels(c, ctx.library);
          if (what === 'ranks') return c.skills[id]?.ranks ?? 0;
          if (what === 'classSkill') return d.isClassSkill(id);
          if (what === 'total') return resolveStat(ctx, `skill.${id}`).total;
          return undefined;
        }
        case 'class': { const id = p.slice(2, -1).join('.'); return c.classLevels.find((x) => x.classId === id)?.level ?? 0; }
        case 'tag': return !!ctx.battle?.selfConditions.some((x) => x.tag === rest);
        case 'tags': return ctx.battle?.selfConditions.map((x) => x.tag) ?? [];
        case 'ability': {
          const id = p.slice(2, -1).join('.'); const what = p[p.length - 1];
          const inst = c.abilities.find((a) => a.abilityId === id);
          const suppressed = !!ctx.battle?.suppressedAbilities.includes(id);
          if (what === 'enabled') return !!inst?.enabled && !suppressed;
          if (what === 'active') return !suppressed && !!ctx.battle?.activeBuffs.some((b) => (b.abilityId === id || b.activationId === id) && b.owner === 'self' && !b.suppressed);
          if (what === 'usesLeft' || what === 'used') {
            const def = findResourceDef(ctx, id); if (!def) return undefined;
            const max = evalExpr(def.def.max, exprVarsRaw(ctx)); const used = resourceUsed(ctx, def.def.id, def.def.resetOn);
            return what === 'used' ? used : max - used;
          }
          return undefined;
        }
        case 'resource': {
          const id = p.slice(2, -1).join('.'); const what = p[p.length - 1];
          const def = findResourceDef(ctx, id); if (!def) return undefined;
          const max = evalExpr(def.def.max, exprVarsRaw(ctx)); const used = resourceUsed(ctx, def.def.id, def.def.resetOn);
          return what === 'max' ? max : what === 'used' ? used : max - used;
        }
        case 'equipped': {
          const kind = p[2]; const key = p.slice(3).join('.');
          const eq = equippedItems(ctx);
          if (kind === 'item') return eq.some((x) => x.ability.id === key);
          if (kind === 'slot') return eq.filter((x) => itemMeta(x.ability)?.slot === key).length;
          if (kind === 'category') return eq.filter((x) => itemMeta(x.ability)?.category === key).length;
          if (kind === 'count' && p[3] === 'tag') { const tag = p.slice(4).join('.'); return eq.filter((x) => itemMeta(x.ability)?.tags.includes(tag)).length; }
          return undefined;
        }
        case 'param': {
          const fromInst = ctx.abilityInstance?.paramValues[rest];
          if (fromInst) return fromInst;
          for (const inst of c.abilities) if (inst.paramValues[rest]) return inst.paramValues[rest];
          return [];
        }
        case 'var': return c.vars[rest];
        case 'hp': return rest === 'max' ? resolveStat(ctx, 'hp.max').total : rest === 'temp' ? c.hp.temp : rest === 'nonlethal' ? c.hp.nonlethal : c.hp.current;
        case 'level': return derivedFromLevels(c, ctx.library).level;
        case 'bab': return derivedFromLevels(c, ctx.library).bab;
        case 'size': return c.size;
        case 'mod': {
          // effective score (items, buffs and scripts included); base score while no resolver is registered
          const key = rest as 'str';
          try { return abilityMod(resolveStatVia(ctx, `ability.${key}`).total); } catch { return abilityMod(c.abilityScores[key] ?? 10); }
        }
        default: return undefined;
      }
    }
    case 'target': {
      const t = ctx.target;
      if (field === 'exists') return !!t;
      if (!t) return undefined;
      switch (field) {
        case 'tags': return targetTags(t);
        case 'tag': return targetTags(t).includes(rest);
        case 'condition': return t.conditions.some((x) => x.tag === rest);
        case 'type': return targetTagsInCategory(ctx, t, 'creatureType')[0];
        case 'size': return t.size;
        case 'hurt': return t.hurt;
        case 'distance': return t.distanceFeet;
        case 'revealed': return t.revealed;
        case 'dead': return t.dead;
        case 'name': return t.name;
        default: return undefined;
      }
    }
    case 'attack': {
      const a = ctx.attack;
      if (field === 'exists') return !!a;
      if (!a) return undefined;
      switch (field) {
        case 'kind': return a.kind;
        case 'index': return a.index;
        case 'mode': return a.modeId;
        case 'isFirstThisRound': return !ctx.battle || !ctx.battle.log.some((e) => e.kind === 'attack' && e.round === ctx.battle!.round && e.actor === 'self');
        case 'weapon': {
          const w = a.weaponAbilityId ? ctx.library.abilities[a.weaponAbilityId] : undefined;
          if (rest === 'id') return a.weaponAbilityId;
          if (rest === 'category') return itemMeta(w)?.category;
          if (rest === 'tags') return itemMeta(w)?.tags ?? [];
          if (p[2] === 'tag') return !!itemMeta(w)?.tags.includes(p.slice(3).join('.'));
          return undefined;
        }
        default: return undefined;
      }
    }
    case 'battle': {
      const b = ctx.battle;
      switch (field) {
        case 'round': return b?.round ?? 1;
        case 'toggle': return !!b?.toggles[rest];
        case 'tag': return !!b?.tags?.includes(rest);
        case 'tags': return b?.tags ?? [];
        case 'elapsed': return ((b?.round ?? 1) - 1) * ROUND;
        case 'prompt': {
          if (!b) return undefined;
          if (b.prompts[rest] !== undefined) return b.prompts[rest];
          // per-category prompts are stored as "<id>:<tag>"; match on the current target's tags
          if (ctx.target) for (const t of targetTags(ctx.target)) if (b.prompts[`${rest}:${t}`] !== undefined) return b.prompts[`${rest}:${t}`];
          return undefined;
        }
        default: return undefined;
      }
    }
    case 'flag': return !!resolveFlags(ctx)[p.slice(1).join('.')];
    case 'history': {
      // history.<event>.<by>.<vs>.<scope>[.<abilityId>]
      const [, event, by = 'me', vs = 'current', scope = 'round', abilityId] = p;
      return countHistory(ctx, { event: event as 'hit', by: by as 'me', vs: vs as 'current', scope: scope as 'round', ...(abilityId ? { abilityId } : {}) });
    }
    default: return undefined;
  }
}

/** Expression variables without effective-score recursion (used inside selector reads). */
function exprVarsRaw(ctx: EvalContext) {
  const s = ctx.character.abilityScores;
  const d = derivedFromLevels(ctx.character, ctx.library);
  return {
    ...ctx.character.vars,
    strMod: abilityMod(s.str), dexMod: abilityMod(s.dex), conMod: abilityMod(s.con), intMod: abilityMod(s.int), wisMod: abilityMod(s.wis), chaMod: abilityMod(s.cha),
    level: d.level, bab: d.bab, round: ctx.battle?.round ?? 0,
    classLevel: Object.fromEntries(ctx.character.classLevels.map((c) => [c.classId, c.level])),
    prompt: ctx.battle?.prompts ?? {},
  };
}
