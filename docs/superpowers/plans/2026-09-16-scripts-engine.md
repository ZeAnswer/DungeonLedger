# Scripts engine (rules v4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace block-based effects with plain-JavaScript scripts in the engine: a helper API over paths, an `always` compute pass and event scripts with patches, a loop guard, globals, a function library, and a one-time converter from v3 blocks, with the engine suite and packs green.

**Architecture:** New `packages/engine/src/scripts/` holds units/enums, path mapping, the API façade with traced predicates, compilation with acorn instrumentation, the compute sink and pass, event patches, and the v3→v4 printer. `schema.ts` swaps `effects`/`onUse`/`whileActive` for `scripts`, adds `FunctionDef`, globals and widened vars. `resolve.ts`, `battle.ts`, `equipment.ts` read the sink and apply patches instead of walking blocks. A golden fixture captured from the v3 engine before any change proves behaviour is preserved. The app is a separate plan.

**Tech Stack:** TypeScript, zod 3, vitest, acorn 8 (promoted to an engine dependency), tsx tools.

**Spec:** `docs/superpowers/specs/2026-09-16-scripts-design.md` (read it first; its "Rules that keep always scripts safe" and "Enums and units" sections are binding).

## Global Constraints

- `always` scripts never change state: the api in that phase is frozen; assignment throws and is reported as a script error naming the helper to use instead.
- Events are a list on the script (`events: [...]`), `always` cannot be combined with event entries.
- Time is seconds: `SECOND=1`, `ROUND=6`, `MINUTE=60`, `HOUR=3600`, `DAY=86400`; durations are numbers or one of `thisAttack | untilMyNextTurn | encounter | untilRemoved`.
- Enums are numbers: `SIZE.FINE=0 … COLOSSAL=8` (order of `SIZE_ORDER`), `HURT.UNHURT=0 … NEAR_DEATH=3`.
- Names: `player` (alias `self`), `target`, `attack.isRanged/isMelee/isFirstThisRound`, `battle`, `vars`, `flags`, `params`, `active`, `event`, `args`, `fn`.
- Loop guard budgets: compute 4 ms, event 16 ms, 2,000,000 ops; `// @noguard` anywhere in a source disables instrumentation for that source.
- Existing stored data and packs must load through converters; the converter is idempotent.
- Commands: from `packages/engine`: `npx vitest run`, `npx tsc --noEmit`; from the repo root: `npm run typecheck`, `npm run validate-packs`, `npx tsx tools/gen-core-pack.ts && npx tsx tools/gen-memento-pack.ts`. Commit after every task; end commit messages with the attribution lines from the session's system reminder.

---

## File structure

- `packages/engine/src/scripts/units.ts` — time units, sentinels, `SIZE`, `HURT`, `BONUS`, `STAT` enums, `toRounds(seconds)`.
- `packages/engine/src/scripts/paths.ts` — `pathToSelector`, `describePath`, `PATHS` catalog (for completion/long-press).
- `packages/engine/src/scripts/sink.ts` — `Sink` type and `newSink()`.
- `packages/engine/src/scripts/api.ts` — `makeApi(ctx, run)`: façade objects, helpers, traced predicates, phase gating.
- `packages/engine/src/scripts/budget.ts` — `Budget`, `ScriptTimeout`.
- `packages/engine/src/scripts/instrument.ts` — acorn-based `instrument(source)`.
- `packages/engine/src/scripts/compile.ts` — `compile(source, paramNames?)`, cache, preamble.
- `packages/engine/src/scripts/diagnostics.ts` — error registry, quarantine, script mode (safe mode).
- `packages/engine/src/scripts/compute.ts` — `computePass(ctx)`, cache, re-entrancy.
- `packages/engine/src/scripts/events.ts` — `Patch`, `runEventScripts`, `applyPatches`, emit cascade.
- `packages/engine/src/scripts/print.ts` — v3 blocks → script source.
- `packages/engine/src/scripts/index.ts` — re-exports.
- Modified: `schema.ts`, `migrate.ts` (v4 hop), `resolve.ts`, `battle.ts`, `equipment.ts`, `context.ts` (Library gains `functions`, `globals`), `pack.ts`, `index.ts`, `describe.ts` (condition half removed), `selectors.ts` (`self.mod` uses effective score), `history.ts` (unchanged), `rest.ts` (durations in seconds).
- Deleted: `conditions.ts`.
- Tools: `tools/pack-validate.ts` (scripts compile, `fn` refs, `params` refs), `tools/golden-capture.ts` (Task 0), `tools/gen-*.ts` (bump versions).
- Tests: `packages/engine/test/scripts/*.test.ts`, `test/golden.test.ts`, existing tests updated.

---

### Task 0: Golden fixture from the v3 engine

**Files:**
- Create: `tools/golden-capture.ts`, `packages/engine/test/fixtures/golden-v3.json`

**Interfaces:**
- Produces: `golden-v3.json` = `{ scenarios: { name, targetTags?, distanceFeet?, missesFirst?: number, results: { profileId, modeId, attacks: { attackBonus, damageFlat, damageDice: string[], critRange, critMult }[] }[], stats: Record<StatId, number>, actions: { activationId, usable, eligible }[] }[] }` for the Memento character.

- [ ] **Step 1: Write the capture script**

```ts
// tools/golden-capture.ts — run BEFORE any engine change; output is the behavioural contract for v4.
import { readFileSync, writeFileSync } from 'node:fs';
import { PackSchema, emptyLibrary, mergePack, resolveAttack, resolveStat, attackProfiles, listAttackModes, availableActions, logAttack, newBattle, addCombatant, setDistance, type EvalContext } from '../packages/engine/src';

let lib = emptyLibrary();
for (const f of ['core-3.5e', 'memento']) lib = mergePack(lib, PackSchema.parse(JSON.parse(readFileSync(new URL(`../packs/${f}.json`, import.meta.url), 'utf8')))).library;
const ch = (lib as { characters?: Record<string, EvalContext['character']> }).characters!['memento']!;
const STATS = ['ac', 'ac.touch', 'ac.flatFooted', 'save.fort', 'save.ref', 'save.will', 'init', 'speed', 'hp.max', 'ability.str', 'ability.con', 'skill.spot', 'skill.survival', 'skill.swim', 'skill.knowledge-monsters'];

function scenario(name: string, opts: { tags?: string[]; distance?: number; misses?: number }) {
  let ctx: EvalContext = { character: ch, library: lib };
  if (opts.tags) {
    let battle = addCombatant(newBattle('g'), { name: 'T', tags: opts.tags, size: 'large' });
    if (opts.distance !== undefined) battle = setDistance(battle, battle.combatants[0]!.id, opts.distance);
    ctx = { ...ctx, battle, target: battle.combatants[0] };
    for (let i = 0; i < (opts.misses ?? 0); i++) { const r = logAttack(ctx, { targetId: ctx.target!.id, profileId: 'weapon:strong-arm-composite-longbow-1', modeId: 'full', attackIndex: i + 1, result: 'miss' }); ctx = { ...ctx, battle: r.battle, character: r.character, target: r.battle.combatants[0] }; }
  }
  const results = attackProfiles(ctx).flatMap((p) => listAttackModes(ctx, p.id).map((m) => { const r = resolveAttack(ctx, { profileId: p.id, modeId: m.modeId }); return { profileId: p.id, modeId: m.modeId, attacks: r.attacks.map((a) => ({ attackBonus: a.attackBonus, damageFlat: a.damage.flat, damageDice: a.damage.dice.map((d) => d.dice), critRange: a.critRange, critMult: a.critMult })) }; }));
  const stats = Object.fromEntries(STATS.map((s) => [s, resolveStat(ctx, s).total]));
  const actions = availableActions(ctx).map((a) => ({ activationId: a.activationId, usable: a.usable, eligible: a.eligible }));
  return { name, ...opts, results, stats, actions };
}

const out = { scenarios: [
  scenario('no target', {}),
  scenario('aberration at 20 ft', { tags: ['aberration'], distance: 20 }),
  scenario('aquatic aberration at 60 ft', { tags: ['aberration', 'aquatic'], distance: 60 }),
  scenario('monstrous humanoid after two misses', { tags: ['monstrous-humanoid'], distance: 20, misses: 2 }),
] };
writeFileSync(new URL('../packages/engine/test/fixtures/golden-v3.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`golden: ${out.scenarios.length} scenarios`);
```

- [ ] **Step 2: Run it and commit the fixture**

Run: `npx tsx tools/golden-capture.ts` — Expected: `golden: 4 scenarios`; the JSON shows the bow at +12 base (no target) and the Woodland Archer +8 after two misses in scenario 4.

```bash
git add tools/golden-capture.ts packages/engine/test/fixtures/golden-v3.json
git commit -m "Golden fixture: v3 engine results for Memento across four scenarios"
```

---

### Task 1: Units, enums, paths

**Files:**
- Create: `packages/engine/src/scripts/units.ts`, `packages/engine/src/scripts/paths.ts`
- Test: `packages/engine/test/scripts/units.test.ts`, `packages/engine/test/scripts/paths.test.ts`

**Interfaces:**
- Produces: `SECOND, ROUND, MINUTE, HOUR, DAY`, `THIS_ATTACK='thisAttack'`, `UNTIL_MY_NEXT_TURN='untilMyNextTurn'`, `ENCOUNTER='encounter'`, `UNTIL_REMOVED='untilRemoved'`, `SIZE`, `HURT`, `BONUS`, `STAT`, `toRounds(seconds: number): number`, `pathToSelector(path: string): string | undefined`, `describePath(path: string): string`, `PATHS: { path: string; kind: 'number'|'boolean'|'string'|'list'; doc: string }[]`.

- [ ] **Step 1: Failing tests**

```ts
// packages/engine/test/scripts/units.test.ts
import { ROUND, MINUTE, HOUR, DAY, SIZE, HURT, toRounds, THIS_ATTACK } from '../../src/scripts/units';
test('time units in seconds and rounds', () => {
  expect([ROUND, MINUTE, HOUR, DAY]).toEqual([6, 60, 3600, 86400]);
  expect(toRounds(3 * ROUND)).toBe(3); expect(toRounds(50 * MINUTE)).toBe(500); expect(toRounds(1)).toBe(1); expect(toRounds(0)).toBe(0);
  expect(THIS_ATTACK).toBe('thisAttack');
});
test('size and hurt enums are ordinal numbers', () => {
  expect(SIZE.LARGE).toBe(5); expect(SIZE.MEDIUM < SIZE.LARGE).toBe(true); expect(HURT.BLOODIED).toBe(2); expect(HURT.NEAR_DEATH).toBe(3);
});
```

```ts
// packages/engine/test/scripts/paths.test.ts
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
```

- [ ] **Step 2: Run to fail** — `cd packages/engine && npx vitest run test/scripts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// packages/engine/src/scripts/units.ts
import { SIZE_ORDER, HURT_ORDER } from '../context';
import { BonusTypeSchema } from '../schema';

export const SECOND = 1, ROUND = 6 * SECOND, MINUTE = 10 * ROUND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const THIS_ATTACK = 'thisAttack' as const, UNTIL_MY_NEXT_TURN = 'untilMyNextTurn' as const, ENCOUNTER = 'encounter' as const, UNTIL_REMOVED = 'untilRemoved' as const;
/** Rounds a seconds-duration occupies in the battle round model (minimum 1 for any positive duration). */
export function toRounds(seconds: number): number { return seconds <= 0 ? 0 : Math.max(1, Math.ceil(seconds / ROUND)); }

const enumOf = (names: readonly string[]) => Object.freeze(Object.fromEntries(names.map((n, i) => [n.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(), i])));
export const SIZE = enumOf(SIZE_ORDER) as Readonly<Record<'FINE'|'DIMINUTIVE'|'TINY'|'SMALL'|'MEDIUM'|'LARGE'|'HUGE'|'GARGANTUAN'|'COLOSSAL', number>>;
export const HURT = enumOf(HURT_ORDER) as Readonly<Record<'UNHURT'|'SCRATCHED'|'BLOODIED'|'NEAR_DEATH', number>>;
export const BONUS = Object.freeze(Object.fromEntries(BonusTypeSchema.options.map((t) => [t.toUpperCase(), t]))) as Readonly<Record<string, string>>;
export const STAT = Object.freeze({ ATTACK: 'attack', DAMAGE: 'damage', AC: 'ac', AC_TOUCH: 'ac.touch', AC_FLAT_FOOTED: 'ac.flatFooted', FORT: 'save.fort', REF: 'save.ref', WILL: 'save.will', INIT: 'init', SPEED: 'speed', HP_MAX: 'hp.max', CRIT_RANGE: 'critRange', CRIT_MULT: 'critMult', STR: 'ability.str', DEX: 'ability.dex', CON: 'ability.con', INT: 'ability.int', WIS: 'ability.wis', CHA: 'ability.cha' });
```

