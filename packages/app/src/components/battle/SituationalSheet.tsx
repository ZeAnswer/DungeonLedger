import { useState } from 'react';
import { addStatus, type BonusType, type Duration, type EvalContext, type StatId } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, Field, Sheet, humanize, inputCls } from '../ui';
import { StatSelect, TagSelect } from '../library/StatSelect';

const TYPES: BonusType[] = ['untyped', 'circumstance', 'morale', 'competence', 'insight', 'luck', 'enhancement', 'dodge', 'sacred', 'profane'];

export function SituationalSheet({ ctx, open, onClose }: { ctx: EvalContext; open: boolean; onClose: () => void }) {
  const setBattle = useStore((s) => s.setBattle);
  const battle = ctx.battle!;
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState<string>('self');
  const [kind, setKind] = useState<'bonus' | 'tag' | 'suppress' | 'note'>('bonus');
  const [stat, setStat] = useState<StatId>('attack');
  const [value, setValue] = useState('-2');
  const [bonusType, setBonusType] = useState<BonusType>('untyped');
  const [tag, setTag] = useState('');
  const [suppress, setSuppress] = useState('');
  const [dur, setDur] = useState<'encounter' | 'rounds' | 'untilMyNextTurn'>('encounter');
  const [rounds, setRounds] = useState('3');
  const lib = ctx.library;
  const abilities = ctx.character.abilities.map((i) => lib.abilities[i.abilityId]).filter(Boolean);

  const save = () => {
    const duration: Duration = dur === 'rounds' ? { rounds: Math.max(1, Number(rounds) || 1) } : dur === 'untilMyNextTurn' ? 'untilMyNextTurn' : 'encounter';
    const b = addStatus(ctx, {
      label: label || (kind === 'bonus' ? `${value} ${stat}` : kind === 'tag' ? humanize(tag) : kind === 'suppress' ? `Suppress ${suppress}` : 'Note'),
      target,
      duration,
      ...(kind === 'bonus' ? { to: stat, value: Number(value) || 0, bonusType } : {}),
      ...(kind === 'tag' ? { tag } : {}),
      ...(kind === 'suppress' ? { suppressAbilityId: suppress } : {}),
      ...(kind === 'note' ? { note: label } : {}),
    });
    setBattle(b);
    onClose();
    setLabel('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Situational modifier" tall>
      <Field label="Label (what the DM said)"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Darkness, bard aura, cursed ground…" /></Field>
      <Field label="Applies to">
        <div className="flex flex-wrap gap-2">
          <Chip active={target === 'self'} onClick={() => setTarget('self')}>Me</Chip>
          <Chip active={target === 'all'} onClick={() => setTarget('all')}>All enemies</Chip>
          {battle.combatants.map((c) => <Chip key={c.id} active={target === c.id} onClick={() => setTarget(c.id)}>{c.name}</Chip>)}
        </div>
      </Field>
      <Field label="What">
        <div className="flex flex-wrap gap-2">
          {target === 'self' && <Chip active={kind === 'bonus'} onClick={() => setKind('bonus')}>Bonus / penalty</Chip>}
          <Chip active={kind === 'tag'} onClick={() => setKind('tag')}>Condition / tag</Chip>
          {target === 'self' && <Chip active={kind === 'suppress'} onClick={() => setKind('suppress')}>Suppress an ability</Chip>}
          {target === 'self' && <Chip active={kind === 'note'} onClick={() => setKind('note')}>Reminder note</Chip>}
        </div>
      </Field>
      {kind === 'bonus' && target === 'self' && (
        <>
          <Field label="Stat"><StatSelect value={stat} onChange={(v) => setStat(v as StatId)} /></Field>
          <Field label="Value"><input className={inputCls + ' text-2xl'} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Bonus type"><div className="flex flex-wrap gap-2">{TYPES.map((t) => <Chip key={t} active={bonusType === t} onClick={() => setBonusType(t)}>{t}</Chip>)}</div></Field>
        </>
      )}
      {kind === 'tag' && <Field label="Condition / tag"><TagSelect value={tag} onChange={setTag} /><input className={inputCls + ' mt-2'} placeholder="…or type a new tag id (e.g. red)" value={tag} onChange={(e) => setTag(e.target.value)} /></Field>}
      {kind === 'suppress' && <Field label="Ability"><div className="flex flex-wrap gap-2">{abilities.map((a) => <Chip key={a!.id} tone="red" active={suppress === a!.id} onClick={() => setSuppress(a!.id)}>{a!.name}</Chip>)}</div></Field>}
      <Field label="Duration">
        <div className="flex flex-wrap gap-2">
          <Chip active={dur === 'encounter'} onClick={() => setDur('encounter')}>Whole battle</Chip>
          <Chip active={dur === 'rounds'} onClick={() => setDur('rounds')}>N rounds</Chip>
          <Chip active={dur === 'untilMyNextTurn'} onClick={() => setDur('untilMyNextTurn')}>This round</Chip>
        </div>
        {dur === 'rounds' && <input className={inputCls + ' mt-2'} inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />}
      </Field>
      <Button variant="primary" size="lg" className="w-full" onClick={save} disabled={(kind === 'tag' && !tag) || (kind === 'suppress' && !suppress) || (kind === 'note' && !label)}>Apply</Button>
    </Sheet>
  );
}
