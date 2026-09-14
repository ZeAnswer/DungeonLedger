import { SIZE_MOD, abilityMod, findResourceDef, resourceUsed, targetTags, targetTagsInCategory, type AbilityInstance, type AttackCtx, type EvalContext } from './context';
import { evalCondition } from './conditions';
import { firstFailure, summarizeEffects } from './describe';
import { evalExpr } from './expr';
import { derivedFromLevels } from './levels';
import { activationsOf, poolsOf, type Ability, type Acquired, type Action, type Activation, type AttackKind, type AttackProfile, type BonusType, type Duration, type Effect, type EffectBlock, type StatId, type Value } from './schema';
import { stackBonuses, type BonusEntry, type StackedEntry } from './stacking';
import { exprVars } from './vars';

// ---------- result types ----------
export type BreakdownEntry = StackedEntry & { sourceName: string };
export type NearMiss = { source: string; sourceName: string; label: string; summary: string; failed: string };
export type DiceEntry = { dice: string; label: string; damageType?: string };
export type PromptRequest = { promptId: string; perTagCategory?: string; tag?: string; source: string; sourceName: string };

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

export type AttackMode = { modeId: string; label: string; base: 'single' | 'full'; extraAttacksAtTop: number; penalty: number; note?: string; source: string };

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

// ---------- sources ----------
export type Source = {
  ability: Ability;
  instance: AbilityInstance | undefined;
  kind: 'ability' | 'buff' | 'activation';
  activation?: Activation;
  /** Blocks this source contributes right now. */
  blocks: EffectBlock[];
  /** Shown in breakdowns and near-miss lists. */
  label: string;
};

/** Every record/activation currently contributing blocks: enabled features and equipped items (their `effects`), active statuses and grant buffs (record `effects`), and running activations (`whileActive` plus the cast spell's `effects`). */
export function activeSources(ctx: EvalContext, warnings: string[] = []): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const suppressed = new Set(ctx.battle?.suppressedAbilities ?? []);
  const push = (key: string, s: Source) => { if (seen.has(key)) return; seen.add(key); out.push(s); };
  for (const inst of ctx.character.abilities) {
    if (!inst.enabled || suppressed.has(inst.abilityId)) continue;
    const ability = ctx.library.abilities[inst.abilityId];
    if (!ability) { warnings.push(`Unknown ability "${inst.abilityId}" on character; ignored.`); continue; }
    if (ability.kind === 'status' || ability.kind === 'spell') continue; // only while active
    push(ability.id, { ability, instance: inst, kind: 'ability', blocks: ability.effects, label: ability.name });
  }
  for (const buff of ctx.battle?.activeBuffs ?? []) {
    if (buff.owner !== 'self' || buff.suppressed || suppressed.has(buff.abilityId)) continue;
    const ability = ctx.library.abilities[buff.abilityId] ?? ctx.battle?.statuses.find((s) => s.id === buff.abilityId);
    if (!ability) { warnings.push(`Unknown buff "${buff.abilityId}"; ignored.`); continue; }
    const instance = ctx.character.abilities.find((a) => a.abilityId === buff.abilityId);
    if (buff.activationId) {
      const activation = activationsOf(ability).find((x) => x.id === buff.activationId);
      if (!activation) { warnings.push(`${ability.name} has no activation "${buff.activationId}"; ignored.`); continue; }
      const spell = activation.spell ? ctx.library.abilities[activation.spell] : undefined;
      push(`${ability.id}/${activation.id}`, { ability, instance, kind: 'activation', activation, blocks: [...activation.whileActive, ...(spell?.kind === 'spell' ? spell.effects : [])], label: activation.name ?? spell?.name ?? ability.name });
    } else {
      push(ability.id, { ability, instance, kind: 'buff', blocks: ability.effects, label: ability.name });
    }
  }
  return out;
}

type Applied = { source: Source; block: EffectBlock; effect: Effect };

function relevantToStat(e: Effect, stat: StatId | undefined): boolean {
  if (!stat) return true;
  switch (e.verb) {
    case 'modify': return e.to === stat || ((stat === 'ac.touch' || stat === 'ac.flatFooted') && e.to === 'ac');
    case 'dice': return stat === 'damage';
    case 'flag': case 'attack': return stat === 'attack';
    case 'note': return stat === 'attack' || stat === 'damage';
    default: return false;
  }
}

