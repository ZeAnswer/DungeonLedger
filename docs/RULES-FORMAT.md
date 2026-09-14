# Rules format (v3)

Every feat, class feature, racial trait, DM grant, item, spell, buff, condition and situational modifier is one **record** JSON document. Content lives in packs (`packs/*.json`); the shape is defined in `packages/engine/src/schema.ts`. Rules written in the older v1 (`kind`-based conditions) or v2 (`origin` envelope) formats are converted automatically on load and on import (`packages/engine/src/migrate.ts`).

## Record kinds

`kind` replaces v2's eleven-value `origin`. It is stored on the record, but is never a form field: the Library tab you create the record in sets it, and each tab has its own editor.

| Kind | Replaces | What it is |
|---|---|---|
| `feature` | feat, classFeature, race, memory, core | Anything the character has and keeps: feats, class features, racial traits, DM-granted powers ("memories"). Effects apply while the feature is enabled on the character. |
| `item` | item | A physical thing in inventory. Effects apply while it is equipped (or while carried, slot `none`). |
| `spell` | spell | A castable, referenced by an activation's `spell` field (wand, Hand of Glory) or cast from a class's spell pool. |
| `status` | buff, condition, situational | A temporary state applied in battle from the buffs drawer: Haste, Bless, Shaken, Prone, higher ground. Effects apply while it is active. |

Monsters, tags, skills and class tables are separate documents in the same pack, unchanged.

## Shared shape

```jsonc
{
  "id": "hand-of-glory", "name": "Hand of Glory",
  "kind": "item",                      // feature | item | spell | status
  "text": "…", "sourceRef": "DMG p.258", "todo": "open question",
  "effects": [ /* blocks that apply on their own, see Blocks */ ],
  ...                                  // per-kind fields, see below
}
```

All records share `id`, `name`, `kind`, `text`, `sourceRef`, `todo` and `effects`. Ids are one namespace: an activation's `spell`, a `cost` of kind `item`, and the `grant`/`suppress` verbs all point at record ids.

### Per-kind fields

| Field | feature | item | spell | status |
|---|---|---|---|---|
| `acquired`: `{ "kind": "feat" }` · `{ "kind": "class", "classId": "ranger", "level": 4 }` · `{ "kind": "race" }` · `{ "kind": "dm" }` | ✓ | | | |
| `params` — choices made at level-up (favored enemy types, Monster Killer types) | ✓ | | | |
| `enabledByDefault` — enabled when added to a character | ✓ | | | |
| `item` — `{ category, slot, weight, price, tags, weapon }` | | ✓ | | |
| `level` (spell level, 0 and up), `castingAction`, `duration` | | | ✓ | |
| `harmful` — red chip and "condition" wording | | | | ✓ |
| `duration` — default duration when applied | | | ✓ | ✓ |
| `activations`, `pools` | ✓ | ✓ | | |

`acquired` replaces v2's `origin` split plus `classId`/`classLevel`, and is what the level ledger counts (feats chosen = `acquired.kind === 'feat'`; class features = `acquired.class` matching that class). Item categories: weapon, armor, shield, ammunition, wondrous, potion, scroll, wand, tool, trophy, material, gear. `item.slot` is a body slot id, or `none` for "active while carried"; omitted means not equippable.

### Activations

An **activation** is something the player can do with a record: a row in battle's "Abilities & charges" list with a Use button, or — when it lasts one attack or one turn — a pre-roll chip. Only features and items have them. It replaces v2's `activation` enum, `cost`, `duration`, `grants` and the `onUse`/`onActivate`/`onDeactivate` block triggers.

```jsonc
{
  "id": "boots-rounds",                          // unique across the library: it is also this activation's pool id
  "name": "Daylight",                            // optional; defaults to the spell's, then the record's name
  "action": "free",                              // free | swift | immediate | move | standard | fullRound | {minutes} | {hours}
  "charges": { "max": 10, "resetOn": "day", "label": "Haste rounds" },  // omit = at will
  "cost": [{ "kind": "charge", "resourceId": "wand-charges", "amount": 1 }],
  "duration": "untilMyNextTurn",                 // how long `whileActive` applies; omit = instant
  "spell": "hog-daylight",                       // optional: this activation casts that library spell
  "onUse": [ /* blocks run once, when used; trigger is implied */ ],
  "whileActive": [ /* blocks that apply for the duration */ ]
}
```

