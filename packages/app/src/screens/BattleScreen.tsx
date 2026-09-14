import { useMemo, useState } from 'react';
import { availableActions, listPools, nextRound } from '@hl/engine';
import { useStore } from '../store/store';
import { useCtx } from '../store/hooks';
import { Button, cx } from '../components/ui';
import { Roster } from '../components/battle/Roster';
import { AttackPanel } from '../components/battle/AttackPanel';
import { BuffsDrawer } from '../components/battle/BuffsDrawer';
import { SituationalSheet } from '../components/battle/SituationalSheet';
import { LogView } from '../components/battle/LogView';

export function BattleScreen() {
  const ctx = useCtx();
  const battle = useStore((s) => s.battle);
  const pastBattles = useStore((s) => s.pastBattles);
  const startBattle = useStore((s) => s.startBattle);
  const endBattle = useStore((s) => s.endBattle);
  const setBattle = useStore((s) => s.setBattle);
  const setCharacter = useStore((s) => s.setCharacter);
  const [tab, setTab] = useState<'fight' | 'log'>('fight');
  const [buffs, setBuffs] = useState(false);
  const [sit, setSit] = useState(false);
  const resources = useMemo(() => {
    if (!ctx) return [];
    const all = [...availableActions(ctx).flatMap((a) => (a.charges ? [a.charges] : [])), ...listPools(ctx)];
    return [...new Map(all.map((r) => [r.id, r])).values()];
  }, [ctx]);

  if (!ctx) return <div className="p-4 text-zinc-500">No character loaded. Import a pack in Settings.</div>;

  if (!battle) {
    return (
      <div className="p-4">
        <h1 className="mb-2 text-2xl font-bold">Battle</h1>
        <p className="mb-4 text-zinc-400">Start a battle, add the monsters as they appear, tap one to see your numbers.</p>
        <Button variant="primary" size="lg" className="w-full" onClick={() => startBattle()}>⚔️ New battle</Button>
        {pastBattles.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm uppercase tracking-wide text-zinc-400">Past battles</h2>
            {pastBattles.map((b) => (
              <div key={b.id} className="mb-2 flex items-center justify-between rounded-xl border border-zinc-800 px-3 py-2 text-sm">
                <span>{b.name} · {b.round} rounds · {b.combatants.length} foes</span>
                <Button size="sm" variant="ghost" onClick={() => setBattle({ ...b, ended: false })}>Reopen</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">{battle.name}</div>
          <div className="text-2xl font-bold">Round {battle.round}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => { const r = nextRound(ctx); setBattle(r.battle); setCharacter(r.character); }}>Next round ▶</Button>
          <Button variant="ghost" onClick={() => { if (confirm('End this battle?')) endBattle(); }}>End</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {resources.map((r) => <span key={r.id} className={cx('rounded-full border px-2 py-1', r.remaining === 0 ? 'border-red-900 text-red-300' : 'border-zinc-700 text-zinc-300')}>{r.label} {r.remaining}/{r.max}</span>)}
        {battle.activeBuffs.map((b) => <button key={b.instanceId} type="button" onClick={() => setBuffs(true)} className={cx('rounded-full border px-2 py-1', b.suppressed ? 'border-zinc-800 text-zinc-600 line-through' : 'border-emerald-800 text-emerald-300')}>{b.label ?? ctx.library.abilities[b.abilityId]?.name ?? battle.statuses.find((s) => s.id === b.abilityId)?.name ?? b.abilityId}{b.remainingRounds !== undefined ? ` · ${b.remainingRounds}r` : ''}</button>)}
        {battle.suppressedAbilities.map((id) => <button key={id} type="button" onClick={() => setBuffs(true)} className="rounded-full border border-red-900 px-2 py-1 text-red-300 line-through">{ctx.library.abilities[id]?.name ?? id}</button>)}
        <button type="button" onClick={() => setBuffs(true)} className="rounded-full border border-dashed border-zinc-600 px-2 py-1 text-zinc-400">+ buff / suppress</button>
        <button type="button" onClick={() => setSit(true)} className="rounded-full border border-dashed border-zinc-600 px-2 py-1 text-zinc-400">+ modifier</button>
      </div>

      <Roster />

      <div className="mb-3 flex gap-1 rounded-xl bg-zinc-900 p-1">
        {(['fight', 'log'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cx('flex-1 rounded-lg py-1.5 text-sm', tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>{t === 'fight' ? 'Attack' : `Log (${battle.log.length})`}</button>)}
      </div>

      {tab === 'fight' ? <AttackPanel ctx={ctx} /> : <LogView battle={battle} />}

      <BuffsDrawer ctx={ctx} open={buffs} onClose={() => setBuffs(false)} />
      <SituationalSheet ctx={ctx} open={sit} onClose={() => setSit(false)} />
    </div>
  );
}
