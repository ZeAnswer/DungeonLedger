import { editLogEvent, undoEvent, type Battle, type LogEvent } from '@hl/engine';
import { useCtx } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Button, Chip, cx } from '../ui';
import { SAVE_LABEL } from './labels';

export function LogView({ battle }: { battle: Battle }) {
  const setBattle = useStore((s) => s.setBattle);
  const applyState = useStore((s) => s.applyState);
  const ctx = useCtx();
  const lib = useStore((s) => s.library);
  const undo = (id: string) => { if (!ctx) return; const r = undoEvent({ ...ctx, battle }, id); applyState(r); };
  const name = (id?: string) => battle.combatants.find((c) => c.id === id)?.name ?? id ?? '';
  const desc = (e: LogEvent) => {
    switch (e.kind) {
      case 'roundStart': return `— Round ${e.round} —`;
      case 'attack': return `Attack #${e.attackIndex} vs ${name(e.targetId)}${e.modeId ? ` (${e.modeId})` : ''}`;
      case 'enemy': return `${name(e.actor)} ${e.result === 'miss' ? 'missed you' : `${e.result === 'crit' ? 'critted' : 'hit'} you${e.damage ? ` for ${e.damage}` : ''}`}`;
      case 'activate': return `${lib.abilities[e.abilityId ?? '']?.name ?? e.abilityId} switched on`;
      case 'deactivate': return `${lib.abilities[e.abilityId ?? '']?.name ?? e.abilityId} switched off${e.text ? ` (${e.text})` : ''}`;
      case 'use': return `Used ${lib.abilities[e.abilityId ?? '']?.name ?? e.abilityId}${e.targetId ? ` on ${name(e.targetId)}` : ''}`;
      case 'hp': return e.text ?? 'HP change';
      default: return e.text ?? e.kind;
    }
  };
  const rows = [...battle.log].reverse();
  return (
    <div>
      <div className="mb-2 flex justify-end"><Button size="sm" variant="ghost" disabled={!battle.log.length} onClick={() => undo(battle.log.at(-1)!.id)}>Undo last</Button></div>
      {rows.length === 0 && <p className="text-sm text-zinc-500">Nothing logged yet.</p>}
      <div className="space-y-1">
        {rows.map((e) => (
          <div key={e.id} className={cx('rounded-xl px-3 py-2 text-sm', e.kind === 'roundStart' ? 'text-center text-zinc-500' : 'bg-zinc-900 border border-zinc-800')}>
            <div className="flex items-center justify-between gap-2">
              <span><span className="text-zinc-500 mr-2">R{e.round}</span>{desc(e)}{e.editedAt ? <span className="text-zinc-500"> (edited)</span> : null}</span>
              {e.kind !== 'roundStart' && <button type="button" className="text-zinc-500 px-2" title="undo" onClick={() => undo(e.id)}>✕</button>}
            </div>
            {e.kind === 'attack' && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {(['hit', 'miss', 'crit'] as const).map((r) => <Chip key={r} tone={r === 'miss' ? 'red' : r === 'crit' ? 'amber' : 'green'} active={e.result === r} onClick={() => setBattle(editLogEvent(battle, e.id, { result: r }))}>{r}</Chip>)}
                <input className="ml-2 w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm" inputMode="numeric" placeholder="dmg" value={e.damage ?? ''} onChange={(ev) => setBattle(editLogEvent(battle, e.id, { damage: ev.target.value === '' ? undefined : Number(ev.target.value) }))} />
              </div>
            )}
            {e.checks && e.checks.length > 0 && (
              <div className="mt-1 space-y-0.5 text-xs text-amber-300">
                {e.checks.map((c, i) => <div key={i}>{c.name} — {SAVE_LABEL[c.save] ?? c.save} DC {c.dc}: {c.effect}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
