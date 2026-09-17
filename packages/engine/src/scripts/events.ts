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
/** A patch plus the record that queued it, so `applyPatches` can stamp the right source on conditions. */
export type SourcedPatch = Patch & { src: string };

/** How deep an `emit` chain may go before the runner stops following it. */
const MAX_EMIT_DEPTH = 8;
/** Total script runs one event transition may cost, however the emits are shaped. */
const MAX_EMIT_RUNS = 500;

/**
 * Run every event script whose `events` include this event (`custom:<name>` for emits).
 * Emits cascade within the same call, up to `MAX_EMIT_DEPTH` levels deep and `MAX_EMIT_RUNS` runs.
 *
 * `opts.only` restricts the *initial* event to one record — "this ability was used". With
 * `activationId` the record's own scripts **and** that activation's (plus the spell it casts) run,
 * each exactly once, whether or not the activation is already running as a buff. Cascaded custom
 * events always reach every active source, so one record's emit can wake another's listener.
 *
 * A script that skips (`need`) or throws contributes nothing: its patches are dropped.
 */
export function runEventScripts(ctx: EvalContext, event: EventInfo, opts: { only?: Only } = {}): { patches: SourcedPatch[]; errors: ScriptError[] } {
  const all: SourcedPatch[] = [];
  const sink = newSink();
  const queue: { ev: EventInfo; depth: number }[] = [{ ev: event, depth: 0 }];
  const sources = activeSources(ctx, sink.warnings);
  const only = opts.only;
  // When the named activation is already running it is its own source and brings its own (and its
  // spell's) scripts; otherwise the record source carries them, so each script runs exactly once.
  const activationIsSource = !!only?.activationId && sources.some((s) => s.ability.id === only.abilityId && s.activation?.id === only.activationId);
  let runs = 0;
  let capped = false;
  while (queue.length && !capped) {
    const { ev, depth } = queue.shift()!;
    const initial = ev === event;
    for (const src of sources) {
      if (initial && only) {
        if (src.ability.id !== only.abilityId) continue;
        if (only.activationId && src.activation && src.activation.id !== only.activationId) continue;
      }
      const viaActivation = initial && !!only?.activationId && !src.activation && !activationIsSource;
      const act = viaActivation ? activationsOf(src.ability).find((a) => a.id === only!.activationId) : undefined;
      const spell = act?.spell ? ctx.library.abilities[act.spell] : undefined;
      const scripts = viaActivation ? [...src.scripts, ...(act?.scripts ?? []), ...(spell?.kind === 'spell' ? spell.scripts : [])] : src.scripts;
      for (const script of scripts) {
        if (!script.enabled || !script.events.includes(ev.kind)) continue;
        if (++runs > MAX_EMIT_RUNS) {
          sink.errors.push({ recordId: src.ability.id, scriptId: script.id, label: script.label ?? src.label, phase: 'run', message: `emit cascade exceeded ${MAX_EMIT_RUNS} script runs` });
          capped = true;
          break;
        }
        const patches: Patch[] = [];
        if (runOne(ctx, { phase: 'event', source: src, script, event: ev }, sink, patches) !== 'ok') continue;
        for (const p of patches) {
          all.push({ ...p, src: src.ability.id } as SourcedPatch);
          if (p.k === 'emit' && depth < MAX_EMIT_DEPTH) {
            queue.push({ ev: { kind: `custom:${p.name}`, payload: p.payload, ...(ev.targetId ? { targetId: ev.targetId } : {}) }, depth: depth + 1 });
          }
        }
      }
      if (capped) break;
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
export function applyPatches(ctx: EvalContext, state: State, patches: readonly Patch[], ability?: Ability, targetId?: string): State & { globals: Record<string, VarValue> } {
  let battle = state.battle;
  let character = state.character;
  let globals = state.globals ?? ctx.library.globals ?? {};
  const withCombatant = (id: string, fn: (c: Combatant) => Combatant) => {
    battle = { ...battle, combatants: battle.combatants.map((c) => (c.id === id ? fn(c) : c)) };
  };
  for (const p of patches) {
    switch (p.k) {
      case 'tag': {
        const cond: Conditioned = { tag: p.tag, expires: p.duration, appliedRound: battle.round, source: (p as SourcedPatch).src ?? ability?.id };
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
        if (Object.hasOwn(character.vars, p.name)) character = { ...character, vars: { ...character.vars, [p.name]: p.value } };
        else globals = { ...globals, [p.name]: p.value };
        break;
      case 'log': {
        const seq = (battle.log.at(-1)?.seq ?? 0) + 1;
        const entry: LogEvent = { id: newId('ev'), round: battle.round, seq, kind: 'note', actor: 'self', text: p.text };
        battle = { ...battle, log: [...battle.log, entry] };
        break;
      }
      case 'check': {
        // "For the monster": attached to the event currently being logged (the attack/use just appended).
        const last = battle.log.at(-1);
        if (last) {
          const entry = { name: p.name, save: p.save, dc: p.dc, effect: p.effect };
          battle = { ...battle, log: battle.log.map((e) => (e.id === last.id ? { ...e, checks: [...(e.checks ?? []), entry] } : e)) };
        }
        break;
      }
      case 'emit':
        break; // already cascaded by runEventScripts
    }
  }
  return { battle, character, globals };
}
