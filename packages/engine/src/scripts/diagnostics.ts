import type { ScriptError } from './sink';

let errors: ScriptError[] = [];
const failures = new Map<string, number>();
let mode: 'on' | 'off' = 'on';

/**
 * Set by `compute.ts` (which already imports this module) so a script tipping into quarantine — or a
 * plain `diagnostics.clear()` — drops the compute cache too; otherwise a pass computed the moment
 * before the third failure keeps that script's stale contributions until character/battle/library
 * identity changes. A callback instead of an import keeps diagnostics → compute one-way (compute
 * already imports diagnostics), the same pattern `scripts/registry.ts` uses for resolve → scripts.
 */
let onQuarantineChange: (() => void) | undefined;
export function setQuarantineHook(fn: () => void): void { onQuarantineChange = fn; }

/**
 * In-memory registry of script errors (for a diagnostics panel) plus a per-key failure counter that
 * quarantines a script (keyed `"<recordId>/<scriptId>"`) after three failures, so a broken script stops
 * being retried every recompute.
 */
export const diagnostics = {
  record(e: ScriptError) {
    if (!errors.some((x) => x.recordId === e.recordId && x.scriptId === e.scriptId && x.message === e.message)) errors = [...errors, e];
  },
  errors: () => errors,
  clear(recordId?: string) {
    errors = recordId ? errors.filter((e) => e.recordId !== recordId) : [];
    if (!recordId) failures.clear();
    else for (const k of [...failures.keys()]) if (k.startsWith(recordId + '/')) failures.delete(k);
    onQuarantineChange?.();
  },
  noteFailure(key: string) {
    const next = (failures.get(key) ?? 0) + 1;
    failures.set(key, next);
    if (next === 3) onQuarantineChange?.();
  },
  quarantined: (key: string) => (failures.get(key) ?? 0) >= 3,
};

export const getScriptMode = () => mode;
export const setScriptMode = (m: 'on' | 'off') => {
  mode = m;
};
