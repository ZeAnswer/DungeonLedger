import { z } from 'zod';
import { convertPack, convertBattle } from './migrate';

// ---------- primitives ----------
export const BonusTypeSchema = z.enum([
  'untyped', 'enhancement', 'insight', 'morale', 'competence', 'circumstance', 'dodge', 'luck',
  'sacred', 'profane', 'racial', 'size', 'deflection', 'natural', 'armor', 'shield', 'resistance',
  'alchemical', 'inherent',
]);
export type BonusType = z.infer<typeof BonusTypeSchema>;

export const SizeSchema = z.enum(['fine', 'diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal']);
export type Size = z.infer<typeof SizeSchema>;

export const HurtSchema = z.enum(['unhurt', 'scratched', 'bloodied', 'nearDeath']);
export type Hurt = z.infer<typeof HurtSchema>;

export const AttackKindSchema = z.enum(['ranged', 'melee']);
export type AttackKind = z.infer<typeof AttackKindSchema>;

export const AbilityKeySchema = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export type AbilityKey = z.infer<typeof AbilityKeySchema>;

export const SLOT_IDS = ['mainHand', 'offHand', 'buckler', 'quiver', 'armor', 'head', 'eyes', 'neck', 'shoulders', 'torso', 'arms', 'hands', 'ring', 'waist', 'feet'] as const;
export const SlotIdSchema = z.enum(SLOT_IDS);
export type SlotId = z.infer<typeof SlotIdSchema>;
export const ItemCategorySchema = z.enum(['weapon', 'armor', 'shield', 'ammunition', 'wondrous', 'potion', 'scroll', 'wand', 'tool', 'trophy', 'material', 'gear']);
export type ItemCategory = z.infer<typeof ItemCategorySchema>;


/** Numeric literal or expression string, see expr.ts */
export const ExprSchema = z.union([z.number(), z.string().min(1)]);
export type Expr = z.infer<typeof ExprSchema>;

/** Stat ids a bonus can target. */
export const StatIdSchema = z.string().regex(
  /^(attack|damage|ac|ac\.touch|ac\.flatFooted|save\.fort|save\.ref|save\.will|init|critRange|critMult|hp\.max|speed|casterLevel|spellDC|dr|sr|resist\.[a-z]+|ability\.(str|dex|con|int|wis|cha)|skill\.[A-Za-z0-9_-]+)$/,
  'unknown stat id',
);
export type StatId = z.infer<typeof StatIdSchema>;

export const DurationSchema = z.union([
  z.literal('thisAttack'), z.literal('thisTurn'), z.literal('untilMyNextTurn'),
  z.object({ rounds: z.union([z.number().int().positive(), z.string()]) }), z.object({ minutes: z.number().positive() }),
  z.literal('encounter'), z.literal('untilRemoved'),
]);
export type Duration = z.infer<typeof DurationSchema>;

export const ResetOnSchema = z.enum(['round', 'encounter', 'day', 'never']);
export type ResetOn = z.infer<typeof ResetOnSchema>;

// ---------- selectors ----------
/**
 * Dot-path naming a piece of state, shared by conditions, effect targets and expressions. Domains:
 * self.stat.<statId> · self.skill.<id>.(ranks|total|classSkill) · self.class.<id>.level · self.tag.<tag> · self.ability.<id>.(enabled|active|usesLeft|used)
 * self.equipped.(item.<id>|slot.<slot>|category.<cat>|count.tag.<tag>) · self.param.<name> · self.var.<name> · self.hp.(current|max)
 * target.(exists|tags|type|size|hurt|distance|revealed|tag.<tag>|condition.<tag>) · attack.(exists|kind|index|isFirstThisRound|mode|weapon.id|weapon.category|weapon.tag.<tag>)
 * battle.(round|toggle.<id>|prompt.<id>|tag.<tag>) · flag.<name>
 */
export const SelectorSchema = z.string().regex(/^(self|target|attack|battle|flag|history)(\.[A-Za-z0-9_-]+)+$/, 'selector must be a dot path like target.tag.aquatic');
export type Selector = z.infer<typeof SelectorSchema>;

export const CompareOpSchema = z.enum(['=', '!=', '<', '<=', '>', '>=']);
export type CompareOp = z.infer<typeof CompareOpSchema>;

