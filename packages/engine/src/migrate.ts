/**
 * Converts rules written in the v1 format (kind-based conditions/effects, `source`, `resources.per`) to v2
 * (selectors + verbs + envelope). Idempotent: v2 input is returned unchanged.
 */
import type { Condition, Duration, Effect } from './schema';

type Any = Record<string, unknown>;
const isObj = (x: unknown): x is Any => !!x && typeof x === 'object' && !Array.isArray(x);

export function isV1Ability(a: unknown): boolean {
  if (!isObj(a)) return false;
  if ('source' in a && !('origin' in a)) return true;
  if (a.activation === 'toggle') return true;
  const effects = a.effects as Any[] | undefined;
  return !!effects?.some((b) => isObj(b) && ((Array.isArray(b.do) && b.do.some((e) => isObj(e) && 'kind' in e)) || (isObj(b.when) && 'kind' in b.when)));
}

export function convertDuration(d: unknown): Duration | undefined {
  if (d === undefined || d === null) return undefined;
  if (d === 'endOfNextTurn') return 'untilMyNextTurn';
  return d as Duration;
}

export function convertCondition(c: unknown): Condition {
  if (!isObj(c)) return { all: [] };
  if (!('kind' in c)) return c as Condition; // already v2
  const k = c.kind as string;
  const of = (c.of as unknown[]) ?? [];
  switch (k) {
    case 'always': return { all: [] };
    case 'all': return { all: of.map(convertCondition) };
    case 'any': return { any: of.map(convertCondition) };
    case 'not': return { not: convertCondition(c.of) };
    case 'target.hasTag': return { is: `target.tag.${c.tag}` };
    case 'target.tagIn': return { in: 'target.tags', set: c.tags as string[] };
    case 'target.sizeAtLeast': return { compare: 'target.size', op: '>=', value: c.size as string };
    case 'target.hurtAtMost': return { compare: 'target.hurt', op: '>=', value: c.hurt as string };
    case 'target.hasCondition': return { is: `target.condition.${c.condition}` };
    case 'self.hasBuff': return { is: `self.ability.${c.abilityId}.active` };
    case 'self.hasCondition': return { is: `self.tag.${c.condition}` };
    case 'self.abilityEnabled': return { is: `self.ability.${c.abilityId}.enabled` };
    case 'attack.kind': return { compare: 'attack.kind', op: '=', value: c.attackKind as string };
    case 'attack.withinFeet': return { compare: 'target.distance', op: '<=', value: c.feet as number };
    case 'attack.isFirstThisRound': return { is: 'attack.isFirstThisRound' };
    case 'attack.index': return { compare: 'attack.index', op: '=', value: c.index as number };
    case 'log': return {
      history: { event: c.event === 'use' ? 'used' : (c.event as 'hit' | 'miss' | 'crit'), by: 'me', vs: (c.target as 'current' | 'any') ?? 'current', scope: c.scope as 'thisRound', ...(c.abilityId ? { abilityId: c.abilityId as string } : {}) },
      op: '>=', value: (c.min as number) ?? 1,
    };
    case 'used': {
      const scope = ({ round: 'thisRound', encounter: 'encounter', day: 'day' } as const)[c.scope as 'round' | 'encounter' | 'day'];
      return {
        history: { event: 'used', by: 'me', vs: c.perTagCategory ? 'sameCategory' : 'any', scope, abilityId: c.abilityId as string, ...(c.perTagCategory ? { category: c.perTagCategory as string } : {}) },
        op: '>=', value: 1,
      };
    }
    case 'resource': return { compare: `self.resource.${c.id}.left`, op: '>=', value: c.remainingAtLeast as number };
    case 'toggle': return { is: `battle.toggle.${c.id}` };
    case 'prompt': return c.atLeast !== undefined ? { compare: `battle.prompt.${c.id}`, op: '>=', value: c.atLeast as number } : { exists: `battle.prompt.${c.id}` };
    case 'round': {
      const parts: Condition[] = [];
      if (c.atLeast !== undefined) parts.push({ compare: 'battle.round', op: '>=', value: c.atLeast as number });
      if (c.atMost !== undefined) parts.push({ compare: 'battle.round', op: '<=', value: c.atMost as number });
      return parts.length === 1 ? parts[0]! : { all: parts };
    }
    case 'param': return { in: 'target.tags', param: c.name as string };
    default: throw new Error(`Unknown v1 condition kind "${k}"`);
  }
}

