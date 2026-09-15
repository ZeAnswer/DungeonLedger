/** Script paths (player.stats.attack) ↔ engine selectors (self.stat.attack). One table, used by the api, the converter, completion and long-press. */
const ABILITY = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export function pathToSelector(path: string): string | undefined {
  const p = path.split('.');
  const [d, f] = p; const rest = p.slice(2);
  if (d === 'player' || d === 'self') {
    switch (f) {
      case 'stats': return rest.length === 1 && ABILITY.has(rest[0]!) ? `self.stat.ability.${rest[0]}` : `self.stat.${rest.join('.')}`;
      case 'mod': return `self.mod.${rest[0]}`;
      case 'skills': return `self.skill.${rest.join('.')}`;
      case 'classes': return `self.class.${rest[0]}.level`;
      case 'hp': return `self.hp.${rest[0]}`;
      case 'level': case 'bab': case 'size': return `self.${f}`;
      case 'tags': return 'self.tags';
      case 'records': return `self.ability.${rest.join('.')}`;
      case 'res': return `self.resource.${rest.join('.')}`;
      case 'equipped': return rest[0] === 'tag' ? `self.equipped.count.tag.${rest.slice(1).join('.')}` : `self.equipped.${rest.join('.')}`;
      case 'params': return `self.param.${rest.join('.')}`;
      default: return undefined;
    }
  }
  if (d === 'target') return f === 'is' ? undefined : `target.${p.slice(1).join('.')}`;
  if (d === 'attack') { const m: Record<string, string> = { isRanged: 'attack.kind', isMelee: 'attack.kind', isFirstThisRound: 'attack.isFirstThisRound' }; return m[f!] ?? `attack.${p.slice(1).join('.')}`; }
  if (d === 'battle') { if (f === 'toggles') return `battle.toggle.${rest.join('.')}`; if (f === 'prompts') return `battle.prompt.${rest.join('.')}`; return `battle.${p.slice(1).join('.')}`; }
  if (d === 'flags') return `flag.${p.slice(1).join('.')}`;
  if (d === 'vars') return `self.var.${p.slice(1).join('.')}`;
  return undefined;
}

export type PathDoc = { path: string; kind: 'number' | 'boolean' | 'string' | 'list'; doc: string };
export const PATHS: PathDoc[] = [
  { path: 'player.level', kind: 'number', doc: 'character level' }, { path: 'player.bab', kind: 'number', doc: 'base attack bonus' }, { path: 'player.size', kind: 'number', doc: 'my size (SIZE.*)' },
  { path: 'player.hp.current', kind: 'number', doc: 'current HP' }, { path: 'player.hp.max', kind: 'number', doc: 'max HP' }, { path: 'player.hp.temp', kind: 'number', doc: 'temporary HP' }, { path: 'player.hp.nonlethal', kind: 'number', doc: 'nonlethal damage' },
  { path: 'player.stats.<stat>', kind: 'number', doc: 'a resolved stat (attack, damage, ac, save.will, init, speed, str…)' }, { path: 'player.mod.<ability>', kind: 'number', doc: 'ability modifier (effective score)' },
  { path: 'player.skills.<id>.total', kind: 'number', doc: 'skill total' }, { path: 'player.skills.<id>.ranks', kind: 'number', doc: 'skill ranks' }, { path: 'player.classes.<id>', kind: 'number', doc: 'class level' },
  { path: 'player.lastDamage', kind: 'number', doc: 'damage of the current hit (event scripts)' }, { path: 'player.tags', kind: 'list', doc: 'my conditions' },
  { path: 'target.exists', kind: 'boolean', doc: 'a target is selected' }, { path: 'target.type', kind: 'string', doc: 'creature type tag' }, { path: 'target.size', kind: 'number', doc: 'SIZE.*' }, { path: 'target.hurt', kind: 'number', doc: 'HURT.*' }, { path: 'target.distance', kind: 'number', doc: 'target distance (ft)' }, { path: 'target.tags', kind: 'list', doc: 'tags and conditions' }, { path: 'target.revealed', kind: 'boolean', doc: 'lore revealed' },
  { path: 'attack.isRanged', kind: 'boolean', doc: 'this attack is ranged' }, { path: 'attack.isMelee', kind: 'boolean', doc: 'this attack is melee' }, { path: 'attack.index', kind: 'number', doc: 'attack number in the sequence' }, { path: 'attack.isFirstThisRound', kind: 'boolean', doc: 'first attack this round' }, { path: 'attack.mode', kind: 'string', doc: 'attack mode id' }, { path: 'attack.weapon.id', kind: 'string', doc: 'weapon item id' }, { path: 'attack.weapon.tags', kind: 'list', doc: 'weapon tags' },
  { path: 'battle.round', kind: 'number', doc: 'round number' }, { path: 'battle.elapsed', kind: 'number', doc: 'seconds since the battle started' }, { path: 'battle.toggles.<id>', kind: 'boolean', doc: 'manual switch' }, { path: 'battle.prompts.<id>', kind: 'number', doc: 'entered check result' }, { path: 'battle.tags', kind: 'list', doc: 'environment tags' },
  { path: 'flags.<name>', kind: 'boolean', doc: 'flag set by scripts' }, { path: 'vars.<name>', kind: 'number', doc: 'character var, else global' },
];

const SKILL_NAMES: Record<string, string> = {};
export function describePath(path: string, names: { skills?: Record<string, string>; tags?: Record<string, string> } = {}): string {
  const p = path.split('.');
  const skill = (id: string) => names.skills?.[id] ?? SKILL_NAMES[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if ((p[0] === 'player' || p[0] === 'self') && p[1] === 'skills') return `my ${skill(p[2]!)} ${p[3] ?? 'total'}`;
  if (p[0] === 'player' || p[0] === 'self') return `my ${p.slice(1).join(' ')}`;
  if (p[0] === 'target' && p[1] === 'distance') return 'target distance (ft)';
  if (p[0] === 'target') return `target ${p.slice(1).join(' ')}`;
  if (p[0] === 'attack') return `this attack ${p.slice(1).join(' ')}`;
  if (p[0] === 'battle' && p[1] === 'toggles') return `switch "${p.slice(2).join('.')}"`;
  return path;
}
