import { readFileSync } from 'node:fs';
import { emptyLibrary, mergePack, libraryToPack } from '../src/pack';
import { resolveStat } from '../src/resolve';
import { activationsOf, PackSchema } from '../src/schema';

const p1 = PackSchema.parse({
  id: 'core', name: 'Core', version: 1,
  tags: [{ id: 'aquatic', label: 'Aquatic', category: 'habitat' }],
  abilities: [{ id: 'rapid-shot', name: 'Rapid Shot', kind: 'feature', scripts: [] }],
  skills: [{ id: 'swim', name: 'Swim', ability: 'str' }],
  xpTable: [{ level: 1, xp: 0 }, { level: 2, xp: 1000 }],
});

test('merging into an empty library adds everything', () => {
  const { library, report } = mergePack(emptyLibrary(), p1);
  expect(Object.keys(library.abilities)).toEqual(['rapid-shot']);
  expect(library.tags.aquatic?.label).toBe('Aquatic');
  expect(library.xpTable).toHaveLength(2);
  expect(report).toMatchObject({ added: ['tag:aquatic', 'ability:rapid-shot', 'skill:swim'], updated: [], conflicts: [] });
});

test('same id from a newer pack version updates; same version with different content is a conflict', () => {
  const { library } = mergePack(emptyLibrary(), p1);
  const p2 = PackSchema.parse({ ...p1, version: 2, abilities: [{ id: 'rapid-shot', name: 'Rapid Shot (v2)', kind: 'feature', scripts: [] }] });
  const r2 = mergePack(library, p2);
  expect(r2.library.abilities['rapid-shot']!.name).toBe('Rapid Shot (v2)');
  expect(r2.report.updated).toEqual(['ability:rapid-shot']);

  const other = PackSchema.parse({ id: 'other', name: 'Other', version: 1, abilities: [{ id: 'rapid-shot', name: 'Different', kind: 'feature', scripts: [] }] });
  const r3 = mergePack(r2.library, other);
  expect(r3.report.conflicts).toEqual([expect.objectContaining({ key: 'ability:rapid-shot' })]);
  expect(r3.library.abilities['rapid-shot']!.name).toBe('Rapid Shot (v2)'); // kept existing
  expect(mergePack(r2.library, other, { overwrite: true }).library.abilities['rapid-shot']!.name).toBe('Different');
});

test('library round-trips through a pack', () => {
  const { library } = mergePack(emptyLibrary(), p1);
  const pack = libraryToPack(library, { id: 'backup', name: 'Backup', version: 3 });
  expect(PackSchema.safeParse(pack).success).toBe(true);
  const again = mergePack(emptyLibrary(), pack).library;
  expect({ ...again, meta: undefined }).toEqual({ ...library, meta: undefined });
});

// ---- upgrading an install that still has the records folded into Vaelor's Manual in memento v10 ----

const readPack = (rel: string) => PackSchema.parse(JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')));

// The shipped packs are still written in v3 (effect blocks). Task 7 lands `convertToV4` (the block
// printer) and Task 8 regenerates them; until then this pack cannot be parsed against the v4 schema.
test.skip('merging memento v10 over a stored v9 install leaves no duplicate activation ids and applies Hunter\'s Instinct once', () => {
  const v9 = readPack('./fixtures/memento-v9.json'); // trimmed copy of packs/memento.json at git 57b1f07
  const current = readPack('../../../packs/memento.json');
  const stored = mergePack(emptyLibrary(), v9).library; // what an old install has in storage
  const character = v9.characters[0]!; // its stored character still points at the three old records
  // The app merges newer built-in packs without touching the stored character (store.ts hydrate).
  const library = mergePack(stored, { ...current, characters: [] }).library;

  const owner = new Map<string, string>();
  for (const a of Object.values(library.abilities)) {
    for (const act of activationsOf(a)) {
      expect(owner.get(act.id), `activation "${act.id}" defined by both ${owner.get(act.id)} and ${a.id}`).toBeUndefined();
      owner.set(act.id, a.id);
    }
  }
  expect(owner.get('monster-knowledge')).toBe('vaelors-manual');
  expect(owner.get('hunters-analysis')).toBe('vaelors-manual');

  const entries = resolveStat({ character, library }, 'skill.knowledge-monsters').entries.filter((e) => e.label.includes('Hunter\'s Instinct'));
  expect(entries).toHaveLength(1);
  expect(entries[0]!.source).toBe('vaelors-manual');
});
