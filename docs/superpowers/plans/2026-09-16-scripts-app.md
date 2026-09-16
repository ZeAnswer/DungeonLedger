# Scripts app (rules v4, Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `packages/app` onto rules v4: delete the block editors, write effects as JavaScript in a CodeMirror editor (with a typed form for stored function calls), add Globals and Functions tabs, a globals + diagnostics + safe-mode store, long-press path reveal, and an import confirmation for packs that carry code.

**Architecture:** The engine rewrite is done (`packages/engine/src/scripts/*`); this plan only consumes it. Work goes in three layers: (1) the store — a `globals` slice composed into `EvalContext.library`, a diagnostics slice mirroring the engine's error registry, and a safe-mode boot path that turns script mode off before React mounts; (2) the Library editors — `ScriptsEditor` (one row per `Script`: events multi-select, label, enabled, priority, source) whose source box starts as a textarea and becomes a CodeMirror 6 editor, plus `FunctionCallForm` for `script.call`; (3) the read-only screens — `.effects` → `.scripts`, seconds durations, `collectToggles` from the engine's static scan, and a `usePathLongPress` hook wired onto every number the user might want to reference from a script.

**Tech Stack:** React 19, zustand 5, Tailwind 4, Vite 8 + vite-plugin-pwa, TypeScript 6 (`erasableSyntaxOnly`, `noUnusedLocals`, `verbatimModuleSyntax`), Playwright 1.63 (Pixel 7 device, port 5173), CodeMirror 6 (exact pins in Task 8), `@hl/engine` (zod 3, acorn 8, vitest 2).

**Spec:** `docs/superpowers/specs/2026-09-16-scripts-design.md` — read it first. Its **UI**, **Persistence**, **Safe mode**, **Trust** and build-order steps 4–5 are what this plan implements. The engine plan (`docs/superpowers/plans/2026-09-16-scripts-engine.md`) is history: the code in `packages/engine/src` is the truth.

## Global Constraints

- **Durations are seconds or a sentinel.** `SECOND = 1`, `ROUND = 6`, `MINUTE = 60`, `HOUR = 3600`, `DAY = 86400`; sentinels are `'thisAttack' | 'untilMyNextTurn' | 'encounter' | 'untilRemoved'`. `{ rounds: n }` / `{ minutes: n }` no longer exist anywhere.
- **`always` cannot be combined with any other event** (`ScriptSchema` refuses it); `always` is the compute phase, everything else is the event phase.
- **Scripts never appear in packs as diagnostics.** Script errors live only in the engine's in-memory registry (`diagnostics`), never in saved records or packs.
- **Safe mode** is `?safe=1` or `localStorage hl.safeMode`; it calls `setScriptMode('off')` **before the first render**, shows a banner offering to turn scripts back on, and auto-trips when boot throws twice.
- **Importing a pack that carries scripts or functions asks for confirmation ("runs as code").** `new Function` is not a security boundary; the threat model is the user's own device and their own rules.
- **The app has no unit-test runner and this plan does not add one.** The repo's discipline is: engine = vitest, app = `tsc` + Playwright. Every task's red/green signal is named explicitly — usually `npm run typecheck` (the compiler is the test) and/or a Playwright spec that is written *before* the implementation and watched to fail.
- **Commands** (from the repo root unless stated): `npm run typecheck`, `npm run build`, `npm run e2e`, `npx playwright test e2e/<file>.spec.ts`, `npm run validate-packs`; from `packages/engine`: `npx vitest run`.
- **Commit after every task.** End commit messages with the attribution lines from the session's system reminder.
- Never edit `packs/*.json` or `packages/engine/src` beyond the one fix named in Task 1 — engine behaviour is settled.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `packages/app/src/components/library/DurationPicker.tsx` | Seconds-based duration control (replaces the one that lived in `EffectEditor.tsx`). |
| `packages/app/src/components/library/ScriptsEditor.tsx` | The list of `Script` rows: id, label, events multi-select, enabled, priority, source box. Owns `uniqueId` and `newScript`. |
| `packages/app/src/components/library/ScriptEditor.tsx` | One CodeMirror 6 source box (Task 8); the textarea from Task 3 is swapped for it. |
| `packages/app/src/components/library/codemirror.ts` | CodeMirror extension set, completion source from `API_NAMES` + `PATHS`, linter backed by the engine's `compile`. |
| `packages/app/src/components/library/snippets.ts` | Snippet palette entries. |
| `packages/app/src/components/library/FunctionCallForm.tsx` | Typed-parameter form for `script.call`, with a ƒx toggle per box. |
| `packages/app/src/components/library/ScriptPreview.tsx` | Probe run of one script: what it emitted / what stopped it / what it would patch. |
| `packages/app/src/components/library/GlobalsTab.tsx` | Library › Globals: key/value/type, add/edit/delete, shadowing warning. |
| `packages/app/src/components/library/FunctionsTab.tsx` | Library › Functions: list, editor, "used by". |
| `packages/app/src/components/PathToast.tsx` | The long-press toast: description, mono path, Copy. |
| `packages/app/src/hooks/usePathLongPress.ts` | 500 ms long-press → `showPath(path, label?)`. |
| `packages/app/src/store/diagnostics.ts` | Reads the engine registry: errors by record, quarantined script rows. |
| `packages/app/src/boot.ts` | Safe-mode flag, boot-failure guard, `setScriptModePersisted`. |
| `e2e/globals.spec.ts`, `e2e/diagnostics.spec.ts`, `e2e/safemode.spec.ts`, `e2e/import.spec.ts`, `e2e/paths.spec.ts` | One spec per feature area added here. |

**Modified:** `packages/engine/src/scripts/api.ts` (one line, Task 1), `packages/app/src/store/store.ts`, `store/hooks.ts`, `components/library/RecordEditor.tsx`, `ActivationEditor.tsx`, `screens/LibraryScreen.tsx`, `CharacterScreen.tsx`, `InventoryScreen.tsx`, `BattleScreen.tsx`, `SettingsScreen.tsx`, `components/battle/AttackPanel.tsx`, `BuffsDrawer.tsx`, `SituationalSheet.tsx`, `components/character/AbilitySheet.tsx`, `ChargesSheet.tsx`, `App.tsx`, `main.tsx`, `packages/app/package.json`, `e2e/builder.spec.ts`, `README.md`, `docs/RULES-FORMAT.md`.

**Deleted:** `packages/app/src/components/library/BlocksEditor.tsx`, `ConditionEditor.tsx`, `EffectEditor.tsx`, `SelectorPicker.tsx`.

**Existing e2e that must change:** only `e2e/builder.spec.ts` — its tests 1 and 3 drive the block builder (`+ add effect block`, `[data-role="sel-domain"]`, `[data-role="cond-op"]`, `[data-role="block-timing"]`, `[data-role="effect-menu"]`) and are rewritten in Task 3. Test 2 (item editor) survives unchanged. `battle-v2.spec.ts`, `battle.spec.ts`, `edit.spec.ts`, `inventory.spec.ts`, `levelup.spec.ts`, `sheet.spec.ts`, `update.spec.ts` must keep passing untouched.

---

### Task 1: The app compiles against the v4 engine everywhere except the Library editors

**Files:**
- Modify: `packages/engine/src/scripts/api.ts:43-45`
- Modify: `packages/app/src/components/character/AbilitySheet.tsx:51`
- Modify: `packages/app/src/components/battle/BuffsDrawer.tsx:2,23`
- Modify: `packages/app/src/components/battle/SituationalSheet.tsx:2,26`
- Modify: `packages/app/src/screens/InventoryScreen.tsx:83,112,131,136`
- Modify: `packages/app/src/screens/LibraryScreen.tsx:46`

**Interfaces:**
- Consumes (all already exported from `@hl/engine`): `durationRounds(d: Duration | undefined): number | undefined`, `ROUND: number`, `EquipResult = { ok: boolean; reason?: string; character: Character; battle?: Battle; globals?: Record<string, VarValue> }`, `removeItemInstance(ctx, itemId): EquipResult`, `Ability['scripts']: Script[]`.
- Produces: nothing new; this task only removes compile errors.

- [ ] **Step 1: Run the compiler and record exactly what is broken**

Run: `npm run typecheck 2>&1 | grep "error TS" | cut -d'(' -f1 | sort | uniq -c`
Expected: 49 errors in 12 files —

```
   1 ../engine/src/scripts/api.ts
   1 src/components/battle/BuffsDrawer.tsx
   1 src/components/battle/SituationalSheet.tsx
   2 src/components/character/AbilitySheet.tsx
   4 src/components/library/ActivationEditor.tsx
   9 src/components/library/BlocksEditor.tsx
   1 src/components/library/ConditionEditor.tsx
   6 src/components/library/EffectEditor.tsx
   9 src/components/library/RecordEditor.tsx
   4 src/screens/InventoryScreen.tsx
   3 src/screens/LibraryScreen.tsx
   8 src/store/hooks.ts
```

The engine one is `../engine/src/scripts/api.ts(44,15): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` — the app type-checks the engine's sources directly, under stricter options than the engine's own tsconfig.

- [ ] **Step 2: Confirm the engine-side error is already gone**

`ScriptSkip` was made erasable (explicit field + constructor assignment) and `packages/engine/tsconfig.json` gained `"erasableSyntaxOnly": true` in commit `ccf3b05` on `scripts-v4`. Nothing to change here. Verify:

Run: `cd packages/app && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'engine/src'`
Expected: no output (every remaining error is under `src/`).

- [ ] **Step 3: Engine baseline is green before touching the app**

Run: `cd packages/engine && npx vitest run && npx tsc --noEmit`
Expected: all test files pass (224 tests at `ccf3b05`), `tsc` prints nothing.

- [ ] **Step 4: `AbilitySheet` counts scripts, not effects**

`packages/app/src/components/character/AbilitySheet.tsx:51` — replace the summary line:

```tsx
      <div className="mb-3 text-xs text-zinc-500">{ability.scripts.length} script{ability.scripts.length === 1 ? '' : 's'}, {activationsOf(ability).length} activation{activationsOf(ability).length === 1 ? '' : 's'}. Edit the logic in Library.</div>
```

- [ ] **Step 5: `durationRounds` takes one argument now**

`packages/app/src/components/battle/BuffsDrawer.tsx` — line 2 drops `exprVars` (it is used nowhere else in the file and `noUnusedLocals` is on):

```tsx
import { durationRounds, newId, type EvalContext, type Status } from '@hl/engine';
```

and line 23 becomes:

```tsx
    const rounds = durationRounds(duration);
```

- [ ] **Step 6: Situational modifiers measure duration in seconds**

`packages/app/src/components/battle/SituationalSheet.tsx` — import `ROUND` on line 2:

```tsx
import { ROUND, addStatus, type BonusType, type Duration, type EvalContext, type StatId } from '@hl/engine';
```

and line 26 becomes:

```tsx
    const duration: Duration = dur === 'rounds' ? Math.max(1, Number(rounds) || 1) * ROUND : dur === 'untilMyNextTurn' ? 'untilMyNextTurn' : 'encounter';
```

- [ ] **Step 7: Inventory reads `scripts` and unwraps `EquipResult`**

`packages/app/src/screens/InventoryScreen.tsx`:

Line 83 — the "has rules" star on an equipped row:

```tsx
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(e)}><span className="truncate">{entryName(ctx, e)}</span>{itemAbility(ctx, e)?.scripts.length ? <span className="ml-1 text-amber-400">✦</span> : null}</button>
```

Line 112 — the same star in the storage list: replace `{a?.effects.length ? ` with `{a?.scripts.length ? `.

Line 131 — the "Rules & charges" button:

```tsx
            {a && (a.scripts.length > 0 || activationsOf(a).length > 0) && <Button onClick={() => setViewRules(a)}>Rules & charges</Button>}
```