```ts
// packages/engine/src/scripts/paths.ts
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
```

`context.ts` must export `SIZE_ORDER`/`HURT_ORDER` (it does). `describePath` accepts a names map so the app can pass `library.skills` labels.

- [ ] **Step 4: Run** — `npx vitest run test/scripts` → PASS.

- [ ] **Step 5: Commit** — `git add packages/engine/src/scripts packages/engine/test/scripts && git commit -m "Scripts: time units, SIZE/HURT/BONUS/STAT enums, path ↔ selector table"`

---

### Task 2: Schema v4 (scripts, functions, globals, durations in seconds)

**Files:**
- Modify: `packages/engine/src/schema.ts`, `packages/engine/src/context.ts` (Library type), `packages/engine/src/migrate.ts` (stub `convertToV4` identity for now)
- Test: `packages/engine/test/schema.test.ts` (replace the effects tests)

**Interfaces:**
- Produces: `ScriptEventSchema` (regex `^(always|hit|miss|crit|damaged|roundStart|roundEnd|use|equip|unequip|custom:[A-Za-z0-9_-]+)$`), `ArgValueSchema` (`{k:'lit',v}|{k:'ref',v:string}|{k:'expr',v:string}`), `ScriptSchema` (`id, label?, events (default ['always'], min 1, 'always' exclusive), source (default ''), call?: {fn, args}, enabled (true), priority (0)`), `ParamTypeSchema`, `FunctionDefSchema` (`id, name, description?, params: {name, type, label?, default?, required}[], source`), `VarValueSchema`, `DurationSchema = number ≥ 0 | 'thisAttack'|'untilMyNextTurn'|'encounter'|'untilRemoved'`; records use `scripts: Script[]` instead of `effects`; `ActivationSchema.scripts` instead of `onUse`/`whileActive`; `Character.vars: Record<string, VarValue>`; `PackSchema` gains `functions: FunctionDef[]`, `globals: Record<string, VarValue>`; `LogEvent.undo.vars: { scope: 'character'|'global', name, before? }[]`; `Library` type gains `functions: Record<string, FunctionDef>`, `globals: Record<string, VarValue>`. Removed: `ConditionSchema`, `EffectSchema`, `EffectBlockSchema`, `TriggerSchema`, `TableValueSchema`, `ValueSchema`, `SelectorSchema`, `CompareOpSchema`. Kept: `HistoryFilterSchema` (type only), `StatIdSchema`, `BonusTypeSchema`, `ExprSchema` (pool max), everything about activations/charges/pools/items.

- [ ] **Step 1: Failing tests** (replace `packages/engine/test/schema.test.ts`)

```ts
import { AbilitySchema, PackSchema, ScriptSchema, FunctionDefSchema, DurationSchema, BattleSchema, activationsOf } from '../src/schema';

test('a feature carries scripts; always cannot mix with events; call form validates', () => {
  const a = AbilitySchema.parse({ id: 'pbs', name: 'Point Blank Shot', kind: 'feature', scripts: [{ id: 's1', source: "if (attack.isRanged && target.within(30)) bonus(['attack','damage'], 1)" }] });
  if (a.kind !== 'feature') throw new Error();
  expect(a.scripts[0]).toMatchObject({ events: ['always'], enabled: true, priority: 0 });
  expect(ScriptSchema.safeParse({ id: 'x', events: ['always', 'hit'], source: '' }).success).toBe(false);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['hit', 'crit'], source: 'target.mark("flanked", UNTIL_MY_NEXT_TURN)' }).success).toBe(true);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['custom:rage-ended'], source: '' }).success).toBe(true);
  expect(ScriptSchema.safeParse({ id: 'x', events: ['bogus'], source: '' }).success).toBe(false);
  expect(ScriptSchema.parse({ id: 'c', call: { fn: 'favoredEnemy', args: { types: { k: 'ref', v: 'params.types' }, amount: { k: 'lit', v: 4 } } } }).call?.fn).toBe('favoredEnemy');
});

test('activations carry scripts instead of onUse/whileActive; old keys are rejected', () => {
  const boots = AbilitySchema.parse({ id: 'boots', name: 'Boots', kind: 'item', item: { category: 'wondrous', slot: 'feet' }, activations: [{ id: 'boots-rounds', charges: { max: 10 }, duration: 6, scripts: [{ id: 'h', source: 'extraAttack(1); bonus(["attack","ac","save.ref"], 1, "dodge"); bonus("speed", 30)' }] }] });
  expect(activationsOf(boots)[0]!.scripts).toHaveLength(1);
  expect(AbilitySchema.safeParse({ id: 'b', name: 'B', kind: 'feature', effects: [] }).success).toBe(false);
  expect(AbilitySchema.safeParse({ id: 'b', name: 'B', kind: 'item', item: { category: 'gear' }, activations: [{ id: 'a', onUse: [] }] }).success).toBe(false);
});

test('durations are seconds or a sentinel', () => {
  expect(DurationSchema.parse(50 * 60)).toBe(3000);
  expect(DurationSchema.parse('untilMyNextTurn')).toBe('untilMyNextTurn');
  expect(DurationSchema.safeParse({ rounds: 3 }).success).toBe(false);
  expect(DurationSchema.safeParse('endOfRound').success).toBe(false);
});

test('function definitions, globals and widened vars', () => {
  const f = FunctionDefSchema.parse({ id: 'trophy', name: 'Trophy bonus', params: [{ name: 'stat', type: 'stat' }, { name: 'base', type: 'number', default: 2 }], source: 'bonus(stat, base * vars.trophyMultiplier, "enhancement")' });
  expect(f.params[1]).toMatchObject({ required: false, default: 2 });
  const p = PackSchema.parse({ id: 'p', name: 'P', version: 1, functions: [f], globals: { season: 'winter', dm: true, roundsPerMinute: 10 } });
  expect(p.globals.season).toBe('winter');
  expect(PackSchema.parse({ id: 'q', name: 'Q', version: 1, characters: [{ id: 'c', name: 'C', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, hp: { max: 1, current: 1 }, vars: { flag: true, note: 'x' } }] }).characters[0]!.vars).toEqual({ flag: true, note: 'x' });
});

test('battle undo records var changes', () => {
  const b = BattleSchema.parse({ id: 'b', startedAt: 'now', log: [{ id: 'e', round: 1, seq: 1, kind: 'use', undo: { vars: [{ scope: 'global', name: 'x', before: 1 }] } }] });
  expect(b.log[0]!.undo!.vars[0]).toEqual({ scope: 'global', name: 'x', before: 1 });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/schema.test.ts` → FAIL.

- [ ] **Step 3: Implement in `schema.ts`**

Replace `DurationSchema`:
```ts
export const DurationSentinelSchema = z.enum(['thisAttack', 'untilMyNextTurn', 'encounter', 'untilRemoved']);
/** Seconds (ROUND = 6) or a sentinel. */
export const DurationSchema = z.union([z.number().nonnegative(), DurationSentinelSchema]);
```

Delete `SelectorSchema`, `CompareOpSchema`, `Condition` type + `ConditionSchema`, `ALWAYS`, `TableValueSchema`, `ValueSchema`, `EffectSchema`, `Effect`, `TriggerSchema`, `Trigger`, `EffectBlockSchema`, `EffectBlock`. Keep `HistoryFilterSchema`/`HistoryFilter` (used by `history()`), but change `scope` enum to `['attack', 'round', 'lastRound', 'encounter', 'day']` with default `'round'` (rename of `thisAttackSequence`→`attack`, `thisRound`→`round`; `history.ts` updated in Task 6).

Add after the primitives:
```ts
// ---------- scripts ----------
export const ScriptEventSchema = z.string().regex(/^(always|hit|miss|crit|damaged|roundStart|roundEnd|use|equip|unequip|custom:[A-Za-z0-9_-]+)$/, 'unknown event');
export type ScriptEvent = z.infer<typeof ScriptEventSchema>;
export const ArgValueSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('lit'), v: z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]) }),
  z.object({ k: z.literal('ref'), v: z.string().min(1) }),
  z.object({ k: z.literal('expr'), v: z.string().min(1) }),
]);
export type ArgValue = z.infer<typeof ArgValueSchema>;
export const ScriptSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  events: z.array(ScriptEventSchema).min(1).default(['always']),
  source: z.string().default(''),
  call: z.object({ fn: z.string().min(1), args: z.record(ArgValueSchema).default({}) }).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
}).refine((s) => !(s.events.includes('always') && s.events.length > 1), { message: "'always' cannot be combined with events" });
export type Script = z.infer<typeof ScriptSchema>;

export const ParamTypeSchema = z.enum(['number', 'string', 'bool', 'dice', 'path', 'ref', 'stat', 'bonusType', 'duration', 'tag', 'tags', 'recordId', 'event']);
export const FunctionDefSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string().optional(),
  params: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: ParamTypeSchema, label: z.string().optional(), default: z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]).optional(), required: z.boolean().default(false) })).default([]),
  source: z.string(),
});
export type FunctionDef = z.infer<typeof FunctionDefSchema>;
export const VarValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type VarValue = z.infer<typeof VarValueSchema>;
```

Records: in `recordBase` replace `effects` with `scripts: z.array(ScriptSchema).default([]),`. In `ActivationSchema` replace `onUse` and `whileActive` with `scripts: z.array(ScriptSchema).default([]),`. `Character.vars: z.record(VarValueSchema).default({})`. `PackInnerSchema` gains `functions: z.array(FunctionDefSchema).default([])`, `globals: z.record(VarValueSchema).default({})`. `LogEventSchema.undo` gains `vars: z.array(z.object({ scope: z.enum(['character', 'global']), name: z.string(), before: VarValueSchema.optional() })).default([])`. `PackSchema` preprocess now calls `convertPack` which (Task 5) chains v4; for this task add to `migrate.ts` a stub `export function convertToV4(a: unknown): unknown { return a; }` and leave `convertPack` as is.

`context.ts`: `Library` gains `functions: Record<string, FunctionDef>; globals: Record<string, VarValue>;` and `pack.ts` `emptyLibrary()` returns them empty (merge in Task 7).

- [ ] **Step 4: Run** — `npx vitest run test/schema.test.ts` → PASS. Other files fail to compile; expected until Task 6.

- [ ] **Step 5: Commit** — `git commit -am "Schema v4: scripts replace effect blocks; function library, globals, durations in seconds"`

---

### Task 3: API façade, sink, traced predicates

**Files:**
- Create: `packages/engine/src/scripts/sink.ts`, `packages/engine/src/scripts/api.ts`
- Test: `packages/engine/test/scripts/api.test.ts`

**Interfaces:**
- Produces:
  - `Sink = { bonuses: (BonusEntry & { stat: StatId })[]; sets: { stat, value, source }[]; multipliers: { stat, factor, source }[]; dice: DiceEntry[]; flags: Record<string, boolean>; notes: { text, source, sourceName }[]; modes: AttackMode[]; extraAttacks: { n, base: 'single'|'full'|'any', kind?, source }[]; naturals: { name, dice, count, attackBonus, source, sourceName }[]; slots: Partial<Record<SlotId, number>>; prompts: PromptRequest[]; skipped: NearMiss[]; errors: ScriptError[] }`, `newSink()`.
  - `RunContext = { phase: 'always'|'event'; source: Source; script: Script; activation?: Activation; event?: EventInfo }` where `Source` is resolve.ts's (`ability, instance, activation?, label`).
  - `EventInfo = { kind: ScriptEvent; result?: 'hit'|'miss'|'crit'; damage?: number; targetId?: string; abilityId?: string; activationId?: string; payload?: unknown }`.
  - `makeApi(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[], trace: Trace): ScriptApi` where `Trace = { last?: { text: string; result: boolean }; emitted: boolean }` and `ScriptApi` is the object destructured by the preamble (Task 4). `Patch` type is defined here too (events.ts imports it): `{ k: 'tag', to, tag, duration } | { k: 'untag', to, tag } | { k: 'resource', id, op, amount } | { k: 'grant', abilityId, duration? } | { k: 'suppress', abilityId } | { k: 'hp', op, amount } | { k: 'reveal' } | { k: 'setVar', name, value } | { k: 'log', text } | { k: 'emit', name, payload }`.
  - `SKIP` symbol and `class ScriptSkip { because: string }` thrown by `need()`.

- [ ] **Step 1: Failing tests**