function kindMatches(attackKind: AttackKind | undefined, ctx: EvalContext): boolean {
  return attackKind === undefined || ctx.attack?.kind === attackKind;
}

/** Touch AC ignores armor/shield/natural; flat-footed AC ignores dodge. */
function acVariantAccepts(stat: StatId, bonusType: BonusType): boolean {
  if (stat === 'ac.touch') return !['armor', 'shield', 'natural'].includes(bonusType);
  if (stat === 'ac.flatFooted') return bonusType !== 'dodge';
  return true;
}

/** Walk effect blocks with a trigger; return applied effects plus near-misses relevant to `stat`. */
export function collectEffects(ctx: EvalContext, stat?: StatId, trigger: EffectBlock['trigger'] = 'always') {
  const warnings: string[] = [];
  const applied: Applied[] = [];
  const nearMiss: NearMiss[] = [];
  for (const source of activeSources(ctx, warnings)) {
    const sctx: EvalContext = { ...ctx, abilityInstance: source.instance };
    for (const block of source.blocks) {
      if (block.trigger !== trigger) continue;
      const relevant = block.do.filter((e) => relevantToStat(e, stat));
      if (relevant.length === 0) continue;
      if (evalCondition(block.when, sctx)) {
        for (const effect of relevant) applied.push({ source, block, effect });
      } else if (stat && !('all' in block.when && block.when.all.length === 0)) {
        const failed = firstFailure(block.when, sctx) ?? 'condition not met';
        nearMiss.push({ source: source.ability.id, sourceName: source.label, label: block.label ?? source.label, summary: summarizeEffects(block.do), failed });
      }
    }
  }
  return { applied, nearMiss, warnings };
}

function tableValue(table: { upTo?: number; value: number }[], v: number): number {
  for (const row of table) if (row.upTo === undefined || v <= row.upTo) return row.value;
  return table[table.length - 1]!.value;
}

function base(label: string, value: number, bonusType: BonusType = 'untyped'): BonusEntry {
  return { source: 'base', label, value, bonusType };
}

// ---------- flags ----------
let flagsDepth = 0;
/** Boolean flags set by active abilities (ignoreConcealment, neverFlatFooted, immune.x, sense.x). */
export function resolveFlags(ctx: EvalContext): Record<string, boolean> {
  if (flagsDepth > 0) return {}; // a flag condition inside a flag block: treat nested reads as off
  flagsDepth++;
  try {
    const out: Record<string, boolean> = {};
    for (const source of activeSources(ctx)) {
      const sctx: EvalContext = { ...ctx, abilityInstance: source.instance };
      for (const block of source.blocks) {
        if (block.trigger !== 'always' || !block.do.some((e) => e.verb === 'flag')) continue;
        if (!evalCondition(block.when, sctx)) continue;
        for (const e of block.do) if (e.verb === 'flag') out[e.flag] = e.value;
      }
    }
    return out;
  } finally { flagsDepth--; }
}

// ---------- attack profiles ----------
const WEAPON_PROFILE_PREFIX = 'weapon:';

/** Attack profiles: equipped weapon items first, then the character's manual list, then natural attacks from effects. */
export function attackProfiles(ctx: EvalContext): (AttackProfile & { weaponAbilityId?: string })[] {
  const out: (AttackProfile & { weaponAbilityId?: string })[] = [];
  for (const i of ctx.character.inventory) {
    if (!i.equipped || !i.abilityId) continue;
    const a = ctx.library.abilities[i.abilityId];
    const w = a?.kind === 'item' ? a.item.weapon : undefined;
    if (!a || !w) continue;
    out.push({ id: `${WEAPON_PROFILE_PREFIX}${a.id}`, name: a.name, kind: w.kind, baseDice: w.dice, enhancement: w.enhancement, critRange: w.critRange, critMult: w.critMult, ...(w.rangeIncrement !== undefined ? { rangeIncrement: w.rangeIncrement } : {}), attackAbility: w.attackAbility, ...(w.damageAbility ? { damageAbility: w.damageAbility } : {}), ...(w.maxDamageAbilityBonus !== undefined ? { maxDamageAbilityBonus: w.maxDamageAbilityBonus } : {}), damageAbilityMultiplier: w.damageAbilityMultiplier, weaponAbilityId: a.id });
  }
  out.push(...ctx.character.attackProfiles);
  for (const { source, effect } of collectEffects(ctx, undefined).applied) {
    if (effect.verb === 'attack' && effect.naturalAttack) {
      const n = effect.naturalAttack;
      out.push({ id: `natural:${source.ability.id}:${n.name}`, name: `${n.name} (${source.label})`, kind: 'melee', baseDice: n.dice, enhancement: n.attackBonus, critRange: 20, critMult: 2, attackAbility: 'str', damageAbilityMultiplier: 1 });
    }
  }
  return out;
}