Line 136 — `removeItemInstance` returns an `EquipResult` (it runs the item's `unequip` scripts, so it can also hand back a battle). Add `const setBattle = useStore((s) => s.setBattle);` next to the other store selectors near line 17, then:

```tsx
          <Button variant="danger" onClick={() => { if (confirm(`Remove ${entryName(ctx, e)} from ${c.name}? (stays in the library)`)) { const r = removeItemInstance(ctx, e.id); setCharacter(r.character); if (r.battle) setBattle(r.battle); setOpen(undefined); } }}>Remove from character</Button>
```

While here, `doEquip` and `doUnequip` (lines 30–38) drop the battle the scripts produced; carry it too:

```tsx
  const doEquip = (e: InventoryEntry) => {
    const r = equipItem(ctx, e.id);
    if (!r.ok) {
      if (confirm(`${r.reason}. Replace what is there?`)) { const r2 = equipItem(ctx, e.id, { replace: true }); setCharacter(r2.character); if (r2.battle) setBattle(r2.battle); showToast(`${entryName(ctx, e)} equipped`); }
      return;
    }
    setCharacter(r.character); if (r.battle) setBattle(r.battle); showToast(`${entryName(ctx, e)} equipped`);
  };
  const doUnequip = (e: InventoryEntry) => { const r = unequipItem(ctx, e.id); setCharacter(r.character); if (r.battle) setBattle(r.battle); showToast(`${entryName(ctx, e)} unequipped`); };
```

(`globals` from the same results is wired in Task 4.)

- [ ] **Step 8: The Library list subtitle counts scripts**

`packages/app/src/screens/LibraryScreen.tsx:46`:

```tsx
  if (a.scripts.length) parts.push(`${a.scripts.length} script${a.scripts.length === 1 ? '' : 's'}`);
```

- [ ] **Step 9: Run the compiler again and check only the editors remain**

Run: `npm run typecheck 2>&1 | grep "error TS" | cut -d'(' -f1 | sort -u`
Expected exactly:
```
src/components/library/BlocksEditor.tsx
src/components/library/ConditionEditor.tsx
src/components/library/EffectEditor.tsx
src/components/library/RecordEditor.tsx
src/components/library/ActivationEditor.tsx
src/store/hooks.ts
```
(order may vary; nothing outside `components/library/` and `store/hooks.ts` may appear.)

- [ ] **Step 10: Commit**

```bash
git add packages/engine/src/scripts/api.ts packages/app/src/components packages/app/src/screens
git commit -m "App reads v4 records: scripts instead of effects, seconds durations, EquipResult unwrapped"
```

---

### Task 2: `collectToggles` from the engine's static scan

**Files:**
- Modify: `packages/app/src/store/hooks.ts`

**Interfaces:**
- Consumes: `compile(source: string, paramNames?: string[]): { ok: true; run; toggles: string[]; emits: string[]; noguard: boolean } | { ok: false; error: string; line?: number }` and `activationsOf(a: Ability | undefined): Activation[]`, both from `@hl/engine`.
- Produces: `collectToggles(ctx: EvalContext): { id: string; abilities: string[] }[]` — unchanged signature, so `AttackPanel.tsx:25` keeps working.

- [ ] **Step 1: Replace the block walk with the script scan**

`packages/app/src/store/hooks.ts` — the whole file becomes:

```ts
import { useMemo } from 'react';
import { activationsOf, compile, type EvalContext } from '@hl/engine';
import { useStore } from './store';

export function useCtx(): EvalContext | undefined {
  const character = useStore((s) => s.character);
  const library = useStore((s) => s.library);
  const battle = useStore((s) => s.battle);
  const targetId = useStore((s) => s.targetId);
  return useMemo(() => {
    if (!character) return undefined;
    const target = battle?.combatants.find((c) => c.id === targetId);
    return { character, library, ...(battle ? { battle } : {}), ...(target ? { target } : {}) };
  }, [character, library, battle, targetId]);
}

/**
 * Every manual switch the character's active scripts read (`battle.on('<id>')` or `battle.toggles.<id>`), for the chips above
 * the attack rows. The engine's instrumenter already finds them while compiling, and `compile` caches by
 * source, so re-scanning on every render costs a Map lookup per script.
 */
export function collectToggles(ctx: EvalContext): { id: string; abilities: string[] }[] {
  const map = new Map<string, Set<string>>();
  const scan = (source: string, abilityName: string) => {
    if (!source.trim()) return;
    const c = compile(source);
    if (!c.ok) return;
    for (const id of c.toggles) {
      const e = map.get(id) ?? new Set<string>();
      e.add(abilityName);
      map.set(id, e);
    }
  };
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const a = ctx.library.abilities[inst.abilityId];
    if (!a) continue;
    for (const s of a.scripts) if (s.enabled) scan(s.source, a.name);
    for (const act of activationsOf(a)) for (const s of act.scripts) if (s.enabled) scan(s.source, a.name);
  }
  return [...map.entries()].map(([id, abilities]) => ({ id, abilities: [...abilities] }));
}
```

(Same gating as the v3 version: only the character's own enabled, unsuppressed records — battle-only statuses are deliberately not scanned.)

- [ ] **Step 2: Check the compiler**

Run: `npm run typecheck 2>&1 | grep "error TS" | cut -d'(' -f1 | sort -u`
Expected: only `src/components/library/BlocksEditor.tsx`, `ConditionEditor.tsx`, `EffectEditor.tsx`, `RecordEditor.tsx`, `ActivationEditor.tsx` — `store/hooks.ts` is gone.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/store/hooks.ts
git commit -m "Toggle chips come from the engine's static scan of script sources"
```

---

### Task 3: Scripts replace the block editors

**Files:**
- Create: `packages/app/src/components/library/DurationPicker.tsx`
- Create: `packages/app/src/components/library/ScriptsEditor.tsx`
- Modify: `packages/app/src/components/library/RecordEditor.tsx`
- Modify: `packages/app/src/components/library/ActivationEditor.tsx`
- Delete: `packages/app/src/components/library/BlocksEditor.tsx`, `ConditionEditor.tsx`, `EffectEditor.tsx`, `SelectorPicker.tsx`
- Test: `e2e/builder.spec.ts` (rewrite tests 1 and 3, keep test 2)

**Interfaces:**
- Consumes: `type Script = { id: string; label?: string; events: string[]; source: string; call?: { fn: string; args: Record<string, ArgValue> }; enabled: boolean; priority: number }`, `type Duration = number | 'thisAttack' | 'untilMyNextTurn' | 'encounter' | 'untilRemoved'`, `ROUND`, `MINUTE`, `HOUR`, `DAY` from `@hl/engine`.
- Produces:
  - `DurationPicker({ value, onChange }: { value: Duration; onChange: (d: Duration) => void })`
  - `ScriptsEditor({ value, onChange, addLabel? }: { value: Script[]; onChange: (s: Script[]) => void; addLabel?: string })`
  - `uniqueId(base: string, taken: string[]): string`
  - `newScript(taken: string[]): Script`
  - DOM contract used by later tasks and by e2e: each row is `[data-role="script"]`, its event chips live in `[data-role="script-events"]`, its source box is `[data-role="script-source"]`.

- [ ] **Step 1: Write the failing e2e first**

Replace tests 1 and 3 of `e2e/builder.spec.ts` (keep test 2, "item editor…", exactly as it is) so the file reads:

```ts
import { test, expect } from '@playwright/test';

test('script editor: a new feature stores its source and defaults to always', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Archer');
  await sheet.getByLabel(/^Id/).fill('test-archer');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"]').fill("if (attack.isRanged) bonus('attack', 4)");
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json).toMatchObject({
    id: 'test-archer', name: 'Test Archer', kind: 'feature', acquired: { kind: 'feat' },
    scripts: [{ events: ['always'], source: "if (attack.isRanged) bonus('attack', 4)", enabled: true, priority: 0 }],
    activations: [],
  });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Test Archer')).toBeVisible();
});

test('script editor: events are a multi-select and always is exclusive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Trigger');
  await sheet.getByLabel(/^Id/).fill('test-trigger');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"]').fill("target.mark('shaken', 3 * ROUND)");
  const events = sheet.locator('[data-role="script-events"]');
  await events.getByRole('button', { name: 'hit', exact: true }).click();
  await events.getByRole('button', { name: 'crit', exact: true }).click();
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0]).toMatchObject({ events: ['hit', 'crit'], source: "target.mark('shaken', 3 * ROUND)" });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/builder.spec.ts`
Expected: all three tests fail — the dev server cannot even compile (`BlocksEditor.tsx` imports `Effect`, `EffectBlock`, `Trigger`, which no longer exist).

- [ ] **Step 3: Write the seconds-based `DurationPicker`**

Create `packages/app/src/components/library/DurationPicker.tsx`:

```tsx
import { DAY, HOUR, MINUTE, ROUND, type Duration } from '@hl/engine';
import { inputCls } from '../ui';

const SENTINELS: [string, string][] = [['thisAttack', 'this attack'], ['untilMyNextTurn', 'until my next turn'], ['encounter', 'whole battle'], ['untilRemoved', 'until removed']];
const UNITS: [string, string, number][] = [['rounds', 'N rounds', ROUND], ['minutes', 'N minutes', MINUTE], ['hours', 'N hours', HOUR], ['days', 'N days', DAY]];

/** Durations are seconds (ROUND = 6) or one of four sentinels; the control picks the largest unit that divides evenly. */
export function DurationPicker({ value, onChange }: { value: Duration; onChange: (d: Duration) => void }) {
  const secs = typeof value === 'number' ? value : undefined;
  const unit = secs === undefined ? ROUND : secs % DAY === 0 ? DAY : secs % HOUR === 0 ? HOUR : secs % MINUTE === 0 ? MINUTE : ROUND;
  const count = secs === undefined ? 1 : Math.max(1, Math.round(secs / unit));
  const kind = secs === undefined ? (value as string) : UNITS.find((u) => u[2] === unit)![0];
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <select
        className={inputCls + ' w-auto py-1.5'}
        value={kind}
        onChange={(e) => {
          const u = UNITS.find((x) => x[0] === e.target.value);
          onChange(u ? count * u[2] : (e.target.value as Duration));
        }}
      >
        {SENTINELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        {UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {secs !== undefined && (
        <input
          className={inputCls + ' w-20'}
          inputMode="numeric"
          value={count}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1) * unit)}
        />
      )}
      {secs !== undefined && <span className="text-zinc-500">= {secs}s</span>}
    </div>
  );
}
```

- [ ] **Step 4: Write `ScriptsEditor`**

Create `packages/app/src/components/library/ScriptsEditor.tsx`:

```tsx
import { useState } from 'react';
import type { Script } from '@hl/engine';
import { Button, Chip, inputCls } from '../ui';

/** Events a script may listen to. `always` is the compute phase and cannot be combined with the others. */
export const EVENTS = ['always', 'hit', 'miss', 'crit', 'damaged', 'roundStart', 'roundEnd', 'use', 'equip', 'unequip'] as const;

