import { SLOTS, type Ability, type BonusType, type Duration, type Effect } from '@hl/engine';
import { useStore } from '../../store/store';
import { Chip, inputCls } from '../ui';
import { StatSelect } from './StatSelect';

type Verb = Effect['verb'];
/** Which family of effects a block can hold: `while` blocks contribute as long as they hold, `when` blocks happen once. */
export type EffectFamily = 'while' | 'when';
/** Menu entry id: the verb, plus a target variant for `tag` (target vs me). */
type MenuId = Verb | 'tag:target' | 'tag:self';
type MenuEntry = { id: MenuId; label: string; group: string };
const MENUS: Record<EffectFamily, MenuEntry[]> = {
  while: [
    { id: 'modify', label: 'Bonus or penalty to a stat (or set / multiply)', group: 'My numbers' },
    { id: 'dice', label: 'Extra damage dice', group: 'My numbers' },
    { id: 'attack', label: 'Extra attack / attack mode / natural attack', group: 'My attacks' },
    { id: 'flag', label: 'Ignore concealment, never flat-footed, immunity, sense…', group: 'My attacks' },
    { id: 'slot', label: 'Extra equipment slot', group: 'Gear' },
    { id: 'note', label: 'Reminder note (with DC formula)', group: 'Screen' },
  ],
  when: [
    { id: 'tag:target', label: 'Target gains a condition', group: 'Target' },
    { id: 'reveal', label: 'Reveal target lore', group: 'Target' },
    { id: 'tag:self', label: 'I gain a condition', group: 'Me' },
    { id: 'hp', label: 'Heal / damage / temp HP', group: 'Me' },
    { id: 'grant', label: 'Activate a status or feature on me', group: 'Me' },
    { id: 'suppress', label: 'Suppress one of my abilities', group: 'Me' },
    { id: 'resource', label: 'Spend / restore charges', group: 'Charges' },
    { id: 'prompt', label: 'Ask for a check result', group: 'Screen' },
  ],
};
const ALL_ENTRIES: MenuEntry[] = [...MENUS.while, ...MENUS.when];
function menuIdOf(e: Effect): MenuId {
  return e.verb === 'tag' ? (e.to === 'self' ? 'tag:self' : 'tag:target') : e.verb;
}

const TYPES: BonusType[] = ['untyped', 'enhancement', 'insight', 'morale', 'competence', 'circumstance', 'dodge', 'luck', 'sacred', 'profane', 'racial', 'size', 'deflection', 'natural', 'armor', 'shield', 'resistance', 'alchemical', 'inherent'];

function defaultFor(id: MenuId): Effect {
  const verb = (id === 'tag:target' || id === 'tag:self' ? 'tag' : id) as Verb;
  switch (verb) {
    case 'modify': return { verb, to: 'attack', value: 1, type: 'untyped', mode: 'add' };
    case 'dice': return { verb, dice: '1d6' };
    case 'attack': return { verb, extraAttacks: 1, penaltyAll: 0, appliesToBase: 'full' };
    case 'flag': return { verb, flag: 'ignoreConcealment', value: true };
    case 'tag': return { verb, to: id === 'tag:self' ? 'self' : 'target', tag: 'flanked', duration: 'untilMyNextTurn' };
    case 'grant': return { verb, ability: '' };
    case 'suppress': return { verb, ability: '' };
    case 'slot': return { verb, slot: 'ring', count: 1 };
    case 'resource': return { verb, id: '', op: 'consume', amount: 1 };
    case 'hp': return { verb, op: 'heal', amount: 1 };
    case 'prompt': return { verb, id: 'knowledge', per: 'creatureType', remember: 'encounter' };
    case 'note': return { verb, text: '' };
    case 'reveal': return { verb };
  }
}

