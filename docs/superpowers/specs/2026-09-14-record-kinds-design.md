# Record kinds and activations (rules format v3)

Date: 2026-09-14. Status: proposed.

## Problem

The library is one flat list of "abilities" with an `origin` enum of 11 values, and every record carries every envelope field (binding, activation, cost, resources, duration, grants, item meta, class fields). Most fields make no sense for most records: a feat has no body slot, an item has no charges of its own, a buff has no activation. The editor shows all of them. Several options overlap: `atWill` is an action with no charges; `declare` is a free action lasting one attack; `reaction` duplicates block triggers; `binding` duplicates conditions; `rest` duplicates `day`; `memory` is a feat with a story.

Rule of thumb for this redesign: if two things fulfil the same purpose they are the same thing. Anything that only applies to one kind of record shows up only on that kind's form.

## Record kinds

Four record kinds replace `origin`. Each is a library tab and its own editor. The kind is implied by the tab you create it in, so it is never a form field.

| Kind | Replaces | Purpose |
|---|---|---|
| **Feature** | feat, classFeature, race, memory, core | Anything the character has and keeps: feats, class features, racial traits, DM-granted powers ("memories"). |
| **Item** | item | A physical thing in inventory. Effects apply while equipped. May carry activations. |
| **Spell** | spell | A castable. Referenced by items (wand, Hand of Glory), by features (ranger spells), by the level ledger later. |
| **Status** | buff, condition, situational | A temporary state applied in battle from the drawer: Haste, Bless, Shaken, Prone, Higher ground. |

Monsters and Tags remain their own tabs, unchanged.

The one `core` record (Knowledge Devotion table reference) becomes rules text on the Knowledge Devotion feature and is dropped.

## Shared shape

```jsonc
{
  "id": "hand-of-glory", "name": "Hand of Glory",
  "text": "…", "sourceRef": "DMG p.258", "todo": "…",
  "effects": [ /* passive blocks */ ],
  "activations": [ /* see below */ ],
  "pools": [ /* shared charge pools, optional */ ]
}
```