```ts
// packages/engine/test/scripts/api.test.ts
import { AbilitySchema } from '../../src/schema';
import { makeApi, type Trace } from '../../src/scripts/api';
import { newSink } from '../../src/scripts/sink';
import type { Patch } from '../../src/scripts/api';
import { SIZE, HURT, ROUND } from '../../src/scripts/units';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

const feat = AbilitySchema.parse({ id: 'f', name: 'Feat', kind: 'feature', params: { types: { kind: 'tags', category: 'creatureType' } } });
function setup(phase: 'always' | 'event' = 'always') {
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration', 'aquatic'], size: 'large', hurt: 'bloodied', distanceFeet: 20 })], toggles: { sniping: true }, prompts: { 'knowledge:aberration': 24 } });
  const ctx = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'f', enabled: true, paramValues: { types: ['aberration'] } }], vars: { trophyMultiplier: 2 } }), battle, target: battle.combatants[0], attack: { profile: { id: 'bow', name: 'Bow', kind: 'ranged', baseDice: '1d8', enhancement: 1, critRange: 20, critMult: 3, attackAbility: 'dex', damageAbilityMultiplier: 1 }, kind: 'ranged', index: 2, modeId: 'full' } });
  ctx.library.abilities['f'] = feat; ctx.library.globals = { season: 'winter' };
  const sink = newSink(); const patches: Patch[] = []; const trace: Trace = { emitted: false };
  const api = makeApi(ctx, { phase, source: { ability: feat, instance: ctx.character.abilities[0], kind: 'ability', blocks: [], label: 'Feat', scripts: [] }, script: { id: 's', events: [phase === 'always' ? 'always' : 'hit'], source: '', enabled: true, priority: 0 }, ...(phase === 'event' ? { event: { kind: 'hit', result: 'hit', damage: 9, targetId: 'c1' } } : {}) }, sink, patches, trace);
  return { ctx, sink, patches, trace, api };
}

test('reads: paths, enums, predicates trace themselves', () => {
  const { api, trace } = setup();
  expect(api.player.level).toBe(6); expect(api.player.mod.dex).toBe(3); expect(api.player.skills.spot.ranks).toBe(9); expect(api.player.classes.ranger).toBe(5);
  expect(api.target.size).toBe(SIZE.LARGE); expect(api.target.hurt).toBe(HURT.BLOODIED); expect(api.target.distance).toBe(20);
  expect(api.target.is('aquatic')).toBe(true); expect(trace.last).toEqual({ text: 'target is Aquatic', result: true });
  expect(api.target.within(10)).toBe(false); expect(trace.last).toEqual({ text: 'target within 10 ft', result: false });
  expect(api.target.isOneOf(api.params.types)).toBe(true);
  expect(api.attack.isRanged).toBe(true); expect(api.attack.index).toBe(2);
  expect(api.battle.on('sniping')).toBe(true); expect(api.battle.prompts.knowledge).toBe(24);
  expect(api.vars.trophyMultiplier).toBe(2); expect(api.vars.season).toBe('winter'); expect(api.vars.nope).toBeUndefined();
});

test('compute helpers fill the sink with source attribution; event helpers throw in always phase', () => {
  const { api, sink } = setup();
  api.bonus(['attack', 'damage'], 2, 'morale'); api.bonus('ac', 1, 'dodge', { as: 'Dodging' }); api.dice('1d6', 'fire'); api.flag('ignoreConcealment'); api.note('hi'); api.slot('ring'); api.attackMode({ id: 'rs', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' }); api.extraAttack(1);
  expect(sink.bonuses.map((b) => [b.stat, b.value, b.bonusType, b.label, b.source])).toEqual([['attack', 2, 'morale', 'Feat', 'f'], ['damage', 2, 'morale', 'Feat', 'f'], ['ac', 1, 'dodge', 'Dodging', 'f']]);
  expect(sink.dice[0]).toMatchObject({ dice: '1d6', damageType: 'fire' }); expect(sink.flags).toEqual({ ignoreConcealment: true }); expect(sink.slots.ring).toBe(1); expect(sink.modes[0]!.modeId).toBe('rs'); expect(sink.extraAttacks[0]).toMatchObject({ n: 1, base: 'full' });
  expect(() => api.bonus('attac', 1)).toThrow(/unknown stat/);
  expect(() => api.bonus('attack', 1, 'moral')).toThrow(/unknown bonus type/);
  expect(() => api.heal(5)).toThrow(/only in event scripts/);
  expect(() => { (api.player as { level: number }).level = 3; }).toThrow();
});

test('ask registers a prompt when unanswered and returns the stored value otherwise; tier maps', () => {
  const { api, sink } = setup();
  expect(api.ask('knowledge', { per: 'creatureType' })).toBe(24);
  expect(api.ask('spellcraft')).toBe(0); expect(sink.prompts[0]).toMatchObject({ promptId: 'spellcraft', source: 'f' });
  expect(api.tier(24, [15, 1], [25, 2], [Infinity, 5])).toBe(2);
});

test('event helpers queue patches; compute helpers throw in event phase', () => {
  const { api, patches } = setup('event');
  api.target.mark('flanked', ROUND); api.heal(5); api.charges('boots-rounds').use(2); api.setVar('kills', 1); api.emit('rage-ended', { by: 'f' }); api.grant('haste', 3 * ROUND); api.suppress('dodge'); api.reveal(); api.log('hi');
  expect(patches.map((p) => p.k)).toEqual(['tag', 'hp', 'resource', 'setVar', 'emit', 'grant', 'suppress', 'reveal', 'log']);
  expect(patches[0]).toEqual({ k: 'tag', to: 'target', tag: 'flanked', duration: 6 });
  expect(api.event.damage).toBe(9); expect(api.player.lastDamage).toBe(9);
  expect(() => api.bonus('attack', 1)).toThrow(/only in always scripts/);
});

test('history helper counts with friendly defaults', () => {
  const { api, ctx } = setup();
  ctx.battle!.log.push({ id: 'e1', round: 1, seq: 1, kind: 'attack', actor: 'self', targetId: 'c1', result: 'miss' }, { id: 'e2', round: 1, seq: 2, kind: 'attack', actor: 'self', targetId: 'c1', result: 'miss' });
  expect(api.history('miss')).toBe(2); expect(api.history('hit')).toBe(0); expect(api.history('miss', { since: 'lastRound' })).toBe(0);
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/scripts/api.test.ts` → FAIL.

- [ ] **Step 3: Implement `sink.ts`**

```ts
import type { BonusEntry } from '../stacking';
import type { AttackMode, DiceEntry, NearMiss, PromptRequest } from '../resolve';
import type { AttackKind, SlotId, StatId } from '../schema';
export type ScriptError = { recordId: string; scriptId: string; label: string; phase: 'compile' | 'run'; message: string; line?: number };
export type Sink = {
  bonuses: (BonusEntry & { stat: StatId })[];
  sets: { stat: StatId; value: number; source: string }[];
  multipliers: { stat: StatId; factor: number; source: string }[];
  dice: DiceEntry[];
  flags: Record<string, boolean>;
  notes: { text: string; source: string; sourceName: string }[];
  modes: AttackMode[];
  extraAttacks: { n: number; base: 'single' | 'full' | 'any'; kind?: AttackKind; source: string }[];
  naturals: { name: string; dice: string; count: number; attackBonus: number; source: string; sourceName: string }[];
  slots: Partial<Record<SlotId, number>>;
  prompts: PromptRequest[];
  skipped: NearMiss[];
  errors: ScriptError[];
};
export const newSink = (): Sink => ({ bonuses: [], sets: [], multipliers: [], dice: [], flags: {}, notes: [], modes: [], extraAttacks: [], naturals: [], slots: {}, prompts: [], skipped: [], errors: [] });
```

(`resolve.ts` types `AttackMode`, `DiceEntry`, `NearMiss`, `PromptRequest` exist today; importing types only, no cycle at runtime.)

- [ ] **Step 4: Implement `api.ts`**

