# Record kinds and activations (rules v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `origin` ability envelope with four record kinds (feature, item, spell, status) whose activations carry their own charges, and give each kind its own library tab and editor.

**Architecture:** One `library.abilities` map keeps a single id space; each record stores `kind`. Passive behaviour lives in `record.effects`; everything the player does is an `activation` sub-object (action, inline charges, cost, duration, optional spell, onUse and whileActive blocks). A v2→v3 converter runs wherever data enters (pack parse, stored library, stored battle) so packs, tests and user data all migrate mechanically. The React app gets a kind-aware `RecordEditor`, a tabbed library, and battle actions built from activations.

**Tech Stack:** TypeScript, zod 3, vitest (engine), React 19 + zustand + Tailwind (app), Playwright (e2e), tsx tools. Monorepo: `packages/engine` (`@hl/engine`), `packages/app` (`@hl/app`), `packs/*.json`, `tools/*.ts`.

**Spec:** `docs/superpowers/specs/2026-09-14-record-kinds-design.md` (read it, including "Implementation notes" at the end, before any task).

## Global Constraints

- Rule of thumb from the spec: if two things fulfil the same purpose they are the same thing; a field only appears on the kinds it applies to.
- Record kinds: `feature | item | spell | status`. `origin` never appears in v3 data or UI.
- Activation ids double as pool ids and must be unique across the library.
- Durations: `thisAttack | thisTurn | untilMyNextTurn | {rounds} | {minutes} | encounter | untilRemoved`. Reset: `round | encounter | day | never`. Triggers: `always | onHit | onMiss | onCrit | onDamaged | onRoundStart | onRoundEnd`.
- `battle.toggle.<id>` stays for manual chips; the `declare` activation kind goes away.
- Existing stored data (library, character, battle) must load after upgrade: converters, never manual fixes.
- Commands: engine tests `npm test` (vitest, from repo root), typecheck `npm run typecheck`, packs `npm run validate-packs`, e2e `npm run e2e` (needs `npm run build` first if the Playwright config serves the build; check `playwright.config.ts`), regenerate packs `npx tsx tools/gen-core-pack.ts && npx tsx tools/gen-memento-pack.ts`.
- Commit after every task with a message in the repo's style (imperative, describes behaviour). End commit messages with the attribution lines from the session's system reminder.

---

## File structure

Engine (`packages/engine/src`):
- `schema.ts` — v3 schemas: `DurationSchema`, `ResetOnSchema`, `TriggerSchema`, `ChargesSchema`, `PoolSchema`, `ActivationSchema`, `AcquiredSchema`, `FeatureSchema`, `ItemSchema`, `SpellSchema`, `StatusSchema`, `AbilitySchema` (discriminated union), helpers `activationsOf`, `poolsOf`; `ActiveBuffSchema` gets `activationId`/`expires`; `LogEventSchema` gets `activationId`; `BattleSchema` gets `statuses` (via preprocess); `PackSchema` wrapped in preprocess.
- `migrate.ts` — existing v1→v2 plus new `isV2Ability`, `convertDurationV3`, `convertV2`, `convertToV3`, `convertPack`, `convertBattle`.
- `context.ts` — `findResourceDef` searches pools, inline charges, and record fallbacks; `ResetOn` re-exported from schema.
- `selectors.ts`, `history.ts`, `describe.ts` — ability/activation aware lookups.
- `resolve.ts` — `Source` carries `blocks`; `activeSources` handles activation buffs; `availableActions` lists activations; new `listPools`.
- `battle.ts` — `useAbility` by activation; `payCosts` per activation; `addStatus`; `logAttack` expires `thisAttack` buffs; `nextRound` without declare reset; `longRest` by pool def.
- `equipment.ts` — `slotOf` by kind; `slotCapacity` reads `src.blocks`.
- `pack.ts` — parse already-converted records.

Engine tests (`packages/engine/test`): `fixtures.ts` (`makeAbility` converts to v3), `schema.test.ts`, `migrate.test.ts` (new v2→v3 cases), `v2.test.ts`, `battle.test.ts`, `resolve.test.ts`, `undo.test.ts`, `equipment.test.ts`, `conditions.test.ts` updated where they touch `origin`, `resources`, `toggles`, `situational`.

