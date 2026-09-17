/**
 * Prints a rules-v3 effect block as a v4 script: plain JS written against the helper api
 * (`bonus`, `note`, `target.mark`…). Used by the converter (`migrate.ts`) and by the editor
 * when it offers "convert this block to a script".
 *
 * Two shapes come out of a block's condition:
 *  - a **traced** predicate (`attack.isRanged`, `target.within(30)`, `target.is('aquatic')`) joins
 *    the `if (...)` test, so the engine's near-miss trace can say which one failed;
 *  - anything else becomes `need(<js>, '<sentence>')` inside the block, where the sentence is the
 *    v3 condition describer's text: `describeV3` here, over `describe.ts`'s shared, context-free
 *    `describeSelectorWith` (the condition half of the describer went with the v3 condition tree).
 *    Pass `names` — the pack being converted — and the sentences name tags, skills and records.
 *
 * A verb's own `attackKind` guards only that verb's run of statements, never the whole block, and an
 * event-only helper left in an always block is printed with a warning comment and reported through
 * `printWarnings`.
 *
 * Whitespace is part of the contract: two-space indent, one statement per line, `;` terminators,
 * single quotes (backticks only where a value is interpolated or the text carries an apostrophe).
 */
import { describeSelectorWith, labelOf, type NameLookup } from '../describe';
import { evalExpr } from '../expr';
import type { Script, ScriptEvent } from '../schema';

type Any = Record<string, unknown>;
const isObj = (x: unknown): x is Any => !!x && typeof x === 'object' && !Array.isArray(x);

/** Ids and labels the describer uses for its sentences; anything missing falls back to the id. */
export type PrintNames = NameLookup;

// ---------- literals and paths ----------
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Single-quoted JS string. */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** `base.key` when the key is a bare identifier, `base['key']` otherwise (ids carry dashes and dots). */
const at = (base: string, key: string) => (IDENT.test(key) ? `${base}.${key}` : `${base}[${q(key)}]`);
const CONST = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^[^A-Za-z_]+/, '');

/** v1/v2/v3 history scope spellings in the current vocabulary. */
const SCOPE: Record<string, string> = { thisRound: 'round', round: 'round', thisAttackSequence: 'attack', attack: 'attack', lastRound: 'lastRound', encounter: 'encounter', day: 'day' };

/** `history.<event>.<by>.<vs>.<scope>[.<abilityId>]` → a `history(...)` call with the defaults left out. */
function historyCall(f: { event: string; by?: string; vs?: string; scope?: string; abilityId?: string; category?: string }): string {
  const opts: string[] = [];
  if (f.by && f.by !== 'me') opts.push(`by: ${q(f.by)}`);
  if (f.vs && f.vs !== 'current') opts.push(`vs: ${q(f.vs)}`);
  const since = SCOPE[f.scope ?? 'round'] ?? 'round';
  if (since !== 'round') opts.push(`since: ${q(since)}`);
  if (f.abilityId) opts.push(`ability: ${q(f.abilityId)}`);
  if (f.category) opts.push(`category: ${q(f.category)}`);
  return `history(${q(f.event)}${opts.length ? `, { ${opts.join(', ')} }` : ''})`;
}

