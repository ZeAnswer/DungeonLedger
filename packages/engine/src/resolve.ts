import { SIZE_MOD, abilityMod, findResourceDef, resourceUsed, targetTags, type AttackCtx, type EvalContext } from './context';
import { evalExpr } from './expr';
import { derivedFromLevels } from './levels';
import { activationsOf, poolsOf, type Ability, type Acquired, type Action, type AttackProfile, type BonusType, type Duration, type StatId } from './schema';
import { activeSources, computePass, runOne, type ScriptSource } from './scripts/compute';
import { setStatResolver } from './scripts/registry';
import { newSink, type AttackMode, type DiceEntry, type NearMiss, type PromptRequest, type Sink } from './scripts/sink';
import { stackBonuses, type BonusEntry, type StackedEntry } from './stacking';
import { exprVars } from './vars';

// ---------- result types ----------
export type BreakdownEntry = StackedEntry & { sourceName: string };

export type StatResult = {
  stat: StatId;
  total: number;
  entries: BreakdownEntry[];
  dice: DiceEntry[];
  flags: Record<string, boolean>;
  notes: string[];
  warnings: string[];
  nearMiss: NearMiss[];
  promptsNeeded: PromptRequest[];
};

export type AttackResult = {
  index: number;
  attackBonus: number;
  attackBreakdown: BreakdownEntry[];
  damage: { flat: number; dice: DiceEntry[]; breakdown: BreakdownEntry[] };
  critRange: number;
  critMult: number;
  ignoreConcealment: boolean;
  nearMiss: NearMiss[];
};

export type AttackSequenceResult = {
  profileId: string;
  modeId: string;
  modeLabel: string;
  attacks: AttackResult[];
  notes: string[];
  warnings: string[];
  promptsNeeded: PromptRequest[];
};

export type ActionInfo = {
  abilityId: string;
  activationId: string;
  /** Activation name (or the spell's, or the record's). */
  name: string;
  recordName: string;
  kind: Ability['kind'];
  acquired?: Acquired;
  action: Action;
  /** Lasts one attack or one turn: shown as a pre-roll chip. */
  declare: boolean;
  duration?: Duration;
  charges?: { id: string; label: string; remaining: number; max: number; resetOn: string };
  costText: string[];
  active: boolean;
  usable: boolean;
  eligible: boolean;
  reasons: string[];
  notes: string[];
};

export type PoolInfo = { id: string; label: string; remaining: number; max: number; resetOn: string; abilityId: string };

/** What a record contributes right now. The scripts model's name for it is `ScriptSource`. */
export type Source = ScriptSource;

/** Touch AC ignores armor/shield/natural; flat-footed AC ignores dodge. */
export function acVariantAccepts(stat: StatId, bonusType: BonusType): boolean {
  if (stat === 'ac.touch') return !['armor', 'shield', 'natural'].includes(bonusType);
  if (stat === 'ac.flatFooted') return bonusType !== 'dodge';
  return true;
}

function base(label: string, value: number, bonusType: BonusType = 'untyped'): BonusEntry {
  return { source: 'base', label, value, bonusType };
}

/** "Knowledge Devotion: needs a Knowledge check vs Aberration" — the chip the battle screen shows. */
function promptWarning(ctx: EvalContext, p: PromptRequest): string {
  const vs = p.tag ? ` vs ${ctx.library.tags[p.tag]?.label ?? p.tag}` : p.perTagCategory && !ctx.target ? ' (pick a target)' : '';
  return `${p.sourceName}: needs a ${p.promptId[0]!.toUpperCase()}${p.promptId.slice(1)} check${vs}`;
}

// ---------- flags ----------
/** Boolean flags set by active scripts (ignoreConcealment, neverFlatFooted, immune.x, sense.x). */
export function resolveFlags(ctx: EvalContext): Record<string, boolean> {
  return computePass(ctx).flags;
}

