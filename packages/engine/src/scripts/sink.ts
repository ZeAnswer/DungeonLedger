import type { AttackKind, SlotId, StatId } from '../schema';
import type { BonusEntry } from '../stacking';

/** One attack mode a script offers (Rapid Shot, Power Attack…). `kind` limits it to ranged or melee profiles. */
export type AttackModeEntry = { modeId: string; label: string; base: 'single' | 'full'; extraAttacksAtTop: number; penalty: number; note?: string; source: string; kind?: AttackKind };
/** The name the resolvers and the app use for the same shape. */
export type AttackMode = AttackModeEntry;
export type DiceEntry = { dice: string; label: string; damageType?: string };
/** A script that did not apply, with the predicate that failed, so the UI can say "needs …". */
export type NearMiss = { source: string; sourceName: string; label: string; summary: string; failed: string };
export type PromptRequest = { promptId: string; perTagCategory?: string; tag?: string; source: string; sourceName: string };
export type ScriptError = { recordId: string; scriptId: string; label: string; phase: 'compile' | 'run'; message: string; line?: number };

/** Everything the compute pass collects from `always` scripts; the resolvers read it instead of walking effects. */
export type Sink = {
  bonuses: (BonusEntry & { stat: StatId })[];
  sets: { stat: StatId; value: number; source: string }[];
  multipliers: { stat: StatId; factor: number; source: string }[];
  dice: DiceEntry[];
  flags: Record<string, boolean>;
  notes: { text: string; source: string; sourceName: string }[];
  modes: AttackModeEntry[];
  extraAttacks: { n: number; base: 'single' | 'full' | 'any'; kind?: AttackKind; source: string }[];
  naturals: { name: string; dice: string; count: number; attackBonus: number; source: string; sourceName: string }[];
  slots: Partial<Record<SlotId, number>>;
  prompts: PromptRequest[];
  skipped: NearMiss[];
  errors: ScriptError[];
  /** Non-fatal problems found while collecting sources (unknown ability on the sheet, missing activation). */
  warnings: string[];
};

export const newSink = (): Sink => ({ bonuses: [], sets: [], multipliers: [], dice: [], flags: {}, notes: [], modes: [], extraAttacks: [], naturals: [], slots: {}, prompts: [], skipped: [], errors: [], warnings: [] });

/**
 * A shallow copy of every field: a script's scratch sink starts as a snapshot of what earlier scripts
 * already contributed (so reads inside the script — `flags.x`, etc. — see them), and its own new
 * entries land in fresh arrays/objects that can be thrown away without touching the original.
 */
export const cloneSink = (s: Sink): Sink => ({
  bonuses: [...s.bonuses], sets: [...s.sets], multipliers: [...s.multipliers], dice: [...s.dice],
  flags: { ...s.flags }, notes: [...s.notes], modes: [...s.modes], extraAttacks: [...s.extraAttacks],
  naturals: [...s.naturals], slots: { ...s.slots }, prompts: [...s.prompts],
  skipped: [...s.skipped], errors: [...s.errors], warnings: [...s.warnings],
});
