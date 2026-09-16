# Dungeon Ledger: scripts instead of blocks (rules format v4)

## Context

Dungeon Ledger is a fork of Hunter's Ledger (repo `ZeAnswer/DungeonLedger`, local `/Users/zeanswer/Claude/Projects/DungeonLedger`, created 2026-09-16 with full history and the app renamed). The block builder (condition tree + verb list per effect block) is too noisy. The user wants effects written as **plain JavaScript** with a small helper vocabulary, attached to events, reading and writing app values by **path** (`player.stats.int`), with **persistent global vars**, a **function library** with typed parameters that can be invoked as a form, **long-press anywhere reveals the path**, and Globals / Functions tabs. Existing block effects convert one-time to script text. Records, activations, charges, pools, statuses, packs, battle flow all stay.

Two design passes were done: a runtime design (phases, API, execution, schema, converter, functions) and a catalog of all 46 authored blocks (80 verbs) rewritten as snippets. Findings that shape the plan:

- The engine already splits verbs by phase: `modify/dice/flag/note/attack/slot/prompt` only act during resolution; `tag/grant/suppress/resource/hp/reveal` only act on triggers (`resolve.ts relevantToStat`, `battle.ts applyTriggered`). So two script phases: **compute** (pure, re-run every render) and **event** (mutates via patches).
- 62 of 80 verbs are `modify`. With `bonus(stat | stats[], n, type?)` the two packs' 1,073 lines of block JSON become about 60 lines of JS. 25 blocks are one helper call; 18 need one `if`; 1 needs a real body.
- The features that depend on blocks being data must be preserved: the battle screen's "Not applying: X — needs Y" list (`describe.ts firstFailure`), toggle-chip discovery (`hooks.ts collectToggles`), the breakdown labels, and prompt requests (Knowledge check chip).
- `acorn` is already in the lockfile (vite dependency); ~20 KB gzip when bundled. Source instrumentation gives the loop guard and free static scans (toggles used, events emitted).

## Design (decided)

### Script model

A record's `effects` and an activation's `onUse`/`whileActive` become `scripts: Script[]`:

```ts
Script = { id, label?, events: ('always' | 'hit' | 'miss' | 'crit' | 'damaged' | 'roundStart' | 'roundEnd' | 'use' | 'equip' | 'unequip' | `custom:<name>`)[], source, call?, enabled, priority }
```

The events are a **multi-select list beside the code**, not a registration in the body (a script may run on several events; `always` is the compute phase and cannot be combined with event entries) (the engine must pick relevant scripts without executing them; closures over immutable state would go stale). `whileActive` scripts are `compute` scripts on the activation, active only while its buff runs (same gating as today in `activeSources`). `emit('name', payload)` in an event script wakes scripts with `event: 'custom', eventName: 'name'`; cascades drain inside the same state transition so one undo record covers them.

### Rules that keep *always* scripts safe

- *Always* scripts run on every refresh, so they must never change state. In that phase every object is frozen: `player.mod.cha += 1` throws "read-only in an always script; use bonus('ability.cha', 1)" and shows on the record. State changes only happen in event scripts, once per event, through helpers (`heal`, `charges().use`, `setVar`, `target.mark`…). Assignment to `vars.x` is allowed only in event scripts.
- Events fire once per occurrence; an event script that runs twice for one hit is an engine bug, not a script concern.

### Enums and units instead of strings