- `effects`: blocks that apply on their own. Triggers: `always`, `onHit`, `onMiss`, `onCrit`, `onDamaged`, `onRoundStart`, `onRoundEnd`. For an Item they apply while equipped (or while carried, slot `none`). For a Status they apply while the status is active. For a Feature they apply while the feature is enabled. This replaces `activation: passive` and `activation: {reaction}`.
- `activations`: things the player can do with this record. Zero or many. Replaces `activation: action | declare | atWill`, `cost`, `duration`, `grants`, and the `onUse`/`onActivate`/`onDeactivate` triggers.
- `pools`: named charge pools shared by several activations or several records (ranger spells per day; a wand's 50 charges spent by two spells). Most records do not need this because an activation can declare its own charges inline.

### Activation

```jsonc
{
  "id": "daylight", "name": "Daylight",
  "action": "standard",                 // free | swift | immediate | move | standard | fullRound | {minutes} | {hours}
  "charges": { "max": 1, "resetOn": "day" },   // omit = at will
  "cost": [ … ],                        // extra costs: spend from a named pool, hp, item, spellSlot, gold, xp
  "duration": { "rounds": "1" },        // how long whileActive blocks apply after use; omit = instant
  "spell": "daylight",                  // optional: this activation casts a library spell; its effects/duration come from the spell
  "onUse": [ /* blocks run once when used */ ],
  "whileActive": [ /* blocks that apply for the duration */ ]
}
```

- `charges` omitted means unlimited (at will). `charges.max` is an expression, as `resources[].max` is today. `resetOn` is `round | encounter | day | never`. `rest` merges into `day`; `manual` merges into `never` (every pool keeps a manual reset button anyway). `resetTo: zero` counters are dropped; history conditions cover that need.
- An inline `charges` is a pool named after the activation id. Nothing else changes in the engine's resource storage.
- `cost` keeps the six kinds (`charge` from a named pool, `hp`, `item`, `spellSlot`, `gold`, `xp`). The implicit rule "one use spends one charge of each own pool" goes away: inline `charges` spends one, `cost` spends what it says.
- Duration values: `thisAttack`, `thisTurn`, `untilMyNextTurn`, `{rounds}`, `{minutes}`, `encounter`, `untilRemoved`. Dropped: `instant` (omit the field), `endOfRound` (= untilMyNextTurn), `whileActive` and `concentration` (= untilRemoved).
- "Declare before the roll" abilities (Monster Blow) are an activation with `action: free`, `duration: thisAttack` and charges. The battle screen shows any activation whose duration is `thisAttack` or `thisTurn` as a pre-roll chip instead of a Use button; using it spends the charge and clears at the end of the attack or turn. No separate activation kind.
- `spell` on an activation makes the record grant that spell: the battle screen lists "Daylight (Hand of Glory)" with the activation's own charges, and the spell's effects and duration apply. This replaces `grants`.

### Per-kind fields

| Field | Feature | Item | Spell | Status |
|---|---|---|---|---|
| `acquired`: `{ "feat": true }` / `{ "class": "ranger", "level": 4 }` / `{ "race": "human" }` / `{ "dm": "memory" }` | yes | | | |
| `params` (choices made at level-up: favored enemy types, Monster Killer types) | yes | | | |
| `enabledByDefault` | yes | | | |
| `item` meta: category, slot, weight, price, tags, weapon | | yes | | |
| `level`, `castingAction`, `duration`, `effects` (a spell is one activation by nature; `cost` defaults to a spell slot of its level) | | | yes | |
| `harmful` (chip color, red for conditions) and default `duration` | | | | yes |
| `effects` | yes | yes | yes | yes |
| `activations` | yes | yes | | |
| `pools` | yes | yes | | |

`acquired` replaces `classId`/`classLevel` and the feat/classFeature split the level ledger relies on. The Features tab has filter chips: feats, class features (grouped by class), racial, DM.

### Dropped entirely

- `origin`: implied by the tab.
- `binding`: `thisItem` is implicit for items; `thisWeapon` and `{slot}` become two condition presets in the block builder (`attack.weapon.id = this record`, `self.equipped.slot.<slot> >= 1`).
- `activation` enum, `grants`, `classId`, `classLevel`, `resources` (renamed `pools`, moved to the record, rarely needed).
- Block triggers `onUse`, `onActivate`, `onDeactivate` (blocks now live in `activation.onUse` / `activation.whileActive`).

## Battle one-offs

Situational modifiers typed during a battle ("+2 attack, higher ground, this attack") use the Status schema and the Status editor, but are stored in `battle.statuses` rather than the library. When the battle ends they go with it. "Save to library" moves the record into the library unchanged. The engine resolves active statuses from both lists, as it does with `battle.situational` today.

## Engine changes

- `schema.ts`: `FeatureSchema`, `ItemSchema`, `SpellSchema`, `StatusSchema` sharing a base; `ActivationSchema`; library holds `features`, `items`, `spells`, `statuses` maps (plus tags, monsters, classTables). A union `Record` type with a `kind` discriminator is used only in memory, never stored.
- `migrate.ts`: v2 → v3 converter run on load for library, packs, and stored characters. Mapping is mechanical: origin → kind and `acquired`; activation/cost/duration/resources/grants → one activation; `onUse`/`onActivate` blocks → `activation.onUse`; `binding` → condition prepended to every block; `endOfRound` → 1 round; `rest` → `day`; `manual` → `never`; `core` record dropped with its text appended to the named feature. Character `abilities[]` instances keep `abilityId`, `enabled`, `paramValues`; item instances are unchanged.
- `resolve.ts`: `activeSources` walks features (enabled), equipped items, active statuses (library and battle), and active activations (from `activeBuffs`, keyed by `record.id/activation.id`). Actions list is built from activations, not from records with resources.
- `battle.ts`: `useAbility` takes `{ recordId, activationId, targetId? }`. Pays inline charges then `cost`. Starts a buff keyed to the activation if it has a duration. Spell activations resolve the spell's effects and duration.
- `selectors.ts`: `self.ability.<id>.active|usesLeft|used` become `self.activation.<recordId>.<activationId>.active|usesLeft|used`; `self.ability.<id>.enabled` stays for features. `battle.toggle.<id>` is removed; a declared activation is simply active for the attack.
- `describe.ts`, `RULES-FORMAT.md`: updated to v3.
- Tests: schema, migrate (every v2 pack record round-trips through the converter and validates), resolve (Rapid Shot, Hand of Glory two activations, Boots of Speed per-round charge, Monster Blow declared for one attack), battle use/undo with activation ids.

## App changes

- `LibraryScreen`: tabs Features, Items, Spells, Statuses, Monsters, Tags. Each list filters by its own fields (Features by acquisition; Items by category; Spells by level; Statuses by harmful).
- Editors: one `RecordEditor` shell (name, id, text, source, todo, effects) with a kind-specific section: `FeatureFields` (acquired, params, enabledByDefault, activations, pools), `ItemFields` (item meta, activations, pools), `SpellFields` (level, casting action, duration), `StatusFields` (harmful, duration). `ActivationEditor` handles one activation (action, charges, cost, duration, spell, onUse blocks, whileActive blocks). The block editor is unchanged except for the two new condition presets and the trigger list.
- `InventoryScreen`: item creation opens the Item editor. Nothing else changes.
- `BuffsDrawer`: lists Statuses; the "+ one-off" form is the Status editor writing to `battle.statuses`; a "keep in library" button moves it.
- `AttackPanel` / actions list: rows come from activations. Origin subtext is the record name (and class for class features). Pre-roll chips are activations with `thisAttack`/`thisTurn` duration.
- `LevelLedger`: feats chosen = features with `acquired.feat`; class features = features with `acquired.class` matching.
- `CharacterScreen` sections: features grouped by acquisition; items unchanged.
- E2E: builder spec creates one of each kind through its tab; battle-v2 spec covers Hand of Glory activations, Boots per-round chip, Monster Blow declare chip.

## Out of scope

Class tables editor, spell lists per class, spells known in the level ledger, initiative, party sync.
