import { create } from 'zustand';
import {
  AbilitySchema, BattleSchema, CharacterSchema, PackSchema, convertToV3, convertBattle, emptyLibrary, mergePack, libraryToPack, newBattle, activationsOf,
  type Battle, type Character, type EvalContext, type LibraryWithMeta, type MergeReport, type Monster, type MonsterOverlay, type Pack,
} from '@hl/engine';
import { storage } from '../storage';
import { defaultPacks } from '../data/defaultPacks';

export type FullLibrary = LibraryWithMeta & { monsters: Record<string, Monster>; characters: Record<string, Character>; monsterOverlay: Record<string, MonsterOverlay> };

export type Screen = 'battle' | 'character' | 'inventory' | 'library' | 'settings';

type State = {
  hydrated: boolean;
  library: FullLibrary;
  character: Character | undefined;
  battle: Battle | undefined;
  pastBattles: Battle[];
  screen: Screen;
  targetId: string | undefined;
  toast: string | undefined;
};

type Actions = {
  hydrate(): Promise<void>;
  setScreen(s: Screen): void;
  setTarget(id: string | undefined): void;
  setCharacter(c: Character): void;
  setBattle(b: Battle | undefined): void;
  startBattle(name?: string): void;
  endBattle(): void;
  setLibrary(l: FullLibrary): void;
  /** Remember a tag change for every future copy of a bestiary monster. */
  setMonsterOverlay(monsterId: string, overlay: MonsterOverlay): void;
  importPack(pack: Pack, opts?: { overwrite?: boolean }): MergeReport;
  importText(text: string, opts?: { overwrite?: boolean }): { report?: MergeReport; error?: string };
  exportLibraryText(): string;
  exportBackupText(): string;
  restoreBackupText(text: string): string | undefined;
  resetToDefaults(): Promise<void>;
  /** Replace only inventory + item rules on the active character from the bundled pack (skills, HP, ledger untouched). */
  reimportInventoryFromDefaults(): string | undefined;
  showToast(msg: string): void;
};

export type Store = State & Actions;

const KEYS = { library: 'hl.library', character: 'hl.character', battle: 'hl.battle', past: 'hl.pastBattles', screen: 'hl.screen' } as const;

function fullEmpty(): FullLibrary {
  return { ...emptyLibrary(), monsters: {}, characters: {}, monsterOverlay: {} };
}