```ts
import { HURT_ORDER, SIZE_ORDER, abilityMod, findResourceDef, resourceUsed, targetTags, targetTagsInCategory, type AbilityInstance, type EvalContext } from '../context';
import { evalExpr } from '../expr';
import { countHistory } from '../history';
import { readSelector } from '../selectors';
import { resolveStat } from '../resolve';
import { BonusTypeSchema, StatIdSchema, activationsOf, type Activation, type Ability, type BonusType, type Duration, type HistoryFilter, type Script, type ScriptEvent, type SlotId, type StatId } from '../schema';
import { exprVars } from '../vars';
import type { Sink } from './sink';
import { BONUS, DAY, ENCOUNTER, HOUR, HURT, MINUTE, ROUND, SECOND, SIZE, STAT, THIS_ATTACK, UNTIL_MY_NEXT_TURN, UNTIL_REMOVED, toRounds } from './units';

export type EventInfo = { kind: ScriptEvent; result?: 'hit' | 'miss' | 'crit'; damage?: number; targetId?: string; abilityId?: string; activationId?: string; payload?: unknown };
export type Patch =
  | { k: 'tag'; to: 'self' | 'target' | 'allEnemies'; tag: string; duration: Duration }
  | { k: 'untag'; to: 'self' | 'target'; tag: string }
  | { k: 'resource'; id: string; op: 'consume' | 'restore' | 'set'; amount: number }
  | { k: 'grant'; abilityId: string; duration?: Duration }
  | { k: 'suppress'; abilityId: string }
  | { k: 'hp'; op: 'damage' | 'heal' | 'temp'; amount: number }
  | { k: 'reveal' }
  | { k: 'setVar'; name: string; value: number | string | boolean }
  | { k: 'log'; text: string }
  | { k: 'emit'; name: string; payload?: unknown };
export type Trace = { last?: { text: string; result: boolean }; emitted: boolean };
export type RunSource = { ability: Ability; instance: AbilityInstance | undefined; activation?: Activation; label: string };
export type RunContext = { phase: 'always' | 'event'; source: RunSource; script: Script; event?: EventInfo; args?: Record<string, unknown>; fns?: Record<string, (args: Record<string, unknown>) => void> };
export class ScriptSkip { constructor(public because: string) {} }

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const freeze = <T extends object>(o: T): T => Object.freeze(o);
const proxy = (get: (k: string) => unknown) => new Proxy(Object.freeze({}), { get: (_, k) => (typeof k === 'string' ? get(k) : undefined), set: () => { throw new Error('read-only: use a helper (bonus, setVar, heal…) to change values'); } });

export function makeApi(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[], trace: Trace) {
  const always = run.phase === 'always';
  const src = run.source; const sourceId = src.ability.id;
  const onlyAlways = (name: string) => { if (!always) throw new Error(`${name}() works only in always scripts`); };
  const onlyEvent = (name: string) => { if (always) throw new Error(`${name}() works only in event scripts`); };
  const tagLabel = (t: string) => ctx.library.tags[t]?.label ?? t;
  const pred = (text: string, result: boolean) => { trace.last = { text, result }; return result; };
  const sel = (s: string) => readSelector(ctx, s);
  const stat = (id: string) => { StatIdSchema.parse(id); return resolveStat(ctx, id).total; };
  const t = ctx.target;
  const ttags = t ? targetTags(t) : [];

  const player = freeze({
    get level() { return sel('self.level') as number; }, get bab() { return sel('self.bab') as number; },
    get size() { return SIZE_ORDER.indexOf(ctx.character.size); },
    hp: freeze({ get current() { return ctx.character.hp.current; }, get max() { return stat('hp.max'); }, get temp() { return ctx.character.hp.temp; }, get nonlethal() { return ctx.character.hp.nonlethal; } }),
    stats: proxy((k) => (ABILITY_KEYS.includes(k as 'str') ? stat(`ability.${k}`) : stat(k))),
    mod: proxy((k) => abilityMod(stat(`ability.${k}`))),
    skills: proxy((id) => freeze({ get ranks() { return sel(`self.skill.${id}.ranks`) as number; }, get total() { return sel(`self.skill.${id}.total`) as number; }, get classSkill() { return !!sel(`self.skill.${id}.classSkill`); } })),
    classes: proxy((id) => (sel(`self.class.${id}.level`) as number) ?? 0),
    get tags() { return ctx.battle?.selfConditions.map((c) => c.tag) ?? []; },
    is: (tag: string | string[]) => pred(`you are ${[tag].flat().map(tagLabel).join(' / ')}`, [tag].flat().some((x) => !!sel(`self.tag.${x}`))),
    has: (id: string) => pred(`${ctx.library.abilities[id]?.name ?? id} on sheet`, !!sel(`self.ability.${id}.enabled`)),
    active: (id: string) => activeInfo(ctx, id),
    left: (poolId: string) => (sel(`self.resource.${poolId}.left`) as number) ?? 0,
    wearing: (itemId: string) => pred(`${ctx.library.abilities[itemId]?.name ?? itemId} equipped`, !!sel(`self.equipped.item.${itemId}`)),
    equipped: freeze({ slot: proxy((k) => sel(`self.equipped.slot.${k}`) ?? 0), category: proxy((k) => sel(`self.equipped.category.${k}`) ?? 0), tag: proxy((k) => sel(`self.equipped.count.tag.${k}`) ?? 0) }),
    params: proxy((k) => run.source.instance?.paramValues[k] ?? []),
    get lastDamage() { return run.event?.damage ?? ctx.lastDamage ?? 0; },
  });
  const target = freeze({
    get exists() { return !!t; }, get name() { return t?.name ?? ''; }, get type() { return t ? targetTagsInCategory(ctx, t, 'creatureType')[0] : undefined; },
    get size() { return t ? SIZE_ORDER.indexOf(t.size) : -1; }, get hurt() { return t ? HURT_ORDER.indexOf(t.hurt) : -1; },
    get distance() { return t?.distanceFeet; }, get revealed() { return !!t?.revealed; }, get dead() { return !!t?.dead; }, get tags() { return ttags; },
    is: (tag: string | string[]) => pred(`target is ${[tag].flat().map(tagLabel).join(' / ')}`, [tag].flat().some((x) => ttags.includes(x))),
    isOneOf: (tags: readonly string[]) => pred('target type is one of your chosen types', tags.some((x) => ttags.includes(x))),
    within: (ft: number) => pred(`target within ${ft} ft`, t?.distanceFeet !== undefined && t.distanceFeet <= ft),
    mark: (tag: string, duration: Duration = UNTIL_REMOVED) => { onlyEvent('target.mark'); patches.push({ k: 'tag', to: 'target', tag, duration }); },
    unmark: (tag: string) => { onlyEvent('target.unmark'); patches.push({ k: 'untag', to: 'target', tag }); },
    reveal: () => { onlyEvent('target.reveal'); patches.push({ k: 'reveal' }); },
  });
  const a = ctx.attack;
  const attack = freeze({
    get exists() { return !!a; }, get kind() { return a?.kind; }, get index() { return a?.index ?? 0; }, get mode() { return a?.modeId; },
    get isRanged() { return pred('ranged attack', a?.kind === 'ranged'); }, get isMelee() { return pred('melee attack', a?.kind === 'melee'); },
    get isFirstThisRound() { return pred('first attack this round', !!sel('attack.isFirstThisRound')); },
    weapon: freeze({ get id() { return a?.weaponAbilityId; }, get category() { return sel('attack.weapon.category'); }, get tags() { const w = a?.weaponAbilityId ? ctx.library.abilities[a.weaponAbilityId] : undefined; return w?.kind === 'item' ? w.item.tags : []; }, is: (tag: string) => pred(`weapon is ${tag}`, !!sel(`attack.weapon.tag.${tag}`)) }),
  });
  const battle = freeze({
    get exists() { return !!ctx.battle; }, get round() { return ctx.battle?.round ?? 1; }, get elapsed() { return ((ctx.battle?.round ?? 1) - 1) * ROUND; }, get tags() { return ctx.battle?.tags ?? []; },
    on: (id: string) => pred(`"${id}" switched on`, !!ctx.battle?.toggles[id]),
    is: (tag: string) => pred(`battle is ${tagLabel(tag)}`, !!ctx.battle?.tags.includes(tag)),
    toggles: proxy((k) => !!ctx.battle?.toggles[k]), prompts: proxy((k) => sel(`battle.prompt.${k}`)),
  });
  const vars = proxy((k) => ctx.character.vars[k] ?? ctx.library.globals?.[k]);
  const flags = proxy((k) => !!sink.flags[k]);
  const params = player.params;
  const activeOwn = run.source.activation ? activeInfo(ctx, run.source.activation.id) : null;
  const emit = (name: string, payload?: unknown) => { onlyEvent('emit'); patches.push({ k: 'emit', name, payload }); };
  const push = (b: Sink['bonuses'][number]) => { trace.emitted = true; sink.bonuses.push(b); };
  const asStat = (s: string): StatId => { const r = StatIdSchema.safeParse(s); if (!r.success) throw new Error(`unknown stat "${s}"`); return r.data; };
  const asType = (x: string): BonusType => { const r = BonusTypeSchema.safeParse(x); if (!r.success) throw new Error(`unknown bonus type "${x}"`); return r.data; };
  const label = (as?: string) => as ?? run.script.label ?? src.label;

  const api = {
    player, self: player, target, attack, battle, vars, flags, params, active: activeOwn, event: run.event ?? null, args: run.args ?? {}, fn: run.fns ?? {},
    sel, has: (who: { is: (x: string | string[]) => boolean }, tag: string | string[]) => who.is(tag),
    nameOf: (id: string) => ctx.library.abilities[id]?.name ?? id,
    bonus: (s: string | string[], value: number, type = 'untyped', opts: { as?: string } = {}) => { onlyAlways('bonus'); const bt = asType(type); for (const x of [s].flat()) if (value) push({ stat: asStat(x), value, bonusType: bt, source: sourceId, label: label(opts.as) }); },
    penalty: (s: string | string[], value: number, type = 'untyped', opts: { as?: string } = {}) => api.bonus(s, -Math.abs(value), type, opts),
    setStat: (s: string, value: number) => { onlyAlways('setStat'); trace.emitted = true; sink.sets.push({ stat: asStat(s), value, source: sourceId }); },
    scale: (s: string, factor: number) => { onlyAlways('scale'); trace.emitted = true; sink.multipliers.push({ stat: asStat(s), factor, source: sourceId }); },
    dice: (spec: string, damageType?: string, opts: { as?: string } = {}) => { onlyAlways('dice'); if (!/^\d+d\d+$/.test(spec)) throw new Error(`bad dice "${spec}"`); trace.emitted = true; sink.dice.push({ dice: spec, label: label(opts.as), ...(damageType ? { damageType } : {}) }); },
    flag: (name: string, value = true) => { onlyAlways('flag'); trace.emitted = true; sink.flags[name] = value; },
    note: (text: string) => { onlyAlways('note'); trace.emitted = true; sink.notes.push({ text, source: sourceId, sourceName: src.label }); },
    slot: (s: string, count = 1) => { onlyAlways('slot'); trace.emitted = true; sink.slots[s as SlotId] = (sink.slots[s as SlotId] ?? 0) + count; },
    attackMode: (m: { id: string; label: string; base: 'single' | 'full'; extra?: number; penalty?: number; kind?: 'ranged' | 'melee'; note?: string }) => { onlyAlways('attackMode'); trace.emitted = true; sink.modes.push({ modeId: m.id, label: m.label, base: m.base, extraAttacksAtTop: m.extra ?? 0, penalty: m.penalty ?? 0, source: sourceId, ...(m.kind ? { kind: m.kind } : {}), ...(m.note ? { note: m.note } : {}) }); },
    extraAttack: (n = 1, opts: { base?: 'single' | 'full' | 'any'; kind?: 'ranged' | 'melee' } = {}) => { onlyAlways('extraAttack'); trace.emitted = true; sink.extraAttacks.push({ n, base: opts.base ?? 'full', ...(opts.kind ? { kind: opts.kind } : {}), source: sourceId }); },
    naturalAttack: (n: { name: string; dice: string; count?: number; attackBonus?: number }) => { onlyAlways('naturalAttack'); trace.emitted = true; sink.naturals.push({ name: n.name, dice: n.dice, count: n.count ?? 1, attackBonus: n.attackBonus ?? 0, source: sourceId, sourceName: src.label }); },
    ask: (promptId: string, opts: { per?: string; label?: string } = {}) => {
      onlyAlways('ask');
      const key = opts.per && t ? targetTagsInCategory(ctx, t, opts.per)[0] : undefined;
      const stored = opts.per ? (key ? ctx.battle?.prompts[`${promptId}:${key}`] : undefined) : ctx.battle?.prompts[promptId];
      if (stored !== undefined) return stored;
      if (!sink.prompts.some((p) => p.promptId === promptId && p.source === sourceId)) sink.prompts.push({ promptId, ...(opts.per ? { perTagCategory: opts.per } : {}), ...(key ? { tag: key } : {}), source: sourceId, sourceName: src.label });
      return 0;
    },
    tier: (value: number, ...rows: [number, number][]) => { for (const [upTo, r] of rows) if (value <= upTo) return r; return rows.at(-1)?.[1] ?? 0; },
    history: (event: HistoryFilter['event'], opts: { by?: HistoryFilter['by']; vs?: HistoryFilter['vs']; since?: HistoryFilter['scope']; ability?: string; category?: string } = {}) => countHistory(ctx, { event, by: opts.by ?? 'me', vs: opts.vs ?? 'current', scope: opts.since ?? 'round', ...(opts.ability ? { abilityId: opts.ability } : {}), ...(opts.category ? { category: opts.category } : {}) }),
    condition: (who: 'self' | 'target' | 'allEnemies', tag: string, duration: Duration = UNTIL_REMOVED) => { onlyEvent('condition'); patches.push({ k: 'tag', to: who, tag, duration }); },
    grant: (abilityId: string, duration?: Duration) => { onlyEvent('grant'); patches.push({ k: 'grant', abilityId, ...(duration !== undefined ? { duration } : {}) }); },
    suppress: (abilityId: string) => { onlyEvent('suppress'); patches.push({ k: 'suppress', abilityId }); },
    charges: (id: string) => ({ get left() { return (sel(`self.resource.${id}.left`) as number) ?? 0; }, use: (n = 1) => { onlyEvent('charges.use'); patches.push({ k: 'resource', id, op: 'consume', amount: n }); }, restore: (n = 1) => { onlyEvent('charges.restore'); patches.push({ k: 'resource', id, op: 'restore', amount: n }); }, set: (n: number) => { onlyEvent('charges.set'); patches.push({ k: 'resource', id, op: 'set', amount: n }); } }),
    heal: (n: number) => { onlyEvent('heal'); patches.push({ k: 'hp', op: 'heal', amount: n }); },
    hurt: (n: number) => { onlyEvent('hurt'); patches.push({ k: 'hp', op: 'damage', amount: n }); },
    temp: (n: number) => { onlyEvent('temp'); patches.push({ k: 'hp', op: 'temp', amount: n }); },
    reveal: () => target.reveal(),
    setVar: (name: string, value: number | string | boolean) => { onlyEvent('setVar'); patches.push({ k: 'setVar', name, value }); },
    log: (text: string) => { onlyEvent('log'); patches.push({ k: 'log', text }); },
    emit,
    need: (cond: unknown, because = trace.last && !trace.last.result ? trace.last.text : 'a condition') => { if (!cond) throw new ScriptSkip(because); },
    SECOND, ROUND, MINUTE, HOUR, DAY, THIS_ATTACK, UNTIL_MY_NEXT_TURN, ENCOUNTER, UNTIL_REMOVED, SIZE, HURT, BONUS, STAT,
    mod: abilityMod, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, min: Math.min, max: Math.max, clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
    toRounds, evalExpr: (e: string) => evalExpr(e, exprVars(ctx)),
  };
  return freeze(api);
}
export type ScriptApi = ReturnType<typeof makeApi>;
export const API_NAMES = ['player', 'self', 'target', 'attack', 'battle', 'vars', 'flags', 'params', 'active', 'event', 'args', 'fn', 'sel', 'has', 'nameOf', 'bonus', 'penalty', 'setStat', 'scale', 'dice', 'flag', 'note', 'slot', 'attackMode', 'extraAttack', 'naturalAttack', 'ask', 'tier', 'history', 'condition', 'grant', 'suppress', 'charges', 'heal', 'hurt', 'temp', 'reveal', 'setVar', 'log', 'emit', 'need', 'SECOND', 'ROUND', 'MINUTE', 'HOUR', 'DAY', 'THIS_ATTACK', 'UNTIL_MY_NEXT_TURN', 'ENCOUNTER', 'UNTIL_REMOVED', 'SIZE', 'HURT', 'BONUS', 'STAT', 'mod', 'floor', 'ceil', 'round', 'abs', 'min', 'max', 'clamp', 'toRounds'] as const;

/** nth round active, seconds elapsed, seconds remaining for a running status/activation; null when not active. */
export function activeInfo(ctx: EvalContext, id: string): { round: number; elapsed: number; remaining: number | null } | null {
  const b = ctx.battle?.activeBuffs.find((x) => (x.abilityId === id || x.activationId === id) && x.owner === 'self' && !x.suppressed);
  if (!b) return null;
  const round = Math.max(1, (ctx.battle!.round - (b.appliedRound ?? ctx.battle!.round)) + 1);
  return { round, elapsed: (round - 1) * ROUND, remaining: b.remainingRounds !== undefined ? b.remainingRounds * ROUND : null };
}
```

`ActiveBuffSchema` gains `appliedRound: z.number().int().optional()` (Task 2 already edits the schema; add it there: buffs created in `useAbility`, `addStatus`, `grant` set `appliedRound: battle.round` in Task 6). `AttackMode` type in resolve.ts gains optional `kind?: AttackKind` (Task 6 uses it to filter modes; the probe pass no longer needs `attackKind` guards).

`selectors.ts` `case 'mod'` currently uses base scores; change to `abilityMod(resolveStat(ctx, \`ability.${rest}\`).total)`.

- [ ] **Step 5: Run** — `npx vitest run test/scripts/api.test.ts` → PASS.