export const HistoryFilterSchema = z.object({
  event: z.enum(['hit', 'miss', 'crit', 'attack', 'used', 'activated', 'damaged', 'moved']),
  by: z.enum(['me', 'target', 'any']).default('me'),
  /** current = the selected target; sameCategory = any target sharing the current target's tag in `category` */
  vs: z.enum(['current', 'any', 'sameCategory']).default('current'),
  category: z.string().optional(),
  scope: z.enum(['thisAttackSequence', 'thisRound', 'lastRound', 'encounter', 'day']).default('thisRound'),
  abilityId: z.string().optional(),
});
export type HistoryFilter = z.infer<typeof HistoryFilterSchema>;

// ---------- conditions ----------
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { none: Condition[] }
  | { not: Condition }
  | { count: Condition[]; atLeast: number }
  | { is: Selector }
  | { exists: Selector }
  | { compare: Selector; op: CompareOp; value: number | string }
  | { in: Selector; set?: string[]; param?: string }
  | { history: HistoryFilter; op?: CompareOp; value?: number };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema) }).strict(),
    z.object({ any: z.array(ConditionSchema) }).strict(),
    z.object({ none: z.array(ConditionSchema) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ count: z.array(ConditionSchema), atLeast: z.number().int() }).strict(),
    z.object({ is: SelectorSchema }).strict(),
    z.object({ exists: SelectorSchema }).strict(),
    z.object({ compare: SelectorSchema, op: CompareOpSchema, value: z.union([z.number(), z.string()]) }).strict(),
    z.object({ in: SelectorSchema, set: z.array(z.string()).optional(), param: z.string().optional() }).strict(),
    z.object({ history: HistoryFilterSchema, op: CompareOpSchema.optional(), value: z.number().optional() }).strict(),
  ]),
) as z.ZodType<Condition>;

export const ALWAYS: Condition = { all: [] };

// ---------- effects (verbs) ----------
export const TableValueSchema = z.object({
  prompt: z.string(),
  per: z.string().optional(),
  table: z.array(z.object({ upTo: z.number().optional(), value: z.number() })).min(1),
});
export const ValueSchema = z.union([ExprSchema, TableValueSchema]);
export type Value = z.infer<typeof ValueSchema>;

export const EffectSchema = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('modify'), to: StatIdSchema, value: ValueSchema, type: BonusTypeSchema.default('untyped'), mode: z.enum(['add', 'set', 'multiply']).default('add'), attackKind: AttackKindSchema.optional() }),
  z.object({ verb: z.literal('dice'), dice: z.string().regex(/^\d+d\d+$/), damageType: z.string().optional(), label: z.string().optional(), attackKind: AttackKindSchema.optional() }),
  z.object({ verb: z.literal('flag'), flag: z.string(), value: z.boolean().default(true) }),
  z.object({ verb: z.literal('tag'), to: z.enum(['self', 'target', 'allEnemies']), tag: z.string(), duration: DurationSchema.default('untilRemoved') }),
  z.object({ verb: z.literal('grant'), ability: z.string(), duration: DurationSchema.optional() }),
  z.object({ verb: z.literal('suppress'), ability: z.string() }),
  z.object({ verb: z.literal('resource'), id: z.string(), op: z.enum(['consume', 'restore', 'set']).default('consume'), amount: ExprSchema.default(1) }),
  z.object({
    verb: z.literal('attack'),
    mode: z.object({ id: z.string(), label: z.string(), base: z.enum(['single', 'full']), note: z.string().optional() }).optional(),
    extraAttacks: z.number().int().default(0), penaltyAll: z.number().int().default(0), appliesToBase: z.enum(['single', 'full', 'any']).optional(),
    naturalAttack: z.object({ name: z.string(), dice: z.string(), count: z.number().int().positive().default(1), attackBonus: z.number().int().default(0) }).optional(),
    attackKind: AttackKindSchema.optional(),
  }),
  z.object({ verb: z.literal('slot'), slot: SlotIdSchema, count: z.number().int().default(1) }),
  z.object({ verb: z.literal('hp'), op: z.enum(['damage', 'heal', 'temp']), amount: ExprSchema }),
  z.object({ verb: z.literal('prompt'), id: z.string(), label: z.string().optional(), per: z.string().optional(), remember: z.enum(['encounter', 'day']).default('encounter') }),
  z.object({ verb: z.literal('note'), text: z.string(), dc: ExprSchema.optional() }),
  z.object({ verb: z.literal('reveal') }),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const TriggerSchema = z.enum(['always', 'onHit', 'onMiss', 'onCrit', 'onDamaged', 'onRoundStart', 'onRoundEnd']);
