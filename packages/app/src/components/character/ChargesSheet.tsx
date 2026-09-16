import { listCharges, setChargesUsed, type EvalContext } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Sheet, cx } from '../ui';

/** Every charge pool at a glance: what is left, −/+ to correct, reset per row or all at once. */
export function ChargesSheet({ ctx, onClose }: { ctx: EvalContext; onClose: () => void }) {
  const applyState = useStore((s) => s.applyState);
  const rows = listCharges(ctx);
  const apply = (id: string, used: number) => {
    const r = setChargesUsed(ctx, id, used);
    applyState(r);
  };
  const resetAll = () => {
    let cur = ctx;
    for (const r of rows) { const n = setChargesUsed(cur, r.id, 0); cur = { ...cur, character: n.character, ...(n.battle ? { battle: n.battle } : {}) }; }
    applyState({ character: cur.character, ...(cur.battle ? { battle: cur.battle } : {}) });
  };
  const perLabel = { round: 'per round', encounter: 'per battle', day: 'per day', never: 'no reset' } as const;
  return (
    <Sheet open onClose={onClose} title="Charges" tall>
      {rows.length === 0 && <p className="text-sm text-zinc-500">Nothing with limited uses is enabled.</p>}
      {rows.length > 0 && <div className="mb-2 flex justify-end"><Button size="sm" variant="ghost" onClick={resetAll}>Reset all</Button></div>}
      <div className="space-y-2">
        {rows.map((r) => {
          const onBattle = (r.resetOn === 'round' || r.resetOn === 'encounter') && !ctx.battle;
          return (
            <div key={r.id} data-charge={r.id} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="truncate text-xs text-zinc-500">{r.ownerName !== r.label ? `${r.ownerName} · ` : ''}{perLabel[r.resetOn]}</div>
                </div>
                <div className={cx('text-xl font-bold tabular-nums', r.remaining === 0 ? 'text-red-400' : 'text-emerald-300')}>{r.remaining}<span className="text-sm text-zinc-500">/{r.max}</span></div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" disabled={onBattle || r.remaining <= 0} onClick={() => apply(r.id, r.used + 1)}>− use</Button>
                <Button size="sm" disabled={onBattle || r.used <= 0} onClick={() => apply(r.id, r.used - 1)}>+ restore</Button>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={onBattle || r.used === 0} onClick={() => apply(r.id, 0)}>Reset</Button>
              </div>
              {onBattle && <div className="mt-1 text-xs text-zinc-500">Tracked during a battle.</div>}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