export function DurationPicker({ value, onChange }: { value: Duration; onChange: (d: Duration) => void }) {
  const kind = typeof value === 'object' ? ('rounds' in value ? 'rounds' : 'minutes') : value;
  const opts: [string, string][] = [['thisAttack', 'this attack'], ['thisTurn', 'this turn'], ['untilMyNextTurn', 'until my next turn'], ['rounds', 'N rounds'], ['minutes', 'N minutes'], ['encounter', 'whole battle'], ['untilRemoved', 'until removed']];
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <select className={inputCls + ' w-auto py-1.5'} value={kind} onChange={(e) => { const k = e.target.value; onChange(k === 'rounds' ? { rounds: 3 } : k === 'minutes' ? { minutes: 1 } : (k as Duration)); }}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {typeof value === 'object' && 'rounds' in value && <input className={inputCls + ' w-24'} value={String(value.rounds)} onChange={(e) => onChange({ rounds: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} />}
      {typeof value === 'object' && 'minutes' in value && <input className={inputCls + ' w-16'} inputMode="numeric" value={value.minutes} onChange={(e) => onChange({ minutes: Number(e.target.value) || 1 })} />}
    </div>
  );
}

export function EffectEditor({ value, onChange, onRemove, family = 'while' }: { value: Effect; onChange: (e: Effect) => void; onRemove: () => void; family?: EffectFamily }) {
  const tags = useStore((s) => s.library.tags);
  const abilities = useStore((s) => s.library.abilities);
  const set = (patch: Record<string, unknown>) => onChange({ ...value, ...patch } as Effect);
  const kindChips = (current: 'ranged' | 'melee' | undefined) => (
    <div className="flex gap-1 text-xs"><span className="self-center text-zinc-500">only for</span>{(['any', 'ranged', 'melee'] as const).map((k) => <Chip key={k} active={(current ?? 'any') === k} onClick={() => set({ attackKind: k === 'any' ? undefined : k })}>{k}</Chip>)}</div>
  );
  const abilitySelect = (cur: string, onSel: (v: string) => void, only?: (a: Ability) => boolean) => (
    <select className={inputCls} value={cur} onChange={(e) => onSel(e.target.value)}><option value="">— pick ability —</option>{Object.values(abilities).filter((a) => !only || only(a)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}</select>
  );

  let body: React.ReactNode = null;
  switch (value.verb) {
    case 'modify': {
      const isTable = typeof value.value === 'object';
      body = (
        <div className="space-y-1">
          <div className="flex gap-1"><StatSelect value={value.to} onChange={(v) => set({ to: v })} /><select className={inputCls + ' w-auto'} value={value.mode} onChange={(e) => set({ mode: e.target.value })}><option value="add">add</option><option value="set">set to</option><option value="multiply">multiply by</option></select></div>
          <div className="flex gap-1">
            <Chip active={!isTable} onClick={() => isTable && set({ value: 1 })}>number / expression</Chip>
            <Chip active={isTable} onClick={() => !isTable && set({ value: { prompt: 'knowledge', per: 'creatureType', table: [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { value: 3 }] } })}>from a check result</Chip>
          </div>
          {!isTable ? (
            <input className={inputCls} placeholder="e.g. 2, wisMod, 2 * trophyMultiplier" value={String(value.value)} onChange={(e) => set({ value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} />
          ) : (() => { const t = value.value as { prompt: string; per?: string; table: { upTo?: number; value: number }[] }; return (
            <div className="space-y-1">
              <div className="flex gap-1"><input className={inputCls} placeholder="check id (knowledge)" value={t.prompt} onChange={(e) => set({ value: { ...t, prompt: e.target.value } })} /><input className={inputCls} placeholder="once per tag category (creatureType)" value={t.per ?? ''} onChange={(e) => set({ value: { ...t, per: e.target.value || undefined } })} /></div>
              {t.table.map((row, i) => <div key={i} className="flex items-center gap-2 text-sm"><span className="text-zinc-500">up to</span><input className={inputCls + ' w-20'} inputMode="numeric" placeholder="∞" value={row.upTo ?? ''} onChange={(e) => set({ value: { ...t, table: t.table.map((r, j) => (j === i ? { ...r, upTo: e.target.value === '' ? undefined : Number(e.target.value) } : r)) } })} /><span>→</span><input className={inputCls + ' w-20'} inputMode="numeric" value={row.value} onChange={(e) => set({ value: { ...t, table: t.table.map((r, j) => (j === i ? { ...r, value: Number(e.target.value) } : r)) } })} /><button type="button" className="text-zinc-500" onClick={() => set({ value: { ...t, table: t.table.filter((_, j) => j !== i) } })}>✕</button></div>)}
              <button type="button" className="text-sm text-amber-300" onClick={() => set({ value: { ...t, table: [...t.table, { value: 0 }] } })}>+ row</button>
            </div>
          ); })()}
          <div className="flex flex-wrap gap-1">{TYPES.map((t) => <Chip key={t} active={value.type === t} onClick={() => set({ type: t })}>{t}</Chip>)}</div>
          {kindChips(value.attackKind)}
        </div>
      );
      break;
    }
    case 'dice': body = <div className="space-y-1"><div className="flex gap-2"><input className={inputCls + ' w-24'} value={value.dice} onChange={(e) => set({ dice: e.target.value })} /><input className={inputCls} placeholder="label" value={value.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} /><input className={inputCls + ' w-28'} placeholder="type (fire…)" value={value.damageType ?? ''} onChange={(e) => set({ damageType: e.target.value || undefined })} /></div>{kindChips(value.attackKind)}</div>; break;
    case 'attack': {
      const kind = value.mode ? 'mode' : value.naturalAttack ? 'natural' : 'extra';
      body = (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            <Chip active={kind === 'extra'} onClick={() => onChange({ verb: 'attack', extraAttacks: 1, penaltyAll: 0, appliesToBase: 'full' })}>extra attack(s) in existing modes</Chip>
            <Chip active={kind === 'mode'} onClick={() => onChange({ verb: 'attack', mode: { id: 'new-mode', label: 'New mode', base: 'full' }, extraAttacks: 1, penaltyAll: -2 })}>a new attack mode</Chip>
            <Chip active={kind === 'natural'} onClick={() => onChange({ verb: 'attack', extraAttacks: 0, penaltyAll: 0, naturalAttack: { name: 'Bite', dice: '1d6', count: 1, attackBonus: 0 } })}>a natural attack</Chip>
          </div>
          {kind === 'mode' && value.mode && <div className="flex gap-1"><input className={inputCls} placeholder="mode id" value={value.mode.id} onChange={(e) => set({ mode: { ...value.mode, id: e.target.value } })} /><input className={inputCls} placeholder="label" value={value.mode.label} onChange={(e) => set({ mode: { ...value.mode, label: e.target.value } })} /><select className={inputCls + ' w-auto'} value={value.mode.base} onChange={(e) => set({ mode: { ...value.mode, base: e.target.value } })}><option value="full">based on full attack</option><option value="single">based on single attack</option></select></div>}
          {kind === 'mode' && value.mode && <input className={inputCls} placeholder="note shown when using this mode" value={value.mode.note ?? ''} onChange={(e) => set({ mode: { ...value.mode, note: e.target.value || undefined } })} />}
          {kind !== 'natural' && <div className="flex items-center gap-2 text-xs text-zinc-400">extra attacks at top <input className={inputCls + ' w-16'} inputMode="numeric" value={value.extraAttacks} onChange={(e) => set({ extraAttacks: Number(e.target.value) || 0 })} /> penalty on all <input className={inputCls + ' w-16'} inputMode="numeric" value={value.penaltyAll} onChange={(e) => set({ penaltyAll: Number(e.target.value) || 0 })} />{kind === 'extra' && <select className={inputCls + ' w-auto py-1'} value={value.appliesToBase ?? 'full'} onChange={(e) => set({ appliesToBase: e.target.value })}><option value="full">in full-attack modes</option><option value="single">in single-attack modes</option><option value="any">in any mode</option></select>}</div>}
          {kind === 'natural' && value.naturalAttack && <div className="flex gap-1"><input className={inputCls} placeholder="name" value={value.naturalAttack.name} onChange={(e) => set({ naturalAttack: { ...value.naturalAttack, name: e.target.value } })} /><input className={inputCls + ' w-20'} value={value.naturalAttack.dice} onChange={(e) => set({ naturalAttack: { ...value.naturalAttack, dice: e.target.value } })} /><input className={inputCls + ' w-16'} inputMode="numeric" title="count" value={value.naturalAttack.count} onChange={(e) => set({ naturalAttack: { ...value.naturalAttack, count: Number(e.target.value) || 1 } })} /><input className={inputCls + ' w-16'} inputMode="numeric" title="attack bonus" value={value.naturalAttack.attackBonus} onChange={(e) => set({ naturalAttack: { ...value.naturalAttack, attackBonus: Number(e.target.value) || 0 } })} /></div>}
          {kindChips(value.attackKind)}
        </div>
      );
      break;
    }
    case 'flag': body = <div className="flex gap-1"><input className={inputCls} list="flag-names" placeholder="ignoreConcealment, neverFlatFooted, immune.fear, sense.darkvision…" value={value.flag} onChange={(e) => set({ flag: e.target.value })} /><datalist id="flag-names"><option value="ignoreConcealment" /><option value="neverFlatFooted" /><option value="immune.fear" /><option value="immune.paralysis" /><option value="sense.darkvision" /><option value="sense.scent" /><option value="canFly" /></datalist><select className={inputCls + ' w-auto'} value={String(value.value)} onChange={(e) => set({ value: e.target.value === 'true' })}><option value="true">on</option><option value="false">off</option></select></div>; break;
    case 'tag': body = <div className="space-y-1">{value.to !== 'self' && <div className="flex gap-1">{(['target', 'allEnemies'] as const).map((t) => <Chip key={t} active={value.to === t} onClick={() => set({ to: t })}>{{ target: 'the target', allEnemies: 'all enemies' }[t]}</Chip>)}</div>}<select className={inputCls} value={value.tag} onChange={(e) => set({ tag: e.target.value })}>{Object.values(tags).filter((t) => t.category === 'condition' || t.category === 'custom').sort((a, b) => a.label.localeCompare(b.label)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select><DurationPicker value={value.duration} onChange={(d) => set({ duration: d })} /></div>; break;
    case 'grant': body = <div className="space-y-1">{abilitySelect(value.ability, (v) => set({ ability: v }), (x) => x.kind === 'status' || x.kind === 'feature')}<div className="text-xs text-zinc-500">Duration: {value.duration ? '' : "the granted ability's own"}</div>{value.duration && <DurationPicker value={value.duration} onChange={(d) => set({ duration: d })} />}{!value.duration && <button type="button" className="text-sm text-amber-300" onClick={() => set({ duration: { rounds: 5 } })}>+ override duration</button>}</div>; break;
    case 'suppress': body = abilitySelect(value.ability, (v) => set({ ability: v })); break;
    case 'slot': body = <div className="flex items-center gap-2 text-xs text-zinc-400"><select className={inputCls} value={value.slot} onChange={(e) => set({ slot: e.target.value })}>{SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select> +<input className={inputCls + ' w-16'} inputMode="numeric" value={value.count} onChange={(e) => set({ count: Number(e.target.value) || 1 })} /></div>; break;
    case 'resource': body = <div className="flex gap-1"><select className={inputCls + ' w-auto'} value={value.op} onChange={(e) => set({ op: e.target.value })}><option value="consume">spend</option><option value="restore">restore</option><option value="set">set used to</option></select><input className={inputCls + ' w-20'} placeholder="amount" value={String(value.amount)} onChange={(e) => set({ amount: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} /><input className={inputCls} placeholder="resource id" value={value.id} onChange={(e) => set({ id: e.target.value })} /></div>; break;
    case 'hp': body = <div className="flex gap-1"><select className={inputCls + ' w-auto'} value={value.op} onChange={(e) => set({ op: e.target.value })}><option value="heal">heal</option><option value="damage">damage</option><option value="temp">temp HP</option></select><input className={inputCls} placeholder="amount or expression" value={String(value.amount)} onChange={(e) => set({ amount: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} /></div>; break;
    case 'prompt': body = <div className="flex gap-1"><input className={inputCls} placeholder="prompt id" value={value.id} onChange={(e) => set({ id: e.target.value })} /><input className={inputCls} placeholder="label" value={value.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} /><input className={inputCls} placeholder="per tag category" value={value.per ?? ''} onChange={(e) => set({ per: e.target.value || undefined })} /></div>; break;
    case 'note': body = <div className="space-y-1"><textarea className={inputCls} placeholder="Text; {expressions} are filled in, e.g. Fort DC {damage + wisMod}" value={value.text} onChange={(e) => set({ text: e.target.value })} /><input className={inputCls} placeholder="DC expression (optional)" value={value.dc === undefined ? '' : String(value.dc)} onChange={(e) => set({ dc: e.target.value === '' ? undefined : /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} /></div>; break;
    default: body = null;
  }
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2">
      <div className="mb-1 flex items-center gap-2">
        {(() => {
          const cur = menuIdOf(value);
          const entries = MENUS[family].some((m) => m.id === cur) ? MENUS[family] : [...MENUS[family], { ...(ALL_ENTRIES.find((m) => m.id === cur) ?? { id: cur, label: cur }), group: 'Other (not for this timing)' }];
          const groups = [...new Set(entries.map((m) => m.group))];
          return (
            <select data-role="effect-menu" className={inputCls + ' flex-1 py-1.5 text-sm'} value={cur} onChange={(e) => onChange(defaultFor(e.target.value as MenuId))}>
              {groups.map((g) => <optgroup key={g} label={g}>{entries.filter((m) => m.group === g).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>)}
            </select>
          );
        })()}
        <button type="button" className="px-2 text-zinc-500" onClick={onRemove}>✕</button>
      </div>
      {body}
    </div>
  );
}
