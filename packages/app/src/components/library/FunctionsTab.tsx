import { useState } from 'react';
import { FunctionDefSchema, ParamTypeSchema, activationsOf, compile, type Ability, type FunctionDef } from '@hl/engine';
import { useStore } from '../../store/store';
import { Button, Field, Sheet, inputCls } from '../ui';
import { ScriptEditor } from './ScriptEditor';

/** Records that call this function, whether through a stored `call` or a `fn.x(…)` / `fn["x"](…)` in a source. */
export function usedBy(abilities: Record<string, Ability>, fnId: string): string[] {
  const esc = fnId.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const re = new RegExp(`fn\\s*(?:\\.\\s*${esc}\\b|\\[\\s*['"\`]${esc}['"\`]\\s*\\])`);
  const out: string[] = [];
  for (const a of Object.values(abilities)) {
    const scripts = [...a.scripts, ...activationsOf(a).flatMap((x) => x.scripts)];
    if (scripts.some((s) => s.call?.fn === fnId || re.test(s.source))) out.push(a.name);
  }
  return out.sort((x, y) => x.localeCompare(y));
}

export function FunctionsTab() {
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState<FunctionDef | undefined>();
  const [err, setErr] = useState<string | undefined>();
  const list = Object.values(library.functions).sort((a, b) => a.name.localeCompare(b.name));
  const save = () => {
    if (!editing) return;
    try {
      const f = FunctionDefSchema.parse(editing);
      const c = compile(f.source, f.params.map((p) => p.name));
      if (!c.ok) { setErr(`Does not compile${c.line !== undefined ? ` (line ${c.line})` : ''}: ${c.error}`); return; }
      setLibrary({ ...library, functions: { ...library.functions, [f.id]: f } });
      setEditing(undefined); setErr(undefined); showToast('Saved');
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = () => {
    if (!editing) return;
    const users = usedBy(library.abilities, editing.id);
    if (users.length) {
      if (!confirm(`${editing.name} is called by ${users.join(', ')}. Deleting it will break them — continue?`)) return;
      if (!confirm(`Really delete ${editing.name}? This cannot be undone.`)) return;
    } else if (!confirm(`Delete ${editing.name}?`)) return;
    const rest = { ...library.functions };
    delete rest[editing.id];
    setLibrary({ ...library, functions: rest });
    setEditing(undefined);
  };
  const patch = (p: Partial<FunctionDef>) => setEditing({ ...editing!, ...p });
  return (
    <div>
      <p className="mb-2 text-sm text-zinc-400">A function is a shared script body with typed parameters. Records call it with <code>fn.name({'{ … }'})</code> or through the call form.</p>
      <div className="mb-3"><Button onClick={() => setEditing({ id: `fn-${Date.now().toString(36)}`, name: '', params: [], source: '' })}>+ New function</Button></div>
      <div className="space-y-1">
        {list.map((f) => {
          const users = usedBy(library.abilities, f.id);
          return (
            <button key={f.id} type="button" data-function={f.id} onClick={() => setEditing(f)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-left">
              <span className="min-w-0"><span className="truncate">{f.name}</span><span className="block truncate text-xs text-zinc-500">{f.id}({f.params.map((p) => p.name).join(', ')}) · {users.length ? `used by ${users.join(', ')}` : 'not used yet'}</span></span>
              <span className="text-zinc-600">›</span>
            </button>
          );
        })}
        {list.length === 0 && <p className="text-sm text-zinc-500">No functions yet.</p>}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} title={editing?.name || 'Function'} tall>
        {editing && (
          <div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" htmlFor="fn-name"><input id="fn-name" className={inputCls} value={editing.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
              <Field label="Id (used in fn.<id>)" htmlFor="fn-id"><input id="fn-id" className={inputCls} value={editing.id} onChange={(e) => patch({ id: e.target.value.trim() })} /></Field>
            </div>
            <Field label="Description"><textarea className={inputCls} value={editing.description ?? ''} onChange={(e) => patch({ description: e.target.value || undefined })} /></Field>
            <Field label="Parameters">
              {editing.params.map((p, i) => (
                <div key={i} className="mb-1 flex flex-wrap items-center gap-1">
                  <input className={inputCls + ' w-28 py-1.5'} placeholder="name" value={p.name} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)) })} />
                  <select className={inputCls + ' w-auto py-1.5'} value={p.type} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof p.type } : x)) })}>{ParamTypeSchema.options.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <input className={inputCls + ' w-28 py-1.5'} placeholder="label" value={p.label ?? ''} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) })} />
                  <label className="flex items-center gap-1 text-xs text-zinc-400"><input type="checkbox" checked={p.required} onChange={(e) => patch({ params: editing.params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> required</label>
                  <button type="button" className="px-2 text-zinc-500" onClick={() => patch({ params: editing.params.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <button type="button" className="text-sm text-amber-300" onClick={() => patch({ params: [...editing.params, { name: `p${editing.params.length + 1}`, type: 'number', required: false }] })}>+ add parameter</button>
            </Field>
            <Field label="Body (parameters are bare names)"><ScriptEditor value={editing.source} onChange={(source) => patch({ source })} errors={[]} /></Field>
            <div className="mb-3 text-xs text-zinc-500">Used by: {usedBy(library.abilities, editing.id).join(', ') || 'nothing yet'}</div>
            {err && <div className="mb-2 rounded-lg border border-red-900 bg-red-950/40 px-2 py-1 text-xs text-red-200">{err}</div>}
            <div className="flex gap-2">
              <Button variant="primary" onClick={save}>Save</Button>
              {library.functions[editing.id] && <Button variant="danger" className="ml-auto" onClick={remove}>Delete</Button>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
