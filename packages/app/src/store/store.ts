import { create } from 'zustand';
import {
  AbilitySchema, BattleSchema, CharacterSchema, convertToV3, convertBattle, emptyLibrary, mergePack, libraryToPack, newBattle, activationsOf, clearComputeCache, diagnostics,
  type Battle, type Character, type EvalContext, type LibraryWithMeta, type MergeReport, type Monster, type MonsterOverlay, type Pack, type VarValue, type ScriptError,
} from '@hl/engine';
import { storage } from '../storage';
import { defaultPacks } from '../data/defaultPacks';
import { clearBootState } from '../boot';

export type FullLibrary = LibraryWithMeta & { monsters: Record<string, Monster>; characters: Record<string, Character>; monsterOverlay: Record<string, MonsterOverlay> };

export type Screen = 'battle' | 'character' | 'inventory' | 'library' | 'settings';

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
  scriptErrors: ScriptError[];
  safeMode: boolean;
  safeModeAuto: boolean;
  /** What the last failed load threw (set at boot from localStorage; cleared when scripts run again). */
  bootError?: string;
  pathToast: { path: string; label?: string } | undefined;
};

type Actions = {
  hydrate(): Promise<void>;
  setScreen(s: Screen): void;
  setTarget(id: string | undefined): void;
  setCharacter(c: Character): void;
  setBattle(b: Battle | undefined): void;
  setGlobals(g: Record<string, VarValue>): void;
  /** Apply what an engine call handed back (character, battle and any globals its scripts wrote). */
  applyState(r: { character?: Character; battle?: Battle; globals?: Record<string, VarValue> }): void;
  startBattle(name?: string): void;
  endBattle(): void;
  setLibrary(l: FullLibrary): void;
  /** Remember a tag change for every future copy of a bestiary monster. */
  setMonsterOverlay(monsterId: string, overlay: MonsterOverlay): void;
  importPack(pack: Pack, opts?: { overwrite?: boolean }): MergeReport;
  exportLibraryText(): string;
  exportBackupText(): string;
  restoreBackupText(text: string): string | undefined;
  resetToDefaults(): Promise<void>;
  /** Replace only inventory + item rules on the active character from the bundled pack (skills, HP, ledger untouched). */
  reimportInventoryFromDefaults(): string | undefined;
  showToast(msg: string): void;
  /** Copy the engine's in-memory error registry into the store (identity changes only when it really changed). */
  refreshDiagnostics(): void;
  clearScriptErrors(recordId?: string): void;
  setSafeModeState(on: boolean, auto?: boolean): void;
  showPath(path: string, label?: string): void;
  hidePath(): void;
};

export type Store = State & Actions;

const KEYS = { library: 'hl.library', globals: 'hl.globals', character: 'hl.character', battle: 'hl.battle', past: 'hl.pastBattles', screen: 'hl.screen' } as const;

function fullEmpty(): FullLibrary {
  return { ...emptyLibrary(), monsters: {}, characters: {}, monsterOverlay: {} };
}

/** Stored rules may be in the old v1/v2 format: convert them. A record that will not parse is left as-is so the user can still see and fix it. */
function convertAbilities(raw: Record<string, unknown> | undefined): FullLibrary['abilities'] {
  const abilities = raw ?? {};
  const lookup = (id: string) => abilities[id] as Record<string, unknown> | undefined;
  return Object.fromEntries(Object.entries(abilities).map(([id, a]) => { try { return [id, AbilitySchema.parse(convertToV3(a, lookup))]; } catch { return [id, a]; } })) as FullLibrary['abilities'];
}

/** Parse one stored battle, converting old shapes against the library it points at. */
function loadBattle(raw: unknown, lib: FullLibrary): Battle {
  return BattleSchema.parse(convertBattle(raw, (id) => { const a = lib.abilities[id]; return a ? { kind: a.kind, activations: activationsOf(a) } : undefined; }));
}

/** Past battles can be reopened, so they convert too; one that no longer parses is dropped instead of breaking the load. */
function loadPastBattles(raw: unknown, lib: FullLibrary): Battle[] {
  const out: Battle[] = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    try { out.push(loadBattle(b, lib)); } catch (e) { console.warn('Dropping a past battle that could not be loaded:', e); }
  }
  return out;
}