/** `base` if free, else `base-2`, `base-3`, … Ids must not collide: activation ids double as pool ids. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

export function newScript(taken: string[]): Script {
  return { id: uniqueId('s1', taken), events: ['always'], source: '', enabled: true, priority: 0 };
}

export function ScriptsEditor({ value, onChange, addLabel = '+ add script' }: { value: Script[]; onChange: (s: Script[]) => void; addLabel?: string }) {
  const set = (i: number, patch: Partial<Script>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggleEvent = (i: number, ev: string) => {
    const s = value[i]!;
    const next = ev === 'always'
      ? ['always']
      : s.events.includes(ev) ? s.events.filter((x) => x !== ev) : [...s.events.filter((x) => x !== 'always'), ev];
    set(i, { events: next.length ? next : ['always'] });
  };
  return (
    <div className="space-y-3">
      {value.map((s, i) => (
        <div key={i} data-role="script" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
          <div className="mb-2 flex items-center gap-2">
            <input className={inputCls + ' flex-1 py-1.5'} placeholder="label (names the bonus in the breakdown)" value={s.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} />
            <input className={inputCls + ' w-24 py-1.5'} placeholder="id" value={s.id} onChange={(e) => set(i, { id: e.target.value.trim() })} />
            <button type="button" className="px-2 text-zinc-500" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1" data-role="script-events">
            {EVENTS.map((ev) => <Chip key={ev} tone={ev === 'always' ? 'amber' : 'blue'} active={s.events.includes(ev)} onClick={() => toggleEvent(i, ev)}>{ev}</Chip>)}
            {s.events.filter((e) => e.startsWith('custom:')).map((ev) => <Chip key={ev} tone="green" active onClick={() => toggleEvent(i, ev)}>{ev}</Chip>)}
            <CustomEvent onAdd={(name) => set(i, { events: [...s.events.filter((x) => x !== 'always'), `custom:${name}`] })} />
          </div>
          <textarea data-role="script-source" className={inputCls + ' h-40 font-mono text-xs'} spellCheck={false} placeholder="bonus('attack', 1)" value={s.source} onChange={(e) => set(i, { source: e.target.value })} />
          <div className="mt-1 flex items-center gap-4 text-xs text-zinc-400">
            <label className="flex items-center gap-1"><input type="checkbox" checked={s.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /> enabled</label>
            <label className="flex items-center gap-1">priority <input className={inputCls + ' w-16 py-1'} inputMode="numeric" value={s.priority} onChange={(e) => set(i, { priority: Number(e.target.value) || 0 })} /></label>
          </div>
        </div>
      ))}
      <Button onClick={() => onChange([...value, newScript(value.map((s) => s.id))])}>{addLabel}</Button>
    </div>
  );
}

function CustomEvent({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <Chip tone="green" onClick={() => setOpen(true)}>+ custom…</Chip>;
  return (
    <span className="flex items-center gap-1">
      <input autoFocus className={inputCls + ' w-32 py-1'} placeholder="event name" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
      <Chip tone="green" onClick={() => { if (name) onAdd(name); setName(''); setOpen(false); }}>add</Chip>
    </span>
  );
}
```

- [ ] **Step 5: Rewire `RecordEditor`**

`packages/app/src/components/library/RecordEditor.tsx`:

Lines 1–8 become:

```tsx
import { useState } from 'react';
import { AbilitySchema, ROUND, SLOTS, WeaponMetaSchema, type Ability, type Feature, type Item, type ItemCategory, type Spell, type Status } from '@hl/engine';
import { Button, Chip, Field, cx, inputCls } from '../ui';
import { ScriptsEditor, uniqueId } from './ScriptsEditor';
import { ActivationEditor } from './ActivationEditor';
import { DurationPicker } from './DurationPicker';
import { useStore } from '../../store/store';
```

`freshRecord` (lines 14–22) returns v4 records:

```tsx
export function freshRecord(kind: Ability['kind'], over: Partial<Item['item']> = {}): Ability {
  const id = `${kind}-${Date.now().toString(36)}`;
  switch (kind) {
    case 'feature': return { id, name: '', kind, acquired: { kind: 'feat' }, enabledByDefault: true, scripts: [], activations: [], pools: [] };
    case 'item': return { id, name: '', kind, item: { category: 'gear', tags: [], ...over }, scripts: [], activations: [], pools: [] };
    case 'spell': return { id, name: '', kind, castingAction: 'standard', scripts: [] };
    case 'status': return { id, name: '', kind, harmful: false, scripts: [] };
  }
}
```

Delete the `presets` block (lines 50–53) and every `presets={presets}` prop. Line 74–75 (the section heading and the block list) become:

```tsx
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{{ feature: 'Scripts (while enabled)', item: 'Scripts (while equipped)', spell: 'Scripts (while the spell lasts)', status: 'Scripts (while active)' }[a.kind]}</div>
          <ScriptsEditor value={a.scripts} onChange={(scripts) => set({ scripts })} />
```

Line 84–85 (the activation list and its "+ add activation") become:

```tsx
                {a.activations.map((act, i) => <ActivationEditor key={i} value={act} onChange={(n) => set({ activations: a.activations.map((x, j) => (j === i ? n : x)) } as Partial<Ability>)} onRemove={() => set({ activations: a.activations.filter((_, j) => j !== i) } as Partial<Ability>)} />)}
                <Button onClick={() => set({ activations: [...a.activations, { id: uniqueId(a.id, takenIds), action: 'standard', cost: [], scripts: [] }] } as Partial<Ability>)}>+ add activation</Button>
```

Lines 190 and 199 (`SpellFields`, `StatusFields`) start durations at ten rounds of seconds: replace both `set({ duration: { rounds: 10 } })` with `set({ duration: 10 * ROUND })`.

- [ ] **Step 6: Rewire `ActivationEditor`**

`packages/app/src/components/library/ActivationEditor.tsx` — lines 1–6 become:

```tsx
import type { Activation, Cost } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, Field, inputCls } from '../ui';
import { DurationPicker } from './DurationPicker';
import { ScriptsEditor } from './ScriptsEditor';
```

the signature drops `presets`:

```tsx
export function ActivationEditor({ value, onChange, onRemove }: { value: Activation; onChange: (a: Activation) => void; onRemove: () => void }) {
```

and lines 63–68 (the two block lists) become one script list:

```tsx
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Scripts</div>
      <p className="mb-2 text-xs text-zinc-500">`use` scripts run once when the activation is used; `always` scripts apply for its duration.</p>
      <ScriptsEditor value={value.scripts} onChange={(scripts) => set({ scripts })} addLabel="+ add script" />
```

- [ ] **Step 7: Delete the block editors**

```bash
git rm packages/app/src/components/library/BlocksEditor.tsx packages/app/src/components/library/ConditionEditor.tsx packages/app/src/components/library/EffectEditor.tsx packages/app/src/components/library/SelectorPicker.tsx
```

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no `error TS` lines. (`StatSelect.tsx` stays — `SituationalSheet` still uses it.)

- [ ] **Step 9: Run the e2e**

Run: `npx playwright test e2e/builder.spec.ts e2e/battle-v2.spec.ts`
Expected: 7 passed (3 builder + 4 battle-v2).

- [ ] **Step 10: Run the whole suite once**

Run: `npm run e2e`
Expected: all specs pass.

- [ ] **Step 11: Commit**

```bash
git add -A packages/app/src/components/library e2e/builder.spec.ts
git commit -m "Library edits scripts: one row per script with events, label, priority; block editors deleted"
```

---

### Task 4: The `globals` slice and the Globals tab

**Files:**
- Modify: `packages/app/src/store/store.ts`
- Modify: `packages/app/src/store/hooks.ts`
- Modify: `packages/app/src/screens/LibraryScreen.tsx`
- Modify: `packages/app/src/components/battle/AttackPanel.tsx`, `packages/app/src/screens/BattleScreen.tsx`, `packages/app/src/screens/InventoryScreen.tsx`, `packages/app/src/components/character/ChargesSheet.tsx`, `packages/app/src/screens/CharacterScreen.tsx`
- Create: `packages/app/src/components/library/GlobalsTab.tsx`
- Test: `e2e/globals.spec.ts`

**Interfaces:**
- Consumes: `type VarValue = number | string | boolean`, `type State = { battle: Battle; character: Character; globals?: Record<string, VarValue> }` (returned by `logAttack`, `useAbility`, `undoEvent`, `nextRound`), `EquipResult.globals`, `Library.globals`.
- Produces on the store: `globals: Record<string, VarValue>`, `setGlobals(g: Record<string, VarValue>): void`, `applyState(r: { character?: Character; battle?: Battle; globals?: Record<string, VarValue> }): void`, and `ctxLibrary(s: Store): FullLibrary` (the library object with the globals slice spread over it, memoized by identity).
- Produces: `GlobalsTab()` — no props, reads the store.

**Why a slice and not `library.globals`:** scripts write globals during battle (`setVar`), and the library is the pack content blob that pack updates replace wholesale. Keeping them apart means a `setVar` does not rewrite the library and a pack update cannot silently clobber a value the player's scripts set. The engine only ever reads `ctx.library.globals`, so the slice is spread over the library when the context is built — the spread wins over any pack-seeded value.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/globals.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Globals tab: add, edit, persist, and warn about shadowing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Globals', exact: true }).click();
  await page.getByPlaceholder('name').fill('partySize');
  await page.getByPlaceholder('value').fill('4');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('[data-global="partySize"]');
  await expect(row).toBeVisible();
  await row.getByRole('textbox').fill('5');
  await row.getByRole('textbox').blur();
  // survives a reload (persisted under hl.globals)
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Globals', exact: true }).click();
  await expect(page.locator('[data-global="partySize"]').getByRole('textbox')).toHaveValue('5');
  // a name the character already has is shadowed
  await page.getByPlaceholder('name').fill('trophyMultiplier');
  await page.getByPlaceholder('value').fill('2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('[data-global="trophyMultiplier"]')).toContainText('shadowed');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/globals.spec.ts`
Expected: fails at `getByRole('button', { name: 'Globals' })` — no such tab.

- [ ] **Step 3: Add the slice to the store**

`packages/app/src/store/store.ts`:

Import `VarValue` in the engine import list (line 2–5) and extend the types:

```ts
type State = {
  hydrated: boolean;
  library: FullLibrary;
  globals: Record<string, VarValue>;
  character: Character | undefined;
  battle: Battle | undefined;
  pastBattles: Battle[];
  screen: Screen;
  targetId: string | undefined;
  toast: string | undefined;
};
```

```ts
type Actions = {
  // …existing…
  setGlobals(g: Record<string, VarValue>): void;
  /** Apply what an engine call handed back (character, battle and any globals its scripts wrote). */
  applyState(r: { character?: Character; battle?: Battle; globals?: Record<string, VarValue> }): void;
};
```

Key, initial value and actions:

```ts
const KEYS = { library: 'hl.library', globals: 'hl.globals', character: 'hl.character', battle: 'hl.battle', past: 'hl.pastBattles', screen: 'hl.screen' } as const;
```

```ts
  globals: {},
```

```ts
  setGlobals: (globals) => set({ globals }),
  applyState: (r) => set({ ...(r.character ? { character: r.character } : {}), ...(r.battle ? { battle: r.battle } : {}), ...(r.globals ? { globals: r.globals } : {}) }),
```

In `hydrate`, load the key alongside the others and seed it from the packs on a first run:

```ts
    const [library, globals, character, battle, past, screen] = await Promise.all([
      s.get<FullLibrary>(KEYS.library), s.get<Record<string, VarValue>>(KEYS.globals), s.get<Character>(KEYS.character), s.get<Battle>(KEYS.battle), s.get<Battle[]>(KEYS.past), s.get<Screen>(KEYS.screen),
    ]);
    if (!library) {
      let lib = fullEmpty();
      for (const p of defaultPacks) lib = { ...lib, ...(mergePack(lib, p).library as FullLibrary) };
      const ch = Object.values(lib.characters)[0];
      set({ library: lib, globals: lib.globals, character: ch, hydrated: true, screen: 'battle' });
      return;
    }
```

and in the second `set({ … })` add `globals: globals ?? lib.globals,`.

In `importPack`, keep the player's value and seed new keys from the pack:

```ts
  importPack(pack, opts) {
    const { library, character, globals } = get();
    const m = mergePack(library, pack, opts);
    const lib = { ...fullEmpty(), ...library, ...m.library } as FullLibrary;
    const nextGlobals = opts?.overwrite ? { ...globals, ...m.library.globals } : { ...m.library.globals, ...globals };
    const incoming = pack.characters.find((c) => c.id === character?.id) ?? (character ? undefined : pack.characters[0]);
    set({ library: lib, globals: nextGlobals, ...(incoming && (opts?.overwrite || !character || !m.report.conflicts.some((c) => c.key === `character:${incoming.id}`)) ? { character: incoming } : {}) });
    return m.report;
  },
```

`exportLibraryText` exports the live globals with the pack:

```ts
  exportLibraryText() {
    const { library, globals, character } = get();
    const lib = { ...library, globals, ...(character ? { characters: { ...library.characters, [character.id]: character } } : {}) };
    return JSON.stringify(libraryToPack(lib, { id: 'library-export', name: 'Library export', version: Date.now() }), null, 2);
  },
```

Backup gains a field and a version bump; restore accepts both shapes:

```ts
  exportBackupText() {
    const { library, globals, character, battle, pastBattles } = get();
    return JSON.stringify({ kind: 'hl-backup', version: 2, library, globals, character, battle, pastBattles }, null, 2);
  },
```

```ts
      set({
        library: lib,
        globals: (raw.globals as Record<string, VarValue> | undefined) ?? lib.globals ?? {},
        character: raw.character ? CharacterSchema.parse(raw.character) : undefined,
        battle: raw.battle ? loadBattle(raw.battle, lib) : undefined,
        pastBattles: loadPastBattles(raw.pastBattles, lib),
      });
```

Persistence: add `globals` to `flush` and to the subscriber's change detection.

```ts
  if ('globals' in changed) void st.set(KEYS.globals, changed.globals);
```

```ts
  if (s.globals !== last.globals) changed.globals = s.globals;
```
and add `globals: s.globals,` to the `last = { … }` object.

Finally the composed library and the context selector at the bottom of the file:

```ts
/**
 * `EvalContext.library` with the globals slice spread over it. Memoized by identity because the engine's
 * compute-pass cache keys on the library object: a fresh object every render would defeat it.
 */
let libIn: FullLibrary | undefined;
let globalsIn: Record<string, VarValue> | undefined;
let libOut: FullLibrary | undefined;
export function ctxLibrary(s: { library: FullLibrary; globals: Record<string, VarValue> }): FullLibrary {
  if (s.library !== libIn || s.globals !== globalsIn || !libOut) {
    libIn = s.library; globalsIn = s.globals; libOut = { ...s.library, globals: s.globals };
  }
  return libOut;
}

/** Evaluation context for the engine from current store state. */
export function selectCtx(s: Store): EvalContext | undefined {
  if (!s.character) return undefined;
  const target = s.battle?.combatants.find((c) => c.id === s.targetId);
  return { character: s.character, library: ctxLibrary(s), ...(s.battle ? { battle: s.battle } : {}), ...(target ? { target } : {}) };
}
```

- [ ] **Step 4: `useCtx` uses the composed library**

`packages/app/src/store/hooks.ts` — replace the two selectors and the memo inside `useCtx`:

```ts
export function useCtx(): EvalContext | undefined {
  const character = useStore((s) => s.character);
  const library = useStore((s) => s.library);
  const globals = useStore((s) => s.globals);
  const battle = useStore((s) => s.battle);
  const targetId = useStore((s) => s.targetId);
  return useMemo(() => {
    if (!character) return undefined;
    const target = battle?.combatants.find((c) => c.id === targetId);
    return { character, library: ctxLibrary({ library, globals }), ...(battle ? { battle } : {}), ...(target ? { target } : {}) };
  }, [character, library, globals, battle, targetId]);
}
```

and import `ctxLibrary` alongside `useStore`.

- [ ] **Step 5: Route every engine result through `applyState`**

Replace the paired `setBattle(r.battle); setCharacter(r.character);` calls so the globals a script wrote are not dropped:

- `packages/app/src/components/battle/AttackPanel.tsx` — in `record`, `use`, and the Undo button (lines 34, 39, 103): `const applyState = useStore((s) => s.applyState);` then `applyState(r);`
- `packages/app/src/screens/BattleScreen.tsx:60` — `onClick={() => applyState(nextRound(ctx))}` with `const applyState = useStore((s) => s.applyState);`
- `packages/app/src/screens/InventoryScreen.tsx` — `doEquip`, `doUnequip` and the Remove button: `applyState(r)` instead of `setCharacter`/`setBattle` (an `EquipResult` is assignable to `applyState`'s parameter).
- `packages/app/src/components/character/ChargesSheet.tsx` — `apply` and `resetAll`: `applyState(r)` / `applyState({ character: cur.character, ...(cur.battle ? { battle: cur.battle } : {}) })`.
- `packages/app/src/screens/CharacterScreen.tsx:54-57` — `doRest` becomes `const r = rest(ctx, kind); applyState(r); showToast(r.summary);` (`rest` returns no globals, but one code path is easier to reason about).

Remove now-unused `setCharacter` / `setBattle` selectors from those files (`noUnusedLocals` will tell you).

- [ ] **Step 6: Write the Globals tab**

Create `packages/app/src/components/library/GlobalsTab.tsx`:

```tsx
import { useState } from 'react';
import type { VarValue } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, inputCls } from '../ui';

type Kind = 'number' | 'text' | 'yes/no';
const kindOf = (v: VarValue): Kind => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'yes/no' : 'text');
const coerce = (raw: string, kind: Kind): VarValue => (kind === 'number' ? Number(raw) || 0 : kind === 'yes/no' ? raw === 'true' : raw);

