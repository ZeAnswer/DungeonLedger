import type { EvalContext, Library } from './context';
import { findResourceDef, promptKey } from './context';
import { evalExpr } from './expr';
import { newId } from './ids';
import { changeResource } from './resources';
import { activationsOf, type Activation, type Battle, type BonusType, type Character, type Combatant, type Duration, type LogEvent, type Monster, type ScriptEvent, type Size, type StatId, type Status, type VarValue } from './schema';
import { applyPatches, runEventScripts, type State } from './scripts/events';
import { toRounds } from './scripts/units';
import { exprVars } from './vars';

export type { State };

type Conditioned = { tag: string; expires?: Duration; appliedRound?: number; source?: string };

function nextSeq(battle: Battle): number {
  return (battle.log.at(-1)?.seq ?? 0) + 1;
}

function appendEvent(battle: Battle, e: Omit<LogEvent, 'id' | 'round' | 'seq'>): { battle: Battle; id: string } {
  const event: LogEvent = { id: newId('ev'), round: battle.round, seq: nextSeq(battle), ...e };
  return { battle: { ...battle, log: [...battle.log, event] }, id: event.id };
}

function withCombatant(battle: Battle, id: string, fn: (c: Combatant) => Combatant): Battle {
  return { ...battle, combatants: battle.combatants.map((c) => (c.id === id ? fn(c) : c)) };
}

function addCondition(list: Conditioned[], c: Conditioned): Conditioned[] {
  return [...list.filter((x) => x.tag !== c.tag), c];
}

const stateOf = (ctx: EvalContext): State => ({ battle: ctx.battle!, character: ctx.character, globals: ctx.library.globals });

/**
 * Run every event script listening for `kind` and fold their patches into the state.
 * The context is rebuilt from the state so a second event in the same transition (crit after hit)
 * sees what the first one changed. `opts.eventId` (when this trigger belongs to a specific logged
 * event, e.g. the attack `hit` scripts run for) is where a `check()` patch attaches — by id, not by
 * "whatever is currently last", so an earlier `log()` in the same batch of patches can't steal it.
 */
function runTriggers(ctx: EvalContext, state: State, kind: ScriptEvent, opts: { targetId?: string; damage?: number; result?: 'hit' | 'miss' | 'crit'; eventId?: string } = {}): State {
  const target = opts.targetId ? state.battle.combatants.find((c) => c.id === opts.targetId) : ctx.target;
  const ectx: EvalContext = {
    ...ctx, battle: state.battle, character: state.character, target,
    ...(opts.damage !== undefined ? { lastDamage: opts.damage } : {}),
    library: state.globals && state.globals !== ctx.library.globals ? { ...ctx.library, globals: state.globals } : ctx.library,
  };
  const r = runEventScripts(ectx, {
    kind,
    ...(opts.result ? { result: opts.result } : {}),
    ...(opts.damage !== undefined ? { damage: opts.damage } : {}),
    ...(opts.targetId ? { targetId: opts.targetId } : {}),
  });
  if (!r.patches.length) return state;
  return applyPatches(ectx, state, r.patches, undefined, opts.targetId, opts.eventId);
}

export type AttackLogInput = { targetId: string; profileId: string; modeId: string; attackIndex: number; result: 'hit' | 'miss' | 'crit'; damage?: number };

type VarUndo = { scope: 'character' | 'global'; name: string; before?: VarValue };
function diffVars(scope: 'character' | 'global', before: Record<string, VarValue>, after: Record<string, VarValue>): VarUndo[] {
  const out: VarUndo[] = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] === after[name]) continue;
    out.push({ scope, name, ...(before[name] !== undefined ? { before: before[name]! } : {}) });
  }
  return out;
}