export type Trigger = z.infer<typeof TriggerSchema>;

export const EffectBlockSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  trigger: TriggerSchema.default('always'),
  when: ConditionSchema.default(ALWAYS),
  do: z.array(EffectSchema).min(1),
});
export type EffectBlock = z.infer<typeof EffectBlockSchema>;

// ---------- activations ----------
export const ActionSchema = z.union([z.enum(['free', 'swift', 'immediate', 'move', 'standard', 'fullRound']), z.object({ minutes: z.number().positive() }), z.object({ hours: z.number().positive() })]);
export type Action = z.infer<typeof ActionSchema>;

export const CostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('charge'), resourceId: z.string(), amount: ExprSchema.default(1) }),
  z.object({ kind: z.literal('gold'), amount: z.number() }),
  z.object({ kind: z.literal('xp'), amount: z.number() }),
  z.object({ kind: z.literal('hp'), amount: ExprSchema }),
  z.object({ kind: z.literal('item'), abilityId: z.string(), quantity: z.number().int().positive().default(1) }),
  z.object({ kind: z.literal('spellSlot'), level: z.number().int() }),
]);
export type Cost = z.infer<typeof CostSchema>;

/** Inline charges of an activation: a pool whose id is the activation id. */
export const ChargesSchema = z.object({ max: ExprSchema, resetOn: ResetOnSchema.default('day'), label: z.string().optional() });
export type Charges = z.infer<typeof ChargesSchema>;

/** A named charge pool on a record, shared by several activations or records. */
export const PoolSchema = z.object({ id: z.string().min(1), label: z.string().optional(), max: ExprSchema, resetOn: ResetOnSchema.default('day') });
export type Pool = z.infer<typeof PoolSchema>;

export const ActivationSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  action: ActionSchema.default('standard'),
  charges: ChargesSchema.optional(),
  cost: z.array(CostSchema).default([]),
  duration: DurationSchema.optional(),
  /** Casts this library spell: its effects (and duration, unless overridden) apply. */
  spell: z.string().optional(),
  onUse: z.array(EffectBlockSchema).default([]),
  whileActive: z.array(EffectBlockSchema).default([]),
});
export type Activation = z.infer<typeof ActivationSchema>;

export const ParamDefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tags'), label: z.string().optional(), category: z.string().optional(), count: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('number'), label: z.string().optional(), min: z.number().optional(), max: z.number().optional() }),
  z.object({ kind: z.literal('choice'), label: z.string().optional(), options: z.array(z.string()) }),
]);
export type ParamDef = z.infer<typeof ParamDefSchema>;

export const AcquiredSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('feat') }),
  z.object({ kind: z.literal('class'), classId: z.string().optional(), level: z.number().int().optional() }),
  z.object({ kind: z.literal('race') }),
  z.object({ kind: z.literal('dm') }),
]);
export type Acquired = z.infer<typeof AcquiredSchema>;

export const WeaponMetaSchema = z.object({
  kind: AttackKindSchema,
  dice: z.string().regex(/^\d+d\d+$/),
  critRange: z.number().int().min(2).max(20).default(20),
  critMult: z.number().int().min(2).default(2),
  rangeIncrement: z.number().int().optional(),
  attackAbility: AbilityKeySchema,
  damageAbility: AbilityKeySchema.optional(),
  maxDamageAbilityBonus: z.number().int().optional(),
  damageAbilityMultiplier: z.number().default(1),
  enhancement: z.number().int().default(0),
  tags: z.array(z.string()).default([]),
});
export type WeaponMeta = z.infer<typeof WeaponMetaSchema>;