- `charges` omitted means at will. `max` is a number or an expression (`"1 + floor(classLevel(monster-hunter) / 5)"`). An inline `charges` **is** a pool whose id is the activation id, so `self.resource.<activation id>.left` works and stored usage survives.
- Using an activation spends one of its own `charges`, then everything in `cost`. An `onUse` block that consumes the same id explicitly is not double-charged.
- `cost` kinds: `charge` (from any pool or inline charges, by `resourceId`), `hp`, `item` (decrements inventory quantity — potions), `spellSlot`, `gold`, `xp`.
- `duration` omitted = instant: `onUse` runs and nothing lingers. With a duration, using it starts a buff keyed to `record id / activation id`, and `whileActive` blocks apply until it expires.
- An activation whose duration is `thisAttack` or `thisTurn` is shown as a **declare chip** (`⚡ Monster Blow 1/1`) above the attack rows instead of being declared after the roll; tapping it spends the charge and starts the buff; a `thisAttack` declaration is dropped as soon as an attack is logged, a `thisTurn` one at the next round. There is no separate "declare" kind any more.
- `spell` makes the record grant that spell: the battle row takes the spell's name ("Daylight") with the record's name as subtext ("Hand of Glory") and keeps the activation's own charges. A spell with a duration contributes its `effects` while the activation is active; an instant spell's `effects` run once, like `onUse`. This replaces v2's `grants`.

### Pools

