import { HURT_ORDER, SIZE_ORDER, abilityMod, targetTags, targetTagsInCategory, type AbilityInstance, type EvalContext } from '../context';
import { evalExpr } from '../expr';
import { countHistory } from '../history';
import { BonusTypeSchema, SlotIdSchema, StatIdSchema, type Ability, type Activation, type AttackKind, type BonusType, type Duration, type HistoryFilter, type Script, type ScriptEvent, type SlotId, type StatId, type VarValue } from '../schema';
import { readSelector } from '../selectors';
import { exprVars } from '../vars';
import { resolveStatVia } from './registry';
import type { Sink } from './sink';
import { BONUS, DAY, ENCOUNTER, HOUR, HURT, MINUTE, ROUND, SECOND, SIZE, STAT, THIS_ATTACK, UNTIL_MY_NEXT_TURN, UNTIL_REMOVED, toRounds } from './units';

export type EventInfo = { kind: ScriptEvent; result?: 'hit' | 'miss' | 'crit'; damage?: number; targetId?: string; abilityId?: string; activationId?: string; payload?: unknown };

/** A state change queued by an event script; `applyPatches` turns these into a new battle/character. */
export type Patch =
  | { k: 'tag'; to: 'self' | 'target' | 'allEnemies'; tag: string; duration: Duration }
  | { k: 'untag'; to: 'self' | 'target'; tag: string }
  | { k: 'resource'; id: string; op: 'consume' | 'restore' | 'set'; amount: number }
  | { k: 'grant'; abilityId: string; duration?: Duration }
  | { k: 'suppress'; abilityId: string }
  | { k: 'hp'; op: 'damage' | 'heal' | 'temp'; amount: number }
  | { k: 'reveal' }
  | { k: 'setVar'; name: string; value: number | string | boolean }
  | { k: 'log'; text: string }
  | { k: 'emit'; name: string; payload?: unknown };

/** Last predicate a script evaluated, and whether the script emitted anything: together they give the "needs …" reason. */
export type Trace = { last?: { text: string; result: boolean }; emitted: boolean };
export type RunSource = { ability: Ability; instance: AbilityInstance | undefined; activation?: Activation; label: string };
export type RunContext = {
  phase: 'always' | 'event';
  source: RunSource;
  script: Script;
  event?: EventInfo;
  args?: Record<string, unknown>;
  fns?: Record<string, (args: Record<string, unknown>) => void>;
  /** Eligibility probe (`availableActions`): pretend the source's activation is running, so `active` is non-null. */
  probeActive?: boolean;
  /** A throwaway run (preview, eligibility probe): errors stay in the sink, out of diagnostics and the quarantine count. */
  probe?: boolean;
};

