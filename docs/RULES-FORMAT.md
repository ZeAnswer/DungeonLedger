# Rules format (v4)

Every feat, class feature, racial trait, DM grant, item, spell, buff, condition and situational modifier is one **record** JSON document. Content lives in packs (`packs/*.json`); the shape is defined in `packages/engine/src/schema.ts`. What a record *does* is written as **scripts**: plain JavaScript with a small helper vocabulary (`packages/engine/src/scripts/api.ts`), attached to the events it runs on. Rules written in v1 (`kind`-based conditions), v2 (`origin` envelope) or v3 (effect blocks) are converted automatically on load and on import (`packages/engine/src/migrate.ts`); the v3 → v4 hop prints every block as a script (`scripts/print.ts`).

## Record kinds

`kind` is stored on the record but is never a form field: the Library tab you create the record in sets it, and each tab has its own editor.

| Kind | What it is |
|---|---|
| `feature` | Anything the character has and keeps: feats, class features, racial traits, DM-granted powers ("memories"). Scripts apply while the feature is enabled on the character. |
| `item` | A physical thing in inventory. Scripts apply while it is equipped (or while carried, slot `none`). |
| `spell` | A castable, referenced by an activation's `spell` field (wand, Hand of Glory) or cast from a class's spell pool. |
| `status` | A temporary state applied in battle from the buffs drawer: Haste, Bless, Shaken, Prone, higher ground. Scripts apply while it is active. |

Monsters, tags, skills and class tables are separate documents in the same pack, unchanged.

## Shared shape

```jsonc
{
  "id": "hand-of-glory", "name": "Hand of Glory",
  "kind": "item",                      // feature | item | spell | status
  "text": "…", "sourceRef": "DMG p.258", "todo": "open question",
  "scripts": [ /* see Scripts */ ],
  ...                                  // per-kind fields, see below
}
```

All records share `id`, `name`, `kind`, `text`, `sourceRef`, `todo` and `scripts`. Ids are one namespace: an activation's `spell`, a `cost` of kind `item`, and `grant(id)` / `suppress(id)` all point at record ids.

### Per-kind fields

| Field | feature | item | spell | status |
|---|---|---|---|---|
| `acquired`: `{ "kind": "feat" }` · `{ "kind": "class", "classId": "ranger", "level": 4 }` · `{ "kind": "race" }` · `{ "kind": "dm" }` | ✓ | | | |
| `params` — choices made at level-up (favored enemy types, Monster Killer types); read as `params.<name>` | ✓ | | | |
| `enabledByDefault` — enabled when added to a character | ✓ | | | |
| `item` — `{ category, slot, weight, price, tags, weapon }` | | ✓ | | |
| `level` (spell level, 0 and up), `castingAction`, `duration` | | | ✓ | |
| `harmful` — red chip and "condition" wording | | | | ✓ |
| `duration` — default duration when applied, in seconds | | | ✓ | ✓ |
| `activations`, `pools` | ✓ | ✓ | | |

Item categories: weapon, armor, shield, ammunition, wondrous, potion, scroll, wand, tool, trophy, material, gear. `item.slot` is a body slot id, or `none` for "active while carried"; omitted means not equippable.

### Activations

An **activation** is something the player can do with a record: a row in battle's "Abilities & charges" list with a Use button, or — when it lasts one attack or one turn — a pre-roll chip. Only features and items have them.

```jsonc
{
  "id": "boots-rounds",                          // unique across the library: it is also this activation's pool id
  "name": "Daylight",                            // optional; defaults to the spell's, then the record's name
  "action": "free",                              // free | swift | immediate | move | standard | fullRound | {minutes} | {hours}
  "charges": { "max": 10, "resetOn": "day", "label": "Haste rounds" },  // omit = at will
  "cost": [{ "kind": "charge", "resourceId": "wand-charges", "amount": 1 }],
  "duration": "untilMyNextTurn",                 // how long its `always` scripts apply; omit = instant
  "spell": "hog-daylight",                       // optional: this activation casts that library spell
  "scripts": [ /* `use` scripts run once when used; `always` scripts apply for the duration */ ]
}
```