// ---------- attack profiles ----------
const WEAPON_PROFILE_PREFIX = 'weapon:';

/** Attack profiles: equipped weapon items first, then the character's manual list, then natural attacks from scripts. */
export function attackProfiles(ctx: EvalContext): (AttackProfile & { weaponAbilityId?: string })[] {
  const out: (AttackProfile & { weaponAbilityId?: string })[] = [];
  for (const i of ctx.character.inventory) {
    if (!i.equipped || !i.abilityId) continue;
    const a = ctx.library.abilities[i.abilityId];
    const w = a?.kind === 'item' ? a.item.weapon : undefined;
    if (!a || !w) continue;
    out.push({ id: `${WEAPON_PROFILE_PREFIX}${a.id}`, name: a.name, kind: w.kind, baseDice: w.dice, enhancement: w.enhancement, critRange: w.critRange, critMult: w.critMult, ...(w.rangeIncrement !== undefined ? { rangeIncrement: w.rangeIncrement } : {}), attackAbility: w.attackAbility, ...(w.damageAbility ? { damageAbility: w.damageAbility } : {}), ...(w.maxDamageAbilityBonus !== undefined ? { maxDamageAbilityBonus: w.maxDamageAbilityBonus } : {}), damageAbilityMultiplier: w.damageAbilityMultiplier, weaponAbilityId: a.id });
  }
  // Hand-written profiles that duplicate an equipped weapon (older characters listed the bow twice) are hidden.
  const weaponNames = new Set(out.map((p) => p.name.trim().toLowerCase()));
  out.push(...ctx.character.attackProfiles.filter((p) => !weaponNames.has(p.name.trim().toLowerCase())));
  for (const n of computePass(ctx).naturals) {
    out.push({ id: `natural:${n.source}:${n.name}`, name: `${n.name} (${n.sourceName})`, kind: 'melee', baseDice: n.dice, enhancement: n.attackBonus, critRange: 20, critMult: 2, attackAbility: 'str', damageAbilityMultiplier: 1 });
  }
  return out;
}

// ---------- base values ----------
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type Scores = Record<(typeof ABILITY_KEYS)[number], number>;

const inProgress = new Set<string>();

/** Ability scores after enhancement/inherent/etc. bonuses from active records and buffs. */
export function effectiveScores(ctx: EvalContext): Scores {
  const out = { ...ctx.character.abilityScores };
  for (const k of ABILITY_KEYS) out[k] = resolveStat(ctx, `ability.${k}`).total;
  return out;
}