Tools: `tools/pack-validate.ts` (v3 checks), `tools/gen-memento-pack.ts` (Vaelor's Manual as one item, drop separate abilities), `tools/gen-core-pack.ts` (drop KD table record, fold text). Packs regenerated.

App (`packages/app/src`):
- `store/store.ts` — hydrate converts stored library via `convertToV3`; `reimportInventoryFromDefaults` by kind.
- `store/hooks.ts` — `collectToggles` without declare.
- `components/library/RecordEditor.tsx` (new, replaces `AbilityEditor.tsx`), `components/library/ActivationEditor.tsx` (new), `components/library/BlocksEditor.tsx` (new, block list extracted), `components/library/ConditionEditor.tsx` (presets prop), `components/library/EffectEditor.tsx` (DurationPicker options, kind labels), `components/library/SelectorPicker.tsx` (keys by kind, activations).
- `screens/LibraryScreen.tsx` — tabs Features / Items / Spells / Statuses / Tags / Monsters.
- `screens/InventoryScreen.tsx`, `screens/CharacterScreen.tsx`, `components/character/AbilitySheet.tsx`, `components/character/LevelLedger.tsx` — kind/acquired instead of origin; charges from activations and pools.
- `components/battle/AttackPanel.tsx`, `BuffsDrawer.tsx`, `SituationalSheet.tsx`, `screens/BattleScreen.tsx` — activation-based actions, statuses.

E2E: `e2e/builder.spec.ts`, `e2e/battle-v2.spec.ts`. Docs: `docs/RULES-FORMAT.md`, `TODO.md`.

---

### Task 1: Engine schema v3

**Files:**
- Modify: `packages/engine/src/schema.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Produces: `Duration`, `ResetOn`, `Trigger`, `Action`, `Charges`, `Pool`, `Cost`, `Activation`, `Acquired`, `Feature`, `Item`, `Spell`, `Status`, `Ability` (union), `RecordKind`, `activationsOf(a): Activation[]`, `poolsOf(a): Pool[]`, `ActiveBuff` (+`activationId?`, `expires?`), `LogEvent` (+`activationId?`), `Battle` (`statuses: Status[]`, no `situational`), `PackSchema` (preprocessed by `convertPack` from Task 2).
- Consumes: `convertPack`, `convertBattle` from `migrate.ts` (Task 2). Until Task 2 lands, import them as identity stubs (see Step 3).

- [ ] **Step 1: Write the failing schema tests**

Replace `packages/engine/test/schema.test.ts` with:

```ts
import { AbilitySchema, PackSchema, ConditionSchema, BattleSchema, activationsOf, poolsOf } from '../src/schema';

const woodlandArcher = {
  id: 'woodland-archer', name: 'Woodland Archer', kind: 'feature',
  effects: [{ id: 'adjust-for-range', label: 'Adjust for Range', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', vs: 'current', scope: 'thisRound' } }] }, do: [{ verb: 'modify', to: 'attack', value: 4 }] }],
};

test('accepts a well-formed feature with defaults', () => {
  const a = AbilitySchema.parse(woodlandArcher);
  expect(a.kind).toBe('feature');
  if (a.kind !== 'feature') throw new Error('kind');
  expect(a.acquired).toEqual({ kind: 'feat' });
  expect(a.activations).toEqual([]);
  expect(a.pools).toEqual([]);
  expect(a.enabledByDefault).toBe(true);
  expect(a.effects[0]).toMatchObject({ trigger: 'always' });
});

test('item requires item meta; activation defaults; charges is optional (at will)', () => {
  expect(AbilitySchema.safeParse({ id: 'x', name: 'X', kind: 'item' }).success).toBe(false);
  const hog = AbilitySchema.parse({
    id: 'hand-of-glory', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' },
    effects: [{ id: 'slot', do: [{ verb: 'slot', slot: 'ring' }] }],
    activations: [
      { id: 'hog-daylight', name: 'Daylight', charges: { max: 1 }, spell: 'daylight' },
      { id: 'hog-torch', name: 'Torch', action: 'free' },
    ],
  });
  expect(activationsOf(hog)[0]).toMatchObject({ id: 'hog-daylight', action: 'standard', charges: { max: 1, resetOn: 'day' }, cost: [], onUse: [], whileActive: [] });
  expect(activationsOf(hog)[1]!.charges).toBeUndefined();
  expect(poolsOf(hog)).toEqual([]);
});

test('spell and status carry only their own fields', () => {
  const s = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', level: 3, duration: { minutes: 50 } });
  expect(s).toMatchObject({ kind: 'spell', castingAction: 'standard', level: 3 });
  expect(AbilitySchema.safeParse({ id: 'd', name: 'D', kind: 'spell', activations: [] }).success).toBe(false);
  const st = AbilitySchema.parse({ id: 'shaken', name: 'Shaken', kind: 'status', harmful: true, effects: [{ id: 's', do: [{ verb: 'modify', to: 'attack', value: -2 }] }] });
  expect(st).toMatchObject({ kind: 'status', harmful: true });
  expect(activationsOf(st)).toEqual([]);
});

test('rejects dropped vocabulary: origin, binding, old durations, old resets, old triggers', () => {
  expect(AbilitySchema.safeParse({ ...woodlandArcher, origin: 'feat' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ ...woodlandArcher, binding: 'none' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'h', name: 'H', kind: 'status', duration: 'endOfRound' }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'i', name: 'I', kind: 'item', item: { category: 'gear' }, activations: [{ id: 'a', charges: { max: 1, resetOn: 'rest' } }] }).success).toBe(false);
  expect(AbilitySchema.safeParse({ ...woodlandArcher, effects: [{ id: 'e', trigger: 'onUse', do: [{ verb: 'note', text: 'x' }] }] }).success).toBe(false);
});

test('rejects unknown condition forms and bad selectors', () => {
  expect(ConditionSchema.safeParse({ kind: 'target.isRed' }).success).toBe(false);
  expect(ConditionSchema.safeParse({ is: 'nowhere.x' }).success).toBe(false);
  expect(ConditionSchema.safeParse({ is: 'target.tag.red' }).success).toBe(true);
});

test('battle has statuses and buffs carry activation id and expiry', () => {
  const b = BattleSchema.parse({ id: 'b', startedAt: 'now', activeBuffs: [{ instanceId: 'x', abilityId: 'boots', activationId: 'boots-rounds', expires: 'untilMyNextTurn', remainingRounds: 1 }] });
  expect(b.statuses).toEqual([]);
  expect(b.activeBuffs[0]).toMatchObject({ activationId: 'boots-rounds', expires: 'untilMyNextTurn', suppressed: false });
});

test('pack parses v3 records', () => {
  const r = PackSchema.safeParse({ id: 'p', name: 'P', version: 1, tags: [{ id: 'aquatic', label: 'Aquatic', category: 'habitat' }], abilities: [woodlandArcher] });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/engine/test/schema.test.ts`
Expected: FAIL (`activationsOf` not exported; `kind` unknown key etc.).

- [ ] **Step 3: Rewrite the envelope section of `schema.ts`**

Keep everything from the top of the file down to and including `EffectSchema` unchanged, except these edits:

1. Replace `DurationSchema` with:

```ts
export const DurationSchema = z.union([
  z.literal('thisAttack'), z.literal('thisTurn'), z.literal('untilMyNextTurn'),
  z.object({ rounds: z.union([z.number().int().positive(), z.string()]) }), z.object({ minutes: z.number().positive() }),
  z.literal('encounter'), z.literal('untilRemoved'),
]);
export type Duration = z.infer<typeof DurationSchema>;

export const ResetOnSchema = z.enum(['round', 'encounter', 'day', 'never']);
export type ResetOn = z.infer<typeof ResetOnSchema>;
```

2. Replace `TriggerSchema` with:

```ts
export const TriggerSchema = z.enum(['always', 'onHit', 'onMiss', 'onCrit', 'onDamaged', 'onRoundStart', 'onRoundEnd']);
```

3. Replace everything from `// ---------- ability envelope ----------` through `export type AbilityInput = ...` with:

```ts
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
});
export type Feature = z.infer<typeof FeatureSchema>;

export const ItemSchema = z.object({
  ...recordBase,
  kind: z.literal('item'),
  item: ItemMetaSchema,
  activations: z.array(ActivationSchema).default([]),
  pools: z.array(PoolSchema).default([]),
});
export type Item = z.infer<typeof ItemSchema>;

export const SpellSchema = z.object({
  ...recordBase,
  kind: z.literal('spell'),
  level: z.number().int().min(0).optional(),
  castingAction: ActionSchema.default('standard'),
  duration: DurationSchema.optional(),
});
export type Spell = z.infer<typeof SpellSchema>;

export const StatusSchema = z.object({
  ...recordBase,
  kind: z.literal('status'),
  harmful: z.boolean().default(false),
  duration: DurationSchema.optional(),
});
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
```

`z.discriminatedUnion` needs each member to be a plain `z.object` (they are). Note `FeatureSchema` etc. use `.strict()`? No: keep them non-strict for forward compatibility, but the "rejects dropped vocabulary" test needs `origin`/`binding` rejected. Add `.strict()` to all four record objects (`z.object({...}).strict()`). Zod's discriminated union accepts strict objects.

4. In `PackSchema`, replace the `abilities` line with `abilities: z.array(AbilitySchema).default([]),` and wrap the pack:

```ts
const PackInnerSchema = z.object({ /* unchanged fields, abilities as above */ });
/** Packs written in the v1 or v2 format are converted on parse. */
export const PackSchema = z.preprocess((raw) => convertPack(raw), PackInnerSchema);
export type Pack = z.infer<typeof PackInnerSchema>;
```

Change the import at the top of the file from `import { convertV1 } from './migrate';` to `import { convertPack, convertBattle } from './migrate';`. Until Task 2, add these two temporary exports at the bottom of `migrate.ts` so the engine compiles:

```ts
export function convertPack<T>(raw: T): T { return raw; }
export function convertBattle<T>(raw: T): T { return raw; }
```

5. Battle section:

```ts
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
```

Add `activationId: z.string().optional(),` to `LogEventSchema` after `abilityId`. In `BattleSchema` replace `situational: z.array(AbilitySchema).default([]),` with `statuses: z.array(StatusSchema).default([]),` and wrap: `const BattleInnerSchema = z.object({...}); export const BattleSchema = z.preprocess((raw) => convertBattle(raw), BattleInnerSchema); export type Battle = z.infer<typeof BattleInnerSchema>;`.

Delete `OriginSchema`, `Origin`, `BindingSchema`, `Binding`, `ActivationSchema` (old union), `ResourceDefSchema`, `ResourceDef`.

- [ ] **Step 4: Run the schema tests**

Run: `npx vitest run packages/engine/test/schema.test.ts`
Expected: PASS (7 tests). Other engine test files will fail to compile until later tasks; that is expected.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/schema.ts packages/engine/src/migrate.ts packages/engine/test/schema.test.ts
git commit -m "Engine schema v3: record kinds (feature/item/spell/status) and activations replace origin/binding/activation/resources/grants"
```

---

### Task 2: v2 → v3 converter

**Files:**
- Modify: `packages/engine/src/migrate.ts`
- Test: `packages/engine/test/migrate.test.ts`

**Interfaces:**
- Produces: `isV2Ability(a)`, `convertDurationV3(d)`, `convertV2(a, lookup?)`, `convertToV3(a, lookup?)` (v1→v2→v3, idempotent), `convertPack(raw)` (abilities array, with sibling lookup), `convertBattle(raw)` (`situational`→`statuses`, buffs get `activationId` when the record has activations), `stripToggle(cond, id)`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing converter tests**

Append to `packages/engine/test/migrate.test.ts` (keep the existing v1 tests; change their expectations as noted at the end of this step):

```ts
import { convertToV3, convertPack, convertBattle } from '../src/migrate';
import { AbilitySchema, BattleSchema, activationsOf, poolsOf } from '../src/schema';

const boots = { id: 'boots-of-speed', name: 'Boots of Speed', origin: 'item', binding: 'none', activation: { action: 'free' }, duration: 'endOfRound', item: { category: 'wondrous', slot: 'feet', tags: [] }, resources: [{ id: 'boots-rounds', label: 'Haste rounds', max: 10, resetOn: 'day', resetTo: 'max' }], cost: [{ kind: 'charge', resourceId: 'boots-rounds', amount: 1 }], grants: [], enabledByDefault: true, effects: [{ id: 'haste', trigger: 'always', when: { all: [] }, do: [{ verb: 'attack', extraAttacks: 1, penaltyAll: 0, appliesToBase: 'full' }] }] };
const monsterBlow = { id: 'monster-blow', name: 'Monster Blow', origin: 'classFeature', binding: 'none', activation: 'declare', cost: [], resources: [{ id: 'monster-blow', max: '1 + floor(classLevel(monster-hunter) / 5)', resetOn: 'day', resetTo: 'max' }], grants: [], enabledByDefault: true, effects: [
  { id: 'declared', trigger: 'always', when: { all: [{ is: 'battle.toggle.monster-blow' }, { in: 'target.tags', param: 'types' }] }, do: [{ verb: 'note', text: 'MONSTER BLOW' }] },
  { id: 'use', trigger: 'onUse', when: { all: [] }, do: [{ verb: 'resource', id: 'monster-blow', op: 'consume', amount: 1 }] },
] };
const hog = { id: 'hand-of-glory', name: 'Hand of Glory', origin: 'item', binding: 'none', activation: 'passive', cost: [], resources: [], grants: ['hog-daylight'], enabledByDefault: true, item: { category: 'wondrous', slot: 'neck', tags: [] }, effects: [{ id: 'slot', trigger: 'always', when: { all: [] }, do: [{ verb: 'slot', slot: 'ring', count: 1 }] }] };
const daylight = { id: 'hog-daylight', name: 'Daylight', origin: 'spell', binding: 'none', activation: { action: 'standard' }, cost: [], resources: [{ id: 'hog-daylight', label: 'Daylight', max: 1, resetOn: 'day', resetTo: 'max' }], grants: [], enabledByDefault: true, effects: [] };
const flaming = { id: 'flaming-bow', name: 'Flaming', origin: 'item', binding: 'thisWeapon', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, item: { category: 'weapon', slot: 'mainHand', tags: [], weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex' } }, effects: [{ id: 'f', trigger: 'always', when: { all: [] }, do: [{ verb: 'dice', dice: '1d6', damageType: 'fire' }] }] };
const shaken = { id: 'shaken', name: 'Shaken', origin: 'condition', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, duration: 'whileActive', effects: [{ id: 's', trigger: 'always', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: -2, type: 'untyped', mode: 'add' }, { verb: 'tag', to: 'self', tag: 'x', duration: 'endOfRound' }] }] };
const memory = { id: 'memento-aqua', name: 'Memento Aqua', origin: 'memory', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] };
const potion = { id: 'potion-cmw', name: 'Potion', origin: 'item', binding: 'none', activation: { action: 'standard' }, item: { category: 'potion', tags: [] }, cost: [{ kind: 'item', abilityId: 'potion-cmw', quantity: 1 }], resources: [], grants: [], enabledByDefault: true, effects: [{ id: 'h', trigger: 'onUse', when: { all: [] }, do: [{ verb: 'hp', op: 'heal', amount: 10 }] }] };
const classFeat = { id: 'rapid-shot', name: 'Rapid Shot', origin: 'classFeature', classId: 'ranger', classLevel: 2, binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] };

test('v2 item with a charged, sustained activation becomes one activation with inline charges and whileActive blocks', () => {
  const a = AbilitySchema.parse(convertToV3(boots));
  expect(a.kind).toBe('item');
  expect(a.effects).toEqual([]);
  const [act] = activationsOf(a);
  expect(act).toMatchObject({ id: 'boots-rounds', action: 'free', charges: { max: 10, resetOn: 'day', label: 'Haste rounds' }, cost: [], duration: 'untilMyNextTurn' });
  expect(act!.whileActive.map((b) => b.id)).toEqual(['haste']);
  expect(poolsOf(a)).toEqual([]);
});

test('declare ability becomes a free activation lasting this attack; its own toggle condition is stripped', () => {
  const a = AbilitySchema.parse(convertToV3(monsterBlow));
  const [act] = activationsOf(a);
  expect(act).toMatchObject({ id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: '1 + floor(classLevel(monster-hunter) / 5)', resetOn: 'day' } });
  expect(act!.whileActive[0]!.when).toEqual({ all: [{ in: 'target.tags', param: 'types' }] });
  expect(act!.onUse).toEqual([{ id: 'use', trigger: 'always', when: { all: [] }, do: [{ verb: 'resource', id: 'monster-blow', op: 'consume', amount: 1 }] }]);
  if (a.kind === 'feature') expect(a.acquired).toEqual({ kind: 'class' });
});

test('grants become activations casting the granted spell with the spell\'s charges; the spell loses its resources', () => {
  const lookup = (id: string) => ({ 'hog-daylight': daylight } as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
  const item = AbilitySchema.parse(convertToV3(hog, lookup));
  expect(activationsOf(item)).toEqual([expect.objectContaining({ id: 'hog-daylight', name: 'Daylight', spell: 'hog-daylight', charges: { max: 1, resetOn: 'day', label: 'Daylight' } })]);
  const spell = AbilitySchema.parse(convertToV3(daylight));
  expect(spell).toMatchObject({ kind: 'spell', castingAction: 'standard' });
  expect((spell as Record<string, unknown>).resources).toBeUndefined();
});

test('binding thisWeapon becomes a weapon-id condition on every block', () => {
  const a = AbilitySchema.parse(convertToV3(flaming));
  expect(a.effects[0]!.when).toEqual({ all: [{ compare: 'attack.weapon.id', op: '=', value: 'flaming-bow' }] });
});

test('conditions become harmful statuses; durations inside effects are converted', () => {
  const a = AbilitySchema.parse(convertToV3(shaken));
  expect(a).toMatchObject({ kind: 'status', harmful: true, duration: 'untilRemoved' });
  expect(a.effects[0]!.do[1]).toMatchObject({ verb: 'tag', duration: 'untilMyNextTurn' });
});

test('memory → feature acquired dm; classFeature keeps class and level; potion keeps item cost and onUse', () => {
  expect(AbilitySchema.parse(convertToV3(memory))).toMatchObject({ kind: 'feature', acquired: { kind: 'dm' } });
  expect(AbilitySchema.parse(convertToV3(classFeat))).toMatchObject({ acquired: { kind: 'class', classId: 'ranger', level: 2 } });
  const p = AbilitySchema.parse(convertToV3(potion));
  expect(activationsOf(p)[0]).toMatchObject({ id: 'potion-cmw', cost: [{ kind: 'item', abilityId: 'potion-cmw', quantity: 1 }] });
  expect(activationsOf(p)[0]!.onUse[0]!.do).toEqual([{ verb: 'hp', op: 'heal', amount: 10 }]);
});

test('convertToV3 is idempotent and handles v1 input', () => {
  const once = convertToV3(boots);
  expect(convertToV3(once)).toEqual(once);
  const fromV1 = AbilitySchema.parse(convertToV3({ id: 'x', name: 'X', source: 'feat', activation: 'declare', resources: [{ id: 'x', max: 1, per: 'day' }], effects: [{ id: 'b', trigger: 'onUse', do: [{ kind: 'consume', resourceId: 'x' }] }] }));
  expect(activationsOf(fromV1)[0]).toMatchObject({ id: 'x', action: 'free', duration: 'thisAttack', charges: { max: 1, resetOn: 'day' } });
});

test('convertPack converts abilities with sibling lookup; convertBattle renames situational and keys buffs by activation', () => {
  const pack = convertPack({ id: 'p', name: 'P', version: 1, abilities: [hog, daylight] }) as { abilities: { kind: string; activations?: unknown[] }[] };
  expect(pack.abilities.map((a) => a.kind)).toEqual(['item', 'spell']);
  expect(pack.abilities[0]!.activations).toHaveLength(1);
  const b = BattleSchema.parse(convertBattle({ id: 'b', startedAt: 'now', situational: [{ id: 'sit-1', name: 'Darkness', origin: 'situational', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] }], activeBuffs: [{ instanceId: 'i', abilityId: 'boots-of-speed', owner: 'self', suppressed: false, remainingRounds: 1 }] }, (id) => (id === 'boots-of-speed' ? AbilitySchema.parse(convertToV3(boots)) : undefined)));
  expect(b.statuses[0]).toMatchObject({ id: 'sit-1', kind: 'status' });
  expect(b.activeBuffs[0]).toMatchObject({ abilityId: 'boots-of-speed', activationId: 'boots-rounds' });
});
```

In the existing v1 tests in the same file, change `AbilitySchema.parse(convertV1(v1))` to `AbilitySchema.parse(convertToV3(v1))` and update expectations: `a.origin` → `a.kind === 'feature'`; `a.resources[0]` assertion → `activationsOf(a)[0]!.charges` `toMatchObject({ max: 1, resetOn: 'day' })`; the `effects[1]` (trigger onUse) block now lives at `activationsOf(a)[0]!.onUse[0]!.do`; the `{ is: 'battle.toggle.x' }` entry disappears from `effects[0].when.all` (declare toggle stripped) and `effects[0]` moves to `activationsOf(a)[0]!.whileActive[0]` because a declare ability has a duration. Keep the idempotency test on `convertV1` as is.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/migrate.test.ts`
Expected: FAIL (`convertToV3` not exported).

- [ ] **Step 3: Implement the converter**

Remove the two identity stubs added in Task 1 and append to `packages/engine/src/migrate.ts`:

```ts
// ---------- v2 → v3 ----------
type Kind = 'feature' | 'item' | 'spell' | 'status';
const KIND_OF_ORIGIN: Record<string, Kind> = { feat: 'feature', classFeature: 'feature', race: 'feature', memory: 'feature', core: 'feature', monster: 'feature', item: 'item', spell: 'spell', buff: 'status', condition: 'status', situational: 'status' };
const RESET_V3: Record<string, string> = { rest: 'day', manual: 'never' };
const ON_USE_TRIGGERS = new Set(['onUse', 'onActivate']);

export function isV2Ability(a: unknown): boolean {
  return isObj(a) && 'origin' in a && !('kind' in a);
}

export function convertDurationV3(d: unknown): Duration | undefined {
  if (d === undefined || d === null || d === 'instant') return undefined;
  if (d === 'endOfRound' || d === 'endOfNextTurn') return 'untilMyNextTurn';
  if (d === 'whileActive' || d === 'concentration') return 'untilRemoved';
  return d as Duration;
}

/** Remove `is battle.toggle.<id>` leaves (a converted declare ability is simply active while declared). */
export function stripToggle(c: unknown, id: string): unknown {
  if (!isObj(c)) return c;
  const sel = `battle.toggle.${id}`;
  for (const k of ['all', 'any', 'none', 'count'] as const) {
    if (Array.isArray(c[k])) return { ...c, [k]: (c[k] as unknown[]).filter((x) => !(isObj(x) && x.is === sel)).map((x) => stripToggle(x, id)) };
  }
  if ('not' in c) return { ...c, not: stripToggle(c.not, id) };
  return c;
}

function convertBlockV3(b: Any): Any {
  const list = Array.isArray(b.do) ? (b.do as Any[]) : [];
  const out = list.map((e) => {
    const x = { ...e };
    if (x.verb === 'tag') x.duration = convertDurationV3(x.duration) ?? 'untilRemoved';
    if (x.verb === 'grant' && 'duration' in x) { const d = convertDurationV3(x.duration); if (d === undefined) delete x.duration; else x.duration = d; }
    return x;
  });
  return { ...b, do: out };
}

function chargesOf(r: Any): Any {
  return { max: r.max, resetOn: RESET_V3[r.resetOn as string] ?? r.resetOn ?? 'day', ...(r.label ? { label: r.label } : {}) };
}

/** Convert a v2 ability (origin-based envelope) to a v3 record. v3 input is returned as-is. `lookup` resolves sibling ids for `grants`. */
export function convertV2(a: unknown, lookup: (id: string) => Any | undefined = () => undefined): Any {
  if (!isObj(a) || !isV2Ability(a)) return a as Any;
  const kind = KIND_OF_ORIGIN[a.origin as string] ?? 'feature';
  const id = a.id as string;
  const blocks = (Array.isArray(a.effects) ? (a.effects as Any[]) : []).map(convertBlockV3);
  const bindCond = a.binding === 'thisWeapon' ? { compare: 'attack.weapon.id', op: '=', value: id }
    : isObj(a.binding) && 'slot' in a.binding ? { compare: `self.equipped.slot.${a.binding.slot as string}`, op: '>=', value: 1 } : undefined;
  const withBind = (b: Any): Any => {
    if (!bindCond) return b;
    const w = b.when;
    const inner = isObj(w) && Array.isArray(w.all) ? (w.all as unknown[]) : w ? [w] : [];
    return { ...b, when: { all: [bindCond, ...inner] } };
  };
  const isDeclare = a.activation === 'declare';
  let passive = blocks.filter((b) => !ON_USE_TRIGGERS.has((b.trigger as string) ?? 'always') && b.trigger !== 'onDeactivate').map(withBind).map((b) => ({ ...b, when: isDeclare ? stripToggle(b.when, id) : b.when }));
  const onUse = blocks.filter((b) => ON_USE_TRIGGERS.has(b.trigger as string)).map((b) => { const { trigger: _t, ...rest } = b; return rest; });
  const base: Any = { id, name: a.name, kind, ...(a.text !== undefined ? { text: a.text } : {}), ...(a.sourceRef !== undefined ? { sourceRef: a.sourceRef } : {}), ...(a.todo !== undefined ? { todo: a.todo } : {}) };
  const duration = convertDurationV3(a.duration);

  if (kind === 'status') return { ...base, harmful: a.origin === 'condition', ...(duration ? { duration } : {}), effects: passive };
  if (kind === 'spell') {
    const castingAction = isObj(a.activation) && 'action' in a.activation ? a.activation.action : 'standard';
    return { ...base, castingAction, ...(duration ? { duration } : {}), effects: passive };
  }

  const resources = (Array.isArray(a.resources) ? (a.resources as Any[]) : []);
  const cost = (Array.isArray(a.cost) ? (a.cost as Any[]) : []);
  const isReaction = isObj(a.activation) && 'reaction' in a.activation;
  const isActive = a.activation !== undefined && a.activation !== 'passive' && !isReaction;
  const activations: Any[] = [];
  const pools: Any[] = resources.map((r) => ({ id: r.id, ...(r.label ? { label: r.label } : {}), max: r.max, resetOn: RESET_V3[r.resetOn as string] ?? r.resetOn ?? 'day' }));

  if (isActive || resources.length || cost.length || onUse.length) {
    const own = resources[0];
    const chargeCost = cost.find((c) => c.kind === 'charge');
    const usesOwn = !!own && (!chargeCost || chargeCost.resourceId === own.id);
    const action = isDeclare ? 'free' : isObj(a.activation) && 'action' in a.activation ? a.activation.action : 'standard';
    const act: Any = {
      id: usesOwn ? (own!.id as string) : id,
      ...(action !== 'standard' ? { action } : {}),
      ...(usesOwn ? { charges: chargesOf(own!) } : {}),
      cost: cost.filter((c) => !(usesOwn && c.kind === 'charge' && c.resourceId === own!.id)),
      ...(isDeclare ? { duration: duration ?? 'thisAttack' } : duration ? { duration } : {}),
      onUse,
      whileActive: [],
    };
    if (usesOwn) pools.shift();
    // An active ability with a duration applied its passive blocks only while active.
    if (isActive && act.duration) { act.whileActive = passive; passive = []; }
    activations.push(act);
  }

  for (const g of (Array.isArray(a.grants) ? (a.grants as string[]) : [])) {
    const t = lookup(g);
    if (!t) continue;
    const r0 = Array.isArray(t.resources) ? (t.resources as Any[])[0] : undefined;
    const taction = isObj(t.activation) && 'action' in t.activation ? t.activation.action : 'standard';
    activations.push({ id: g, name: t.name, ...(taction !== 'standard' ? { action: taction } : {}), ...(r0 ? { charges: chargesOf(r0) } : {}), cost: [], ...(t.origin === 'spell' ? { spell: g } : {}), onUse: [], whileActive: [] });
  }

  if (kind === 'item') return { ...base, item: isObj(a.item) ? a.item : { category: 'gear', tags: [] }, effects: passive, activations, pools };
  const acquired = a.origin === 'classFeature'
    ? { kind: 'class', ...(a.classId ? { classId: a.classId } : {}), ...(a.classLevel !== undefined ? { level: a.classLevel } : {}) }
    : a.origin === 'race' ? { kind: 'race' } : a.origin === 'memory' || a.origin === 'core' ? { kind: 'dm' } : { kind: 'feat' };
  return { ...base, acquired, ...(isObj(a.params) ? { params: a.params } : {}), enabledByDefault: a.enabledByDefault ?? true, effects: passive, activations, pools };
}

/** v1 or v2 → v3. Idempotent. */
export function convertToV3(a: unknown, lookup?: (id: string) => Any | undefined): Any {
  return convertV2(convertV1(a), lookup ? (id) => { const x = lookup(id); return x ? convertV1(x) : undefined; } : undefined);
}

/** Convert every ability of a pack-like object (packs, library exports, backups); other fields untouched. */
export function convertPack(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.abilities)) return raw;
  const v2 = (raw.abilities as unknown[]).map((a) => convertV1(a));
  const byId = new Map(v2.filter(isObj).map((a) => [a.id as string, a] as const));
  return { ...raw, abilities: v2.map((a) => convertV2(a, (id) => byId.get(id))) };
}

/** Stored battles: `situational` → `statuses`; buffs on records with activations get the first activation's id. */
export function convertBattle(raw: unknown, lookup: (id: string) => { kind: string; activations?: { id: string }[] } | undefined = () => undefined): unknown {
  if (!isObj(raw)) return raw;
  const out: Any = { ...raw };
  if (Array.isArray(out.situational)) {
    out.statuses = [...((out.statuses as unknown[]) ?? []), ...(out.situational as unknown[]).map((s) => { const r = convertToV3(s); return r.kind === 'status' ? r : { id: r.id, name: r.name, kind: 'status', effects: r.effects ?? [] }; })];
    delete out.situational;
  }
  if (Array.isArray(out.activeBuffs)) {
    out.activeBuffs = (out.activeBuffs as Any[]).map((b) => {
      if (!isObj(b) || b.activationId) return b;
      const rec = lookup(b.abilityId as string);
      const first = rec?.activations?.[0];
      return first && rec.kind !== 'status' ? { ...b, activationId: first.id } : b;
    });
  }
  return out;
}
```

`Duration` is already imported at the top of `migrate.ts`. `convertBattle`'s `lookup` is optional so `schema.ts` can call `convertBattle(raw)` without a library; the store (Task 8) passes one.

- [ ] **Step 4: Run migrate and schema tests**

Run: `npx vitest run packages/engine/test/migrate.test.ts packages/engine/test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/migrate.ts packages/engine/test/migrate.test.ts
git commit -m "Migrate v2 abilities to v3 records: activations from activation/cost/resources/grants, binding to conditions, statuses from buffs and conditions"
```

---

### Task 3: Context, selectors, history, describe for records

**Files:**
- Modify: `packages/engine/src/context.ts`, `packages/engine/src/selectors.ts`, `packages/engine/src/history.ts`, `packages/engine/src/describe.ts`, `packages/engine/src/equipment.ts`
- Test: `packages/engine/test/conditions.test.ts` (add cases at the end)

**Interfaces:**
- Produces: `findResourceDef(ctx, id): { def: { id, label?, max, resetOn }, abilityId } | undefined` (pool id, activation id, or record id fallback); `nameOf(ctx, id)` in describe (record or activation name); `ResetOn` re-exported from schema.
- Consumes: Task 1 types.

- [ ] **Step 1: Add failing selector tests**

Append to `packages/engine/test/conditions.test.ts` (this file uses `makeAbility` from fixtures; fixtures are updated in Task 7, so write these tests with `AbilitySchema.parse` directly):

```ts
import { AbilitySchema } from '../src/schema';
import { readSelector } from '../src/selectors';
import { describeSelector } from '../src/describe';
import { makeBattle, makeCharacter, makeCtx } from './fixtures';

test('self.ability.<id> reads activation and record state; usesLeft by pool, activation or record id', () => {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', action: 'free', charges: { max: 10 }, duration: 'untilMyNextTurn' }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'boots', enabled: true, paramValues: {} }], resourceState: { 'boots-rounds': { used: 3 } } }), battle: makeBattle({ activeBuffs: [{ instanceId: 'i', abilityId: 'boots', activationId: 'boots-rounds', owner: 'self', suppressed: false, remainingRounds: 1 }] }) });
  c.library.abilities['boots'] = boots;
  expect(readSelector(c, 'self.ability.boots.active')).toBe(true);
  expect(readSelector(c, 'self.ability.boots-rounds.active')).toBe(true);
  expect(readSelector(c, 'self.ability.boots.usesLeft')).toBe(7);
  expect(readSelector(c, 'self.ability.boots-rounds.used')).toBe(3);
  expect(readSelector(c, 'self.resource.boots-rounds.left')).toBe(7);
  expect(describeSelector(c, 'self.ability.boots-rounds.active')).toBe('Boots is active');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/conditions.test.ts -t "self.ability"`
Expected: FAIL (compile errors on `activationId` or wrong values).

- [ ] **Step 3: Update `context.ts`**

Replace `findResourceDef` and the `ResetOn` type with:

```ts
import { activationsOf, poolsOf, type ResetOn } from './schema';
export type { ResetOn };

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
```

Add `Expr` to the type import from `./schema`. `resourceUsed` keeps its signature (`resetOn: ResetOn`).

- [ ] **Step 4: Update `selectors.ts`**

In `case 'ability'`:

```ts
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
```

In `equippedItems` and `case 'equipped'`/`case 'weapon'`, item meta access becomes kind-guarded: `x.ability.kind === 'item' ? x.ability.item.slot : undefined` etc. Write a small helper at the top of the file:

```ts
function itemMeta(a: Ability | undefined) { return a && a.kind === 'item' ? a.item : undefined; }
```

and use `itemMeta(x.ability)?.slot`, `itemMeta(x.ability)?.category`, `itemMeta(x.ability)?.tags.includes(tag)`, `itemMeta(w)?.category`, `itemMeta(w)?.tags.includes(...)`. `case 'param'`: unchanged (params only on features; `paramValues` is on the instance).

- [ ] **Step 5: Update `history.ts`**

`case 'used'`: match `e.abilityId === f.abilityId || e.activationId === f.abilityId`. Replace the day-scope block with:

```ts
if (f.scope === 'day' && f.event === 'used' && f.abilityId && f.vs === 'any') {
  const def = findResourceDef(ctx, f.abilityId);
  if (def && def.def.resetOn === 'day') n = Math.max(n, ctx.character.resourceState[def.def.id]?.used ?? 0);
}
```

Import `findResourceDef` from `./context`.

- [ ] **Step 6: Update `describe.ts`**

Replace `abilityName` with:

```ts
/** Name of a record or of an activation by id. */
export function nameOf(ctx: EvalContext, id: string): string {
  const rec = ctx.library.abilities[id] ?? ctx.battle?.statuses.find((s) => s.id === id);
  if (rec) return rec.name;
  for (const a of Object.values(ctx.library.abilities)) for (const act of activationsOf(a)) if (act.id === id) return act.name ?? a.name;
  return id;
}
```

Use `nameOf` everywhere `abilityName` was used. `case 'toggle'` text becomes `` `"${rest}" switched on` ``. Import `activationsOf` from `./schema`.

- [ ] **Step 7: Update `equipment.ts`**

```ts
export function slotOf(ability: Ability | undefined): SlotId | 'none' | undefined {
  return ability && ability.kind === 'item' ? ability.item.slot : undefined;
}
```

`slotCapacity`: iterate `for (const b of src.blocks)` (the `Source.blocks` field arrives in Task 4; until then this line fails to typecheck, which is fine because the whole engine typechecks only after Task 4).

- [ ] **Step 8: Run the new test**

Run: `npx vitest run packages/engine/test/conditions.test.ts -t "self.ability"`
Expected: PASS (other tests in the file may still fail until Task 7 fixtures land; only this test must pass now).

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/context.ts packages/engine/src/selectors.ts packages/engine/src/history.ts packages/engine/src/describe.ts packages/engine/src/equipment.ts packages/engine/test/conditions.test.ts
git commit -m "Engine lookups by record or activation id: charges via findResourceDef, activation buffs in self.ability.*.active, item meta by kind"
```

---

### Task 4: resolve.ts — sources from records and activations, actions from activations

**Files:**
- Modify: `packages/engine/src/resolve.ts`
- Test: `packages/engine/test/resolve.test.ts` (add one test block at the end; the file's existing tests are fixed in Task 7)

**Interfaces:**
- Produces: `Source = { ability, instance?, kind: 'ability'|'buff'|'activation', activation?, blocks, label }`; `activeSources`; `collectEffects` (reads `source.blocks`); `ActionInfo` (activation-based); `availableActions(ctx)`; `listPools(ctx)`.
- Consumes: Task 1 types, Task 3 `findResourceDef`.

- [ ] **Step 1: Add failing test**

Append to `packages/engine/test/resolve.test.ts`:

```ts
import { AbilitySchema } from '../src/schema';
import { availableActions, listPools, activeSources } from '../src/resolve';
import { makeBattle, makeCharacter, makeCtx } from './fixtures';

test('availableActions lists activations with charges, spell name and declare flag; pools are listed separately', () => {
  const hog = AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, activations: [{ id: 'hog-daylight', spell: 'daylight', charges: { max: 1 } }, { id: 'hog-torch', name: 'Torch' }] });
  const daylight = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', duration: { minutes: 50 } });
  const blow = AbilitySchema.parse({ id: 'monster-blow', name: 'Monster Blow', kind: 'feature', acquired: { kind: 'class', classId: 'monster-hunter' }, pools: [{ id: 'trophies', max: 4, resetOn: 'never' }], activations: [{ id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: 1 } }] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'hog', enabled: true, paramValues: {} }, { abilityId: 'monster-blow', enabled: true, paramValues: {} }], resourceState: { 'hog-daylight': { used: 1 } } }), battle: makeBattle() });
  for (const a of [hog, daylight, blow]) c.library.abilities[a.id] = a;
  const actions = availableActions(c);
  expect(actions.map((a) => [a.abilityId, a.activationId, a.name, a.usable, a.declare])).toEqual([
    ['hog', 'hog-daylight', 'Daylight', false, false],
    ['hog', 'hog-torch', 'Torch', true, false],
    ['monster-blow', 'monster-blow', 'Monster Blow', true, true],
  ]);
  expect(actions[0]!.charges).toMatchObject({ id: 'hog-daylight', remaining: 0, max: 1, resetOn: 'day' });
  expect(actions[1]!.charges).toBeUndefined();
  expect(actions[2]!.acquired).toEqual({ kind: 'class', classId: 'monster-hunter' });
  expect(listPools(c)).toEqual([{ id: 'trophies', label: 'Monster Blow', remaining: 4, max: 4, resetOn: 'never', abilityId: 'monster-blow' }]);
  c.battle!.activeBuffs.push({ instanceId: 'b', abilityId: 'hog', activationId: 'hog-daylight', owner: 'self', suppressed: false });
  const src = activeSources(c).find((s) => s.kind === 'activation');
  expect(src).toMatchObject({ label: 'Daylight', activation: { id: 'hog-daylight' } });
  expect(src!.blocks).toEqual(daylight.effects);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/resolve.test.ts -t "availableActions lists"`
Expected: FAIL.

- [ ] **Step 3: Rewrite the sources and actions sections of `resolve.ts`**

Replace the imports line for schema types with `import { activationsOf, poolsOf, type Ability, type Acquired, type Action, type Activation, type AttackKind, type AttackProfile, type BonusType, type Duration, type Effect, type EffectBlock, type StatId, type Value } from './schema';` and `findResourceDef` added to the `./context` import.

Replace `ActionInfo`, `Source`, `bindingOk`, `activeSources`:

```ts
export type ActionInfo = {
  abilityId: string;
  activationId: string;
  /** Activation name (or the spell's, or the record's). */
  name: string;
  recordName: string;
  kind: Ability['kind'];
  acquired?: Acquired;
  action: Action;
  /** Lasts one attack or one turn: shown as a pre-roll chip. */
  declare: boolean;
  duration?: Duration;
  charges?: { id: string; label: string; remaining: number; max: number; resetOn: string };
  costText: string[];
  active: boolean;
  usable: boolean;
  eligible: boolean;
  reasons: string[];
  notes: string[];
};

