import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ScriptError } from '@hl/engine';
import { scriptExtensions } from './codemirror';
import { SNIPPETS } from './snippets';

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

  const insert = (text: string) => {
    const v = view.current;
    if (!v) return;
    const at = v.state.selection.main;
    v.dispatch({ changes: { from: at.from, to: at.to, insert: text }, selection: { anchor: at.from + text.length } });
    v.focus();
  };

  return (
    <div>
      <div data-role="script-source" ref={host} className="max-h-64 overflow-hidden rounded-xl border border-zinc-700 text-sm" />
      <div className="mt-1 flex gap-1 overflow-x-auto pb-1">
        {SNIPPETS.map((s) => <button key={s.label} type="button" onClick={() => insert(s.insert)} className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">{s.label}</button>)}
      </div>
    </div>
  );
}
