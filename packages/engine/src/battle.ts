import type { EvalContext, Library } from './context';
import { findResourceDef, promptKey, resourceUsed, type ResetOn } from './context';
import { evalCondition } from './conditions';
import { evalExpr } from './expr';
import { newId } from './ids';
import { activationsOf, poolsOf, type Ability, type Activation, type Battle, type BonusType, type Character, type Combatant, type Duration, type Effect, type LogEvent, type Monster, type Size, type StatId, type Status, type Trigger } from './schema';
import { activeSources } from './resolve';
import { exprVars } from './vars';

type Conditioned = { tag: string; expires?: Duration; appliedRound?: number; source?: string };
type State = { battle: Battle; character: Character };

function nextSeq(battle: Battle): number {
  return (battle.log.at(-1)?.seq ?? 0) + 1;
}

function appendEvent(battle: Battle, e: Omit<LogEvent, 'id' | 'round' | 'seq'>): Battle {
  const event: LogEvent = { id: newId('ev'), round: battle.round, seq: nextSeq(battle), ...e };
  return { ...battle, log: [...battle.log, event] };
}

function withCombatant(battle: Battle, id: string, fn: (c: Combatant) => Combatant): Battle {
  return { ...battle, combatants: battle.combatants.map((c) => (c.id === id ? fn(c) : c)) };
}

function addCondition(list: Conditioned[], c: Conditioned): Conditioned[] {
  return [...list.filter((x) => x.tag !== c.tag), c];
}

function findPer(ctx: EvalContext, resourceId: string): ResetOn {
  return findResourceDef(ctx, resourceId)?.def.resetOn ?? 'day';
}

function changeResource(ctx: EvalContext, state: State, resourceId: string, delta: number, set?: number): State {
  const per = findPer({ ...ctx, battle: state.battle }, resourceId);
  const current = resourceUsed({ ...ctx, battle: state.battle, character: state.character }, resourceId, per);
  const used = Math.max(0, set !== undefined ? set : current + delta);
  if (per === 'round' || per === 'encounter') {
    const key = per === 'encounter' ? 'encounterResources' : 'roundResources';
    return { ...state, battle: { ...state.battle, [key]: { ...state.battle[key], [resourceId]: used } } };
  }
  return { ...state, character: { ...state.character, resourceState: { ...state.character.resourceState, [resourceId]: { used } } } };
}

/** Apply the effects of a triggered block (onHit/onUse/…). */
function applyTriggered(ctx: EvalContext, state: State, ability: Ability, effects: readonly Effect[], targetId: string | undefined): State {
  let { battle, character } = state;
  const vars = exprVars({ ...ctx, battle, character });
  for (const e of effects) {
    switch (e.verb) {
      case 'tag': {
        const cond: Conditioned = { tag: e.tag, expires: e.duration, appliedRound: battle.round, source: ability.id };
        if (e.to === 'self') battle = { ...battle, selfConditions: addCondition(battle.selfConditions, cond) };
        else if (e.to === 'allEnemies') battle = { ...battle, combatants: battle.combatants.map((c) => ({ ...c, conditions: addCondition(c.conditions, cond) })) };
        else if (targetId) battle = withCombatant(battle, targetId, (c) => ({ ...c, conditions: addCondition(c.conditions, cond) }));
        break;
      }
      case 'resource': {
        const amount = evalExpr(e.amount, vars);
        ({ battle, character } = changeResource(ctx, { battle, character }, e.id, e.op === 'restore' ? -amount : amount, e.op === 'set' ? amount : undefined));
        break;
      }
      case 'suppress': if (!battle.suppressedAbilities.includes(e.ability)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, e.ability] }; break;
      case 'reveal': if (targetId) battle = withCombatant(battle, targetId, (c) => ({ ...c, revealed: true })); break;
      case 'grant': {
        const g = ctx.library.abilities[e.ability];
        const dur = e.duration ?? (g && (g.kind === 'status' || g.kind === 'spell') ? g.duration : undefined);
        const rounds = durationRounds(dur, vars);
        if (rounds !== 0 && !battle.activeBuffs.some((b) => b.abilityId === e.ability)) battle = { ...battle, activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId: e.ability, owner: 'self', suppressed: false, ...(dur ? { expires: dur } : {}), ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] };
        break;
      }
      case 'hp': {
        const n = evalExpr(e.amount, vars);
        const hp = { ...character.hp };
        if (e.op === 'damage') { const t = Math.min(hp.temp, n); hp.temp -= t; hp.current -= n - t; }
        else if (e.op === 'heal') hp.current = Math.min(hp.max, hp.current + n);
        else hp.temp = Math.max(hp.temp, n);
        character = { ...character, hp };
        break;
      }
      default: break;
    }
  }
  return { battle, character };
}

