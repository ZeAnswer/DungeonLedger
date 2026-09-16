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

/** Names the script runtime owns: a script may not declare (var/let/const/function/class/param/catch) them. */
const RESERVED = new Set(['__g', 'api']);

/** Collects every identifier a binding pattern (possibly destructured, defaulted, or rest) declares. */
function patternNames(n: AnyNode | undefined, out: Set<string>) {
  if (!n) return;
  switch (n.type) {
    case 'Identifier': out.add(String(n.name)); break;
    case 'ObjectPattern':
      for (const p of (n.properties as AnyNode[]) ?? []) patternNames((p.type === 'RestElement' ? p.argument : p.value) as AnyNode, out);
      break;
    case 'ArrayPattern':
      for (const e of (n.elements as (AnyNode | null)[]) ?? []) if (e) patternNames(e, out);
      break;
    case 'AssignmentPattern': patternNames(n.left as AnyNode, out); break;
    case 'RestElement': patternNames(n.argument as AnyNode, out); break;
    default: break;
  }
}

/**
 * Parses a script and:
 * - splices a `__g();` call (the loop-guard budget tick) as the first statement of every loop body
 *   and function body, so `compile`'s `run(api, guard)` can bound runaway scripts;
 * - scans for `battle.toggles.<name>` reads, `battle.on('<name>')` calls and `emit('<name>')` calls,
 *   for diagnostics/UI;
 * - honors a real `// @noguard` (or `/* @noguard *\/`) comment — read from acorn's comment stream, not a
 *   regex over the raw source, so a string literal that merely contains that text does not count — by
 *   skipping the splice;
 * - rejects a script that declares `__g` or `api`: those are the runtime's own function parameters, and
 *   a plain `var __g = () => 0` (unlike `let`/`const`, which already collide as a redeclaration) would
 *   otherwise silently swap out the guard.
 */
export function instrument(src: string): { code: string; toggles: string[]; emits: string[]; noguard: boolean } {
  const comments: string[] = [];
  const ast = parse(src, { ecmaVersion: 2022, allowReturnOutsideFunction: true, onComment: (_block, text) => { comments.push(String(text)); } }) as unknown as AnyNode;
  const noguard = comments.some((c) => /@noguard\b/.test(c));
  const toggles = new Set<string>();
  const emits = new Set<string>();
  const declared = new Set<string>();
  const edits: { at: number; text: string }[] = [];

  walk(ast, (n) => {
    const obj = n.object as AnyNode | undefined;
    const prop = n.property as AnyNode | undefined;
    if (n.type === 'MemberExpression' && !n.computed && obj?.type === 'MemberExpression' && (obj.object as AnyNode).name === 'battle' && (obj.property as AnyNode).name === 'toggles' && prop) {
      toggles.add(String(prop.name));
    }
    if (n.type === 'CallExpression') {
      const callee = n.callee as AnyNode;
      if (callee.name === 'emit') {
        const a0 = (n.arguments as AnyNode[])[0];
        if (a0?.type === 'Literal') emits.add(String(a0.value));
      }
      if (callee.type === 'MemberExpression' && !callee.computed && (callee.object as AnyNode).name === 'battle' && (callee.property as AnyNode).name === 'on') {
        const a0 = (n.arguments as AnyNode[])[0];
        if (a0?.type === 'Literal') toggles.add(String(a0.value));
      }
    }
    if (n.type === 'VariableDeclarator') patternNames(n.id as AnyNode, declared);
    if (FNS.has(n.type)) {
      for (const p of (n.params as AnyNode[]) ?? []) patternNames(p, declared);
      if (n.id) patternNames(n.id as AnyNode, declared);
    }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) patternNames(n.id as AnyNode, declared);
    if (n.type === 'CatchClause' && n.param) patternNames(n.param as AnyNode, declared);
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

  for (const name of RESERVED) if (declared.has(name)) throw new Error(`'${name}' is reserved for the script runtime; pick another name`);

  edits.sort((a, b) => b.at - a.at);
  let code = src;
  for (const e of edits) code = code.slice(0, e.at) + e.text + code.slice(e.at);
  return { code, toggles: [...toggles], emits: [...emits], noguard };
}
