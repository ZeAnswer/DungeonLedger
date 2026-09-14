import { useState } from 'react';
import { derivedFromLevels, levelSlots, maxRanks, type AbilityKey, type EvalContext, type Feature, type LevelRecord } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, Field, Sheet, cx, inputCls } from '../ui';

export function LevelLedger({ ctx }: { ctx: EvalContext }) {
  const setCharacter = useStore((s) => s.setCharacter);
  const c = ctx.character;
  const d = derivedFromLevels(c, ctx.library);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | undefined>();
  const classes = Object.values(ctx.library.classTables);
  const prevXp = ctx.library.xpTable.find((r) => r.level === d.level)?.xp ?? 0;
  const pct = d.nextLevelXp ? Math.min(100, Math.round(((c.xp - prevXp) / (d.nextLevelXp - prevXp)) * 100)) : 100;

  const saveRecord = (rec: LevelRecord, index?: number) => {
    const history = index === undefined ? [...c.levelHistory, rec] : c.levelHistory.map((r, i) => (i === index ? rec : r));
    const next = { ...c, levelHistory: history };
    if (index === undefined) {
      // A new level: class level, ability increase, class features, feats and skill ranks all follow the record. Editing an old record changes only the record.
      const cl = c.classLevels.find((x) => x.classId === rec.classId);
      next.classLevels = cl ? c.classLevels.map((x) => (x.classId === rec.classId ? { ...x, level: x.level + 1 } : x)) : [...c.classLevels, { classId: rec.classId, level: 1 }];
      if (rec.abilityIncrease) next.abilityScores = { ...c.abilityScores, [rec.abilityIncrease]: c.abilityScores[rec.abilityIncrease] + 1 };
      const known = new Set(c.abilities.map((a) => a.abilityId));
      const gained = [...rec.featuresGained, ...rec.featsTaken].filter((id) => ctx.library.abilities[id] && !known.has(id));
      next.abilities = [...c.abilities, ...gained.map((abilityId) => ({ abilityId, enabled: true, paramValues: {} }))];
      const skills = { ...c.skills };
      const classSkills = ctx.library.classTables[rec.classId]?.classSkills ?? [];
      for (const [sk, n] of Object.entries(rec.skillPointsSpent)) {
        const cross = !classSkills.includes(sk) && !c.skills[sk]?.classSkillOverride;
        skills[sk] = { ...(skills[sk] ?? { ranks: 0 }), ranks: (skills[sk]?.ranks ?? 0) + (cross ? n / 2 : n) };
      }
      next.skills = skills;
      const conMod = Math.floor((next.abilityScores.con - 10) / 2);
      next.hp = { ...c.hp, current: c.hp.current + Math.max(1, rec.hpRolled + conMod) };
      const parts = [
        `Level ${rec.level}: ${ctx.library.classTables[rec.classId]?.name ?? rec.classId}`,
        `HP roll ${rec.hpRolled}${conMod ? ` ${conMod > 0 ? '+' : ''}${conMod} Con` : ''}`,
        rec.abilityIncrease ? `+1 ${rec.abilityIncrease.toUpperCase()}` : '',
        Object.keys(rec.skillPointsSpent).length ? `skills: ${Object.entries(rec.skillPointsSpent).map(([k, v]) => `${ctx.library.skills[k]?.name ?? k} +${v}`).join(', ')}` : '',
        rec.featsTaken.length ? `feats: ${rec.featsTaken.map((f) => ctx.library.abilities[f]?.name ?? f).join(', ')}` : '',
        rec.featuresGained.length ? `features: ${rec.featuresGained.map((f) => ctx.library.abilities[f]?.name ?? f).join(', ')}` : '',
        rec.notes ?? '',
      ].filter(Boolean);
      next.journal = [...c.journal, { at: rec.at ?? new Date().toISOString(), kind: 'levelUp', text: parts.join(' · ') }];
    } else {
      next.journal = [...c.journal, { at: new Date().toISOString(), kind: 'edit', text: `Edited level ${rec.level} record` }];
    }
    setCharacter(next);
  };

  return (
    <div>
      <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => setAdding(true)}>+ Level up</Button></div>
      <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-center justify-between text-sm"><span>Level {d.level}</span><span className="tabular-nums">XP <input className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-right" inputMode="numeric" value={c.xp} onChange={(e) => setCharacter({ ...c, xp: Number(e.target.value) || 0 })} />{d.nextLevelXp ? ` / ${d.nextLevelXp}` : ''}</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-amber-500" style={{ width: `${pct}%` }} /></div>
        <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-zinc-400">
          <span>BAB +{d.bab}</span><span>Fort +{d.baseSaves.fort} Ref +{d.baseSaves.ref} Will +{d.baseSaves.will} (base)</span>
          {c.levelHistory.length > 0 && <span className={d.skillPoints.leftover > 0 ? 'text-amber-300' : ''}>Skill points {d.skillPoints.spent}/{d.skillPoints.total}{d.skillPoints.leftover > 0 ? ` · ${d.skillPoints.leftover} unspent` : ''}</span>}
        </div>
        {d.warnings.map((w) => <div key={w} className="mt-1 text-xs text-amber-300">{w}</div>)}
      </div>
      {c.levelHistory.length === 0 ? (
        <p className="text-xs text-zinc-500">No per-level records yet. Class levels are set directly ({c.classLevels.map((l) => `${l.classId} ${l.level}`).join(', ')}). Add a level to start the ledger, or import your RPG Scribe history.</p>
      ) : (
        <div className="space-y-1">
          {c.levelHistory.map((r, i) => (
            <button key={i} type="button" onClick={() => setEditing(i)} className="flex w-full items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-left text-sm">
              <span>Lv {r.level} · {ctx.library.classTables[r.classId]?.name ?? r.classId}</span>
              <span className="text-right text-xs text-zinc-500">HP {r.hpRolled} · {Object.values(r.skillPointsSpent).reduce((a, b) => a + b, 0)} sp{r.abilityIncrease ? ` · +1 ${r.abilityIncrease.toUpperCase()}` : ''}{r.featsTaken.length ? ` · ${r.featsTaken.map((f) => ctx.library.abilities[f]?.name ?? f).join(', ')}` : ''}{r.featuresGained.length ? ` · ${r.featuresGained.map((f) => ctx.library.abilities[f]?.name ?? f).join(', ')}` : ''}{r.notes ? ' · ⚑' : ''}</span>
            </button>
          ))}
        </div>
      )}
      {(adding || editing !== undefined) && (
        <LevelSheet ctx={ctx} classes={classes} isNew={editing === undefined} initial={editing !== undefined ? c.levelHistory[editing]! : { level: d.level + 1, classId: c.classLevels.at(-1)?.classId ?? classes[0]?.id ?? '', hpRolled: 0, skillPointsSpent: {}, featsTaken: [], featuresGained: [], spellsLearned: [], at: new Date().toISOString() }}
          onClose={() => { setAdding(false); setEditing(undefined); }}
          onSave={(rec) => { saveRecord(rec, editing); setAdding(false); setEditing(undefined); }}
          onDelete={editing !== undefined ? () => { setCharacter({ ...c, levelHistory: c.levelHistory.filter((_, i) => i !== editing) }); setEditing(undefined); } : undefined} />
      )}
    </div>
  );
}

