# Dungeon Ledger — clean script rows

## Context

The scripts engine (rules v4) and its app shipped to main today (e42bc42). First look on the phone: a record's script row shows everything at once — id box, label, eleven event pills (`always hit miss crit …`), a code/call switch, the code, five snippet chips, the "Right now" preview, enabled and priority. The user's verdict: the pills are meaningless ("hit what?"), the snippet chips are too specific, the row is crowded. Decisions taken in conversation (2026-09-16):

- One **dropdown beside the code** says when the script runs: `Always` (static; cannot change state) or one moment (`When I hit`, `When I miss`, `When I crit`, `When I'm hit`, `Round start`, `Round end`, `When used`, `When equipped`, `When unequipped`, `Custom…`). Single-select. No pills. The engine's `events[]` field stays; the UI writes one entry. (No shipped script uses more than one event.)
- Inside the code nothing is passed around: `target` is the current target (on a hit, the one just hit), `event.damage`, `player.equipped.<slot>`, `battle.round`, `active.round` already exist.
- A row shows **dropdown + code + Right now**. Label, on/off, priority, id fold behind a `⋯` button. Snippet chips go; one `insert ▾` menu inside the editor offers helpers, paths and common lines on demand.
- **Functions are the form.** Choosing "use a function" hides code entirely; typed parameters render as dropdowns wherever the type allows (ability, stat, skill, bonus type with "not specified" default, tag, duration, attack kind). Ship the common cases as core functions.

Engine and packs change only where the functions and their new parameter types need it. Everything else is editor UI.

## What ships

### 1. Script row (`packages/app/src/components/library/ScriptsEditor.tsx`)

```
[ Always ▾ ]                                   ⋯  ✕
┌ code ─────────────────────────────────────────┐
│ bonus('ability.str', 2, 'enhancement')        │
└───────────────────────────────────────────────┘
RIGHT NOW  ability.str +2 (enhancement) — Belt of Strength +2
```

- `EVENT_OPTIONS`: `{ value: 'always', label: 'Always' }`, `hit → 'When I hit'`, `miss → 'When I miss'`, `crit → 'When I crit'`, `damaged → "When I'm hit"`, `roundStart → 'Round start'`, `roundEnd → 'Round end'`, `use → 'When used'`, `equip → 'When equipped'`, `unequip → 'When unequipped'`, `custom → 'Custom…'` (reveals a name box, stores `custom:<name>`). `<select data-role="script-event">`; `onChange` writes `events: [value]`. Legacy rows with several events show the first and a "+N more" hint until re-saved.
- `⋯` toggles a details block: label, id (read-only text), enabled checkbox, priority, and the `code | use a function` switch. New rows start with the details closed too; the switch also appears as a small link under the code ("use a function instead") so it is findable.
- Delete `EVENTS` pills, `CustomEvent` chip flow (replaced by the `Custom…` option), and the always-visible switch row.
- `ScriptPreview` unchanged ("Right now").

### 2. Editor (`ScriptEditor.tsx`, `snippets.ts`)

- Remove the snippet chip row. Add one `insert ▾` button in the editor's corner opening a small menu (plain `<details>`/popover, no new dependency) with three groups: **helpers** (`bonus('attack', 1)`, `note('…')`, `target.mark('shaken', ROUND)`, `charges('id').use()`, `if (attack.isRanged) { }`, `if (target.is('undead')) { }`, `if (battle.on('switch')) { }`), **paths** (from `PATHS`, described via `describePath`), **units** (`ROUND`, `MINUTE`, `HOUR`, `ENCOUNTER`, `UNTIL_MY_NEXT_TURN`). Choosing inserts at the cursor via the existing `insert()`.
- `snippets.ts` becomes the data for that menu.

### 3. Function form (`FunctionCallForm.tsx`, engine schema, validator)