/** slot 'none' = active while carried (no body slot); undefined = not equippable. */
export const ItemMetaSchema = z.object({
  category: ItemCategorySchema,
  slot: z.union([SlotIdSchema, z.literal('none')]).optional(),
  weight: z.number().optional(),
  price: z.string().optional(),
  tags: z.array(z.string()).default([]),
  weapon: WeaponMetaSchema.optional(),
});
export type ItemMeta = z.infer<typeof ItemMetaSchema>;

// ---------- records ----------
const recordBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().optional(),
  sourceRef: z.string().optional(),
  todo: z.string().optional(),
  /** Passive blocks: apply while the feature is enabled / the item equipped / the status or spell active. */
  effects: z.array(EffectBlockSchema).default([]),
};

export const FeatureSchema = z.object({
  ...recordBase,
  kind: z.literal('feature'),
  acquired: AcquiredSchema.default({ kind: 'feat' }),
  params: z.record(ParamDefSchema).optional(),
  enabledByDefault: z.boolean().default(true),
  activations: z.array(ActivationSchema).default([]),
  pools: z.array(PoolSchema).default([]),
}).strict();
export type Feature = z.infer<typeof FeatureSchema>;

export const ItemSchema = z.object({
  ...recordBase,
  kind: z.literal('item'),
  item: ItemMetaSchema,
  activations: z.array(ActivationSchema).default([]),
  pools: z.array(PoolSchema).default([]),
}).strict();
export type Item = z.infer<typeof ItemSchema>;

export const SpellSchema = z.object({
  ...recordBase,
  kind: z.literal('spell'),
  level: z.number().int().min(0).optional(),
  castingAction: ActionSchema.default('standard'),
  duration: DurationSchema.optional(),
}).strict();
export type Spell = z.infer<typeof SpellSchema>;

export const StatusSchema = z.object({
  ...recordBase,
  kind: z.literal('status'),
  harmful: z.boolean().default(false),
  duration: DurationSchema.optional(),
}).strict();
export type Status = z.infer<typeof StatusSchema>;

export const AbilitySchema = z.discriminatedUnion('kind', [FeatureSchema, ItemSchema, SpellSchema, StatusSchema]);
export type Ability = z.infer<typeof AbilitySchema>;
export type AbilityInput = z.input<typeof AbilitySchema>;
export type RecordKind = Ability['kind'];
export const RECORD_KINDS: RecordKind[] = ['feature', 'item', 'spell', 'status'];

export function activationsOf(a: Ability | undefined): Activation[] {
  return a && (a.kind === 'feature' || a.kind === 'item') ? a.activations : [];
}
export function poolsOf(a: Ability | undefined): Pool[] {
  return a && (a.kind === 'feature' || a.kind === 'item') ? a.pools : [];
}

// ---------- library docs ----------
export const TagSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(['creatureType', 'subtype', 'size', 'habitat', 'condition', 'custom']),
  parent: z.string().optional(),
});
export type Tag = z.infer<typeof TagSchema>;

export const LoreEntrySchema = z.object({
  summary: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
});

export const MonsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  size: SizeSchema.default('medium'),
  cr: z.union([z.number(), z.string()]).optional(),
  senses: z.string().optional(),
  lore: LoreEntrySchema.optional(),
  notes: z.string().optional(),
  bestiaryId: z.string().optional(),
});
export type Monster = z.infer<typeof MonsterSchema>;

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ability: AbilityKeySchema,
  trainedOnly: z.boolean().default(false),
  armorCheck: z.boolean().default(false),
});
export type Skill = z.infer<typeof SkillSchema>;

export const ClassTableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hitDie: z.number().int().positive(),
  skillPointsPerLevel: z.number().int().nonnegative(),
  classSkills: z.array(z.string()).default([]),
  babProgression: z.enum(['full', '3/4', '1/2']),
  saves: z.object({ fort: z.enum(['good', 'poor']), ref: z.enum(['good', 'poor']), will: z.enum(['good', 'poor']) }),
  levelFeatures: z.record(z.array(z.string())).default({}),
});
export type ClassTable = z.infer<typeof ClassTableSchema>;