export type PoolInfo = { id: string; label: string; remaining: number; max: number; resetOn: string; abilityId: string };

// ---------- sources ----------
export type Source = {
  ability: Ability;
  instance: AbilityInstance | undefined;
  kind: 'ability' | 'buff' | 'activation';
  activation?: Activation;
  /** Blocks this source contributes right now. */
  blocks: EffectBlock[];
  /** Shown in breakdowns and near-miss lists. */
  label: string;
};

/** Every record/activation currently contributing blocks: enabled features and equipped items (their `effects`), active statuses and grant buffs (record `effects`), and running activations (`whileActive` plus the cast spell's `effects`). */
export function activeSources(ctx: EvalContext, warnings: string[] = []): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  const push = (key: string, s: Source) => { if (seen.has(key)) return; seen.add(key); out.push(s); };
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) { warnings.push(`Unknown ability "${inst.abilityId}" on character; ignored.`); continue; }
    if (ability.kind === 'status' || ability.kind === 'spell') continue; // only while active
    push(ability.id, { ability, instance: inst, kind: 'ability', blocks: ability.effects, label: ability.name });
  }
  for (const buff of ctx.battle?.activeBuffs ?? []) {
    if (buff.owner !== 'self' || buff.suppressed || suppressed.has(buff.abilityId)) continue;
    const ability = ctx.library.abilities[buff.abilityId] ?? ctx.battle?.statuses.find((s) => s.id === buff.abilityId);
    if (!ability) { warnings.push(`Unknown buff "${buff.abilityId}"; ignored.`); continue; }
    const instance = ctx.character.abilities.find((a) => a.abilityId === buff.abilityId);
    if (buff.activationId) {
      const activation = activationsOf(ability).find((x) => x.id === buff.activationId);
      if (!activation) { warnings.push(`${ability.name} has no activation "${buff.activationId}"; ignored.`); continue; }
      const spell = activation.spell ? ctx.library.abilities[activation.spell] : undefined;
      push(`${ability.id}/${activation.id}`, { ability, instance, kind: 'activation', activation, blocks: [...activation.whileActive, ...(spell?.kind === 'spell' ? spell.effects : [])], label: activation.name ?? spell?.name ?? ability.name });
    } else {
      push(ability.id, { ability, instance, kind: 'buff', blocks: ability.effects, label: ability.name });
    }
  }
  return out;
}
```

In `collectEffects`: `for (const block of source.blocks)` and near-miss `sourceName: source.label, label: block.label ?? source.label`. In `resolveFlags`: `for (const block of source.blocks)`. In `attackProfiles`: item meta via `a.kind === 'item' ? a.item.weapon : undefined`; natural attack name uses `source.label`. In `resolveStat`: `names[source.ability.id] = source.label; const label = block.label ?? source.label;` and the dice label `effect.label ?? source.label`. In `resolveValue`: `sourceName: source.label` and warning text uses `source.label`.

Replace `availableActions` with:

```ts
// ---------- actions ----------
function chargeInfo(ctx: EvalContext, id: string, vars: ReturnType<typeof exprVars>, fallbackLabel: string) {
  const d = findResourceDef(ctx, id);
  if (!d) return undefined;
  const max = evalExpr(d.def.max, vars);
  return { id: d.def.id, label: d.def.label ?? fallbackLabel, remaining: max - resourceUsed(ctx, d.def.id, d.def.resetOn), max, resetOn: d.def.resetOn };
}