/** Diff two states into an undo record for a log event. */
function undoRecord(before: State, after: State): NonNullable<LogEvent['undo']> {
  const targetConditions: { combatantId: string; tag: string }[] = [];
  for (const c of after.battle.combatants) {
    const prev = before.battle.combatants.find((x) => x.id === c.id);
    for (const cond of c.conditions) if (!prev?.conditions.some((x) => x.tag === cond.tag)) targetConditions.push({ combatantId: c.id, tag: cond.tag });
  }
  const selfConditions = after.battle.selfConditions.filter((x) => !before.battle.selfConditions.some((y) => y.tag === x.tag)).map((x) => x.tag);
  const resources: { id: string; delta: number }[] = [];
  const ids = new Set([...Object.keys(before.character.resourceState), ...Object.keys(after.character.resourceState), ...Object.keys(before.battle.encounterResources), ...Object.keys(after.battle.encounterResources), ...Object.keys(before.battle.roundResources), ...Object.keys(after.battle.roundResources)]);
  for (const id of ids) {
    const b = (before.character.resourceState[id]?.used ?? 0) + (before.battle.encounterResources[id] ?? 0) + (before.battle.roundResources[id] ?? 0);
    const a = (after.character.resourceState[id]?.used ?? 0) + (after.battle.encounterResources[id] ?? 0) + (after.battle.roundResources[id] ?? 0);
    if (a !== b) resources.push({ id, delta: a - b });
  }
  const buffs = after.battle.activeBuffs.filter((b) => !before.battle.activeBuffs.some((x) => x.instanceId === b.instanceId)).map((b) => b.instanceId);
  const hp = after.character.hp.current - before.character.hp.current;
  const vars = [
    ...diffVars('character', before.character.vars, after.character.vars),
    ...diffVars('global', before.globals ?? {}, after.globals ?? {}),
  ];
  return { targetConditions, selfConditions, resources, buffs, vars, ...(hp ? { hp } : {}) };
}

function stampUndo(before: State, after: State): State {
  const last = after.battle.log.at(-1);
  if (!last) return after;
  const undo = undoRecord(before, after);
  return { ...after, battle: { ...after.battle, log: after.battle.log.map((e) => (e.id === last.id ? { ...e, undo } : e)) } };
}

export function logAttack(ctx: EvalContext, input: AttackLogInput, snapshot?: { attackBonus: number; damageText: string }): State {
  if (!ctx.battle) throw new Error('No battle');
  const before = stateOf(ctx);
  const { battle, id: eventId } = appendEvent(ctx.battle, { kind: 'attack', actor: 'self', ...input, ...(snapshot ? { snapshot } : {}) });
  let state: State = { ...before, battle };
  // A crit is also a hit: `hit` scripts run first, then `crit`.
  const kinds: ScriptEvent[] = input.result === 'miss' ? ['miss'] : input.result === 'crit' ? ['hit', 'crit'] : ['hit'];
  for (const kind of kinds) {
    state = runTriggers(ctx, state, kind, { targetId: input.targetId, result: input.result, eventId, ...(input.damage !== undefined ? { damage: input.damage } : {}) });
  }
  state = { ...state, battle: { ...state.battle, activeBuffs: state.battle.activeBuffs.filter((b) => b.expires !== 'thisAttack') } };
  return stampUndo(before, state);
}

/** Remove a logged event and revert what its scripts changed (conditions, charges, buffs, hp, vars). */
export function undoEvent(ctx: EvalContext, eventId: string): State {
  if (!ctx.battle) throw new Error('No battle');
  const ev = ctx.battle.log.find((e) => e.id === eventId);
  if (!ev) return stateOf(ctx);
  let battle: Battle = { ...ctx.battle, log: ctx.battle.log.filter((e) => e.id !== eventId) };
  let character = ctx.character;
  let globals = { ...(ctx.library.globals ?? {}) };
  const u = ev.undo;
  if (u) {
    for (const tc of u.targetConditions) battle = withCombatant(battle, tc.combatantId, (c) => ({ ...c, conditions: c.conditions.filter((x) => x.tag !== tc.tag) }));
    battle = { ...battle, selfConditions: battle.selfConditions.filter((x) => !u.selfConditions.includes(x.tag)), activeBuffs: battle.activeBuffs.filter((b) => !u.buffs.includes(b.instanceId)) };
    for (const r of u.resources) ({ battle, character } = changeResource(ctx, { battle, character }, r.id, -r.delta));
    if (u.hp) character = { ...character, hp: { ...character.hp, current: character.hp.current - u.hp } };
    for (const v of u.vars) {
      if (v.scope === 'character') {
        const vars = { ...character.vars };
        if (v.before === undefined) delete vars[v.name]; else vars[v.name] = v.before;
        character = { ...character, vars };
      } else if (v.before === undefined) delete globals[v.name];
      else globals[v.name] = v.before;
    }
  }
  return { battle, character, globals };
}

