# Hunter's Ledger

D&D 3.5e battle assistant. Computes per-attack bonuses from modular JSON "packs" (feats, items, buffs, tags, monsters) with nested conditions and battle memory. Runs as a web app and as an Android app (Capacitor).

- `packages/engine` — pure TypeScript rules engine (zod schemas, evaluator). `npm test`
- `packages/app` — React + Vite + Tailwind UI. `npm run dev` for development only.

## Using it on the phone (before the APK)

```sh
npm run serve        # production build + static server on port 4173, no live-reload
```

Open `http://<mac-ip>:4173` in Chrome on the phone (same Wi-Fi), then menu → "Add to Home screen". It installs as a standalone app with offline cache; data lives in the phone's browser storage. Do not use `npm run dev` on the phone: its live-reload socket refreshes the page every time the tab is suspended.

After changing code: run `npm run serve` again; the installed app picks up the new version on its next launch.
- `packs/` — authored content (JSON). Source of truth for features/items/spells/statuses/monsters; the record format is v3, documented in `docs/RULES-FORMAT.md`.
- `tools/` — scripts: pack validation, bestiary extraction, RPG Scribe import.
- `docs/superpowers/specs/` — design spec.