- [ ] **Step 6: Commit** — `git add packages/engine/src/scripts packages/engine/test/scripts packages/engine/src/selectors.ts && git commit -m "Scripts API: player/target/attack/battle façades with traced predicates, compute and event helpers, sink and patches"`

---

### Task 4: Compile, instrument (loop guard), diagnostics, safe mode

**Files:**
- Modify: `packages/engine/package.json` (add `"acorn": "^8.18.0"` to dependencies; run `npm install` at the root)
- Create: `packages/engine/src/scripts/budget.ts`, `instrument.ts`, `compile.ts`, `diagnostics.ts`
- Test: `packages/engine/test/scripts/compile.test.ts`

**Interfaces:**
- Produces: `class Budget { start(ms): void; tick(): void }`, `class ScriptTimeout extends Error`; `instrument(source): { code: string; toggles: string[]; emits: string[]; noguard: boolean }`; `compile(source: string, paramNames?: string[]): Compiled` where `Compiled = { ok: true; run: (api: ScriptApi, guard: () => void) => void; toggles: string[]; emits: string[]; noguard: boolean } | { ok: false; error: string; line?: number }`; `diagnostics = { record(e: ScriptError): void; errors(): ScriptError[]; clear(recordId?): void; quarantined(key): boolean; noteFailure(key): void }`; `getScriptMode(): 'on'|'off'`, `setScriptMode(m)`.

- [ ] **Step 1: Failing tests**

```ts
// packages/engine/test/scripts/compile.test.ts
import { compile } from '../../src/scripts/compile';
import { instrument } from '../../src/scripts/instrument';
import { Budget, ScriptTimeout } from '../../src/scripts/budget';
import { diagnostics } from '../../src/scripts/diagnostics';

test('instrument splices guards into loops and functions and scans toggles and emits', () => {
  const r = instrument("for (let i = 0; i < 3; i++) x++; while (a) { b() }\nfunction f() { return 1 }\nif (battle.toggles.sniping) emit('rage-ended')");
  expect(r.code).toContain('for (let i = 0; i < 3; i++) {__g();x++;}');
  expect(r.code).toContain('while (a) {__g(); b() }');
  expect(r.code).toContain('function f() {__g(); return 1 }');
  expect(r.toggles).toEqual(['sniping']); expect(r.emits).toEqual(['rage-ended']); expect(r.noguard).toBe(false);
  expect(instrument('// @noguard\nwhile (x) {}').code).toBe('// @noguard\nwhile (x) {}');
});

test('compile caches, reports syntax errors with a line, and runs with the destructured api', () => {
  const bad = compile('bonus(1,'); expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error).toMatch(/Unexpected/);
  const good = compile("bonus('attack', 2)"); expect(good.ok).toBe(true);
  const calls: unknown[] = []; if (good.ok) good.run({ bonus: (...a: unknown[]) => calls.push(a) } as never, () => {});
  expect(calls).toEqual([['attack', 2]]);
  expect(compile("bonus('attack', 2)")).toBe(good);
  const shadow = compile('const bonus = 1'); expect(shadow.ok).toBe(false); if (!shadow.ok) expect(shadow.error).toMatch(/bonus/);
});

test('budget stops a runaway loop', () => {
  const c = compile('while (true) {}'); expect(c.ok).toBe(true);
  const b = new Budget(); b.start(5);
  expect(() => { if (c.ok) c.run({} as never, b.tick); }).toThrow(ScriptTimeout);
});

test('diagnostics quarantine after three failures', () => {
  diagnostics.clear();
  for (let i = 0; i < 3; i++) diagnostics.noteFailure('rec/s1');
  expect(diagnostics.quarantined('rec/s1')).toBe(true); expect(diagnostics.quarantined('rec/s2')).toBe(false);
});
```

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement**

```ts
// budget.ts
export class ScriptTimeout extends Error {}
export class Budget {
  private ops = 0; private t0 = 0; private limit = 0;
  start(ms: number) { this.ops = 0; this.t0 = performance.now(); this.limit = ms; }
  tick = () => {
    if ((++this.ops & 255) === 0 && performance.now() - this.t0 > this.limit) throw new ScriptTimeout(`script exceeded ${this.limit} ms (${this.ops} ops)`);
    if (this.ops > 2_000_000) throw new ScriptTimeout('script exceeded 2,000,000 operations');
  };
}
```

```ts
// instrument.ts
import { parse, type Node } from 'acorn';
const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForOfStatement', 'ForInStatement']);
const FNS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
type AnyNode = Node & Record<string, unknown>;
function walk(n: AnyNode, visit: (n: AnyNode) => void) {
  visit(n);
  for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) { for (const c of v) if (c && typeof (c as AnyNode).type === 'string') walk(c as AnyNode, visit); } else if (v && typeof (v as AnyNode).type === 'string') walk(v as AnyNode, visit); }
}
export function instrument(src: string): { code: string; toggles: string[]; emits: string[]; noguard: boolean } {
  const noguard = /(\/\/|\/\*)\s*@noguard\b/.test(src);
  const ast = parse(src, { ecmaVersion: 2022, allowReturnOutsideFunction: true }) as AnyNode;
  const toggles = new Set<string>(), emits = new Set<string>(), edits: { at: number; text: string }[] = [];
  walk(ast, (n) => {
    const obj = n.object as AnyNode | undefined, prop = n.property as AnyNode | undefined;
    if (n.type === 'MemberExpression' && !n.computed && obj?.type === 'MemberExpression' && (obj.object as AnyNode).name === 'battle' && (obj.property as AnyNode).name === 'toggles' && prop) toggles.add(String(prop.name));
    if (n.type === 'CallExpression' && (n.callee as AnyNode).name === 'emit') { const a0 = (n.arguments as AnyNode[])[0]; if (a0?.type === 'Literal') emits.add(String(a0.value)); }
    if (noguard) return;
    if (LOOPS.has(n.type)) { const body = n.body as AnyNode; if (body.type === 'BlockStatement') edits.push({ at: body.start + 1, text: '__g();' }); else edits.push({ at: body.start, text: '{__g();' }, { at: body.end, text: '}' }); }
    if (FNS.has(n.type) && (n.body as AnyNode).type === 'BlockStatement') edits.push({ at: (n.body as AnyNode).start + 1, text: '__g();' });
  });
  edits.sort((a, b) => b.at - a.at);
  let code = src; for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at);
  return { code, toggles: [...toggles], emits: [...emits], noguard };
}
```

```ts
// compile.ts
import { API_NAMES, type ScriptApi } from './api';
import { instrument } from './instrument';
export type Compiled = { ok: true; run: (api: ScriptApi, guard: () => void) => void; toggles: string[]; emits: string[]; noguard: boolean } | { ok: false; error: string; line?: number };
const PREAMBLE = `const { ${API_NAMES.join(', ')} } = api;\n`;
const cache = new Map<string, Compiled>();
const MAX = 2000;
export function compile(source: string, paramNames: string[] = []): Compiled {
  const key = `${paramNames.join(',')} ${source}`;
  const hit = cache.get(key); if (hit) return hit;
  let out: Compiled;
  try {
    const ins = instrument(source);
    const argLine = paramNames.length ? `const { ${paramNames.join(', ')} } = args;\n` : '';
    const f = new Function('api', '__g', `"use strict";\n${PREAMBLE}${argLine}${ins.code}\n`) as (api: ScriptApi, g: () => void) => void;
    out = { ok: true, run: f, toggles: ins.toggles, emits: ins.emits, noguard: ins.noguard };
  } catch (e) {
    const err = e as Error & { loc?: { line: number } };
    const m = /Identifier '(\w+)' has already been declared/.exec(err.message);
    out = { ok: false, error: m && (API_NAMES as readonly string[]).includes(m[1]!) ? `'${m[1]}' is a built-in helper; pick another name` : err.message, ...(err.loc ? { line: err.loc.line } : {}) };
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
```

```ts
// diagnostics.ts
import type { ScriptError } from './sink';
let errors: ScriptError[] = [];
const failures = new Map<string, number>();
let mode: 'on' | 'off' = 'on';
export const diagnostics = {
  record(e: ScriptError) { if (!errors.some((x) => x.recordId === e.recordId && x.scriptId === e.scriptId && x.message === e.message)) errors = [...errors, e]; },
  errors: () => errors,
  clear(recordId?: string) { errors = recordId ? errors.filter((e) => e.recordId !== recordId) : []; if (!recordId) failures.clear(); else for (const k of [...failures.keys()]) if (k.startsWith(recordId + '/')) failures.delete(k); },
  noteFailure(key: string) { failures.set(key, (failures.get(key) ?? 0) + 1); },
  quarantined: (key: string) => (failures.get(key) ?? 0) >= 3,
};
export const getScriptMode = () => mode;
export const setScriptMode = (m: 'on' | 'off') => { mode = m; };
```

- [ ] **Step 4: Run** → PASS. (`npm install` at root after adding the dependency; confirm `node_modules/acorn` resolves from `packages/engine`.)

- [ ] **Step 5: Commit** — `git add packages/engine package-lock.json && git commit -m "Scripts: compile with destructured api, acorn loop guard with @noguard, error registry and quarantine, safe mode switch"`

---

### Task 5: Compute pass and event runner

**Files:**
- Create: `packages/engine/src/scripts/compute.ts`, `packages/engine/src/scripts/events.ts`, `packages/engine/src/scripts/index.ts`
- Test: `packages/engine/test/scripts/compute.test.ts`, `packages/engine/test/scripts/events.test.ts`

**Interfaces:**
- Produces: `computePass(ctx: EvalContext): Sink` (cached; `always` scripts of every active source; traced near-miss into `sink.skipped`; errors into `sink.errors` and `diagnostics`); `activeSources(ctx): RunSource[]` moves here from resolve.ts with the same gating (enabled features/items, active statuses, running activations with their `scripts`, spell scripts when an activation has `spell`); `runEventScripts(ctx, event: EventInfo, opts?: { only?: { abilityId: string; activationId?: string } }): { patches: Patch[]; errors: ScriptError[] }` (drains `emit` cascades up to depth 8); `applyPatches(ctx, state: State, patches, sourceAbility: Ability, targetId?): State` (port of `applyTriggered` plus `setVar`, `log`, `untag`); `fnTable(ctx, run): Record<string, (args) => void>` compiling library functions on demand with a shared budget and depth cap 8.

- [ ] **Step 1: Failing tests**

```ts
// packages/engine/test/scripts/compute.test.ts
import { AbilitySchema } from '../../src/schema';
import { computePass } from '../../src/scripts/compute';
import { diagnostics } from '../../src/scripts/diagnostics';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

function ctxWith(records: ReturnType<typeof AbilitySchema.parse>[], opts: { target?: boolean; distance?: number; functions?: Record<string, { id: string; name: string; params: { name: string; type: 'number' | 'stat'; required: boolean }[]; source: string }> } = {}) {
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration'], distanceFeet: opts.distance ?? 20 })] });
  const c = makeCtx({ character: makeCharacter({ abilities: records.map((r) => ({ abilityId: r.id, enabled: true, paramValues: {} })) }), battle, ...(opts.target === false ? {} : { target: battle.combatants[0] }) });
  for (const r of records) c.library.abilities[r.id] = r;
  c.library.functions = opts.functions ?? {};
  return c;
}

test('always scripts fill the sink; a script that emits nothing records its last false predicate as a near miss', () => {
  const pbs = AbilitySchema.parse({ id: 'pbs', name: 'Point Blank Shot', kind: 'feature', scripts: [{ id: 's', source: "if (attack.isRanged && target.within(30)) bonus(['attack', 'damage'], 1)" }] });
  const c = ctxWith([pbs], { distance: 60 });
  const sink = computePass({ ...c, attack: { profile: { id: 'bow', name: 'Bow', kind: 'ranged', baseDice: '1d8', enhancement: 0, critRange: 20, critMult: 2, attackAbility: 'dex', damageAbilityMultiplier: 1 }, kind: 'ranged', index: 1, modeId: 'single' } });
  expect(sink.bonuses).toEqual([]);
  expect(sink.skipped[0]).toMatchObject({ source: 'pbs', sourceName: 'Point Blank Shot', failed: 'target within 30 ft' });
  const near = computePass({ ...ctxWith([pbs], { distance: 20 }), attack: { profile: { id: 'bow', name: 'Bow', kind: 'ranged', baseDice: '1d8', enhancement: 0, critRange: 20, critMult: 2, attackAbility: 'dex', damageAbilityMultiplier: 1 }, kind: 'ranged', index: 1, modeId: 'single' } });
  expect(near.bonuses.map((b) => [b.stat, b.value])).toEqual([['attack', 1], ['damage', 1]]);
});

test('a throwing script is reported, quarantined after three passes, and never breaks the pass', () => {
  diagnostics.clear();
  const bad = AbilitySchema.parse({ id: 'bad', name: 'Bad', kind: 'feature', scripts: [{ id: 's', source: 'player.mod.cha += 1' }] });
  const ok = AbilitySchema.parse({ id: 'ok', name: 'Ok', kind: 'feature', scripts: [{ id: 's', source: "bonus('init', 4)" }] });
  let c = ctxWith([bad, ok]);
  for (let i = 0; i < 3; i++) { const s = computePass(c); expect(s.bonuses[0]!.stat).toBe('init'); expect(s.errors[0]).toMatchObject({ recordId: 'bad', message: expect.stringMatching(/read-only/) }); c = { ...c, character: { ...c.character } }; }
  expect(diagnostics.quarantined('bad/s')).toBe(true);
});

test('library functions are callable with named args and share the budget', () => {
  const trophy = { id: 'trophy', name: 'Trophy', params: [{ name: 'stat', type: 'stat' as const, required: true }, { name: 'base', type: 'number' as const, required: true }], source: "bonus(stat, base * (vars.trophyMultiplier ?? 1), 'enhancement')" };
  const gloves = AbilitySchema.parse({ id: 'gloves', name: 'Gloves', kind: 'item', item: { category: 'trophy', slot: 'hands' }, scripts: [{ id: 's', source: "fn.trophy({ stat: 'init', base: 4 })" }] });
  const viaCall = AbilitySchema.parse({ id: 'amulet', name: 'Amulet', kind: 'item', item: { category: 'trophy', slot: 'neck' }, scripts: [{ id: 's', call: { fn: 'trophy', args: { stat: { k: 'lit', v: 'ac' }, base: { k: 'expr', v: '2 + 2' } } } }] });
  const c = ctxWith([gloves, viaCall], { functions: { trophy } });
  c.character.vars = { trophyMultiplier: 2 };
  expect(computePass(c).bonuses.map((b) => [b.stat, b.value, b.source])).toEqual([['init', 8, 'gloves'], ['ac', 8, 'amulet']]);
});

test('the pass is cached per character/battle/target/attack and a nested stat read sees earlier scripts', () => {
  const a = AbilitySchema.parse({ id: 'a', name: 'A', kind: 'feature', scripts: [{ id: 's', source: "bonus('ac', 2, 'armor')" }] });
  const b = AbilitySchema.parse({ id: 'b', name: 'B', kind: 'feature', scripts: [{ id: 's', source: "if (player.stats.ac >= 15) bonus('attack', 1)" }] });
  const c = ctxWith([a, b]);
  const s1 = computePass(c); expect(computePass(c)).toBe(s1);
  expect(s1.bonuses.some((x) => x.stat === 'attack')).toBe(true); // base 10 + dex 3 + armor 2 = 15
});
```