/** One row per activation of every enabled feature and equipped item. */
export function availableActions(ctx: EvalContext): ActionInfo[] {
  const out: ActionInfo[] = [];
  const vars = exprVars(ctx);
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) continue;
    for (const act of activationsOf(ability)) {
      const spell = act.spell ? ctx.library.abilities[act.spell] : undefined;
      const name = act.name ?? spell?.name ?? ability.name;
      const reasons: string[] = [];
      const charges = act.charges ? chargeInfo(ctx, act.id, vars, name) : undefined;
      let usable = true;
      if (charges && charges.remaining <= 0) { usable = false; reasons.push(`No charges left (${charges.remaining}/${charges.max} per ${charges.resetOn})`); }
      const costText: string[] = [];
      for (const c of act.cost) {
        if (c.kind === 'charge') { const p = chargeInfo(ctx, c.resourceId, vars, c.resourceId); const n = evalExpr(c.amount, vars); costText.push(`${n} ${p?.label ?? c.resourceId}`); if (p && p.remaining < n) { usable = false; reasons.push(`Not enough ${p.label} (${p.remaining}/${p.max})`); } }
        else if (c.kind === 'item') { const have = ctx.character.inventory.filter((i) => i.abilityId === c.abilityId).reduce((s, i) => s + i.quantity, 0); costText.push(`${c.quantity} ${ctx.library.abilities[c.abilityId]?.name ?? c.abilityId}`); if (have < c.quantity) { usable = false; reasons.push('None left'); } }
        else if (c.kind === 'hp') costText.push(`${evalExpr(c.amount, vars)} hp`);
        else if (c.kind === 'spellSlot') costText.push(`level ${c.level} slot`);
        else costText.push(`${c.amount} ${c.kind}`);
      }
      const ectx: EvalContext = { ...ctx, abilityInstance: inst };
      const blocks = [...act.onUse, ...act.whileActive];
      let eligible = true;
      const notes: string[] = [];
      if (blocks.length) {
        const passing = blocks.filter((b) => evalCondition(b.when, ectx));
        eligible = passing.length > 0;
        if (!eligible) for (const b of blocks) { const f = firstFailure(b.when, ectx); if (f) reasons.push(`Needs: ${f}`); }
        for (const b of passing) for (const e of b.do) if (e.verb === 'note') notes.push(interpolate(e.text, vars));
      }
      const duration = act.duration ?? (spell?.kind === 'spell' ? spell.duration : undefined);
      const active = !!ctx.battle?.activeBuffs.some((b) => b.abilityId === ability.id && b.activationId === act.id && !b.suppressed);
      out.push({
        abilityId: ability.id, activationId: act.id, name, recordName: ability.name, kind: ability.kind,
        ...(ability.kind === 'feature' ? { acquired: ability.acquired } : {}),
        action: act.action, declare: duration === 'thisAttack' || duration === 'thisTurn', ...(duration ? { duration } : {}),
        ...(charges ? { charges } : {}), costText, active, usable, eligible, reasons, notes,
      });
    }
  }
  return out;
}

/** Shared pools on enabled records (not inline activation charges). */
export function listPools(ctx: EvalContext): PoolInfo[] {
  const out: PoolInfo[] = [];
  const vars = exprVars(ctx);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    for (const p of poolsOf(ability)) {
      const max = evalExpr(p.max, vars);
      out.push({ id: p.id, label: p.label ?? ability!.name, remaining: max - resourceUsed(ctx, p.id, p.resetOn), max, resetOn: p.resetOn, abilityId: ability!.id });
    }
  }
  return out;
}
```

Remove `bindingOk` entirely. Keep `listAttackModes`, `resolveAttack` unchanged apart from the `source.label` edits.

- [ ] **Step 4: Run the new test**

Run: `npx vitest run packages/engine/test/resolve.test.ts -t "availableActions lists"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/resolve.ts packages/engine/test/resolve.test.ts
git commit -m "Resolve from record blocks and running activations; actions listed per activation with charges, cost and declare flag"
```

---

### Task 5: battle.ts — use activations, statuses, thisAttack expiry

**Files:**
- Modify: `packages/engine/src/battle.ts`
- Test: `packages/engine/test/battle.test.ts` (add tests at the end; existing ones fixed in Task 7)

**Interfaces:**
- Produces: `useAbility(ctx, { abilityId, activationId?, targetId? })`, `addStatus(ctx, spec: SituationalSpec): Battle`, `logAttack` (drops `thisAttack` buffs), `nextRound` (no declare reset), `longRest(character, library?)` (keeps `never` pools), `newBattle()` with `statuses: []`, `durationRounds` for the v3 enum.
- Consumes: Task 3 `findResourceDef`, Task 4 `activeSources`.

- [ ] **Step 1: Add failing tests**

Append to `packages/engine/test/battle.test.ts`:

```ts
import { AbilitySchema } from '../src/schema';
import { addStatus, logAttack as logAttack3, longRest as longRest3, useAbility as useAbility3 } from '../src/battle';
import { availableActions as actions3, resolveAttack as resolve3 } from '../src/resolve';
import { makeBattle as mkBattle, makeCharacter as mkChar, makeCombatant as mkComb, makeCtx as mkCtx } from './fixtures';

function v3ctx() {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots of Speed', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', action: 'free', charges: { max: 10 }, duration: 'untilMyNextTurn', whileActive: [{ id: 'h', do: [{ verb: 'modify', to: 'attack', value: 1, type: 'dodge' }] }] }] });
  const blow = AbilitySchema.parse({ id: 'monster-blow', name: 'Monster Blow', kind: 'feature', activations: [{ id: 'monster-blow', action: 'free', charges: { max: 1 }, duration: 'thisAttack', whileActive: [{ id: 'n', do: [{ verb: 'note', text: 'BLOW' }] }] }] });
  const hog = AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, activations: [{ id: 'hog-daylight', spell: 'daylight', charges: { max: 1 } }, { id: 'hog-cure', spell: 'cure', charges: { max: 2 } }] });
  const daylight = AbilitySchema.parse({ id: 'daylight', name: 'Daylight', kind: 'spell', duration: { minutes: 50 }, effects: [{ id: 'l', do: [{ verb: 'flag', flag: 'sense.light' }] }] });
  const cure = AbilitySchema.parse({ id: 'cure', name: 'Cure', kind: 'spell', effects: [{ id: 'h', do: [{ verb: 'hp', op: 'heal', amount: 5 }] }] });
  const wand = AbilitySchema.parse({ id: 'wand', name: 'Wand', kind: 'item', item: { category: 'wand' }, pools: [{ id: 'wand-charges', max: 50, resetOn: 'never' }], activations: [{ id: 'wand-cure', spell: 'cure', cost: [{ kind: 'charge', resourceId: 'wand-charges' }] }] });
  const c = mkCtx({
    character: mkChar({ hp: { max: 44, current: 20, temp: 0, nonlethal: 0 }, abilities: ['boots', 'monster-blow', 'hog', 'wand'].map((id) => ({ abilityId: id, enabled: true, paramValues: {} })) }),
    battle: mkBattle({ combatants: [mkComb({ id: 'c1' })] }),
  });
  for (const a of [boots, blow, hog, daylight, cure, wand]) c.library.abilities[a.id] = a;
  c.target = c.battle!.combatants[0];
  return c;
}

test('useAbility by activation: spends inline charges, starts a buff keyed by activation with expiry', () => {
  let c = v3ctx();
  c = { ...c, ...useAbility3(c, { abilityId: 'boots', activationId: 'boots-rounds' }) };
  expect(c.character.resourceState['boots-rounds']).toEqual({ used: 1 });
  expect(c.battle!.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'boots', activationId: 'boots-rounds', expires: 'untilMyNextTurn', remainingRounds: 1 })]);
  expect(c.battle!.log.at(-1)).toMatchObject({ kind: 'use', abilityId: 'boots', activationId: 'boots-rounds' });
  expect(resolve3(c, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(11);
});

test('a declared activation lasts one attack: gone after logAttack, charge stays spent', () => {
  let c = v3ctx();
  c = { ...c, ...useAbility3(c, { abilityId: 'monster-blow', targetId: 'c1' }) };
  expect(actions3(c).find((a) => a.activationId === 'monster-blow')).toMatchObject({ active: true, usable: false });
  expect(resolve3(c, { profileId: 'bow', modeId: 'single' }).notes).toContain('BLOW');
  c = { ...c, ...logAttack3(c, { targetId: 'c1', profileId: 'bow', modeId: 'single', attackIndex: 1, result: 'hit' }) };
  expect(c.battle!.activeBuffs).toEqual([]);
  expect(c.character.resourceState['monster-blow']).toEqual({ used: 1 });
});

test('spell activations: a spell with a duration runs as a buff; an instant spell applies its effects once; pool costs are spent', () => {
  let c = v3ctx();
  c = { ...c, ...useAbility3(c, { abilityId: 'hog', activationId: 'hog-daylight' }) };
  expect(c.battle!.activeBuffs).toEqual([expect.objectContaining({ abilityId: 'hog', activationId: 'hog-daylight', remainingRounds: 500, label: 'Daylight' })]);
  expect(c.character.resourceState['hog-daylight']).toEqual({ used: 1 });
  c = { ...c, ...useAbility3(c, { abilityId: 'hog', activationId: 'hog-cure' }) };
  expect(c.character.hp.current).toBe(25);
  expect(c.battle!.activeBuffs).toHaveLength(1);
  c = { ...c, ...useAbility3(c, { abilityId: 'wand', activationId: 'wand-cure' }) };
  expect(c.character.hp.current).toBe(30);
  expect(c.character.resourceState['wand-charges']).toEqual({ used: 1 });
  expect(longRest3(c.character, c.library).resourceState).toEqual({ 'wand-charges': { used: 1 } });
});