/** Run every active source's blocks with the given trigger. */
function runTriggers(ctx: EvalContext, trigger: Trigger, targetId: string | undefined, extra?: Partial<EvalContext>): State {
  let state: State = { battle: ctx.battle!, character: ctx.character };
  const target = targetId ? state.battle.combatants.find((c) => c.id === targetId) : undefined;
  for (const src of activeSources({ ...ctx, battle: state.battle, character: state.character })) {
    const ectx: EvalContext = { ...ctx, ...extra, battle: state.battle, character: state.character, target, abilityInstance: src.instance };
    for (const block of src.blocks) {
      if (block.trigger !== trigger || !evalCondition(block.when, ectx)) continue;
      state = applyTriggered(ectx, state, src.ability, block.do, targetId);
    }
  }
  return state;
}

export type AttackLogInput = { targetId: string; profileId: string; modeId: string; attackIndex: number; result: 'hit' | 'miss' | 'crit'; damage?: number };

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
  return { targetConditions, selfConditions, resources, buffs, ...(hp ? { hp } : {}) };
}

function stampUndo(before: State, after: State): State {
  const last = after.battle.log.at(-1);
  if (!last) return after;
  const undo = undoRecord(before, after);
  return { ...after, battle: { ...after.battle, log: after.battle.log.map((e) => (e.id === last.id ? { ...e, undo } : e)) } };
}

export function logAttack(ctx: EvalContext, input: AttackLogInput, snapshot?: { attackBonus: number; damageText: string }): State {
  if (!ctx.battle) throw new Error('No battle');
  const before: State = { battle: ctx.battle, character: ctx.character };
  const battle = appendEvent(ctx.battle, { kind: 'attack', actor: 'self', ...input, ...(snapshot ? { snapshot } : {}) });
  let state: State = { battle, character: ctx.character };
  const triggers: Trigger[] = input.result === 'miss' ? ['onMiss'] : input.result === 'crit' ? ['onHit', 'onCrit'] : ['onHit'];
  for (const t of triggers) state = runTriggers({ ...ctx, battle: state.battle, character: state.character, ...(input.damage !== undefined ? { lastDamage: input.damage } : {}) }, t, input.targetId);
  state = { ...state, battle: { ...state.battle, activeBuffs: state.battle.activeBuffs.filter((b) => b.expires !== 'thisAttack') } };
  return stampUndo(before, state);
}

/** Remove a logged event and revert what its triggers changed (conditions, charges, buffs, hp). */
export function undoEvent(ctx: EvalContext, eventId: string): State {
  if (!ctx.battle) throw new Error('No battle');
  const ev = ctx.battle.log.find((e) => e.id === eventId);
  if (!ev) return { battle: ctx.battle, character: ctx.character };
  let battle: Battle = { ...ctx.battle, log: ctx.battle.log.filter((e) => e.id !== eventId) };
  let character = ctx.character;
  const u = ev.undo;
  if (u) {
    for (const tc of u.targetConditions) battle = withCombatant(battle, tc.combatantId, (c) => ({ ...c, conditions: c.conditions.filter((x) => x.tag !== tc.tag) }));
    battle = { ...battle, selfConditions: battle.selfConditions.filter((x) => !u.selfConditions.includes(x.tag)), activeBuffs: battle.activeBuffs.filter((b) => !u.buffs.includes(b.instanceId)) };
    for (const r of u.resources) ({ battle, character } = changeResource(ctx, { battle, character }, r.id, -r.delta));
    if (u.hp) character = { ...character, hp: { ...character.hp, current: character.hp.current - u.hp } };
  }
  return { battle, character };
}