- `SIZE.FINE … SIZE.COLOSSAL` and `HURT.UNHURT / SCRATCHED / BLOODIED / NEAR_DEATH` are numbers; `target.size >= SIZE.LARGE`, `target.hurt >= HURT.BLOODIED` work with normal operators. `target.type` stays a tag string (open set).
- Bonus types and stats stay strings (validated at runtime, completion offers them), with constants available too: `BONUS.DODGE`, `STAT.ATTACK`.
- Time is a number of seconds: `SECOND = 1`, `ROUND = 6 * SECOND` (3.5e), `MINUTE = 10 * ROUND`, `HOUR`, `DAY`. Durations are numbers (`3 * ROUND`, `50 * MINUTE`, `8 * HOUR`) plus four non-numeric sentinels: `THIS_ATTACK`, `UNTIL_MY_NEXT_TURN`, `ENCOUNTER`, `UNTIL_REMOVED`. The engine converts seconds to rounds in battle (`ceil(seconds / ROUND)`). Long rest = `8 * HOUR`, short rest = `1 * HOUR`; rests advance battle-free time so `minutes`-long buffs expire correctly.
- Every active buff/activation exposes a counter: `player.active('bless')` → `null` or `{ round: 2, elapsed: 6, remaining: 48 }` (nth round active, seconds elapsed, seconds left). Inside a while-active script the own activation is `active` (`if (active.round >= 2) bonus('attack', 2)`). `battle.round`, `battle.elapsed` (seconds since battle start) likewise.
- Clear names: `attack.isRanged`, `attack.isMelee`, `attack.isFirstThisRound`.

### Helper vocabulary (the "globals")

Ambient objects, null-safe (no `?.` needed):

