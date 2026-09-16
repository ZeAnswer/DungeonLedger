import type { EvalContext } from '../context';
import { newId } from '../ids';
import { changeResource } from '../resources';
import { activationsOf, type Ability, type Battle, type Character, type Combatant, type Duration, type LogEvent, type VarValue } from '../schema';
import type { EventInfo, Patch } from './api';
import { activeSources, runOne } from './compute';
import { newSink, type ScriptError } from './sink';
import { toRounds } from './units';

export type State = { battle: Battle; character: Character; globals?: Record<string, VarValue> };
export type Only = { abilityId: string; activationId?: string };

/** How deep an `emit` chain may go before the runner stops following it. */
const MAX_EMIT_DEPTH = 8;

/**
 * Run every event script whose `events` include this event (`custom:<name>` for emits).
 * Emits cascade within the same call, up to `MAX_EMIT_DEPTH` levels deep.
 *
 * `opts.only` restricts the *initial* event to one record (and, with `activationId`, to that
 * activation's scripts) — "this ability was used". Cascaded custom events always reach every active
 * source, so one record's emit can wake another's listener.
 */
export function runEventScripts(ctx: EvalContext, event: EventInfo, opts: { only?: Only } = {}): { patches: Patch[]; errors: ScriptError[] } {
  const all: Patch[] = [];
  const sink = newSink();
  const queue: { ev: EventInfo; depth: number }[] = [{ ev: event, depth: 0 }];
  const sources = activeSources(ctx);
  const only = opts.only;
  // When the named activation is already running it is its own source; otherwise its scripts are
  // reached through the record source (using an activation that is not yet active is the `use` case).
  const activationIsSource = !!only?.activationId && sources.some((s) => s.ability.id === only.abilityId && s.activation?.id === only.activationId);
  while (queue.length) {
    const { ev, depth } = queue.shift()!;
    const initial = ev === event;
    for (const src of sources) {
      if (initial && only) {
        if (src.ability.id !== only.abilityId) continue;
        if (only.activationId && src.activation && src.activation.id !== only.activationId) continue;
      }
      const viaActivation = initial && only?.activationId && !src.activation && !activationIsSource;
      const scripts = viaActivation ? (activationsOf(src.ability).find((a) => a.id === only!.activationId)?.scripts ?? []) : src.scripts;
      for (const script of scripts) {
        if (!script.enabled || !script.events.includes(ev.kind)) continue;
        const patches: Patch[] = [];
        runOne(ctx, { phase: 'event', source: src, script, event: ev }, sink, patches);
        for (const p of patches) {
          all.push(p);
          if (p.k === 'emit' && depth < MAX_EMIT_DEPTH) {
            queue.push({ ev: { kind: `custom:${p.name}`, payload: p.payload, ...(ev.targetId ? { targetId: ev.targetId } : {}) }, depth: depth + 1 });
          }
        }
      }
    }
  }
  return { patches: all, errors: sink.errors };
}

type Conditioned = { tag: string; expires?: Duration; appliedRound?: number; source?: string };
const addCondition = (list: readonly Conditioned[], c: Conditioned): Conditioned[] => [...list.filter((x) => x.tag !== c.tag), c];

/**
 * Apply queued patches immutably (a port of the v3 `applyTriggered`, plus setVar/log/untag).
 * `setVar` writes a character var when the character already has that name and a library global
 * otherwise, so the caller gets both halves back.
 */
export function applyPatches(ctx: EvalContext, state: State, patches: readonly Patch[], ability: Ability, targetId?: string): State & { globals: Record<string, VarValue> } {
  let battle = state.battle;
  let character = state.character;
  let globals = state.globals ?? ctx.library.globals ?? {};
  const withCombatant = (id: string, fn: (c: Combatant) => Combatant) => {
    battle = { ...battle, combatants: battle.combatants.map((c) => (c.id === id ? fn(c) : c)) };
  };
  for (const p of patches) {
    switch (p.k) {
      case 'tag': {
        const cond: Conditioned = { tag: p.tag, expires: p.duration, appliedRound: battle.round, source: ability.id };
        if (p.to === 'self') battle = { ...battle, selfConditions: addCondition(battle.selfConditions, cond) };
        else if (p.to === 'allEnemies') battle = { ...battle, combatants: battle.combatants.map((c) => ({ ...c, conditions: addCondition(c.conditions, cond) })) };
        else if (targetId) withCombatant(targetId, (c) => ({ ...c, conditions: addCondition(c.conditions, cond) }));
        break;
      }
      case 'untag':
        if (p.to === 'self') battle = { ...battle, selfConditions: battle.selfConditions.filter((x) => x.tag !== p.tag) };
        else if (targetId) withCombatant(targetId, (c) => ({ ...c, conditions: c.conditions.filter((x) => x.tag !== p.tag) }));
        break;
      case 'resource':
        ({ battle, character } = changeResource(ctx, { battle, character }, p.id, p.op === 'restore' ? -p.amount : p.amount, p.op === 'set' ? p.amount : undefined));
        break;
      case 'suppress':
        if (!battle.suppressedAbilities.includes(p.abilityId)) battle = { ...battle, suppressedAbilities: [...battle.suppressedAbilities, p.abilityId] };
        break;
      case 'reveal':
        if (targetId) withCombatant(targetId, (c) => ({ ...c, revealed: true }));
        break;
      case 'grant': {
        const g = ctx.library.abilities[p.abilityId] ?? battle.statuses.find((s) => s.id === p.abilityId);
        const dur = p.duration ?? (g && (g.kind === 'status' || g.kind === 'spell') ? g.duration : undefined);
        const rounds = typeof dur === 'number' ? toRounds(dur) : dur === 'thisAttack' || dur === 'untilMyNextTurn' ? 1 : undefined;
        if (rounds !== 0 && !battle.activeBuffs.some((b) => b.abilityId === p.abilityId)) {
          battle = {
            ...battle,
            activeBuffs: [...battle.activeBuffs, {
              instanceId: newId('buff'), abilityId: p.abilityId, owner: 'self', suppressed: false, appliedRound: battle.round,
              ...(dur !== undefined ? { expires: dur } : {}),
              ...(rounds !== undefined ? { remainingRounds: rounds } : {}),
            }],
          };
        }
        break;
      }
      case 'hp': {
        const hp = { ...character.hp };
        if (p.op === 'damage') { const t = Math.min(hp.temp, p.amount); hp.temp -= t; hp.current -= p.amount - t; }
        else if (p.op === 'heal') hp.current = Math.min(hp.max, hp.current + p.amount);
        else hp.temp = Math.max(hp.temp, p.amount);
        character = { ...character, hp };
        break;
      }
      case 'setVar':
        if (p.name in character.vars) character = { ...character, vars: { ...character.vars, [p.name]: p.value } };
        else globals = { ...globals, [p.name]: p.value };
        break;
      case 'log': {
        const seq = (battle.log.at(-1)?.seq ?? 0) + 1;
        const entry: LogEvent = { id: newId('ev'), round: battle.round, seq, kind: 'note', actor: 'self', text: p.text };
        battle = { ...battle, log: [...battle.log, entry] };
        break;
      }
      case 'emit':
        break; // already cascaded by runEventScripts
    }
  }
  return { battle, character, globals };
}