export function convertEffect(e: unknown): Effect {
  if (!isObj(e)) throw new Error('bad effect');
  if ('verb' in e) return e as Effect;
  const k = e.kind as string;
  switch (k) {
    case 'bonus': return { verb: 'modify', to: e.to as string, value: e.value as number | string, type: (e.bonusType as never) ?? 'untyped', mode: 'add', ...(e.attackKind ? { attackKind: e.attackKind as 'ranged' } : {}) };
    case 'bonusFromTable': return { verb: 'modify', to: e.to as string, value: { prompt: e.promptId as string, ...(e.perTagCategory ? { per: e.perTagCategory as string } : {}), table: e.table as { upTo?: number; value: number }[] }, type: (e.bonusType as never) ?? 'untyped', mode: 'add', ...(e.attackKind ? { attackKind: e.attackKind as 'ranged' } : {}) };
    case 'extraDice': return { verb: 'dice', dice: e.dice as string, ...(e.damageType ? { damageType: e.damageType as string } : {}), ...(e.label ? { label: e.label as string } : {}), ...(e.attackKind ? { attackKind: e.attackKind as 'ranged' } : {}) };
    case 'ignoreConcealment': return { verb: 'flag', flag: 'ignoreConcealment', value: true };
    case 'applyTag': return { verb: 'tag', to: e.to as 'self' | 'target', tag: e.tag as string, duration: convertDuration(e.duration) ?? 'untilRemoved' };
    case 'consume': return { verb: 'resource', id: e.resourceId as string, op: 'consume', amount: (e.amount as number) ?? 1 };
    case 'note': return { verb: 'note', text: e.text as string };
    case 'suppress': return { verb: 'suppress', ability: e.abilityId as string };
    case 'revealTarget': return { verb: 'reveal' };
    case 'attackMode': return { verb: 'attack', mode: { id: e.modeId as string, label: e.label as string, base: e.base as 'full', ...(e.note ? { note: e.note as string } : {}) }, extraAttacks: (e.extraAttacksAtTop as number) ?? 0, penaltyAll: (e.penalty as number) ?? 0, ...(e.attackKind ? { attackKind: e.attackKind as 'ranged' } : {}) };
    case 'extraAttack': return { verb: 'attack', extraAttacks: (e.count as number) ?? 1, penaltyAll: 0, appliesToBase: (e.appliesToBase as 'full') ?? 'full', ...(e.attackKind ? { attackKind: e.attackKind as 'ranged' } : {}) };
    case 'extraSlot': return { verb: 'slot', slot: e.slot as never, count: (e.count as number) ?? 1 };
    default: throw new Error(`Unknown v1 effect kind "${k}"`);
  }
}

const ORIGIN: Record<string, string> = { feat: 'feat', item: 'item', class: 'classFeature', spell: 'spell', buff: 'buff', memory: 'memory', situational: 'situational', condition: 'condition', core: 'core' };

/** Convert a whole ability; v2 input is returned as-is. */
export function convertV1(a: unknown): Any {
  if (!isObj(a)) throw new Error('bad ability');
  if (!isV1Ability(a)) return a;
  const out: Any = { ...a };
  if ('source' in out) { out.origin = ORIGIN[out.source as string] ?? out.source; delete out.source; }
  if (isObj(out.activation) && 'action' in out.activation) out.activation = { action: out.activation.action === 'full' ? 'fullRound' : out.activation.action };
  if (out.activation === 'toggle') { out.activation = { action: 'free' }; if (out.duration === undefined) out.duration = 'endOfRound'; }
  if (out.duration !== undefined) out.duration = convertDuration(out.duration);
  if (Array.isArray(out.resources)) out.resources = out.resources.map((r) => { const rr = { ...(r as Any) }; if ('per' in rr) { rr.resetOn = rr.per; delete rr.per; } return rr; });
  if (Array.isArray(out.effects)) out.effects = out.effects.map((b) => { const bb = { ...(b as Any) }; if (bb.when !== undefined) bb.when = convertCondition(bb.when); if (Array.isArray(bb.do)) bb.do = bb.do.map(convertEffect); return bb; });
  return out;
}

/** Convert every ability in a pack-like object (packs, library exports, backups). */
export function convertPackV1<T extends { abilities?: unknown[] }>(pack: T): T {
  if (!Array.isArray(pack.abilities)) return pack;
  return { ...pack, abilities: pack.abilities.map(convertV1) };
}

// ---------- v2 → v3 ----------
type Kind = 'feature' | 'item' | 'spell' | 'status';
const KIND_OF_ORIGIN: Record<string, Kind> = { feat: 'feature', classFeature: 'feature', race: 'feature', memory: 'feature', core: 'feature', monster: 'feature', item: 'item', spell: 'spell', buff: 'status', condition: 'status', situational: 'status' };
const RESET_V3: Record<string, string> = { rest: 'day', manual: 'never' };
const ON_USE_TRIGGERS = new Set(['onUse', 'onActivate']);
const V3_TRIGGERS = new Set(['always', 'onHit', 'onMiss', 'onCrit', 'onDamaged', 'onRoundStart', 'onRoundEnd']);