export type EnemyLogInput = { actorId: string; result: 'hit' | 'miss' | 'crit'; damage?: number; text?: string };

/** Log an enemy acting on the character (it hit me / missed me), applying damage and `damaged` scripts. */
export function logEnemyAction(ctx: EvalContext, input: EnemyLogInput): State {
  if (!ctx.battle) throw new Error('No battle');
  const before = stateOf(ctx);
  const { battle, id: eventId } = appendEvent(ctx.battle, { kind: 'enemy', actor: input.actorId, targetId: 'self', result: input.result, ...(input.damage !== undefined ? { damage: input.damage } : {}), ...(input.text ? { text: input.text } : {}) });
  let state: State = { ...before, battle };
  if (input.damage) {
    const hp = { ...state.character.hp };
    const t = Math.min(hp.temp, input.damage); hp.temp -= t; hp.current = Math.max(-10, hp.current - (input.damage - t));
    state = { ...state, character: { ...state.character, hp } };
    state = runTriggers(ctx, state, 'damaged', { targetId: input.actorId, damage: input.damage, result: input.result, eventId });
  }
  return stampUndo(before, state);
}

export type UseAbilityInput = { abilityId: string; activationId?: string; targetId?: string };

function payCosts(ctx: EvalContext, state: State, act: Activation, explicitConsumed: Set<string>): State {
  const vars = exprVars({ ...ctx, ...state });
  if (act.charges && !explicitConsumed.has(act.id)) state = { ...state, ...changeResource(ctx, state, act.id, 1) };
  for (const c of act.cost) {
    if (c.kind === 'charge') { if (!explicitConsumed.has(c.resourceId)) state = { ...state, ...changeResource(ctx, state, c.resourceId, evalExpr(c.amount, vars)) }; }
    else if (c.kind === 'hp') { const n = evalExpr(c.amount, vars); state = { ...state, character: { ...state.character, hp: { ...state.character.hp, current: state.character.hp.current - n } } }; }
    else if (c.kind === 'item') {
      const inv = state.character.inventory;
      const idx = inv.findIndex((i) => i.abilityId === c.abilityId && i.quantity > 0);
      if (idx >= 0) state = { ...state, character: { ...state.character, inventory: inv.map((i, j) => (j === idx ? { ...i, quantity: Math.max(0, i.quantity - c.quantity) } : i)) } };
    }
  }
  return state;
}