// ---------- base values ----------
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type Scores = Record<(typeof ABILITY_KEYS)[number], number>;

const inProgress = new Set<string>();

/** Ability scores after enhancement/inherent/etc. bonuses from active abilities and buffs. */
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

function statIsAttackLike(stat: StatId) {
  return stat === 'attack' || stat === 'damage' || stat === 'critRange' || stat === 'critMult';
}

function resolveValue(ctx: EvalContext, source: Source, value: Value, vars: ReturnType<typeof exprVars>, out: { warnings: string[]; promptsNeeded: PromptRequest[] }): number | undefined {
  if (typeof value !== 'object') return evalExpr(value, vars);
  const key = value.per && ctx.target ? targetTagsInCategory(ctx, ctx.target, value.per)[0] : undefined;
  const stored = value.per ? (key ? ctx.battle?.prompts[`${value.prompt}:${key}`] : undefined) : ctx.battle?.prompts[value.prompt];
  if (stored === undefined) {
    const req: PromptRequest = { promptId: value.prompt, ...(value.per ? { perTagCategory: value.per } : {}), ...(key ? { tag: key } : {}), source: source.ability.id, sourceName: source.label };
    if (!out.promptsNeeded.some((p) => p.promptId === req.promptId && p.source === req.source)) out.promptsNeeded.push(req);
    const vs = key ? ` vs ${ctx.library.tags[key]?.label ?? key}` : value.per && !ctx.target ? ' (pick a target)' : '';
    const w = `${source.label}: needs a ${value.prompt[0]!.toUpperCase()}${value.prompt.slice(1)} check${vs}`;
    if (!out.warnings.includes(w)) out.warnings.push(w);
    return undefined;
  }
  return tableValue(value.table, stored);
}

/** Interpolate {expr} placeholders in note text. */
export function interpolate(text: string, vars: ReturnType<typeof exprVars>): string {
  return text.replace(/\{([^}]+)\}/g, (_, e: string) => { try { return String(evalExpr(e.trim(), vars)); } catch { return `{${e}}`; } });
}

// ---------- resolveStat ----------
export function resolveStat(ctx: EvalContext, stat: StatId): StatResult {
  const guardKey = stat;
  if (inProgress.has(guardKey)) {
    // re-entrant read of the same stat (a condition on this stat inside its own bonus): base only
    const warnings: string[] = [];
    const { entries } = baseEntries({ ...ctx }, stat, warnings);
    const st = stackBonuses(entries);
    return { stat, total: st.total, entries: st.entries.map((e) => ({ ...e, sourceName: 'Base' })), dice: [], flags: {}, notes: [], warnings, nearMiss: [], promptsNeeded: [] };
  }
  inProgress.add(guardKey);
  try {
    const warnings: string[] = [];
    const { entries, dice } = baseEntries(ctx, stat, warnings);
    const bonuses: BonusEntry[] = [...entries];
    const names: Record<string, string> = { base: 'Base' };
    const notes: string[] = [];
    const promptsNeeded: PromptRequest[] = [];
    const vars = exprVars(ctx, { rawScores: stat.startsWith('ability.') });
    const sets: number[] = [];
    let multiplier = 1;

    const col = collectEffects(ctx, stat);
    warnings.push(...col.warnings);
    for (const { source, block, effect } of col.applied) {
      names[source.ability.id] = source.label;
      const label = block.label ?? source.label;
      switch (effect.verb) {
        case 'modify': {
          if (statIsAttackLike(stat) && !kindMatches(effect.attackKind, ctx)) break;
          if (!acVariantAccepts(stat, effect.type)) break;
          const v = resolveValue(ctx, source, effect.value, vars, { warnings, promptsNeeded });
          if (v === undefined) break;
          const lab = typeof effect.value === 'object' ? `${label} (${ctx.battle?.prompts[effect.value.per && ctx.target ? `${effect.value.prompt}:${targetTagsInCategory(ctx, ctx.target, effect.value.per)[0]}` : effect.value.prompt]})` : label;
          if (effect.mode === 'set') sets.push(v);
          else if (effect.mode === 'multiply') multiplier *= v;
          else bonuses.push({ source: source.ability.id, label: lab, value: v, bonusType: effect.type });
          break;
        }
        case 'dice':
          if (!kindMatches(effect.attackKind, ctx)) break;
          dice.push({ dice: effect.dice, label: effect.label ?? source.label, ...(effect.damageType ? { damageType: effect.damageType } : {}) });
          break;
        case 'note': {
          const text = interpolate(effect.text, vars) + (effect.dc !== undefined ? ` (DC ${(() => { try { return evalExpr(effect.dc, vars); } catch { return '?'; } })()})` : '');
          if (!notes.includes(text)) notes.push(text);
          break;
        }
        default: break;
      }
    }

    const stacked = stackBonuses(bonuses);
    let total = stacked.total;
    if (sets.length) total = Math.max(...sets);
    total = Math.round(total * multiplier);
    const result: StatResult = {
      stat, total,
      entries: stacked.entries.map((e) => ({ ...e, sourceName: names[e.source] ?? e.source })),
      dice, flags: stat === 'attack' ? resolveFlags(ctx) : {}, notes, warnings, nearMiss: col.nearMiss, promptsNeeded,
    };
    if (stat === 'critRange') result.total = 21 - Math.max(1, Math.min(20, total));
    return result;
  } finally { inProgress.delete(guardKey); }
}

