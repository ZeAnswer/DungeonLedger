# Dungeon Ledger

D&D 3.5e battle assistant. Computes per-attack bonuses from modular JSON "packs" (feats, items, buffs, tags, monsters) whose effects are short JavaScript scripts, with battle memory. Runs as a web app and as an Android app (Capacitor).

- `packages/engine` — pure TypeScript rules engine (zod schemas, evaluator). `npm test`
- `packages/app` — React + Vite + Tailwind UI. `npm run dev` for development only.

## Using it on the phone (before the APK)

```sh
npm run serve        # production build + static server on port 4173, no live-reload
```

Open `http://<mac-ip>:4173` in Chrome on the phone (same Wi-Fi), then menu → "Add to Home screen". It installs as a standalone app with offline cache; data lives in the phone's browser storage. Do not use `npm run dev` on the phone: its live-reload socket refreshes the page every time the tab is suspended.

After changing code: run `npm run serve` again; the installed app picks up the new version on its next launch.

## Where things are edited

- **Library › Features / Items / Spells / Statuses** — one record per row. The editor has a form for the record's own fields and a list of **scripts**: each row is one dropdown for when it runs (`Always` is the compute phase, or one moment — `When I hit`, `Round start`, `Custom…`, …) beside a CodeMirror box for the JavaScript; label, id, the enabled switch and the priority fold behind a `⋯` button. A script can also be stored as a **call** to a library function instead of code — a small link under the box switches either way, and a call row shows a typed form (dropdowns for ability/stat/skill/bonus type/tag/duration/attack kind/…) with no code box at all. Under each script, "Right now" previews what it emits against the live character, battle and target.
- **Library › Variables** — the active character's own `vars`, plus globals shared by every character (`vars.<name>` reads the character's own first, then a shared one); warns when the active character shadows a shared one.
- **Library › Functions** — shared script bodies with typed parameters, and the records that call them.
- **Long-press any number** (stats, skills, HP, ability scores, charges, items, switches, prompts) to see the path a script reads it with, with a Copy button.
- **Settings › Scripts** — safe mode (scripts off; also `?safe=1`, and it turns itself on after two failed starts). **Settings › Script errors** — everything a script threw this session, and any script paused after three failures.
- Importing a pack that carries scripts or functions asks first: it runs as code on this device.
- `packs/` — authored content (JSON). Source of truth for features/items/spells/statuses/monsters; the record format is v4 (scripts), documented in `docs/RULES-FORMAT.md`.
- `tools/` — scripts: pack validation, bestiary extraction, RPG Scribe import.
- `docs/superpowers/specs/` — design spec.
