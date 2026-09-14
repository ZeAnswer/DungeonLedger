# TODO

## Battle
- [ ] Situational modifier sheet: use the new selector conditions (currently stat + value + duration only).
- [ ] Roster: a Monsters tab in Library should also expose the remembered tag overlay for editing.
- [x] **Activations per effect, not per item.** Hand of Glory now grants Daylight and See Invisibility as separate actions with their own charges.
- [x] **Activatable list with origin.** Each action row shows its granter or class as subtext.
- [x] Consumables: potions have an item cost (quantity decrements on use); healing amount still entered by hand on the character screen.
- [x] Situational modifier: "save to library" (Keep in library) turns a one-off Status into a reusable library record.
- [x] Attack profiles come from equipped weapon items.

## Rules builder
- [x] **Rules v2**: selectors + compare/is/in/exists/history conditions, 13 effect verbs, ability envelope (origin, binding, activation, cost, duration, reset policy, grants).
- [x] Record kinds (Features / Items / Spells / Statuses) with activations; rules v3. See `docs/RULES-FORMAT.md`.
- [ ] Builder: friendlier presets ("+N to a stat vs a creature type" templates) on top of the generic blocks.
- [ ] Preview an effect against a sample target inside the editor.

## Character data to confirm (Memento)
- [ ] Favored enemy types (export UUIDs 321140E5, E6E711CC) and which one is +4.
- [ ] Monster Killer picks (3 types).
- [ ] Five skills with unresolved UUIDs (D11C1603, 700AC2F3, D80DE6A9, ECB3CA28 with 8/8/8/7 ranks; 40AD06C4 class-skill override, 6 ranks).
- [ ] Feat slot placements guessed: Point Blank Shot (level 1 human bonus), Knowledge Devotion (level 3).
- [ ] HP rolls at levels 5 and 6 (export says "1"; modeled 6/6 to total 44).
- [ ] Knowledge (Monsters): 8 ranks exceeds the class cap of MH level + 5 = 6; DM ruling.
- [ ] Ranger spells known (export spell UUIDs unresolved); spells/day var `rangerSpells1`.

## Level ledger
- [ ] Spells learned per level; spell list per class.
- [ ] Guided level-up wizard with prerequisites (later).

## Platform
- [ ] Android APK via Capacitor (needs Android Studio + JDK on the mac; `docs/ANDROID.md`).
- [ ] Decide whether `tools/data/memento-rpgscribe.json` (DM's Hebrew memory notes) stays in the public repo.
- [ ] Lazy-load the bestiary pack (1.8 MB) instead of bundling it in the main chunk.
- [x] Old v1 rules in stored data are converted on load. Pre-slot inventory entries without abilityId still display but cannot be equipped: use Settings → Replace inventory.

## Later
- [ ] Multi-character / party sync.
- [ ] Initiative order.
- [ ] In-app dice.