`pools` holds named charge pools shared by several activations or records (ranger spells per day; a wand's 50 charges spent by two different spells). Most records need none, because an activation's inline `charges` already is a pool.

```jsonc
"pools": [{ "id": "wand-charges", "label": "Wand", "max": 50, "resetOn": "never" }]
```

Pool ids and activation ids share one namespace; the pack validator rejects an activation or pool id already used elsewhere in the library. `resetOn` is `round | encounter | day | never`: round and encounter counters live on the battle and clear with it, day and never counters live on the character (`resourceState`) and can be nudged by hand on the ability's sheet — v2's `manual` reset is just `never`.

### Durations

`thisAttack` · `thisTurn` · `untilMyNextTurn` · `{ "rounds": 5 }` (number or expression) · `{ "minutes": 10 }` · `encounter` · `untilRemoved`. Omitting the field means instant. Dropped from v2: `instant` (omit it), `endOfRound` (= `untilMyNextTurn`), `whileActive` and `concentration` (= `untilRemoved`).

## Converted from v2

The converter is mechanical and idempotent, so a v2 pack can simply be dropped in:

| v2 | v3 |
|---|---|
| `origin: feat \| classFeature \| race \| memory \| core` | `kind: "feature"` with `acquired` = feat / class (carrying `classId`, `classLevel` → `level`) / race / dm |
| `origin: item \| spell` | `kind: "item"` / `kind: "spell"` |
| `origin: monster` | `kind: "feature"` with `acquired: { kind: "feat" }` (a monster's own ability; no bundled pack uses it) |
| `origin: buff \| condition \| situational` | `kind: "status"` (`harmful: true` for conditions) |
| `activation` (`action`, `atWill`, `declare`) + `cost` + `duration` + `resources[0]` | one entry in `activations` (`declare` → `action: "free"`, `duration: "thisAttack"`) |
| `activation: passive` and `activation: { reaction: X }` | no activation: blocks stay in `effects`, a reaction's `always` blocks take trigger `X` |
| `resources` | `pools`; the first one becomes the activation's inline `charges` (keeping its id, so stored usage survives) |
| `grants: ["hog-daylight"]` | one extra activation per granted record, with `spell` set when it is a spell |
| `binding: thisWeapon` / `{ slot }` | a condition prepended to every block: `attack.weapon.id = <this record>` / `self.equipped.slot.<slot> >= 1` (`thisItem` is implicit for items) |
| block triggers `onUse` / `onActivate` / `onDeactivate` | `activation.onUse` (trigger dropped); `onDeactivate` blocks are discarded |
| `is battle.toggle.<own id>` inside a converted `declare` ability | removed — a declared activation is simply active |
| `resetOn: rest` / `manual` | `day` / `never`; `resetTo: zero` counters are dropped (use history conditions) |
| `duration: instant` / `endOfRound` / `whileActive` / `concentration` | omitted / `untilMyNextTurn` / `untilRemoved` / `untilRemoved` |
| `origin: core` | `kind: "feature"`, `acquired: { kind: "dm" }` — the one v2 `core` record (Knowledge Devotion's table) is gone from the packs, its text folded into that feature |

Stored battles convert too: `battle.situational` → `battle.statuses` (Status records that live and die with the battle, with a "Keep in library" button), and active buffs gain the `activationId` they now need.

## Blocks

```jsonc
{ "id": "adjust", "label": "Adjust for Range",
  "trigger": "always",   // always | onHit | onMiss | onCrit | onDamaged | onRoundStart | onRoundEnd
  "when": { "all": [ … ] },
  "do": [ … ] }
```

A block is the same shape wherever it appears: in a record's `effects`, in an activation's `whileActive`, or in its `onUse` (where the trigger is implied and the editor hides it). `always` blocks contribute while their condition holds; the other triggers fire once when the event happens (their `do` may tag, grant, consume, heal, reveal). The v2 triggers `onUse`, `onActivate` and `onDeactivate` are gone: those blocks live inside an activation now.

## Selectors

A selector is a dot path naming a piece of state. The builder shows them as *domain → field → key* dropdowns.

| Selector | Value |
|---|---|
| `self.stat.<stat>` | number: attack, damage, ac, ac.touch, ac.flatFooted, save.fort/ref/will, init, speed, hp.max, critRange, critMult, ability.str…cha, dr, sr, resist.fire…, casterLevel, spellDC |
| `self.skill.<id>.ranks` / `.total` / `.classSkill` | number / number / boolean |
| `self.class.<id>.level`, `self.level`, `self.bab`, `self.hp.current`, `self.hp.max` | number |
| `self.tag.<tag>` | boolean: condition on you |
| `self.ability.<id>.enabled` | boolean: feature is on the character and not suppressed |
| `self.ability.<id>.active` | boolean: `<id>` is a record id (any of its activations running, or its status buff up) or an activation id |
| `self.ability.<id>.usesLeft` / `.used` | number: `<id>` is a pool id, an activation id, or a record id (its first activation with charges, else its first pool) |
| `self.resource.<id>.left` / `.used` / `.max` | number: same ids — pools and inline activation charges alike |
| `self.equipped.item.<id>` | boolean |
| `self.equipped.slot.<slot>`, `self.equipped.category.<cat>`, `self.equipped.count.tag.<tag>` | number of equipped items |
| `self.param.<name>` | list of chosen tags |
| `self.var.<name>` | number from the character's vars |
| `target.exists`, `target.tag.<tag>`, `target.condition.<tag>`, `target.revealed`, `target.dead` | boolean |
| `target.type`, `target.tags` | creature type tag / all tags |
| `target.size`, `target.hurt` | ordinal (compare with names: `large`, `bloodied`) |
| `target.distance` | feet |
| `attack.exists`, `attack.kind`, `attack.index`, `attack.mode`, `attack.isFirstThisRound` | boolean / ranged\|melee / number / mode id / boolean |
| `attack.weapon.id`, `attack.weapon.category`, `attack.weapon.tag.<tag>` | weapon item id / category / boolean |
| `battle.round`, `battle.prompt.<id>`, `battle.tag.<tag>` | number / number / boolean |
| `battle.toggle.<id>` | boolean: a manual switch chip in battle (Sniping, Dodge target). Declaring an activation is no longer a toggle — it is simply active |
| `flag.<name>` | boolean set by `flag` effects (ignoreConcealment, neverFlatFooted, immune.*, sense.*) |

## Conditions

```jsonc
{ "all": [ … ] }  { "any": [ … ] }  { "none": [ … ] }  { "not": … }  { "count": [ … ], "atLeast": 2 }
{ "is": "target.tag.aquatic" }                       // boolean selector is true
{ "exists": "battle.prompt.knowledge" }              // selector has a value
{ "compare": "target.distance", "op": "<=", "value": 30 }   // = != < <= > >= ; value = number, ordinal name, selector, or expression
{ "in": "target.tags", "set": ["aberration", "fey"] }
{ "in": "target.tags", "param": "types" }            // membership in the character's chosen tags
{ "history": { "event": "miss", "by": "me", "vs": "current", "scope": "thisRound" }, "op": ">=", "value": 1 }
```

History filters: event ∈ hit, miss, crit, attack, used (with `abilityId`), activated, damaged, moved; by ∈ me, target, any; vs ∈ current, any, sameCategory (with `category`); scope ∈ thisAttackSequence, thisRound, lastRound, encounter, day. `{ "all": [] }` means always.

## Effects

| Verb | Fields | Example |
|---|---|---|
| modify | to (stat or skill.<id>), value (number, expression, or prompt table), type (bonus type), mode add\|set\|multiply, attackKind? | `{ "verb": "modify", "to": "attack", "value": 4 }` |
| dice | dice, damageType?, label?, attackKind? | `{ "verb": "dice", "dice": "1d6", "damageType": "fire" }` |
| flag | flag, value | `{ "verb": "flag", "flag": "neverFlatFooted" }` |
| tag | to self\|target\|allEnemies, tag, duration | `{ "verb": "tag", "to": "target", "tag": "flanked", "duration": "untilMyNextTurn" }` |
| grant | ability, duration? | `{ "verb": "grant", "ability": "rage" }` (starts it as a buff) |
| suppress | ability | anti-magic, rulings |
| resource | id, op consume\|restore\|set, amount | `{ "verb": "resource", "id": "boots-rounds", "op": "consume", "amount": 1 }` |
| attack | mode {id,label,base}, extraAttacks, penaltyAll, appliesToBase, naturalAttack {name,dice,count}, attackKind | Rapid Shot: `{ "verb": "attack", "mode": { "id": "rapid-shot", "label": "Rapid Shot", "base": "full" }, "extraAttacks": 1, "penaltyAll": -2, "attackKind": "ranged" }` |
| slot | slot, count | Hand of Glory: `{ "verb": "slot", "slot": "ring" }` |
| hp | op damage\|heal\|temp, amount | potions |
| prompt | id, label?, per?, remember | asks for a value (a check result) |
| note | text with `{expr}`, dc? | `{ "verb": "note", "text": "Fort DC {damage + classLevel(monster-hunter) + wisMod} or die" }` |
| reveal | | target's lore becomes visible |

Prompt tables: `"value": { "prompt": "knowledge", "per": "creatureType", "table": [{ "upTo": 15, "value": 1 }, { "upTo": 25, "value": 2 }, { "value": 3 }] }`.

Expressions: numbers, `strMod`…`chaMod`, `level`, `bab`, `round`, `damage` (last dealt), `classLevel(ranger)`, `prompt(knowledge)`, `sel(self.equipped.count.tag.trophy-aberration)`, character vars, `+ - * /`, `floor min max`. Dotted selectors without hyphens can be written directly: `self.class.ranger.level`.

## Worked examples

**Woodland Archer, Adjust for Range** — feature, `acquired: { kind: "class", classId: "ranger" }`, no activations. One `effects` block: `when: { all: [ { compare: "attack.kind", op: "=", value: "ranged" }, { history: { event: "miss", vs: "current", scope: "thisRound" } } ] }`, `do: [ { verb: "modify", to: "attack", value: 4 } ]`.

**Monster Blow** — feature with one activation `{ id: "monster-blow", action: "free", charges: { max: "1 + floor(classLevel(monster-hunter) / 5) + floor(classLevel(monster-hunter) / 8)", resetOn: "day" }, duration: "thisAttack" }`, so battle shows it as a `⚡` chip. Its `whileActive` block is `when: { all: [ { in: "target.tags", param: "types" }, { compare: "target.hurt", op: ">=", value: "bloodied" } ] }`, `do: [ { verb: "note", text: "MONSTER BLOW: on hit, Fort DC = damage + classLevel(monster-hunter) + wisMod or die." } ]`. No toggle condition: the chip *is* the declaration.

**Boots of Speed** — item, feet slot, one activation `{ id: "boots-rounds", action: "free", charges: { max: 10, resetOn: "day", label: "Haste rounds" }, duration: "untilMyNextTurn" }` whose `whileActive` block holds the haste effects (extra attack, +1 dodge to attack/AC/Reflex, +30 ft). Use spends one round and applies haste until your next turn; choose again each round.

**Hand of Glory** — item, neck slot. `effects`: `{ verb: "slot", slot: "ring" }` while equipped. Two activations, `hog-daylight` and `hog-see-invisibility`, each `charges: { max: 1, resetOn: "day" }` with `spell` pointing at the matching spell record — two separate rows in battle with their own charges.

**Medusa Mask** — item, head slot, trophy category; one activation `medusa-gaze`, standard action, 1/day.

**Ranger Spells** — feature with one activation `{ id: "ranger-spell-1", charges: { max: "rangerSpells1", resetOn: "day", label: "1st-level spells" } }`: the charges expression reads a character var.

**Monster Horror** — `modify attack` with value `max(2, 2 * sel(self.equipped.count.tag.trophy-aberration))` when the target is one of the chosen types.
