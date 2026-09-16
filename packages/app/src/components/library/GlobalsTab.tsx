import { useState } from 'react';
import type { VarValue } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Chip, inputCls } from '../ui';

type Kind = 'number' | 'text' | 'yes/no';
const kindOf = (v: VarValue): Kind => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'yes/no' : 'text');
const coerce = (raw: string, kind: Kind): VarValue => (kind === 'number' ? Number(raw) || 0 : kind === 'yes/no' ? raw === 'true' : raw);

/** Values shared by every character. `vars.<name>` reads the character's var first, then here. */
export function GlobalsTab() {
  const globals = useStore((s) => s.globals);
  const setGlobals = useStore((s) => s.setGlobals);
  const character = useStore((s) => s.character);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<Kind>('number');
  const rows = Object.entries(globals).sort(([a], [b]) => a.localeCompare(b));
  const put = (k: string, v: VarValue) => setGlobals({ ...globals, [k]: v });
  const drop = (k: string) => { const rest = { ...globals }; delete rest[k]; setGlobals(rest); };
  const add = () => {
    const k = name.trim();
    if (!k) return;
    put(k, coerce(value, kind));
    setName(''); setValue('');
  };
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-400">Globals are shared by every character. A script reads <code>vars.name</code>: the character's own var first, then the global. <code>setVar</code> writes the character's var when it has one, otherwise here.</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className={inputCls + ' w-40'} placeholder="name" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
        <input className={inputCls + ' w-32'} placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">{(['number', 'text', 'yes/no'] as Kind[]).map((k) => <Chip key={k} tone="blue" active={kind === k} onClick={() => setKind(k)}>{k}</Chip>)}</div>
      <div className="space-y-1">
        {rows.map(([k, v]) => {
          const shadowed = character !== undefined && Object.hasOwn(character.vars, k);
          return (
            <div key={k} data-global={k} className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2">
              <span className="w-40 shrink-0 truncate font-mono text-sm">{k}</span>
              {typeof v === 'boolean'
                ? <Chip tone="green" active={v} onClick={() => put(k, !v)}>{v ? 'true' : 'false'}</Chip>
                : <input className={inputCls + ' w-28 py-1'} value={String(v)} onChange={(e) => put(k, coerce(e.target.value, kindOf(v)))} />}
              <span className="text-xs text-zinc-500">{kindOf(v)}</span>
              {shadowed && <span className="text-xs text-amber-300">⚠ shadowed by {character!.name}'s own var ({String(character!.vars[k])})</span>}
              <button type="button" className="ml-auto px-2 text-zinc-500" onClick={() => { if (confirm(`Delete global "${k}"?`)) drop(k); }}>✕</button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-zinc-500">No globals yet.</p>}
      </div>
    </div>
  );
}
