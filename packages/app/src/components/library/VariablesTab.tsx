import { useEffect, useRef, useState } from 'react';
import type { VarValue } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, inputCls } from '../ui';

type Kind = 'number' | 'text' | 'yes/no';
const kindOf = (v: VarValue): Kind => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'yes/no' : 'text');
const coerce = (raw: string, kind: Kind): VarValue => (kind === 'number' ? Number(raw) || 0 : kind === 'yes/no' ? raw === 'true' : raw);

/** A number var's text field, edited freely (so `1.5` → typing `2.75`, or a leading `-`, isn't coerced
 * away mid-keystroke); committed with `Number(text)` only on blur/Enter, and only when it parses. Syncs
 * from an external value change (a script writing this variable elsewhere) while the field isn't focused. */
function NumberVarInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && !Number.isNaN(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      className={inputCls + ' w-28 py-1'}
      inputMode="decimal"
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/** One variable's row: value control by kind, a kind label, an optional note (e.g. "shadowed by …"), and delete. */
function VarRow({ attr, name, value, onSet, onDelete, note }: { attr: 'data-global' | 'data-var'; name: string; value: VarValue; onSet: (v: VarValue) => void; onDelete: () => void; note?: React.ReactNode }) {
  return (
    <div {...{ [attr]: name }} className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2">
      <span className="w-40 shrink-0 truncate font-mono text-sm">{name}</span>
      {typeof value === 'boolean'
        ? <Chip tone="green" active={value} onClick={() => onSet(!value)}>{value ? 'true' : 'false'}</Chip>
        : typeof value === 'number'
        ? <NumberVarInput value={value} onCommit={onSet} />
        : <input className={inputCls + ' w-28 py-1'} value={String(value)} onChange={(e) => onSet(coerce(e.target.value, kindOf(value)))} />}
      <span className="text-xs text-zinc-500">{kindOf(value)}</span>
      {note}
      <button type="button" className="ml-auto px-2 text-zinc-500" onClick={onDelete}>✕</button>
    </div>
  );
}

/** The "name / value / kind chips / Add" row shared by both sections. */
function AddVarRow({ onAdd }: { onAdd: (name: string, value: VarValue) => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<Kind>('number');
  const add = () => {
    const k = name.trim();
    if (!k) return;
    onAdd(k, coerce(value, kind));
    setName(''); setValue('');
  };
  return (
    <div className="mb-3">
      <div className="mb-2 flex flex-wrap gap-2">
        <input className={inputCls + ' w-40'} placeholder="name" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
        <input className={inputCls + ' w-32'} placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-1">{(['number', 'text', 'yes/no'] as Kind[]).map((k) => <Chip key={k} tone="blue" active={kind === k} onClick={() => setKind(k)}>{k}</Chip>)}</div>
    </div>
  );
}

/** Character vars, then globals. `vars.<name>` reads the character's var first, then a shared one. */
export function VariablesTab() {
  const globals = useStore((s) => s.globals);
  const setGlobals = useStore((s) => s.setGlobals);
  const character = useStore((s) => s.character);
  const setCharacter = useStore((s) => s.setCharacter);

  const putGlobal = (k: string, v: VarValue) => setGlobals({ ...globals, [k]: v });
  const dropGlobal = (k: string) => { const rest = { ...globals }; delete rest[k]; setGlobals(rest); };
  const putVar = (k: string, v: VarValue) => { if (character) setCharacter({ ...character, vars: { ...character.vars, [k]: v } }); };
  const dropVar = (k: string) => { if (!character) return; const rest = { ...character.vars }; delete rest[k]; setCharacter({ ...character, vars: rest }); };

  const globalRows = Object.entries(globals).sort(([a], [b]) => a.localeCompare(b));
  const varRows = character ? Object.entries(character.vars).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-400">A script reads <code>vars.name</code>: the character's own variable first, then a shared one.</p>

      {character && (
        <section data-section="character" className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">{character.name}&rsquo;s variables</h2>
          <AddVarRow onAdd={putVar} />
          <div className="space-y-1">
            {varRows.map(([k, v]) => (
              <VarRow key={k} attr="data-var" name={k} value={v} onSet={(nv) => putVar(k, nv)} onDelete={() => { if (confirm(`Delete "${k}"?`)) dropVar(k); }} />
            ))}
            {varRows.length === 0 && <p className="text-sm text-zinc-500">No variables yet.</p>}
          </div>
        </section>
      )}

      <section data-section="shared">
        <h2 className="mb-2 text-lg font-semibold">Shared by every character</h2>
        <AddVarRow onAdd={putGlobal} />
        <div className="space-y-1">
          {globalRows.map(([k, v]) => {
            const shadowed = character !== undefined && Object.hasOwn(character.vars, k);
            return (
              <VarRow
                key={k} attr="data-global" name={k} value={v} onSet={(nv) => putGlobal(k, nv)}
                onDelete={() => { if (confirm(`Delete global "${k}"?`)) dropGlobal(k); }}
                note={shadowed ? <span className="text-xs text-amber-300">⚠ shadowed by {character!.name}&rsquo;s own var ({String(character!.vars[k])})</span> : undefined}
              />
            );
          })}
          {globalRows.length === 0 && <p className="text-sm text-zinc-500">No shared variables yet.</p>}
        </div>
      </section>
    </div>
  );
}