/** Thrown by `need()`: not an error, the script simply does not apply and says why. */
export class ScriptSkip {
  because: string;
  constructor(because: string) {
    this.because = because;
  }
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const readOnly = (k: string | symbol) => new Error(`${String(k)} is read-only: use a helper (bonus, setVar, heal…) to change values`);
/**
 * Frozen *and* set-trapped: freezing alone only throws in strict mode and only says "has only a getter",
 * so every façade object refuses writes with a message that names the helpers instead.
 */
const freeze = <T extends object>(o: T): T => new Proxy(Object.freeze(o), { set: (_t, k) => { throw readOnly(k); } }) as T;
/** `event` is shared by every script that runs for the same event: freeze it (and its payload) so one script cannot change what the next one reads. */
const freezeEvent = (e: EventInfo): EventInfo => {
  if (e.payload && typeof e.payload === 'object') Object.freeze(e.payload);
  return freeze(e);
};
const proxy = <T>(get: (k: string) => T, set?: (k: string, v: T) => void): Record<string, T> =>
  new Proxy(Object.freeze({}), {
    get: (_, k) => (typeof k === 'string' ? get(k) : undefined),
    set: (_t, k, v) => { if (!set || typeof k !== 'string') throw readOnly(k); set(k, v as T); return true; },
  }) as Record<string, T>;

export function makeApi(ctx: EvalContext, run: RunContext, sink: Sink, patches: Patch[], trace: Trace) {
  const always = run.phase === 'always';
  const src = run.source;
  const sourceId = src.ability.id;
  const onlyAlways = (name: string) => { if (!always) throw new Error(`${name}() works only in always scripts`); };
  const onlyEvent = (name: string) => { if (always) throw new Error(`${name}() works only in event scripts`); };
  const tagLabel = (t: string) => ctx.library.tags[t]?.label ?? t;
  const pred = (text: string, result: boolean) => { trace.last = { text, result }; return result; };
  const sel = (s: string) => readSelector(ctx, s);
  const stat = (id: string) => { StatIdSchema.parse(id); return resolveStatVia(ctx, id).total; };
  const t = ctx.target;
  const ttags = t ? targetTags(t) : [];

  const player = freeze({
    get level() { return sel('self.level') as number; },
    get bab() { return sel('self.bab') as number; },
    get size() { return SIZE_ORDER.indexOf(ctx.character.size); },
    hp: freeze({
      get current() { return ctx.character.hp.current; },
      get max() { return stat('hp.max'); },
      get temp() { return ctx.character.hp.temp; },
      get nonlethal() { return ctx.character.hp.nonlethal; },
    }),
    stats: proxy((k) => (ABILITY_KEYS.includes(k as 'str') ? stat(`ability.${k}`) : stat(k))),
    mod: proxy((k) => abilityMod(stat(`ability.${k}`))),
    skills: proxy((id) => freeze({
      get ranks() { return sel(`self.skill.${id}.ranks`) as number; },
      get total() { return sel(`self.skill.${id}.total`) as number; },
      get classSkill() { return !!sel(`self.skill.${id}.classSkill`); },
    })),
    classes: proxy((id) => (sel(`self.class.${id}.level`) as number) ?? 0),
    get tags() { return ctx.battle?.selfConditions.map((c) => c.tag) ?? []; },
    is: (tag: string | string[]) => pred(`you are ${[tag].flat().map(tagLabel).join(' / ')}`, [tag].flat().some((x) => !!sel(`self.tag.${x}`))),
    has: (id: string) => pred(`${ctx.library.abilities[id]?.name ?? id} on sheet`, !!sel(`self.ability.${id}.enabled`)),
    active: (id: string) => activeInfo(ctx, id),
    left: (poolId: string) => (sel(`self.resource.${poolId}.left`) as number) ?? 0,
    wearing: (itemId: string) => pred(`${ctx.library.abilities[itemId]?.name ?? itemId} equipped`, !!sel(`self.equipped.item.${itemId}`)),
    equipped: freeze({
      slot: proxy((k) => (sel(`self.equipped.slot.${k}`) as number) ?? 0),
      category: proxy((k) => (sel(`self.equipped.category.${k}`) as number) ?? 0),
      tag: proxy((k) => (sel(`self.equipped.count.tag.${k}`) as number) ?? 0),
    }),
    params: proxy((k) => [...(src.instance?.paramValues[k] ?? [])]),
    paramsOf: (recordId: string) => proxy((k) => [...(ctx.character.abilities.find((a) => a.abilityId === recordId)?.paramValues[k] ?? [])]),
    get lastDamage() { return run.event?.damage ?? ctx.lastDamage ?? 0; },
  });

  const target = freeze({
    get exists() { return !!t; },
    get name() { return t?.name ?? ''; },
    get type() { return t ? targetTagsInCategory(ctx, t, 'creatureType')[0] : undefined; },
    get size() { return t ? SIZE_ORDER.indexOf(t.size) : -1; },
    get hurt() { return t ? HURT_ORDER.indexOf(t.hurt) : -1; },
    get distance() { return t?.distanceFeet; },
    get revealed() { return !!t?.revealed; },
    get dead() { return !!t?.dead; },
    get tags() { return [...ttags]; },
    is: (tag: string | string[]) => pred(`target is ${[tag].flat().map(tagLabel).join(' / ')}`, [tag].flat().some((x) => ttags.includes(x))),
    isOneOf: (tags: readonly string[]) => pred('target type is one of your chosen types', tags.some((x) => ttags.includes(x))),
    within: (ft: number) => pred(`target within ${ft} ft`, t?.distanceFeet !== undefined && t.distanceFeet <= ft),
    mark: (tag: string, duration: Duration = UNTIL_REMOVED) => { onlyEvent('target.mark'); patches.push({ k: 'tag', to: 'target', tag, duration }); },
    unmark: (tag: string) => { onlyEvent('target.unmark'); patches.push({ k: 'untag', to: 'target', tag }); },
    reveal: () => { onlyEvent('target.reveal'); patches.push({ k: 'reveal' }); },
  });

  const a = ctx.attack;
  const attack = freeze({
    get exists() { return !!a; },
    get kind() { return a?.kind; },
    get index() { return a?.index ?? 0; },
    get mode() { return a?.modeId; },
    get isRanged() { return pred('ranged attack', a?.kind === 'ranged'); },
    get isMelee() { return pred('melee attack', a?.kind === 'melee'); },
    get isFirstThisRound() { return pred('first attack this round', !!sel('attack.isFirstThisRound')); },
    weapon: freeze({
      get id() { return a?.weaponAbilityId; },
      get category() { return sel('attack.weapon.category') as string | undefined; },
      get tags() { return [...((sel('attack.weapon.tags') as string[] | undefined) ?? [])]; },
      is: (tag: string) => pred(`weapon is ${tagLabel(tag)}`, !!sel(`attack.weapon.tag.${tag}`)),
    }),
  });

  const battle = freeze({
    get exists() { return !!ctx.battle; },
    get round() { return ctx.battle?.round ?? 1; },
    get elapsed() { return ((ctx.battle?.round ?? 1) - 1) * ROUND; },
    get tags() { return [...(ctx.battle?.tags ?? [])]; },
    on: (id: string) => pred(`"${id}" switched on`, !!ctx.battle?.toggles[id]),
    is: (tag: string) => pred(`battle is ${tagLabel(tag)}`, !!ctx.battle?.tags.includes(tag)),
    toggles: proxy((k) => !!ctx.battle?.toggles[k]),
    prompts: proxy((k) => sel(`battle.prompt.${k}`)),
  });

  const vars = proxy<VarValue | undefined>(
    (k) => ctx.character.vars[k] ?? ctx.library.globals?.[k],
    (name, value) => {
      if (always) throw new Error('vars are read-only in always scripts: assign them with setVar(name, value) in an event script');
      if (value === undefined || (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean')) throw new Error(`vars hold a number, text or true/false; "${name}" got ${typeof value}`);
      patches.push({ k: 'setVar', name, value });
    },
  );
  const flags = proxy((k) => !!sink.flags[k]);
  const params = player.params;
  const activeOwn = run.probeActive ? { round: 1, elapsed: 0, remaining: null } : src.activation ? activeInfo(ctx, src.activation.id) : null;

  const emitted = () => { trace.emitted = true; };
  const asStat = (s: string): StatId => { const r = StatIdSchema.safeParse(s); if (!r.success) throw new Error(`unknown stat "${s}"`); return r.data; };
  const asType = (x: string): BonusType => { const r = BonusTypeSchema.safeParse(x); if (!r.success) throw new Error(`unknown bonus type "${x}"`); return r.data; };
  const asSlot = (s: string): SlotId => { const r = SlotIdSchema.safeParse(s); if (!r.success) throw new Error(`unknown slot "${s}"`); return r.data; };
  const label = (as?: string) => as ?? run.script.label ?? src.label;

  const bonus = (s: string | string[], value: number, type = 'untyped', opts: { as?: string } = {}) => {
    onlyAlways('bonus');
    const bonusType = asType(type);
    for (const x of [s].flat()) if (value) { emitted(); sink.bonuses.push({ stat: asStat(x), value, bonusType, source: sourceId, label: label(opts.as) }); }
  };

  const api = {
    player, self: player, target, attack, battle, vars, flags, params,
    active: activeOwn, event: run.event ? freezeEvent(run.event) : null, args: run.args ?? {}, fn: run.fns ?? {},
    sel,
    has: (who: { is: (x: string | string[]) => boolean }, tag: string | string[]) => who.is(tag),
    nameOf: (id: string) => ctx.library.abilities[id]?.name ?? id,

    // ---------- compute helpers (always scripts) ----------
    bonus,
    penalty: (s: string | string[], value: number, type = 'untyped', opts: { as?: string } = {}) => bonus(s, -Math.abs(value), type, opts),
    setStat: (s: string, value: number) => { onlyAlways('setStat'); emitted(); sink.sets.push({ stat: asStat(s), value, source: sourceId }); },
    scale: (s: string, factor: number) => { onlyAlways('scale'); emitted(); sink.multipliers.push({ stat: asStat(s), factor, source: sourceId }); },
    dice: (spec: string, damageType?: string, opts: { as?: string } = {}) => {
      onlyAlways('dice');
      if (!/^\d+d\d+$/.test(spec)) throw new Error(`bad dice "${spec}"`);
      emitted();
      sink.dice.push({ dice: spec, label: label(opts.as), ...(damageType ? { damageType } : {}) });
    },
    flag: (name: string, value = true) => { onlyAlways('flag'); emitted(); sink.flags[name] = value; },
    note: (text: string) => { onlyAlways('note'); emitted(); sink.notes.push({ text, source: sourceId, sourceName: src.label }); },
    slot: (s: string, count = 1) => { onlyAlways('slot'); emitted(); const id = asSlot(s); sink.slots[id] = (sink.slots[id] ?? 0) + count; },
    attackMode: (m: { id: string; label: string; base: 'single' | 'full'; extra?: number; penalty?: number; kind?: AttackKind; note?: string }) => {
      onlyAlways('attackMode');
      emitted();
      sink.modes.push({ modeId: m.id, label: m.label, base: m.base, extraAttacksAtTop: m.extra ?? 0, penalty: m.penalty ?? 0, source: sourceId, ...(m.kind ? { kind: m.kind } : {}), ...(m.note ? { note: m.note } : {}) });
    },
    extraAttack: (n = 1, opts: { base?: 'single' | 'full' | 'any'; kind?: AttackKind } = {}) => {
      onlyAlways('extraAttack');
      emitted();
      sink.extraAttacks.push({ n, base: opts.base ?? 'full', ...(opts.kind ? { kind: opts.kind } : {}), source: sourceId });
    },
    naturalAttack: (n: { name: string; dice: string; count?: number; attackBonus?: number }) => {
      onlyAlways('naturalAttack');
      emitted();
      sink.naturals.push({ name: n.name, dice: n.dice, count: n.count ?? 1, attackBonus: n.attackBonus ?? 0, source: sourceId, sourceName: src.label });
    },
    /** The entered result of a check (Knowledge…), or 0 plus a prompt chip asking for it. */
    ask: (promptId: string, opts: { per?: string; label?: string } = {}) => {
      onlyAlways('ask');
      const key = opts.per && t ? targetTagsInCategory(ctx, t, opts.per)[0] : undefined;
      const stored = opts.per ? (key ? ctx.battle?.prompts[`${promptId}:${key}`] : undefined) : ctx.battle?.prompts[promptId];
      if (stored !== undefined) return stored;
      if (!sink.prompts.some((p) => p.promptId === promptId && p.source === sourceId)) {
        sink.prompts.push({ promptId, ...(opts.per ? { perTagCategory: opts.per } : {}), ...(key ? { tag: key } : {}), source: sourceId, sourceName: src.label });
      }
      return 0;
    },
    /** First row whose threshold the value does not exceed: `tier(check, [15, 1], [25, 2], [Infinity, 5])`. */
    tier: (value: number, ...rows: [number, number][]) => {
      for (const [upTo, r] of rows) if (value <= upTo) return r;
      return rows.at(-1)?.[1] ?? 0;
    },
    history: (event: HistoryFilter['event'], opts: { by?: HistoryFilter['by']; vs?: HistoryFilter['vs']; since?: HistoryFilter['scope']; ability?: string; category?: string } = {}) =>
      countHistory(ctx, { event, by: opts.by ?? 'me', vs: opts.vs ?? 'current', scope: opts.since ?? 'round', ...(opts.ability ? { abilityId: opts.ability } : {}), ...(opts.category ? { category: opts.category } : {}) }),

    // ---------- event helpers (event scripts) ----------
    condition: (who: 'self' | 'target' | 'allEnemies', tag: string, duration: Duration = UNTIL_REMOVED) => { onlyEvent('condition'); patches.push({ k: 'tag', to: who, tag, duration }); },
    grant: (abilityId: string, duration?: Duration) => { onlyEvent('grant'); patches.push({ k: 'grant', abilityId, ...(duration !== undefined ? { duration } : {}) }); },
    suppress: (abilityId: string) => { onlyEvent('suppress'); patches.push({ k: 'suppress', abilityId }); },
    charges: (id: string) => ({
      get left() { return (sel(`self.resource.${id}.left`) as number) ?? 0; },
      use: (n = 1) => { onlyEvent('charges.use'); patches.push({ k: 'resource', id, op: 'consume', amount: n }); },
      restore: (n = 1) => { onlyEvent('charges.restore'); patches.push({ k: 'resource', id, op: 'restore', amount: n }); },
      set: (n: number) => { onlyEvent('charges.set'); patches.push({ k: 'resource', id, op: 'set', amount: n }); },
    }),
    heal: (n: number) => { onlyEvent('heal'); patches.push({ k: 'hp', op: 'heal', amount: n }); },
    hurt: (n: number) => { onlyEvent('hurt'); patches.push({ k: 'hp', op: 'damage', amount: n }); },
    temp: (n: number) => { onlyEvent('temp'); patches.push({ k: 'hp', op: 'temp', amount: n }); },
    reveal: () => target.reveal(),
    setVar: (name: string, value: number | string | boolean) => { onlyEvent('setVar'); patches.push({ k: 'setVar', name, value }); },
    log: (text: string) => { onlyEvent('log'); patches.push({ k: 'log', text }); },
    emit: (name: string, payload?: unknown) => { onlyEvent('emit'); patches.push({ k: 'emit', name, payload }); },

    // ---------- control, units, math ----------
    need: (cond: unknown, because = trace.last && !trace.last.result ? trace.last.text : 'a condition') => { if (!cond) throw new ScriptSkip(because); },
    SECOND, ROUND, MINUTE, HOUR, DAY, THIS_ATTACK, UNTIL_MY_NEXT_TURN, ENCOUNTER, UNTIL_REMOVED, SIZE, HURT, BONUS, STAT,
    mod: abilityMod, floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, min: Math.min, max: Math.max,
    clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
    toRounds,
    evalExpr: (e: string) => evalExpr(e, exprVars(ctx)),
  };
  return freeze(api);
}

export type ScriptApi = ReturnType<typeof makeApi>;

/** Every name the preamble destructures out of the api object. Keep in step with `makeApi`. */
export const API_NAMES = [
  'player', 'self', 'target', 'attack', 'battle', 'vars', 'flags', 'params', 'active', 'event', 'args', 'fn',
  'sel', 'has', 'nameOf',
  'bonus', 'penalty', 'setStat', 'scale', 'dice', 'flag', 'note', 'slot', 'attackMode', 'extraAttack', 'naturalAttack', 'ask', 'tier', 'history',
  'condition', 'grant', 'suppress', 'charges', 'heal', 'hurt', 'temp', 'reveal', 'setVar', 'log', 'emit',
  'need', 'SECOND', 'ROUND', 'MINUTE', 'HOUR', 'DAY', 'THIS_ATTACK', 'UNTIL_MY_NEXT_TURN', 'ENCOUNTER', 'UNTIL_REMOVED', 'SIZE', 'HURT', 'BONUS', 'STAT',
  'mod', 'floor', 'ceil', 'round', 'abs', 'min', 'max', 'clamp', 'toRounds', 'evalExpr',
] as const;

/** nth round active, seconds elapsed, seconds remaining for a running status/activation; null when not active. */
export function activeInfo(ctx: EvalContext, id: string): { round: number; elapsed: number; remaining: number | null } | null {
  const b = ctx.battle?.activeBuffs.find((x) => (x.abilityId === id || x.activationId === id) && x.owner === 'self' && !x.suppressed);
  if (!b) return null;
  const round = Math.max(1, ctx.battle!.round - (b.appliedRound ?? ctx.battle!.round) + 1);
  return { round, elapsed: (round - 1) * ROUND, remaining: b.remainingRounds !== undefined ? b.remainingRounds * ROUND : null };
}
