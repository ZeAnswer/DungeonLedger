import { useMemo, useState } from 'react';
import { applyHp, availableActions, derivedFromLevels, effectiveScores, listPools, resolveStat, rest, type Ability, type StatId } from '@hl/engine';
import { useStore } from '../store/store';
import { useCtx } from '../store/hooks';
import { Button, Chip, Field, Section, Sheet, cx, inputCls, signed } from '../components/ui';
import { Breakdown } from '../components/battle/AttackPanel';
import { AbilitySheet } from '../components/character/AbilitySheet';
import { LevelLedger } from '../components/character/LevelLedger';
import { ChargesSheet } from '../components/character/ChargesSheet';
import { CharacterOverrideSheet, LedgerOverrideSheet, SkillsEditSheet, StatsEditSheet } from '../components/character/EditSheets';

const GROUPS: { id: string; title: string; test: (a: Ability) => boolean }[] = [
  { id: 'feats', title: 'Feats', test: (a) => a.kind === 'feature' && a.acquired.kind === 'feat' },
  { id: 'class', title: 'Class abilities', test: (a) => a.kind === 'feature' && (a.acquired.kind === 'class' || a.acquired.kind === 'race') },
  { id: 'memories', title: 'Memories & DM grants', test: (a) => a.kind === 'feature' && a.acquired.kind === 'dm' },
  { id: 'spells', title: 'Spells', test: (a) => a.kind === 'spell' },
];