/** An engine selector as the script path that reads the same value; undefined when there is none. */
export function selectorToPath(sel: string): string | undefined {
  const p = sel.split('.');
  const rest = p.slice(2).join('.');
  switch (p[0]) {
    case 'self': switch (p[1]) {
      case 'stat': return p[2] === 'ability' ? at('player.stats', p.slice(3).join('.')) : at('player.stats', rest);
      case 'mod': return at('player.mod', rest);
      case 'skill': return `${at('player.skills', p.slice(2, -1).join('.'))}.${p[p.length - 1]}`;
      case 'class': return at('player.classes', p.slice(2, -1).join('.'));
      case 'hp': return `player.hp.${rest}`;
      case 'level': case 'bab': case 'size': return `player.${p[1]}`;
      case 'tags': return 'player.tags';
      case 'tag': return `player.is(${q(rest)})`;
      case 'resource': return p[p.length - 1] === 'left' ? `player.left(${q(p.slice(2, -1).join('.'))})` : undefined;
      case 'equipped':
        if (p[2] === 'count' && p[3] === 'tag') return at('player.equipped.tag', p.slice(4).join('.'));
        if (p[2] === 'item') return `player.wearing(${q(p.slice(3).join('.'))})`;
        if (p[2] === 'slot' || p[2] === 'category') return at(`player.equipped.${p[2]}`, p.slice(3).join('.'));
        return undefined;
      case 'ability': {
        const id = p.slice(2, -1).join('.');
        return p[p.length - 1] === 'enabled' ? `player.has(${q(id)})` : p[p.length - 1] === 'active' ? `player.active(${q(id)})` : undefined;
      }
      case 'var': return at('vars', rest);
      case 'param': return at('params', rest);
      default: return undefined;
    }
    case 'target':
      if (p[1] === 'tag' || p[1] === 'condition') return `target.is(${q(rest)})`;
      return ['exists', 'name', 'type', 'size', 'hurt', 'distance', 'revealed', 'dead', 'tags'].includes(p[1] ?? '') ? `target.${p[1]}` : undefined;
    case 'attack':
      if (p[1] === 'weapon') return p[2] === 'tag' ? `attack.weapon.is(${q(p.slice(3).join('.'))})` : ['id', 'category', 'tags'].includes(p[2] ?? '') ? `attack.weapon.${p[2]}` : undefined;
      return ['kind', 'index', 'mode', 'isFirstThisRound'].includes(p[1] ?? '') ? `attack.${p[1]}` : undefined;
    case 'battle':
      if (p[1] === 'toggle') return at('battle.toggles', rest);
      if (p[1] === 'prompt') return at('battle.prompts', rest);
      if (p[1] === 'tag') return `battle.is(${q(rest)})`;
      return ['round', 'elapsed', 'tags'].includes(p[1] ?? '') ? `battle.${p[1]}` : undefined;
    case 'flag': return at('flags', p.slice(1).join('.'));
    case 'history': return historyCall({ event: p[1] ?? 'hit', by: p[2], vs: p[3], scope: p[4], ...(p[5] ? { abilityId: p[5] } : {}) });
    default: return undefined;
  }
}

/** A selector as a readable value: the script path when one exists, `sel('…')` otherwise. */
const value = (sel: string) => selectorToPath(sel) ?? `sel(${q(sel)})`;

