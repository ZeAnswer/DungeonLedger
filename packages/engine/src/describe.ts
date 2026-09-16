import type { EvalContext } from './context';
import { activationsOf } from './schema';

/**
 * Id → label lookups for the context-free describer. Everything is optional and falls back to the id,
 * so the block printer (which has a pack, not a live context) produces the same sentences.
 */
export type NameLookup = {
  tags?: Record<string, { label: string } | string>;
  skills?: Record<string, { name: string } | string>;
  classes?: Record<string, { name: string } | string>;
  abilities?: Record<string, { name: string } | string>;
  /** Names a record *or* an activation id; the ability table alone cannot see activations. */
  nameOf?: (id: string) => string;
};

/** A label out of one of the lookup tables, else the id itself. */
export function labelOf(table: Record<string, { label?: string; name?: string } | string> | undefined, id: string): string {
  const v = table?.[id];
  if (typeof v === 'string') return v;
  return v?.label ?? v?.name ?? id;
}

/** Name of a record or of an activation by id. */
export function nameOf(ctx: EvalContext, id: string): string {
  const rec = ctx.library.abilities[id] ?? ctx.battle?.statuses.find((s) => s.id === id);
  if (rec) return rec.name;
  for (const a of Object.values(ctx.library.abilities)) for (const act of activationsOf(a)) if (act.id === id) return act.name ?? a.name;
  return id;
}

/** The lookups a live context can offer. */
export function namesFrom(ctx: EvalContext): NameLookup {
  return { tags: ctx.library.tags, skills: ctx.library.skills, classes: ctx.library.classTables, abilities: ctx.library.abilities, nameOf: (id) => nameOf(ctx, id) };
}

/** Human phrase for a selector path, from plain lookups. */
export function describeSelectorWith(sel: string, names: NameLookup = {}): string {
  const p = sel.split('.');
  const rest = p.slice(2).join('.');
  const recordName = (id: string) => names.nameOf?.(id) ?? labelOf(names.abilities, id);
  switch (p[0]) {
    case 'target':
      switch (p[1]) {
        case 'tag': return `target is ${labelOf(names.tags, rest)}`;
        case 'condition': return `target is ${labelOf(names.tags, rest)}`;
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
        case 'tag': return `you are ${labelOf(names.tags, rest)}`;
        case 'ability': return `${recordName(p.slice(2, -1).join('.'))} ${p[p.length - 1] === 'active' ? 'is active' : p[p.length - 1] === 'enabled' ? 'is enabled' : p[p.length - 1]}`;
        case 'resource': return `${p.slice(2, -1).join('.')} ${p[p.length - 1]}`;
        case 'equipped': return p[2] === 'item' ? `${recordName(p.slice(3).join('.'))} equipped` : `equipped ${p.slice(2).join(' ')}`;
        case 'skill': return `${labelOf(names.skills, p.slice(2, -1).join('.'))} ${p[p.length - 1]}`;
        case 'class': return `${labelOf(names.classes, p.slice(2, -1).join('.'))} level`;
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
        case 'tag': return `battle is ${labelOf(names.tags, rest)}`;
        default: return sel;
      }
    case 'flag': return p.slice(1).join('.');
    default: return sel;
  }
}

/** Human phrase for a selector path, for a live context. */
export function describeSelector(ctx: EvalContext, sel: string): string {
  return describeSelectorWith(sel, namesFrom(ctx));
}