export const AttackProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: AttackKindSchema,
  baseDice: z.string().regex(/^\d+d\d+$/),
  enhancement: z.number().int().default(0),
  critRange: z.number().int().min(2).max(20).default(20),
  critMult: z.number().int().min(2).default(2),
  rangeIncrement: z.number().int().optional(),
  attackAbility: AbilityKeySchema,
  damageAbility: AbilityKeySchema.optional(),
  maxDamageAbilityBonus: z.number().int().optional(),
  damageAbilityMultiplier: z.number().default(1),
});
export type AttackProfile = z.infer<typeof AttackProfileSchema>;

export const LevelRecordSchema = z.object({
  level: z.number().int().positive(),
  classId: z.string(),
  /** Hit die result before Con (max die at level 1 per PHB). */
  hpRolled: z.number().int().nonnegative().default(0),
  skillPointsSpent: z.record(z.number().nonnegative()).default({}),
  /** General feat slots spent this level (level 1, 3, 6, 9… plus human bonus). */
  featsTaken: z.array(z.string()).default([]),
  /** Class bonus feats / features granted this level (Track, Rapid Shot, Monster Blow…). */
  featuresGained: z.array(z.string()).default([]),
  /** +1 ability score at levels 4, 8, 12… */
  abilityIncrease: AbilityKeySchema.optional(),
  spellsLearned: z.array(z.string()).default([]),
  notes: z.string().optional(),
  at: z.string().optional(),
});
export type LevelRecord = z.infer<typeof LevelRecordSchema>;

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  abilityScores: z.object({ str: z.number().int(), dex: z.number().int(), con: z.number().int(), int: z.number().int(), wis: z.number().int(), cha: z.number().int() }),
  size: SizeSchema.default('medium'),
  xp: z.number().int().nonnegative().default(0),
  classLevels: z.array(z.object({ classId: z.string(), level: z.number().int().positive() })).default([]),
  hp: z.object({ max: z.number().int(), current: z.number().int(), temp: z.number().int().default(0), nonlethal: z.number().int().default(0) }),
  baseArmor: z.number().int().default(0),
  baseShield: z.number().int().default(0),
  baseNaturalArmor: z.number().int().default(0),
  speed: z.number().int().default(30),
  skills: z.record(z.object({ ranks: z.number().nonnegative(), classSkillOverride: z.boolean().optional() })).default({}),
  attackProfiles: z.array(AttackProfileSchema).default([]),
  abilities: z.array(z.object({ abilityId: z.string(), enabled: z.boolean().default(true), paramValues: z.record(z.array(z.string())).default({}) })).default([]),
  resourceState: z.record(z.object({ used: z.number().int().nonnegative() })).default({}),
  levelHistory: z.array(LevelRecordSchema).default([]),
  /** Racial/other bonus skill points per level (human = 1). */
  extraSkillPointsPerLevel: z.number().int().default(0),
  /** Human bonus feat at level 1. */
  extraFeatAtFirstLevel: z.boolean().default(false),
  /** Flat adjustment to max HP not covered by abilities (e.g. DM ruling). */
  hpAdjust: z.number().int().default(0),
  /** Carried and stored gear. Items with an abilityId drive that ability's enabled flag when equipped. */
  inventory: z.array(z.object({
    id: z.string().min(1),
    /** Library item (ability with source 'item'). Older entries may lack it and carry name/category directly. */
    abilityId: z.string().optional(),
    name: z.string().optional(),
    category: z.string().optional(),
    quantity: z.number().int().nonnegative().default(1),
    equipped: z.boolean().default(false),
    /** Which of the slot's positions (ring 0/1). */
    slotIndex: z.number().int().nonnegative().optional(),
    weight: z.number().optional(),
    notes: z.string().optional(),
  })).default([]),
  /** Free-text history: level-ups, HP changes, edits. Newest last. */
  journal: z.array(z.object({ at: z.string(), kind: z.enum(['levelUp', 'hp', 'xp', 'edit', 'rest', 'note']), text: z.string() })).default([]),
  /** Free numeric variables usable in pack expressions, e.g. favoredEnemyBonus1, trophyMultiplier. */
  vars: z.record(z.number()).default({}),
  notes: z.string().optional(),
});
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterInput = z.input<typeof CharacterSchema>;

export const XpTableSchema = z.array(z.object({ level: z.number().int().positive(), xp: z.number().int().nonnegative() }));

const PackInnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().nonnegative(),
  description: z.string().optional(),
  tags: z.array(TagSchema).default([]),
  abilities: z.array(AbilitySchema).default([]),
  monsters: z.array(MonsterSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  classTables: z.array(ClassTableSchema).default([]),
  characters: z.array(CharacterSchema).default([]),
  xpTable: XpTableSchema.optional(),
});
/** Packs written in the v1 or v2 format are converted on parse. */
export const PackSchema = z.preprocess((raw) => convertPack(raw), PackInnerSchema);
export type Pack = z.infer<typeof PackInnerSchema>;

// ---------- battle ----------
export const CombatantSchema = z.object({
  id: z.string().min(1),
  monsterId: z.string().optional(),
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  size: SizeSchema.default('medium'),
  hurt: HurtSchema.default('unhurt'),
  conditions: z.array(z.object({ tag: z.string(), expires: DurationSchema.optional(), appliedRound: z.number().int().optional(), source: z.string().optional() })).default([]),
  dead: z.boolean().default(false),
  revealed: z.boolean().default(false),
  /** Distance from the character in feet (5 = adjacent). Undefined = unknown. */
  distanceFeet: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

export const ActiveBuffSchema = z.object({
  instanceId: z.string().min(1),
  abilityId: z.string().min(1),
  /** Set when the buff is an activation running (Boots of Speed haste); absent for statuses and grant-verb buffs. */
  activationId: z.string().optional(),
  owner: z.string().default('self'),
  remainingRounds: z.number().int().optional(),
  expires: DurationSchema.optional(),
  suppressed: z.boolean().default(false),
  label: z.string().optional(),
});
export type ActiveBuff = z.infer<typeof ActiveBuffSchema>;

export const LogEventSchema = z.object({
  id: z.string().min(1),
  round: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  /** attack = the character attacks targetId; enemy = targetId acts on the character (result hit/miss, damage) */
  kind: z.enum(['roundStart', 'attack', 'enemy', 'use', 'activate', 'deactivate', 'tag', 'buff', 'hp', 'move', 'note']),
  actor: z.string().default('self'),
  targetId: z.string().optional(),
  profileId: z.string().optional(),
  modeId: z.string().optional(),
  attackIndex: z.number().int().optional(),
  result: z.enum(['hit', 'miss', 'crit']).optional(),
  abilityId: z.string().optional(),
  activationId: z.string().optional(),
  damage: z.number().int().optional(),
  text: z.string().optional(),
  editedAt: z.string().optional(),
  /** Numbers shown when the attack was executed (frozen in the UI). */
  snapshot: z.object({ attackBonus: z.number(), damageText: z.string() }).optional(),
  /** What this event's triggers changed, so it can be undone. */
  undo: z.object({
    targetConditions: z.array(z.object({ combatantId: z.string(), tag: z.string() })).default([]),
    selfConditions: z.array(z.string()).default([]),
    resources: z.array(z.object({ id: z.string(), delta: z.number() })).default([]),
    buffs: z.array(z.string()).default([]),
    hp: z.number().optional(),
  }).optional(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

const BattleInnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Battle'),
  startedAt: z.string(),
  round: z.number().int().positive().default(1),
  combatants: z.array(CombatantSchema).default([]),
  activeBuffs: z.array(ActiveBuffSchema).default([]),
  statuses: z.array(StatusSchema).default([]),
  suppressedAbilities: z.array(z.string()).default([]),
  selfConditions: z.array(z.object({ tag: z.string(), expires: DurationSchema.optional(), appliedRound: z.number().int().optional(), source: z.string().optional() })).default([]),
  toggles: z.record(z.boolean()).default({}),
  /** Environment tags for this battle (underwater, darkness, forest…). */
  tags: z.array(z.string()).default([]),
  encounterResources: z.record(z.number().int().nonnegative()).default({}),
  roundResources: z.record(z.number().int().nonnegative()).default({}),
  prompts: z.record(z.number()).default({}),
  log: z.array(LogEventSchema).default([]),
  ended: z.boolean().default(false),
});
export const BattleSchema = z.preprocess((raw) => convertBattle(raw), BattleInnerSchema);
export type Battle = z.infer<typeof BattleInnerSchema>;
