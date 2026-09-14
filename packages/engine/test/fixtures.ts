import {
  AbilitySchema, BattleSchema, CharacterSchema, ClassTableSchema, CombatantSchema, SkillSchema, TagSchema,
  type Ability, type Battle, type Character, type CharacterInput, type ClassTable, type Combatant, type LogEvent, type Skill, type Tag,
} from '../src/schema';
import type { EvalContext, Library } from '../src/context';
import { convertToV3 } from '../src/migrate';

export const ranger: ClassTable = ClassTableSchema.parse({
  id: 'ranger', name: 'Ranger', hitDie: 8, skillPointsPerLevel: 6,
  classSkills: ['spot', 'survival', 'hide'], babProgression: 'full',
  saves: { fort: 'good', ref: 'good', will: 'poor' },
});
export const monsterHunter: ClassTable = ClassTableSchema.parse({
  id: 'monster-hunter', name: 'Monster Hunter', hitDie: 10, skillPointsPerLevel: 4,
  classSkills: ['knowledge-monsters'], babProgression: 'full',
  saves: { fort: 'good', ref: 'poor', will: 'poor' },
  levelFeatures: { '1': ['monster-blow'], '2': ['monster-lore'] },
});

export const tags: Tag[] = [
  { id: 'aberration', label: 'Aberration', category: 'creatureType' },
  { id: 'monstrous-humanoid', label: 'Monstrous Humanoid', category: 'creatureType' },
  { id: 'magical-beast', label: 'Magical Beast', category: 'creatureType' },
  { id: 'aquatic', label: 'Aquatic', category: 'habitat' },
  { id: 'flanked', label: 'Flanked', category: 'condition' },
  { id: 'red', label: 'Red', category: 'custom' },
].map((t) => TagSchema.parse(t));

export const skills: Skill[] = [
  { id: 'spot', name: 'Spot', ability: 'wis' },
  { id: 'survival', name: 'Survival', ability: 'wis' },
  { id: 'hide', name: 'Hide', ability: 'dex' },
  { id: 'swim', name: 'Swim', ability: 'str' },
  { id: 'knowledge-monsters', name: 'Knowledge (Monsters)', ability: 'int' },
].map((s) => SkillSchema.parse(s));

/** Accepts v1 (`source`), v2 (`origin`) or v3 (`kind`) input. */
export function makeAbility(a: Record<string, unknown> & { id: string }): Ability {
  const raw = 'kind' in a || 'origin' in a ? a : { name: a.id, source: 'feat', ...a };
  return AbilitySchema.parse(convertToV3({ name: a.id, ...raw }));
}

export function makeCharacter(over: Partial<CharacterInput> = {}): Character {
  return CharacterSchema.parse({
    id: 'memento', name: 'Memento',
    abilityScores: { str: 12, dex: 16, con: 12, int: 16, wis: 16, cha: 11 },
    xp: 16088,
    classLevels: [{ classId: 'ranger', level: 5 }, { classId: 'monster-hunter', level: 1 }],
    hp: { max: 44, current: 44 },
    skills: { spot: { ranks: 9 }, survival: { ranks: 9 }, swim: { ranks: 2 } },
    attackProfiles: [
      { id: 'bow', name: 'Composite Longbow +1', kind: 'ranged', baseDice: '1d8', enhancement: 1, critRange: 20, critMult: 3, rangeIncrement: 110, attackAbility: 'dex', damageAbility: 'str', maxDamageAbilityBonus: 1 },
      { id: 'sword', name: 'Longsword', kind: 'melee', baseDice: '1d8', attackAbility: 'str', damageAbility: 'str', critRange: 19 },
    ],
    ...over,
  });
}

export function makeCombatant(over: Partial<Combatant> & { id: string }): Combatant {
  return CombatantSchema.parse({ name: over.id, ...over });
}

export function makeBattle(over: Partial<Battle> = {}): Battle {
  return BattleSchema.parse({ id: 'b1', startedAt: '2026-09-06T00:00:00Z', ...over });
}

export function makeLibrary(abilities: Ability[] = []): Library {
  return {
    abilities: Object.fromEntries(abilities.map((a) => [a.id, a])),
    tags: Object.fromEntries(tags.map((t) => [t.id, t])),
    skills: Object.fromEntries(skills.map((s) => [s.id, s])),
    classTables: { ranger, 'monster-hunter': monsterHunter },
    xpTable: [{ level: 1, xp: 0 }, { level: 2, xp: 1000 }, { level: 3, xp: 3000 }, { level: 4, xp: 6000 }, { level: 5, xp: 10000 }, { level: 6, xp: 15000 }, { level: 7, xp: 21000 }, { level: 8, xp: 28000 }],
  };
}

let seq = 0;
export function ev(e: Partial<LogEvent> & { kind: LogEvent['kind']; round: number }): LogEvent {
  return { id: `e${++seq}`, seq: seq, actor: 'self', ...e };
}

export function makeCtx(over: Partial<EvalContext> = {}): EvalContext {
  return { character: makeCharacter(), library: makeLibrary(), ...over };
}
