import { activationsOf, poolsOf, type Ability, type EvalContext } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, Field, Sheet } from '../ui';

/** Per-character settings for one ability: enabled, chosen tags for params, rules text. */
export function AbilitySheet({ ctx, ability, onClose }: { ctx: EvalContext; ability: Ability; onClose: () => void }) {
  const setCharacter = useStore((s) => s.setCharacter);
  const c = ctx.character;
  const inst = c.abilities.find((x) => x.abilityId === ability.id);
  if (!inst) return null;
  const update = (patch: Partial<typeof inst>) => setCharacter({ ...c, abilities: c.abilities.map((x) => (x.abilityId === ability.id ? { ...x, ...patch } : x)) });
  const tags = Object.values(ctx.library.tags);
  const charges = [
    ...activationsOf(ability).filter((x) => x.charges).map((x) => ({ id: x.id, label: x.charges!.label ?? x.name ?? ability.name, max: x.charges!.max, resetOn: x.charges!.resetOn })),
    ...poolsOf(ability).map((p) => ({ id: p.id, label: p.label ?? ability.name, max: p.max, resetOn: p.resetOn })),
  ];

  return (
    <Sheet open onClose={onClose} title={ability.name} tall>
      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
        <span>{ability.kind}{ability.sourceRef ? ` · ${ability.sourceRef}` : ''}</span>
        {ability.kind === 'item' && <span className={inst.enabled ? 'text-emerald-300' : 'text-zinc-500'}>{inst.enabled ? '· equipped' : '· not equipped (see Inventory)'}</span>}
        {ability.kind !== 'item' && !inst.enabled && <span className="text-amber-300">· inactive</span>}
      </div>
      {ability.text && <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-300">{ability.text}</p>}
      {ability.todo && <p className="mb-3 rounded-xl border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">⚑ {ability.todo}</p>}
      {ability.kind === 'feature' && Object.entries(ability.params ?? {}).map(([name, def]) => {
        const chosen = inst.paramValues[name] ?? [];
        if (def.kind !== 'tags') return null;
        const options = tags.filter((t) => !def.category || t.category === def.category).sort((a, b) => a.label.localeCompare(b.label));
        return (
          <Field key={name} label={`${def.label ?? name}${def.count ? ` (pick ${def.count})` : ''}`}>
            <div className="flex flex-wrap gap-1">
              {options.map((t) => <Chip key={t.id} tone="amber" active={chosen.includes(t.id)} onClick={() => update({ paramValues: { ...inst.paramValues, [name]: chosen.includes(t.id) ? chosen.filter((x) => x !== t.id) : [...chosen, t.id] } })}>{t.label}</Chip>)}
            </div>
          </Field>
        );
      })}
      {charges.map((r) => {
        const used = c.resourceState[r.id]?.used ?? 0;
        return r.resetOn !== 'round' && r.resetOn !== 'encounter' ? (
          <Field key={r.id} label={`${r.label} used today`}>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setCharacter({ ...c, resourceState: { ...c.resourceState, [r.id]: { used: Math.max(0, used - 1) } } })}>−</Button>
              <span className="tabular-nums">{used} / {r.max}</span>
              <Button size="sm" onClick={() => setCharacter({ ...c, resourceState: { ...c.resourceState, [r.id]: { used: used + 1 } } })}>+</Button>
            </div>
          </Field>
        ) : null;
      })}
      <div className="mb-3 text-xs text-zinc-500">{ability.scripts.length} script{ability.scripts.length === 1 ? '' : 's'}, {activationsOf(ability).length} activation{activationsOf(ability).length === 1 ? '' : 's'}. Edit the logic in Library.</div>
      {ability.kind !== 'item' && <Button variant="danger" onClick={() => { if (confirm(`Remove ${ability.name} from ${c.name}?`)) { setCharacter({ ...c, abilities: c.abilities.filter((x) => x.abilityId !== ability.id) }); onClose(); } }}>Remove from character</Button>}
    </Sheet>
  );
}