export function isV2Ability(a: unknown): boolean {
  return isObj(a) && 'origin' in a && !('kind' in a);
}

export function convertDurationV3(d: unknown): Duration | undefined {
  if (d === undefined || d === null || d === 'instant') return undefined;
  if (d === 'endOfRound' || d === 'endOfNextTurn') return 'untilMyNextTurn';
  if (d === 'whileActive' || d === 'concentration') return 'untilRemoved';
  return d as Duration;
}

/** Remove `is battle.toggle.<id>` leaves (a converted declare ability is simply active while declared). */
export function stripToggle(c: unknown, id: string): unknown {
  if (!isObj(c)) return c;
  const sel = `battle.toggle.${id}`;
  if (c.is === sel) return { all: [] };
  for (const k of ['all', 'any', 'none', 'count'] as const) {
    if (Array.isArray(c[k])) return { ...c, [k]: (c[k] as unknown[]).filter((x) => !(isObj(x) && x.is === sel)).map((x) => stripToggle(x, id)) };
  }
  if ('not' in c) return { ...c, not: stripToggle(c.not, id) };
  return c;
}

function convertBlockV3(b: Any): Any {
  const list = Array.isArray(b.do) ? (b.do as Any[]) : [];
  const out = list.map((e) => {
    const x = { ...e };
    if (x.verb === 'tag') x.duration = convertDurationV3(x.duration) ?? 'untilRemoved';
    if (x.verb === 'grant' && 'duration' in x) { const d = convertDurationV3(x.duration); if (d === undefined) delete x.duration; else x.duration = d; }
    return x;
  });
  return { ...b, do: out };
}

function chargesOf(r: Any): Any {
  return { max: r.max, resetOn: RESET_V3[r.resetOn as string] ?? r.resetOn ?? 'day', ...(r.label ? { label: r.label } : {}) };
}

