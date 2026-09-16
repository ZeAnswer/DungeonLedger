import type { EvalContext } from './context';
import { evalCondition } from './conditions';
import { activationsOf, type Condition, type Effect, type HistoryFilter } from './schema';

function tagLabel(ctx: EvalContext, id: string): string {
  return ctx.library.tags[id]?.label ?? id;
}

/** Name of a record or of an activation by id. */
export function nameOf(ctx: EvalContext, id: string): string {
  const rec = ctx.library.abilities[id] ?? ctx.battle?.statuses.find((s) => s.id === id);
  if (rec) return rec.name;
  for (const a of Object.values(ctx.library.abilities)) for (const act of activationsOf(a)) if (act.id === id) return act.name ?? a.name;
  return id;
}

/** Human phrase for a selector path. */
export function describeSelector(ctx: EvalContext, sel: string): string {
  const p = sel.split('.');
  const rest = p.slice(2).join('.');
  switch (p[0]) {
    case 'target':
      switch (p[1]) {
        case 'tag': return `target is ${tagLabel(ctx, rest)}`;
        case 'condition': return `target is ${tagLabel(ctx, rest)}`;
        case 'tags': return 'target type';
        case 'type': return 'target type';
        case 'size': return 'target size';
        case 'hurt': return 'target hurt';
        case 'distance': return 'target distance (ft)';
        case 'exists': return 'a target is selected';
        case 'revealed': return 'target lore revealed';
        default: return `target ${p.slice(1).join(' ')}`;
      }
    case 'self':
      switch (p[1]) {
        case 'tag': return `you are ${tagLabel(ctx, rest)}`;
        case 'ability': return `${nameOf(ctx, p.slice(2, -1).join('.'))} ${p[p.length - 1] === 'active' ? 'is active' : p[p.length - 1] === 'enabled' ? 'is enabled' : p[p.length - 1]}`;
        case 'resource': return `${p.slice(2, -1).join('.')} ${p[p.length - 1]}`;
        case 'equipped': return p[2] === 'item' ? `${nameOf(ctx, p.slice(3).join('.'))} equipped` : `equipped ${p.slice(2).join(' ')}`;
        case 'skill': return `${ctx.library.skills[p.slice(2, -1).join('.')]?.name ?? p[2]} ${p[p.length - 1]}`;
        case 'class': return `${ctx.library.classTables[p.slice(2, -1).join('.')]?.name ?? p[2]} level`;
        case 'stat': return rest;
        case 'param': return `your ${rest}`;
        case 'var': return rest;
        default: return sel;
      }
    case 'attack':
      switch (p[1]) {
        case 'kind': return 'attack kind';
        case 'isFirstThisRound': return 'first attack this round';
        case 'index': return 'attack number';
        case 'weapon': return p[2] === 'tag' ? `weapon is ${p.slice(3).join('.')}` : `weapon ${rest}`;
        case 'mode': return 'attack mode';
        default: return sel;
      }
    case 'battle':
      switch (p[1]) {
        case 'toggle': return `"${rest}" switched on`;
        case 'prompt': return `${rest} check entered`;
        case 'round': return 'round';
        case 'tag': return `battle is ${tagLabel(ctx, rest)}`;
        default: return sel;
      }
    case 'flag': return p.slice(1).join('.');
    default: return sel;
  }
}

function describeHistory(ctx: EvalContext, f: HistoryFilter): string {
  const what = { hit: 'hit', miss: 'missed', crit: 'critted', attack: 'attacked', used: `used ${f.abilityId ? nameOf(ctx, f.abilityId) : 'ability'}`, activated: 'activated', damaged: 'damaged', moved: 'moved' }[f.event];
  const who = f.by === 'me' ? 'you' : f.by === 'target' ? 'the target' : 'anyone';
  const vs = f.vs === 'current' ? (f.by === 'target' ? ' you' : ' this target') : f.vs === 'sameCategory' ? ` a ${f.category ?? 'similar'} target` : '';
  const when = { attack: 'this round', round: 'this round', lastRound: 'last round', encounter: 'this battle', day: 'today' }[f.scope];
  return `${who} ${what}${vs} ${when}`;
}