export const useStore = create<Store>((set, get) => ({
  hydrated: false,
  library: fullEmpty(),
  globals: {},
  character: undefined,
  battle: undefined,
  pastBattles: [],
  screen: 'battle',
  targetId: undefined,
  toast: undefined,
  scriptErrors: [],
  safeMode: false,
  safeModeAuto: false,
  bootError: undefined,
  pathToast: undefined,

  async hydrate() {
    const s = storage();
    const [library, globals, character, battle, past, screen] = await Promise.all([
      s.get<FullLibrary>(KEYS.library), s.get<Record<string, VarValue>>(KEYS.globals), s.get<Character>(KEYS.character), s.get<Battle>(KEYS.battle), s.get<Battle[]>(KEYS.past), s.get<Screen>(KEYS.screen),
    ]);
    if (!library) {
      let lib = fullEmpty();
      for (const p of defaultPacks) lib = { ...lib, ...(mergePack(lib, p).library as FullLibrary) };
      const ch = Object.values(lib.characters)[0];
      // Globals live only in the live slice, never in the persisted library blob (same reason as
      // importPack and the built-in-pack update path below).
      const { globals: freshGlobals, ...libNoGlobals } = lib;
      set({ library: libNoGlobals as FullLibrary, globals: freshGlobals, character: ch, hydrated: true, screen: 'battle' });
      return;
    }
    // Built-in packs newer than what this install has seen get merged in (same-pack newer version wins; user edits to other packs untouched).
    let lib: FullLibrary = { ...fullEmpty(), ...library, abilities: convertAbilities(library.abilities as Record<string, unknown> | undefined) };
    // Diffed and carried separately from `lib`, same reason as importPack: the live slice (falling back to
    // the stored library blob only when this install has never had one, i.e. mid-migration) is the correct
    // baseline, and the merge result must not be written back into the persisted library blob.
    let mergedGlobals = globals ?? lib.globals;
    const updated: string[] = [];
    // A pack update may carry skills the seed character has that the stored one doesn't (e.g. the
    // player's real skill list replacing a partial import): restored onto the stored character below,
    // never touching a skill it already has, and only for the character id that pack actually seeds.
    let patchedCharacter = character;
    const restoredSkillNames: string[] = [];
    const droppedAbilityNames: string[] = [];
    for (const p of defaultPacks) {
      const seen = Math.max(0, ...Object.values(lib.meta).filter((m) => m.packId === p.id).map((m) => m.version));
      if (p.version > seen) {
        const m = mergePack({ ...lib, globals: mergedGlobals }, { ...p, characters: [] }, {});
        const { globals: _mLibGlobals, ...mLib } = m.library as FullLibrary;
        void _mLibGlobals;
        lib = { ...lib, ...mLib };
        mergedGlobals = m.library.globals;
        updated.push(p.name);
        const seed = p.characters.find((c) => c.id === patchedCharacter?.id);
        if (seed && patchedCharacter) {
          const missing = Object.entries(seed.skills).filter(([id]) => !patchedCharacter!.skills[id]);
          if (missing.length) {
            patchedCharacter = { ...patchedCharacter, skills: { ...patchedCharacter.skills, ...Object.fromEntries(missing) } };
            restoredSkillNames.push(...missing.map(([id]) => lib.skills[id]?.name ?? id));
          }
          // An ability the seed no longer lists and that no longer exists anywhere in the merged library
          // (a content mistake removed outright, not just unassigned) is stale on the stored sheet: drop it.
          const gone = patchedCharacter.abilities.filter((a) => !seed.abilities.some((sa) => sa.abilityId === a.abilityId) && !lib.abilities[a.abilityId]);
          if (gone.length) {
            droppedAbilityNames.push(...gone.map((a) => library.abilities[a.abilityId]?.name ?? a.abilityId));
            patchedCharacter = { ...patchedCharacter, abilities: patchedCharacter.abilities.filter((a) => !gone.includes(a)) };
          }
        }
      }
    }
    if (restoredSkillNames.length && patchedCharacter) {
      patchedCharacter = { ...patchedCharacter, journal: [...patchedCharacter.journal, { at: new Date().toISOString(), kind: 'edit', text: `Skills restored from built-in pack: ${restoredSkillNames.join(', ')}` }] };
    }
    if (droppedAbilityNames.length && patchedCharacter) {
      patchedCharacter = { ...patchedCharacter, journal: [...patchedCharacter.journal, { at: new Date().toISOString(), kind: 'edit', text: `Removed from sheet (no longer in the pack): ${droppedAbilityNames.join(', ')}` }] };
    }
    set({
      library: lib,
      globals: mergedGlobals,
      character: patchedCharacter ? CharacterSchema.parse(patchedCharacter) : Object.values(library.characters ?? {})[0],
      battle: battle ? loadBattle(battle, lib) : undefined,
      pastBattles: loadPastBattles(past, lib),
      screen: screen ?? 'battle',
      hydrated: true,
    });
    if (updated.length) get().showToast(`Updated built-in packs: ${updated.join(', ')}`);
  },

  setScreen: (screen) => set({ screen }),
  setTarget: (targetId) => set({ targetId }),
  setCharacter: (character) => set({ character }),
  setBattle: (battle) => set({ battle }),
  setGlobals: (globals) => set({ globals }),
  applyState: (r) => set({ ...(r.character ? { character: r.character } : {}), ...(r.battle ? { battle: r.battle } : {}), ...(r.globals ? { globals: r.globals } : {}) }),
  startBattle: (name) => set({ battle: newBattle(name ?? `Battle ${new Date().toLocaleDateString()}`), targetId: undefined }),
  endBattle: () => {
    const { battle, pastBattles } = get();
    if (!battle) return;
    set({ battle: undefined, targetId: undefined, pastBattles: [{ ...battle, ended: true }, ...pastBattles].slice(0, 20) });
  },
  setLibrary: (library) => set({ library }),
  setMonsterOverlay: (monsterId, overlay) => set((s) => ({ library: { ...s.library, monsterOverlay: { ...s.library.monsterOverlay, [monsterId]: overlay } } })),

  importPack(pack, opts) {
    const { library, character, globals } = get();
    // Diff the pack's globals against the live globals slice (not the stale library.globals blob), so
    // the MergeReport's added/updated/conflicts counts reflect what the player actually has right now.
    const m = mergePack({ ...library, globals }, pack, opts);
    // The merged globals go to the live slice below, never into the persisted library blob (a pack
    // update must not clobber it, and setVar must never need to touch the library).
    const { globals: _mLibGlobals, ...mLib } = m.library as FullLibrary;
    void _mLibGlobals;
    const lib = { ...fullEmpty(), ...library, ...mLib } as FullLibrary;
    // If the pack carries the active character (or we have none), refresh it.
    const incoming = pack.characters.find((c) => c.id === character?.id) ?? (character ? undefined : pack.characters[0]);
    set({ library: lib, globals: m.library.globals, ...(incoming && (opts?.overwrite || !character || !m.report.conflicts.some((c) => c.key === `character:${incoming.id}`)) ? { character: incoming } : {}) });
    return m.report;
  },

  exportLibraryText() {
    const { library, globals, character } = get();
    const lib = { ...library, globals, ...(character ? { characters: { ...library.characters, [character.id]: character } } : {}) };
    return JSON.stringify(libraryToPack(lib, { id: 'library-export', name: 'Library export', version: Date.now() }), null, 2);
  },

  exportBackupText() {
    const { library, globals, character, battle, pastBattles } = get();
    return JSON.stringify({ kind: 'hl-backup', version: 2, library, globals, character, battle, pastBattles }, null, 2);
  },

  restoreBackupText(text) {
    try {
      const raw = JSON.parse(text);
      if (raw?.kind !== 'hl-backup') return 'Not a Hunter\'s Ledger backup file';
      const lib: FullLibrary = { ...fullEmpty(), ...raw.library, abilities: convertAbilities(raw.library?.abilities as Record<string, unknown> | undefined) };
      set({
        library: lib,
        globals: (raw.globals as Record<string, VarValue> | undefined) ?? lib.globals ?? {},
        character: raw.character ? CharacterSchema.parse(raw.character) : undefined,
        battle: raw.battle ? loadBattle(raw.battle, lib) : undefined,
        pastBattles: loadPastBattles(raw.pastBattles, lib),
      });
      return undefined;
    } catch (e) {
      return (e as Error).message;
    }
  },

  reimportInventoryFromDefaults() {
    const { character, library } = get();
    if (!character) return 'No character';
    const packChar = defaultPacks.flatMap((p) => p.characters).find((c) => c.id === character.id);
    if (!packChar) return `No built-in character with id ${character.id}`;
    const itemIds = new Set(packChar.inventory.map((i) => i.abilityId).filter(Boolean));
    const keep = character.abilities.filter((a) => library.abilities[a.abilityId]?.kind !== 'item');
    const items = packChar.abilities.filter((a) => itemIds.has(a.abilityId) || library.abilities[a.abilityId]?.kind === 'item');
    set({ character: { ...character, inventory: packChar.inventory, abilities: [...keep, ...items], journal: [...character.journal, { at: new Date().toISOString(), kind: 'edit', text: 'Inventory replaced from built-in pack' }] } });
    return undefined;
  },

  async resetToDefaults() {
    const s = storage();
    for (const k of Object.values(KEYS)) await s.remove(k);
    // `hl.safeMode`/`hl.bootFails` live outside the KEYS above (see boot.ts): without this, a factory
    // reset performed while safe mode is on (or mid boot-loop) comes right back in safe mode on reload.
    clearBootState();
    set({ hydrated: false, library: fullEmpty(), globals: {}, character: undefined, battle: undefined, pastBattles: [], targetId: undefined, safeMode: false, safeModeAuto: false, bootError: undefined });
    await get().hydrate();
  },

  showToast(msg) {
    set({ toast: msg });
    setTimeout(() => set((s) => (s.toast === msg ? { toast: undefined } : {})), 2500);
  },

  refreshDiagnostics() {
    const errors = diagnostics.errors();
    if (errors !== get().scriptErrors) set({ scriptErrors: errors });
  },
  clearScriptErrors(recordId) {
    diagnostics.clear(recordId);
    clearComputeCache();
    set({ scriptErrors: diagnostics.errors() });
  },
  setSafeModeState: (safeMode, safeModeAuto = false) => set({ safeMode, safeModeAuto, ...(safeMode ? {} : { bootError: undefined }) }),
  showPath: (path, label) => set({ pathToast: { path, ...(label ? { label } : {}) } }),
  hidePath: () => set({ pathToast: undefined }),
}));

