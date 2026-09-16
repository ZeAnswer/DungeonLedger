import { parse, type Node } from 'acorn';

const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForOfStatement', 'ForInStatement']);
const FNS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

type AnyNode = Node & Record<string, unknown>;

function walk(n: AnyNode, visit: (n: AnyNode) => void) {
  visit(n);
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof (c as AnyNode).type === 'string') walk(c as AnyNode, visit);
    } else if (v && typeof (v as AnyNode).type === 'string') {
      walk(v as AnyNode, visit);
    }
  }
}

/**
 * Parses a script and:
 * - splices a `__g();` call (the loop-guard budget tick) as the first statement of every loop body
 *   and function body, so `compile`'s `run(api, guard)` can bound runaway scripts;
 * - scans for `battle.toggles.<name>` reads and `emit('<name>')` calls, for diagnostics/UI;
 * - honors a `// @noguard` (or `/* @noguard *\/`) comment anywhere in the source by skipping the splice.
 */
export function instrument(src: string): { code: string; toggles: string[]; emits: string[]; noguard: boolean } {
  const noguard = /(\/\/|\/\*)\s*@noguard\b/.test(src);
  const ast = parse(src, { ecmaVersion: 2022, allowReturnOutsideFunction: true }) as unknown as AnyNode;
  const toggles = new Set<string>();
  const emits = new Set<string>();
  const edits: { at: number; text: string }[] = [];

  walk(ast, (n) => {
    const obj = n.object as AnyNode | undefined;
    const prop = n.property as AnyNode | undefined;
    if (n.type === 'MemberExpression' && !n.computed && obj?.type === 'MemberExpression' && (obj.object as AnyNode).name === 'battle' && (obj.property as AnyNode).name === 'toggles' && prop) {
      toggles.add(String(prop.name));
    }
    if (n.type === 'CallExpression' && (n.callee as AnyNode).name === 'emit') {
      const a0 = (n.arguments as AnyNode[])[0];
      if (a0?.type === 'Literal') emits.add(String(a0.value));
    }
    if (noguard) return;
    if (LOOPS.has(n.type)) {
      const body = n.body as AnyNode;
      if (body.type === 'BlockStatement') {
        edits.push({ at: (body.start as number) + 1, text: '__g();' });
      } else {
        edits.push({ at: body.start as number, text: '{__g();' }, { at: body.end as number, text: '}' });
      }
    }
    if (FNS.has(n.type) && (n.body as AnyNode).type === 'BlockStatement') {
      edits.push({ at: ((n.body as AnyNode).start as number) + 1, text: '__g();' });
    }
  });

  edits.sort((a, b) => b.at - a.at);
  let code = src;
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at);
  return { code, toggles: [...toggles], emits: [...emits], noguard };
}