/** Human sentence for a condition. */
export function describeCondition(cond: Condition, ctx: EvalContext): string {
  if ('all' in cond) return cond.all.length ? cond.all.map((c) => describeCondition(c, ctx)).join(' and ') : 'always';
  if ('any' in cond) return cond.any.map((c) => describeCondition(c, ctx)).join(' or ');
  if ('none' in cond) return `none of: ${cond.none.map((c) => describeCondition(c, ctx)).join(' / ')}`;
  if ('not' in cond) return `not (${describeCondition(cond.not, ctx)})`;
  if ('count' in cond) return `at least ${cond.atLeast} of: ${cond.count.map((c) => describeCondition(c, ctx)).join(' / ')}`;
  if ('is' in cond) return describeSelector(ctx, cond.is);
  if ('exists' in cond) return describeSelector(ctx, cond.exists);
  if ('compare' in cond) {
    const l = describeSelector(ctx, cond.compare);
    const op = { '=': 'is', '!=': 'is not', '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least' }[cond.op];
    const v = typeof cond.value === 'string' ? (ctx.library.tags[cond.value]?.label ?? cond.value) : String(cond.value);
    if (cond.compare === 'target.hurt' && cond.op === '>=') return `target is ${v} or worse`;
    if (cond.compare === 'target.size' && cond.op === '>=') return `target is ${v} or larger`;
    if (cond.compare === 'attack.kind' && cond.op === '=') return `${v} attack`;
    return `${l} ${op} ${v}`;
  }
  if ('in' in cond) return cond.param ? `${describeSelector(ctx, cond.in)} is one of your ${cond.param}` : `${describeSelector(ctx, cond.in)} is ${(cond.set ?? []).map((t) => tagLabel(ctx, t)).join(' / ')}`;
  if ('history' in cond) {
    const n = cond.value ?? 1;
    return `${describeHistory(ctx, cond.history)}${n > 1 || (cond.op && cond.op !== '>=') ? ` (${cond.op ?? '>='} ${n})` : ''}`;
  }
  return 'condition';
}

/** Describe the first leaf that makes the condition false; undefined if it passes. */
export function firstFailure(cond: Condition, ctx: EvalContext): string | undefined {
  if (evalCondition(cond, ctx)) return undefined;
  if ('all' in cond) { for (const c of cond.all) { const f = firstFailure(c, ctx); if (f) return f; } return describeCondition(cond, ctx); }
  if ('any' in cond) return `none of: ${cond.any.map((c) => describeCondition(c, ctx)).join(' / ')}`;
  if ('not' in cond) return `not (${describeCondition(cond.not, ctx)})`;
  return describeCondition(cond, ctx);
}

/** Short summary of what an effect list would grant, e.g. "+2 attack, +2 damage". */
export function summarizeEffects(effects: readonly Effect[]): string {
  const parts: string[] = [];
  for (const e of effects) {
    switch (e.verb) {
      case 'modify': {
        const v = typeof e.value === 'object' ? `+${e.value.table[0]?.value ?? '?'}..${e.value.table[e.value.table.length - 1]?.value ?? '?'}` : typeof e.value === 'number' ? (e.value >= 0 ? `+${e.value}` : `${e.value}`) : e.value;
        parts.push(e.mode === 'set' ? `${e.to} = ${v}` : e.mode === 'multiply' ? `${e.to} × ${v}` : `${v} ${e.to}`);
        break;
      }
      case 'dice': parts.push(`+${e.dice}${e.damageType ? ` ${e.damageType}` : ''}`); break;
      case 'flag': parts.push(e.flag); break;
      case 'tag': parts.push(`${e.to} gains ${e.tag}`); break;
      case 'grant': parts.push(`grants ${e.ability}`); break;
      case 'suppress': parts.push(`suppress ${e.ability}`); break;
      case 'resource': parts.push(`${e.op} ${e.amount} ${e.id}`); break;
      case 'attack': parts.push(e.mode ? `mode ${e.mode.label}` : e.naturalAttack ? `${e.naturalAttack.name} attack` : `+${e.extraAttacks} attack`); break;
      case 'slot': parts.push(`+${e.count} ${e.slot} slot`); break;
      case 'hp': parts.push(`${e.op} ${e.amount} hp`); break;
      case 'prompt': parts.push(`ask ${e.id}`); break;
      case 'note': parts.push('note'); break;
      case 'reveal': parts.push('reveal target'); break;
    }
  }
  return parts.join(', ');
}
