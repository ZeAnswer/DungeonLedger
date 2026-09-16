import { useStore } from '../../store/store';
import { inputCls } from '../ui';

const GROUPS: { label: string; stats: [string, string][] }[] = [
  { label: 'Attack', stats: [['attack', 'Attack roll'], ['damage', 'Damage'], ['critRange', 'Threat range (+1 = one wider)'], ['critMult', 'Crit multiplier']] },
  { label: 'Defense', stats: [['ac', 'AC'], ['ac.touch', 'Touch AC only'], ['ac.flatFooted', 'Flat-footed AC only'], ['save.fort', 'Fortitude'], ['save.ref', 'Reflex'], ['save.will', 'Will']] },
  { label: 'Ability scores', stats: [['ability.str', 'Strength'], ['ability.dex', 'Dexterity'], ['ability.con', 'Constitution'], ['ability.int', 'Intelligence'], ['ability.wis', 'Wisdom'], ['ability.cha', 'Charisma']] },
  { label: 'Other', stats: [['init', 'Initiative'], ['speed', 'Speed'], ['hp.max', 'Max HP']] },
];

export function statLabel(id: string, skills: Record<string, { name: string }>): string {
  for (const g of GROUPS) for (const [k, l] of g.stats) if (k === id) return l;
  if (id.startsWith('skill.')) return skills[id.slice(6)]?.name ?? id;
  return id;
}

/** Grouped dropdown of every stat a bonus can target, skills included. */
export function StatSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const skills = useStore((s) => s.library.skills);
  return (
    <select className={(className ?? inputCls)} value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.stats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
      <optgroup label="Skills">{Object.values(skills).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={`skill.${s.id}`}>{s.name}</option>)}</optgroup>
    </select>
  );
}

const FN_STAT_GROUPS: { label: string; stats: [string, string][] }[] = [
  { label: 'Attack & damage', stats: [['attack', 'Attack roll'], ['damage', 'Damage'], ['critRange', 'Threat range (+1 = one wider)'], ['critMult', 'Crit multiplier']] },
  { label: 'Defence', stats: [['ac', 'AC'], ['ac.touch', 'Touch AC only'], ['ac.flatFooted', 'Flat-footed AC only']] },
  { label: 'Saves', stats: [['save.fort', 'Fortitude'], ['save.ref', 'Reflex'], ['save.will', 'Will']] },
  { label: 'Ability scores', stats: [['ability.str', 'Strength'], ['ability.dex', 'Dexterity'], ['ability.con', 'Constitution'], ['ability.int', 'Intelligence'], ['ability.wis', 'Wisdom'], ['ability.cha', 'Charisma']] },
];

/** The narrower `stat`-typed function parameter's dropdown: attack/damage, defence, saves and ability scores
 * only — `skill.*` is excluded, since a skill-typed parameter has its own dropdown (`skill`, not `stat`). */
export function FunctionStatSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {FN_STAT_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.stats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
    </select>
  );
}

/** Dropdown of tags grouped by category. */
export function TagSelect({ value, onChange, categories, placeholder = '— pick tag —' }: { value: string; onChange: (v: string) => void; categories?: string[]; placeholder?: string }) {
  const tags = useStore((s) => s.library.tags);
  const cats = [...new Set(Object.values(tags).map((t) => t.category))].filter((c) => !categories || categories.includes(c));
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {cats.map((c) => <optgroup key={c} label={c}>{Object.values(tags).filter((t) => t.category === c).sort((a, b) => a.label.localeCompare(b.label)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}
    </select>
  );
}