// ---------- expressions ----------
const MOD = /^(str|dex|con|int|wis|cha)Mod$/;
const NAMED: Record<string, string> = { level: 'player.level', bab: 'player.bab', round: 'battle.round', damage: 'player.lastDamage' };
/** `sel(x)`/`classLevel(x)`/`prompt(x)`, or a name — which the v3 grammar lets carry dots (`self.class.ranger.level`). */
const TOKEN = /\b(sel|classLevel|prompt)\s*\(\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*\)|\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\b(\s*\()?/g;

/**
 * Rewrites a v3 expression string into script JS, leaving every space and operator where it was:
 * `4 * sel(history.miss.me.current.thisRound)` → `4 * history('miss')`.
 * A dotted name is a bare selector (the v3 evaluator resolved those through `resolve`), so it takes
 * the same road as `sel(...)`; any other bare identifier is a character/global var.
 */
export function printExpr(expr: string | number): string {
  if (typeof expr === 'number') return String(expr);
  return expr.replace(TOKEN, (whole, fn: string | undefined, arg: string | undefined, name: string | undefined, paren: string | undefined) => {
    if (fn) {
      if (fn === 'classLevel') return at('player.classes', arg!);
      if (fn === 'prompt') return at('battle.prompts', arg!);
      return value(arg!);
    }
    if (paren !== undefined) return whole; // a call keeps its name; its arguments are rewritten in place
    if (name!.includes('.')) return value(name!);
    const m = MOD.exec(name!);
    if (m) return `player.mod.${m[1]}`;
    return NAMED[name!] ?? at('vars', name!);
  });
}

/** Rejects a `{…}` note placeholder that is not a v3 expression, so a typo cannot reach a pack. */
function checkExpr(src: string): string {
  try { evalExpr(src, { resolve: () => 0 }); } catch { throw new Error(`note text: bad {expr} "${src}"`); }
  return printExpr(src);
}

// ---------- the v3 condition describer (the rest of it went with the v3 condition tree) ----------
function describeHistoryV3(f: Any, names: PrintNames): string {
  const ability = f.abilityId ? labelOf(names.abilities, f.abilityId as string) : 'ability';
  const what = ({ hit: 'hit', miss: 'missed', crit: 'critted', attack: 'attacked', used: `used ${ability}`, activated: 'activated', damaged: 'damaged', moved: 'moved' } as Record<string, string>)[f.event as string] ?? String(f.event);
  const who = f.by === 'target' ? 'the target' : f.by === 'any' ? 'anyone' : 'you';
  const vs = (f.vs ?? 'current') === 'current' ? (f.by === 'target' ? ' you' : ' this target') : f.vs === 'sameCategory' ? ` a ${(f.category as string) ?? 'similar'} target` : '';
  const when = ({ attack: 'this round', round: 'this round', lastRound: 'last round', encounter: 'this battle', day: 'today' } as Record<string, string>)[SCOPE[(f.scope as string) ?? 'round'] ?? 'round'] ?? 'this round';
  return `${who} ${what}${vs} ${when}`;
}

/** The v3 sentence for a condition — the text `need()` shows when the script does not apply. */
export function describeV3(cond: unknown, names: PrintNames = {}): string {
  const c = isObj(cond) ? cond : {};
  const list = (k: string) => (c[k] as unknown[]).map((x) => describeV3(x, names));
  if (Array.isArray(c.all)) return c.all.length ? list('all').join(' and ') : 'always';
  if (Array.isArray(c.any)) return list('any').join(' or ');
  if (Array.isArray(c.none)) return `none of: ${list('none').join(' / ')}`;
  if ('not' in c) return `not (${describeV3(c.not, names)})`;
  if (Array.isArray(c.count)) return `at least ${c.atLeast} of: ${list('count').join(' / ')}`;
  if (typeof c.is === 'string') return describeSelectorWith(c.is, names);
  if (typeof c.exists === 'string') return describeSelectorWith(c.exists, names);
  if (typeof c.compare === 'string') {
    const l = describeSelectorWith(c.compare, names);
    const op = ({ '=': 'is', '!=': 'is not', '<': 'below', '<=': 'at most', '>': 'above', '>=': 'at least' } as Record<string, string>)[c.op as string] ?? String(c.op);
    const v = typeof c.value === 'string' ? labelOf(names.tags, c.value) : String(c.value);
    if (c.compare === 'target.hurt' && c.op === '>=') return `target is ${v} or worse`;
    if (c.compare === 'target.size' && c.op === '>=') return `target is ${v} or larger`;
    if (c.compare === 'attack.kind' && c.op === '=') return `${v} attack`;
    return `${l} ${op} ${v}`;
  }
  if (typeof c.in === 'string') return c.param ? `${describeSelectorWith(c.in, names)} is one of your ${c.param}` : `${describeSelectorWith(c.in, names)} is ${((c.set as string[]) ?? []).map((t) => labelOf(names.tags, t)).join(' / ')}`;
  if (isObj(c.history)) {
    const n = (c.value as number) ?? 1;
    return `${describeHistoryV3(c.history, names)}${n > 1 || (c.op && c.op !== '>=') ? ` (${(c.op as string) ?? '>='} ${n})` : ''}`;
  }
  return 'condition';
}

// ---------- conditions ----------
/** The traced helper for a leaf, when the api has one; these are what the near-miss trace reads. */
function traced(c: unknown): string | undefined {
  if (!isObj(c)) return undefined;
  if (typeof c.is === 'string') {
    const s = c.is;
    const after = (prefix: string) => (s.startsWith(prefix) ? s.slice(prefix.length) : undefined);
    const tag = after('target.tag.') ?? after('target.condition.');
    if (tag) return `target.is(${q(tag)})`;
    const self = after('self.tag.');
    if (self) return `player.is(${q(self)})`;
    const weapon = after('attack.weapon.tag.');
    if (weapon) return `attack.weapon.is(${q(weapon)})`;
    const toggle = after('battle.toggle.');
    if (toggle) return `battle.on(${q(toggle)})`;
    const btag = after('battle.tag.');
    if (btag) return `battle.is(${q(btag)})`;
    const item = after('self.equipped.item.');
    if (item) return `player.wearing(${q(item)})`;
    const enabled = /^self\.ability\.(.+)\.enabled$/.exec(s);
    if (enabled) return `player.has(${q(enabled[1]!)})`;
    if (s === 'attack.isFirstThisRound') return 'attack.isFirstThisRound';
    return undefined;
  }
  if (c.compare === 'attack.kind' && c.op === '=') return c.value === 'ranged' ? 'attack.isRanged' : c.value === 'melee' ? 'attack.isMelee' : undefined;
  if (c.compare === 'target.distance' && c.op === '<=' && typeof c.value === 'number') return `target.within(${c.value})`;
  if (c.in === 'target.tags') {
    if (typeof c.param === 'string') return `target.isOneOf(${at('params', c.param)})`;
    if (Array.isArray(c.set)) return `target.is([${(c.set as string[]).map(q).join(', ')}])`;
  }
  return undefined;
}

const ORDINAL: Record<string, string> = { 'target.hurt': 'HURT', 'target.size': 'SIZE', 'self.size': 'SIZE' };

/** A condition as a JS boolean expression; `inner` parenthesises a composite that sits inside another one. */
function jsCond(cond: unknown, inner = false): string {
  const c = isObj(cond) ? cond : { all: [] };
  const t = traced(c);
  if (t) return t;
  const join = (k: string, sep: string) => {
    const parts = (c[k] as unknown[]).map((x) => jsCond(x, true));
    const body = parts.join(sep);
    return parts.length > 1 && inner ? `(${body})` : body;
  };
  if (Array.isArray(c.all)) return c.all.length ? join('all', ' && ') : 'true';
  if (Array.isArray(c.any)) return c.any.length ? join('any', ' || ') : 'false';
  if (Array.isArray(c.none)) return `!(${(c.none as unknown[]).map((x) => jsCond(x, true)).join(' || ')})`;
  if ('not' in c) return `!(${jsCond(c.not)})`;
  if (Array.isArray(c.count)) {
    const body = `[${(c.count as unknown[]).map((x) => jsCond(x)).join(', ')}].filter(Boolean).length >= ${c.atLeast}`;
    return inner ? `(${body})` : body;
  }
  if (typeof c.is === 'string') return value(c.is);
  if (typeof c.exists === 'string') return `${value(c.exists)} !== undefined`;
  if (typeof c.compare === 'string') {
    const op = c.op === '=' ? '===' : c.op === '!=' ? '!==' : String(c.op);
    const ord = ORDINAL[c.compare];
    const v = typeof c.value === 'number' ? String(c.value) : ord ? `${ord}.${CONST(c.value as string)}` : q(String(c.value));
    return `${value(c.compare)} ${op} ${v}`;
  }
  if (typeof c.in === 'string') {
    const set = Array.isArray(c.set) ? `[${(c.set as string[]).map(q).join(', ')}]` : at('params', String(c.param));
    return `${set}.some((t) => ${value(c.in)}.includes(t))`;
  }
  if (isObj(c.history)) return `${historyCall(c.history as never)} ${c.op ?? '>='} ${c.value ?? 1}`;
  return 'true';
}

// ---------- verbs ----------
const DURATION_SENTINEL: Record<string, string> = { thisAttack: 'THIS_ATTACK', untilMyNextTurn: 'UNTIL_MY_NEXT_TURN', encounter: 'ENCOUNTER', untilRemoved: 'UNTIL_REMOVED' };

/** A v3 duration as the script constant that means the same span. */
export function printDuration(d: unknown): string {
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d === 'thisTurn' ? 'ROUND' : DURATION_SENTINEL[d] ?? q(d);
  if (isObj(d) && d.rounds !== undefined) return typeof d.rounds === 'number' ? (d.rounds === 1 ? 'ROUND' : `${d.rounds} * ROUND`) : `(${printExpr(d.rounds as string)}) * ROUND`;
  if (isObj(d) && d.minutes !== undefined) return typeof d.minutes === 'number' ? (d.minutes === 1 ? 'MINUTE' : `${d.minutes} * MINUTE`) : `(${printExpr(d.minutes as string)}) * MINUTE`;
  return 'UNTIL_REMOVED';
}

/** Note text: `{expr}` placeholders become `${…}`, so the line needs a template literal. */
function printText(text: string, dc?: unknown): string {
  const full = dc === undefined ? text : typeof dc === 'number' ? `${text} (DC ${dc})` : `${text} (DC {${dc}})`;
  const parts = full.split(/\{([^}]+)\}/);
  const interpolated = parts.length > 1;
  if (!interpolated && !full.includes("'")) return q(full);
  // Replacement *functions*: a literal `$` in a replacement string would be read as a capture reference.
  const literal = (p: string) => p.replace(/\\/g, () => '\\\\').replace(/`/g, () => '\\`').replace(/\$(?=\{)/g, () => '\\$');
  const body = parts.map((p, i) => (i % 2 ? `\${${checkExpr(p)}}` : literal(p))).join('');
  return `\`${body}\``;
}

const num = (v: unknown) => (typeof v === 'number' ? String(v) : printExpr(String(v)));

type Group = { name: string; ask: string; rows: string[] };

/** One verb → one statement (or, for a table-valued modify, a line inside its prompt's group). */
function printVerb(e: Any, groups: Map<string, Group>, order: string[], blockLabel?: string): string | string[] | undefined {
  switch (e.verb) {
    case 'modify': {
      const stat = q(String(e.to));
      const mode = (e.mode as string) ?? 'add';
      if (isObj(e.value)) { // table: one ask() const per prompt, the bonuses under `if (<const>)`
        const v = e.value as { prompt: string; per?: string; table: { upTo?: number; value: number }[] };
        const name = camel(v.prompt);
        if (!groups.has(v.prompt)) {
          groups.set(v.prompt, { name, ask: `const ${name} = ask(${q(v.prompt)}${v.per ? `, { per: ${q(v.per)} }` : ''});`, rows: [] });
          order.push(v.prompt);
        }
        const tier = `tier(${name}, ${v.table.map((r) => `[${r.upTo ?? 'Infinity'}, ${r.value}]`).join(', ')})`;
        const type = e.type && e.type !== 'untyped' ? `, ${q(String(e.type))}` : '';
        groups.get(v.prompt)!.rows.push(mode === 'set' ? `setStat(${stat}, ${tier});` : mode === 'multiply' ? `scale(${stat}, ${tier});` : `bonus(${stat}, ${tier}${type});`);
        return undefined;
      }
      const v = num(e.value);
      if (mode === 'set') return `setStat(${stat}, ${v});`;
      if (mode === 'multiply') return `scale(${stat}, ${v});`;
      const type = e.type && e.type !== 'untyped' ? `, ${q(String(e.type))}` : '';
      return `bonus(${stat}, ${v}${type});`;
    }
    case 'dice': {
      // The block label already reaches the helper as the script label; only a label of its own is worth printing.
      const as = typeof e.label === 'string' && e.label !== blockLabel ? `, { as: ${q(e.label)} }` : '';
      const type = e.damageType ? `, ${q(String(e.damageType))}` : as ? ', undefined' : '';
      return `dice(${q(String(e.dice))}${type}${as});`;
    }
    case 'flag': return `flag(${q(String(e.flag))}${e.value === false ? ', false' : ''});`;
    case 'note': return `note(${printText(String(e.text), e.dc)});`;
    case 'slot': return `slot(${q(String(e.slot))}, ${(e.count as number) ?? 1});`;
    case 'tag': {
      const d = e.duration === undefined || e.duration === 'untilRemoved' ? '' : `, ${printDuration(e.duration)}`;
      return e.to === 'target' ? `target.mark(${q(String(e.tag))}${d});` : `condition(${q(String(e.to))}, ${q(String(e.tag))}${d});`;
    }
    case 'grant': return `grant(${q(String(e.ability))}${e.duration !== undefined ? `, ${printDuration(e.duration)}` : ''});`;
    case 'suppress': return `suppress(${q(String(e.ability))});`;
    case 'resource': {
      const op = e.op === 'restore' ? 'restore' : e.op === 'set' ? 'set' : 'use';
      const amount = e.amount ?? 1;
      const arg = op === 'set' || amount !== 1 ? num(amount) : '';
      return `charges(${q(String(e.id))}).${op}(${arg});`;
    }
    case 'hp': return `${e.op === 'heal' ? 'heal' : e.op === 'temp' ? 'temp' : 'hurt'}(${num(e.amount)});`;
    case 'prompt': return `ask(${q(String(e.id))}${e.per ? `, { per: ${q(String(e.per))} }` : ''});`;
    case 'reveal': return 'target.reveal();';
    case 'attack': {
      if (isObj(e.mode)) {
        const m = e.mode as Any;
        const fields = [`id: ${q(String(m.id))}`, `label: ${q(String(m.label))}`, `base: ${q(String(m.base ?? 'full'))}`];
        if (e.extraAttacks) fields.push(`extra: ${e.extraAttacks}`);
        if (e.penaltyAll) fields.push(`penalty: ${e.penaltyAll}`);
        if (e.attackKind) fields.push(`kind: ${q(String(e.attackKind))}`);
        if (m.note) fields.push(`note: ${q(String(m.note))}`);
        return `attackMode({ ${fields.join(', ')} });`;
      }
      if (isObj(e.naturalAttack)) {
        const n = e.naturalAttack as Any;
        const fields = [`name: ${q(String(n.name))}`, `dice: ${q(String(n.dice))}`];
        if (n.count !== undefined && n.count !== 1) fields.push(`count: ${n.count}`);
        if (n.attackBonus) fields.push(`attackBonus: ${n.attackBonus}`);
        return `naturalAttack({ ${fields.join(', ')} });`;
      }
      const opts: string[] = [];
      if (e.appliesToBase) opts.push(`base: ${q(String(e.appliesToBase))}`);
      if (e.attackKind) opts.push(`kind: ${q(String(e.attackKind))}`);
      const extra = `extraAttack(${(e.extraAttacks as number) ?? 1}${opts.length ? `, { ${opts.join(', ')} }` : ''});`;
      // Without a mode of its own, `penaltyAll` was simply "every attack takes this".
      return e.penaltyAll ? [extra, `bonus('attack', ${e.penaltyAll});`] : extra;
    }
    default: return undefined;
  }
}

const indent = (lines: string[]) => lines.map((l) => `  ${l}`);

export type V3Block = { id?: string; label?: string; trigger?: string; when?: unknown; do?: unknown[] };

const EVENT_OF_TRIGGER: Record<string, ScriptEvent> = {
  always: 'always', onHit: 'hit', onMiss: 'miss', onCrit: 'crit', onDamaged: 'damaged', onRoundStart: 'roundStart', onRoundEnd: 'roundEnd',
};

/** Helpers that change state: legal in an event script, a no-op (and a thrown error) in an always one. */
const EVENT_ONLY = new Set(['tag', 'grant', 'suppress', 'resource', 'hp', 'reveal', 'check']);
export const EVENT_ONLY_WARNING = '// WARNING: event-only helper in an always script; move this to an event';

/**
 * Every warning raised since the last `clearPrintWarnings()`, in print order — a v3 block that asks
 * for something a v4 always script cannot do. The converter cannot refuse the record (the pack must
 * still load), so the validator reads this list.
 */
export const printWarnings: string[] = [];
export function clearPrintWarnings(): void { printWarnings.length = 0; }

/**
 * One v3 effect block → one v4 script. `phase` is where the block sat: a record's/activation's
 * `effects`/`whileActive` list ('always') or an activation's `onUse` list ('use'). `ownerId` names
 * the record or activation the block belongs to and is the script id when the block has none.
 */
export function printBlock(block: V3Block, phase: 'always' | 'use', ownerId: string, names: PrintNames = {}): Script {
  const verbs = (Array.isArray(block.do) ? block.do : []).filter(isObj);
  const when = block.when ?? { all: [] };
  const event: ScriptEvent = phase === 'use' ? 'use' : EVENT_OF_TRIGGER[block.trigger ?? 'always'] ?? 'always';

  // The block's own condition: traced members test in the `if`, the rest become need() lines.
  const test: string[] = [];
  const needs: string[] = [];
  const members = isObj(when) && Array.isArray(when.all) ? (when.all as unknown[]) : undefined;
  if (members) {
    for (const m of members) {
      const t = traced(m);
      if (t) test.push(t);
      else needs.push(`need(${jsCond(m)}, ${q(describeV3(m, names))});`);
    }
  } else if (isObj(when)) {
    test.push(jsCond(when));
  }

  const groups = new Map<string, Group>();
  const order: string[] = [];
  const parts: { kind?: string; lines?: string[]; group?: string }[] = [];
  const stray: string[] = [];
  for (const e of verbs) {
    const before = order.length;
    const line = printVerb(e, groups, order, block.label);
    // `attackKind` limits the verb it sits on, not the block: it guards only its own run of statements.
    const kind = (e.verb === 'modify' || e.verb === 'dice') && typeof e.attackKind === 'string' ? (e.attackKind as string) : undefined;
    if (line) parts.push({ kind, lines: [line].flat() });
    else if (order.length > before) parts.push({ kind, group: order[order.length - 1]! });
    if (event === 'always' && EVENT_ONLY.has(String(e.verb))) stray.push(String(e.verb));
  }
  const expand = (x: { lines?: string[]; group?: string }): string[] => {
    if (!x.group) return x.lines ?? [];
    const g = groups.get(x.group)!;
    return [g.ask, `if (${g.name}) {`, ...indent(g.rows), '}'];
  };
  const runs: { kind?: string; lines: string[] }[] = [];
  for (const x of parts) {
    const last = runs[runs.length - 1];
    if (last && last.kind === x.kind) last.lines.push(...expand(x));
    else runs.push({ kind: x.kind, lines: expand(x) });
  }
  const body: string[] = [];
  for (const r of runs) {
    const pred = r.kind === 'ranged' ? 'attack.isRanged' : r.kind === 'melee' ? 'attack.isMelee' : undefined;
    if (pred && !test.includes(pred)) body.push(`if (${pred}) {`, ...indent(r.lines), '}');
    else body.push(...r.lines);
  }

  const inner = [...needs, ...body];
  const lines = test.length ? [`if (${test.join(' && ')}) {`, ...indent(inner), '}'] : inner;
  if (stray.length) {
    printWarnings.push(`${ownerId}/${block.id ?? ''}: event-only ${stray.length > 1 ? 'helpers' : 'helper'} (${[...new Set(stray)].join(', ')}) in an always script`);
    lines.unshift(EVENT_ONLY_WARNING);
  }
  return {
    id: block.id || ownerId,
    ...(block.label ? { label: block.label } : {}),
    events: [event],
    source: lines.join('\n'),
    enabled: true,
    priority: 0,
  };
}