function LevelSheet({ ctx, classes, initial, isNew, onClose, onSave, onDelete }: { ctx: EvalContext; classes: { id: string; name: string; hitDie: number; skillPointsPerLevel: number; classSkills: string[]; levelFeatures: Record<string, string[]> }[]; initial: LevelRecord; isNew: boolean; onClose: () => void; onSave: (r: LevelRecord) => void; onDelete?: () => void }) {
  const [r, setR] = useState<LevelRecord>(initial);
  const slots = levelSlots(r.level, { humanBonusFeat: ctx.character.extraFeatAtFirstLevel });
  const classLevelAfter = (ctx.character.classLevels.find((x) => x.classId === r.classId)?.level ?? 0) + (isNew ? 1 : 0);
  const autoFeatures = classes.find((k) => k.id === r.classId)?.levelFeatures[String(classLevelAfter)] ?? [];
  const setClass = (classId: string) => {
    const feats = classes.find((k) => k.id === classId)?.levelFeatures[String((ctx.character.classLevels.find((x) => x.classId === classId)?.level ?? 0) + (isNew ? 1 : 0))] ?? [];
    setR({ ...r, classId, featuresGained: isNew ? feats : r.featuresGained });
  };
  const [skillQ, setSkillQ] = useState('');
  const intMod = Math.floor((ctx.character.abilityScores.int - 10) / 2);
  const cls = classes.find((x) => x.id === r.classId);
  const points = cls ? (Math.max(1, cls.skillPointsPerLevel + intMod) + ctx.character.extraSkillPointsPerLevel) * (r.level === 1 ? 4 : 1) : 0;
  const spent = Object.values(r.skillPointsSpent).reduce((a, b) => a + b, 0);
  const skills = Object.values(ctx.library.skills).filter((s) => !skillQ || s.name.toLowerCase().includes(skillQ.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const feats = Object.values(ctx.library.abilities).filter((a): a is Feature => a.kind === 'feature').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Sheet open onClose={onClose} title={`Level ${r.level}`} tall>
      <Field label="Class"><div className="flex flex-wrap gap-1">{classes.map((k) => <Chip key={k.id} active={r.classId === k.id} onClick={() => setClass(k.id)}>{k.name} (d{k.hitDie})</Chip>)}</div></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Character level"><input className={inputCls} inputMode="numeric" value={r.level} onChange={(e) => setR({ ...r, level: Number(e.target.value) || 1 })} /></Field>
        <Field label={`HP roll (d${cls?.hitDie ?? '?'}${r.level === 1 ? ', max at level 1' : ''}; Con added automatically)`} htmlFor="lv-hp"><input id="lv-hp" className={inputCls} inputMode="numeric" value={r.hpRolled} onChange={(e) => setR({ ...r, hpRolled: Number(e.target.value) || 0 })} /></Field>
      </div>
      <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
        This level grants: {slots.feats ? `${slots.feats} general feat${slots.feats > 1 ? 's' : ''}` : 'no general feat'}{slots.abilityIncrease ? ', +1 to one ability score' : ''}{autoFeatures.length ? `, class features: ${autoFeatures.map((f) => ctx.library.abilities[f]?.name ?? f).join(', ')}` : ''}. Max ranks: {maxRanks(r.level, true)} (class) / {maxRanks(r.level, false)} (cross-class).
      </div>
      {slots.abilityIncrease && (
        <Field label="Ability score +1"><div className="flex flex-wrap gap-1">{(['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[]).map((k) => <Chip key={k} tone="amber" active={r.abilityIncrease === k} onClick={() => setR({ ...r, abilityIncrease: r.abilityIncrease === k ? undefined : k })}>{k.toUpperCase()}</Chip>)}</div></Field>
      )}
      <Field label={`Skill points: ${spent} / ${points}${cls ? ` (${cls.skillPointsPerLevel} + Int ${intMod}${r.level === 1 ? ', ×4' : ''})` : ''}`}>
        <input className={inputCls + ' mb-2'} placeholder="Filter skills…" value={skillQ} onChange={(e) => setSkillQ(e.target.value)} />
        <div className="max-h-56 overflow-y-auto divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {skills.map((s) => { const n = r.skillPointsSpent[s.id] ?? 0; const cs = !!cls?.classSkills.includes(s.id) || !!ctx.character.skills[s.id]?.classSkillOverride; const have = ctx.character.skills[s.id]?.ranks ?? 0; const after = have + (isNew ? (cs ? n : n / 2) : 0); const over = after > maxRanks(r.level, cs); return (
            <div key={s.id} className="flex items-center justify-between px-3 py-1 text-sm"><span className={cs ? '' : 'text-zinc-500'}>{s.name}{cs ? '' : ' (cross-class)'}<span className={cx('ml-1 text-xs', over ? 'text-red-400' : 'text-zinc-500')}>{have}{n ? `→${after}` : ''}{over ? ' over max' : ''}</span></span>
              <span className="flex items-center gap-2"><button type="button" className="px-2" onClick={() => setR({ ...r, skillPointsSpent: { ...r.skillPointsSpent, [s.id]: Math.max(0, n - 1) } })}>−</button><span className="w-4 text-center tabular-nums">{n}</span><button type="button" className="px-2" onClick={() => setR({ ...r, skillPointsSpent: { ...r.skillPointsSpent, [s.id]: n + 1 } })}>+</button></span>
            </div>
          ); })}
        </div>
      </Field>
      <Field label={`General feats chosen (${r.featsTaken.length}/${slots.feats})`}><div className="flex flex-wrap gap-1">{feats.filter((f) => f.acquired.kind === 'feat').map((f) => <Chip key={f.id} active={r.featsTaken.includes(f.id)} onClick={() => setR({ ...r, featsTaken: r.featsTaken.includes(f.id) ? r.featsTaken.filter((x) => x !== f.id) : [...r.featsTaken, f.id] })}>{f.name}</Chip>)}</div></Field>
      <Field label="Class features gained (auto from class table, adjust if needed)"><div className="flex flex-wrap gap-1">{feats.filter((f) => f.acquired.kind === 'class' || autoFeatures.includes(f.id) || r.featuresGained.includes(f.id)).map((f) => <Chip key={f.id} tone="blue" active={r.featuresGained.includes(f.id)} onClick={() => setR({ ...r, featuresGained: r.featuresGained.includes(f.id) ? r.featuresGained.filter((x) => x !== f.id) : [...r.featuresGained, f.id] })}>{f.name}</Chip>)}</div></Field>
      <Field label="Notes"><input className={inputCls} value={r.notes ?? ''} onChange={(e) => setR({ ...r, notes: e.target.value || undefined })} /></Field>
      <div className="flex gap-2"><Button variant="primary" onClick={() => onSave(r)}>Save</Button>{onDelete && <Button variant="danger" className="ml-auto" onClick={onDelete}>Delete</Button>}</div>
    </Sheet>
  );
}