export const useStore = create<Store>((set, get) => ({
  hydrated: false,
  library: fullEmpty(),
  character: undefined,
  battle: undefined,
  pastBattles: [],
  screen: 'battle',
  targetId: undefined,
  toast: undefined,

  async hydrate() {
    const s = storage();
    const [library, character, battle, past, screen] = await Promise.all([
      s.get<FullLibrary>(KEYS.library), s.get<Character>(KEYS.character), s.get<Battle>(KEYS.battle), s.get<Battle[]>(KEYS.past), s.get<Screen>(KEYS.screen),
    ]);
    if (!library) {
      let lib = fullEmpty();
      for (const p of defaultPacks) lib = { ...lib, ...(mergePack(lib, p).library as FullLibrary) };
      const ch = Object.values(lib.characters)[0];
      set({ library: lib, character: ch, hydrated: true, screen: 'battle' });
      return;
    }
    // Stored rules may be in the old v1/v2 format: convert.
    const rawAbilities = (library.abilities ?? {}) as Record<string, unknown>;
    const lookup = (id: string) => rawAbilities[id] as Record<string, unknown> | undefined;
    const converted = Object.fromEntries(Object.entries(rawAbilities).map(([id, a]) => { try { return [id, AbilitySchema.parse(convertToV3(a, lookup))]; } catch { return [id, a]; } })) as FullLibrary['abilities'];
    // Built-in packs newer than what this install has seen get merged in (same-pack newer version wins; user edits to other packs untouched).
    let lib: FullLibrary = { ...fullEmpty(), ...library, abilities: converted };
    const updated: string[] = [];
    for (const p of defaultPacks) {
      const seen = Math.max(0, ...Object.values(lib.meta).filter((m) => m.packId === p.id).map((m) => m.version));
      if (p.version > seen) { lib = { ...lib, ...(mergePack(lib, { ...p, characters: [] }, {}).library as FullLibrary) }; updated.push(p.name); }
    }
    set({
      library: lib,
      character: character ? CharacterSchema.parse(character) : Object.values(library.characters ?? {})[0],
      battle: battle ? BattleSchema.parse(convertBattle(battle, (id) => { const a = lib.abilities[id]; return a ? { kind: a.kind, activations: activationsOf(a) } : undefined; })) : undefined,
      pastBattles: past ?? [],
      screen: screen ?? 'battle',
      hydrated: true,
    });
    if (updated.length) get().showToast(`Updated built-in packs: ${updated.join(', ')}`);
  },

  setScreen: (screen) => set({ screen }),
  setTarget: (targetId) => set({ targetId }),
  setCharacter: (character) => set({ character }),
  setBattle: (battle) => set({ battle }),
  startBattle: (name) => set({ battle: newBattle(name ?? `Battle ${new Date().toLocaleDateString()}`), targetId: undefined }),
  endBattle: () => {
    const { battle, pastBattles } = get();
    if (!battle) return;
    set({ battle: undefined, targetId: undefined, pastBattles: [{ ...battle, ended: true }, ...pastBattles].slice(0, 20) });
  },
  setLibrary: (library) => set({ library }),
  setMonsterOverlay: (monsterId, overlay) => set((s) => ({ library: { ...s.library, monsterOverlay: { ...s.library.monsterOverlay, [monsterId]: overlay } } })),

  importPack(pack, opts) {
    const { library, character } = get();
    const m = mergePack(library, pack, opts);
    const lib = { ...fullEmpty(), ...library, ...m.library } as FullLibrary;
    // If the pack carries the active character (or we have none), refresh it.
    const incoming = pack.characters.find((c) => c.id === character?.id) ?? (character ? undefined : pack.characters[0]);
    set({ library: lib, ...(incoming && (opts?.overwrite || !character || !m.report.conflicts.some((c) => c.key === `character:${incoming.id}`)) ? { character: incoming } : {}) });
    return m.report;
  },

  importText(text, opts) {
    try {
      const raw = JSON.parse(text);
      const r = PackSchema.safeParse(raw);
      if (!r.success) return { error: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') };
      return { report: get().importPack(r.data, opts) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },

  exportLibraryText() {
    const { library, character } = get();
    const lib = character ? { ...library, characters: { ...library.characters, [character.id]: character } } : library;
    return JSON.stringify(libraryToPack(lib, { id: 'library-export', name: 'Library export', version: Date.now() }), null, 2);
  },

  exportBackupText() {
    const { library, character, battle, pastBattles } = get();
    return JSON.stringify({ kind: 'hl-backup', version: 1, library, character, battle, pastBattles }, null, 2);
  },

  restoreBackupText(text) {
    try {
      const raw = JSON.parse(text);
      if (raw?.kind !== 'hl-backup') return 'Not a Hunter\'s Ledger backup file';
      const rawAbilities = (raw.library?.abilities ?? {}) as Record<string, unknown>;
      const lookup = (id: string) => rawAbilities[id] as Record<string, unknown> | undefined;
      const converted = Object.fromEntries(Object.entries(rawAbilities).map(([id, a]) => { try { return [id, AbilitySchema.parse(convertToV3(a, lookup))]; } catch { return [id, a]; } })) as FullLibrary['abilities'];
      const lib: FullLibrary = { ...fullEmpty(), ...raw.library, abilities: converted };
      set({
        library: lib,
        character: raw.character ? CharacterSchema.parse(raw.character) : undefined,
        battle: raw.battle ? BattleSchema.parse(convertBattle(raw.battle, (id) => { const a = lib.abilities[id]; return a ? { kind: a.kind, activations: activationsOf(a) } : undefined; })) : undefined,
        pastBattles: raw.pastBattles ?? [],
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
    set({ hydrated: false, library: fullEmpty(), character: undefined, battle: undefined, pastBattles: [], targetId: undefined });
    await get().hydrate();
  },

  showToast(msg) {
    set({ toast: msg });
    setTimeout(() => set((s) => (s.toast === msg ? { toast: undefined } : {})), 2500);
  },
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
  if ('character' in changed) void (changed.character ? st.set(KEYS.character, changed.character) : st.remove(KEYS.character));
  if ('battle' in changed) void (changed.battle ? st.set(KEYS.battle, changed.battle) : st.remove(KEYS.battle));
  if ('pastBattles' in changed) void st.set(KEYS.past, changed.pastBattles);
  if ('screen' in changed) void st.set(KEYS.screen, changed.screen);
}

useStore.subscribe((s) => {
  if (!s.hydrated) return;
  const changed: Partial<State> = {};
  if (s.library !== last.library) changed.library = s.library;
  if (s.character !== last.character) changed.character = s.character;
  if (s.battle !== last.battle) changed.battle = s.battle;
  if (s.pastBattles !== last.pastBattles) changed.pastBattles = s.pastBattles;
  if (s.screen !== last.screen) changed.screen = s.screen;
  last = { library: s.library, character: s.character, battle: s.battle, pastBattles: s.pastBattles, screen: s.screen };
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

/** Evaluation context for the engine from current store state. */
export function selectCtx(s: Store): EvalContext | undefined {
  if (!s.character) return undefined;
  const target = s.battle?.combatants.find((c) => c.id === s.targetId);
  return { character: s.character, library: s.library, ...(s.battle ? { battle: s.battle } : {}), ...(target ? { target } : {}) };
}