/** Use an activation: log it, start its buff if it (or its spell) has a duration, run `use` scripts, pay costs. */
export function useAbility(ctx: EvalContext, input: UseAbilityInput): State {
  if (!ctx.battle) throw new Error('No battle');
  const ability = ctx.library.abilities[input.abilityId];
  if (!ability) throw new Error(`Unknown ability "${input.abilityId}"`);
  const acts = activationsOf(ability);
  const act = input.activationId ? acts.find((x) => x.id === input.activationId) : acts[0];
  if (!act) throw new Error(`${ability.name} has no activation${input.activationId ? ` "${input.activationId}"` : ''}`);
  const spell = act.spell ? ctx.library.abilities[act.spell] : undefined;
  const spellRec = spell?.kind === 'spell' ? spell : undefined;
  const before = stateOf(ctx);
  const { battle: usedBattle, id: eventId } = appendEvent(ctx.battle, { kind: 'use', actor: 'self', abilityId: ability.id, activationId: act.id, ...(input.targetId ? { targetId: input.targetId } : {}) });
  let state: State = { ...before, battle: usedBattle };
  const duration = act.duration ?? spellRec?.duration;
  const rounds = durationRounds(duration);
  if (duration !== undefined && !state.battle.activeBuffs.some((b) => b.abilityId === ability.id && b.activationId === act.id && b.owner === 'self')) {
    state = { ...state, battle: { ...state.battle, activeBuffs: [...state.battle.activeBuffs, { instanceId: newId('buff'), abilityId: ability.id, activationId: act.id, owner: 'self', suppressed: false, expires: duration, appliedRound: state.battle.round, label: act.name ?? spellRec?.name ?? ability.name, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] } };
  }
  const target = input.targetId ? state.battle.combatants.find((c) => c.id === input.targetId) : ctx.target;
  const ectx: EvalContext = { ...ctx, battle: state.battle, character: state.character, target };
  const r = runEventScripts(ectx, { kind: 'use', abilityId: ability.id, activationId: act.id, ...(input.targetId ? { targetId: input.targetId } : {}) }, { only: { abilityId: ability.id, activationId: act.id } });
  // A script that spends a pool itself replaces the automatic charge/cost payment for that pool.
  const explicit = new Set(r.patches.flatMap((p) => (p.k === 'resource' && p.op === 'consume' ? [p.id] : [])));
  state = applyPatches(ectx, state, r.patches, ability, input.targetId, eventId);
  state = payCosts(ctx, state, act, explicit);
  return stampUndo(before, state);
}

/** Rounds a duration lasts when applied as a buff in the round model; undefined = until removed. */
export function durationRounds(d: Duration | undefined): number | undefined {
  if (d === undefined) return undefined;
  if (typeof d === 'number') return toRounds(d);
  return d === 'thisAttack' || d === 'untilMyNextTurn' ? 1 : undefined;
}

function expired(c: Conditioned, newRound: number): boolean {
  const from = c.appliedRound ?? newRound;
  const d = c.expires;
  if (d === undefined || d === 'untilRemoved' || d === 'encounter') return false;
  if (d === 'thisAttack') return newRound > from;
  if (d === 'untilMyNextTurn') return newRound >= from + 2;
  return newRound >= from + toRounds(d);
}

export function nextRound(ctx: EvalContext): State {
  if (!ctx.battle) throw new Error('No battle');
  let state = stateOf(ctx);
  // roundEnd fires before the next round's event is appended, so it has no eventId: a check() there attaches nowhere (dropped, never mis-attached).
  state = runTriggers(ctx, state, 'roundEnd', { ...(ctx.target ? { targetId: ctx.target.id } : {}) });
  const round = state.battle.round + 1;
  const battle: Battle = {
    ...state.battle,
    round,
    activeBuffs: state.battle.activeBuffs.map((b) => (b.remainingRounds === undefined ? b : { ...b, remainingRounds: b.remainingRounds - 1 })).filter((b) => b.remainingRounds === undefined || b.remainingRounds > 0),
    combatants: state.battle.combatants.map((c) => ({ ...c, conditions: c.conditions.filter((x) => !expired(x, round)) })),
    selfConditions: state.battle.selfConditions.filter((x) => !expired(x, round)),
    roundResources: {},
  };
  const { battle: startedBattle, id: eventId } = appendEvent(battle, { kind: 'roundStart', actor: 'self' });
  state = { ...state, battle: startedBattle };
  return runTriggers(ctx, state, 'roundStart', { eventId, ...(ctx.target ? { targetId: ctx.target.id } : {}) });
}

export type SituationalSpec = {
  label: string;
  target: 'self' | 'all' | string;
  to?: StatId;
  value?: number;
  bonusType?: BonusType;
  tag?: string;
  suppressAbilityId?: string;
  duration?: Duration;
  note?: string;
};

export function addStatus(ctx: EvalContext, spec: SituationalSpec): Battle {
  if (!ctx.battle) throw new Error('No battle');
  let battle = ctx.battle;
  const duration = spec.duration ?? 'encounter';
  if (spec.target === 'self') {
    // A DM ruling becomes a one-script status record stored on the battle.
    const lines: string[] = [];
    if (spec.to && spec.value !== undefined) lines.push(`bonus(${JSON.stringify(spec.to)}, ${spec.value}, ${JSON.stringify(spec.bonusType ?? 'untyped')});`);
    if (spec.note) lines.push(`note(${JSON.stringify(spec.note)});`);
    if (spec.suppressAbilityId && !battle.suppressedAbilities.includes(spec.suppressAbilityId)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, spec.suppressAbilityId] };
    if (spec.tag) battle = { ...battle, selfConditions: addCondition(battle.selfConditions, { tag: spec.tag, expires: duration, appliedRound: battle.round, source: 'situational' }) };
    if (lines.length) {
      const status: Status = { id: newId('sit'), name: spec.label, kind: 'status', harmful: (spec.value ?? 0) < 0, duration, scripts: [{ id: 'e', events: ['always'], source: lines.join('\n'), enabled: true, priority: 0 }] };
      const rounds = durationRounds(duration);
      battle = { ...battle, statuses: [...battle.statuses, status], activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId: status.id, owner: 'self', suppressed: false, label: spec.label, expires: duration, appliedRound: battle.round, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] };
    }
    return battle;
  }
  const ids = spec.target === 'all' ? battle.combatants.map((c) => c.id) : [spec.target];
  const tag = spec.tag ?? spec.label;
  for (const id of ids) battle = withCombatant(battle, id, (c) => ({ ...c, conditions: addCondition(c.conditions, { tag, expires: duration, appliedRound: battle.round, source: 'situational' }) }));
  return battle;
}