export type EnemyLogInput = { actorId: string; result: 'hit' | 'miss' | 'crit'; damage?: number; text?: string };

/** Log an enemy acting on the character (it hit me / missed me), applying damage and onDamaged triggers. */
export function logEnemyAction(ctx: EvalContext, input: EnemyLogInput): State {
  if (!ctx.battle) throw new Error('No battle');
  const battle = appendEvent(ctx.battle, { kind: 'enemy', actor: input.actorId, targetId: 'self', result: input.result, ...(input.damage !== undefined ? { damage: input.damage } : {}), ...(input.text ? { text: input.text } : {}) });
  let state: State = { battle, character: ctx.character };
  if (input.damage) {
    const hp = { ...state.character.hp };
    const t = Math.min(hp.temp, input.damage); hp.temp -= t; hp.current = Math.max(-10, hp.current - (input.damage - t));
    state = { ...state, character: { ...state.character, hp } };
    state = runTriggers({ ...ctx, battle: state.battle, character: state.character, lastDamage: input.damage }, 'onDamaged', input.actorId);
  }
  return stampUndo({ battle: ctx.battle, character: ctx.character }, state);
}

export type UseAbilityInput = { abilityId: string; activationId?: string; targetId?: string };

function payCosts(ctx: EvalContext, state: State, act: Activation, explicitConsumed: Set<string>): State {
  const vars = exprVars({ ...ctx, ...state });
  if (act.charges && !explicitConsumed.has(act.id)) state = changeResource(ctx, state, act.id, 1);
  for (const c of act.cost) {
    if (c.kind === 'charge') { if (!explicitConsumed.has(c.resourceId)) state = changeResource(ctx, state, c.resourceId, evalExpr(c.amount, vars)); }
    else if (c.kind === 'hp') { const n = evalExpr(c.amount, vars); state = { ...state, character: { ...state.character, hp: { ...state.character.hp, current: state.character.hp.current - n } } }; }
    else if (c.kind === 'item') {
      const inv = state.character.inventory;
      const idx = inv.findIndex((i) => i.abilityId === c.abilityId && i.quantity > 0);
      if (idx >= 0) state = { ...state, character: { ...state.character, inventory: inv.map((i, j) => (j === idx ? { ...i, quantity: Math.max(0, i.quantity - c.quantity) } : i)) } };
    }
  }
  return state;
}