function baseEntries(ctx: EvalContext, stat: StatId, warnings: string[]): { entries: BonusEntry[]; dice: DiceEntry[] } {
  const c = ctx.character;
  const s = stat.startsWith('ability.') || inProgress.size > 6 ? c.abilityScores : effectiveScores(ctx);
  const d = derivedFromLevels(c, ctx.library);
  warnings.push(...d.warnings);
  const sizeMod = SIZE_MOD[c.size];
  const dice: DiceEntry[] = [];
  const entries: BonusEntry[] = [];
  const a = ctx.attack;

  switch (stat) {
    case 'attack':
      entries.push(base('Base attack', d.bab));
      if (a) {
        entries.push(base(`${a.profile.attackAbility.toUpperCase()} mod`, abilityMod(s[a.profile.attackAbility])));
        if (a.profile.enhancement) entries.push(base(`${a.profile.name} enhancement`, a.profile.enhancement, 'enhancement'));
      }
      if (sizeMod) entries.push(base('Size', sizeMod, 'size'));
      break;
    case 'damage':
      if (a) {
        dice.push({ dice: a.profile.baseDice, label: a.profile.name });
        if (a.profile.damageAbility) {
          let mod = Math.floor(abilityMod(s[a.profile.damageAbility]) * a.profile.damageAbilityMultiplier);
          if (a.profile.maxDamageAbilityBonus !== undefined) mod = Math.min(mod, a.profile.maxDamageAbilityBonus);
          entries.push(base(`${a.profile.damageAbility.toUpperCase()} mod`, mod));
        }
        if (a.profile.enhancement) entries.push(base(`${a.profile.name} enhancement`, a.profile.enhancement, 'enhancement'));
      }
      break;
    case 'ac': case 'ac.touch': case 'ac.flatFooted':
      entries.push(base('Base', 10));
      if (stat !== 'ac.flatFooted') entries.push(base('DEX mod', abilityMod(s.dex)));
      if (stat !== 'ac.touch') {
        if (c.baseArmor) entries.push(base('Armor', c.baseArmor, 'armor'));
        if (c.baseShield) entries.push(base('Shield', c.baseShield, 'shield'));
        if (c.baseNaturalArmor) entries.push(base('Natural armor', c.baseNaturalArmor, 'natural'));
      }
      if (sizeMod) entries.push(base('Size', sizeMod, 'size'));
      break;
    case 'save.fort': entries.push(base('Base save', d.baseSaves.fort), base('CON mod', abilityMod(s.con))); break;
    case 'save.ref': entries.push(base('Base save', d.baseSaves.ref), base('DEX mod', abilityMod(s.dex))); break;
    case 'save.will': entries.push(base('Base save', d.baseSaves.will), base('WIS mod', abilityMod(s.wis))); break;
    case 'init': entries.push(base('DEX mod', abilityMod(s.dex))); break;
    case 'hp.max':
      if (d.hpFromLevels !== undefined) {
        const con = abilityMod(s.con);
        const levels = c.levelHistory.length;
        const fromCon = c.levelHistory.reduce((sum, r) => sum + Math.max(1, r.hpRolled + con) - r.hpRolled, 0);
        entries.push(base('Hit dice rolled', d.hpRolledTotal), base(`CON mod × ${levels} levels${con < 0 ? ' (min 1 hp/level)' : ''}`, fromCon));
      } else entries.push(base('Max HP', c.hp.max));
      if (c.hpAdjust) entries.push(base('Adjustment', c.hpAdjust));
      break;
    case 'speed': entries.push(base('Base speed', c.speed)); break;
    case 'critRange': entries.push(base('Threat range', a ? 21 - a.profile.critRange : 1)); break;
    case 'critMult': entries.push(base('Multiplier', a ? a.profile.critMult : 2)); break;
    case 'casterLevel': case 'spellDC': case 'dr': case 'sr': break;
    default: {
      if (stat.startsWith('ability.')) { entries.push(base('Base score', c.abilityScores[stat.slice(8) as 'str'])); break; }
      if (stat.startsWith('resist.')) break;
      if (stat.startsWith('skill.')) {
        const id = stat.slice('skill.'.length);
        const skill = ctx.library.skills[id];
        if (!skill) { warnings.push(`Unknown skill "${id}".`); break; }
        entries.push(base('Ranks', c.skills[id]?.ranks ?? 0), base(`${skill.ability.toUpperCase()} mod`, abilityMod(s[skill.ability])));
      }
    }
  }
  return { entries, dice };
}

/** Interpolate {expr} placeholders in note text (hand-written text outside scripts). */
export function interpolate(text: string, vars: ReturnType<typeof exprVars>): string {
  return text.replace(/\{([^}]+)\}/g, (_, e: string) => { try { return String(evalExpr(e.trim(), vars)); } catch { return `{${e}}`; } });
}