export function setPrompt(ctx: EvalContext, input: { id: string; perTagCategory?: string; value: number; targetId?: string }): Battle {
  if (!ctx.battle) throw new Error('No battle');
  const target = input.targetId ? ctx.battle.combatants.find((c) => c.id === input.targetId) : ctx.target;
  const key = promptKey(ctx, input.id, input.perTagCategory, target);
  if (!key) throw new Error(`Cannot key prompt "${input.id}" by ${input.perTagCategory}: target has no such tag`);
  return { ...ctx.battle, prompts: { ...ctx.battle.prompts, [key]: input.value } };
}

export function setDistance(battle: Battle, combatantId: string, feet: number | undefined): Battle {
  return withCombatant(battle, combatantId, (c) => ({ ...c, distanceFeet: feet }));
}

export function editLogEvent(battle: Battle, id: string, patch: Partial<LogEvent>): Battle {
  return { ...battle, log: battle.log.map((e) => (e.id === id ? { ...e, ...patch, id: e.id, editedAt: new Date().toISOString() } : e)) };
}
export function deleteLogEvent(battle: Battle, id: string): Battle {
  return { ...battle, log: battle.log.filter((e) => e.id !== id) };
}
export function undoLastEvent(battle: Battle): Battle {
  return { ...battle, log: battle.log.slice(0, -1) };
}

/** Reset resources that reset on a rest/day. */
export function longRest(character: Character, library?: Library): Character {
  if (!library) return { ...character, resourceState: {} };
  const keep: Character['resourceState'] = {};
  for (const [id, st] of Object.entries(character.resourceState)) {
    const def = findResourceDef({ character, library }, id);
    if (def && def.def.resetOn === 'never') keep[id] = st;
  }
  return { ...character, resourceState: keep };
}

export type MonsterOverlay = { addTags?: string[]; removeTags?: string[]; notes?: string };
export type AddCombatantInput = { monster: Monster; name?: string; overlay?: MonsterOverlay } | { name: string; tags?: string[]; size?: Size };

/** Tags of a bestiary monster after the user's overlay (tags added/removed for every copy of that monster). */
export function monsterTags(monster: Monster, overlay?: MonsterOverlay): string[] {
  const removed = new Set(overlay?.removeTags ?? []);
  return [...new Set([...monster.tags.filter((t) => !removed.has(t)), ...(overlay?.addTags ?? [])])];
}

export function addCombatant(battle: Battle, input: AddCombatantInput): Battle {
  const base = 'monster' in input ? input.name ?? input.monster.name : input.name;
  const taken = new Set(battle.combatants.map((c) => c.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  const combatant: Combatant = {
    id: newId('cb'), name, hurt: 'unhurt', conditions: [], dead: false, revealed: false,
    ...('monster' in input ? { monsterId: input.monster.id, tags: monsterTags(input.monster, input.overlay), size: input.monster.size, ...(input.overlay?.notes ? { notes: input.overlay.notes } : {}) } : { tags: input.tags ?? [], size: input.size ?? 'medium' }),
  };
  return { ...battle, combatants: [...battle.combatants, combatant] };
}

export function newBattle(name = 'Battle'): Battle {
  return {
    id: newId('battle'), name, startedAt: new Date().toISOString(), round: 1, combatants: [], activeBuffs: [], statuses: [],
    suppressedAbilities: [], selfConditions: [], toggles: {}, tags: [], encounterResources: {}, roundResources: {}, prompts: {}, log: [], ended: false,
  };
}
