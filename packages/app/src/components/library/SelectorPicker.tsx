import { activationsOf, SLOTS } from '@hl/engine';
import { useStore } from '../../store/store';
import { inputCls } from '../ui';

/**
 * Selector catalog: domain → field → key. Each leaf says what kind of value it reads so the condition form can
 * offer the right operator/value input. Keys come from the library (tags, skills, abilities, classes, items).
 */
export type ValueKind = 'boolean' | 'number' | 'ordinal-size' | 'ordinal-hurt' | 'string' | 'list';
type KeySource = 'tags' | 'conditionTags' | 'skills' | 'abilities' | 'classes' | 'items' | 'slots' | 'itemCategories' | 'params' | 'vars' | 'stats' | 'free' | 'abilityTags' | 'itemTags';
export type FieldDef = { id: string; label: string; kind: ValueKind; key?: KeySource; suffix?: string[]; suffixLabels?: string[] };
export type DomainDef = { id: string; label: string; fields: FieldDef[] };

const STATS = ['attack', 'damage', 'ac', 'ac.touch', 'ac.flatFooted', 'save.fort', 'save.ref', 'save.will', 'init', 'speed', 'hp.max', 'critRange', 'critMult', 'ability.str', 'ability.dex', 'ability.con', 'ability.int', 'ability.wis', 'ability.cha', 'dr', 'sr', 'casterLevel', 'spellDC'];

export const DOMAINS: DomainDef[] = [
  { id: 'target', label: 'Target', fields: [
    { id: 'tag', label: 'has tag', kind: 'boolean', key: 'tags' },
    { id: 'condition', label: 'has condition', kind: 'boolean', key: 'conditionTags' },
    { id: 'type', label: 'creature type', kind: 'string', key: 'tags' },
    { id: 'tags', label: 'tags (any of)', kind: 'list' },
    { id: 'size', label: 'size', kind: 'ordinal-size' },
    { id: 'hurt', label: 'hurt level', kind: 'ordinal-hurt' },
    { id: 'distance', label: 'distance (ft)', kind: 'number' },
    { id: 'exists', label: 'a target is selected', kind: 'boolean' },
    { id: 'revealed', label: 'lore revealed', kind: 'boolean' },
  ] },
  { id: 'self', label: 'Me', fields: [
    { id: 'stat', label: 'stat', kind: 'number', key: 'stats' },
    { id: 'skill', label: 'skill', kind: 'number', key: 'skills', suffix: ['ranks', 'total', 'classSkill'], suffixLabels: ['ranks', 'total bonus', 'is class skill'] },
    { id: 'class', label: 'class level', kind: 'number', key: 'classes', suffix: ['level'] },
    { id: 'level', label: 'character level', kind: 'number' },
    { id: 'tag', label: 'I have condition', kind: 'boolean', key: 'conditionTags' },
    { id: 'ability', label: 'ability', kind: 'number', key: 'abilities', suffix: ['active', 'enabled', 'usesLeft', 'used'], suffixLabels: ['is active', 'is enabled', 'uses left', 'uses spent'] },
    { id: 'equipped.item', label: 'item equipped', kind: 'boolean', key: 'items' },
    { id: 'equipped.slot', label: 'items in slot (count)', kind: 'number', key: 'slots' },
    { id: 'equipped.category', label: 'equipped category (count)', kind: 'number', key: 'itemCategories' },
    { id: 'equipped.count.tag', label: 'equipped items with tag (count)', kind: 'number', key: 'itemTags' },
    { id: 'hp.current', label: 'current HP', kind: 'number' },
    { id: 'var', label: 'variable', kind: 'number', key: 'vars' },
  ] },
  { id: 'attack', label: 'This attack', fields: [
    { id: 'kind', label: 'kind (ranged/melee)', kind: 'string' },
    { id: 'weapon.tag', label: 'weapon has tag', kind: 'boolean', key: 'itemTags' },
    { id: 'weapon.category', label: 'weapon category', kind: 'string', key: 'itemCategories' },
    { id: 'weapon.id', label: 'weapon is', kind: 'string' },
    { id: 'index', label: 'attack number', kind: 'number' },
    { id: 'isFirstThisRound', label: 'first attack this round', kind: 'boolean' },
    { id: 'mode', label: 'attack mode', kind: 'string' },
    { id: 'exists', label: 'evaluating an attack', kind: 'boolean' },
  ] },
  { id: 'battle', label: 'Battle', fields: [
    { id: 'toggle', label: 'manual switch', kind: 'boolean', key: 'free' },
    { id: 'prompt', label: 'check entered', kind: 'number', key: 'free' },
    { id: 'round', label: 'round', kind: 'number' },
    { id: 'tag', label: 'environment tag', kind: 'boolean', key: 'tags' },
  ] },
  { id: 'flag', label: 'Flag', fields: [{ id: '', label: 'flag', kind: 'boolean', key: 'free' }] },
];

export function parseSelector(sel: string): { domain: DomainDef; field: FieldDef; key: string; suffix: string } | undefined {
  const p = sel.split('.');
  const domain = DOMAINS.find((d) => d.id === p[0]);
  if (!domain) return undefined;
  const rest = p.slice(1).join('.');
  const fields = [...domain.fields].sort((a, b) => b.id.length - a.id.length);
  const field = fields.find((f) => f.id === '' || rest === f.id || rest.startsWith(f.id + '.'));
  if (!field) return undefined;
  let tail = field.id === '' ? rest : rest.slice(field.id.length).replace(/^\./, '');
  let suffix = '';
  if (field.suffix) { const parts = tail.split('.'); if (parts.length > 1 && field.suffix.includes(parts[parts.length - 1]!)) { suffix = parts.pop()!; tail = parts.join('.'); } else if (parts.length === 1 && field.suffix.includes(parts[0]!) && !field.key) { suffix = parts[0]!; tail = ''; } }
  return { domain, field, key: tail, suffix };
}

