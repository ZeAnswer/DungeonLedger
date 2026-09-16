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