/** Use an activation: log, start its buff if it (or its spell) has a duration, run onUse blocks (and an instant spell's effects), pay costs. */
export function useAbility(ctx: EvalContext, input: UseAbilityInput): State {
  if (!ctx.battle) throw new Error('No battle');
  const ability = ctx.library.abilities[input.abilityId];
  if (!ability) throw new Error(`Unknown ability "${input.abilityId}"`);
  const acts = activationsOf(ability);
  const act = input.activationId ? acts.find((x) => x.id === input.activationId) : acts[0];
  if (!act) throw new Error(`${ability.name} has no activation${input.activationId ? ` "${input.activationId}"` : ''}`);
  const spell = act.spell ? ctx.library.abilities[act.spell] : undefined;
  const spellRec = spell?.kind === 'spell' ? spell : undefined;
  const before: State = { battle: ctx.battle, character: ctx.character };
  let state: State = { battle: appendEvent(ctx.battle, { kind: 'use', actor: 'self', abilityId: ability.id, activationId: act.id, ...(input.targetId ? { targetId: input.targetId } : {}) }), character: ctx.character };
  const vars = exprVars(ctx);
  const duration = act.duration ?? spellRec?.duration;
  const rounds = durationRounds(duration, vars);
  if (duration && !state.battle.activeBuffs.some((b) => b.abilityId === ability.id && b.activationId === act.id && b.owner === 'self')) {
    state = { ...state, battle: { ...state.battle, activeBuffs: [...state.battle.activeBuffs, { instanceId: newId('buff'), abilityId: ability.id, activationId: act.id, owner: 'self', suppressed: false, expires: duration, label: act.name ?? spellRec?.name ?? ability.name, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] } };
  }
  const target = input.targetId ? state.battle.combatants.find((c) => c.id === input.targetId) : undefined;
  const inst = state.character.abilities.find((a) => a.abilityId === ability.id);
  const explicit = new Set<string>();
  const once = [...act.onUse, ...(spellRec && !duration ? spellRec.effects : [])];
  for (const block of once) {
    const ectx: EvalContext = { ...ctx, battle: state.battle, character: state.character, target, abilityInstance: inst };
    if (!evalCondition(block.when, ectx)) continue;
    for (const e of block.do) if (e.verb === 'resource' && e.op === 'consume') explicit.add(e.id);
    state = applyTriggered(ectx, state, ability, block.do, input.targetId);
  }
  state = payCosts(ctx, state, act, explicit);
  return stampUndo(before, state);
}

/** Rounds a duration lasts when applied as a buff in the round model; undefined = until removed. */
export function durationRounds(d: Duration | undefined, vars: ReturnType<typeof exprVars>): number | undefined {
  if (d === undefined) return undefined;
  if (typeof d === 'object') return 'rounds' in d ? evalExpr(d.rounds, vars) : Math.max(1, Math.round(d.minutes * 10));
  switch (d) {
    case 'thisAttack': case 'thisTurn': case 'untilMyNextTurn': return 1;
    default: return undefined;
  }
}

function expired(c: Conditioned, newRound: number): boolean {
  const from = c.appliedRound ?? newRound;
  const d = c.expires;
  if (!d || d === 'untilRemoved' || d === 'encounter') return false;
  if (d === 'thisTurn' || d === 'thisAttack') return newRound > from;
  if (d === 'untilMyNextTurn') return newRound >= from + 2;
  if ('rounds' in d) return newRound >= from + (typeof d.rounds === 'number' ? d.rounds : 1);
  return newRound >= from + Math.max(1, Math.round(d.minutes * 10));
}

export function nextRound(ctx: EvalContext): State {
  if (!ctx.battle) throw new Error('No battle');
  const round = ctx.battle.round + 1;
  let battle: Battle = {
    ...ctx.battle,
    round,
    activeBuffs: ctx.battle.activeBuffs.map((b) => (b.remainingRounds === undefined ? b : { ...b, remainingRounds: b.remainingRounds - 1 })).filter((b) => b.remainingRounds === undefined || b.remainingRounds > 0),
    combatants: ctx.battle.combatants.map((c) => ({ ...c, conditions: c.conditions.filter((x) => !expired(x, round)) })),
    selfConditions: ctx.battle.selfConditions.filter((x) => !expired(x, round)),
    toggles: ctx.battle.toggles,
    roundResources: {},
  };
  let state: State = { battle: appendEvent(battle, { kind: 'roundStart', actor: 'self' }), character: ctx.character };
  state = runTriggers({ ...ctx, ...state }, 'onRoundStart', ctx.target?.id);
  return state;
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
    const effects: Effect[] = [];
    if (spec.to && spec.value !== undefined) effects.push({ verb: 'modify', to: spec.to, value: spec.value, type: spec.bonusType ?? 'untyped', mode: 'add' });
    if (spec.note) effects.push({ verb: 'note', text: spec.note });
    if (spec.suppressAbilityId && !battle.suppressedAbilities.includes(spec.suppressAbilityId)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, spec.suppressAbilityId] };
    if (spec.tag) battle = { ...battle, selfConditions: addCondition(battle.selfConditions, { tag: spec.tag, expires: duration, appliedRound: battle.round, source: 'situational' }) };
    if (effects.length) {
      const status: Status = { id: newId('sit'), name: spec.label, kind: 'status', harmful: (spec.value ?? 0) < 0, duration, effects: [{ id: 'e', trigger: 'always', when: { all: [] }, do: effects }] };
      const rounds = durationRounds(duration, exprVars(ctx));
      battle = { ...battle, statuses: [...battle.statuses, status], activeBuffs: [...battle.activeBuffs, { instanceId: newId('buff'), abilityId: status.id, owner: 'self', suppressed: false, label: spec.label, expires: duration, ...(rounds !== undefined ? { remainingRounds: rounds } : {}) }] };
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