```ts
// packages/engine/test/scripts/events.test.ts
import { AbilitySchema } from '../../src/schema';
import { runEventScripts, applyPatches } from '../../src/scripts/events';
import { ROUND } from '../../src/scripts/units';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

test('hit scripts queue patches; emit wakes custom scripts in the same run; patches apply immutably', () => {
  const distract = AbilitySchema.parse({ id: 'distract', name: 'Distracting Attack', kind: 'feature', scripts: [{ id: 's', events: ['hit', 'crit'], source: "target.mark('flanked', UNTIL_MY_NEXT_TURN); emit('flanked-someone', { by: 'me' })" }] });
  const counter = AbilitySchema.parse({ id: 'counter', name: 'Counter', kind: 'feature', scripts: [{ id: 's', events: ['custom:flanked-someone'], source: "setVar('flanks', (vars.flanks ?? 0) + 1); log(`flanked by ${event.payload.by}`)" }] });
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })] });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'distract', enabled: true, paramValues: {} }, { abilityId: 'counter', enabled: true, paramValues: {} }] }), battle, target: battle.combatants[0] });
  c.library.abilities['distract'] = distract; c.library.abilities['counter'] = counter; c.library.globals = {};
  const r = runEventScripts(c, { kind: 'hit', result: 'hit', targetId: 'c1' });
  expect(r.patches.map((p) => p.k)).toEqual(['tag', 'emit', 'setVar', 'log']);
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, distract, 'c1');
  expect(st.battle.combatants[0]!.conditions[0]).toMatchObject({ tag: 'flanked', expires: 'untilMyNextTurn' });
  expect(st.globals?.flanks ?? st.character.vars.flanks).toBe(1);
  expect(st.battle.log.at(-1)).toMatchObject({ kind: 'note', text: 'flanked by me' });
  expect(c.battle!.combatants[0]!.conditions).toEqual([]);
});

test('durations in seconds become rounds on conditions and buffs', () => {
  const rec = AbilitySchema.parse({ id: 'r', name: 'R', kind: 'feature', scripts: [{ id: 's', events: ['use'], source: "condition('self', 'hasted', 3 * ROUND); grant('bless', 10 * ROUND)" }] });
  const bless = AbilitySchema.parse({ id: 'bless', name: 'Bless', kind: 'status', duration: 10 * ROUND });
  const c = makeCtx({ character: makeCharacter({ abilities: [{ abilityId: 'r', enabled: true, paramValues: {} }] }), battle: makeBattle() });
  c.library.abilities['r'] = rec; c.library.abilities['bless'] = bless;
  const r = runEventScripts(c, { kind: 'use', abilityId: 'r' }, { only: { abilityId: 'r' } });
  const st = applyPatches(c, { battle: c.battle!, character: c.character }, r.patches, rec);
  expect(st.battle.selfConditions[0]).toMatchObject({ tag: 'hasted', expires: 18 });
  expect(st.battle.activeBuffs[0]).toMatchObject({ abilityId: 'bless', remainingRounds: 10, expires: 60, appliedRound: 1 });
});
```

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement `compute.ts`**

```ts
import type { EvalContext } from '../context';
import { activationsOf, type Ability, type Activation, type Script } from '../schema';
import { makeApi, ScriptSkip, type RunSource, type Patch, type Trace, type RunContext } from './api';
import { Budget, ScriptTimeout } from './budget';
import { compile } from './compile';
import { diagnostics, getScriptMode } from './diagnostics';
import { newSink, type Sink } from './sink';

export type ScriptSource = RunSource & { kind: 'ability' | 'buff' | 'activation'; scripts: Script[] };

/** Every record/activation currently contributing scripts (same gating as the v3 activeSources). */
export function activeSources(ctx: EvalContext, warnings: string[] = []): ScriptSource[] {
  const out: ScriptSource[] = []; const seen = new Set<string>();
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  const push = (key: string, s: ScriptSource) => { if (!seen.has(key)) { seen.add(key); out.push(s); } };
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) { warnings.push(`Unknown ability "${inst.abilityId}" on character; ignored.`); continue; }
    if (ability.kind === 'status' || ability.kind === 'spell') continue;
    push(ability.id, { ability, instance: inst, kind: 'ability', scripts: ability.scripts, label: ability.name });
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
      push(`${ability.id}/${activation.id}`, { ability, instance, activation, kind: 'activation', scripts: [...activation.scripts, ...(spell?.kind === 'spell' ? spell.scripts : [])], label: activation.name ?? spell?.name ?? ability.name });
    } else push(ability.id, { ability, instance, kind: 'buff', scripts: ability.scripts, label: ability.name });
  }
  return out;
}

const KIND_ORDER = { feature: 0, item: 1, spell: 2, status: 3 } as const;
function ordered(sources: ScriptSource[]): { src: ScriptSource; script: Script; idx: number }[] {
  const rows = sources.flatMap((src) => src.scripts.map((script, idx) => ({ src, script, idx })));
  return rows.sort((a, b) => a.script.priority - b.script.priority || KIND_ORDER[a.src.ability.kind] - KIND_ORDER[b.src.ability.kind] || 0);
}

const budget = new Budget();
type Cache = WeakMap<object, WeakMap<object, Map<string, Sink>>>;
const cache: Cache = new WeakMap();
const NO_BATTLE = {};
const passKey = (ctx: EvalContext) => { const a = ctx.attack; return `${ctx.target?.id ?? '-'}|${a ? `${a.profile.id}:${a.modeId}:${a.index}:${a.kind}` : '-'}|${ctx.lastDamage ?? ''}`; };

/** Run every always script once for this context and collect what they contribute. Cached by identity of character, battle and the target/attack key. */
export function computePass(ctx: EvalContext): Sink {
  let byBattle = cache.get(ctx.character); if (!byBattle) { byBattle = new WeakMap(); cache.set(ctx.character, byBattle); }
  const bkey = ctx.battle ?? NO_BATTLE;
  let byKey = byBattle.get(bkey); if (!byKey) { byKey = new Map(); byBattle.set(bkey, byKey); }
  const key = passKey(ctx);
  const hit = byKey.get(key); if (hit) return hit;
  const sink = newSink();
  byKey.set(key, sink); // partial sink is visible to nested stat reads (re-entrancy)
  if (getScriptMode() === 'off') return sink;
  const warnings: string[] = [];
  const sources = activeSources(ctx, warnings);
  for (const { src, script } of ordered(sources)) {
    if (!script.events.includes('always') || !script.enabled) continue;
    runOne(ctx, { phase: 'always', source: src, script, ...(src.activation ? { activation: src.activation } : {}) }, sink, []);
  }
  return sink;
}

/** Compile (or synthesize from `call`) and run one script; errors go to the sink and diagnostics, skips to sink.skipped. */
export function runOne(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[]): void {
  const key = `${run.source.ability.id}/${run.script.id}`;
  if (diagnostics.quarantined(key)) return;
  const fail = (phase: 'compile' | 'run', message: string, line?: number) => { const e = { recordId: run.source.ability.id, scriptId: run.script.id, label: run.script.label ?? run.source.label, phase, message, ...(line !== undefined ? { line } : {}) }; sink.errors.push(e); diagnostics.record(e); diagnostics.noteFailure(key); };
  const source = run.script.call ? callSource(ctx, run.script.call) : run.script.source;
  if (source === undefined) { fail('compile', `unknown function "${run.script.call?.fn}"`); return; }
  const compiled = compile(source);
  if (!compiled.ok) { fail('compile', compiled.error, compiled.line); return; }
  const trace: Trace = { emitted: false };
  const fns = fnTable(ctx, run, sink, patches, trace, 0);
  const api = makeApi(ctx, { ...run, fns }, sink, patches, trace);
  budget.start(run.phase === 'always' ? 4 : 16);
  try { compiled.run(api, compiled.noguard ? () => {} : budget.tick); }
  catch (e) {
    if (e instanceof ScriptSkip) { sink.skipped.push({ source: run.source.ability.id, sourceName: run.source.label, label: run.script.label ?? run.source.label, summary: '', failed: e.because }); return; }
    fail('run', e instanceof ScriptTimeout ? e.message : (e as Error).message); return;
  }
  if (run.phase === 'always' && !trace.emitted && trace.last && !trace.last.result) sink.skipped.push({ source: run.source.ability.id, sourceName: run.source.label, label: run.script.label ?? run.source.label, summary: '', failed: trace.last.text });
}

/** `fn.name({ args })`: compiled library functions sharing this run's sink, patches and budget. Depth-capped. */
export function fnTable(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[], trace: Trace, depth: number): Record<string, (args: Record<string, unknown>) => void> {
  const table: Record<string, (args: Record<string, unknown>) => void> = {};
  for (const def of Object.values(ctx.library.functions ?? {})) {
    table[def.id] = (args = {}) => {
      if (depth >= 8) throw new Error(`function call depth exceeded at ${def.id} (recursive?)`);
      const compiled = compile(def.source, def.params.map((p) => p.name));
      if (!compiled.ok) throw new Error(`function ${def.id}: ${compiled.error}`);
      const filled: Record<string, unknown> = {};
      for (const p of def.params) { const v = args[p.name] ?? p.default; if (v === undefined && p.required) throw new Error(`function ${def.id}: missing argument "${p.name}"`); filled[p.name] = v; }
      const api = makeApi(ctx, { ...run, args: filled, fns: fnTable(ctx, run, sink, patches, trace, depth + 1) }, sink, patches, trace);
      compiled.run(api, compiled.noguard ? () => {} : budget.tick);
    };
  }
  return table;
}

/** Synthesize the source for a stored function call: `fn["id"]({ a: <lit|ref|expr>, … })`. */
export function callSource(ctx: EvalContext, call: NonNullable<Script['call']>): string | undefined {
  const def = ctx.library.functions?.[call.fn]; if (!def) return undefined;
  const parts = def.params.map((p) => { const a = call.args[p.name]; if (!a) return undefined; const v = a.k === 'lit' ? JSON.stringify(a.v) : a.v; return `${p.name}: ${v}`; }).filter(Boolean);
  return `fn[${JSON.stringify(def.id)}]({ ${parts.join(', ')} });`;
}
```

- [ ] **Step 4: Implement `events.ts`**

