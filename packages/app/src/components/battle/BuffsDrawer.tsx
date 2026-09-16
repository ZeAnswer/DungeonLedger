import { useState } from 'react';
import { durationRounds, newId, type EvalContext, type Status } from '@hl/engine';
import { useStore } from '../../store/store';
import { RecordEditor } from '../library/RecordEditor';
import { Button, Chip, Field, Sheet, Stepper, humanize, inputCls } from '../ui';

export function BuffsDrawer({ ctx, open, onClose }: { ctx: EvalContext; open: boolean; onClose: () => void }) {
  const setBattle = useStore((s) => s.setBattle);
  const setLibrary = useStore((s) => s.setLibrary);
  const library = useStore((s) => s.library);
  const showToast = useStore((s) => s.showToast);
  const battle = ctx.battle!;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Status | undefined>();
  const lib = ctx.library;
  const candidates = Object.values(lib.abilities).filter((a): a is Status => a.kind === 'status' && (!q || a.name.toLowerCase().includes(q.toLowerCase())));
  const nameOf = (id: string) => lib.abilities[id]?.name ?? battle.statuses.find((s) => s.id === id)?.name ?? id;

  const add = (abilityId: string) => {
    const a = lib.abilities[abilityId];
    if (!a) return;
    const duration = a.kind === 'status' || a.kind === 'spell' ? a.duration : undefined;
    const rounds = durationRounds(duration);
    setBattle({ ...battle, activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId, owner: 'self', suppressed: false, ...(duration ? { expires: duration } : {}), ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] });
  };
  const patch = (instanceId: string, p: Partial<(typeof battle.activeBuffs)[number]>) => setBattle({ ...battle, activeBuffs: battle.activeBuffs.map((b) => (b.instanceId === instanceId ? { ...b, ...p } : b)) });
  const remove = (instanceId: string) => setBattle({ ...battle, activeBuffs: battle.activeBuffs.filter((b) => b.instanceId !== instanceId) });
  /** Save an edited status back into the battle; the id may have changed, so re-point the running buffs too. */
  const saveEdit = (prevId: string, s: Status) => setBattle({
    ...battle,
    statuses: battle.statuses.map((x) => (x.id === prevId ? s : x)),
    activeBuffs: battle.activeBuffs.map((b) => (b.abilityId === prevId ? { ...b, abilityId: s.id, label: s.name } : b)),
  });
  const keep = (s: Status) => {
    setLibrary({ ...library, abilities: { ...library.abilities, [s.id]: s } });
    setBattle({ ...battle, statuses: battle.statuses.filter((x) => x.id !== s.id) });
    showToast('Saved to Library › Statuses');
  };

  const instances = ctx.character.abilities.filter((i) => i.enabled).map((i) => lib.abilities[i.abilityId]).filter(Boolean);

  return (
    <Sheet open={open} onClose={onClose} title="Buffs, conditions, suppression" tall>
      <Field label="Active on you">
        {battle.activeBuffs.length === 0 && <div className="text-sm text-zinc-500">Nothing active.</div>}
        <div className="space-y-2">
          {battle.activeBuffs.map((b) => {
            const status = battle.statuses.find((s) => s.id === b.abilityId);
            return (
              <div key={b.instanceId} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
                <div className="min-w-0">
                  <div className={b.suppressed ? 'line-through text-zinc-500' : 'font-medium'}>{b.label ?? nameOf(b.abilityId)}</div>
                  {b.remainingRounds !== undefined && <div className="flex items-center gap-2 text-xs text-zinc-400">rounds left <Stepper value={b.remainingRounds} onChange={(v) => patch(b.instanceId, { remainingRounds: v })} /></div>}
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {status && <Button size="sm" variant="ghost" onClick={() => setEditing(status)}>Edit</Button>}
                  {status && <Button size="sm" variant="ghost" onClick={() => keep(status)}>Keep in library</Button>}
                  <Button size="sm" variant="ghost" onClick={() => patch(b.instanceId, { suppressed: !b.suppressed })}>{b.suppressed ? 'Resume' : 'Suppress'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(b.instanceId)}>✕</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Field>
      {battle.selfConditions.length > 0 && (
        <Field label="Your conditions">
          <div className="flex flex-wrap gap-2">{battle.selfConditions.map((c) => <Chip key={c.tag} tone="blue" active onClick={() => setBattle({ ...battle, selfConditions: battle.selfConditions.filter((x) => x.tag !== c.tag) })}>{lib.tags[c.tag]?.label ?? humanize(c.tag)} ✕</Chip>)}</div>
        </Field>
      )}
      <Field label="Add buff / condition">
        <input className={inputCls} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">{candidates.map((a) => <Chip key={a.id} tone={a.harmful ? 'red' : 'green'} onClick={() => add(a.id)}>+ {a.name}</Chip>)}</div>
      </Field>
      <Field label="Suppress abilities (anti-magic, disarmed…)">
        <div className="flex flex-wrap gap-2">
          {instances.map((a) => <Chip key={a!.id} tone="red" active={battle.suppressedAbilities.includes(a!.id)} onClick={() => setBattle({ ...battle, suppressedAbilities: battle.suppressedAbilities.includes(a!.id) ? battle.suppressedAbilities.filter((x) => x !== a!.id) : [...battle.suppressedAbilities, a!.id] })}>{a!.name}</Chip>)}
        </div>
      </Field>
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.name || 'Status'} tall>
        {editing && (
          <RecordEditor
            key={editing.id}
            initial={editing}
            onSave={(s) => { saveEdit(editing.id, s as Status); setEditing(undefined); }}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </Sheet>
    </Sheet>
  );
}