- `player` (alias `self`): `.level .bab .size .hp.{current,max,temp,nonlethal} .stats.<stat> .mod.<str…cha> .skills.<id>.{ranks,total,classSkill} .classes.<id> .tags .is(tag) .has(recordId) .active(id) .left(poolId) .wearing(itemId) .equipped.{slot,category,tag}.<k> .params.<name> .lastDamage`
- `target`: `.exists .name .type .size (SIZE.*) .hurt (HURT.*) .distance .revealed .dead .tags .is(tag|tags[]) .isOneOf(tags[]) .within(ft)` and, event phase, `.mark(tag, duration) .unmark(tag) .reveal()`
- `attack`: `.exists .isRanged .isMelee .kind .index .isFirstThisRound .mode .weapon.{id,category,tags} .weapon.is(tag)`
- `battle`: `.exists .round .tags .on(toggleId) .is(envTag) .prompts.<id>`
- `vars.<name>` (character var, else global), `flags.<name>`, `event.{kind,result,damage,targetId,abilityId,activationId,payload}` (event phase), `params.<name>` (this record's choices), `args` (inside a function), `fn.<name>(…)`

Compute helpers: `bonus(stat|stats[], n, type = 'untyped', { as })`, `penalty(...)`, `setStat`, `scale`, `dice('1d6', damageType?)`, `flag(name)`, `note(text)` (template literals replace `{expr}` and `dc`), `slot(slot, n)`, `attackMode({ id, label, base, extra, penalty, kind, note })`, `extraAttack(n, { base })`, `naturalAttack({...})`, `ask(promptId, { per, remember })` → number or 0 (registers the prompt chip when unanswered), `tier(value, [upTo, result]…)`, `history(event, { by, vs, since, ability, category })` → count.

Event helpers: `condition(who, tag, duration)` / `target.mark`, `grant(id, duration?)`, `suppress(id)`, `charges(id).{use,restore,set,left}`, `heal(n)`, `hurt(n)`, `temp(n)`, `reveal()`, `setVar(name, v)`, `log(text)`, `emit(name, payload?)`.

Control: `need(cond, because?)` (explicit skip with reason); time units `SECOND ROUND MINUTE HOUR DAY`; sentinels `THIS_ATTACK`, `UNTIL_MY_NEXT_TURN`, `ENCOUNTER`, `UNTIL_REMOVED`; enums `SIZE`, `HURT`, `BONUS`, `STAT`. Math: `mod(score)`, `floor`, `ceil`, `round`, `abs`, `min`, `max`, `clamp`. `Math`, `Date`, `fetch`, `localStorage` are not in scope (documented, not sandboxed — see Trust).

Compute helpers throw in event scripts and vice versa, with a clear message.

### "Not applying" preservation — traced predicates

Predicates (`target.is`, `target.within`, `attack.ranged`, `battle.on`, `player.wearing`, `history(...) >= n` via a `history.atLeast` helper, …) record `{ text, result }` into a per-run trace. If a compute script ends without emitting anything, the last false predicate becomes the "needs …" reason, so plain `if (attack.ranged && target.within(30)) bonus(['attack','damage'], 1)` produces "needs target within 30 ft" with no ceremony. `need(cond, 'why')` remains for explicit reasons. Raw comparisons (`target.distance <= 30`) still run but give a generic reason; the editor's completion steers toward the predicates. Library preview: probe-run with every predicate forced true and list what was emitted.

### Execution

- `new Function('api', src)` with a destructuring preamble; compiled once per source (Map cache).
- **Loop guard**: parse with `acorn`, splice `__g()` into every loop body and function body; `__g` throws after 4 ms (compute) / 16 ms (event) or 2M ops. `// @noguard` at the top of a script or function disables it for that one. Constructs without a loop (huge array spread, catastrophic regex) escape the guard; documented.
- Errors: compile errors and runtime throws are caught, recorded in a diagnostics registry (never in packs), shown as a red badge on the record and in the editor; a compute script failing 3 times is quarantined for the session.
- **Safe mode**: `?safe=1` or `localStorage hl.safeMode` disables all scripts at boot; base values still resolve; a banner offers to turn them back on. Auto-trips if the compute pass itself throws twice at boot.
- **Compute pass**: run every active compute script once per (character, battle, target, attack) into a sink (bonuses by stat, dice, flags, notes, modes, extra attacks, naturals, slots, prompts, skipped/near-miss, errors); `resolveStat`, `resolveFlags`, `listAttackModes`, `slotCapacity`, `attackProfiles` read the sink. Memoized by object identity (store replaces objects wholesale). Removes the `flagsDepth` hack. Ordering: `priority` ascending, then kind, then source order (character abilities in sheet order, then active buffs); a compute script reading a stat sees contributions of scripts that ran before it (same as today's effective-score behaviour).
- **Event pass**: helpers append patches; `applyPatches` replaces `applyTriggered`; `stampUndo` unchanged; `undo` gains `vars` so `setVar` is undoable.

### Persistence

- `Character.vars` widens to `number | string | boolean`; new `globals` store (`hl.globals`, exported in backups, importable in packs). Read `vars.x`: character first, then global; new keys from `setVar` go to globals; Globals tab warns on shadowing.
- `Library.functions`, `Pack.functions`: `FunctionDef = { id, name, description?, params: { name, type, label?, default?, required }[], source }`; param types `number | string | bool | dice | path | ref | stat | bonusType | duration | tag | tags | recordId | event`.
- A "call" effect is stored structured: `script.call = { fn, args: { name: { k: 'lit'|'ref'|'expr', v } } }`, compiled to `fn[id]({ ... })`. Round-trips through the form; the Library can answer "who calls this function".
- Migration: `convertToV3` gains a v3→v4 hop (block printer). Idempotent; old packs, stored library and stored battles keep loading. Schema drops `EffectBlock/Effect/Condition/Trigger/Selector` schemas; `StatId` and `BonusType` stay and validate helper arguments at runtime.

### Block → script printer (converter)

- Top-level `all` members → chained inside one `if (...)` using traced predicates where a predicate exists, else `need(<js>, '<describeCondition text>')` so converted packs keep byte-identical near-miss strings.
- Verbs → helpers; `attackKind` on modify/dice → `attack.ranged/melee` guard; `mode` verb → `attackMode({ …, kind })` (kind inside the mode so probe passes work).
- Expressions: `strMod`→`player.mod.str`, `classLevel(x)`→`player.classes.x`, `sel(history.miss.me.current.thisRound)`→`history('miss')`, bare vars→`vars.name`, note `{expr}`→template literal.
- Golden test: every record in all three packs, converted → compiled → run against fixture contexts, sink equals the pre-migration `collectEffects` output. This is the gate for deleting the block code.
- Ships with three library functions extracted from the catalog: `haste()`, `trophy(stat, base, type)`, `favoredEnemy(types, amount)`.

### UI

- **Library editor**: CodeMirror (JS mode, dark theme) per script with event dropdown, label, enabled toggle, error line highlighting, completion from a generated API list, snippet palette seeded with the catalog patterns, live preview (emitted rows + predicates consulted); "call a function" alternative renders the typed-param form with an ƒx toggle to raw expression per box. The block editors (`BlocksEditor`, `ConditionEditor`, `EffectEditor`, `SelectorPicker`'s condition role) are deleted after the golden test passes.
- **Long-press path reveal**: on stats, skills, HP, ability scores, charges, items, toggles, prompts: a toast with the path (`player.skills.spot.total`) and a Copy button; a shared `usePathLongPress(path)` hook.
- **Globals tab** in Library: key, value, type; add/edit/delete; shadowing warning.
- **Functions tab** in Library: list, editor (name, description, params table, CodeMirror body), "used by" list.
- **Pack import** confirmation when a pack carries scripts or functions ("runs as code").
- **Safe-mode banner** and a Settings toggle.

### Trust

`new Function` is not a security boundary. Threat model: the user's own device, own rules. Same trust as today's imported packs, now explicit at import time.

## Build order (each step green before the next)

1. `packages/engine/src/scripts/`: `paths.ts` (path ↔ selector, `describePath`), `api.ts` (façade + helpers + trace), `sink.ts`, `compute.ts` (`computePass`, cache), `compile.ts` + `instrument.ts` + `budget.ts` + `diagnostics.ts` + safe mode; unit tests for each helper, guard, and error paths. Old engine untouched.
2. Schema: `ScriptSchema`, `FunctionDefSchema`, `globals`, `undo.vars`, widened `vars`; converter hop + block printer + golden test over all packs.
3. Rewire `resolve.ts`, `equipment.ts`, `battle.ts` (`applyPatches`, `runTriggers`, `useAbility`, `emit` cascade) onto the sink/patches; delete `conditions.ts`, block half of `describe.ts`, `flagsDepth`; engine suite green; regenerate packs (generators emit v4 via the converter, then hand-tidy `manyshot` and `woodland-archer`).
4. App: store (`hl.globals`, diagnostics slice, safe mode boot, import confirmation), `collectToggles` from static scan, CodeMirror editor + call form, delete block editors, Globals and Functions tabs, long-press hook wired into Character/Inventory/Battle screens.
5. e2e: builder writes a script and JSON shows it; call-form effect; Globals tab; long-press toast; safe mode; battle-v2 unchanged. Docs: `RULES-FORMAT.md` becomes the API reference (generated from one source of truth used by completion).

## Verification

- Engine: `npx vitest run` from `packages/engine` (helpers, guard, converter golden files, undo of `setVar`, emit cascade).
- `npm run typecheck`, `npm run validate-packs` (validator checks scripts compile, `fn` references exist, `params.x` used in scripts are declared), `npm run build`.
- `npm run e2e`.
- Manual on phone after deploy: Woodland Archer's Adjust for Range shows +4 after a miss with the "Adjust for Range (×1)" label; Monster Blow chip; Knowledge Devotion prompt chip; long-press on Spot shows `player.skills.spot.total`.

## Critical files

- Engine: `packages/engine/src/schema.ts`, `resolve.ts`, `battle.ts`, `selectors.ts` (backing reads), `describe.ts`, `migrate.ts`, `equipment.ts`, `context.ts`, new `scripts/*`.
- App: `src/store/store.ts`, `src/store/hooks.ts`, `src/components/library/RecordEditor.tsx`, `ActivationEditor.tsx`, new `ScriptEditor.tsx`, `FunctionCallForm.tsx`, `screens/LibraryScreen.tsx` (tabs), new `GlobalsTab.tsx`, `FunctionsTab.tsx`, `src/hooks/usePathLongPress.ts`, `screens/CharacterScreen.tsx`, `InventoryScreen.tsx`, `components/battle/AttackPanel.tsx`.
- Tools: `tools/pack-validate.ts`, `tools/gen-*.ts`, `docs/RULES-FORMAT.md`.
