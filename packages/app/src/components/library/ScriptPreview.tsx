import { useMemo } from 'react';
import { newSink, runOne, type Ability, type Patch, type Script } from '@hl/engine';
import { useCtx } from '../../store/hooks';

const patchText = (p: Patch): string => {
  switch (p.k) {
    case 'tag': return `${p.to} gains "${p.tag}" (${String(p.duration)})`;
    case 'untag': return `${p.to} loses "${p.tag}"`;
    case 'resource': return `${p.op} ${p.amount} of ${p.id}`;
    case 'grant': return `grants ${p.abilityId}`;
    case 'suppress': return `suppresses ${p.abilityId}`;
    case 'hp': return `${p.op} ${p.amount} hp`;
    case 'reveal': return 'reveals the target';
    case 'check': return `for the monster: ${p.name} — ${p.save} DC ${p.dc}: ${p.effect}`;
    case 'setVar': return `${p.name} = ${String(p.value)}`;
    case 'log': return `logs "${p.text}"`;
    case 'emit': return `emits "${p.name}"`;
  }
};

/**
 * Run this one script against the live character and target, into a throwaway sink: what it emits now,
 * or the predicate that stopped it. `probe: true` keeps the run out of the diagnostics registry, so
 * previewing a broken script can never quarantine it.
 */
export function ScriptPreview({ ability, script }: { ability: Ability; script: Script }) {
  const ctx = useCtx();
  // Keyed on `ability.id`, not `ability` itself: the record editor hands every row the same draft object,
  // whose identity changes on every keystroke in *any* row (each edit calls `setA({...})`). Depending on
  // the object would re-probe every other row each time one is typed in; `ability.id` almost never changes,
  // so only this row's own edits (a new `script` reference) or a context change re-run it. `ability`'s other
  // fields aren't read here besides `.id` (via `runOne`) and `.name` (only used for `source.label`, which
  // this component never renders), so a render-stale closure over `ability` is harmless.
  const abilityId = ability.id;
  const run = useMemo(() => {
    if (!ctx) return undefined;
    const sink = newSink();
    const patches: Patch[] = [];
    const instance = ctx.character.abilities.find((x) => x.abilityId === abilityId);
    const phase = script.events.includes('always') ? 'always' as const : 'event' as const;
    const outcome = runOne(ctx, {
      phase, source: { ability, instance, label: ability.name }, script, probe: true, probeActive: true,
      ...(phase === 'event' ? { event: { kind: script.events[0]! } } : {}),
    }, sink, patches);
    return { sink, patches, outcome };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ability` deliberately excluded; see comment above.
  }, [ctx, abilityId, script]);
  if (!run) return null;
  const { sink, patches } = run;
  const rows: string[] = [
    ...sink.bonuses.map((b) => `${b.stat} ${b.value >= 0 ? '+' : ''}${b.value} (${b.bonusType}) — ${b.label}`),
    ...sink.sets.map((s) => `${s.stat} set to ${s.value}`),
    ...sink.multipliers.map((m) => `${m.stat} ×${m.factor}`),
    ...sink.dice.map((d) => `${d.dice} ${d.label}${d.damageType ? ` (${d.damageType})` : ''}`),
    ...sink.modes.map((m) => `attack mode "${m.label}"`),
    ...sink.extraAttacks.map((e) => `+${e.n} attack on a ${e.base} attack`),
    ...sink.naturals.map((n) => `natural attack ${n.name} ${n.dice}`),
    ...Object.entries(sink.flags).filter(([, v]) => v).map(([k]) => `flag ${k}`),
    ...Object.entries(sink.slots).map(([k, v]) => `+${v} ${k} slot`),
    ...sink.notes.map((n) => `note: ${n.text}`),
    ...sink.prompts.map((p) => `asks for a ${p.promptId} check`),
    ...patches.map(patchText),
  ];
  return (
    <div data-role="script-preview" className="mt-1 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs">
      <div className="mb-1 uppercase tracking-wide text-zinc-500">Right now</div>
      {rows.map((r) => <div key={r} className="text-emerald-300">{r}</div>)}
      {sink.skipped.map((s) => <div key={s.failed} className="text-zinc-500">does not apply — needs {s.failed}</div>)}
      {sink.errors.map((e) => <div key={e.message} className="text-red-300">{e.message}</div>)}
      {rows.length === 0 && sink.skipped.length === 0 && sink.errors.length === 0 && <div className="text-zinc-500">nothing, with the current character, battle and target</div>}
    </div>
  );
}
