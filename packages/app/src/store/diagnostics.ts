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
