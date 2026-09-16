import { listCharges, setChargesUsed, type ChargeRow as ChargeRowData, type EvalContext } from '@hl/engine';
import { useStore } from '../../store/store';
import { usePathLongPress } from '../../hooks/usePathLongPress';
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
  return (
    <Sheet open onClose={onClose} title="Charges" tall>
      {rows.length === 0 && <p className="text-sm text-zinc-500">Nothing with limited uses is enabled.</p>}
      {rows.length > 0 && <div className="mb-2 flex justify-end"><Button size="sm" variant="ghost" onClick={resetAll}>Reset all</Button></div>}
      <div className="space-y-2">
        {rows.map((r) => <ChargeRow key={r.id} row={r} onBattleOnly={(r.resetOn === 'round' || r.resetOn === 'encounter') && !ctx.battle} onApply={(used) => apply(r.id, used)} />)}
      </div>
    </Sheet>
  );
}

function ChargeRow({ row, onBattleOnly, onApply }: { row: ChargeRowData; onBattleOnly: boolean; onApply: (used: number) => void }) {
  const press = usePathLongPress(`player.left('${row.id}')`, `${row.label} left`);
  const perLabel = { round: 'per round', encounter: 'per battle', day: 'per day', never: 'no reset' } as const;
  return (
    <div data-charge={row.id} {...press} className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.label}</div>
          <div className="truncate text-xs text-zinc-500">{row.ownerName !== row.label ? `${row.ownerName} · ` : ''}{perLabel[row.resetOn]}</div>
        </div>
        <div className={cx('text-xl font-bold tabular-nums', row.remaining === 0 ? 'text-red-400' : 'text-emerald-300')}>{row.remaining}<span className="text-sm text-zinc-500">/{row.max}</span></div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={onBattleOnly || row.remaining <= 0} onClick={() => onApply(row.used + 1)}>− use</Button>
        <Button size="sm" disabled={onBattleOnly || row.used <= 0} onClick={() => onApply(row.used - 1)}>+ restore</Button>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={onBattleOnly || row.used === 0} onClick={() => onApply(0)}>Reset</Button>
      </div>
      {onBattleOnly && <div className="mt-1 text-xs text-zinc-500">Tracked during a battle.</div>}
    </div>
  );
}
