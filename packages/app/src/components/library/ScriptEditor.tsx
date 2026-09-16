import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ScriptError } from '@hl/engine';
import { scriptExtensions } from './codemirror';
import { INSERT_GROUPS } from './snippets';

/** One script's source. CodeMirror owns the DOM; React only pushes value changes that came from elsewhere. */
export function ScriptEditor({ value, onChange, errors }: { value: string; onChange: (v: string) => void; errors: ScriptError[] }) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: scriptExtensions({
          onChange: (t) => onChangeRef.current(t),
          errorsRef: () => errorsRef.current,
          // The sync effect below defers an external `value` update that lands while this field is
          // focused (so it doesn't clobber a keystroke in flight). Re-diff on blur and apply it then,
          // so that deferred update isn't lost if `value` doesn't change again afterwards.
          onBlur: () => {
            if (v.state.doc.toString() !== valueRef.current) {
              v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: valueRef.current } });
            }
          },
        }),
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // Mount once, deliberately: `value` is pushed in by the effect below, and re-creating the view on
    // every keystroke would lose the cursor.
  }, []);

  useEffect(() => {
    const v = view.current;
    // Skip while focused: React's echo of our own onChange can arrive a few keystrokes stale (fast typing,
    // or Playwright's unthrottled keyboard.type), and re-applying a stale `value` over a focused view would
    // truncate what the user just typed. A genuinely external change (loading a different script, JSON-tab
    // round trip) that lands while focused is caught by the `onBlur` handler above instead.
    if (!v || v.hasFocus || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  const menuRef = useRef<HTMLDetailsElement | null>(null);

  const insert = (text: string) => {
    const v = view.current;
    if (!v) return;
    const at = v.state.selection.main;
    v.dispatch({ changes: { from: at.from, to: at.to, insert: text }, selection: { anchor: at.from + text.length } });
    v.focus();
  };
  // One-shot pick: insert at the cursor, then close the menu.
  const pick = (text: string) => {
    insert(text);
    if (menuRef.current) menuRef.current.open = false;
  };

  return (
    <div>
      <div data-role="script-source" ref={host} className="max-h-64 overflow-hidden rounded-xl border border-zinc-700 text-sm" />
      <details ref={menuRef} data-role="script-insert" className="relative mt-1">
        <summary className="inline-flex w-fit cursor-pointer list-none select-none items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 marker:content-none">insert ▾</summary>
        <div className="absolute z-10 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
          {INSERT_GROUPS.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{g.label}</div>
              {g.items.map((item) => (
                <button key={item.label} type="button" title={item.doc} onClick={() => pick(item.insert)} className="block w-full truncate rounded-lg px-2 py-1 text-left font-mono text-xs text-zinc-200 hover:bg-zinc-800">
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
