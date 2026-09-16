import type { ScriptError } from './sink';

let errors: ScriptError[] = [];
const failures = new Map<string, number>();
let mode: 'on' | 'off' = 'on';

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
  },
  noteFailure(key: string) {
    failures.set(key, (failures.get(key) ?? 0) + 1);
  },
  quarantined: (key: string) => (failures.get(key) ?? 0) >= 3,
};

export const getScriptMode = () => mode;
export const setScriptMode = (m: 'on' | 'off') => {
  mode = m;
};