export function CharacterScreen() {
  const ctx = useCtx();
  const setCharacter = useStore((s) => s.setCharacter);
  const battle = useStore((s) => s.battle);
  const setBattle = useStore((s) => s.setBattle);
  const showToast = useStore((s) => s.showToast);
  const [hpOp, setHpOp] = useState<'damage' | 'heal' | 'temp' | 'nonlethal' | undefined>();
  const [amount, setAmount] = useState('');
  const [stat, setStat] = useState<StatId | undefined>();
  const [abilityId, setAbilityId] = useState<string | undefined>();
  const [allSkills, setAllSkills] = useState(false);
  const [edit, setEdit] = useState<'stats' | 'skills' | 'ledger' | 'character' | undefined>();
  const [charges, setCharges] = useState(false);
  const derived = useMemo(() => (ctx ? derivedFromLevels(ctx.character, ctx.library) : undefined), [ctx]);
  const actions = useMemo(() => (ctx ? availableActions(ctx) : []), [ctx]);
  const pools = useMemo(() => (ctx ? listPools(ctx) : []), [ctx]);
  if (!ctx || !derived) return <div className="p-4 text-zinc-500">No character.</div>;
  const c = ctx.character;
  const hpMax = resolveStat(ctx, 'hp.max').total;
  const scores = effectiveScores(ctx);
  const stats: { id: StatId; label: string }[] = [
    { id: 'ac', label: 'AC' }, { id: 'ac.touch', label: 'Touch' }, { id: 'ac.flatFooted', label: 'Flat-footed' },
    { id: 'save.fort', label: 'Fort' }, { id: 'save.ref', label: 'Ref' }, { id: 'save.will', label: 'Will' }, { id: 'init', label: 'Init' }, { id: 'speed', label: 'Speed' },
  ];
  const doHp = () => {
    const n = Number(amount); if (!n || !hpOp) return;
    const applied = applyHp(c, { [hpOp]: n }, hpMax);
    const text = `${hpOp} ${n} → HP ${applied.hp.current}/${hpMax}${battle ? ` (${battle.name}, round ${battle.round})` : ''}`;
    setCharacter({ ...applied, journal: [...applied.journal, { at: new Date().toISOString(), kind: 'hp', text }] });
    if (battle) setBattle({ ...battle, log: [...battle.log, { id: `hp-${Date.now()}`, round: battle.round, seq: (battle.log.at(-1)?.seq ?? 0) + 1, kind: 'hp', actor: 'self', text }] });
    setHpOp(undefined); setAmount('');
  };
  const doRest = (kind: 'short' | 'long') => {
    const what = kind === 'short' ? 'Short rest: refill per-battle charges, heal nonlethal 1/level.' : 'Long rest: refill daily charges, +1 hp per level, clear temp and nonlethal.';
    if (!confirm(what)) return;
    const r = rest(ctx, kind);
    setCharacter(r.character);
    if (r.battle) setBattle(r.battle);
    showToast(r.summary);
  };
  const mod = (v: number) => Math.floor((v - 10) / 2);
  const classSkillIds = new Set(c.classLevels.flatMap((l) => ctx.library.classTables[l.classId]?.classSkills ?? []));
  const isClassSkill = (id: string) => classSkillIds.has(id) || !!c.skills[id]?.classSkillOverride;
  const skillRows = Object.values(ctx.library.skills).filter((s) => allSkills || isClassSkill(s.id) || (c.skills[s.id]?.ranks ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name));
  const abilitiesOf = (test: (a: Ability) => boolean) => c.abilities.map((inst) => ({ inst, a: ctx.library.abilities[inst.abilityId] })).filter((x): x is { inst: typeof x.inst; a: Ability } => !!x.a && test(x.a));

  return (
    <div className="p-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{c.name}</h1><Button size="sm" variant="ghost" onClick={() => setEdit('character')}>{'{ }'} JSON</Button></div>
      <div className="mb-3 text-sm text-zinc-400">{c.classLevels.map((l) => `${ctx.library.classTables[l.classId]?.name ?? l.classId} ${l.level}`).join(' / ')} · level {derived.level} · XP {c.xp}{derived.nextLevelXp ? ` / ${derived.nextLevelXp}` : ''}</div>

      <div className="mb-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-3">
        <div className="flex items-end gap-3">
          <span className={cx('text-4xl font-bold tabular-nums', c.hp.current <= 0 ? 'text-red-400' : c.hp.current * 2 <= hpMax ? 'text-amber-300' : 'text-emerald-300')}>{c.hp.current}</span>
          <button type="button" className="text-zinc-400 mb-1" onClick={() => setStat('hp.max')}>/ {hpMax}</button>
          {c.hp.temp > 0 && <span className="mb-1 rounded bg-sky-900 px-2 text-sky-200">+{c.hp.temp} temp</span>}
          {c.hp.nonlethal > 0 && <span className="mb-1 rounded bg-zinc-800 px-2 text-zinc-300">{c.hp.nonlethal} nonlethal</span>}
          {c.hp.current <= 0 && <span className="mb-1 rounded bg-red-900 px-2 text-red-200">{c.hp.current === 0 ? 'disabled' : c.hp.current <= -10 ? 'dead' : 'dying'}</span>}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Button variant="danger" onClick={() => setHpOp('damage')}>Damage</Button>
          <Button variant="success" onClick={() => setHpOp('heal')}>Heal</Button>
          <Button onClick={() => setHpOp('temp')}>Temp</Button>
          <Button onClick={() => setHpOp('nonlethal')}>Nonlethal</Button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button variant="ghost" onClick={() => doRest('short')}>Short rest</Button>
          <Button variant="ghost" onClick={() => doRest('long')}>Long rest</Button>
          <Button variant="ghost" onClick={() => setCharges(true)}>Charges</Button>
        </div>
      </div>

      <Section id="stats" title="Stats" right={<Button size="sm" variant="ghost" onClick={() => setEdit('stats')}>Edit</Button>}>
        <div className="grid grid-cols-6 gap-1 mb-2 text-center">
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => { const eff = scores[k]; return (
            <button key={k} type="button" onClick={() => setStat(`ability.${k}`)} className="rounded-xl bg-zinc-900 py-1 active:bg-zinc-800"><div className="text-[10px] uppercase text-zinc-500">{k}</div><div className={cx('font-bold', eff !== c.abilityScores[k] && 'text-amber-300')}>{eff}</div><div className="text-xs text-zinc-400">{signed(mod(eff))}{eff !== c.abilityScores[k] ? <span className="text-zinc-600"> ({c.abilityScores[k]})</span> : null}</div></button>
          ); })}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s) => { const r = resolveStat(ctx, s.id); return <button key={s.id} type="button" onClick={() => setStat(s.id)} className="rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-center active:bg-zinc-800"><div className="text-[10px] uppercase text-zinc-500">{s.label}</div><div className="text-xl font-bold tabular-nums">{s.id === 'speed' || s.id.startsWith('ac') ? r.total : signed(r.total)}</div></button>; })}
          <div className="rounded-xl border border-zinc-800 py-2 text-center"><div className="text-[10px] uppercase text-zinc-500">BAB</div><div className="text-xl font-bold">{signed(derived.bab)}</div></div>
        </div>
        {ctx.target && <p className="mt-2 text-xs text-zinc-500">Conditional bonuses shown vs current target: {ctx.target.name}.</p>}
      </Section>

      <Section id="skills" title="Skills" count={skillRows.length} right={<span className="flex items-center gap-1"><Chip active={allSkills} onClick={() => setAllSkills(!allSkills)}>{allSkills ? 'All skills' : 'Class skills'}</Chip><Button size="sm" variant="ghost" onClick={() => setEdit('skills')}>Edit</Button></span>}>
        <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {skillRows.map((s) => { const r = resolveStat(ctx, `skill.${s.id}`); const ranks = c.skills[s.id]?.ranks ?? 0; const cs = isClassSkill(s.id); const usable = ranks > 0 || !s.trainedOnly; return (
            <button key={s.id} type="button" onClick={() => setStat(`skill.${s.id}`)} className={cx('flex w-full items-center justify-between px-3 py-1.5 text-left text-sm', !usable && 'text-zinc-600', usable && ranks === 0 && 'text-zinc-400')}>
              <span>{s.name}<span className="ml-2 text-xs text-zinc-500">{ranks ? `${ranks} ranks` : ''}{cs ? '' : ' · cross-class'}{s.trainedOnly && !ranks ? ' · trained only' : ''}</span></span>
              <span className="font-semibold tabular-nums">{usable ? signed(r.total) : '—'}</span>
            </button>
          ); })}
        </div>
      </Section>

      {GROUPS.map((g) => { const list = abilitiesOf(g.test); return list.length ? (
        <Section key={g.id} id={g.id} title={g.title} count={list.length}>
          <div className="space-y-1">
            {list.map(({ inst, a }) => (
              <button key={a.id} type="button" onClick={() => setAbilityId(a.id)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-left">
                <div className="min-w-0">
                  <div className="truncate">{a.name}{a.todo ? <span className="ml-1 text-amber-400" title={a.todo}>⚑</span> : null}</div>
                  <div className="truncate text-xs text-zinc-500">{a.sourceRef ?? a.kind}{actions.filter((x) => x.abilityId === a.id && x.charges).map((x) => ` · ${x.charges!.label} ${x.charges!.remaining}/${x.charges!.max}`)}{pools.filter((p) => p.abilityId === a.id).map((p) => ` · ${p.label} ${p.remaining}/${p.max}`)}{Object.entries(inst.paramValues).map(([k, v]) => ` · ${k}: ${v.map((t) => ctx.library.tags[t]?.label ?? t).join(', ')}`)}{a.kind === 'feature' && a.params && Object.keys(a.params).some((k) => !inst.paramValues[k]?.length) ? ' · ⚠ choose types' : ''}</div>
                </div>
                <span className="text-zinc-600">›</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null; })}

      <Section id="ledger" title="Level ledger" count={derived.level} right={<Button size="sm" variant="ghost" onClick={() => setEdit('ledger')}>Override</Button>}><LevelLedger ctx={ctx} /></Section>

      {c.journal.length > 0 && (
        <Section id="history" title="History" count={c.journal.length}>
          <div className="space-y-1 text-sm">
            {[...c.journal].reverse().slice(0, 30).map((j, i) => <div key={i} className="rounded-xl bg-zinc-900 px-3 py-1.5"><span className="mr-2 text-xs text-zinc-500">{j.at.slice(0, 10)} · {j.kind}</span>{j.text}</div>)}
          </div>
        </Section>
      )}

      {c.notes && <Section id="notes" title="Notes"><pre className="whitespace-pre-wrap rounded-xl bg-zinc-900 p-3 text-xs text-zinc-300">{c.notes}</pre></Section>}

      {edit === 'stats' && <StatsEditSheet ctx={ctx} onClose={() => setEdit(undefined)} />}
      {edit === 'skills' && <SkillsEditSheet ctx={ctx} onClose={() => setEdit(undefined)} />}
      {edit === 'ledger' && <LedgerOverrideSheet ctx={ctx} onClose={() => setEdit(undefined)} />}
      {edit === 'character' && <CharacterOverrideSheet ctx={ctx} onClose={() => setEdit(undefined)} />}
      {charges && <ChargesSheet ctx={ctx} onClose={() => setCharges(false)} />}
      {abilityId && ctx.library.abilities[abilityId] && <AbilitySheet ctx={ctx} ability={ctx.library.abilities[abilityId]!} onClose={() => setAbilityId(undefined)} />}

      <Sheet open={!!hpOp} onClose={() => setHpOp(undefined)} title={hpOp ? hpOp[0]!.toUpperCase() + hpOp.slice(1) : ''}>
        <Field label="Amount" htmlFor="hp-amount"><input id="hp-amount" autoFocus className={inputCls + ' text-3xl'} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doHp()} /></Field>
        <Button variant="primary" size="lg" className="w-full" onClick={doHp}>Apply</Button>
      </Sheet>

      <Sheet open={!!stat} onClose={() => setStat(undefined)} title={stat}>
        {stat && (() => { const r = resolveStat(ctx, stat); return (
          <div className="text-sm">
            <div className="mb-3 text-3xl font-bold">{signed(r.total)}</div>
            <Breakdown title="Breakdown" entries={r.entries} />
            {r.nearMiss.length > 0 && <div className="mt-3"><div className="mb-1 text-xs uppercase text-zinc-500">Not applying</div>{r.nearMiss.map((n) => <div key={n.source + n.label} className="text-zinc-500">{n.label} ({n.summary}) — needs {n.failed}</div>)}</div>}
            {r.warnings.map((w) => <div key={w} className="mt-2 text-amber-300">{w}</div>)}
          </div>
        ); })()}
      </Sheet>
    </div>
  );
}