- Engine `ParamTypeSchema` (`packages/engine/src/schema.ts:81`) gains `'ability' | 'skill' | 'attackKind'`. `tools/pack-validate.ts` accepts them. Docs table in `docs/RULES-FORMAT.md` lists them.
- Form controls by type: `ability` → select Str/Dex/Con/Int/Wis/Cha (values `ability.str`…); `stat` → grouped select from `StatIdSchema` (attack, damage, AC…, saves, ability scores, skills excluded); `skill` → select from `ctx.library.skills`; `bonusType` → select from `BonusTypeSchema` with first option "not specified" (= `'untyped'`); `tag` → select from `ctx.library.tags` (+ free text); `duration` → the existing `DurationPicker`; `attackKind` → `any | ranged | melee`; `event` → same option list as the row dropdown; `recordId` → select of records; `number`/`string`/`bool`/`dice` as today; `path`/`ref` bare-path box as today. The `ƒx` toggle stays per box, hidden behind a tiny link, not a button.
- When a row uses a function: no code box, no `Right now` change (preview still probes the synthesized call).

### 4. Core functions (`tools/gen-core-pack.ts`, core v6; memento untouched)

From the 46 shipped scripts: 12 are a plain `bonus(...)`, 8 a `bonus` behind one condition (ranged/melee, target type, switch, weapon tag), 3 a `note`. Ship:

| id | params | body |
|---|---|---|
| `addToAbility` | `ability: ability`, `amount: number`, `type?: bonusType` | `bonus(ability, amount, type ?? 'untyped')` |
| `addToStat` | `stat: stat`, `amount: number`, `type?: bonusType`, `onlyFor?: attackKind` | guard on `attack.isRanged/isMelee` when `onlyFor` set, then `bonus` |
| `addToSkill` | `skill: skill`, `amount: number`, `type?: bonusType` | `bonus('skill.' + skill, amount, type ?? 'untyped')` |
| `bonusVsType` | `stat: stat`, `amount: number`, `creatureType: tag` | `if (target.is(creatureType)) bonus(stat, amount)` |
| `bonusWhenSwitch` | `stat: stat`, `amount: number`, `switchName: string` | `if (battle.on(switchName)) bonus(stat, amount)` (toggle chip appears via the existing body scan) |
| `markTarget` | `tag: tag`, `duration: duration` | `target.mark(tag, duration)` — event scripts only |
| `reminder` | `text: string` | `note(text)` |

Existing `haste`, `favoredEnemy`, `trophy` stay. Shipped records keep their code; nothing converted.

### 5. Tests and docs

- `e2e/builder.spec.ts`, `e2e/diagnostics.spec.ts`: replace pill clicks with `selectOption` on `[data-role="script-event"]`; assert the `⋯` block is closed by default and opens; assert no snippet chips render; a call-form test picks `addToAbility`, chooses Str from the dropdown, saves, and the JSON shows `call.fn === 'addToAbility'` with `args.ability = { k: 'lit', v: 'ability.str' }`.
- Engine: `packages/engine/test/schema.test.ts` (or nearest) covers the three new param types; validator run on regenerated packs.
- `docs/RULES-FORMAT.md`: the row layout paragraph and the param-type table; README "Where things are edited" bullet updated (one dropdown, `⋯`).

## Verification

- `cd packages/engine && npx vitest run && npx tsc --noEmit`; `npm run validate-packs` (core v6, 10 functions).
- `npm run typecheck && npm run build`; `npx playwright test` (all specs).
- Manual on the phone after merge: open Belt of Strength — one dropdown saying Always, the code, Right now, nothing else; tap `⋯` to see label/id/enabled/priority; new script → "use a function" → `addToAbility` shows Str…Cha dropdown.

## Critical files

- App: `packages/app/src/components/library/ScriptsEditor.tsx`, `ScriptEditor.tsx`, `snippets.ts`, `FunctionCallForm.tsx`, `DurationPicker.tsx` (reused), `ScriptPreview.tsx` (unchanged).
- Engine: `packages/engine/src/schema.ts` (`ParamTypeSchema`), `tools/pack-validate.ts`, `tools/gen-core-pack.ts`, `packs/core-3.5e.json` (regenerated).
- Tests/docs: `e2e/builder.spec.ts`, `e2e/diagnostics.spec.ts`, `docs/RULES-FORMAT.md`, `README.md`.