```ts
import type { EvalContext } from '../context';
import { newId } from '../ids';
import { activationsOf, type Ability, type Battle, type Character, type Duration, type LogEvent } from '../schema';
import { type EventInfo, type Patch } from './api';
import { activeSources, runOne } from './compute';
import { newSink, type ScriptError } from './sink';
import { toRounds } from './units';

export type State = { battle: Battle; character: Character; globals?: Record<string, number | string | boolean> };

/** Run every event script whose events include this event (or `custom:<name>` for emits); emits cascade in the same call, depth ≤ 8. */
export function runEventScripts(ctx: EvalContext, event: EventInfo, opts: { only?: { abilityId: string; activationId?: string } } = {}): { patches: Patch[]; errors: ScriptError[] } {
  const all: Patch[] = []; const sink = newSink();
  const queue: EventInfo[] = [event]; let depth = 0;
  while (queue.length) {
    const ev = queue.shift()!;
    const want = ev.kind.startsWith('custom:') ? ev.kind : ev.kind;
    for (const src of activeSources(ctx)) {
      if (opts.only && ev === event && (src.ability.id !== opts.only.abilityId || (opts.only.activationId && src.activation?.id !== opts.only.activationId))) continue;
      const scripts = ev.kind === 'use' && opts.only?.activationId ? (activationsOf(src.ability).find((a) => a.id === opts.only!.activationId)?.scripts ?? []) : src.scripts;
      for (const script of scripts) {
        if (!script.enabled || !script.events.includes(want)) continue;
        const patches: Patch[] = [];
        runOne(ctx, { phase: 'event', source: src, script, event: ev, ...(src.activation ? { activation: src.activation } : {}) }, sink, patches);
        for (const p of patches) { all.push(p); if (p.k === 'emit' && depth < 8) { depth++; queue.push({ kind: `custom:${p.name}`, payload: p.payload, ...(ev.targetId ? { targetId: ev.targetId } : {}) }); } }
      }
    }
  }
  return { patches: all, errors: sink.errors };
}

const addCondition = (list: { tag: string }[], c: { tag: string; expires?: Duration; appliedRound?: number; source?: string }) => [...list.filter((x) => x.tag !== c.tag), c];

/** Apply patches immutably (a port of the v3 applyTriggered plus setVar/log/untag). Round/encounter charges live on the battle. */
export function applyPatches(ctx: EvalContext, state: State, patches: Patch[], ability: Ability, targetId?: string): State {
  let { battle, character } = state; let globals = state.globals ?? ctx.library.globals ?? {};
  const withCombatant = (id: string, fn: (c: Battle['combatants'][number]) => Battle['combatants'][number]) => { battle = { ...battle, combatants: battle.combatants.map((c) => (c.id === id ? fn(c) : c)) }; };
  for (const p of patches) {
    switch (p.k) {
      case 'tag': { const cond = { tag: p.tag, expires: p.duration, appliedRound: battle.round, source: ability.id }; if (p.to === 'self') battle = { ...battle, selfConditions: addCondition(battle.selfConditions, cond) }; else if (p.to === 'allEnemies') battle = { ...battle, combatants: battle.combatants.map((c) => ({ ...c, conditions: addCondition(c.conditions, cond) })) }; else if (targetId) withCombatant(targetId, (c) => ({ ...c, conditions: addCondition(c.conditions, cond) })); break; }
      case 'untag': if (p.to === 'self') battle = { ...battle, selfConditions: battle.selfConditions.filter((x) => x.tag !== p.tag) }; else if (targetId) withCombatant(targetId, (c) => ({ ...c, conditions: c.conditions.filter((x) => x.tag !== p.tag) })); break;
      case 'resource': ({ battle, character } = changeResource(ctx, { battle, character }, p.id, p.op === 'restore' ? -p.amount : p.amount, p.op === 'set' ? p.amount : undefined)); break;
      case 'suppress': if (!battle.suppressedAbilities.includes(p.abilityId)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, p.abilityId] }; break;
      case 'reveal': if (targetId) withCombatant(targetId, (c) => ({ ...c, revealed: true })); break;
      case 'grant': { const g = ctx.library.abilities[p.abilityId]; const dur = p.duration ?? (g && (g.kind === 'status' || g.kind === 'spell') ? g.duration : undefined); const rounds = typeof dur === 'number' ? toRounds(dur) : dur === 'thisAttack' || dur === 'untilMyNextTurn' ? 1 : undefined; if (!battle.activeBuffs.some((b) => b.abilityId === p.abilityId)) battle = { ...battle, activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId: p.abilityId, owner: 'self', suppressed: false, appliedRound: battle.round, ...(dur !== undefined ? { expires: dur } : {}), ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] }; break; }
      case 'hp': { const hp = { ...character.hp }; if (p.op === 'damage') { const t = Math.min(hp.temp, p.amount); hp.temp -= t; hp.current -= p.amount - t; } else if (p.op === 'heal') hp.current = Math.min(hp.max, hp.current + p.amount); else hp.temp = Math.max(hp.temp, p.amount); character = { ...character, hp }; break; }
      case 'setVar': if (p.name in character.vars) character = { ...character, vars: { ...character.vars, [p.name]: p.value } }; else globals = { ...globals, [p.name]: p.value }; break;
      case 'log': { const seq = (battle.log.at(-1)?.seq ?? 0) + 1; battle = { ...battle, log: [...battle.log, { id: newId('ev'), round: battle.round, seq, kind: 'note', actor: 'self', text: p.text } as LogEvent] }; break; }
      case 'emit': break;
    }
  }
  return { battle, character, globals };
}
```

`changeResource` moves out of `battle.ts` into a small shared `packages/engine/src/resources.ts` (`changeResource`, `findPer`) so both `battle.ts` and `events.ts` import it without a cycle.

`scripts/index.ts` re-exports units, paths, api types, compile, diagnostics, compute, events, sink; `packages/engine/src/index.ts` adds `export * from './scripts';`.

- [ ] **Step 5: Run** → PASS both files.

- [ ] **Step 6: Commit** — `git commit -am "Scripts: compute pass with cache, near-miss trace and quarantine; event runner with emit cascade; immutable patch application"`

---

### Task 6: Rewire resolve, battle, equipment, describe; delete conditions

**Files:**
- Modify: `packages/engine/src/resolve.ts`, `battle.ts`, `equipment.ts`, `describe.ts`, `history.ts`, `rest.ts`, `selectors.ts`, `context.ts`
- Delete: `packages/engine/src/conditions.ts`
- Test: existing engine tests updated (the `v2.test.ts`, `battle.test.ts`, `resolve.test.ts`, `undo.test.ts`, `conditions.test.ts` → scripts equivalents)

**Interfaces:**
- Produces: `resolveStat(ctx, stat)` = base entries + `sink.bonuses` for the stat (after `acVariantAccepts`) + sets/multipliers, `notes` from `sink.notes` (attack/damage only), `nearMiss` = `sink.skipped` for attack/damage, `promptsNeeded` from `sink.prompts`, `flags` = `sink.flags`; `resolveFlags(ctx)` = `computePass(ctx).flags`; `attackProfiles` uses `sink.naturals`; `listAttackModes` uses `sink.modes` filtered by `kind`; `resolveAttack` extra attacks from `sink.extraAttacks`; `availableActions` eligibility: run the activation's `always` scripts in a probe ctx with the activation treated as active (a `probeActive` flag on `RunContext` makes `active` non-null) and check `trace.emitted || !skipped`; notes from the probe sink. `battle.ts`: `runTriggers(ctx, event)` → `runEventScripts` + `applyPatches`; `logAttack` events `hit|miss|crit` (`crit` also runs `hit`); `useAbility` runs the activation's `use` scripts (explicit consumes from `resource` patches feed `payCosts`); `nextRound` runs `roundStart` (and `roundEnd` before incrementing); `logEnemyAction` runs `damaged`; durations: `durationRounds(d)` = `toRounds` for numbers; `expired()` numeric → `newRound >= from + toRounds(d)`; buffs get `appliedRound`. `equipment.ts`: `slotCapacity` from `sink.slots`; `equipItem`/`unequipItem` run `equip`/`unequip` scripts of that item (patches applied to a battle if one exists, else only character/globals). `describe.ts`: keep `nameOf`, `describeSelector`, drop `describeCondition`/`firstFailure`/`summarizeEffects`. `history.ts`: scope names `attack|round|lastRound|encounter|day`. `rest.ts`: unchanged semantics; `expires` numeric supported by `expired()`. `Library.globals` flows through `State.globals` → store (app plan).

- [ ] **Step 1: Update tests first** — port the assertions: every fixture that used `effects: [{ when, do }]` becomes `scripts: [{ source }]` with the equivalent JS (use the catalog in the spec: e.g. flaming weapon `if (attack.weapon.id === 'flaming-bow') dice('1d6', 'fire')`; Woodland Archer `if (attack.isRanged) bonus('attack', 4 * history('miss'), 'untyped', { as: 'Adjust for Range' })`; Monster Blow whileActive `if (target.isOneOf(params.types) && target.hurt >= HURT.BLOODIED) note(\`MONSTER BLOW…\`)`; helm `events: ['use'] grant('rage')`; distracting attack `events: ['hit'] target.mark('flanked', UNTIL_MY_NEXT_TURN)`). Keep every numeric expectation. `conditions.test.ts` becomes `test/scripts/predicates.test.ts` asserting the same truths through `computePass` (a script per case that `bonus('init', 1)` when the predicate holds). Run: `npx vitest run` → many FAIL.

- [ ] **Step 2: Implement** the rewiring described in Interfaces. `resolveStat` sketch:

```ts
export function resolveStat(ctx: EvalContext, stat: StatId): StatResult {
  if (inProgress.has(stat)) { /* unchanged base-only branch */ }
  inProgress.add(stat);
  try {
    const warnings: string[] = [];
    const { entries, dice } = baseEntries(ctx, stat, warnings);
    const sink = computePass(ctx);
    const bonuses: BonusEntry[] = [...entries, ...sink.bonuses.filter((b) => (b.stat === stat || ((stat === 'ac.touch' || stat === 'ac.flatFooted') && b.stat === 'ac')) && acVariantAccepts(stat, b.bonusType)).map(({ stat: _s, ...b }) => b)];
    const names: Record<string, string> = { base: 'Base' };
    for (const s of activeSources(ctx)) names[s.ability.id] = s.label;
    const sets = sink.sets.filter((s) => s.stat === stat).map((s) => s.value);
    const multiplier = sink.multipliers.filter((m) => m.stat === stat).reduce((f, m) => f * m.factor, 1);
    const stacked = stackBonuses(bonuses);
    let total = sets.length ? Math.max(...sets) : stacked.total;
    total = Math.round(total * multiplier);
    const attackLike = stat === 'attack' || stat === 'damage';
    const result: StatResult = { stat, total, entries: stacked.entries.map((e) => ({ ...e, sourceName: names[e.source] ?? e.source })), dice: stat === 'damage' ? [...dice, ...sink.dice] : dice, flags: stat === 'attack' ? sink.flags : {}, notes: attackLike ? [...new Set(sink.notes.map((n) => n.text))] : [], warnings: [...warnings, ...sink.errors.map((e) => `${e.label}: ${e.message}`)], nearMiss: attackLike ? sink.skipped : [], promptsNeeded: sink.prompts };
    if (stat === 'critRange') result.total = 21 - Math.max(1, Math.min(20, total));
    return result;
  } finally { inProgress.delete(stat); }
}
```

`battle.ts` `useAbility`: after starting the buff, `const r = runEventScripts(ctx, { kind: 'use', abilityId: ability.id, activationId: act.id, targetId }, { only: { abilityId: ability.id, activationId: act.id } }); const explicit = new Set(r.patches.filter((p) => p.k === 'resource' && p.op === 'consume').map((p) => p.id)); state = applyPatches(ctx, state, r.patches, ability, input.targetId); state = payCosts(ctx, state, act, explicit);`. `State` in battle.ts gains `globals?`; `stampUndo`/`undoRecord` diff `globals` and `character.vars` into `undo.vars` and `undoEvent` restores them. `runTriggers(ctx, kind, targetId, extra)` → `applyPatches(ctx, state, runEventScripts({...ctx, ...extra}, { kind, result, damage, targetId }).patches, …)`; keep the `crit` → also `hit` behaviour by running `hit` then `crit`.

- [ ] **Step 3: Run** — `npx vitest run` → all PASS; `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git commit -am "Engine runs scripts: resolve reads the compute sink, battle applies event patches, conditions module removed"`

---

### Task 7: Converter v3 → v4 (block printer), pack merge of functions/globals

**Files:**
- Create: `packages/engine/src/scripts/print.ts`
- Modify: `packages/engine/src/migrate.ts` (`convertToV4`, `convertPack` chains it, `convertBattle` converts `statuses` and buff/condition durations), `packages/engine/src/pack.ts` (merge `functions`, `globals`), `context.ts`
- Test: `packages/engine/test/scripts/print.test.ts`, `packages/engine/test/migrate.test.ts` (v4 cases), `packages/engine/test/pack.test.ts`