/** Convert a v2 ability (origin-based envelope) to a v3 record. v3 input is returned as-is. `lookup` resolves sibling ids for `grants`. */
export function convertV2(a: unknown, lookup: (id: string) => Any | undefined = () => undefined): Any {
  if (!isObj(a) || !isV2Ability(a)) return a as Any;
  const kind = KIND_OF_ORIGIN[a.origin as string] ?? 'feature';
  const id = a.id as string;
  const blocks = (Array.isArray(a.effects) ? (a.effects as Any[]) : []).map(convertBlockV3);
  const bindCond = a.binding === 'thisWeapon' ? { compare: 'attack.weapon.id', op: '=', value: id }
    : isObj(a.binding) && 'slot' in a.binding ? { compare: `self.equipped.slot.${a.binding.slot as string}`, op: '>=', value: 1 } : undefined;
  const withBind = (b: Any): Any => {
    if (!bindCond) return b;
    const w = b.when;
    const inner = isObj(w) && Array.isArray(w.all) ? (w.all as unknown[]) : w ? [w] : [];
    return { ...b, when: { all: [bindCond, ...inner] } };
  };
  const isDeclare = a.activation === 'declare';
  const isReaction = isObj(a.activation) && 'reaction' in a.activation;
  const reactionTrigger = isReaction ? (a.activation as Any).reaction : undefined;
  let passive = blocks.filter((b) => !ON_USE_TRIGGERS.has((b.trigger as string) ?? 'always') && b.trigger !== 'onDeactivate').map(withBind).map((b) => ({ ...b, when: isDeclare ? stripToggle(b.when, id) : b.when }));
  // A reaction ability is passive in v3: its passive blocks fire on the reaction's trigger instead of always.
  if (isReaction && V3_TRIGGERS.has(reactionTrigger as string)) {
    passive = passive.map((b) => (((b.trigger as string) ?? 'always') === 'always' ? { ...b, trigger: reactionTrigger } : b));
  }
  const onUse = blocks.filter((b) => ON_USE_TRIGGERS.has(b.trigger as string)).map((b) => { const { trigger: _t, ...rest } = b; return rest; });
  const base: Any = { id, name: a.name, kind, ...(a.text !== undefined ? { text: a.text } : {}), ...(a.sourceRef !== undefined ? { sourceRef: a.sourceRef } : {}), ...(a.todo !== undefined ? { todo: a.todo } : {}) };
  const duration = convertDurationV3(a.duration);

  if (kind === 'status') return { ...base, harmful: a.origin === 'condition', ...(duration ? { duration } : {}), effects: passive };
  if (kind === 'spell') {
    const castingAction = isObj(a.activation) && 'action' in a.activation ? a.activation.action : 'standard';
    return { ...base, castingAction, ...(duration ? { duration } : {}), effects: passive };
  }

  const resources = (Array.isArray(a.resources) ? (a.resources as Any[]) : []);
  const cost = (Array.isArray(a.cost) ? (a.cost as Any[]) : []);
  const isActive = a.activation !== undefined && a.activation !== 'passive' && !isReaction;
  const activations: Any[] = [];
  const pools: Any[] = resources.map((r) => ({ id: r.id, ...(r.label ? { label: r.label } : {}), max: r.max, resetOn: RESET_V3[r.resetOn as string] ?? r.resetOn ?? 'day' }));

  if (isActive || resources.length || cost.length || onUse.length) {
    const own = resources[0];
    const chargeCost = cost.find((c) => c.kind === 'charge');
    const usesOwn = !!own && (!chargeCost || chargeCost.resourceId === own.id);
    const action = isDeclare ? 'free' : isObj(a.activation) && 'action' in a.activation ? a.activation.action : 'standard';
    const act: Any = {
      id: usesOwn ? (own!.id as string) : id,
      ...(action !== 'standard' ? { action } : {}),
      ...(usesOwn ? { charges: chargesOf(own!) } : {}),
      cost: cost.filter((c) => !(usesOwn && c.kind === 'charge' && c.resourceId === own!.id)),
      ...(isDeclare ? { duration: duration ?? 'thisAttack' } : duration ? { duration } : {}),
      onUse,
      whileActive: [],
    };
    if (usesOwn) pools.shift();
    // An active ability with a duration applied its passive blocks only while active.
    if (isActive && act.duration) { act.whileActive = passive; passive = []; }
    activations.push(act);
  }

  for (const g of (Array.isArray(a.grants) ? (a.grants as string[]) : [])) {
    const t = lookup(g);
    if (!t) continue;
    const r0 = Array.isArray(t.resources) ? (t.resources as Any[])[0] : undefined;
    const taction = isObj(t.activation) && 'action' in t.activation ? t.activation.action : 'standard';
    activations.push({ id: g, name: t.name, ...(taction !== 'standard' ? { action: taction } : {}), ...(r0 ? { charges: chargesOf(r0) } : {}), cost: [], ...(t.origin === 'spell' ? { spell: g } : {}), onUse: [], whileActive: [] });
  }

  if (kind === 'item') return { ...base, item: isObj(a.item) ? a.item : { category: 'gear', tags: [] }, effects: passive, activations, pools };
  const acquired = a.origin === 'classFeature'
    ? { kind: 'class', ...(a.classId ? { classId: a.classId } : {}), ...(a.classLevel !== undefined ? { level: a.classLevel } : {}) }
    : a.origin === 'race' ? { kind: 'race' } : a.origin === 'memory' || a.origin === 'core' ? { kind: 'dm' } : { kind: 'feat' };
  return { ...base, acquired, ...(isObj(a.params) ? { params: a.params } : {}), enabledByDefault: a.enabledByDefault ?? true, effects: passive, activations, pools };
}

/** v1 or v2 → v3. Idempotent. */
export function convertToV3(a: unknown, lookup?: (id: string) => Any | undefined): Any {
  return convertV2(convertV1(a), lookup ? (id) => { const x = lookup(id); return x ? convertV1(x) : undefined; } : undefined);
}

/** Convert every ability of a pack-like object (packs, library exports, backups); other fields untouched. */
export function convertPack(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.abilities)) return raw;
  const v2 = (raw.abilities as unknown[]).map((a) => convertV1(a));
  const byId = new Map(v2.filter(isObj).map((a) => [a.id as string, a] as const));
  return { ...raw, abilities: v2.map((a) => convertV2(a, (id) => byId.get(id))) };
}

/** Stored battles: `situational` → `statuses`; buffs on records with activations get the first activation's id. */
export function convertBattle(raw: unknown, lookup: (id: string) => { kind: string; activations?: { id: string }[] } | undefined = () => undefined): unknown {
  if (!isObj(raw)) return raw;
  const out: Any = { ...raw };
  if (Array.isArray(out.situational)) {
    out.statuses = [...((out.statuses as unknown[]) ?? []), ...(out.situational as unknown[]).map((s) => { const r = convertToV3(s); return r.kind === 'status' ? r : { id: r.id, name: r.name, kind: 'status', effects: r.effects ?? [] }; })];
    delete out.situational;
  }
  if (Array.isArray(out.activeBuffs)) {
    out.activeBuffs = (out.activeBuffs as Any[]).map((b) => {
      if (!isObj(b) || b.activationId) return b;
      const rec = lookup(b.abilityId as string);
      const first = rec?.activations?.[0];
      return first && rec.kind !== 'status' ? { ...b, activationId: first.id } : b;
    });
  }
  return out;
}
