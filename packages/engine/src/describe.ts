import type { EvalContext } from './context';
import { activationsOf } from './schema';

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
