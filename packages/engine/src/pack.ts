import type { Library } from './context';
import { AbilitySchema, type Pack } from './schema';

export type PackItemMeta = { packId: string; version: number };
export type LibraryWithMeta = Library & { meta: Record<string, PackItemMeta> };

export type MergeReport = {
  added: string[];
  updated: string[];
  unchanged: string[];
  conflicts: { key: string; existingPack: string; incomingPack: string }[];
  removed: string[];
};

export function emptyLibrary(): LibraryWithMeta {
  return { abilities: {}, tags: {}, skills: {}, classTables: {}, xpTable: [], functions: {}, globals: {}, meta: {} };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge a pack into a library. Same-pack newer versions update; foreign differing items conflict
 * unless overwrite. `prune` (default true) retires same-pack records the incoming version no longer
 * ships — a built-in pack update wants that; a user-initiated import passes `prune: false` so nothing
 * disappears from under them without an explicit "here's what would go" confirmation.
 */
export function mergePack(library: Library & { meta?: Record<string, PackItemMeta> }, pack: Pack, opts: { overwrite?: boolean; prune?: boolean } = {}): { library: LibraryWithMeta; report: MergeReport } {
  const lib: LibraryWithMeta = {
    abilities: { ...library.abilities }, tags: { ...library.tags }, skills: { ...library.skills },
    classTables: { ...library.classTables }, xpTable: [...library.xpTable],
    functions: { ...library.functions }, globals: { ...library.globals }, meta: { ...(library.meta ?? {}) },
    ...(library as { monsters?: Record<string, unknown>; characters?: Record<string, unknown> }).monsters ? { monsters: { ...(library as { monsters?: Record<string, unknown> }).monsters } } : {},
    ...(library as { characters?: Record<string, unknown> }).characters ? { characters: { ...(library as { characters?: Record<string, unknown> }).characters } } : {},
  } as LibraryWithMeta;
  const report: MergeReport = { added: [], updated: [], unchanged: [], conflicts: [], removed: [] };
  // A record this same pack owned at some earlier version, still that version's content (no newer
  // version has touched it below), tells us whether this merge is an *update* of a pack already seen —
  // vs. this pack's first install, where nothing has ever been "retired".
  const priorVersion = Math.max(0, ...Object.values(library.meta ?? {}).filter((m) => m.packId === pack.id).map((m) => m.version));

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
  for (const f of pack.functions) put('function', lib.functions, f);
  // Globals are plain key/value rather than id'd documents, so they merge key-wise under the same
  // policy as `put`: a new key is seeded, a newer version of the same pack updates it, and a value
  // another pack already set is kept and reported as a conflict.
  for (const [k, v] of Object.entries(pack.globals)) {
    const key = `global:${k}`;
    const meta = lib.meta[key];
    const stamp = () => { lib.meta[key] = { packId: pack.id, version: pack.version }; };
    if (!(k in lib.globals)) { lib.globals[k] = v; stamp(); report.added.push(key); }
    else if (lib.globals[k] === v) { stamp(); report.unchanged.push(key); }
    else if ((meta?.packId === pack.id && pack.version > meta.version) || opts.overwrite) { lib.globals[k] = v; stamp(); report.updated.push(key); }
    else report.conflicts.push({ key, existingPack: meta?.packId ?? 'unknown', incomingPack: pack.id });
  }
  for (const a of pack.abilities) put('ability', lib.abilities, AbilitySchema.parse(a));
  for (const s of pack.skills) put('skill', lib.skills, s);
  for (const c of pack.classTables) put('class', lib.classTables, c);
  const l = lib as LibraryWithMeta & { monsters: Record<string, Pack['monsters'][number]>; characters: Record<string, Pack['characters'][number]> };
  if (pack.monsters.length) { l.monsters ??= {}; for (const m of pack.monsters) put('monster', l.monsters, m); }
  if (pack.characters.length) { l.characters ??= {}; for (const c of pack.characters) put('character', l.characters, c); }
  if (pack.xpTable?.length) lib.xpTable = pack.xpTable;

  // A newer version of a pack already installed retires records that pack used to ship and no longer
  // does: anything still recorded (in `meta`) as owned by this pack id, that the incoming pack no
  // longer lists, is dropped. There's no way to tell whether the stored copy was hand-edited since —
  // the conflict/"same" check above needs an incoming item to diff against, and a retired record has
  // none — so this always removes rather than risking a stale record nobody can see or fix.
  if ((opts.prune ?? true) && priorVersion > 0 && pack.version > priorVersion) {
    const incomingIds: Partial<Record<string, Set<string>>> = {
      tag: new Set(pack.tags.map((t) => t.id)),
      function: new Set(pack.functions.map((f) => f.id)),
      global: new Set(Object.keys(pack.globals)),
      ability: new Set(pack.abilities.map((a) => a.id)),
    };
    const tables: Record<string, Record<string, unknown>> = { tag: lib.tags, function: lib.functions, global: lib.globals, ability: lib.abilities };
    for (const [key, meta] of Object.entries(lib.meta)) {
      if (meta.packId !== pack.id) continue;
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep);
      const id = key.slice(sep + 1);
      const ids = incomingIds[kind];
      if (!ids || ids.has(id)) continue;
      delete tables[kind]![id];
      delete lib.meta[key];
      report.removed.push(key);
    }
  }
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
