import { pathToSelector, describePath, PATHS } from '../../src/scripts/paths';
test('paths map onto engine selectors', () => {
  expect(pathToSelector('player.stats.attack')).toBe('self.stat.attack');
  expect(pathToSelector('player.stats.str')).toBe('self.stat.ability.str');
  expect(pathToSelector('player.mod.wis')).toBe('self.mod.wis');
  expect(pathToSelector('player.skills.spot.total')).toBe('self.skill.spot.total');
  expect(pathToSelector('player.classes.ranger')).toBe('self.class.ranger.level');
  expect(pathToSelector('player.hp.current')).toBe('self.hp.current');
  expect(pathToSelector('player.equipped.tag.bow')).toBe('self.equipped.count.tag.bow');
  expect(pathToSelector('target.distance')).toBe('target.distance');
  expect(pathToSelector('attack.weapon.id')).toBe('attack.weapon.id');
  expect(pathToSelector('battle.toggles.sniping')).toBe('battle.toggle.sniping');
  expect(pathToSelector('battle.prompts.knowledge')).toBe('battle.prompt.knowledge');
  expect(pathToSelector('flags.ignoreConcealment')).toBe('flag.ignoreConcealment');
  expect(pathToSelector('vars.trophyMultiplier')).toBe('self.var.trophyMultiplier');
  expect(pathToSelector('nope.x')).toBeUndefined();
});
test('describePath reads well and the catalog covers the domains', () => {
  expect(describePath('player.skills.spot.total')).toBe('my Spot total');
  expect(describePath('target.distance')).toBe('target distance (ft)');
  expect(PATHS.some((p) => p.path === 'attack.isRanged')).toBe(true);
});
