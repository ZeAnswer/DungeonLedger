import type { Library } from './context';
import { AbilitySchema, type Pack } from './schema';

export type PackItemMeta = { packId: string; version: number };
export type LibraryWithMeta = Library & { meta: Record<string, PackItemMeta> };

export type MergeReport = {
  added: string[];
  updated: string[];
  unchanged: string[];
  conflicts: { key: string; existingPack: string; incomingPack: string }[];
};

export function emptyLibrary(): LibraryWithMeta {
  return { abilities: {}, tags: {}, skills: {}, classTables: {}, xpTable: [], functions: {}, globals: {}, meta: {} };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Merge a pack into a library. Same-pack newer versions update; foreign differing items conflict unless overwrite. */
export function mergePack(library: Library & { meta?: Record<string, PackItemMeta> }, pack: Pack, opts: { overwrite?: boolean } = {}): { library: LibraryWithMeta; report: MergeReport } {
  const lib: LibraryWithMeta = {
    abilities: { ...library.abilities }, tags: { ...library.tags }, skills: { ...library.skills },
    classTables: { ...library.classTables }, xpTable: [...library.xpTable],
    functions: { ...library.functions }, globals: { ...library.globals }, meta: { ...(library.meta ?? {}) },
    ...(library as { monsters?: Record<string, unknown>; characters?: Record<string, unknown> }).monsters ? { monsters: { ...(library as { monsters?: Record<string, unknown> }).monsters } } : {},
    ...(library as { characters?: Record<string, unknown> }).characters ? { characters: { ...(library as { characters?: Record<string, unknown> }).characters } } : {},
  } as LibraryWithMeta;
  const report: MergeReport = { added: [], updated: [], unchanged: [], conflicts: [] };

  function put<T extends { id: string }>(kind: string, table: Record<string, T>, item: T) {
    const key = `${kind}:${item.id}`;
    const existing = table[item.id];
    const meta = lib.meta[key];
    if (!existing) {
      table[item.id] = item; lib.meta[key] = { packId: pack.id, version: pack.version }; report.added.push(key); return;
    }
    if (same(existing, item)) { report.unchanged.push(key); lib.meta[key] = { packId: pack.id, version: pack.version }; return; }
    const newerSamePack = meta?.packId === pack.id && pack.version > meta.version;
    if (newerSamePack || opts.overwrite) {
      table[item.id] = item; lib.meta[key] = { packId: pack.id, version: pack.version }; report.updated.push(key); return;
    }
    report.conflicts.push({ key, existingPack: meta?.packId ?? 'unknown', incomingPack: pack.id });
  }

  for (const t of pack.tags) put('tag', lib.tags, t);
  for (const a of pack.abilities) put('ability', lib.abilities, AbilitySchema.parse(a));
  for (const s of pack.skills) put('skill', lib.skills, s);
  for (const c of pack.classTables) put('class', lib.classTables, c);
  const l = lib as LibraryWithMeta & { monsters: Record<string, Pack['monsters'][number]>; characters: Record<string, Pack['characters'][number]> };
  if (pack.monsters.length) { l.monsters ??= {}; for (const m of pack.monsters) put('monster', l.monsters, m); }
  if (pack.characters.length) { l.characters ??= {}; for (const c of pack.characters) put('character', l.characters, c); }
  if (pack.xpTable?.length) lib.xpTable = pack.xpTable;
  return { library: lib, report };
}

export function libraryToPack(library: Library & { monsters?: Record<string, Pack['monsters'][number]>; characters?: Record<string, Pack['characters'][number]> }, head: { id: string; name: string; version: number; description?: string }): Pack {
  return {
    ...head,
    tags: Object.values(library.tags),
    abilities: Object.values(library.abilities),
    skills: Object.values(library.skills),
    classTables: Object.values(library.classTables),
    monsters: Object.values(library.monsters ?? {}),
    characters: Object.values(library.characters ?? {}),
    xpTable: library.xpTable,
    functions: Object.values(library.functions ?? {}),
    globals: library.globals ?? {},
  };
}