**Interfaces:**
- Produces: `printBlock(block: V3Block, phase: 'always' | 'use', ownerId: string): Script`, `printExpr(expr: string): string`, `convertToV4(a: unknown): unknown` (records with `effects`/`onUse`/`whileActive` → `scripts`; durations `{rounds:n}`→`n*6`, `{minutes:n}`→`n*60`, `thisTurn`→`6`; idempotent), `convertDurationV4(d)`.

- [ ] **Step 1: Failing tests** — for each of these v3 inputs assert the exact printed source:

| v3 | printed |
|---|---|
| PBS: `when all[compare attack.kind = ranged, compare target.distance <= 30], do modify attack 1, modify damage 1` | `if (attack.isRanged && target.within(30)) {\n  bonus('attack', 1);\n  bonus('damage', 1);\n}` |
| Rapid Shot mode verb | `attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' });` |
| Woodland adjust: `all[compare attack.kind = ranged, history miss >= 1]`, `modify attack "4 * sel(history.miss.me.current.thisRound)"` label Adjust for Range | `if (attack.isRanged) {\n  need(history('miss') >= 1, 'you missed this target this round');\n  bonus('attack', 4 * history('miss'), 'untyped', { as: 'Adjust for Range' });\n}` |
| Monster Blow whileActive: `all[in target.tags param types, compare target.hurt >= bloodied]`, note with `{damage + classLevel(monster-hunter) + wisMod}` | `if (target.isOneOf(params.types)) {\n  need(target.hurt >= HURT.BLOODIED, 'target is bloodied or worse');\n  note(\`MONSTER BLOW: on hit, Fort DC = ${player.lastDamage + player.classes['monster-hunter'] + player.mod.wis} or die.\`);\n}` |
| Boots whileActive haste block | `extraAttack(1, { base: 'full' });\nbonus('attack', 1, 'dodge');\nbonus('ac', 1, 'dodge');\nbonus('save.ref', 1, 'dodge');\nbonus('speed', 30);` |
| Hand of Glory slot | `slot('ring', 1);` |
| Potion onUse `hp heal 10` | `heal(10);` (events `['use']`) |
| Knowledge Devotion table modify (attack, damage, insight) | `const knowledge = ask('knowledge', { per: 'creatureType' });\nif (knowledge) {\n  bonus('attack', tier(knowledge, [15, 1], [25, 2], [30, 3], [35, 4], [Infinity, 5]), 'insight');\n  bonus('damage', tier(knowledge, [15, 1], [25, 2], [30, 3], [35, 4], [Infinity, 5]), 'insight');\n}` |
| `is battle.toggle.sniping` + note | `if (battle.on('sniping')) {\n  note('…');\n}` |
| `is attack.weapon.tag.longbow` + modify attack 1 | `if (attack.weapon.is('longbow')) {\n  bonus('attack', 1);\n}` |
| trigger `onHit`, `tag target flanked untilMyNextTurn` | events `['hit']`, `target.mark('flanked', UNTIL_MY_NEXT_TURN);` |
| modify with `attackKind: 'ranged'` and no condition | `if (attack.isRanged) {\n  bonus('attack', 1);\n}` |

Plus: `printExpr('max(2, 2 * sel(self.equipped.count.tag.trophy-aberration))')` → `max(2, 2 * player.equipped.tag['trophy-aberration'])`; `printExpr('4 * trophyMultiplier')` → `4 * vars.trophyMultiplier`; `printExpr('favoredEnemyBonus1')` → `vars.favoredEnemyBonus1`. `convertToV4` idempotency and `convertPack` over `packs/memento.json` at git base `57b1f07`'s v3 shape producing records with no `effects` key.

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement `print.ts`** — rules:
  - Condition leaf → traced form when available: `{is:'target.tag.X'}`/`{is:'target.condition.X'}` → `target.is('X')`; `{is:'self.tag.X'}` → `player.is('X')`; `{is:'attack.weapon.tag.X'}` → `attack.weapon.is('X')`; `{is:'battle.toggle.X'}` → `battle.on('X')`; `{is:'self.equipped.item.X'}` → `player.wearing('X')`; `{is:'attack.isFirstThisRound'}` → `attack.isFirstThisRound`; `{compare:'attack.kind','=',ranged|melee}` → `attack.isRanged|isMelee`; `{compare:'target.distance','<=',n}` → `target.within(n)`; `{in:'target.tags',param:p}` → `target.isOneOf(params.p)`; `{in:'target.tags',set}` → `target.is([...])`. Everything else → untraced JS (`compare` → `<path> <op> <value>` with `HURT.*`/`SIZE.*` for ordinals, `'='`→`===`, `'!='`→`!==`; `exists` → `<path> !== undefined`; `history` → `history('ev', {...}) >= n` with defaults omitted; `all`/`any`/`none`/`not`/`count` → `&&`/`||`/`!(…)`/`[…].filter(Boolean).length >= n`).
  - Top-level `all`: traced members join the `if (...)` test; untraced members become `need(<js>, '<describeCondition v3 text>')` lines inside the block (the v3 describer is copied into `print.ts` as `describeV3` since `describe.ts` loses it). Non-`all` root: whole condition as one `if`, untraced.
  - Verbs: `modify` → `bonus(stat, value[, type][, { as }])` (type omitted when untyped and no label; `mode:'set'` → `setStat`, `'multiply'` → `scale`; table value → the `ask`/`tier` form, the `const` named after the prompt id); `dice` → `dice('1d6', type?)`; `flag` → `flag(name)`/`flag(name, false)`; `note` → `note(text)` with `{expr}` → `${printExpr(expr)}` template literal and `dc` appended as ` (DC ${…})`; `attack` → `attackMode`/`extraAttack`/`naturalAttack`; `slot` → `slot`; `tag` → `target.mark`/`condition('self', …)`/`condition('allEnemies', …)`; `grant` → `grant`; `suppress` → `suppress`; `resource` → `charges(id).use|restore|set(n)`; `hp` → `heal|hurt|temp`; `reveal` → `target.reveal()`; `prompt` → `ask(id, { per })`.
  - `attackKind` on modify/dice adds `attack.isRanged/isMelee` to the `if`.
  - Durations printed as `n * ROUND` / `n * MINUTE` / sentinel constant names.
  - Block `label` → script `label`; `trigger` → events (`always`→`['always']`, `onHit`→`['hit']`, …); activation `onUse` → `['use']`, `whileActive` → `['always']`.
  - `printExpr`: tokenise identifiers; `strMod…chaMod`→`player.mod.x`; `level`/`bab`→`player.*`; `round`→`battle.round`; `damage`→`player.lastDamage`; `classLevel(x)`→`player.classes['x']`; `prompt(x)`→`battle.prompts.x`; `sel(history.a.b.c.d)`→`history('a', {by,vs,since})` (omit defaults); `sel(self.equipped.count.tag.X)`→`player.equipped.tag['X']`; other `sel(...)` → `sel('...')`; known functions `floor/min/max` unchanged; other bare identifiers → `vars.name`.
  - `migrate.ts`: `convertToV4(a)` = if `scripts` present → return; else map `effects` → `scripts`, activations `onUse`+`whileActive` → `scripts`, `duration` fields via `convertDurationV4`, status `duration` likewise; `convertToV3` chains it; `convertBattle` converts `statuses` and each `activeBuffs[].expires` / condition `expires`.
  - `pack.ts`: merge `functions` (`put('function', lib.functions, f)`) and `globals` (incoming keys added, existing kept); `libraryToPack` exports both; `emptyLibrary` includes them.

- [ ] **Step 4: Run** — print/migrate/pack tests PASS; whole suite PASS.

- [ ] **Step 5: Commit** — `git commit -am "Converter v3→v4: blocks print to scripts with traced predicates; packs carry functions and globals"`

---

### Task 8: Golden test, packs regenerated, validator

**Files:**
- Create: `packages/engine/test/golden.test.ts`
- Modify: `tools/gen-core-pack.ts`, `tools/gen-memento-pack.ts` (versions core 4, memento 12; add the three library functions `haste`, `trophy`, `favoredEnemy` to the memento pack's `functions` and rewrite `chuul-gloves`/`gargoyle-bracers`/`shield-amulet`/`favored-enemy-1/2`/`haste`/`boots-of-speed` to call them), `tools/pack-validate.ts` (every script compiles; `call.fn` exists with required args; `fn.<id>` references exist; `params.<x>` used in a script is declared on the record; `events` custom names emitted somewhere or noted), `docs/RULES-FORMAT.md` (v4 API reference; the helper table from the spec)
- Regenerate `packs/*.json`

- [ ] **Step 1: Golden test**

```ts
// packages/engine/test/golden.test.ts — the v4 engine must reproduce the v3 numbers captured in Task 0.
import { readFileSync } from 'node:fs';
import { PackSchema, emptyLibrary, mergePack, resolveAttack, resolveStat, attackProfiles, listAttackModes, availableActions, logAttack, newBattle, addCombatant, setDistance, type EvalContext } from '../src';
const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-v3.json', import.meta.url), 'utf8'));
let lib = emptyLibrary();
for (const f of ['core-3.5e', 'memento']) lib = mergePack(lib, PackSchema.parse(JSON.parse(readFileSync(new URL(`../../../packs/${f}.json`, import.meta.url), 'utf8')))).library;
const ch = (lib as { characters?: Record<string, EvalContext['character']> }).characters!['memento']!;
for (const sc of golden.scenarios) test(`golden: ${sc.name}`, () => {
  let ctx: EvalContext = { character: ch, library: lib };
  if (sc.tags) { let battle = addCombatant(newBattle('g'), { name: 'T', tags: sc.tags, size: 'large' }); if (sc.distance !== undefined) battle = setDistance(battle, battle.combatants[0]!.id, sc.distance); ctx = { ...ctx, battle, target: battle.combatants[0] }; for (let i = 0; i < (sc.misses ?? 0); i++) { const r = logAttack(ctx, { targetId: ctx.target!.id, profileId: 'weapon:strong-arm-composite-longbow-1', modeId: 'full', attackIndex: i + 1, result: 'miss' }); ctx = { ...ctx, battle: r.battle, character: r.character, target: r.battle.combatants[0] }; } }
  const results = attackProfiles(ctx).flatMap((p) => listAttackModes(ctx, p.id).map((m) => { const r = resolveAttack(ctx, { profileId: p.id, modeId: m.modeId }); return { profileId: p.id, modeId: m.modeId, attacks: r.attacks.map((a) => ({ attackBonus: a.attackBonus, damageFlat: a.damage.flat, damageDice: a.damage.dice.map((d) => d.dice), critRange: a.critRange, critMult: a.critMult })) }; }));
  expect(results).toEqual(sc.results);
  expect(Object.fromEntries(Object.keys(sc.stats).map((s) => [s, resolveStat(ctx, s).total]))).toEqual(sc.stats);
  expect(availableActions(ctx).map((a) => ({ activationId: a.activationId, usable: a.usable, eligible: a.eligible }))).toEqual(sc.actions);
});
```

- [ ] **Step 2: Regenerate packs, run validator and golden** — `npx tsx tools/gen-core-pack.ts && npx tsx tools/gen-memento-pack.ts && npm run validate-packs && (cd packages/engine && npx vitest run)`. Expected: 0 problems; golden PASS. Spot-check `packs/memento.json`: `grep -c '"effects"' → 0`, `woodland-archer` script text contains `history('miss')`.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "Packs in rules v4: scripts, three library functions; validator compiles scripts; golden test proves v3 numbers are preserved; RULES-FORMAT is the API reference"`

---

## Self-review notes

- Spec coverage: units/enums (T1), paths and long-press catalog (T1 `PATHS`), scripts with event lists (T2), frozen always phase (T3 `proxy` set trap + `freeze`), helpers incl. `history`, `ask`/`tier`, `active` counter (T3 `activeInfo`), loop guard + `@noguard` + budgets (T4), safe mode switch (T4; the app wires the URL/localStorage in its plan), quarantine (T4/T5), compute cache and re-entrancy (T5), events/patches/emit cascade/undo of vars (T5/T6), functions with typed params and call form (T2/T5), globals (T2/T5/T7), converter with traced predicates and `need` fallback (T7), packs and validator (T8), golden behaviour test (T0/T8). App UI (CodeMirror, tabs, long-press, import confirmation, safe-mode banner) is the follow-up plan.
- Type consistency: `Sink`, `Patch`, `RunContext`, `RunSource`, `EventInfo`, `Trace`, `ScriptError`, `computePass`, `runEventScripts`, `applyPatches`, `activeInfo`, `API_NAMES`, `toRounds`, `pathToSelector` names are used identically across tasks. `AttackMode.kind` and `ActiveBuff.appliedRound` are added in T2/T3 and consumed in T6.
- Known limitation stated: the guard cannot stop non-loop hangs; `new Function` is not a sandbox (import confirmation is the app plan's job).
