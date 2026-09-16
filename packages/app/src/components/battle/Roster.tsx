import { useState } from 'react';
import { addCombatant, logEnemyAction, monsterTags, setDistance, type Combatant, type Hurt, type Size, type Monster } from '@hl/engine';
import { useCtx } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Button, Chip, Field, Sheet, cx, humanize, inputCls } from '../ui';

const HURT: { id: Hurt; label: string; tone: 'green' | 'amber' | 'red' }[] = [
  { id: 'unhurt', label: 'Unhurt', tone: 'green' }, { id: 'scratched', label: 'Scratched', tone: 'green' }, { id: 'bloodied', label: 'Bloodied', tone: 'amber' }, { id: 'nearDeath', label: 'Near death', tone: 'red' },
];
const SIZES: Size[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'];
const DISTANCES: { feet: number; label: string }[] = [{ feet: 5, label: 'adjacent' }, { feet: 10, label: '10 ft' }, { feet: 30, label: '30 ft' }, { feet: 60, label: '60 ft' }, { feet: 120, label: 'far' }];

export function Roster() {
  const battle = useStore((s) => s.battle)!;
  const targetId = useStore((s) => s.targetId);
  const setTarget = useStore((s) => s.setTarget);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  const tags = useStore((s) => s.library.tags);

  return (
    <div className="mb-3">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {battle.combatants.map((c) => (
          <button key={c.id} type="button" onClick={() => setTarget(c.id === targetId ? undefined : c.id)} onContextMenu={(e) => { e.preventDefault(); setEditing(c.id); }}
            className={cx('shrink-0 rounded-2xl border px-3 py-2 text-left min-w-36 select-none touch-manipulation', c.dead ? 'opacity-40 border-zinc-800' : c.id === targetId ? 'border-amber-400 bg-amber-500/10' : 'border-zinc-700 bg-zinc-900')}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold truncate">{c.dead ? '💀 ' : ''}{c.name}</div>
              <span onClick={(e) => { e.stopPropagation(); setEditing(c.id); }} className="text-zinc-500 px-1">⋯</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-zinc-400">
              <span className={cx('rounded px-1', HURT.find((h) => h.id === c.hurt)?.tone === 'red' ? 'bg-red-900 text-red-200' : HURT.find((h) => h.id === c.hurt)?.tone === 'amber' ? 'bg-amber-900 text-amber-200' : 'bg-zinc-800')}>{HURT.find((h) => h.id === c.hurt)?.label}</span>
              {c.distanceFeet !== undefined && <span className="rounded bg-zinc-800 px-1">{DISTANCES.find((d) => d.feet === c.distanceFeet)?.label ?? `${c.distanceFeet} ft`}</span>}
              {c.tags.slice(0, 2).map((t) => <span key={t} className="rounded bg-zinc-800 px-1">{tags[t]?.label ?? t}</span>)}
              {c.conditions.map((x) => <span key={x.tag} className="rounded bg-sky-900 px-1 text-sky-200">{tags[x.tag]?.label ?? humanize(x.tag)}</span>)}
            </div>
          </button>
        ))}
        <button type="button" onClick={() => setAdding(true)} className="shrink-0 rounded-2xl border border-dashed border-zinc-600 px-4 py-2 text-zinc-400 min-w-24">+ Add</button>
      </div>
      {targetId && <TargetControls targetId={targetId} />}
      <AddCombatantSheet open={adding} onClose={() => setAdding(false)} />
      {editing && <CombatantSheet id={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function TargetControls({ targetId }: { targetId: string }) {
  const ctx = useCtx();
  const battle = useStore((s) => s.battle)!;
  const setBattle = useStore((s) => s.setBattle);
  const applyState = useStore((s) => s.applyState);
  const showToast = useStore((s) => s.showToast);
  const [dmg, setDmg] = useState('');
  const c = battle.combatants.find((x) => x.id === targetId);
  if (!c || !ctx) return null;
  const enemy = (result: 'hit' | 'miss') => {
    const damage = result === 'hit' && dmg ? Number(dmg) : undefined;
    const r = logEnemyAction(ctx, { actorId: c.id, result, ...(damage !== undefined ? { damage } : {}) });
    applyState(r); setDmg('');
    showToast(`${c.name} ${result === 'hit' ? `hit you${damage ? ` for ${damage}` : ''}` : 'missed you'}`);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
      <span className="text-zinc-500">{c.name}:</span>
      {DISTANCES.map((d) => <Chip key={d.feet} active={c.distanceFeet === d.feet} onClick={() => setBattle(setDistance(battle, c.id, c.distanceFeet === d.feet ? undefined : d.feet))}>{d.label}</Chip>)}
      <span className="ml-auto flex items-center gap-1">
        <input className="w-14 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1" inputMode="numeric" placeholder="dmg" value={dmg} onChange={(e) => setDmg(e.target.value)} />
        <Chip tone="red" onClick={() => enemy('hit')}>it hit me</Chip>
        <Chip tone="green" onClick={() => enemy('miss')}>it missed</Chip>
      </span>
    </div>
  );
}

function AddCombatantSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const library = useStore((s) => s.library);
  const battle = useStore((s) => s.battle)!;
  const setBattle = useStore((s) => s.setBattle);
  const setTarget = useStore((s) => s.setTarget);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('');
  const [size, setSize] = useState<Size>('medium');
  const [extra, setExtra] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const types = Object.values(library.tags).filter((t) => t.category === 'creatureType');
  const extras = Object.values(library.tags).filter((t) => t.category === 'subtype' || t.category === 'habitat' || t.category === 'custom');
  const monsters = Object.values(library.monsters).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

  const add = (input: Parameters<typeof addCombatant>[1]) => {
    const b = addCombatant(battle, input);
    setBattle(b);
    setTarget(b.combatants.at(-1)!.id);
    onClose();
    setName(''); setExtra([]);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add combatant" tall>
      {Object.keys(library.monsters).length > 0 && (
        <Field label="From bestiary">
          <input className={inputCls} placeholder="Search monsters…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">{monsters.map((m: Monster) => <Chip key={m.id} onClick={() => add({ monster: m, overlay: library.monsterOverlay[m.id] })}>{m.name}{m.cr !== undefined ? ` · CR ${m.cr}` : ''}</Chip>)}</div>
        </Field>
      )}
      <Field label="Quick add: name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gargoyle" /></Field>
      <Field label="Creature type"><div className="flex flex-wrap gap-2">{types.map((t) => <Chip key={t.id} active={type === t.id} onClick={() => setType(type === t.id ? '' : t.id)}>{t.label}</Chip>)}</div></Field>
      <Field label="Size"><div className="flex flex-wrap gap-2">{SIZES.map((s) => <Chip key={s} active={size === s} onClick={() => setSize(s)}>{humanize(s)}</Chip>)}</div></Field>
      <Field label="Other tags"><div className="flex flex-wrap gap-2">{extras.map((t) => <Chip key={t.id} tone="blue" active={extra.includes(t.id)} onClick={() => setExtra(extra.includes(t.id) ? extra.filter((x) => x !== t.id) : [...extra, t.id])}>{t.label}</Chip>)}</div></Field>
      <Button variant="primary" size="lg" className="w-full" disabled={!name.trim()} onClick={() => add({ name: name.trim(), tags: [...(type ? [type] : []), ...extra], size })}>Add {name || 'combatant'}</Button>
    </Sheet>
  );
}

export function CombatantSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const library = useStore((s) => s.library);
  const battle = useStore((s) => s.battle)!;
  const setBattle = useStore((s) => s.setBattle);
  const setTarget = useStore((s) => s.setTarget);
  const setMonsterOverlay = useStore((s) => s.setMonsterOverlay);
  const showToast = useStore((s) => s.showToast);
  const c = battle.combatants.find((x) => x.id === id);
  if (!c) return null;
  const update = (patch: Partial<Combatant>) => setBattle({ ...battle, combatants: battle.combatants.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const allTags = Object.values(library.tags).filter((t) => t.category !== 'condition' && t.category !== 'size');
  const condTags = Object.values(library.tags).filter((t) => t.category === 'condition');
  const monster = c.monsterId ? library.monsters[c.monsterId] : undefined;
  const toggleTag = (t: string) => update({ tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t] });
  const toggleCond = (t: string) => update({ conditions: c.conditions.some((x) => x.tag === t) ? c.conditions.filter((x) => x.tag !== t) : [...c.conditions, { tag: t, expires: 'untilRemoved', appliedRound: battle.round, source: 'manual' }] });

  return (
    <Sheet open onClose={onClose} title={c.name} tall>
      <Field label="Name"><input className={inputCls} value={c.name} onChange={(e) => update({ name: e.target.value })} /></Field>
      <Field label="Hurt"><div className="flex flex-wrap gap-2">{HURT.map((h) => <Chip key={h.id} tone={h.tone} active={c.hurt === h.id} onClick={() => update({ hurt: h.id })}>{h.label}</Chip>)}</div></Field>
      <Field label="Conditions"><div className="flex flex-wrap gap-2">{condTags.map((t) => <Chip key={t.id} tone="blue" active={c.conditions.some((x) => x.tag === t.id)} onClick={() => toggleCond(t.id)}>{t.label}</Chip>)}</div></Field>
      <Field label="Size"><div className="flex flex-wrap gap-2">{SIZES.map((s) => <Chip key={s} active={c.size === s} onClick={() => update({ size: s })}>{humanize(s)}</Chip>)}</div></Field>
      <Field label="Tags">
        <div className="flex flex-wrap gap-2">{allTags.map((t) => <Chip key={t.id} active={c.tags.includes(t.id)} onClick={() => toggleTag(t.id)}>{t.label}</Chip>)}</div>
        {monster && (() => { const base = monsterTags(monster); const addTags = c.tags.filter((t) => !base.includes(t)); const removeTags = base.filter((t) => !c.tags.includes(t)); const changed = addTags.length + removeTags.length > 0; return (
          <Button size="sm" className="mt-2" disabled={!changed} onClick={() => { setMonsterOverlay(monster.id, { addTags, removeTags }); showToast(`Remembered for every ${monster.name}`); }}>Remember these tags for all {monster.name}s</Button>
        ); })()}
      </Field>
      <div className="mb-3 flex flex-wrap gap-2">
        <Chip tone="red" active={c.dead} onClick={() => update({ dead: !c.dead })}>💀 Dead</Chip>
        <Chip tone="amber" active={c.revealed} onClick={() => update({ revealed: !c.revealed })}>📖 Lore revealed</Chip>
      </div>
      {monster && (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm">
          <div className="font-semibold">{monster.name}{monster.cr !== undefined ? ` · CR ${monster.cr}` : ''}</div>
          {monster.senses && <div className="text-zinc-400">{monster.senses}</div>}
          {c.revealed ? (
            <div className="mt-2 space-y-2">{monster.lore?.summary && <p>{monster.lore.summary}</p>}{monster.lore?.sections.map((s) => <div key={s.title}><div className="font-semibold text-amber-300">{s.title}</div><p className="whitespace-pre-wrap text-zinc-300">{s.body}</p></div>)}</div>
          ) : <div className="mt-2 text-zinc-500">Lore hidden. Use Monster Knowledge (Knowledge check 16+) or mark revealed.</div>}
        </div>
      )}
      <Field label="Notes"><textarea className={inputCls} value={c.notes ?? ''} onChange={(e) => update({ notes: e.target.value })} /></Field>
      <Button variant="danger" onClick={() => { if (confirm(`Remove ${c.name} from the battle?`)) { setBattle({ ...battle, combatants: battle.combatants.filter((x) => x.id !== id) }); setTarget(undefined); onClose(); } }}>Remove from battle</Button>
    </Sheet>
  );
}