// ---------- resolveStat ----------
export function resolveStat(ctx: EvalContext, stat: StatId): StatResult {
  if (inProgress.has(stat)) {
    // re-entrant read of the same stat (a script reading the stat it is contributing to): base only
    const warnings: string[] = [];
    const { entries } = baseEntries(ctx, stat, warnings);
    const st = stackBonuses(entries);
    return { stat, total: st.total, entries: st.entries.map((e) => ({ ...e, sourceName: 'Base' })), dice: [], flags: {}, notes: [], warnings, nearMiss: [], promptsNeeded: [] };
  }
  inProgress.add(stat);
  try {
    const warnings: string[] = [];
    const { entries, dice } = baseEntries(ctx, stat, warnings);
    const sink = computePass(ctx);
    const wanted = (s: StatId) => s === stat || ((stat === 'ac.touch' || stat === 'ac.flatFooted') && s === 'ac');
    const bonuses: BonusEntry[] = [
      ...entries,
      ...sink.bonuses.filter((b) => wanted(b.stat) && acVariantAccepts(stat, b.bonusType)).map(({ stat: _s, ...b }) => b),
    ];
    const names: Record<string, string> = { base: 'Base' };
    for (const s of activeSources(ctx)) names[s.ability.id] = s.label;
    const sets = sink.sets.filter((s) => wanted(s.stat)).map((s) => s.value);
    const multiplier = sink.multipliers.filter((m) => wanted(m.stat)).reduce((f, m) => f * m.factor, 1);
    const stacked = stackBonuses(bonuses);
    let total = sets.length ? Math.max(...sets) : stacked.total;
    total = Math.round(total * multiplier);
    const attackLike = stat === 'attack' || stat === 'damage';
    const result: StatResult = {
      stat, total,
      entries: stacked.entries.map((e) => ({ ...e, sourceName: names[e.source] ?? e.source })),
      dice: stat === 'damage' ? [...dice, ...sink.dice] : dice,
      flags: stat === 'attack' ? { ...sink.flags } : {},
      notes: attackLike ? [...new Set(sink.notes.map((n) => n.text))] : [],
      warnings: [...warnings, ...sink.warnings, ...sink.prompts.map((p) => promptWarning(ctx, p)), ...sink.errors.map((e) => `${e.label}: ${e.message}`)],
      nearMiss: attackLike ? [...sink.skipped] : [],
      promptsNeeded: [...sink.prompts],
    };
    if (stat === 'critRange') result.total = 21 - Math.max(1, Math.min(20, total));
    return result;
  } finally { inProgress.delete(stat); }
}

/**
 * The script api reads `player.stats.*` / `player.mod.*` through this; registering it here (instead of
 * importing resolve.ts from the api) keeps resolve → scripts a one-way dependency.
 */
setStatResolver(resolveStat);

// ---------- attack modes ----------
export function listAttackModes(ctx: EvalContext, profileId: string): AttackMode[] {
  const profile = attackProfiles(ctx).find((p) => p.id === profileId);
  if (!profile) return [];
  const modes: AttackMode[] = [
    { modeId: 'single', label: 'Single attack', base: 'single', extraAttacksAtTop: 0, penalty: 0, source: 'base' },
    { modeId: 'full', label: 'Full attack', base: 'full', extraAttacksAtTop: 0, penalty: 0, source: 'base' },
  ];
  const actx: EvalContext = { ...ctx, attack: { profile, kind: profile.kind, index: 1, modeId: 'single', ...(profile.weaponAbilityId ? { weaponAbilityId: profile.weaponAbilityId } : {}) } };
  // Copied out of the cached sink: callers (and the app) must not be able to edit a pass in place.
  for (const m of computePass(actx).modes) {
    if (m.kind && m.kind !== profile.kind) continue;
    modes.push({ ...m });
  }
  return modes;
}

export type ResolveAttackOptions = { profileId: string; modeId: string };