// ---- persistence: save changed slices, debounced (300ms trailing, 1s max wait), flushed on page hide ----
let timer: ReturnType<typeof setTimeout> | undefined;
let firstChangeAt = 0;
let pending: Partial<State> = {};
let last: Partial<State> = {};

function flush() {
  clearTimeout(timer);
  timer = undefined;
  const changed = pending;
  pending = {};
  firstChangeAt = 0;
  if (Object.keys(changed).length === 0) return;
  const st = storage();
  if ('library' in changed) void st.set(KEYS.library, changed.library);
  if ('globals' in changed) void st.set(KEYS.globals, changed.globals);
  if ('character' in changed) void (changed.character ? st.set(KEYS.character, changed.character) : st.remove(KEYS.character));
  if ('battle' in changed) void (changed.battle ? st.set(KEYS.battle, changed.battle) : st.remove(KEYS.battle));
  if ('pastBattles' in changed) void st.set(KEYS.past, changed.pastBattles);
  if ('screen' in changed) void st.set(KEYS.screen, changed.screen);
}

useStore.subscribe((s) => {
  if (!s.hydrated) return;
  const changed: Partial<State> = {};
  if (s.library !== last.library) changed.library = s.library;
  if (s.globals !== last.globals) changed.globals = s.globals;
  if (s.character !== last.character) changed.character = s.character;
  if (s.battle !== last.battle) changed.battle = s.battle;
  if (s.pastBattles !== last.pastBattles) changed.pastBattles = s.pastBattles;
  if (s.screen !== last.screen) changed.screen = s.screen;
  last = { library: s.library, globals: s.globals, character: s.character, battle: s.battle, pastBattles: s.pastBattles, screen: s.screen };
  if (Object.keys(changed).length === 0) return;
  pending = { ...pending, ...changed };
  const now = Date.now();
  if (!firstChangeAt) firstChangeAt = now;
  clearTimeout(timer);
  timer = setTimeout(flush, Math.max(0, Math.min(300, firstChangeAt + 1000 - now)));
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/** Force pending saves to disk now (e.g. before export). */
export const flushStorage = flush;

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

/** How much code a pack brings: the numbers the confirmation quotes. `PackSchema` has already parsed the abilities. */
export function packCode(pack: Pack): { scripts: number; functions: number } {
  let scripts = 0;
  for (const a of pack.abilities) {
    scripts += a.scripts.length;
    for (const act of activationsOf(a)) scripts += act.scripts.length;
  }
  return { scripts, functions: pack.functions.length };
}

/** Evaluation context for the engine from current store state. */
export function selectCtx(s: Store): EvalContext | undefined {
  if (!s.character) return undefined;
  const target = s.battle?.combatants.find((c) => c.id === s.targetId);
  return { character: s.character, library: ctxLibrary(s), ...(s.battle ? { battle: s.battle } : {}), ...(target ? { target } : {}) };
}