- `charges` omitted means at will. `max` is a number or an expression (`"1 + floor(classLevel(monster-hunter) / 5)"`). An inline `charges` **is** a pool whose id is the activation id, so `player.left('<activation id>')` works and stored usage survives.
- Using an activation spends one of its own `charges`, then everything in `cost`. A `use` script that consumes the same id explicitly is not double-charged.
- `cost` kinds: `charge` (from any pool or inline charges, by `resourceId`), `hp`, `item` (decrements inventory quantity — potions), `spellSlot`, `gold`, `xp`.
- `duration` omitted = instant: the `use` scripts run and nothing lingers. With a duration, using it starts a buff keyed to `record id / activation id`, and the activation's `always` scripts apply until it expires (this is what v3 called `whileActive`).
- An activation whose duration is `thisAttack` or `untilMyNextTurn` is shown as a **declare chip** (`⚡ Monster Blow 1/1`) above the attack rows; tapping it spends the charge and starts the buff.
- `spell` makes the record grant that spell: the battle row takes the spell's name ("Daylight") with the record's name as subtext ("Hand of Glory") and keeps the activation's own charges. The spell's own scripts contribute while the activation is active.
- Eligibility ("Needs: …" under the Use button) comes from probe-running the activation's `always` scripts with the activation pretended active; `use` scripts are never probed, because they change state.

### Pools