export function resolveAttack(ctx: EvalContext, opts: ResolveAttackOptions): AttackSequenceResult {
  const profile = attackProfiles(ctx).find((p) => p.id === opts.profileId);
  if (!profile) throw new Error(`Unknown attack profile "${opts.profileId}"`);
  const mode = listAttackModes(ctx, opts.profileId).find((m) => m.modeId === opts.modeId);
  if (!mode) throw new Error(`Attack mode "${opts.modeId}" not available for ${profile.name}`);

  const d = derivedFromLevels(ctx.character, ctx.library);
  const top = d.iterativeAttacks[0] ?? 0;
  const babs = mode.base === 'full' ? [...d.iterativeAttacks] : [top];
  for (let i = 0; i < mode.extraAttacksAtTop; i++) babs.unshift(top);

  const mk = (index: number): AttackCtx => ({ profile, kind: profile.kind, index, modeId: mode.modeId, ...(profile.weaponAbilityId ? { weaponAbilityId: profile.weaponAbilityId } : {}) });
  for (const e of computePass({ ...ctx, attack: mk(1) }).extraAttacks) {
    if (e.kind && e.kind !== profile.kind) continue;
    if (e.base !== 'any' && e.base !== mode.base) continue;
    for (let i = 0; i < e.n; i++) babs.unshift(top);
  }

  const notes: string[] = [];
  const warnings: string[] = [];
  const promptsNeeded: PromptRequest[] = [];
  if (mode.note) notes.push(mode.note);
  const attacks: AttackResult[] = babs.map((bab, i) => {
    const actx: EvalContext = { ...ctx, attack: mk(i + 1) };
    const atk = resolveStat(actx, 'attack');
    const entries = atk.entries.map((e) => (e.source === 'base' && e.label === 'Base attack' ? { ...e, value: bab, label: i === 0 ? 'Base attack' : 'Base attack (iterative)' } : e));
    let attackBonus = atk.total - d.bab + bab;
    if (mode.penalty) {
      entries.push({ source: mode.source, sourceName: mode.label, label: mode.label, value: mode.penalty, bonusType: 'untyped', applied: true });
      attackBonus += mode.penalty;
    }
    const dmg = resolveStat(actx, 'damage');
    const crit = resolveStat(actx, 'critRange');
    const mult = resolveStat(actx, 'critMult');
    for (const n of [...atk.notes, ...dmg.notes]) if (!notes.includes(n)) notes.push(n);
    for (const w of [...atk.warnings, ...dmg.warnings]) if (!warnings.includes(w)) warnings.push(w);
    for (const p of [...atk.promptsNeeded, ...dmg.promptsNeeded]) if (!promptsNeeded.some((x) => x.promptId === p.promptId && x.source === p.source)) promptsNeeded.push(p);
    const nearMiss: NearMiss[] = [];
    for (const nm of [...atk.nearMiss, ...dmg.nearMiss]) if (!nearMiss.some((x) => x.source === nm.source && x.label === nm.label)) nearMiss.push(nm);
    return {
      index: i + 1, attackBonus, attackBreakdown: entries,
      damage: { flat: dmg.total, dice: dmg.dice, breakdown: dmg.entries },
      critRange: crit.total, critMult: mult.total, ignoreConcealment: !!atk.flags.ignoreConcealment, nearMiss,
    };
  });

  return { profileId: profile.id, modeId: mode.modeId, modeLabel: mode.label, attacks, notes, warnings, promptsNeeded };
}

// ---------- actions ----------
function chargeInfo(ctx: EvalContext, id: string, vars: ReturnType<typeof exprVars>, fallbackLabel: string) {
  const d = findResourceDef(ctx, id);
  if (!d) return undefined;
  const max = evalExpr(d.def.max, vars);
  return { id: d.def.id, label: d.def.label ?? fallbackLabel, remaining: max - resourceUsed(ctx, d.def.id, d.def.resetOn), max, resetOn: d.def.resetOn };
}

/** Did the probe run produce anything at all? Then the activation applies, whatever else was skipped. */
function sinkEmitted(s: Sink): boolean {
  return !!(s.bonuses.length || s.sets.length || s.multipliers.length || s.dice.length || s.notes.length || s.modes.length
    || s.extraAttacks.length || s.naturals.length || s.prompts.length || Object.keys(s.flags).length || Object.keys(s.slots).length);
}