// ---------- attack modes ----------
export function listAttackModes(ctx: EvalContext, profileId: string): AttackMode[] {
  const profile = attackProfiles(ctx).find((p) => p.id === profileId);
  if (!profile) return [];
  const modes: AttackMode[] = [
    { modeId: 'single', label: 'Single attack', base: 'single', extraAttacksAtTop: 0, penalty: 0, source: 'base' },
    { modeId: 'full', label: 'Full attack', base: 'full', extraAttacksAtTop: 0, penalty: 0, source: 'base' },
  ];
  const actx: EvalContext = { ...ctx, attack: { profile, kind: profile.kind, index: 1, modeId: 'single', ...(profile.weaponAbilityId ? { weaponAbilityId: profile.weaponAbilityId } : {}) } };
  for (const { source, effect } of collectEffects(actx, 'attack').applied) {
    if (effect.verb !== 'attack' || !effect.mode || !kindMatches(effect.attackKind, actx)) continue;
    modes.push({ modeId: effect.mode.id, label: effect.mode.label, base: effect.mode.base, extraAttacksAtTop: effect.extraAttacks, penalty: effect.penaltyAll, source: source.ability.id, ...(effect.mode.note ? { note: effect.mode.note } : {}) });
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
  for (const { effect } of collectEffects({ ...ctx, attack: mk(1) }, 'attack').applied) {
    if (effect.verb === 'attack' && !effect.mode && effect.extraAttacks > 0 && (effect.appliesToBase === 'any' || (effect.appliesToBase ?? 'full') === mode.base) && kindMatches(effect.attackKind, { ...ctx, attack: mk(1) })) {
      for (let i = 0; i < effect.extraAttacks; i++) babs.unshift(top);
    }
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
    const nearMiss = [...atk.nearMiss];
    for (const nm of dmg.nearMiss) if (!nearMiss.some((x) => x.source === nm.source && x.label === nm.label)) nearMiss.push(nm);
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
      const ectx: EvalContext = { ...ctx, abilityInstance: inst };
      const blocks = [...act.onUse, ...act.whileActive];
      let eligible = true;
      const notes: string[] = [];
      if (blocks.length) {
        const passing = blocks.filter((b) => evalCondition(b.when, ectx));
        eligible = passing.length > 0;
        if (!eligible) for (const b of blocks) { const f = firstFailure(b.when, ectx); if (f) reasons.push(`Needs: ${f}`); }
        for (const b of passing) for (const e of b.do) if (e.verb === 'note') notes.push(interpolate(e.text, vars));
      }
      const duration = act.duration ?? (spell?.kind === 'spell' ? spell.duration : undefined);
      const active = !!ctx.battle?.activeBuffs.some((b) => b.abilityId === ability.id && b.activationId === act.id && !b.suppressed);
      out.push({
        abilityId: ability.id, activationId: act.id, name, recordName: ability.name, kind: ability.kind,
        ...(ability.kind === 'feature' ? { acquired: ability.acquired } : {}),
        action: act.action, declare: duration === 'thisAttack' || duration === 'thisTurn', ...(duration ? { duration } : {}),
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
