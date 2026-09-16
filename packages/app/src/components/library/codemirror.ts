import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { API_NAMES, PATHS, compile, type ScriptError } from '@hl/engine';

/** Completion from the engine's own vocabulary: every destructured helper plus the documented paths. */
function apiCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [
      ...API_NAMES.map((n) => ({ label: n, type: 'function' as const })),
      ...PATHS.map((p) => ({ label: p.path, type: 'variable' as const, detail: p.kind, info: p.doc })),
    ],
    validFor: /^[\w.]*$/,
  };
}

/** Squiggles from the real compiler, plus whatever the engine recorded for this script. */
function scriptLinter(errorsRef: () => ScriptError[]): Extension {
  return linter((view) => {
    const doc = view.state.doc;
    const at = (line?: number) => doc.line(Math.min(Math.max(line ?? 1, 1), doc.lines));
    const out: Diagnostic[] = [];
    const src = doc.toString();
    if (src.trim()) {
      const c = compile(src);
      if (!c.ok) { const l = at(c.line); out.push({ from: l.from, to: l.to, severity: 'error', message: c.error }); }
    }
    for (const e of errorsRef()) { const l = at(e.line); out.push({ from: l.from, to: l.to, severity: 'error', message: e.message }); }
    return out;
  }, { delay: 300 });
}

/**
 * Deliberately without `closeBrackets`: on a phone (and in Playwright) a typed `)` that may or may not
 * be swallowed makes the box unpredictable, and scripts here are two or three lines long.
 */
export function scriptExtensions(opts: { onChange: (v: string) => void; errorsRef: () => ScriptError[] }): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    indentOnInput(),
    bracketMatching(),
    javascript(),
    oneDark,
    autocompletion({ override: [apiCompletions] }),
    lintGutter(),
    scriptLinter(opts.errorsRef),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
  ];
}