test('addStatus stores a status record on the battle and activates it', () => {
  const c = v3ctx();
  const b = addStatus(c, { label: 'DM: darkness', target: 'self', to: 'attack', value: -2, duration: { rounds: 3 } });
  expect(b.statuses[0]).toMatchObject({ kind: 'status', name: 'DM: darkness', harmful: true });
  expect(b.activeBuffs[0]).toMatchObject({ abilityId: b.statuses[0]!.id, remainingRounds: 3, expires: { rounds: 3 } });
  expect(resolve3({ ...c, battle: b }, { profileId: 'bow', modeId: 'single' }).attacks[0]!.attackBonus).toBe(8);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/engine/test/battle.test.ts -t "activation|addStatus|spell activations"`
Expected: FAIL.

- [ ] **Step 3: Edit `battle.ts`**

Imports: add `activationsOf, poolsOf, type Activation, type Status` from `./schema`; `findResourceDef` from `./context`; remove `ResetOn` import if unused.

`findPer`:

```ts
function findPer(ctx: EvalContext, resourceId: string): ResetOn {
  return findResourceDef(ctx, resourceId)?.def.resetOn ?? 'day';
}
```

`applyTriggered` `case 'grant'`: `const dur = e.duration ?? (g && (g.kind === 'status' || g.kind === 'spell') ? g.duration : undefined);` and the pushed buff gets `...(dur ? { expires: dur } : {})`.

`runTriggers`: replace the candidate collection with `activeSources`:

```ts
import { activeSources } from './resolve';
function runTriggers(ctx: EvalContext, trigger: Trigger, targetId: string | undefined, extra?: Partial<EvalContext>): State {
  let state: State = { battle: ctx.battle!, character: ctx.character };
  const target = targetId ? state.battle.combatants.find((c) => c.id === targetId) : undefined;
  for (const src of activeSources({ ...ctx, battle: state.battle, character: state.character })) {
    const ectx: EvalContext = { ...ctx, ...extra, battle: state.battle, character: state.character, target, abilityInstance: src.instance };
    for (const block of src.blocks) {
      if (block.trigger !== trigger || !evalCondition(block.when, ectx)) continue;
      state = applyTriggered(ectx, state, src.ability, block.do, targetId);
    }
  }
  return state;
}
```

(`resolve.ts` already imports nothing from `battle.ts`, so this import is not circular.)

`logAttack`: after the triggers loop add `state = { ...state, battle: { ...state.battle, activeBuffs: state.battle.activeBuffs.filter((b) => b.expires !== 'thisAttack') } };` before `stampUndo`.

`useAbility` and `payCosts`:

```ts
export type UseAbilityInput = { abilityId: string; activationId?: string; targetId?: string };

function payCosts(ctx: EvalContext, state: State, act: Activation, explicitConsumed: Set<string>): State {
  const vars = exprVars({ ...ctx, ...state });
  if (act.charges && !explicitConsumed.has(act.id)) state = changeResource(ctx, state, act.id, 1);
  for (const c of act.cost) {
    if (c.kind === 'charge') { if (!explicitConsumed.has(c.resourceId)) state = changeResource(ctx, state, c.resourceId, evalExpr(c.amount, vars)); }
    else if (c.kind === 'hp') { const n = evalExpr(c.amount, vars); state = { ...state, character: { ...state.character, hp: { ...state.character.hp, current: state.character.hp.current - n } } }; }
    else if (c.kind === 'item') {
      const inv = state.character.inventory;
      const idx = inv.findIndex((i) => i.abilityId === c.abilityId && i.quantity > 0);
      if (idx >= 0) state = { ...state, character: { ...state.character, inventory: inv.map((i, j) => (j === idx ? { ...i, quantity: Math.max(0, i.quantity - c.quantity) } : i)) } };
    }
  }
  return state;
}

/** Use an activation: log, start its buff if it (or its spell) has a duration, run onUse blocks (and an instant spell's effects), pay costs. */
export function useAbility(ctx: EvalContext, input: UseAbilityInput): State {
  if (!ctx.battle) throw new Error('No battle');
  const ability = ctx.library.abilities[input.abilityId];
  if (!ability) throw new Error(`Unknown ability "${input.abilityId}"`);
  const acts = activationsOf(ability);
  const act = input.activationId ? acts.find((x) => x.id === input.activationId) : acts[0];
  if (!act) throw new Error(`${ability.name} has no activation${input.activationId ? ` "${input.activationId}"` : ''}`);
  const spell = act.spell ? ctx.library.abilities[act.spell] : undefined;
  const spellRec = spell?.kind === 'spell' ? spell : undefined;
  const before: State = { battle: ctx.battle, character: ctx.character };
  let state: State = { battle: appendEvent(ctx.battle, { kind: 'use', actor: 'self', abilityId: ability.id, activationId: act.id, ...(input.targetId ? { targetId: input.targetId } : {}) }), character: ctx.character };
  const vars = exprVars(ctx);
  const duration = act.duration ?? spellRec?.duration;
  const rounds = durationRounds(duration, vars);
  if (duration && !state.battle.activeBuffs.some((b) => b.abilityId === ability.id && b.activationId === act.id && b.owner === 'self')) {
    state = { ...state, battle: { ...state.battle, activeBuffs: [...state.battle.activeBuffs, { instanceId: newId('buff'), abilityId: ability.id, activationId: act.id, owner: 'self', suppressed: false, expires: duration, label: act.name ?? spellRec?.name ?? ability.name, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] } };
  }
  const target = input.targetId ? state.battle.combatants.find((c) => c.id === input.targetId) : undefined;
  const inst = state.character.abilities.find((a) => a.abilityId === ability.id);
  const explicit = new Set<string>();
  const once = [...act.onUse, ...(spellRec && !duration ? spellRec.effects : [])];
  for (const block of once) {
    const ectx: EvalContext = { ...ctx, battle: state.battle, character: state.character, target, abilityInstance: inst };
    if (!evalCondition(block.when, ectx)) continue;
    for (const e of block.do) if (e.verb === 'resource' && e.op === 'consume') explicit.add(e.id);
    state = applyTriggered(ectx, state, ability, block.do, input.targetId);
  }
  state = payCosts(ctx, state, act, explicit);
  return stampUndo(before, state);
}
```

`durationRounds`:

```ts
export function durationRounds(d: Duration | undefined, vars: ReturnType<typeof exprVars>): number | undefined {
  if (d === undefined) return undefined;
  if (typeof d === 'object') return 'rounds' in d ? evalExpr(d.rounds, vars) : Math.max(1, Math.round(d.minutes * 10));
  switch (d) {
    case 'thisAttack': case 'thisTurn': case 'untilMyNextTurn': return 1;
    default: return undefined;
  }
}
```

`expired`:

```ts
function expired(c: Conditioned, newRound: number): boolean {
  const from = c.appliedRound ?? newRound;
  const d = c.expires;
  if (!d || d === 'untilRemoved' || d === 'encounter') return false;
  if (d === 'thisTurn' || d === 'thisAttack') return newRound > from;
  if (d === 'untilMyNextTurn') return newRound >= from + 2;
  if ('rounds' in d) return newRound >= from + (typeof d.rounds === 'number' ? d.rounds : 1);
  return newRound >= from + Math.max(1, Math.round(d.minutes * 10));
}
```

`nextRound`: delete the `declareIds` line and set `toggles: ctx.battle.toggles` (manual toggles persist unchanged).

`addSituational` → `addStatus`, building a Status:

```ts
export function addStatus(ctx: EvalContext, spec: SituationalSpec): Battle {
  if (!ctx.battle) throw new Error('No battle');
  let battle = ctx.battle;
  const duration = spec.duration ?? 'encounter';
  if (spec.target === 'self') {
    const effects: Effect[] = [];
    if (spec.to && spec.value !== undefined) effects.push({ verb: 'modify', to: spec.to, value: spec.value, type: spec.bonusType ?? 'untyped', mode: 'add' });
    if (spec.note) effects.push({ verb: 'note', text: spec.note });
    if (spec.suppressAbilityId && !battle.suppressedAbilities.includes(spec.suppressAbilityId)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, spec.suppressAbilityId] };
    if (spec.tag) battle = { ...battle, selfConditions: addCondition(battle.selfConditions, { tag: spec.tag, expires: duration, appliedRound: battle.round, source: 'situational' }) };
    if (effects.length) {
      const status: Status = { id: newId('sit'), name: spec.label, kind: 'status', harmful: (spec.value ?? 0) < 0, duration, effects: [{ id: 'e', trigger: 'always', when: { all: [] }, do: effects }] };
      const rounds = durationRounds(duration, exprVars(ctx));
      battle = { ...battle, statuses: [...battle.statuses, status], activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId: status.id, owner: 'self', suppressed: false, label: spec.label, expires: duration, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] };
    }
    return battle;
  }
  const ids = spec.target === 'all' ? battle.combatants.map((c) => c.id) : [spec.target];
  const tag = spec.tag ?? spec.label;
  for (const id of ids) battle = withCombatant(battle, id, (c) => ({ ...c, conditions: addCondition(c.conditions, { tag, expires: duration, appliedRound: battle.round, source: 'situational' }) }));
  return battle;
}
```

`longRest`:

```ts
export function longRest(character: Character, library?: Library): Character {
  if (!library) return { ...character, resourceState: {} };
  const keep: Character['resourceState'] = {};
  for (const [id, st] of Object.entries(character.resourceState)) {
    const def = findResourceDef({ character, library }, id);
    if (def && def.def.resetOn === 'never') keep[id] = st;
  }
  return { ...character, resourceState: keep };
}
```

Import `Library` type from `./context`. `newBattle`: `statuses: []` instead of `situational: []`.

- [ ] **Step 4: Run new tests**

Run: `npx vitest run packages/engine/test/battle.test.ts -t "activation|addStatus|spell activations"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/battle.ts packages/engine/test/battle.test.ts
git commit -m "Battle: use by activation, spell activations (instant or buffed), pool costs, thisAttack buffs expire on the attack, statuses on the battle"
```

---

### Task 6: Fixtures and the rest of the engine test suite green

**Files:**
- Modify: `packages/engine/test/fixtures.ts`, `packages/engine/test/v2.test.ts`, `packages/engine/test/battle.test.ts` (old tests), `packages/engine/test/resolve.test.ts` (old tests), `packages/engine/test/undo.test.ts`, `packages/engine/test/equipment.test.ts`, `packages/engine/test/conditions.test.ts`, `packages/engine/test/pack.test.ts`, `packages/engine/src/pack.ts`, `packages/engine/src/index.ts`

**Interfaces:**
- Produces: `makeAbility(v1|v2|v3 input): Ability` converting through `convertToV3`; engine `npm test` and `npm run typecheck -w packages/engine` green.

- [ ] **Step 1: Update fixtures**

In `fixtures.ts` replace `makeAbility` with:

```ts
import { convertToV3 } from '../src/migrate';
/** Accepts v1 (`source`), v2 (`origin`) or v3 (`kind`) input. */
export function makeAbility(a: Record<string, unknown> & { id: string }): Ability {
  const raw = 'kind' in a || 'origin' in a ? a : { name: a.id, source: 'feat', ...a };
  return AbilitySchema.parse(convertToV3({ name: a.id, ...raw }));
}
```

`makeBattle` unchanged (BattleSchema converts).

- [ ] **Step 2: Update `pack.ts` and `index.ts`**

`pack.ts`: `for (const a of pack.abilities) put('ability', lib.abilities, AbilitySchema.parse(a));` (the pack is already v3 after `PackSchema.parse`; drop the `convertV1` import). `index.ts` unchanged unless a removed export breaks it (`export * from './migrate'` now also exports `convertToV3`, `convertPack`, `convertBattle`).

- [ ] **Step 3: Run the whole engine suite and fix each old test against the new model**

Run: `npm test`

Expected failures and the fix for each (apply them all, then re-run until green):

- `v2.test.ts`: `ctxWith` filters `a.origin !== 'buff' && a.origin !== 'spell'` → `a.kind !== 'status' && a.kind !== 'spell'`; `abilities.filter((a) => a.item)` → `a.kind === 'item'`; `enabled: !a.item || …` → `a.kind !== 'item' || …`. Boots test: `useAbility(c, { abilityId: 'boots' })` still works (first activation). `availableActions(c).find((a) => a.abilityId === 'boots')` still matches. Hand of Glory test: `actions.map((a) => [a.abilityId, a.grantedBy])` → `actions.map((a) => [a.activationId, a.abilityId])` expecting `[['hog-daylight', 'hog'], ['hog-see-invis', 'hog']]`; `useAbility(c, { abilityId: 'hog-daylight' })` → `useAbility(c, { abilityId: 'hog', activationId: 'hog-daylight' })`. The fixture `hog` is defined before `daylight`/`seeInvis`; `makeAbility` has no lookup, so define `hog` as v3 directly: `AbilitySchema.parse({ id: 'hog', name: 'Hand of Glory', kind: 'item', item: { category: 'wondrous', slot: 'neck' }, effects: [{ id: 's', do: [{ verb: 'slot', slot: 'ring' }] }], activations: [{ id: 'hog-daylight', spell: 'hog-daylight', charges: { max: 1 } }, { id: 'hog-see-invis', spell: 'hog-see-invis', charges: { max: 1 } }] })` and the two spells as `kind: 'spell'` (no resources). Helm test: `useAbility(c, { abilityId: 'helm' })` works (activation id `helm-rage`); expectation on `rage` buff unchanged. Potion test unchanged. `set and multiply` test: `origin: 'condition'`/`'buff'` convert to statuses; buffs pushed by id still resolve.
- `battle.test.ts` (old tests): `monsterBlow` fixture converts to a declare activation; the test "useAbility logs, consumes per-day charge on the character and clears the declare toggle": drop the `toggles` lines, expect `battle.log[0]` `toMatchObject({ kind: 'use', abilityId: 'monster-blow', activationId: 'monster-blow' })`, keep the `resourceState` and `usable: false` expectations, add `expect(battle.activeBuffs[0]).toMatchObject({ activationId: 'monster-blow', expires: 'thisAttack' })`. "useAbility with a buff ability adds an active buff": `haste` is now a status with no activation → `useAbility` throws; change the test to add the status via the drawer path: `const battle = { ...c.battle!, activeBuffs: [{ instanceId: 'x', abilityId: 'haste', owner: 'self', suppressed: false, remainingRounds: 2 }] }` and assert `resolveAttack` gets `+1`. "onUse effects: consume amount…": `bootsOfSpeed` fixture has `activation free` + resource + onUse consume 2 → converts to activation `boots-rounds` with `onUse` consuming 2 (explicit, so inline charge not spent again): expectations hold (`used: 2`, self condition `hasted` with `{ rounds: 2 }`). `monsterKnowledge` converts to activation `monster-knowledge` with onUse reveal: unchanged. "nextRound…": remove the two `toggles` expectations for `monster-blow` (declare no longer resets toggles); keep `in-aura` persisting; the boots `useAbility` there now also starts no buff (no duration) — fine. "addSituational…" → use `addStatus`, `b1.statuses` instead of `b1.situational`. "longRest resets per-day resources": pass `c.library` and keep expectation `{}` (both pools are per day).
- `resolve.test.ts` (old tests): search for `origin:` in fixtures and leave them (converted); any assertion on `a.origin` becomes `a.kind`; any `sourceName` assertions keep working (label = record name for passive sources).
- `undo.test.ts`: fixtures convert; no change expected.
- `equipment.test.ts`: uses `slotOf` on converted items; no change expected.
- `conditions.test.ts`: any `battle.toggle` tests remain valid (manual toggles).
- `pack.test.ts`: `abilities: [{ id: 'rapid-shot', name: 'Rapid Shot', source: 'feat', effects: [] }]` converts; the round-trip test compares `mergePack(emptyLibrary(), pack)` — still equal.
- `smoke.test.ts`: unchanged.

Fix anything else the run reports the same way: v1/v2 fixture → converted v3 shape.

- [ ] **Step 4: Typecheck the engine**

Run: `npm run typecheck -w packages/engine`
Expected: no errors. Fix leftovers (typical: `situational` references, `a.item?.` on the union → `a.kind === 'item' && a.item`, `ResetOn` import paths).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "Engine tests on the v3 model: fixtures convert v1/v2 input, activation-based use and actions, statuses"
```

---

### Task 7: Pack validator, generators, regenerated packs

**Files:**
- Modify: `tools/pack-validate.ts`, `tools/gen-core-pack.ts`, `tools/gen-memento-pack.ts`
- Regenerate: `packs/core-3.5e.json`, `packs/memento.json` (bestiary untouched)

**Interfaces:**
- Produces: packs in v3 format; `npm run validate-packs` green with v3 checks.

- [ ] **Step 1: Update the validator**

In `tools/pack-validate.ts` replace the per-ability loop body after `walk(b.when)` handling with:

```ts
import { activationsOf, poolsOf } from '../packages/engine/src';
const activationIds = new Map<string, string>();
for (const a of Object.values(lib.abilities)) {
  const blocks = [...a.effects, ...activationsOf(a).flatMap((x) => [...x.onUse, ...x.whileActive])];
  for (const b of blocks) {
    walk(b.when);
    for (const e of b.do) {
      if (e.verb === 'modify' && e.to.startsWith('skill.') && !lib.skills[e.to.slice(6)]) problems.push(`${a.id}: unknown skill "${e.to}"`);
      if (e.verb === 'tag' && !lib.tags[e.tag]) problems.push(`${a.id}: tag verb unknown tag "${e.tag}"`);
      if ((e.verb === 'grant' || e.verb === 'suppress') && !lib.abilities[e.ability]) problems.push(`${a.id}: ${e.verb} unknown ability "${e.ability}"`);
    }
  }
  const poolIds = new Set(poolsOf(a).map((p) => p.id));
  for (const act of activationsOf(a)) {
    const prev = activationIds.get(act.id);
    if (prev) problems.push(`${a.id}: activation id "${act.id}" already used by ${prev}`); else activationIds.set(act.id, a.id);
    if (act.spell && lib.abilities[act.spell]?.kind !== 'spell') problems.push(`${a.id}/${act.id}: spell "${act.spell}" is not a spell record`);
    for (const c of act.cost) {
      if (c.kind === 'charge' && !poolIds.has(c.resourceId) && !Object.values(lib.abilities).some((x) => poolsOf(x).some((p) => p.id === c.resourceId) || activationsOf(x).some((y) => y.id === c.resourceId && y.charges))) problems.push(`${a.id}/${act.id}: charge cost unknown pool "${c.resourceId}"`);
      if (c.kind === 'item' && lib.abilities[c.abilityId]?.kind !== 'item') problems.push(`${a.id}/${act.id}: item cost "${c.abilityId}" is not an item`);
    }
  }
}
```

(The `walk` closure must be hoisted above this loop; move it out of the old `for` body.) In the character loop, replace `for (const r of a.resources) evalExpr(r.max…)` with evaluating `act.charges.max` for each activation with charges and `p.max` for each pool.

- [ ] **Step 2: Core generator**

In `tools/gen-core-pack.ts`: delete the `knowledge-devotion-table` record; bump `version: 3`. Nothing else: `PackSchema.parse` converts the v1 entries to v3 on generation.

- [ ] **Step 3: Memento generator**

In `tools/gen-memento-pack.ts`:
1. Delete the three records `monster-knowledge`, `hunters-analysis`, `hunters-instinct`.
2. Replace the `vaelors-manual` record with a v3 record:

```ts
{
  id: 'vaelors-manual', name: "Vaelor's Monsters' Manual", kind: 'item', item: { category: 'wondrous', slot: 'none', weight: 5 },
  text: 'Unique artifact, no slot, CL 12. Grants Monster Knowledge, Hunter\'s Analysis, Hunter\'s Instinct and the Bestiary Collection.',
  effects: [{ id: 'instinct', label: "Hunter's Instinct", do: [{ verb: 'modify', to: 'skill.knowledge-monsters', value: 1 }] }],
  activations: [
    { id: 'monster-knowledge', name: 'Monster Knowledge', action: 'standard', onUse: [{ id: 'reveal', when: { compare: 'battle.prompt.knowledge', op: '>=', value: 16 }, do: [{ verb: 'reveal' }] }] },
    { id: 'hunters-analysis', name: "Hunter's Analysis", action: 'fullRound', onUse: [{ id: 'mark', do: [{ verb: 'tag', to: 'target', tag: 'analyzed', duration: 'encounter' }] }] },
  ],
},
```

and add the "Analyzed target" passive block (crit range +1 with the note) to the same record's `effects`, conditioned on `{ is: 'target.condition.analyzed' }`.
3. In `characters[0].abilities` remove `{ abilityId: 'monster-knowledge' }, { abilityId: 'hunters-analysis' }, { abilityId: 'hunters-instinct' }` (the manual is already linked via inventory).
4. Fold the KD table reference: nothing to do (Knowledge Devotion's own text already lists the table).
5. Bump `version: 10`.

- [ ] **Step 4: Regenerate and validate**

Run:
```bash
npx tsx tools/gen-core-pack.ts && npx tsx tools/gen-memento-pack.ts && npm run validate-packs
```
Expected: both packs written; validator prints attack lines for Memento and `OK: …` with 0 problems. Spot-check `packs/memento.json`: `hand-of-glory` has two activations with `spell` and charges; `boots-of-speed` has activation `boots-rounds` with `whileActive`; `monster-blow` activation has `duration: "thisAttack"`; no `origin`, `binding`, `grants`, `resources` keys remain (`grep -c '"origin"' packs/memento.json` → 0).

- [ ] **Step 5: Run engine tests once more (packs are not imported by engine tests, but `pack.test.ts` covers merge)**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools packs
git commit -m "Packs in rules v3: validator checks activations, spells and pools; Vaelor's Manual is one item with two activations; KD reference record dropped"
```

---

### Task 8: App store, hooks, and compile against the new engine

**Files:**
- Modify: `packages/app/src/store/store.ts`, `packages/app/src/store/hooks.ts`

**Interfaces:**
- Produces: hydrate converts stored libraries and battles; `collectToggles(ctx)` returns `{ id, abilities }[]` (no `declare`).

- [ ] **Step 1: store.ts**

Imports: replace `AbilitySchema, … convertV1` with `AbilitySchema, BattleSchema, CharacterSchema, PackSchema, convertToV3, convertBattle, emptyLibrary, mergePack, libraryToPack, newBattle, activationsOf`.

In `hydrate`, replace the `converted` line with:

```ts
const rawAbilities = (library.abilities ?? {}) as Record<string, unknown>;
const lookup = (id: string) => rawAbilities[id] as Record<string, unknown> | undefined;
const converted = Object.fromEntries(Object.entries(rawAbilities).map(([id, a]) => { try { return [id, AbilitySchema.parse(convertToV3(a, lookup))]; } catch { return [id, a]; } })) as FullLibrary['abilities'];
```

and the battle line with `battle: battle ? BattleSchema.parse(convertBattle(battle, (id) => lib.abilities[id])) : undefined,` (`lib` is built before `set`). Same for `restoreBackupText`: convert `raw.library.abilities` the same way and parse the battle with the lookup.

`reimportInventoryFromDefaults`: `.origin !== 'item'` → `.kind !== 'item'`, `.origin === 'item'` → `.kind === 'item'`.

- [ ] **Step 2: hooks.ts**

`collectToggles`: remove the `declare` parameter and field; walk `a.effects` plus `activationsOf(a).flatMap((x) => [...x.onUse, ...x.whileActive])`. Return type `{ id: string; abilities: string[] }[]`.

- [ ] **Step 3: Typecheck the app to get the error list**

Run: `npm run typecheck -w packages/app`
Expected: errors only in the files Tasks 9–12 rewrite (`AbilityEditor`, `LibraryScreen`, `InventoryScreen`, `CharacterScreen`, `AbilitySheet`, `LevelLedger`, `AttackPanel`, `BuffsDrawer`, `SituationalSheet`, `BattleScreen`, `SelectorPicker`, `EffectEditor`). No errors in `store/`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/store
git commit -m "App store converts stored rules and battles to v3 on load"
```

---

### Task 9: RecordEditor, ActivationEditor, BlocksEditor, condition presets

**Files:**
- Create: `packages/app/src/components/library/RecordEditor.tsx`, `packages/app/src/components/library/ActivationEditor.tsx`, `packages/app/src/components/library/BlocksEditor.tsx`
- Delete: `packages/app/src/components/library/AbilityEditor.tsx`
- Modify: `packages/app/src/components/library/ConditionEditor.tsx`, `packages/app/src/components/library/EffectEditor.tsx`

**Interfaces:**
- Produces: `<RecordEditor initial={Ability} onSave onCancel onDelete? />` (kind from `initial.kind`, never a field), `<ActivationEditor value onChange onRemove recordId />`, `<BlocksEditor value onChange triggers? presets? />`, `ConditionEditor` prop `presets?: { label: string; make: () => Condition }[]`, `DurationPicker` with the v3 options, `freshRecord(kind, idPrefix?)` exported from `RecordEditor.tsx`.

- [ ] **Step 1: BlocksEditor.tsx**

```tsx
import type { Condition, EffectBlock, Trigger } from '@hl/engine';
import { Button, inputCls } from '../ui';
import { ConditionEditor } from './ConditionEditor';
import { EffectEditor } from './EffectEditor';

export const TRIGGERS: { id: Trigger; label: string }[] = [
  { id: 'always', label: 'While conditions hold' }, { id: 'onHit', label: 'When I hit' }, { id: 'onMiss', label: 'When I miss' }, { id: 'onCrit', label: 'When I crit' },
  { id: 'onDamaged', label: 'When I take damage' }, { id: 'onRoundStart', label: 'At round start' }, { id: 'onRoundEnd', label: 'At round end' },
];
export type Preset = { label: string; make: () => Condition };

export function newBlock(n: number): EffectBlock {
  return { id: `e${n}`, trigger: 'always', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }] };
}

/** A list of effect blocks. `showTrigger` false = onUse blocks (trigger is implied). */
export function BlocksEditor({ value, onChange, showTrigger = true, presets, addLabel = '+ add effect block' }: { value: EffectBlock[]; onChange: (b: EffectBlock[]) => void; showTrigger?: boolean; presets?: Preset[]; addLabel?: string }) {
  const setBlock = (i: number, patch: Partial<EffectBlock>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-3">
      {value.map((b, i) => (
        <div key={i} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-2">
          <div className="mb-2 flex items-center gap-2">
            <input className={inputCls + ' flex-1'} placeholder="label (shown in breakdown)" value={b.label ?? ''} onChange={(e) => setBlock(i, { label: e.target.value || undefined })} />
            <button type="button" className="px-2 text-zinc-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          {showTrigger && <select className={inputCls + ' mb-2 text-sm'} value={b.trigger} onChange={(e) => setBlock(i, { trigger: e.target.value as Trigger })}>{TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>}
          <div className="mb-1 text-xs text-zinc-400">WHEN</div>
          <ConditionEditor value={b.when} onChange={(c) => setBlock(i, { when: c })} presets={presets} />
          <div className="mb-1 mt-2 text-xs text-zinc-400">DO</div>
          <div className="space-y-1">
            {b.do.map((e, k) => <EffectEditor key={k} value={e} onChange={(n) => setBlock(i, { do: b.do.map((x, m) => (m === k ? n : x)) })} onRemove={() => setBlock(i, { do: b.do.filter((_, m) => m !== k) })} />)}
            <button type="button" className="text-sm text-amber-300" onClick={() => setBlock(i, { do: [...b.do, { verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }] })}>+ add effect</button>
          </div>
        </div>
      ))}
      <Button onClick={() => onChange([...value, newBlock(value.length + 1)])}>{addLabel}</Button>
    </div>
  );
}
```

- [ ] **Step 2: ConditionEditor presets**

Add `presets?: Preset[]` (import the type from `./BlocksEditor`, or define it locally to avoid a cycle: `type Preset = { label: string; make: () => Condition }` in ConditionEditor and re-export it; then BlocksEditor imports it from ConditionEditor). In `list(arr, key)` render after the `+ add condition` button, only when `depth === 0 && presets?.length`:

```tsx
{depth === 0 && presets?.map((p) => <button key={p.label} type="button" className="ml-2 text-sm text-sky-300" onClick={() => set({ [key]: [...arr, p.make()] })}>+ {p.label}</button>)}
```

- [ ] **Step 3: EffectEditor**

`DurationPicker` options become `[['thisAttack', 'this attack'], ['thisTurn', 'this turn'], ['untilMyNextTurn', 'until my next turn'], ['rounds', 'N rounds'], ['minutes', 'N minutes'], ['encounter', 'whole battle'], ['untilRemoved', 'until removed']]`. `abilitySelect` option label `(${a.origin})` → `(${a.kind})`. For the `grant` verb, filter the list to `a.kind === 'status' || a.kind === 'feature'`.

- [ ] **Step 4: ActivationEditor.tsx**

```tsx
import type { Activation, Cost } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, Field, inputCls } from '../ui';
import { DurationPicker } from './EffectEditor';
import { BlocksEditor, type Preset } from './BlocksEditor';

const ACTIONS = ['free', 'swift', 'immediate', 'move', 'standard', 'fullRound'] as const;
const RESETS = ['round', 'encounter', 'day', 'never'] as const;

export function ActivationEditor({ value, onChange, onRemove, presets }: { value: Activation; onChange: (a: Activation) => void; onRemove: () => void; presets?: Preset[] }) {
  const abilities = useStore((s) => s.library.abilities);
  const set = (patch: Partial<Activation>) => onChange({ ...value, ...patch });
  const spells = Object.values(abilities).filter((a) => a.kind === 'spell').sort((a, b) => a.name.localeCompare(b.name));
  const items = Object.values(abilities).filter((a) => a.kind === 'item').sort((a, b) => a.name.localeCompare(b.name));
  const setCost = (i: number, c: Cost) => set({ cost: value.cost.map((x, j) => (j === i ? c : x)) });
  const numOrExpr = (s: string) => (/^\d+$/.test(s) ? Number(s) : s);
  return (
    <div className="rounded-2xl border border-amber-900/60 bg-zinc-900 p-2">
      <div className="mb-2 flex items-center gap-2">
        <input className={inputCls + ' flex-1'} placeholder="name (blank = record name)" value={value.name ?? ''} onChange={(e) => set({ name: e.target.value || undefined })} />
        <input className={inputCls + ' w-36'} placeholder="id" value={value.id} onChange={(e) => set({ id: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} />
        <button type="button" className="px-2 text-zinc-500" onClick={onRemove}>✕</button>
      </div>
      <Field label="Action">
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((k) => <Chip key={k} tone="blue" active={value.action === k} onClick={() => set({ action: k })}>{k}</Chip>)}
          <Chip tone="blue" active={typeof value.action === 'object'} onClick={() => set({ action: { minutes: 1 } })}>minutes…</Chip>
          {typeof value.action === 'object' && 'minutes' in value.action && <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={value.action.minutes} onChange={(e) => set({ action: { minutes: Number(e.target.value) || 1 } })} />}
        </div>
      </Field>
      <Field label="Charges (blank = at will)">
        {value.charges ? (
          <div className="flex flex-wrap items-center gap-1">
            <input className={inputCls + ' w-28 py-1.5'} placeholder="max" value={String(value.charges.max)} onChange={(e) => set({ charges: { ...value.charges!, max: numOrExpr(e.target.value) } })} />
            <select className={inputCls + ' w-auto py-1.5'} value={value.charges.resetOn} onChange={(e) => set({ charges: { ...value.charges!, resetOn: e.target.value as never } })}>{RESETS.map((r) => <option key={r} value={r}>per {r}</option>)}</select>
            <input className={inputCls + ' w-32 py-1.5'} placeholder="label" value={value.charges.label ?? ''} onChange={(e) => set({ charges: { ...value.charges!, label: e.target.value || undefined } })} />
            <button type="button" className="text-xs text-zinc-500" onClick={() => set({ charges: undefined })}>at will</button>
          </div>
        ) : <button type="button" className="text-sm text-amber-300" onClick={() => set({ charges: { max: 1, resetOn: 'day' } })}>+ limit uses</button>}
      </Field>
      <Field label="Other costs">
        {value.cost.map((c, i) => (
          <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
            <select className={inputCls + ' w-auto py-1.5'} value={c.kind} onChange={(e) => { const k = e.target.value as Cost['kind']; setCost(i, k === 'charge' ? { kind: 'charge', resourceId: '', amount: 1 } : k === 'item' ? { kind: 'item', abilityId: items[0]?.id ?? '', quantity: 1 } : k === 'spellSlot' ? { kind: 'spellSlot', level: 1 } : ({ kind: k, amount: 1 } as Cost)); }}>{['charge', 'hp', 'item', 'spellSlot', 'gold', 'xp'].map((k) => <option key={k} value={k}>{{ charge: 'from a pool', hp: 'hit points', item: 'consume an item', spellSlot: 'spell slot', gold: 'gold', xp: 'XP' }[k as 'charge']}</option>)}</select>
            {c.kind === 'charge' && <><input className={inputCls + ' w-32 py-1.5'} placeholder="pool id" value={c.resourceId} onChange={(e) => setCost(i, { ...c, resourceId: e.target.value })} /><input className={inputCls + ' w-16 py-1.5'} value={String(c.amount)} onChange={(e) => setCost(i, { ...c, amount: numOrExpr(e.target.value) })} /></>}
            {c.kind === 'hp' && <input className={inputCls + ' w-24 py-1.5'} value={String(c.amount)} onChange={(e) => setCost(i, { ...c, amount: numOrExpr(e.target.value) })} />}
            {(c.kind === 'gold' || c.kind === 'xp') && <input className={inputCls + ' w-24 py-1.5'} inputMode="numeric" value={c.amount} onChange={(e) => setCost(i, { ...c, amount: Number(e.target.value) || 0 })} />}
            {c.kind === 'item' && <><select className={inputCls + ' w-40 py-1.5'} value={c.abilityId} onChange={(e) => setCost(i, { ...c, abilityId: e.target.value })}>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><input className={inputCls + ' w-16 py-1.5'} inputMode="numeric" value={c.quantity} onChange={(e) => setCost(i, { ...c, quantity: Number(e.target.value) || 1 })} /></>}
            {c.kind === 'spellSlot' && <input className={inputCls + ' w-16 py-1.5'} inputMode="numeric" value={c.level} onChange={(e) => setCost(i, { ...c, level: Number(e.target.value) || 1 })} />}
            <button type="button" className="px-2 text-zinc-500" onClick={() => set({ cost: value.cost.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="text-sm text-amber-300" onClick={() => set({ cost: [...value.cost, { kind: 'charge', resourceId: '', amount: 1 }] })}>+ add cost</button>
      </Field>
      <Field label="Casts a spell">
        <select className={inputCls} value={value.spell ?? ''} onChange={(e) => set({ spell: e.target.value || undefined })}><option value="">— none —</option>{spells.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <Field label="Lasts (blank = instant; 'this attack' shows as a pre-roll chip)">
        {value.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={value.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: 'untilMyNextTurn' })}>+ set duration</button>}
      </Field>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">When used</div>
      <BlocksEditor value={value.onUse} onChange={(b) => set({ onUse: b })} showTrigger={false} presets={presets} addLabel="+ add on-use block" />
      {value.duration !== undefined && <>
        <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">While active</div>
        <BlocksEditor value={value.whileActive} onChange={(b) => set({ whileActive: b })} presets={presets} addLabel="+ add while-active block" />
      </>}
    </div>
  );
}
```

- [ ] **Step 5: RecordEditor.tsx**

```tsx
import { useState } from 'react';
import { AbilitySchema, SLOTS, type Ability, type Feature, type Item, type ItemCategory, type Spell, type Status } from '@hl/engine';
import { Button, Chip, Field, cx, inputCls } from '../ui';
import { BlocksEditor, type Preset } from './BlocksEditor';
import { ActivationEditor } from './ActivationEditor';
import { DurationPicker } from './EffectEditor';
import { useStore } from '../../store/store';

const ITEM_CATEGORIES: ItemCategory[] = ['weapon', 'armor', 'shield', 'ammunition', 'wondrous', 'potion', 'scroll', 'wand', 'tool', 'trophy', 'material', 'gear'];
const SLOTTED: Partial<Record<ItemCategory, readonly string[]>> = { weapon: ['mainHand', 'offHand'], armor: ['armor'], shield: ['offHand', 'buckler'], ammunition: ['quiver'], wondrous: SLOTS.map((s) => s.id), trophy: SLOTS.map((s) => s.id), tool: ['mainHand', 'offHand', 'none'] };
const RESETS = ['round', 'encounter', 'day', 'never'] as const;

export function freshRecord(kind: Ability['kind'], over: Partial<Item['item']> = {}): Ability {
  const id = `${kind}-${Date.now().toString(36)}`;
  switch (kind) {
    case 'feature': return { id, name: '', kind, acquired: { kind: 'feat' }, enabledByDefault: true, effects: [], activations: [], pools: [] };
    case 'item': return { id, name: '', kind, item: { category: 'gear', tags: [], ...over }, effects: [], activations: [], pools: [] };
    case 'spell': return { id, name: '', kind, castingAction: 'standard', effects: [] };
    case 'status': return { id, name: '', kind, harmful: false, effects: [] };
  }
}

export function RecordEditor({ initial, onSave, onDelete, onCancel }: { initial: Ability; onSave: (a: Ability) => void; onDelete?: () => void; onCancel: () => void }) {
  const library = useStore((s) => s.library);
  const [a, setA] = useState<Ability>(initial);
  const [tab, setTab] = useState<'builder' | 'json'>('builder');
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [err, setErr] = useState<string | undefined>();
  const set = (patch: Partial<Ability>) => setA({ ...a, ...patch } as Ability);
  const switchTab = (t: 'builder' | 'json') => {
    if (t === 'json') setJson(JSON.stringify(a, null, 2));
    else { try { setA(AbilitySchema.parse(JSON.parse(json))); setErr(undefined); } catch (e) { setErr((e as Error).message); return; } }
    setTab(t);
  };
  const save = () => {
    try {
      const parsed = AbilitySchema.parse(tab === 'json' ? JSON.parse(json) : a);
      if (parsed.kind !== initial.kind) throw new Error(`This is the ${initial.kind} editor; kind cannot change`);
      if (!parsed.id.trim()) throw new Error('id required');
      if (!parsed.name.trim()) throw new Error('name required');
      if (parsed.kind === 'item' && SLOTTED[parsed.item.category] && !parsed.item.slot) throw new Error(`Choose a body slot for this ${parsed.item.category}`);
      onSave(parsed);
    } catch (e) { setErr((e as Error).message); }
  };
  const presets: Preset[] = [
    ...(a.kind === 'item' ? [{ label: 'only with this weapon', make: () => ({ compare: 'attack.weapon.id', op: '=', value: a.id }) as const }] : []),
    { label: 'only while a slot is filled', make: () => ({ compare: 'self.equipped.slot.arms', op: '>=', value: 1 }) as const },
  ];
  const KIND_TITLE = { feature: 'Feature', item: 'Item', spell: 'Spell', status: 'Status' }[a.kind];

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl bg-zinc-900 p-1">{(['builder', 'json'] as const).map((t) => <button key={t} type="button" onClick={() => switchTab(t)} className={cx('flex-1 rounded-lg py-1.5 text-sm', tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>{t === 'builder' ? KIND_TITLE : 'JSON'}</button>)}</div>
      {tab === 'json' ? (
        <textarea className={inputCls + ' h-[55vh] font-mono text-xs'} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" htmlFor="ab-name"><input id="ab-name" className={inputCls} value={a.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Id (stable, no spaces)" htmlFor="ab-id"><input id="ab-id" className={inputCls} value={a.id} onChange={(e) => set({ id: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} /></Field>
          </div>
          {a.kind === 'feature' && <FeatureFields a={a} set={set} />}
          {a.kind === 'item' && <ItemFields a={a} set={set} />}
          {a.kind === 'spell' && <SpellFields a={a} set={set} />}
          {a.kind === 'status' && <StatusFields a={a} set={set} />}
          <Field label="Rules text"><textarea className={inputCls} value={a.text ?? ''} onChange={(e) => set({ text: e.target.value || undefined })} /></Field>
          <Field label="Source reference"><input className={inputCls} value={a.sourceRef ?? ''} onChange={(e) => set({ sourceRef: e.target.value || undefined })} placeholder="PHB p.98, DM card…" /></Field>

          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{{ feature: 'Passive effects (while enabled)', item: 'Passive effects (while equipped)', spell: 'Effects (while the spell lasts; instant spells apply them once)', status: 'Effects (while active)' }[a.kind]}</div>
          <BlocksEditor value={a.effects} onChange={(effects) => set({ effects })} presets={presets} />

          {(a.kind === 'feature' || a.kind === 'item') && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Activations (things you do with it)</div>
              <div className="space-y-3">
                {a.activations.map((act, i) => <ActivationEditor key={i} value={act} presets={presets} onChange={(n) => set({ activations: a.activations.map((x, j) => (j === i ? n : x)) } as Partial<Ability>)} onRemove={() => set({ activations: a.activations.filter((_, j) => j !== i) } as Partial<Ability>)} />)}
                <Button onClick={() => set({ activations: [...a.activations, { id: a.activations.length ? `${a.id}-${a.activations.length + 1}` : a.id, action: 'standard', cost: [], onUse: [], whileActive: [] }] } as Partial<Ability>)}>+ add activation</Button>
              </div>
              <Field label="Shared pools (only when several activations or records spend the same charges)">
                {a.pools.map((p, i) => (
                  <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
                    <input className={inputCls + ' w-32 py-1.5'} placeholder="id" value={p.id} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) } as Partial<Ability>)} />
                    <input className={inputCls + ' w-28 py-1.5'} placeholder="label" value={p.label ?? ''} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) } as Partial<Ability>)} />
                    <input className={inputCls + ' w-24 py-1.5'} placeholder="max" value={String(p.max)} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, max: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value } : x)) } as Partial<Ability>)} />
                    <select className={inputCls + ' w-auto py-1.5'} value={p.resetOn} onChange={(e) => set({ pools: a.pools.map((x, j) => (j === i ? { ...x, resetOn: e.target.value as never } : x)) } as Partial<Ability>)}>{RESETS.map((k) => <option key={k} value={k}>per {k}</option>)}</select>
                    <button type="button" className="px-2 text-zinc-500" onClick={() => set({ pools: a.pools.filter((_, j) => j !== i) } as Partial<Ability>)}>✕</button>
                  </div>
                ))}
                <button type="button" className="text-sm text-amber-300" onClick={() => set({ pools: [...a.pools, { id: `${a.id}-pool`, max: 1, resetOn: 'day' }] } as Partial<Ability>)}>+ add pool</button>
              </Field>
            </div>
          )}
          <Field label="Todo / open question"><input className={inputCls} value={a.todo ?? ''} onChange={(e) => set({ todo: e.target.value || undefined })} /></Field>
        </div>
      )}
      {err && <pre className="mt-2 whitespace-pre-wrap text-xs text-red-300">{err}</pre>}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={save}>Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {onDelete && <Button variant="danger" className="ml-auto" onClick={onDelete}>Delete</Button>}
      </div>
    </div>
  );
}

function FeatureFields({ a, set }: { a: Feature; set: (p: Partial<Ability>) => void }) {
  const library = useStore((s) => s.library);
  const acq = a.acquired;
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <Field label="How it was acquired">
        <div className="flex flex-wrap gap-1">
          {([['feat', 'general feat'], ['class', 'class feature'], ['race', 'racial'], ['dm', 'DM grant / memory']] as const).map(([k, l]) => <Chip key={k} active={acq.kind === k} onClick={() => set({ acquired: k === 'class' ? { kind: 'class' } : { kind: k } })}>{l}</Chip>)}
        </div>
        {acq.kind === 'class' && <div className="mt-1 grid grid-cols-2 gap-2"><select className={inputCls} value={acq.classId ?? ''} onChange={(e) => set({ acquired: { ...acq, classId: e.target.value || undefined } })}><option value="">— class —</option>{Object.values(library.classTables).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input className={inputCls} placeholder="class level" inputMode="numeric" value={acq.level ?? ''} onChange={(e) => set({ acquired: { ...acq, level: e.target.value === '' ? undefined : Number(e.target.value) } })} /></div>}
      </Field>
      <Field label="Choices made at level-up (favored enemy types, weapon…)">
        {Object.entries(a.params ?? {}).map(([name, def]) => (
          <div key={name} className="mb-1 flex items-center gap-1">
            <input className={inputCls + ' w-28'} value={name} onChange={(e) => { const p = { ...a.params }; delete p[name]; p[e.target.value] = def; set({ params: p }); }} />
            <select className={inputCls + ' w-auto'} value={def.kind} onChange={(e) => set({ params: { ...a.params, [name]: e.target.value === 'tags' ? { kind: 'tags', category: 'creatureType' } : e.target.value === 'number' ? { kind: 'number' } : { kind: 'choice', options: [] } } })}><option value="tags">tags</option><option value="number">number</option><option value="choice">choice</option></select>
            {def.kind === 'tags' && <input className={inputCls} placeholder="tag category" value={def.category ?? ''} onChange={(e) => set({ params: { ...a.params, [name]: { ...def, category: e.target.value || undefined } } })} />}
            {def.kind === 'choice' && <input className={inputCls} placeholder="options, comma separated" value={def.options.join(', ')} onChange={(e) => set({ params: { ...a.params, [name]: { ...def, options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } } })} />}
            <button type="button" className="px-2 text-zinc-500" onClick={() => { const p = { ...a.params }; delete p[name]; set({ params: Object.keys(p).length ? p : undefined }); }}>✕</button>
          </div>
        ))}
        <button type="button" className="text-sm text-amber-300" onClick={() => set({ params: { ...a.params, types: { kind: 'tags', category: 'creatureType' } } })}>+ add choice</button>
      </Field>
      <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={a.enabledByDefault} onChange={(e) => set({ enabledByDefault: e.target.checked })} /> enabled when added to a character</label>
    </div>
  );
}

function ItemFields({ a, set }: { a: Item; set: (p: Partial<Ability>) => void }) {
  const item = a.item;
  const itemSet = (patch: Partial<Item['item']>) => set({ item: { ...item, ...patch } });
  const cat = item.category; const slots = SLOTTED[cat];
  const w = item.weapon ?? { kind: 'melee' as const, dice: '1d8', critRange: 20, critMult: 2, attackAbility: 'str' as const, damageAbility: 'str' as const, damageAbilityMultiplier: 1, enhancement: 0, tags: [] };
  const ws = (p: Partial<typeof w>) => itemSet({ weapon: { ...w, ...p } });
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <Field label="Item category" htmlFor="item-cat"><select id="item-cat" className={inputCls} value={cat} onChange={(e) => { const nc = e.target.value as ItemCategory; const ns = SLOTTED[nc]; itemSet({ category: nc, slot: ns ? (ns.length === 1 ? (ns[0] as never) : undefined) : undefined }); }}>{ITEM_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      {slots && (
        <Field label={`Body slot${item.slot ? '' : ' — choose one'}`}>
          <div className="flex flex-wrap gap-1">
            {slots.map((id) => <Chip key={id} tone="amber" active={item.slot === id} onClick={() => itemSet({ slot: id as never })}>{id === 'none' ? 'No slot (active when carried)' : SLOTS.find((s) => s.id === id)?.label ?? id}</Chip>)}
            {(cat === 'wondrous' || cat === 'trophy') && <Chip tone="amber" active={item.slot === 'none'} onClick={() => itemSet({ slot: 'none' })}>No slot (active when carried)</Chip>}
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Weight (lb)"><input className={inputCls} inputMode="decimal" value={item.weight ?? ''} onChange={(e) => itemSet({ weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        <Field label="Price"><input className={inputCls} value={item.price ?? ''} onChange={(e) => itemSet({ price: e.target.value || undefined })} /></Field>
      </div>
      <Field label="Item tags (bow, longbow, trophy-aberration…)"><input className={inputCls} value={item.tags.join(', ')} onChange={(e) => itemSet({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
      {cat === 'weapon' && (
        <div className="rounded-xl bg-zinc-950 p-2">
          <div className="mb-1 text-xs uppercase text-zinc-500">Weapon profile</div>
          <div className="mb-1 flex flex-wrap gap-1">{(['melee', 'ranged'] as const).map((k) => <Chip key={k} active={w.kind === k} onClick={() => ws({ kind: k, attackAbility: k === 'ranged' ? 'dex' : 'str' })}>{k}</Chip>)}</div>
          <div className="grid grid-cols-3 gap-1">
            <input className={inputCls} placeholder="dice 1d8" value={w.dice} onChange={(e) => ws({ dice: e.target.value })} />
            <input className={inputCls} placeholder="crit from (20)" inputMode="numeric" value={w.critRange} onChange={(e) => ws({ critRange: Number(e.target.value) || 20 })} />
            <input className={inputCls} placeholder="×mult" inputMode="numeric" value={w.critMult} onChange={(e) => ws({ critMult: Number(e.target.value) || 2 })} />
            <input className={inputCls} placeholder="enhancement" inputMode="numeric" value={w.enhancement} onChange={(e) => ws({ enhancement: Number(e.target.value) || 0 })} />
            <input className={inputCls} placeholder="range ft" inputMode="numeric" value={w.rangeIncrement ?? ''} onChange={(e) => ws({ rangeIncrement: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input className={inputCls} placeholder="max Str to dmg" inputMode="numeric" value={w.maxDamageAbilityBonus ?? ''} onChange={(e) => ws({ maxDamageAbilityBonus: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-400">attack uses <select className={inputCls + ' w-auto py-1'} value={w.attackAbility} onChange={(e) => ws({ attackAbility: e.target.value as 'str' })}>{['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select> damage uses <select className={inputCls + ' w-auto py-1'} value={w.damageAbility ?? ''} onChange={(e) => ws({ damageAbility: (e.target.value || undefined) as 'str' | undefined })}><option value="">none</option>{['str', 'dex'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select> ×<input className={inputCls + ' w-14 py-1'} value={w.damageAbilityMultiplier} onChange={(e) => ws({ damageAbilityMultiplier: Number(e.target.value) || 1 })} /></div>
        </div>
      )}
    </div>
  );
}

function SpellFields({ a, set }: { a: Spell; set: (p: Partial<Ability>) => void }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 p-2">
      <Field label="Spell level"><input className={inputCls} inputMode="numeric" value={a.level ?? ''} onChange={(e) => set({ level: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      <Field label="Casting action"><select className={inputCls} value={typeof a.castingAction === 'string' ? a.castingAction : 'minutes'} onChange={(e) => set({ castingAction: e.target.value === 'minutes' ? { minutes: 1 } : (e.target.value as 'standard') })}>{['free', 'swift', 'immediate', 'move', 'standard', 'fullRound', 'minutes'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
      <div className="col-span-2"><Field label="Duration (blank = instant)">{a.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={a.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: { rounds: 10 } })}>+ set duration</button>}</Field></div>
    </div>
  );
}

function StatusFields({ a, set }: { a: Status; set: (p: Partial<Ability>) => void }) {
  return (
    <div className="mb-3 rounded-2xl border border-zinc-800 p-2">
      <div className="mb-2 flex gap-1"><Chip tone="green" active={!a.harmful} onClick={() => set({ harmful: false })}>buff</Chip><Chip tone="red" active={a.harmful} onClick={() => set({ harmful: true })}>harmful condition</Chip></div>
      <Field label="Default duration (blank = until removed)">{a.duration !== undefined ? <div className="flex items-center gap-2"><DurationPicker value={a.duration} onChange={(d) => set({ duration: d })} /><button type="button" className="text-xs text-zinc-500" onClick={() => set({ duration: undefined })}>clear</button></div> : <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: { rounds: 10 } })}>+ set duration</button>}</Field>
    </div>
  );
}
```

Delete `AbilityEditor.tsx`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w packages/app`
Expected: no errors inside `components/library/*`; remaining errors only in files of Tasks 10–12 (they still import `AbilityEditor`).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/components/library
git commit -m "Kind-aware RecordEditor with ActivationEditor and BlocksEditor; condition presets replace binding; v3 duration picker"
```

---

### Task 10: Library screen tabs

**Files:**
- Modify: `packages/app/src/screens/LibraryScreen.tsx`

**Interfaces:**
- Produces: tabs `features | items | spells | statuses | tags | monsters`; `RecordsTab({ kind })` component; per-kind filter chips.

- [ ] **Step 1: Rewrite the top of the screen and the `Abilities` component**

```tsx
import { RecordEditor, freshRecord } from '../components/library/RecordEditor';
import { type Ability, type RecordKind, activationsOf } from '@hl/engine';

type Tab = RecordKind | 'tags' | 'monsters';
const TABS: { id: Tab; label: string }[] = [{ id: 'feature', label: 'Features' }, { id: 'item', label: 'Items' }, { id: 'spell', label: 'Spells' }, { id: 'status', label: 'Statuses' }, { id: 'tags', label: 'Tags' }, { id: 'monsters', label: 'Monsters' }];

export function LibraryScreen() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('hl.libraryTab') as Tab) || 'feature'; } catch { return 'feature'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('hl.libraryTab', t); } catch { /* ignore */ } };
  return (
    <div className="p-4">
      <h1 className="mb-3 text-2xl font-bold">Library</h1>
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-zinc-900 p-1">
        {TABS.map((t) => <button key={t.id} type="button" onClick={() => pick(t.id)} className={cx('flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm', tab === t.id ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>{t.label}</button>)}
      </div>
      {tab === 'tags' ? <Tags /> : tab === 'monsters' ? <Monsters /> : <RecordsTab key={tab} kind={tab} />}
    </div>
  );
}

const FILTERS: Record<RecordKind, { id: string; label: string; test: (a: Ability) => boolean }[]> = {
  feature: [
    { id: 'feat', label: 'feats', test: (a) => a.kind === 'feature' && a.acquired.kind === 'feat' },
    { id: 'class', label: 'class features', test: (a) => a.kind === 'feature' && a.acquired.kind === 'class' },
    { id: 'race', label: 'racial', test: (a) => a.kind === 'feature' && a.acquired.kind === 'race' },
    { id: 'dm', label: 'DM / memories', test: (a) => a.kind === 'feature' && a.acquired.kind === 'dm' },
  ],
  item: ['weapon', 'armor', 'shield', 'wondrous', 'potion', 'wand', 'trophy', 'material', 'gear'].map((c) => ({ id: c, label: c, test: (a: Ability) => a.kind === 'item' && a.item.category === c })),
  spell: [0, 1, 2, 3, 4].map((l) => ({ id: String(l), label: `level ${l}`, test: (a: Ability) => a.kind === 'spell' && a.level === l })),
  status: [{ id: 'buff', label: 'buffs', test: (a) => a.kind === 'status' && !a.harmful }, { id: 'harmful', label: 'conditions', test: (a) => a.kind === 'status' && a.harmful }],
};

function subtitle(a: Ability, classes: Record<string, { name: string }>): string {
  const acts = activationsOf(a);
  const parts: string[] = [];
  if (a.kind === 'feature') parts.push(a.acquired.kind === 'class' ? `${classes[a.acquired.classId ?? '']?.name ?? 'class'}${a.acquired.level ? ` ${a.acquired.level}` : ''}` : { feat: 'feat', race: 'racial', dm: 'DM' }[a.acquired.kind]);
  if (a.kind === 'item') parts.push(a.item.category);
  if (a.kind === 'spell') parts.push(a.level !== undefined ? `level ${a.level}` : 'spell');
  if (a.kind === 'status') parts.push(a.harmful ? 'condition' : 'buff');
  if (a.effects.length) parts.push(`${a.effects.length} effect${a.effects.length === 1 ? '' : 's'}`);
  if (acts.length) parts.push(`${acts.length} activation${acts.length === 1 ? '' : 's'}`);
  if (a.todo) parts.push('⚑ ' + a.todo);
  return parts.join(' · ');
}

function RecordsTab({ kind }: { kind: RecordKind }) {
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const character = useStore((s) => s.character);
  const setCharacter = useStore((s) => s.setCharacter);
  const showToast = useStore((s) => s.showToast);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string | undefined>();
  const [editing, setEditing] = useState<Ability | undefined>();
  const filters = FILTERS[kind];
  const active = filters.find((f) => f.id === filter);
  const list = Object.values(library.abilities).filter((a) => a.kind === kind && (!q || a.name.toLowerCase().includes(q.toLowerCase())) && (!active || active.test(a))).sort((a, b) => a.name.localeCompare(b.name));
  const onChar = (id: string) => character?.abilities.some((x) => x.abilityId === id);
  const save = (parsed: Ability) => {
    const rest = { ...library.abilities };
    if (editing && parsed.id !== editing.id) delete rest[editing.id];
    setLibrary({ ...library, abilities: { ...rest, [parsed.id]: parsed } });
    setEditing(undefined); showToast('Saved');
  };
  const remove = () => {
    if (!editing || !confirm(`Delete ${editing.name}?`)) return;
    const rest = { ...library.abilities }; delete rest[editing.id];
    setLibrary({ ...library, abilities: rest });
    if (character) setCharacter({ ...character, abilities: character.abilities.filter((x) => x.abilityId !== editing.id) });
    setEditing(undefined);
  };
  const toggleOnChar = (id: string) => {
    if (!character) return;
    setCharacter(onChar(id) ? { ...character, abilities: character.abilities.filter((x) => x.abilityId !== id) } : { ...character, abilities: [...character.abilities, { abilityId: id, enabled: true, paramValues: {} }] });
  };
  const NEW_LABEL = { feature: '+ New feature', item: '+ New item', spell: '+ New spell', status: '+ New status' }[kind];
  return (
    <div>
      <div className="mb-2 flex gap-2"><input className={inputCls} placeholder={`Search ${kind}s…`} value={q} onChange={(e) => setQ(e.target.value)} /><Button onClick={() => setEditing(freshRecord(kind))}>{NEW_LABEL}</Button></div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{filters.map((f) => <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(filter === f.id ? undefined : f.id)}>{f.label}</Chip>)}</div>
      <div className="space-y-1">
        {list.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(a)}>
              <div className="truncate">{a.name}</div>
              <div className="truncate text-xs text-zinc-500">{subtitle(a, library.classTables)}</div>
            </button>
            {character && kind === 'feature' && <button type="button" onClick={() => toggleOnChar(a.id)} className={cx('rounded-full border px-2 py-0.5 text-xs', onChar(a.id) ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-500')}>{onChar(a.id) ? 'on sheet' : 'add'}</button>}
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-zinc-500">Nothing here yet.</p>}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.name || NEW_LABEL.slice(2)} tall>
        {editing && <RecordEditor key={editing.id} initial={editing} onSave={save} onCancel={() => setEditing(undefined)} onDelete={library.abilities[editing.id] ? remove : undefined} />}
      </Sheet>
    </div>
  );
}
```

Remove the old `SOURCES` constant and `Abilities` component. `Tags` and `Monsters` unchanged. Items get added to characters through Inventory, so the "add" chip only shows on Features.

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck -w packages/app` — errors only in Task 11/12 files.

```bash
git add packages/app/src/screens/LibraryScreen.tsx
git commit -m "Library tabs per record kind with kind-specific filters; new records take the tab's kind"
```

---

### Task 11: Inventory, character sheet, ability sheet, level ledger

**Files:**
- Modify: `packages/app/src/screens/InventoryScreen.tsx`, `packages/app/src/screens/CharacterScreen.tsx`, `packages/app/src/components/character/AbilitySheet.tsx`, `packages/app/src/components/character/LevelLedger.tsx`

- [ ] **Step 1: InventoryScreen**

- Import `RecordEditor, freshRecord` instead of `AbilityEditor`; `fresh()` becomes `freshRecord('item')`; the `onCreate` call becomes `setCreating(freshRecord('item', { category: pickFor === 'any' ? 'gear' : 'wondrous', ...(pickFor !== 'any' ? { slot: pickFor } : {}) }))`.
- `entryCategory`: `itemAbility(ctx, e)` → `const a = itemAbility(ctx, e); return a?.kind === 'item' ? a.item.category : …`.
- Every `a?.item?.x` → guard with `a?.kind === 'item'`; `a.origin === 'item'` in `PickSheet` → `a.kind === 'item'`.
- `<AbilityEditor …>` → `<RecordEditor …>` (two places).
- "Rules & charges" button condition: `a && (a.effects.length > 0 || activationsOf(a).length > 0)`.

- [ ] **Step 2: CharacterScreen**

Replace `GROUPS` with:

```tsx
const GROUPS: { id: string; title: string; test: (a: Ability) => boolean }[] = [
  { id: 'feats', title: 'Feats', test: (a) => a.kind === 'feature' && a.acquired.kind === 'feat' },
  { id: 'class', title: 'Class abilities', test: (a) => a.kind === 'feature' && (a.acquired.kind === 'class' || a.acquired.kind === 'race') },
  { id: 'memories', title: 'Memories & DM grants', test: (a) => a.kind === 'feature' && a.acquired.kind === 'dm' },
  { id: 'spells', title: 'Spells', test: (a) => a.kind === 'spell' },
];
```

`abilitiesOf(sources)` → `abilitiesOf(test)` filtering with `test(x.a)`. The subtitle: `a.sourceRef ?? a.kind` and charges from `actions.filter((x) => x.abilityId === a.id && x.charges).map((x) => ` · ${x.charges!.label} ${x.charges!.remaining}/${x.charges!.max}`)` plus `listPools(ctx).filter((p) => p.abilityId === a.id)` similarly (import `listPools`). Params guard: `a.kind === 'feature' && a.params && …`.

- [ ] **Step 3: AbilitySheet**

- Header: `ability.kind` instead of `ability.origin`; `ability.origin === 'item'` → `ability.kind === 'item'`.
- Params block: guard `ability.kind === 'feature' && Object.entries(ability.params ?? {})`.
- Replace the `ability.resources?.map` block with one over `[...activationsOf(ability).filter((x) => x.charges).map((x) => ({ id: x.id, label: x.charges!.label ?? x.name ?? ability.name, max: x.charges!.max, resetOn: x.charges!.resetOn })), ...poolsOf(ability).map((p) => ({ id: p.id, label: p.label ?? ability.name, max: p.max, resetOn: p.resetOn }))]`, same −/+ controls keyed by `r.id`, only for `resetOn` `day`/`never`.
- Footer text: `${ability.effects.length} passive block(s), ${activationsOf(ability).length} activation(s)`.

- [ ] **Step 4: LevelLedger**

`feats` list: `Object.values(ctx.library.abilities).filter((a): a is Feature => a.kind === 'feature')`. General feats chips: `feats.filter((f) => f.acquired.kind === 'feat')`. Class features chips: `feats.filter((f) => f.acquired.kind === 'class' || autoFeatures.includes(f.id) || r.featuresGained.includes(f.id))`. Import `type Feature` from `@hl/engine`.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w packages/app` — errors only in Task 12 files.

```bash
git add packages/app/src/screens/InventoryScreen.tsx packages/app/src/screens/CharacterScreen.tsx packages/app/src/components/character
git commit -m "Inventory and character screens read record kinds; charges shown from activations and pools"
```

---

### Task 12: Battle UI on activations and statuses; selector picker

**Files:**
- Modify: `packages/app/src/components/battle/AttackPanel.tsx`, `packages/app/src/components/battle/BuffsDrawer.tsx`, `packages/app/src/components/battle/SituationalSheet.tsx`, `packages/app/src/screens/BattleScreen.tsx`, `packages/app/src/components/library/SelectorPicker.tsx`

- [ ] **Step 1: AttackPanel**

- `use` becomes `use(a: ActionInfo)`: `useAbility(ctx, { abilityId: a.abilityId, activationId: a.activationId, ...(target ? { targetId: target.id } : {}) })`, toast `Used ${a.name}`.
- `originLabel(a)`: `a.kind === 'feature' && a.acquired?.kind === 'class' ? `${ctx.library.classTables[a.acquired.classId ?? '']?.name ?? 'class feature'}${a.acquired.level ? ` ${a.acquired.level}` : ''}` : a.name !== a.recordName ? a.recordName : a.kind === 'feature' ? { feat: 'feat', race: 'racial', dm: 'DM' }[a.acquired?.kind ?? 'feat'] ?? 'feature' : a.kind`.
- Toggle row: manual toggles as before (no `t.declare`), plus one chip per `actions.filter((a) => a.declare)`: `<Chip key={a.activationId} tone="red" active={a.active} onClick={() => !a.active && a.usable && use(a)}>⚡ {a.name}{a.charges ? ` ${a.charges.remaining}/${a.charges.max}` : ''}</Chip>`.
- Actions list: `key={a.activationId}`, `data-ability={a.abilityId}`, `data-activation={a.activationId}`; charges line: `{a.charges && <span className="mr-2">{a.charges.label}: <b className={…}>{a.charges.remaining}/{a.charges.max}</b> /{a.charges.resetOn}</span>}`; action text: `{typeof a.action === 'string' ? a.action : 'long'} action`; `{!a.charges && !a.costText.length && <span className="mr-2">at will</span>}`; `{a.costText.map((t) => <span key={t} className="mr-2">costs {t}</span>)}`; `{a.declare && <span className="mr-2">declare before roll</span>}`. Button: `<Button size="sm" variant={a.active ? 'ghost' : 'default'} disabled={!a.usable || a.active} onClick={() => use(a)}>{a.active ? 'Active' : 'Use'}</Button>` (always shown; every row is an activation now).
- Import `type ActionInfo` from `@hl/engine`.

- [ ] **Step 2: BuffsDrawer**

- `candidates`: `Object.values(lib.abilities).filter((a): a is Status => a.kind === 'status' && …)`; chip tone `a.harmful ? 'red' : 'green'`.
- `add(id)`: `const rounds = durationRounds(a.duration, exprVars(ctx))` (import both from `@hl/engine`) and push `{ instanceId, abilityId, owner: 'self', suppressed: false, ...(a.duration ? { expires: a.duration } : {}), ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }`.
- `nameOf(id)`: `lib.abilities[id]?.name ?? battle.statuses.find((s) => s.id === id)?.name ?? id`.
- Active list rows for buffs whose `abilityId` is in `battle.statuses`: add two ghost buttons, `Edit` (opens `<RecordEditor initial={status} onSave={(s) => setBattle({ ...battle, statuses: battle.statuses.map((x) => (x.id === s.id ? s as Status : x)) })} …/>` inside a `Sheet`) and `Keep in library` (`setLibrary({ ...library, abilities: { ...library.abilities, [s.id]: s } })`, remove it from `battle.statuses`, toast "Saved to Library › Statuses"). Import `useStore`'s `setLibrary`, `library`, `showToast`.

- [ ] **Step 3: SituationalSheet**

- `addSituational` → `addStatus`. Duration chips: `'encounter' | 'rounds' | 'untilMyNextTurn'` with labels "Whole battle", "N rounds", "This round"; map `untilMyNextTurn` directly.

- [ ] **Step 4: BattleScreen**

- `resources` chips: `useMemo(() => ctx ? [...availableActions(ctx).flatMap((a) => (a.charges ? [a.charges] : [])), ...listPools(ctx)] : [], [ctx])` (dedupe by `id` with a `Map`). Import `listPools`.
- Active buff label fallback: `b.label ?? ctx.library.abilities[b.abilityId]?.name ?? battle.statuses.find((s) => s.id === b.abilityId)?.name ?? b.abilityId`.

- [ ] **Step 5: SelectorPicker**

- `case 'abilities'`: records (`group: a.kind`) plus one entry per activation: `{ id: act.id, label: `${a.name} › ${act.name ?? a.name}`, group: 'activation' }`.
- `case 'items'`: filter `a.kind === 'item'`, `group: a.item.category`.
- `case 'itemTags'`: `a.kind === 'item' ? a.item.tags : []`.
- `case 'params'`: `a.kind === 'feature' ? Object.keys(a.params ?? {}) : []`.
- `battle.toggle` label: `'manual switch'`.
- `ConditionEditor` `params` list: same feature guard.

- [ ] **Step 6: Typecheck, build, run**

Run: `npm run typecheck && npm run build`
Expected: clean. Then `npm run dev`, open Library: six tabs, new Feature editor shows acquired/params/activations, new Item editor shows category/slot, Spell shows level/casting/duration, Status shows buff/harmful. Battle: Hand of Glory rows say "Daylight · Hand of Glory · Daylight: 1/1 /day"; Boots row "Haste rounds: 8/10"; Monster Blow appears as a red ⚡ chip.

- [ ] **Step 7: Commit**

```bash
git add packages/app
git commit -m "Battle actions per activation with declare chips and costs; statuses drawer with edit and keep-in-library; selector picker knows kinds"
```

---

### Task 13: E2E, docs, TODO

**Files:**
- Modify: `e2e/builder.spec.ts`, `e2e/battle-v2.spec.ts`, `docs/RULES-FORMAT.md`, `TODO.md`, `README.md` (one line)

- [ ] **Step 1: builder.spec.ts**

Navigate: after `Library`, the default tab is Features; `+ New feature` button (`getByRole('button', { name: '+ New feature' })`). Expected JSON becomes:

```ts
expect(json).toMatchObject({
  id: 'test-archer', name: 'Test Archer', kind: 'feature', acquired: { kind: 'feat' },
  effects: [{ trigger: 'always', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' }, op: '>=', value: 1 }] }, do: [{ verb: 'modify', to: 'attack', value: 4, type: 'untyped', mode: 'add' }] }],
  activations: [],
});
```

The `+ add condition` button is now inside `BlocksEditor`; a fresh feature has no block, so click `+ add effect block` first (`sheet.getByRole('button', { name: '+ add effect block' })`), then proceed as before.

Add a second test: create an Item via the Items tab, pick category `wondrous`, slot `Feet`, `+ add activation`, `+ limit uses` max `10`, `+ set duration`, save; JSON has `kind: 'item'`, `item.slot: 'feet'`, `activations[0].charges.max: 10`, `activations[0].duration: 'untilMyNextTurn'`.

- [ ] **Step 2: battle-v2.spec.ts**

- Hand of Glory: `page.locator('[data-activation="hog-daylight"]')` and `[data-activation="hog-see-invisibility"]`; text expectations unchanged (`Hand of Glory` subtext, `1/1`, `0/1`).
- Boots: `page.locator('[data-activation="boots-rounds"]')`; the rest unchanged.
- Add: Monster Blow chip: `await page.getByRole('button', { name: /⚡ Monster Blow/ }).click()` then `await expect(page.locator('[data-activation="monster-blow"]')).toContainText('ACTIVE')`; click `Hit` on attack #1; expect the chip not active and `0/1`.

- [ ] **Step 3: Run e2e**

Run: `npm run build && npm run e2e`
Expected: all specs pass (`battle`, `battle-v2`, `builder`, `edit`, `inventory`, `levelup`, `sheet`, `update`). Fix selectors that changed (e.g. `inventory.spec.ts` if it clicks `+ New item` and expects old editor labels).

- [ ] **Step 4: RULES-FORMAT.md**

Replace the "Envelope" section and the "Blocks" trigger list with the v3 shape from the spec: the record kinds table, the shared shape, the activation object, per-kind fields, durations, resets, triggers, and a "Converted from v2" paragraph listing the mappings (origin→kind/acquired, activation/cost/resources/grants→activations, binding→conditions, `rest`→`day`, `manual`→`never`, `endOfRound`→`untilMyNextTurn`, `instant`→omitted, `whileActive`/`concentration`→`untilRemoved`). Update the selector table row for `self.ability.<id>` (record or activation id) and `battle.toggle.<id>` (manual switch). Keep the conditions and effects sections.

- [ ] **Step 5: TODO.md and README**

TODO: add under "Rules builder" `- [x] Record kinds (Features / Items / Spells / Statuses) with activations; rules v3.` and `- [ ] Builder: friendlier presets …` stays. Under Battle: `- [x] Situational modifier: "save to library"` (Keep in library). README: in the packs bullet mention `docs/RULES-FORMAT.md` is v3.

- [ ] **Step 6: Final verification and commit**

Run: `npm test && npm run typecheck && npm run validate-packs && npm run build`
Expected: all green.

```bash
git add e2e docs TODO.md README.md
git commit -m "E2E and docs for rules v3: kind tabs in the builder, activation rows and declare chip in battle"
```

---

## Self-review notes

- Spec coverage: kinds and tabs (Tasks 1, 10); activation object with charges/cost/duration/spell/onUse/whileActive (1, 4, 5, 9); dropped vocabulary rejected (1) and converted (2); binding presets (9); declare as thisAttack activation with chip (4, 5, 12, 13); pools (1, 4, 5, 9); statuses on battle with edit and keep-in-library (5, 12); migration of packs, library, battle (2, 7, 8); validator (7); Vaelor's Manual (7); level ledger by acquired (11); RULES-FORMAT (13).
- Names used across tasks: `activationsOf`, `poolsOf`, `findResourceDef`, `Source.blocks`, `Source.label`, `ActionInfo.{activationId,charges,costText,declare,acquired,recordName}`, `listPools`, `addStatus`, `useAbility({abilityId, activationId})`, `convertToV3`, `convertPack`, `convertBattle`, `freshRecord`, `RecordEditor`, `ActivationEditor`, `BlocksEditor`, `Preset` — consistent.
- Known limitation to state in the commit for Task 5: undoing an attack does not restore a `thisAttack` buff that the attack expired; the Use event that spent the charge is separate and remains undoable.