/** One row per activation of every enabled feature and equipped item. */
export function availableActions(ctx: EvalContext): ActionInfo[] {
  const out: ActionInfo[] = [];
  const vars = exprVars(ctx);
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) continue;
    for (const act of activationsOf(ability)) {
      const spell = act.spell ? ctx.library.abilities[act.spell] : undefined;
      const name = act.name ?? spell?.name ?? ability.name;
      const reasons: string[] = [];
      const charges = act.charges ? chargeInfo(ctx, act.id, vars, name) : undefined;
      let usable = true;
      if (charges && charges.remaining <= 0) { usable = false; reasons.push(`No charges left (${charges.remaining}/${charges.max} per ${charges.resetOn})`); }
      const costText: string[] = [];
      for (const c of act.cost) {
        if (c.kind === 'charge') { const p = chargeInfo(ctx, c.resourceId, vars, c.resourceId); const n = evalExpr(c.amount, vars); costText.push(`${n} ${p?.label ?? c.resourceId}`); if (p && p.remaining < n) { usable = false; reasons.push(`Not enough ${p.label} (${p.remaining}/${p.max})`); } }
        else if (c.kind === 'item') { const have = ctx.character.inventory.filter((i) => i.abilityId === c.abilityId).reduce((s, i) => s + i.quantity, 0); costText.push(`${c.quantity} ${ctx.library.abilities[c.abilityId]?.name ?? c.abilityId}`); if (have < c.quantity) { usable = false; reasons.push('None left'); } }
        else if (c.kind === 'hp') costText.push(`${evalExpr(c.amount, vars)} hp`);
        else if (c.kind === 'spellSlot') costText.push(`level ${c.level} slot`);
        else costText.push(`${c.amount} ${c.kind}`);
      }
      // Eligibility probe: run the activation's `always` scripts as if it were already running, into a
      // throwaway sink. Skips become "Needs: …" reasons; anything the probe emitted means it applies.
      const always = [...act.scripts, ...(spell?.kind === 'spell' ? spell.scripts : [])].filter((s) => s.enabled && s.events.includes('always'));
      const probe = newSink();
      let eligible = true;
      const notes: string[] = [];
      if (always.length) {
        const source = { ability, instance: inst, activation: act, label: name };
        for (const script of always) runOne(ctx, { phase: 'always', source, script, probeActive: true, probe: true }, probe, []);
        eligible = probe.skipped.length === 0 || sinkEmitted(probe);
        if (!eligible) for (const s of probe.skipped) reasons.push(`Needs: ${s.failed}`);
        notes.push(...new Set(probe.notes.map((n) => n.text)));
      }
      const duration = act.duration ?? (spell?.kind === 'spell' ? spell.duration : undefined);
      const active = !!ctx.battle?.activeBuffs.some((b) => b.owner === 'self' && b.abilityId === ability.id && b.activationId === act.id && !b.suppressed);
      out.push({
        abilityId: ability.id, activationId: act.id, name, recordName: ability.name, kind: ability.kind,
        ...(ability.kind === 'feature' ? { acquired: ability.acquired } : {}),
        action: act.action, declare: duration === 'thisAttack' || duration === 'untilMyNextTurn', ...(duration !== undefined ? { duration } : {}),
        ...(charges ? { charges } : {}), costText, active, usable, eligible, reasons, notes,
      });
    }
  }
  return out;
}

/** Shared pools on enabled records (not inline activation charges). */
export function listPools(ctx: EvalContext): PoolInfo[] {
  const out: PoolInfo[] = [];
  const vars = exprVars(ctx);
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    for (const p of poolsOf(ability)) {
      const max = evalExpr(p.max, vars);
      out.push({ id: p.id, label: p.label ?? ability!.name, remaining: max - resourceUsed(ctx, p.id, p.resetOn), max, resetOn: p.resetOn, abilityId: ability!.id });
    }
  }
  return out;
}

export { targetTags };
