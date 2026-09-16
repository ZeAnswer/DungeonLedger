import { clearComputeCache, setScriptMode } from '@hl/engine';

const SAFE = 'hl.safeMode';
const FAILS = 'hl.bootFails';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | undefined): void => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

/** `?safe=1` is a one-load-only request: it must not itself write to storage. */
function queryRequested(): boolean {
  try { return new URLSearchParams(location.search).get('safe') === '1'; } catch { return false; }
}

function requested(): boolean {
  return queryRequested() || read(SAFE) === '1';
}

/**
 * Called once before React mounts. Counts boots that never finished: the second one in a row turns safe
 * mode on by itself, which is the "compute pass throws twice at boot" rule — whatever threw, the screen
 * comes back with scripts off instead of white. That auto-trip is the only path here that persists
 * `hl.safeMode` on its own; a bare `?safe=1` (or an already-stored flag) just turns scripts off for
 * this load without writing anything.
 */
export function armBootGuard(): { safeMode: boolean; autoTripped: boolean } {
  const fails = Number(read(FAILS) ?? '0') + 1;
  write(FAILS, String(fails));
  const autoTripped = fails >= 2 && read(SAFE) !== '1';
  const safeMode = autoTripped || requested();
  if (autoTripped) write(SAFE, '1');
  if (safeMode) setScriptMode('off');
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

/**
 * A factory reset must not come back in safe mode or trip it by coincidence: `hl.safeMode` /
 * `hl.bootFails` live in `localStorage` (see the top of this file), outside the IndexedDB-backed
 * `storage()` slices `resetToDefaults` clears. Turns scripts back on (syncing the engine, same as
 * `setSafeMode(false)`) and forgets the boot-failure count.
 */
export function clearBootState(): void {
  setSafeMode(false);
  write(FAILS, undefined);
}
