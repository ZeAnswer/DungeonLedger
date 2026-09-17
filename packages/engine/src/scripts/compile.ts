import { API_NAMES, type ScriptApi } from './api';
import { instrument } from './instrument';

export type Compiled =
  // `unknown`, not `void`: a script normally runs for its side effects, but a library function's source
  // may end in `return <expr>;`, which `new Function` really does hand back at runtime.
  | { ok: true; run: (api: ScriptApi, guard: () => void) => unknown; toggles: string[]; toggleParams: string[]; emits: string[]; noguard: boolean }
  | { ok: false; error: string; line?: number };

/** Built on first use: `api.ts` reaches this module through an import cycle, so it may still be initialising. */
let preamble: string | undefined;
const PREAMBLE = () => (preamble ??= `const { ${API_NAMES.join(', ')} } = api;\n`);
const cache = new Map<string, Compiled>();
const MAX = 2000;

/**
 * Compiles a script source string into a runnable function, destructuring the api object into the
 * names scripts write bare (`bonus(...)`, `need(...)`, …) and splicing the loop guard from `instrument`.
 * Results are cached by (paramNames, source) — the same source compiled twice returns the same object.
 */
export function compile(source: string, paramNames: string[] = []): Compiled {
  const key = `${paramNames.join(',')}::${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: Compiled;
  try {
    const ins = instrument(source);
    const argLine = paramNames.length ? `const { ${paramNames.join(', ')} } = args;\n` : '';
    const f = new Function('api', '__g', `"use strict";\n${PREAMBLE()}${argLine}${ins.code}\n`) as (api: ScriptApi, g: () => void) => unknown;
    // A `battle.on(<identifier>)` whose identifier is a compiled param name: the toggle's name is only
    // known at the call site (the caller's literal argument for that param), not in this source alone.
    const toggleParams = ins.toggleIdentifiers.filter((name) => paramNames.includes(name));
    out = { ok: true, run: f, toggles: ins.toggles, toggleParams, emits: ins.emits, noguard: ins.noguard };
  } catch (e) {
    const err = e as Error & { loc?: { line: number } };
    const m = /Identifier '(\w+)' has already been declared/.exec(err.message);
    out = {
      ok: false,
      error: m && (API_NAMES as readonly string[]).includes(m[1]!) ? `'${m[1]}' is a built-in helper; pick another name` : err.message,
      ...(err.loc ? { line: err.loc.line } : {}),
    };
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