`pools` holds named charge pools shared by several activations or records (ranger spells per day; a wand's 50 charges spent by two different spells). Most records need none, because an activation's inline `charges` already is a pool.

```jsonc
"pools": [{ "id": "wand-charges", "label": "Wand", "max": 50, "resetOn": "never" }]
```

Pool ids and activation ids share one namespace; the pack validator rejects an id already used elsewhere in the library. `resetOn` is `round | encounter | day | never`: round and encounter counters live on the battle and clear with it, day and never counters live on the character (`resourceState`).

### Durations

A duration is **a number of seconds** or one of four sentinels. In scripts use the unit constants: `3 * ROUND`, `50 * MINUTE`, `8 * HOUR` (`SECOND = 1`, `ROUND = 6`, `MINUTE = 10 * ROUND`, `HOUR = 60 * MINUTE`, `DAY = 24 * HOUR`). Sentinels: `THIS_ATTACK`, `UNTIL_MY_NEXT_TURN`, `ENCOUNTER`, `UNTIL_REMOVED` (stored as `"thisAttack"`, `"untilMyNextTurn"`, `"encounter"`, `"untilRemoved"`). Omitting the field means instant. In battle the engine converts seconds to rounds with `toRounds(s) = ceil(s / ROUND)`, minimum 1.

## Scripts

```ts
Script = {
  id: string,
  label?: string,                     // names the bonus in the breakdown and the record in "Not applying"
  events: ScriptEvent[],              // default ['always']
  source: string,                     // JavaScript
  call?: { fn: string, args: Record<string, { k: 'lit' | 'ref' | 'expr', v }> },
  enabled: boolean,                   // default true
  priority: number,                   // default 0, ascending
}
```

A script is the same shape wherever it appears: in a record's `scripts` or in an activation's. `events` is a multi-select beside the code, not a registration inside it — the engine has to pick the relevant scripts without executing them.

| Event | When it runs |
|---|---|
| `always` | The **compute phase**: re-run on every refresh, for every (character, battle, target, attack). Cannot be combined with any other event. |
| `hit` `miss` `crit` | After an attack of yours is logged with that result. |
| `damaged` | When you take damage (`event.damage`, `player.lastDamage`). |
| `roundStart` `roundEnd` | At the round boundary. |
| `use` | Once, when the owning activation is used. |
| `equip` `unequip` | When the item is equipped or removed. |
| `custom:<name>` | Woken by `emit('<name>', payload?)` from another script; cascades drain inside the same state transition, so one undo covers them. |

### always vs event phase

*Always* scripts run constantly, so they must never change state. In that phase every façade object (`player`, `target`, `attack`, `battle`, `vars`, …) is frozen **and** set-trapped: `player.mod.cha += 1` throws *"mod is read-only: use a helper (bonus, setVar, heal…) to change values"*, and the record shows the error. `vars.x = 1` throws too — assign vars with `setVar` in an event script. The compute helpers (`bonus`, `note`, `attackMode`, …) throw in event scripts, and the event helpers (`heal`, `charges().use`, `target.mark`, …) throw in always scripts, each with a message naming the phase.

Run order: `priority` ascending, then record kind (feature, item, spell, status), then sheet order. An always script that reads a stat sees what earlier scripts contributed; reading the stat it is contributing to yields the base value only (no infinite recursion).

### "Not applying: … needs …"

Predicates record `{ text, result }` into a per-run trace. If an always script contributes nothing, its last false predicate becomes the reason shown in battle — plain `if (attack.isRanged && target.within(30)) bonus(['attack','damage'], 1)` yields *"needs target within 30 ft"* with no ceremony. `need(cond, 'why')` states a reason explicitly (and stops the script). Raw comparisons (`target.distance <= 30`) work but give no reason, so prefer the predicates.

### Errors

A compile error or a throw is caught, recorded in a diagnostics registry (never written to packs), shown as a red badge on the record and in the editor. A script that fails three times is quarantined for the session and stops being retried. Probe runs (previews, eligibility) never quarantine.

## Helper vocabulary

Every name below is destructured into scope; there is no `api.` prefix. `Math`, `Date`, `fetch` and `localStorage` are deliberately out of the vocabulary (documented, not sandboxed — see Trust).

### Reading state (null-safe: no `?.` needed)

| Expression | Value |
|---|---|
| `player.level` `.bab` `.size` | number (`size` is a `SIZE.*` ordinal). `self` is an alias of `player` |
| `player.hp.current` `.max` `.temp` `.nonlethal` | number |
| `player.stats.<stat>` | resolved stat: `attack`, `damage`, `ac`, `ac.touch`, `save.will`, `init`, `speed`, `hp.max`, `critRange`, `str`…`cha` |
| `player.mod.<ability>` | ability modifier of the effective score |
| `player.skills.<id>.total` `.ranks` `.classSkill` | number / number / boolean |
| `player.classes.<id>` | class level |
| `player.tags` | my conditions |
| `player.params.<name>` (or bare `params.<name>`) | this record's chosen tags, as a list |
| `player.active(id)` | `null`, or `{ round, elapsed, remaining }` for a running status/activation (seconds) |
| `active` | the same object for the activation the script belongs to; `null` when it is not running |
| `player.left(poolId)` | charges left |
| `player.equipped.slot.<slot>` `.category.<cat>` `.tag.<tag>` | number of equipped items |
| `player.lastDamage` | damage of the hit being handled |
| `target.exists` `.name` `.type` `.size` `.hurt` `.distance` `.revealed` `.dead` `.tags` | `size`/`hurt` are `SIZE.*` / `HURT.*` ordinals; `distance` is feet |
| `attack.exists` `.kind` `.index` `.mode` `.weapon.id` `.weapon.category` `.weapon.tags` | the attack being resolved |
| `battle.exists` `.round` `.elapsed` `.tags` `.toggles.<id>` `.prompts.<id>` | `elapsed` is seconds since the battle started |
| `vars.<name>` | character var, else global |
| `flags.<name>` | flag set by a script this pass (`ignoreConcealment`, `sense.*`, …) |
| `event` | event scripts: `{ kind, result, damage, targetId, abilityId, activationId, payload }` |
| `args` | inside a function: its arguments (each parameter is also a bare name) |
| `sel('self.stat.ac')` | raw selector read, for anything without a façade |
| `nameOf(recordId)` | a record's name, for notes |

### Predicates (traced — these produce the "needs …" text)

| Predicate | Reads as |
|---|---|
| `player.is(tag \| tags[])` | "you are Shaken" |
| `player.has(recordId)` | "Point Blank Shot on sheet" |
| `player.wearing(itemId)` | "Boots of Speed equipped" |
| `target.is(tag \| tags[])` | "target is Aquatic" |
| `target.isOneOf(tags[])` | "target type is one of your chosen types" |
| `target.within(ft)` | "target within 30 ft" |
| `attack.isRanged` · `attack.isMelee` · `attack.isFirstThisRound` | "ranged attack" · "melee attack" · "first attack this round" |
| `attack.weapon.is(tag)` | "weapon is Bow" |
| `battle.on(toggleId)` · `battle.is(envTag)` | `"sniping" switched on` · "battle is Darkness" |
| `has(player \| target, tag)` | the matching line above |

### Compute helpers (`always` scripts)

| Helper | What it does |
|---|---|
| `bonus(stat \| stats[], n, type = 'untyped', { as })` | Adds a bonus. `type` is a stacking bonus type (`dodge`, `insight`, `enhancement`, `competence`, `natural`, …); `as` overrides the breakdown label |
| `penalty(stat \| stats[], n, type?, { as })` | `bonus` with the sign forced negative |
| `setStat(stat, value)` · `scale(stat, factor)` | Sets a floor value (highest wins) · multiplies the total |
| `dice('1d6', damageType?, { as })` | Extra damage dice |
| `flag(name, value = true)` | Sets a flag other rules and the UI read |
| `note(text)` | A line in the attack panel; use template literals for values |
| `slot(slot, count = 1)` | Extra equipment slots (Hand of Glory's ring) |
| `attackMode({ id, label, base, extra, penalty, kind, note })` | Adds an attack mode (Rapid Shot, Manyshot) |
| `extraAttack(n = 1, { base = 'full' \| 'single' \| 'any', kind })` | Extra attacks on the modes built from that base (`any` = every mode) |
| `naturalAttack({ name, dice, count, attackBonus })` | Adds an attack profile |
| `ask(promptId, { per, label })` | The entered check result, or `0`. When the answer is missing, the chip asking for it (and its warning) is surfaced **only on attack and damage** — like notes and near-misses — so a prompt never turns up under AC or a skill. `per: 'creatureType'` remembers one answer per target type |
| `tier(value, [upTo, result], …)` | First row the value does not exceed |
| `history(event, { by, vs, since, ability, category })` | Count of logged events: `event` ∈ hit, miss, crit, attack, used, activated, damaged, moved; `by` ∈ me, target, any (default me); `vs` ∈ current, any, sameCategory (default current); `since` ∈ attack, round, lastRound, encounter, day (default round) |

### Event helpers (every other event)

| Helper | What it does |
|---|---|
| `condition(who, tag, duration = UNTIL_REMOVED)` | `who` ∈ `'self'`, `'target'`, `'allEnemies'` |
| `target.mark(tag, duration)` · `target.unmark(tag)` · `target.reveal()` / `reveal()` | Conditions on the current target |
| `grant(recordId, duration?)` · `suppress(recordId)` | Start another record as a buff · switch one off |
| `charges(id).use(n = 1)` `.restore(n)` `.set(n)` `.left` | Spend, refund or set a pool |
| `heal(n)` · `hurt(n)` · `temp(n)` | HP |
| `setVar(name, value)` | Writes a character var (number, text or true/false); undoable |
| `log(text)` | A line in the battle log |
| `emit(name, payload?)` | Wakes every `custom:<name>` script |

### Control, math, enums, units

`need(cond, because?)` · `SECOND` `ROUND` `MINUTE` `HOUR` `DAY` · `THIS_ATTACK` `UNTIL_MY_NEXT_TURN` `ENCOUNTER` `UNTIL_REMOVED` · `SIZE.FINE…COLOSSAL` · `HURT.UNHURT / SCRATCHED / BLOODIED / NEAR_DEATH` · `BONUS.DODGE…` · `STAT.ATTACK…` · `mod(score)` `floor` `ceil` `round` `abs` `min` `max` `clamp(v, lo, hi)` · `toRounds(seconds)` · `evalExpr('strMod + 2')` (the old expression language, for pack authors who still want it).

Enums are ordinals, so ordinary comparisons work: `if (target.size >= SIZE.LARGE && target.hurt >= HURT.BLOODIED) …`.

## Functions

A pack may ship a **function library**: shared script bodies with typed parameters, editable as a form.

```jsonc
"functions": [{
  "id": "trophy", "name": "Trophy bonus", "description": "…",
  "params": [
    { "name": "stat", "type": "stat", "label": "Stat", "required": true },
    { "name": "base", "type": "number", "label": "Base bonus", "required": true },
    { "name": "type", "type": "bonusType", "label": "Bonus type", "default": "enhancement" }
  ],
  "source": "bonus(stat, base * (vars.trophyMultiplier ?? 1), type);"
}]
```

Param types: `number | string | bool | dice | path | ref | stat | bonusType | duration | tag | tags | recordId | event`. Inside the body each parameter is a bare name (and all of them are in `args`). A function sees the **calling record's** `params`, instance and trace, shares its sink, patches and budget, and may call other functions (depth 8).

Call it either way — the two are identical to the engine:

```js
fn.trophy({ stat: 'init', base: 4 });                    // in a script's source
```

```jsonc
// or stored structurally, which the editor round-trips as a form:
{ "id": "n", "events": ["always"], "call": { "fn": "trophy",
  "args": { "stat": { "k": "lit", "v": "ac" }, "base": { "k": "expr", "v": "2 + 2" },
            "types": { "k": "ref", "v": "params.types" } } } }
```

`k: 'lit'` is a literal value, `ref` a path, `expr` a JavaScript expression; both are spliced into `fn["trophy"]({ … })` before compiling.

**Where a function may live.** Functions merge into one library namespace, but a pack has to work when it is the only one installed alongside core, so a record may only call a function defined in **its own pack** or in **`core-3.5e`**; the validator rejects anything else. The bundled functions are `haste()` and `favoredEnemy({ types, amount })` in `packs/core-3.5e.json` (core records call them) and `trophy({ stat, base, type })` in `packs/memento.json` (only Monster Hunter trophies use it).

## Globals

`Pack.globals` (and the app's `hl.globals` store) hold values shared by every character: `vars.<name>` reads the character's var first, then the global. `setVar` writes the character's var when it has one, otherwise the global. The Globals tab warns when a character var shadows a global.

## The loop guard, budgets and `// @noguard`

Every script is parsed with acorn and a `__g()` tick is spliced into every loop body and function body. The tick throws `ScriptTimeout` after **4 ms** (always scripts) or **16 ms** (event scripts), or after 2,000,000 operations. A script (or function) whose source contains `// @noguard` runs unguarded — for the rare deliberate heavy loop. Known limitation: code that hangs without a loop (a catastrophic regex, a huge array spread) is not stopped by the guard.

## Safe mode

`setScriptMode('off')` disables every script: base values still resolve, the compute pass returns an empty sink, and the app shows a banner offering to switch back on (wired to `?safe=1` / `localStorage hl.safeMode`). Use it to recover from a pack whose scripts break the screen.

## Trust

`new Function` is not a security boundary. The threat model is the user's own device and their own rules; importing a pack with scripts or functions asks for confirmation ("runs as code"). Nothing more is claimed.

## Converted from v3

The converter is mechanical and idempotent, so a v3 (or v2, or v1) pack can simply be dropped in. Blocks become scripts one for one, keeping their `id` and `label`.

| v3 | v4 |
|---|---|
| `effects: [block]` on a record | `scripts: [script]` on the record |
| `activation.onUse` / `activation.whileActive` | `activation.scripts` with `events: ['use']` / `['always']` |
| `trigger: always \| onHit \| onMiss \| onCrit \| onDamaged \| onRoundStart \| onRoundEnd` | `events: ['always' \| 'hit' \| 'miss' \| 'crit' \| 'damaged' \| 'roundStart' \| 'roundEnd']` |
| `when` tree | one `if (…)` using traced predicates, or `need(<js>, '<the v3 reason text>')` where no predicate exists — so the "needs …" strings stay identical |
| `modify` (`mode` add / set / multiply) | `bonus(stat, v, type)` / `setStat(stat, v)` / `scale(stat, v)` |
| `modify` with a prompt table | `const knowledge = ask('knowledge', { per: … })` plus `bonus(stat, tier(knowledge, [15, 1], …), type)` |
| `dice`, `flag`, `note`, `slot`, `reveal` | `dice(…)`, `flag(…)`, `note(…)`, `slot(…)`, `target.reveal()` |
| `tag` to target / self | `target.mark(tag, duration)` / `condition('self', tag, duration)` |
| `grant`, `suppress`, `hp`, `prompt` | `grant(id, duration?)`, `suppress(id)`, `heal`/`hurt`/`temp`, `ask(id, { per })` |
| `resource` (consume / restore / set) | `charges(id).use(n)` / `.restore(n)` / `.set(n)` |
| `attack` with `mode` / `naturalAttack` / bare | `attackMode({ … })` / `naturalAttack({ … })` / `extraAttack(n, { base, kind })` |
| `attackKind` on a verb | an `attack.isRanged` / `attack.isMelee` guard around it |
| `strMod`, `classLevel(x)`, `sel(history.miss.me.current.thisRound)`, bare var names | `player.mod.str`, `player.classes.x`, `history('miss')`, `vars.name` |
| `{ "rounds": 10 }`, `endOfRound`, `{ "minutes": 50 }` | `60`, `"untilMyNextTurn"`, `3000` (seconds) |
| Selectors (`self.stat.ac`, `target.tag.x`, `battle.toggle.y`) | Paths (`player.stats.ac`, `target.is('x')`, `battle.on('y')`) — the table lives in `scripts/paths.ts` and is also what long-press reveals |

Two records as the converter prints them:

**Point Blank Shot** (`packs/core-3.5e.json`) — v3: a block with `when: { all: [ { compare: 'attack.kind', op: '=', value: 'ranged' }, { compare: 'target.distance', op: '<=', value: 30 } ] }` and two `modify` verbs. v4:

```js
if (attack.isRanged && target.within(30)) {
  bonus('attack', 1);
  bonus('damage', 1);
}
```

**Woodland Archer** (`packs/memento.json`) — three blocks, three scripts; the second keeps the v3 near-miss text through `need`:

```js
// Adjust for Range
if (attack.isRanged) {
  need(history('miss') >= 1, 'you missed this target this round');
  bonus('attack', 4 * history('miss'));
}
```

```js
// Pierce the Foliage
if (attack.isRanged && target.is('concealed')) {
  need(history('hit', { since: 'lastRound' }) >= 1, 'you hit this target last round');
  flag('ignoreConcealment');
  note(`Pierce the Foliage: ignore this foe's concealment miss chance this round.`);
}
```

```js
// Moving Sniper
if (battle.on('sniping')) {
  note('Moving Sniper: after a hit while sniping, take one move action before re-hiding.');
}
```

## Worked examples

**Monster Blow** — feature with one activation `{ id: "monster-blow", action: "free", charges: { max: "1 + floor(classLevel(monster-hunter) / 5) + …", resetOn: "day" }, duration: "thisAttack" }`, so battle shows it as a `⚡` chip. Its `always` script is the declaration's gate, and its `use` script spends the charge:

```js
if (target.isOneOf(params.types)) {
  need(target.hurt >= HURT.BLOODIED, 'target is bloodied or worse');
  note(`MONSTER BLOW: on hit, Fort DC = damage + ${player.classes['monster-hunter'] + player.mod.wis} or die.`);
}
```

```js
charges('monster-blow').use();   // events: ['use']
```

**Boots of Speed** — item, feet slot, one activation `{ id: "boots-rounds", action: "free", charges: { max: 10, resetOn: "day" }, duration: "untilMyNextTurn" }` whose `always` script is `fn.haste();`. Use spends one haste round and applies haste until your next turn.

**Favored Enemy** — feature with `params: { types: { kind: "tags", category: "creatureType", count: 1 } }`; one script, `fn.favoredEnemy({ types: params.types, amount: vars.favoredEnemyBonus1 });`. The bonus lives in a character var so the DM can change it without editing the record.

**Distracting Attack** — feature, one script with `events: ['hit']`: `target.mark('flanked', UNTIL_MY_NEXT_TURN);`.

**Rapid Shot** — feature, one always script: `attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' });`.

**Hand of Glory** — item, neck slot. One always script `slot('ring', 1);` while equipped, plus two activations (`hog-daylight`, `hog-see-invisibility`), each `charges: { max: 1, resetOn: "day" }` with `spell` pointing at the matching spell record.

**Ranger Spells** — feature with one activation `{ id: "ranger-spell-1", charges: { max: "rangerSpells1", resetOn: "day", label: "1st-level spells" } }`: the charges expression reads a character var.

## Validation

`npm run validate-packs` checks every pack: schema, cross-references (abilities, tags, skills, classes, monsters), unique activation and pool ids, every script and function source compiling, `fn.<id>` and `call.fn` resolving — within the calling pack or `core-3.5e` — with their required arguments, `params.<x>` declared on the record that reads it, and every stat and attack mode resolving for each bundled character. A `custom:<name>` nobody emits is a warning, not an error. Tag, skill and stat ids written *inside* a script are not statically checked: they are ordinary strings the engine validates when the script runs.