export function buildSelector(domain: string, field: string, key: string, suffix: string): string {
  return [domain, field, key, suffix].filter((x) => x !== '').join('.');
}

export function valueKindOf(sel: string): ValueKind {
  const p = parseSelector(sel);
  if (!p) return 'number';
  if (p.field.id === 'skill' && p.suffix === 'classSkill') return 'boolean';
  if (p.field.id === 'ability' && (p.suffix === 'active' || p.suffix === 'enabled')) return 'boolean';
  return p.field.kind;
}

export function SelectorPicker({ value, onChange }: { value: string; onChange: (sel: string) => void }) {
  const lib = useStore((s) => s.library);
  const character = useStore((s) => s.character);
  const parsed = parseSelector(value) ?? { domain: DOMAINS[0]!, field: DOMAINS[0]!.fields[0]!, key: '', suffix: '' };
  const { domain, field } = parsed;
  const keys = (src: KeySource | undefined): { id: string; label: string; group?: string }[] => {
    switch (src) {
      case 'tags': return Object.values(lib.tags).map((t) => ({ id: t.id, label: t.label, group: t.category }));
      case 'conditionTags': return Object.values(lib.tags).filter((t) => t.category === 'condition' || t.category === 'custom').map((t) => ({ id: t.id, label: t.label, group: t.category }));
      case 'skills': return Object.values(lib.skills).map((s) => ({ id: s.id, label: s.name }));
      case 'abilities': return Object.values(lib.abilities).flatMap((a) => [
        { id: a.id, label: a.name, group: a.kind as string },
        ...activationsOf(a).map((act) => ({ id: act.id, label: `${a.name} › ${act.name ?? a.name}`, group: 'activation' })),
      ]);
      case 'items': return Object.values(lib.abilities).flatMap((a) => (a.kind === 'item' ? [{ id: a.id, label: a.name, group: a.item.category }] : []));
      case 'classes': return Object.values(lib.classTables).map((c) => ({ id: c.id, label: c.name }));
      case 'slots': return SLOTS.map((s) => ({ id: s.id, label: s.label }));
      case 'itemCategories': return ['weapon', 'armor', 'shield', 'ammunition', 'wondrous', 'potion', 'scroll', 'wand', 'tool', 'trophy', 'material', 'gear'].map((c) => ({ id: c, label: c }));
      case 'itemTags': return [...new Set(Object.values(lib.abilities).flatMap((a) => (a.kind === 'item' ? a.item.tags : [])))].map((t) => ({ id: t, label: t }));
      case 'params': return [...new Set(Object.values(lib.abilities).flatMap((a) => (a.kind === 'feature' ? Object.keys(a.params ?? {}) : [])))].map((p) => ({ id: p, label: p }));
      case 'vars': return Object.keys(character?.vars ?? {}).map((v) => ({ id: v, label: v }));
      case 'stats': return STATS.map((s) => ({ id: s, label: s }));
      default: return [];
    }
  };
  const list = keys(field.key);
  const groups = [...new Set(list.map((k) => k.group ?? ''))];
  const setField = (fid: string) => { const f = domain.fields.find((x) => x.id === fid)!; onChange(buildSelector(domain.id, f.id, '', f.suffix ? f.suffix[0]! : '')); };
  return (
    <div className="flex flex-wrap gap-1">
      <select data-role="sel-domain" className={inputCls + ' w-auto py-1.5 text-sm'} value={domain.id} onChange={(e) => { const d = DOMAINS.find((x) => x.id === e.target.value)!; const f = d.fields[0]!; onChange(buildSelector(d.id, f.id, '', f.suffix ? f.suffix[0]! : '')); }}>
        {DOMAINS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <select data-role="sel-field" className={inputCls + ' w-auto py-1.5 text-sm'} value={field.id} onChange={(e) => setField(e.target.value)}>
        {domain.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      {field.key && field.key !== 'free' && (
        <select data-role="sel-key" className={inputCls + ' min-w-32 flex-1 py-1.5 text-sm'} value={parsed.key} onChange={(e) => onChange(buildSelector(domain.id, field.id, e.target.value, parsed.suffix))}>
          <option value="">— pick —</option>
          {groups.map((g) => g ? <optgroup key={g} label={g}>{list.filter((k) => k.group === g).sort((a, b) => a.label.localeCompare(b.label)).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</optgroup> : list.filter((k) => !k.group).sort((a, b) => a.label.localeCompare(b.label)).map((k) => <option key={k.id} value={k.id}>{k.label}</option>))}
        </select>
      )}
      {field.key === 'free' && <input className={inputCls + ' min-w-32 flex-1 py-1.5 text-sm'} placeholder="id" value={parsed.key} onChange={(e) => onChange(buildSelector(domain.id, field.id, e.target.value.trim(), parsed.suffix))} />}
      {field.suffix && (
        <select className={inputCls + ' w-auto py-1.5 text-sm'} value={parsed.suffix || field.suffix[0]} onChange={(e) => onChange(buildSelector(domain.id, field.id, parsed.key, e.target.value))}>
          {field.suffix.map((s, i) => <option key={s} value={s}>{field.suffixLabels?.[i] ?? s}</option>)}
        </select>
      )}
    </div>
  );
}