/** Values shared by every character. `vars.<name>` reads the character's var first, then here. */
export function GlobalsTab() {
  const globals = useStore((s) => s.globals);
  const setGlobals = useStore((s) => s.setGlobals);
  const character = useStore((s) => s.character);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<Kind>('number');
  const rows = Object.entries(globals).sort(([a], [b]) => a.localeCompare(b));
  const put = (k: string, v: VarValue) => setGlobals({ ...globals, [k]: v });
  const drop = (k: string) => { const rest = { ...globals }; delete rest[k]; setGlobals(rest); };
  const add = () => {
    const k = name.trim();
    if (!k) return;
    put(k, coerce(value, kind));
    setName(''); setValue('');
  };
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Globals are shared by every character. A script reads <code>vars.name</code>: the character's own var first, then the global. <code>setVar</code> writes the character's var when it has one, otherwise here.</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className={inputCls + ' w-40'} placeholder="name" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
        <input className={inputCls + ' w-32'} placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">{(['number', 'text', 'yes/no'] as Kind[]).map((k) => <Chip key={k} tone="blue" active={kind === k} onClick={() => setKind(k)}>{k}</Chip>)}</div>
      <div className="space-y-1">
        {rows.map(([k, v]) => {
          const shadowed = character !== undefined && Object.hasOwn(character.vars, k);
          return (
            <div key={k} data-global={k} className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2">
              <span className="w-40 shrink-0 truncate font-mono text-sm">{k}</span>
              {typeof v === 'boolean'
                ? <Chip tone="green" active={v} onClick={() => put(k, !v)}>{v ? 'true' : 'false'}</Chip>
                : <input className={inputCls + ' w-28 py-1'} value={String(v)} onChange={(e) => put(k, coerce(e.target.value, kindOf(v)))} />}
              <span className="text-xs text-zinc-500">{kindOf(v)}</span>
              {shadowed && <span className="text-xs text-amber-300">⚠ shadowed by {character!.name}'s own var ({String(character!.vars[k])})</span>}
              <button type="button" className="ml-auto px-2 text-zinc-500" onClick={() => { if (confirm(`Delete global "${k}"?`)) drop(k); }}>✕</button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-zinc-500">No globals yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the tab to the Library screen**

`packages/app/src/screens/LibraryScreen.tsx` — import `GlobalsTab`, then:

```tsx
type Tab = RecordKind | 'tags' | 'monsters' | 'globals';
const TABS: { id: Tab; label: string }[] = [{ id: 'feature', label: 'Features' }, { id: 'item', label: 'Items' }, { id: 'spell', label: 'Spells' }, { id: 'status', label: 'Statuses' }, { id: 'tags', label: 'Tags' }, { id: 'monsters', label: 'Monsters' }, { id: 'globals', label: 'Globals' }];
```

```tsx
      {tab === 'tags' ? <Tags /> : tab === 'monsters' ? <Monsters /> : tab === 'globals' ? <GlobalsTab /> : <RecordsTab key={tab} kind={tab} />}
```

- [ ] **Step 8: Typecheck, build, run the spec**

Run: `npm run typecheck && npm run build && npx playwright test e2e/globals.spec.ts e2e/battle-v2.spec.ts e2e/inventory.spec.ts`
Expected: no TS errors, build succeeds, all specs pass.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src e2e/globals.spec.ts
git commit -m "Globals: own persisted slice composed into the engine context, Library tab with shadowing warning, engine results applied through applyState"
```

---

### Task 5: Script diagnostics — store slice, record badge, Settings list

**Files:**
- Create: `packages/app/src/store/diagnostics.ts`
- Modify: `packages/app/src/store/store.ts`, `packages/app/src/App.tsx`, `packages/app/src/screens/LibraryScreen.tsx`, `packages/app/src/screens/SettingsScreen.tsx`, `packages/app/src/components/library/ScriptsEditor.tsx`, `packages/app/src/components/library/RecordEditor.tsx`
- Test: `e2e/diagnostics.spec.ts`

**Interfaces:**
- Consumes: `diagnostics.errors(): ScriptError[]`, `diagnostics.clear(recordId?: string): void`, `diagnostics.quarantined(key: string): boolean`, `clearComputeCache(): void`, `type ScriptError = { recordId: string; scriptId: string; label: string; phase: 'compile' | 'run'; message: string; line?: number }`, `activationsOf`.
- Produces:
  - `packages/app/src/store/diagnostics.ts`: `quarantinedScripts(abilities: Record<string, Ability>): { key: string; recordId: string; recordName: string; scriptId: string }[]`
  - store: `scriptErrors: ScriptError[]`, `refreshDiagnostics(): void`, `clearScriptErrors(recordId?: string): void`
  - `ScriptsEditor` gains an optional `errors?: ScriptError[]` prop, shown per row.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/diagnostics.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('a script that writes to a read-only value is reported on the record and in Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Broken');
  await sheet.getByLabel(/^Id/).fill('test-broken');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"]').fill('player.mod.cha += 1');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // put it on the sheet so the compute pass runs it
  await page.locator('[data-record="test-broken"]').getByRole('button', { name: 'add' }).click();
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('[data-error="test-broken"]')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/read-only/)).toBeVisible();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/diagnostics.spec.ts`
Expected: fails at `[data-error="test-broken"]` (no badge is rendered).

- [ ] **Step 3: Write the diagnostics reader**

Create `packages/app/src/store/diagnostics.ts`:

```ts
import { activationsOf, diagnostics, type Ability } from '@hl/engine';

export type QuarantineRow = { key: string; recordId: string; recordName: string; scriptId: string };

/**
 * The engine quarantines a script after three failures, keyed `record/activation?/script`. It exposes the
 * test, not the list, so walk the library and ask about every key that exists.
 */
export function quarantinedScripts(abilities: Record<string, Ability>): QuarantineRow[] {
  const out: QuarantineRow[] = [];
  for (const a of Object.values(abilities)) {
    const check = (key: string, scriptId: string) => { if (diagnostics.quarantined(key)) out.push({ key, recordId: a.id, recordName: a.name, scriptId }); };
    for (const s of a.scripts) check(`${a.id}/${s.id}`, s.id);
    for (const act of activationsOf(a)) for (const s of act.scripts) check(`${a.id}/${act.id}/${s.id}`, s.id);
  }
  return out;
}
```

- [ ] **Step 4: Mirror the registry into the store**

`packages/app/src/store/store.ts` — add to `State`, `Actions` and the initial object:

```ts
  scriptErrors: ScriptError[];
```
```ts
  /** Copy the engine's in-memory error registry into the store (identity changes only when it really changed). */
  refreshDiagnostics(): void;
  clearScriptErrors(recordId?: string): void;
```
```ts
  scriptErrors: [],
```
```ts
  refreshDiagnostics() {
    const errors = diagnostics.errors();
    if (errors !== get().scriptErrors) set({ scriptErrors: errors });
  },
  clearScriptErrors(recordId) {
    diagnostics.clear(recordId);
    clearComputeCache();
    set({ scriptErrors: diagnostics.errors() });
  },
```

with `clearComputeCache, diagnostics, type ScriptError` added to the engine import.

- [ ] **Step 5: Pull it after every render**

`packages/app/src/App.tsx` — the registry is filled *during* render (the compute pass runs inside `resolveStat`), so read it in an effect with no dependency array; `refreshDiagnostics` only calls `set` when the array identity changed, so this cannot loop.

```tsx
import { useEffect } from 'react';
```
```tsx
  const refreshDiagnostics = useStore((s) => s.refreshDiagnostics);
  useEffect(() => { refreshDiagnostics(); });
```

- [ ] **Step 6: Badge the record in the Library list**

`packages/app/src/screens/LibraryScreen.tsx` — inside `RecordsTab`, add `const scriptErrors = useStore((s) => s.scriptErrors);`, give the row a stable handle, and badge the name (lines 91–93):

```tsx
          <div key={a.id} data-record={a.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(a)}>
              <div className="truncate">{a.name}{scriptErrors.some((e) => e.recordId === a.id) ? <span data-error={a.id} className="ml-1 text-red-400" title={scriptErrors.filter((e) => e.recordId === a.id).map((e) => e.message).join('\n')}>●</span> : null}</div>
```

- [ ] **Step 7: Show the errors on the script row and clear them on save**

`ScriptsEditor` takes the errors for this record and shows the ones that belong to each row:

```tsx
export function ScriptsEditor({ value, onChange, addLabel = '+ add script', errors = [] }: { value: Script[]; onChange: (s: Script[]) => void; addLabel?: string; errors?: ScriptError[] }) {
```
and inside the row, under the source box:

```tsx
          {errors.filter((e) => e.scriptId === s.id).map((e) => <div key={e.message} className="mt-1 rounded-lg border border-red-900 bg-red-950/40 px-2 py-1 text-xs text-red-200">{e.phase === 'compile' ? 'Does not compile' : 'Failed'}{e.line !== undefined ? ` (line ${e.line})` : ''}: {e.message}</div>)}
```

`RecordEditor` passes them and clears the record's errors when it saves (so a fix is retried and a quarantine lifts):

```tsx
  const scriptErrors = useStore((s) => s.scriptErrors);
  const clearScriptErrors = useStore((s) => s.clearScriptErrors);
```
```tsx
          <ScriptsEditor value={a.scripts} onChange={(scripts) => set({ scripts })} errors={scriptErrors.filter((e) => e.recordId === a.id)} />
```
and in `save()`, immediately before `onSave(parsed)`:

```tsx
      clearScriptErrors(parsed.id);
```

- [ ] **Step 8: List errors and quarantines in Settings**

`packages/app/src/screens/SettingsScreen.tsx` — add a section above "About":

```tsx
      <Section title="Script errors" defaultOpen={s.scriptErrors.length > 0} count={s.scriptErrors.length}>
        {s.scriptErrors.length === 0 ? <p className="text-sm text-zinc-500">No script has failed this session.</p> : (
          <div className="space-y-1">
            {s.scriptErrors.map((e) => (
              <div key={`${e.recordId}/${e.scriptId}/${e.message}`} className="rounded-xl border border-red-900 bg-red-950/30 px-3 py-2 text-sm">
                <div className="text-red-200">{e.label}<span className="ml-2 text-xs text-zinc-500">{e.recordId} · {e.phase}{e.line !== undefined ? ` · line ${e.line}` : ''}</span></div>
                <div className="text-xs text-red-300">{e.message}</div>
              </div>
            ))}
          </div>
        )}
        {quarantinedScripts(s.library.abilities).map((q) => (
          <div key={q.key} className="mt-1 rounded-xl border border-amber-900 px-3 py-2 text-sm text-amber-200">{q.recordName}: script “{q.scriptId}” is paused for this session after three failures.</div>
        ))}
        {s.scriptErrors.length > 0 && <Button className="mt-2" onClick={() => { s.clearScriptErrors(); s.showToast('Script errors cleared'); }}>Clear and retry</Button>}
      </Section>
```

with `import { quarantinedScripts } from '../store/diagnostics';`.

- [ ] **Step 9: Typecheck, build, run the spec**

Run: `npm run typecheck && npm run build && npx playwright test e2e/diagnostics.spec.ts`
Expected: green; the badge and the "read-only" message both appear.

- [ ] **Step 10: Commit**

```bash
git add packages/app/src e2e/diagnostics.spec.ts
git commit -m "Script errors surface: red badge on the record, message on the script row, Settings list with quarantines and a retry"
```

---

### Task 6: Safe mode — boot switch, banner, Settings toggle, auto-trip

**Files:**
- Create: `packages/app/src/boot.ts`
- Modify: `packages/app/src/main.tsx`, `packages/app/src/App.tsx`, `packages/app/src/store/store.ts`, `packages/app/src/screens/SettingsScreen.tsx`
- Test: `e2e/safemode.spec.ts`

**Interfaces:**
- Consumes: `setScriptMode(m: 'on' | 'off'): void`, `getScriptMode(): 'on' | 'off'`, `clearComputeCache(): void`.
- Produces:
  - `packages/app/src/boot.ts`: `armBootGuard(): { safeMode: boolean; autoTripped: boolean }`, `bootSucceeded(): void`, `setSafeMode(on: boolean): void`
  - store: `safeMode: boolean`, `safeModeAuto: boolean`, `setSafeModeState(on: boolean, auto?: boolean): void`

- [ ] **Step 1: Write the failing e2e**

Create `e2e/safemode.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('?safe=1 turns scripts off, the banner turns them back on', async ({ page }) => {
  await page.goto('/?safe=1');
  const banner = page.locator('[data-role="safe-banner"]');
  await expect(banner).toContainText('Scripts are off');
  await page.getByRole('button', { name: 'Turn scripts back on' }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hl.safeMode'))).toBeNull();
});

test('safe mode survives a reload once it is stored, and Settings switches it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('hl.safeMode', '1'));
  await page.reload();
  await expect(page.locator('[data-role="safe-banner"]')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Run scripts' }).click();
  await expect(page.locator('[data-role="safe-banner"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/safemode.spec.ts`
Expected: both fail — `[data-role="safe-banner"]` does not exist.

- [ ] **Step 3: Write the boot module**

Create `packages/app/src/boot.ts`:

```ts
import { clearComputeCache, setScriptMode } from '@hl/engine';

const SAFE = 'hl.safeMode';
const FAILS = 'hl.bootFails';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | undefined): void => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

function requested(): boolean {
  try { if (new URLSearchParams(location.search).get('safe') === '1') return true; } catch { /* no location */ }
  return read(SAFE) === '1';
}

/**
 * Called once before React mounts. Counts boots that never finished: the second one in a row turns safe
 * mode on by itself, which is the "compute pass throws twice at boot" rule — whatever threw, the screen
 * comes back with scripts off instead of white.
 */
export function armBootGuard(): { safeMode: boolean; autoTripped: boolean } {
  const fails = Number(read(FAILS) ?? '0') + 1;
  write(FAILS, String(fails));
  const autoTripped = fails >= 2 && read(SAFE) !== '1';
  const safeMode = autoTripped || requested();
  if (safeMode) { write(SAFE, '1'); setScriptMode('off'); }
  return { safeMode, autoTripped };
}

/** The first render survived: forget the boot-failure count. */
export function bootSucceeded(): void {
  write(FAILS, undefined);
}

/** Turn scripts off (and remember it) or back on. */
export function setSafeMode(on: boolean): void {
  write(SAFE, on ? '1' : undefined);
  setScriptMode(on ? 'off' : 'on');
  clearComputeCache();
}
```

- [ ] **Step 4: Arm it before the first render**

`packages/app/src/main.tsx` — before `void useStore.getState().hydrate();`:

```tsx
import { armBootGuard } from './boot';
```
```tsx
const boot = armBootGuard();
useStore.setState({ safeMode: boot.safeMode, safeModeAuto: boot.autoTripped });
void useStore.getState().hydrate();
```

- [ ] **Step 5: Add the two flags to the store**

`packages/app/src/store/store.ts` — `State` gains `safeMode: boolean; safeModeAuto: boolean;`, the initial object gains `safeMode: false, safeModeAuto: false,` and `Actions` gains:

```ts
  setSafeModeState(on: boolean, auto?: boolean): void;
```
```ts
  setSafeModeState: (safeMode, safeModeAuto = false) => set({ safeMode, safeModeAuto }),
```

(These are session flags: they must **not** be added to the persistence subscriber — the localStorage key in `boot.ts` is their store.)

- [ ] **Step 6: Banner and boot-success marker in `App`**

`packages/app/src/App.tsx`:

```tsx
import { bootSucceeded, setSafeMode } from './boot';
```
```tsx
  const safeMode = useStore((s) => s.safeMode);
  const safeModeAuto = useStore((s) => s.safeModeAuto);
  const setSafeModeState = useStore((s) => s.setSafeModeState);
  useEffect(() => { bootSucceeded(); }, []);
```
and directly inside `<main>` above the screens:

```tsx
        {safeMode && (
          <div data-role="safe-banner" className="m-3 rounded-2xl border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            <div>Scripts are off (safe mode).{safeModeAuto ? ' The app failed to start twice, so they were switched off for you.' : ''} Numbers show base values only.</div>
            <button type="button" className="mt-2 rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950" onClick={() => { setSafeMode(false); setSafeModeState(false); }}>Turn scripts back on</button>
          </div>
        )}
```

- [ ] **Step 7: Settings toggle**

`packages/app/src/screens/SettingsScreen.tsx` — a section above "Script errors":

```tsx
      <Section title="Scripts" defaultOpen>
        <p className="mb-2 text-sm text-zinc-400">Safe mode turns every record's scripts off. Base values still resolve, so a pack that breaks the screen can be fixed instead of reinstalled. It also survives a reload (<code>?safe=1</code> forces it).</p>
        <div className="flex gap-2">
          <Button variant={s.safeMode ? 'default' : 'primary'} onClick={() => { setSafeMode(false); s.setSafeModeState(false); }}>Run scripts</Button>
          <Button variant={s.safeMode ? 'primary' : 'default'} onClick={() => { setSafeMode(true); s.setSafeModeState(true); }}>Safe mode (scripts off)</Button>
        </div>
      </Section>
```

with `import { setSafeMode } from '../boot';`.

- [ ] **Step 8: Typecheck, build, run the specs**

Run: `npm run typecheck && npm run build && npx playwright test e2e/safemode.spec.ts e2e/battle-v2.spec.ts`
Expected: green. (`battle-v2` proves scripts still run in the normal path.)

- [ ] **Step 9: Commit**

```bash
git add packages/app/src e2e/safemode.spec.ts
git commit -m "Safe mode: scripts off before first render from ?safe=1 or storage, auto-trip after two failed boots, banner and Settings switch"
```

---

### Task 7: Pack import asks before running code

**Files:**
- Modify: `packages/app/src/store/store.ts`, `packages/app/src/screens/SettingsScreen.tsx`
- Test: `e2e/import.spec.ts`

**Interfaces:**
- Consumes: `PackSchema.safeParse`, `activationsOf`, `type Pack`.
- Produces: store `packCode(pack: Pack): { scripts: number; functions: number }`; `SettingsScreen` holds `pending: { pack: Pack; overwrite: boolean } | undefined`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/import.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const PACK = JSON.stringify({
  id: 'test-code-pack', name: 'Test code pack', version: 1,
  abilities: [{ id: 'test-imported', name: 'Test Imported', kind: 'feature', scripts: [{ id: 's1', events: ['always'], source: "bonus('init', 1)" }] }],
});

test('a pack carrying scripts asks before importing, and can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('…or paste pack JSON here').fill(PACK);
  await page.getByRole('button', { name: 'Import pasted JSON' }).click();
  const dialog = page.locator('[data-role="code-confirm"]');
  await expect(dialog).toContainText('runs as code');
  await expect(dialog).toContainText('1 script');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Test Imported')).toHaveCount(0);
});

test('confirming imports the pack', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('…or paste pack JSON here').fill(PACK);
  await page.getByRole('button', { name: 'Import pasted JSON' }).click();
  await page.locator('[data-role="code-confirm"]').getByRole('button', { name: 'Import anyway' }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Test Imported')).toBeVisible();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/import.spec.ts`
Expected: both fail — the paste imports straight away, no dialog.

- [ ] **Step 3: Count the code a pack carries**

`packages/app/src/store/store.ts` — a plain exported function (no store state involved):

```ts
/** How much code a pack brings: the numbers the confirmation quotes. `PackSchema` has already parsed the abilities. */
export function packCode(pack: Pack): { scripts: number; functions: number } {
  let scripts = 0;
  for (const a of pack.abilities) {
    scripts += a.scripts.length;
    for (const act of activationsOf(a)) scripts += act.scripts.length;
  }
  return { scripts, functions: pack.functions.length };
}
```

- [ ] **Step 4: Gate both import paths in Settings**

`packages/app/src/screens/SettingsScreen.tsx` — parse first, confirm when there is code, import after:

```tsx
  const [pending, setPending] = useState<{ pack: Pack; overwrite: boolean } | undefined>();

  const offer = (text: string) => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) { setResult(`Import failed:\n${(e as Error).message}`); return; }
    const parsed = PackSchema.safeParse(raw);
    if (!parsed.success) { setResult(`Import failed:\n${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`); return; }
    const code = packCode(parsed.data);
    if (code.scripts || code.functions) { setPending({ pack: parsed.data, overwrite }); return; }
    report({ report: s.importPack(parsed.data, { overwrite }) });
  };
```

with `import { packCode, useStore } from '../store/store';` and `import { PackSchema, type Pack } from '@hl/engine';`. Both buttons call `offer`:

```tsx
          <Button variant="primary" onClick={async () => { const f = await storage().importFile(); if (f) offer(f.text); }}>Pick file…</Button>
```
```tsx
        <Button className="mt-2" onClick={() => { if (paste.trim()) { offer(paste); setPaste(''); } }}>Import pasted JSON</Button>
```

and the confirmation sheet at the end of the screen:

```tsx
      <Sheet open={!!pending} onClose={() => setPending(undefined)} title="This pack runs as code">
        {pending && (() => { const code = packCode(pending.pack); return (
          <div data-role="code-confirm">
            <p className="mb-3 text-sm text-zinc-300"><b>{pending.pack.name}</b> carries {code.scripts} script{code.scripts === 1 ? '' : 's'}{code.functions ? ` and ${code.functions} function${code.functions === 1 ? '' : 's'}` : ''}. Scripts are JavaScript that <b>runs as code</b> on this device with the same trust as the built-in packs. Import it only from a source you trust.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => { report({ report: s.importPack(pending.pack, { overwrite: pending.overwrite }) }); setPending(undefined); }}>Import anyway</Button>
              <Button variant="ghost" onClick={() => setPending(undefined)}>Cancel</Button>
            </div>
          </div>
        ); })()}
      </Sheet>
```

with `Sheet` added to the `../components/ui` import. `s.importText` stays on the store for other callers, unused here.

- [ ] **Step 5: Typecheck, build, run the spec**

Run: `npm run typecheck && npm run build && npx playwright test e2e/import.spec.ts`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src e2e/import.spec.ts
git commit -m "Importing a pack with scripts or functions asks first: it runs as code"
```

---

### Task 8: CodeMirror script editor

**Files:**
- Modify: `packages/app/package.json`
- Create: `packages/app/src/components/library/codemirror.ts`, `packages/app/src/components/library/snippets.ts`, `packages/app/src/components/library/ScriptEditor.tsx`
- Modify: `packages/app/src/components/library/ScriptsEditor.tsx`
- Modify: `e2e/builder.spec.ts`

**Interfaces:**
- Consumes: `API_NAMES: readonly string[]`, `PATHS: { path: string; kind: 'number' | 'boolean' | 'string' | 'list'; doc: string }[]`, `compile(source): { ok: true; … } | { ok: false; error: string; line?: number }`, `type ScriptError`.
- Produces:
  - `codemirror.ts`: `scriptExtensions(opts: { onChange: (v: string) => void; errorsRef: () => ScriptError[] }): Extension[]`
  - `snippets.ts`: `SNIPPETS: { label: string; insert: string }[]`
  - `ScriptEditor.tsx`: `ScriptEditor({ value, onChange, errors }: { value: string; onChange: (v: string) => void; errors: ScriptError[] })`

**Exact dependency pins** (checked against the registry; pin without `^` so a CodeMirror minor cannot change the editor under the app):

```
"@codemirror/autocomplete": "6.20.3"
"@codemirror/commands": "6.11.1"
"@codemirror/lang-javascript": "6.2.5"
"@codemirror/language": "6.12.4"
"@codemirror/lint": "6.9.7"
"@codemirror/state": "6.7.5"
"@codemirror/theme-one-dark": "6.1.3"
"@codemirror/view": "6.43.12"
```

- [ ] **Step 1: Install the pinned packages**

```bash
npm install --workspace packages/app --save-exact @codemirror/state@6.7.5 @codemirror/view@6.43.12 @codemirror/language@6.12.4 @codemirror/commands@6.11.1 @codemirror/lang-javascript@6.2.5 @codemirror/autocomplete@6.20.3 @codemirror/lint@6.9.7 @codemirror/theme-one-dark@6.1.3
```

Run: `grep codemirror packages/app/package.json`
Expected: eight lines, each an exact version with no `^`.

- [ ] **Step 2: Write the extension set**

Create `packages/app/src/components/library/codemirror.ts`:

```ts
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { API_NAMES, PATHS, compile, type ScriptError } from '@hl/engine';

/** Completion from the engine's own vocabulary: every destructured helper plus the documented paths. */
function apiCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [
      ...API_NAMES.map((n) => ({ label: n, type: 'function' as const })),
      ...PATHS.map((p) => ({ label: p.path, type: 'variable' as const, detail: p.kind, info: p.doc })),
    ],
    validFor: /^[\w.]*$/,
  };
}

/** Squiggles from the real compiler, plus whatever the engine recorded for this script. */
function scriptLinter(errorsRef: () => ScriptError[]): Extension {
  return linter((view) => {
    const doc = view.state.doc;
    const at = (line?: number) => doc.line(Math.min(Math.max(line ?? 1, 1), doc.lines));
    const out: Diagnostic[] = [];
    const src = doc.toString();
    if (src.trim()) {
      const c = compile(src);
      if (!c.ok) { const l = at(c.line); out.push({ from: l.from, to: l.to, severity: 'error', message: c.error }); }
    }
    for (const e of errorsRef()) { const l = at(e.line); out.push({ from: l.from, to: l.to, severity: 'error', message: e.message }); }
    return out;
  }, { delay: 300 });
}

/**
 * Deliberately without `closeBrackets`: on a phone (and in Playwright) a typed `)` that may or may not
 * be swallowed makes the box unpredictable, and scripts here are two or three lines long.
 */
export function scriptExtensions(opts: { onChange: (v: string) => void; errorsRef: () => ScriptError[] }): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    indentOnInput(),
    bracketMatching(),
    javascript(),
    oneDark,
    autocompletion({ override: [apiCompletions] }),
    lintGutter(),
    scriptLinter(opts.errorsRef),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
  ];
}
```

- [ ] **Step 3: Write the snippet palette**

Create `packages/app/src/components/library/snippets.ts`:

```ts
/** The shapes the authored packs actually use, one tap each. */
export const SNIPPETS: { label: string; insert: string }[] = [
  { label: 'flat bonus', insert: "bonus('attack', 1);" },
  { label: 'two stats', insert: "bonus(['attack', 'damage'], 1, 'competence');" },
  { label: 'ranged & close', insert: "if (attack.isRanged && target.within(30)) bonus(['attack', 'damage'], 1);" },
  { label: 'vs a type', insert: "if (target.is('aberration')) bonus('damage', 2);" },
  { label: 'switched on', insert: "if (battle.on('sniping')) penalty('attack', 2);" },
  { label: 'after a miss', insert: "if (history('miss', { since: 'round' }) >= 1) bonus('attack', 4);" },
  { label: 'check result', insert: "bonus('attack', tier(ask('knowledge', { per: 'creatureType' }), [15, 1], [20, 2], [Infinity, 3]));" },
  { label: 'attack mode', insert: "attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: 2, kind: 'ranged' });" },
  { label: 'extra attack', insert: "extraAttack(1, { base: 'full' });" },
  { label: 'explicit reason', insert: "need(player.wearing('strong-arm-composite-longbow'), 'the longbow equipped');" },
  { label: 'note', insert: "note('DC {10 + player.level} Will save');" },
  { label: 'on hit: mark', insert: "target.mark('shaken', 3 * ROUND);" },
  { label: 'on use: spend', insert: "charges('monster-blow').use(1);" },
  { label: 'on hit: remember', insert: "setVar('lastHitRound', battle.round);" },
  { label: 'wake another script', insert: "emit('trophyTaken', { id: target.type });" },
];
```

- [ ] **Step 4: Write the editor component**

Create `packages/app/src/components/library/ScriptEditor.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ScriptError } from '@hl/engine';
import { scriptExtensions } from './codemirror';
import { SNIPPETS } from './snippets';

/** One script's source. CodeMirror owns the DOM; React only pushes value changes that came from elsewhere. */
export function ScriptEditor({ value, onChange, errors }: { value: string; onChange: (v: string) => void; errors: ScriptError[] }) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value, extensions: scriptExtensions({ onChange: (t) => onChangeRef.current(t), errorsRef: () => errorsRef.current }) }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // Mount once, deliberately: `value` is pushed in by the effect below, and re-creating the view on
    // every keystroke would lose the cursor.
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  const insert = (text: string) => {
    const v = view.current;
    if (!v) return;
    const at = v.state.selection.main;
    v.dispatch({ changes: { from: at.from, to: at.to, insert: text }, selection: { anchor: at.from + text.length } });
    v.focus();
  };

  return (
    <div>
      <div data-role="script-source" ref={host} className="overflow-hidden rounded-xl border border-zinc-700 text-sm" />
      <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
        {SNIPPETS.map((s) => <button key={s.label} type="button" onClick={() => insert(s.insert)} className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">{s.label}</button>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Swap the textarea for it**

`packages/app/src/components/library/ScriptsEditor.tsx` — replace the `<textarea data-role="script-source" …>` line with:

```tsx
          <ScriptEditor value={s.source} onChange={(source) => set(i, { source })} errors={errors.filter((e) => e.scriptId === s.id)} />
```

and add `import { ScriptEditor } from './ScriptEditor';`. (The `data-role="script-source"` marker moves into `ScriptEditor`, so every other selector stays put.)

- [ ] **Step 6: Point the e2e at CodeMirror**

CodeMirror renders a `contenteditable`, not a `<textarea>`; `fill()` does not drive it. In `e2e/builder.spec.ts` replace the two source lines:

```ts
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("if (attack.isRanged) bonus('attack', 4)");
```

and

```ts
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("target.mark('shaken', 3 * ROUND)");
```

Do the same in `e2e/diagnostics.spec.ts` (`player.mod.cha += 1`).

- [ ] **Step 7: Run the specs**

Run: `npx playwright test e2e/builder.spec.ts e2e/diagnostics.spec.ts`
Expected: 5 passed. If a typed character is swallowed, check that no `closeBrackets`/`autocompletion` accept-on-type extension was added back.

- [ ] **Step 8: Typecheck, build, whole suite**

Run: `npm run typecheck && npm run build && npm run e2e`
Expected: green. The build gains the CodeMirror chunk; `maximumFileSizeToCacheInBytes` is already 6 MB, so the PWA precache is unaffected.

- [ ] **Step 9: Commit**

```bash
git add packages/app e2e
git commit -m "Scripts are edited in CodeMirror: JS mode, dark theme, completion from the engine API and paths, compiler squiggles, snippet palette"
```

---

### Task 9: Preview a script with a probe run

**Files:**
- Create: `packages/app/src/components/library/ScriptPreview.tsx`
- Modify: `packages/app/src/components/library/ScriptsEditor.tsx`, `packages/app/src/components/library/RecordEditor.tsx`

**Interfaces:**
- Consumes: `newSink(): Sink`, `runOne(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[]): 'ok' | 'skipped' | 'error'`, `type Patch`, `type Sink`, `type Ability`, `type Script`, `type EvalContext` — all exported from `@hl/engine`. A probe run (`probe: true`) keeps its errors in the sink, out of the registry and out of the quarantine count; `probeActive: true` pretends the owning activation is running.
- Produces: `ScriptPreview({ ability, script }: { ability: Ability; script: Script })`; `ScriptsEditor` gains `ability?: Ability` and renders a preview per row when it is given.

- [ ] **Step 1: Write the preview**

Create `packages/app/src/components/library/ScriptPreview.tsx`:

```tsx
import { useMemo } from 'react';
import { newSink, runOne, type Ability, type Patch, type Script } from '@hl/engine';
import { useCtx } from '../../store/hooks';

const patchText = (p: Patch): string => {
  switch (p.k) {
    case 'tag': return `${p.to} gains "${p.tag}" (${String(p.duration)})`;
    case 'untag': return `${p.to} loses "${p.tag}"`;
    case 'resource': return `${p.op} ${p.amount} of ${p.id}`;
    case 'grant': return `grants ${p.abilityId}`;
    case 'suppress': return `suppresses ${p.abilityId}`;
    case 'hp': return `${p.op} ${p.amount} hp`;
    case 'reveal': return 'reveals the target';
    case 'setVar': return `${p.name} = ${String(p.value)}`;
    case 'log': return `logs "${p.text}"`;
    case 'emit': return `emits "${p.name}"`;
  }
};

/**
 * Run this one script against the live character and target, into a throwaway sink: what it emits now,
 * or the predicate that stopped it. `probe: true` keeps the run out of the diagnostics registry, so
 * previewing a broken script can never quarantine it.
 */
export function ScriptPreview({ ability, script }: { ability: Ability; script: Script }) {
  const ctx = useCtx();
  const run = useMemo(() => {
    if (!ctx) return undefined;
    const sink = newSink();
    const patches: Patch[] = [];
    const instance = ctx.character.abilities.find((x) => x.abilityId === ability.id);
    const phase = script.events.includes('always') ? 'always' as const : 'event' as const;
    const outcome = runOne(ctx, {
      phase, source: { ability, instance, label: ability.name }, script, probe: true, probeActive: true,
      ...(phase === 'event' ? { event: { kind: script.events[0]! } } : {}),
    }, sink, patches);
    return { sink, patches, outcome };
  }, [ctx, ability, script]);
  if (!run) return null;
  const { sink, patches } = run;
  const rows: string[] = [
    ...sink.bonuses.map((b) => `${b.stat} ${b.value >= 0 ? '+' : ''}${b.value} (${b.bonusType}) — ${b.label}`),
    ...sink.sets.map((s) => `${s.stat} set to ${s.value}`),
    ...sink.multipliers.map((m) => `${m.stat} ×${m.factor}`),
    ...sink.dice.map((d) => `${d.dice} ${d.label}${d.damageType ? ` (${d.damageType})` : ''}`),
    ...sink.modes.map((m) => `attack mode "${m.label}"`),
    ...sink.extraAttacks.map((e) => `+${e.n} attack on a ${e.base} attack`),
    ...sink.naturals.map((n) => `natural attack ${n.name} ${n.dice}`),
    ...Object.entries(sink.flags).filter(([, v]) => v).map(([k]) => `flag ${k}`),
    ...Object.entries(sink.slots).map(([k, v]) => `+${v} ${k} slot`),
    ...sink.notes.map((n) => `note: ${n.text}`),
    ...sink.prompts.map((p) => `asks for a ${p.promptId} check`),
    ...patches.map(patchText),
  ];
  return (
    <div data-role="script-preview" className="mt-1 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs">
      <div className="mb-1 uppercase tracking-wide text-zinc-500">Right now</div>
      {rows.map((r) => <div key={r} className="text-emerald-300">{r}</div>)}
      {sink.skipped.map((s) => <div key={s.failed} className="text-zinc-500">does not apply — needs {s.failed}</div>)}
      {sink.errors.map((e) => <div key={e.message} className="text-red-300">{e.message}</div>)}
      {rows.length === 0 && sink.skipped.length === 0 && sink.errors.length === 0 && <div className="text-zinc-500">nothing, with the current character, battle and target</div>}
    </div>
  );
}
```

- [ ] **Step 2: Show it under each script row**

`ScriptsEditor` signature gains `ability?: Ability`, and the row renders `{ability && <ScriptPreview ability={ability} script={s} />}` after the error list. `RecordEditor` passes `ability={a}` on its `<ScriptsEditor …>` — `ActivationEditor` does not (the activation's scripts belong to a record the editor does not own; the preview there would need the record, and the Library preview on the record covers the case).

- [ ] **Step 3: Check the compiler and the editor still works**

Run: `npm run typecheck && npm run build && npx playwright test e2e/builder.spec.ts`
Expected: green; the JSON round-trips are unchanged.

- [ ] **Step 4: Eyeball it once**

Run: `npm run dev -w packages/app -- --port 5173`, open Library › Features › Woodland Archer.
Expected: under its script, "does not apply — needs …" with no target, because the probe ran against the live context.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/library
git commit -m "Library previews a script: probe run shows what it emits now or the predicate that stopped it"
```

---

### Task 10: `FunctionCallForm` — a stored call edited as a form

**Files:**
- Create: `packages/app/src/components/library/FunctionCallForm.tsx`
- Modify: `packages/app/src/components/library/ScriptsEditor.tsx`
- Test: `e2e/builder.spec.ts` (one new test)

**Interfaces:**
- Consumes: `type FunctionDef = { id: string; name: string; description?: string; params: { name: string; type: ParamType; label?: string; default?: number | string | boolean | string[]; required: boolean }[]; source: string }`, `type ArgValue = { k: 'lit'; v: number | string | boolean | string[] } | { k: 'ref'; v: string } | { k: 'expr'; v: string }`, `BonusTypeSchema.options`, `PATHS`, `type Script['call']`.
- Produces: `FunctionCallForm({ value, onChange }: { value: NonNullable<Script['call']>; onChange: (c: NonNullable<Script['call']>) => void })`.

- [ ] **Step 1: Write the failing e2e**

Append to `e2e/builder.spec.ts`:

```ts
test('call form: a stored function call round-trips through the form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Caller');
  await sheet.getByLabel(/^Id/).fill('test-caller');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.getByRole('button', { name: 'call a function' }).click();
  await sheet.locator('[data-role="call-fn"]').selectOption('favoredEnemy');
  await sheet.locator('[data-role="arg-amount"] input').fill('4');
  await sheet.locator('[data-role="arg-types"] button', { hasText: 'ƒx' }).click();
  await sheet.locator('[data-role="arg-types"] input').fill('params.types');
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0].call).toEqual({ fn: 'favoredEnemy', args: { types: { k: 'expr', v: 'params.types' }, amount: { k: 'lit', v: 4 } } });
  // and back: reopening the form shows the same values
  await sheet.getByRole('button', { name: 'Feature' }).click();
  await expect(sheet.locator('[data-role="arg-amount"] input')).toHaveValue('4');
  await expect(sheet.locator('[data-role="arg-types"] input')).toHaveValue('params.types');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/builder.spec.ts -g "call form"`
Expected: fails at `getByRole('button', { name: 'call a function' })`.

- [ ] **Step 3: Write the form**

Create `packages/app/src/components/library/FunctionCallForm.tsx`:

```tsx
import { BonusTypeSchema, PATHS, type ArgValue, type Script } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, cx, inputCls } from '../ui';
import { StatSelect } from './StatSelect';
import { DurationPicker } from './DurationPicker';

type Call = NonNullable<Script['call']>;
const EVENTS = ['always', 'hit', 'miss', 'crit', 'damaged', 'roundStart', 'roundEnd', 'use', 'equip', 'unequip'];

const litOf = (a: ArgValue | undefined, fallback: number | string | boolean | string[]) => (a?.k === 'lit' ? a.v : fallback);

/**
 * A stored `script.call`: the function's typed parameters as form controls, each with an ƒx switch that
 * turns the box into a raw expression (`{ k: 'expr' }`). `path`-typed parameters store `{ k: 'ref' }`.
 */
export function FunctionCallForm({ value, onChange }: { value: Call; onChange: (c: Call) => void }) {
  const functions = useStore((s) => s.library.functions);
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const def = functions[value.fn];
  const setArg = (name: string, a: ArgValue | undefined) => {
    const args = { ...value.args };
    if (a === undefined) delete args[name]; else args[name] = a;
    onChange({ ...value, args });
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
      <select data-role="call-fn" className={inputCls} value={value.fn} onChange={(e) => onChange({ fn: e.target.value, args: {} })}>
        <option value="">— pick a function —</option>
        {Object.values(functions).sort((a, b) => a.name.localeCompare(b.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {def?.description && <p className="mt-1 text-xs text-zinc-500">{def.description}</p>}
      {def?.params.map((p) => {
        const arg = value.args[p.name];
        const raw = arg?.k === 'expr' || arg?.k === 'ref';
        const kind = p.type === 'path' || p.type === 'ref' ? 'ref' as const : 'expr' as const;
        return (
          <div key={p.name} data-role={`arg-${p.name}`} className="mt-2">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
              <span>{p.label ?? p.name}{p.required ? ' *' : ''}</span>
              <span className="text-zinc-600">{p.type}</span>
              <button type="button" onClick={() => setArg(p.name, raw ? { k: 'lit', v: (p.default ?? (p.type === 'number' ? 0 : '')) } : { k: kind, v: String(litOf(arg, '')) })} className={cx('ml-auto rounded-full border px-2 py-0.5', raw ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-400')}>ƒx</button>
            </div>
            {raw ? (
              <input className={inputCls + ' font-mono text-sm'} list="hl-paths" placeholder="player.mod.str" value={String(arg.v)} onChange={(e) => setArg(p.name, { k: kind, v: e.target.value })} />
            ) : p.type === 'number' ? (
              <input className={inputCls} inputMode="numeric" value={String(litOf(arg, p.default ?? 0))} onChange={(e) => setArg(p.name, { k: 'lit', v: Number(e.target.value) || 0 })} />
            ) : p.type === 'bool' ? (
              <Chip tone="green" active={!!litOf(arg, p.default ?? false)} onClick={() => setArg(p.name, { k: 'lit', v: !litOf(arg, false) })}>{litOf(arg, false) ? 'true' : 'false'}</Chip>
            ) : p.type === 'stat' ? (
              <StatSelect value={String(litOf(arg, p.default ?? 'attack'))} onChange={(v) => setArg(p.name, { k: 'lit', v })} />
            ) : p.type === 'bonusType' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'untyped'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{BonusTypeSchema.options.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            ) : p.type === 'duration' ? (
              <DurationPicker value={typeof litOf(arg, p.default ?? 'encounter') === 'number' ? (litOf(arg, 0) as number) : (litOf(arg, 'encounter') as 'encounter')} onChange={(d) => setArg(p.name, { k: 'lit', v: d })} />
            ) : p.type === 'tag' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}><option value="">— pick tag —</option>{Object.values(tags).sort((a, b) => a.label.localeCompare(b.label)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
            ) : p.type === 'tags' ? (
              <div className="flex flex-wrap gap-1">
                {Object.values(tags).filter((t) => t.category === 'creatureType').map((t) => {
                  const list = (litOf(arg, (p.default as string[] | undefined) ?? []) as string[]);
                  return <Chip key={t.id} tone="amber" active={list.includes(t.id)} onClick={() => setArg(p.name, { k: 'lit', v: list.includes(t.id) ? list.filter((x) => x !== t.id) : [...list, t.id] })}>{t.label}</Chip>;
                })}
              </div>
            ) : p.type === 'recordId' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}><option value="">— pick record —</option>{Object.values(abilities).sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            ) : p.type === 'event' ? (
              <select className={inputCls} value={String(litOf(arg, p.default ?? 'always'))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })}>{EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}</select>
            ) : (
              <input className={inputCls} placeholder={p.type === 'dice' ? '1d6' : ''} value={String(litOf(arg, p.default ?? ''))} onChange={(e) => setArg(p.name, { k: 'lit', v: e.target.value })} />
            )}
          </div>
        );
      })}
      <datalist id="hl-paths">{PATHS.map((p) => <option key={p.path} value={p.path} />)}</datalist>
    </div>
  );
}
```

- [ ] **Step 4: Let a script row switch between code and a call**

In `ScriptsEditor`, above the source box:

```tsx
          <div className="mb-1 flex gap-1">
            <Chip active={!s.call} onClick={() => set(i, { call: undefined })}>code</Chip>
            <Chip active={!!s.call} onClick={() => set(i, { call: s.call ?? { fn: '', args: {} } })}>call a function</Chip>
          </div>
```

and render one or the other:

```tsx
          {s.call
            ? <FunctionCallForm value={s.call} onChange={(call) => set(i, { call })} />
            : <ScriptEditor value={s.source} onChange={(source) => set(i, { source })} errors={errors.filter((e) => e.scriptId === s.id)} />}
```

(`source` stays as the user left it; the engine prefers `call` when it is present — `runOne` builds the source from it — and the JSON keeps both, which is what makes the switch non-destructive.)

- [ ] **Step 5: Run the spec**

Run: `npx playwright test e2e/builder.spec.ts`
Expected: 4 passed.

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/components/library e2e/builder.spec.ts
git commit -m "A script can be a stored function call: typed parameter form with an fx switch per box"
```

---

### Task 11: Functions tab

**Files:**
- Create: `packages/app/src/components/library/FunctionsTab.tsx`
- Modify: `packages/app/src/screens/LibraryScreen.tsx`

**Interfaces:**
- Consumes: `FunctionDefSchema`, `type FunctionDef`, `ParamTypeSchema.options`, `activationsOf`, and `ScriptEditor` from Task 8.
- Produces: `FunctionsTab()`; `usedBy(abilities: Record<string, Ability>, fnId: string): string[]` (record names).

- [ ] **Step 1: Write the tab**

Create `packages/app/src/components/library/FunctionsTab.tsx`:

```tsx
import { useState } from 'react';
import { FunctionDefSchema, ParamTypeSchema, activationsOf, type Ability, type FunctionDef } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Field, Sheet, inputCls } from '../ui';
import { ScriptEditor } from './ScriptEditor';

/** Records that call this function, whether through a stored `call` or a `fn.x(…)` / `fn["x"](…)` in a source. */
export function usedBy(abilities: Record<string, Ability>, fnId: string): string[] {
  const esc = fnId.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const re = new RegExp(`fn\\s*(?:\\.\\s*${esc}\\b|\\[\\s*['"\`]${esc}['"\`]\\s*\\])`);
  const out: string[] = [];
  for (const a of Object.values(abilities)) {
    const scripts = [...a.scripts, ...activationsOf(a).flatMap((x) => x.scripts)];
    if (scripts.some((s) => s.call?.fn === fnId || re.test(s.source))) out.push(a.name);
  }
  return out.sort((x, y) => x.localeCompare(y));
}

export function FunctionsTab() {
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState<FunctionDef | undefined>();
  const [err, setErr] = useState<string | undefined>();
  const list = Object.values(library.functions).sort((a, b) => a.name.localeCompare(b.name));
  const save = () => {
    if (!editing) return;
    try {
      const f = FunctionDefSchema.parse(editing);
      setLibrary({ ...library, functions: { ...library.functions, [f.id]: f } });
      setEditing(undefined); setErr(undefined); showToast('Saved');
    } catch (e) { setErr((e as Error).message); }
  };
  const patch = (p: Partial<FunctionDef>) => setEditing({ ...editing!, ...p });
  return (
    <div>
      <p className="mb-2 text-sm text-zinc-400">A function is a shared script body with typed parameters. Records call it with <code>fn.name({'{ … }'})</code> or through the call form.</p>
      <div className="mb-3"><Button onClick={() => setEditing({ id: `fn-${Date.now().toString(36)}`, name: '', params: [], source: '' })}>+ New function</Button></div>
      <div className="space-y-1">
        {list.map((f) => {
          const users = usedBy(library.abilities, f.id);
          return (
            <button key={f.id} type="button" data-function={f.id} onClick={() => setEditing(f)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-left">
              <span className="min-w-0"><span className="truncate">{f.name}</span><span className="block truncate text-xs text-zinc-500">{f.id}({f.params.map((p) => p.name).join(', ')}) · {users.length ? `used by ${users.join(', ')}` : 'not used yet'}</span></span>
              <span className="text-zinc-600">›</span>
            </button>
          );
        })}
        {list.length === 0 && <p className="text-sm text-zinc-500">No functions yet.</p>}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.name || 'Function'} tall>
        {editing && (
          <div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" htmlFor="fn-name"><input id="fn-name" className={inputCls} value={editing.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
              <Field label="Id (used in fn.<id>)" htmlFor="fn-id"><input id="fn-id" className={inputCls} value={editing.id} onChange={(e) => patch({ id: e.target.value.trim() })} /></Field>
            </div>
            <Field label="Description"><textarea className={inputCls} value={editing.description ?? ''} onChange={(e) => patch({ description: e.target.value || undefined })} /></Field>
            <Field label="Parameters">
              {editing.params.map((p, i) => (
                <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
                  <input className={inputCls + ' w-28 py-1.5'} placeholder="name" value={p.name} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)) })} />
                  <select className={inputCls + ' w-auto py-1.5'} value={p.type} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof p.type } : x)) })}>{ParamTypeSchema.options.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <input className={inputCls + ' w-28 py-1.5'} placeholder="label" value={p.label ?? ''} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) })} />
                  <label className="flex items-center gap-1 text-xs text-zinc-400"><input type="checkbox" checked={p.required} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> required</label>
                  <button type="button" className="px-2 text-zinc-500" onClick={() => patch({ params: editing.params.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <button type="button" className="text-sm text-amber-300" onClick={() => patch({ params: [...editing.params, { name: `p${editing.params.length + 1}`, type: 'number', required: false }] })}>+ add parameter</button>
            </Field>
            <Field label="Body (parameters are bare names)"><ScriptEditor value={editing.source} onChange={(source) => patch({ source })} errors={[]} /></Field>
            <div className="mb-3 text-xs text-zinc-500">Used by: {usedBy(library.abilities, editing.id).join(', ') || 'nothing yet'}</div>
            {err && <pre className="mb-2 whitespace-pre-wrap text-xs text-red-300">{err}</pre>}
            <div className="flex gap-2">
              <Button variant="primary" onClick={save}>Save</Button>
              {library.functions[editing.id] && <Button variant="danger" className="ml-auto" onClick={() => { const users = usedBy(library.abilities, editing.id); if (confirm(users.length ? `${editing.name} is called by ${users.join(', ')}. Delete anyway?` : `Delete ${editing.name}?`)) { const rest = { ...library.functions }; delete rest[editing.id]; setLibrary({ ...library, functions: rest }); setEditing(undefined); } }}>Delete</Button>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 2: Add the tab**

`packages/app/src/screens/LibraryScreen.tsx` — extend `Tab` with `'functions'`, add `{ id: 'functions', label: 'Functions' }` to `TABS` after Globals, and add the branch:

```tsx
      {tab === 'tags' ? <Tags /> : tab === 'monsters' ? <Monsters /> : tab === 'globals' ? <GlobalsTab /> : tab === 'functions' ? <FunctionsTab /> : <RecordsTab key={tab} kind={tab} />}
```

- [ ] **Step 3: Typecheck, build, and check the bundled functions show their callers**

Run: `npm run typecheck && npm run build`
Expected: green.

Run: `npm run dev -w packages/app -- --port 5173`, open Library › Functions.
Expected: three rows — `haste`, `favoredEnemy` (both from `core-3.5e`) and `trophy` (from `memento`); `favoredEnemy` lists the ranger favored-enemy records under "used by", `trophy` lists the Monster Hunter trophy items.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src
git commit -m "Library › Functions: list with callers, editor with a parameter table and a CodeMirror body"
```

---

### Task 12: Long-press reveals the path

**Files:**
- Create: `packages/app/src/hooks/usePathLongPress.ts`, `packages/app/src/components/PathToast.tsx`
- Modify: `packages/app/src/store/store.ts`, `packages/app/src/App.tsx`, `packages/app/src/screens/CharacterScreen.tsx`, `packages/app/src/components/character/ChargesSheet.tsx`, `packages/app/src/screens/InventoryScreen.tsx`, `packages/app/src/components/battle/AttackPanel.tsx`
- Test: `e2e/paths.spec.ts`

**Interfaces:**
- Consumes: `describePath(path: string, names?: { skills?: Record<string, string>; tags?: Record<string, string> }): string`.
- Produces:
  - store: `pathToast: { path: string; label?: string } | undefined`, `showPath(path: string, label?: string): void`, `hidePath(): void`
  - `usePathLongPress(path: string, label?: string)` → props to spread on any element: `{ onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onContextMenu }`
  - `PathToast()` — rendered once in `App`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/paths.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

async function longPress(page: import('@playwright/test').Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
}

test('long-press on a skill reveals its script path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Skills/ }).click(); // sections start collapsed
  await longPress(page, '[data-path="player.skills.spot.total"]');
  const toast = page.locator('[data-role="path-toast"]');
  await expect(toast).toContainText('player.skills.spot.total');
  await expect(toast.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('long-press on an ability score reveals its path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Stats/ }).click();
  await longPress(page, '[data-path="player.stats.dex"]');
  await expect(page.locator('[data-role="path-toast"]')).toContainText('player.stats.dex');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/paths.spec.ts`
Expected: both fail — no `[data-path]` attributes exist.

- [ ] **Step 3: Store slice**

`packages/app/src/store/store.ts` — `State` gains `pathToast: { path: string; label?: string } | undefined;` (initial `undefined`), `Actions` gains:

```ts
  showPath(path: string, label?: string): void;
  hidePath(): void;
```
```ts
  showPath: (path, label) => set({ pathToast: { path, ...(label ? { label } : {}) } }),
  hidePath: () => set({ pathToast: undefined }),
```

(Not persisted: leave it out of the subscriber.)

- [ ] **Step 4: The hook**

Create `packages/app/src/hooks/usePathLongPress.ts`:

```ts
import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';

const HOLD_MS = 500;

/**
 * Hold any number for half a second to see the path a script would read it with. Spread the returned
 * props on the element; it never swallows the tap, so the element's own onClick still works.
 */
export function usePathLongPress(path: string, label?: string) {
  const showPath = useStore((s) => s.showPath);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined; } };
  useEffect(() => cancel, []);
  return {
    'data-path': path,
    onPointerDown: () => { cancel(); timer.current = setTimeout(() => showPath(path, label), HOLD_MS); },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
```

- [ ] **Step 5: The toast**

Create `packages/app/src/components/PathToast.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { describePath } from '@hl/engine';
import { useStore } from '../store/store';

/** What a script would call this number, with a Copy button. Auto-hides after six seconds. */
export function PathToast() {
  const pathToast = useStore((s) => s.pathToast);
  const hidePath = useStore((s) => s.hidePath);
  const skills = useStore((s) => s.library.skills);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!pathToast) return;
    setCopied(false);
    const t = setTimeout(hidePath, 6000);
    return () => clearTimeout(t);
  }, [pathToast, hidePath]);
  if (!pathToast) return null;
  const names = Object.fromEntries(Object.values(skills).map((s) => [s.id, s.name]));
  const copy = async () => {
    try { await navigator.clipboard.writeText(pathToast.path); } catch { /* insecure context */ }
    setCopied(true);
  };
  return (
    <div data-role="path-toast" className="fixed bottom-24 left-1/2 z-50 w-[92%] max-w-md -translate-x-1/2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{pathToast.label ?? describePath(pathToast.path, { skills: names })}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-amber-200">{pathToast.path}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1 text-sm text-zinc-100">{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={hidePath} aria-label="Dismiss" className="shrink-0 px-2 text-zinc-500">✕</button>
      </div>
    </div>
  );
}
```

`packages/app/src/App.tsx` renders `<PathToast />` next to the existing `{toast && …}` line.

- [ ] **Step 6: Wire it onto the numbers**

React forbids a hook inside a `.map`, so each repeated row becomes a tiny component. Every one of them only spreads the hook's props — no behaviour changes.

`packages/app/src/screens/CharacterScreen.tsx` — add `import { usePathLongPress } from '../hooks/usePathLongPress';`, then three components at the bottom of the file:

```tsx
function AbilityTile({ k, eff, raw, onPick }: { k: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; eff: number; raw: number; onPick: () => void }) {
  const press = usePathLongPress(`player.stats.${k}`);
  return (
    <button type="button" onClick={onPick} {...press} className="rounded-xl bg-zinc-900 py-1 active:bg-zinc-800">
      <div className="text-[10px] uppercase text-zinc-500">{k}</div>
      <div className={cx('font-bold', eff !== raw && 'text-amber-300')}>{eff}</div>
      <div className="text-xs text-zinc-400">{signed(Math.floor((eff - 10) / 2))}{eff !== raw ? <span className="text-zinc-600"> ({raw})</span> : null}</div>
    </button>
  );
}

function StatTile({ id, label, total, onPick }: { id: StatId; label: string; total: number; onPick: () => void }) {
  const press = usePathLongPress(`player.stats.${id}`);
  return (
    <button type="button" onClick={onPick} {...press} className="rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-center active:bg-zinc-800">
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="text-xl font-bold tabular-nums">{id === 'speed' || id.startsWith('ac') ? total : signed(total)}</div>
    </button>
  );
}

function SkillRow({ id, name, total, ranks, classSkill, trainedOnly, onPick }: { id: string; name: string; total: number; ranks: number; classSkill: boolean; trainedOnly: boolean; onPick: () => void }) {
  const press = usePathLongPress(`player.skills.${id}.total`);
  const usable = ranks > 0 || !trainedOnly;
  return (
    <button type="button" onClick={onPick} {...press} className={cx('flex w-full items-center justify-between px-3 py-1.5 text-left text-sm', !usable && 'text-zinc-600', usable && ranks === 0 && 'text-zinc-400')}>
      <span>{name}<span className="ml-2 text-xs text-zinc-500">{ranks ? `${ranks} ranks` : ''}{classSkill ? '' : ' · cross-class'}{trainedOnly && !ranks ? ' · trained only' : ''}</span></span>
      <span className="font-semibold tabular-nums">{usable ? signed(total) : '—'}</span>
    </button>
  );
}
```

and the three call sites (lines 93–95, 98, 106–111) become:

```tsx
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => <AbilityTile key={k} k={k} eff={scores[k]} raw={c.abilityScores[k]} onPick={() => setStat(`ability.${k}`)} />)}
```

```tsx
          {stats.map((s) => <StatTile key={s.id} id={s.id} label={s.label} total={resolveStat(ctx, s.id).total} onPick={() => setStat(s.id)} />)}
```

```tsx
          {skillRows.map((s) => <SkillRow key={s.id} id={s.id} name={s.name} total={resolveStat(ctx, `skill.${s.id}`).total} ranks={c.skills[s.id]?.ranks ?? 0} classSkill={isClassSkill(s.id)} trainedOnly={s.trainedOnly} onPick={() => setStat(`skill.${s.id}`)} />)}
```

HP is not in a loop, so the hooks go at the top of `CharacterScreen` next to the other hooks (before the `if (!ctx || !derived)` early return):

```tsx
  const hpPress = usePathLongPress('player.hp.current');
  const hpMaxPress = usePathLongPress('player.hp.max');
```

and lines 72–73 spread them:

```tsx
          <span {...hpPress} className={cx('text-4xl font-bold tabular-nums', c.hp.current <= 0 ? 'text-red-400' : c.hp.current * 2 <= hpMax ? 'text-amber-300' : 'text-emerald-300')}>{c.hp.current}</span>
          <button type="button" {...hpMaxPress} className="text-zinc-400 mb-1" onClick={() => setStat('hp.max')}>/ {hpMax}</button>
```

`packages/app/src/components/character/ChargesSheet.tsx` — extract the row:

```tsx
function ChargeRow({ row, onBattleOnly, onApply }: { row: ChargeRow; onBattleOnly: boolean; onApply: (used: number) => void }) {
  const press = usePathLongPress(`player.left('${row.id}')`, `${row.label} left`);
  const perLabel = { round: 'per round', encounter: 'per battle', day: 'per day', never: 'no reset' } as const;
  return (
    <div data-charge={row.id} {...press} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.label}</div>
          <div className="truncate text-xs text-zinc-500">{row.ownerName !== row.label ? `${row.ownerName} · ` : ''}{perLabel[row.resetOn]}</div>
        </div>
        <div className={cx('text-xl font-bold tabular-nums', row.remaining === 0 ? 'text-red-400' : 'text-emerald-300')}>{row.remaining}<span className="text-sm text-zinc-500">/{row.max}</span></div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={onBattleOnly || row.remaining <= 0} onClick={() => onApply(row.used + 1)}>− use</Button>
        <Button size="sm" disabled={onBattleOnly || row.used <= 0} onClick={() => onApply(row.used - 1)}>+ restore</Button>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={onBattleOnly || row.used === 0} onClick={() => onApply(0)}>Reset</Button>
      </div>
      {onBattleOnly && <div className="mt-1 text-xs text-zinc-500">Tracked during a battle.</div>}
    </div>
  );
}
```

with `import { listCharges, setChargesUsed, type ChargeRow as ChargeRowData, type EvalContext } from '@hl/engine';` (rename the prop's type to `ChargeRowData` so it does not clash with the component name — adjust the signature to `row: ChargeRowData`) and the map becoming:

```tsx
        {rows.map((r) => <ChargeRow key={r.id} row={r} onBattleOnly={(r.resetOn === 'round' || r.resetOn === 'encounter') && !ctx.battle} onApply={(used) => apply(r.id, used)} />)}
```

`packages/app/src/screens/InventoryScreen.tsx` — one component used by both lists:

```tsx
/** The item's name, long-pressable for the path a script checks it with. */
function ItemName({ abilityId, name }: { abilityId?: string; name: string }) {
  const press = usePathLongPress(`player.wearing('${abilityId ?? ''}')`, name);
  return <span {...(abilityId ? press : {})} className="truncate">{name}</span>;
}
```

Line 83 uses `<ItemName abilityId={e.abilityId} name={entryName(ctx, e)} />` in place of `<span className="truncate">{entryName(ctx, e)}</span>`, and line 112 wraps `{entryName(ctx, e)}` the same way.

`packages/app/src/components/battle/AttackPanel.tsx` — `Chip` does not forward DOM props, so the toggle chip is wrapped:

```tsx
function ToggleChip({ id, on, onToggle }: { id: string; on: boolean; onToggle: () => void }) {
  const press = usePathLongPress(`battle.toggles.${id}`);
  return <span {...press}><Chip tone="amber" active={on} onClick={onToggle}>{humanize(id)}</Chip></span>;
}

function PromptRow({ request, label, disabled, onOpen }: { request: PromptRequest; label: string; disabled: boolean; onOpen: () => void }) {
  const press = usePathLongPress(`battle.prompts.${request.promptId}`);
  return (
    <button type="button" {...press} disabled={disabled} onClick={onOpen} className="block w-full rounded-xl border border-amber-800 bg-amber-950/40 px-3 py-2 text-left text-sm text-amber-200 disabled:opacity-60">
      🎲 {label} <span className="underline">enter result</span>
    </button>
  );
}
```

with `type PromptRequest` added to the `@hl/engine` import, and the two maps becoming:

```tsx
          {toggles.map((t) => <ToggleChip key={t.id} id={t.id} on={!!battle.toggles[t.id]} onToggle={() => setToggle(t.id, !battle.toggles[t.id])} />)}
```

```tsx
          {result.promptsNeeded.map((p) => <PromptRow key={p.source + p.promptId} request={p} label={`${p.sourceName}: roll ${humanize(p.promptId)}${p.tag ? ` vs ${ctx.library.tags[p.tag]?.label ?? p.tag}` : ''}`} disabled={!!p.perTagCategory && !p.tag} onOpen={() => setPromptOpen({ id: p.promptId, ...(p.perTagCategory ? { category: p.perTagCategory } : {}) })} />)}
```

- [ ] **Step 7: Run the spec**

Run: `npx playwright test e2e/paths.spec.ts`
Expected: both tests pass.

- [ ] **Step 8: Typecheck, build, whole suite**

Run: `npm run typecheck && npm run build && npm run e2e`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src e2e/paths.spec.ts
git commit -m "Long-press any number to see (and copy) the path a script reads it with"
```

---

### Task 13: Docs point at the new UI

**Files:**
- Modify: `README.md`, `docs/RULES-FORMAT.md`

**Interfaces:**
- Consumes: nothing. Documentation only; no code changes, so the gate is `npm run typecheck && npm run e2e` proving nothing moved.

- [ ] **Step 1: Fix the README's format claim and describe the Library**

`README.md` line 3 — "nested conditions" is v3 language:

```md
D&D 3.5e battle assistant. Computes per-attack bonuses from modular JSON "packs" (feats, items, buffs, tags, monsters) whose effects are short JavaScript scripts, with battle memory. Runs as a web app and as an Android app (Capacitor).
```

and the `packs/` bullet:

```md
- `packs/` — authored content (JSON). Source of truth for features/items/spells/statuses/monsters; the record format is v4 (scripts), documented in `docs/RULES-FORMAT.md`.
```

Add, after the "Using it on the phone" section:

```md
## Where things are edited

- **Library › Features / Items / Spells / Statuses** — one record per row. The editor has a form for the record's own fields and a list of **scripts**: each with a label, the events it runs on (`always` is the compute phase), an enabled switch, a priority, and a CodeMirror box for the JavaScript. A script can also be stored as a **call** to a library function, which the editor shows as a typed form. Under each script, "Right now" previews what it emits against the live character, battle and target.
- **Library › Globals** — values shared by every character (`vars.<name>` falls back to them); warns when the active character shadows one.
- **Library › Functions** — shared script bodies with typed parameters, and the records that call them.
- **Long-press any number** (stats, skills, HP, ability scores, charges, items, switches, prompts) to see the path a script reads it with, with a Copy button.
- **Settings › Scripts** — safe mode (scripts off; also `?safe=1`, and it turns itself on after two failed starts). **Settings › Script errors** — everything a script threw this session, and any script paused after three failures.
- Importing a pack that carries scripts or functions asks first: it runs as code on this device.
```

- [ ] **Step 2: Point `RULES-FORMAT.md` at the editors**

In `docs/RULES-FORMAT.md`, under `## Scripts` (after the `Script = { … }` block), add:

```md
In the app, this is Library › the record's tab › the record, "Scripts": the label, the events multi-select, the enabled switch, the priority and the source box are the fields of this object, and the JSON tab shows exactly what is stored. A script's errors appear under its box and as a red dot on the record in the list.
```

Under `## Functions`, after the "Where a function may live" paragraph:

```md
Library › Functions edits these: name, description, a parameter table (name, type, label, required) and the body. The same screen lists the records that call each function — through `script.call.fn` or a `fn.<id>(…)` in a source. A record's script switches between "code" and "call a function" with the chips above its box; the call form renders one control per parameter type and an ƒx switch that turns any box into a raw expression (`{ "k": "expr" }`); a `path` or `ref` parameter stores `{ "k": "ref" }`.
```

Under `## Globals`, replace the sentence about the app store with:

```md
`Pack.globals` and the app's `hl.globals` slice hold values shared by every character: `vars.<name>` reads the character's var first, then the global. `setVar` writes the character's var when it has one, otherwise the global. Library › Globals adds, edits and deletes them and warns when the active character's own var shadows one; they travel in the full backup and in an exported library pack. Importing a pack seeds keys the app does not have yet and keeps the values it does.
```

Under `## Safe mode`, append:

```md
In the app it is Settings › Scripts, and a banner at the top of every screen offers to turn scripts back on. Two starts in a row that never finish rendering switch it on by themselves.
```

- [ ] **Step 3: Check nothing else still describes blocks**

Run: `grep -rn "effect block\|BlocksEditor\|ConditionEditor\|SelectorPicker\|nested conditions" README.md docs/*.md`
Expected: no output.

- [ ] **Step 4: Final full check**

Run: `npm run typecheck && npm run validate-packs && npm run build && npm run e2e`
Expected: all green — typecheck silent, validator reporting the packs valid, build succeeding, every Playwright spec passing.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/RULES-FORMAT.md
git commit -m "Docs: the app's script editor, Globals and Functions tabs, long-press paths and safe mode"
```
