import type { EvalContext } from '../../src/context';
import { AbilitySchema } from '../../src/schema';
import { readSelector } from '../../src/selectors';
import { API_NAMES, makeApi, ScriptSkip, type Patch, type Trace } from '../../src/scripts/api';
import { compile } from '../../src/scripts/compile';
import { setStatResolver } from '../../src/scripts/registry';
import { newSink } from '../../src/scripts/sink';
import { HURT, ROUND, SIZE } from '../../src/scripts/units';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

// Task 6 registers the real resolveStat; here a stand-in over the raw character.
setStatResolver((ctx: EvalContext, stat: string) => {
  const ability = /^ability\.(str|dex|con|int|wis|cha)$/.exec(stat);
  if (ability) return { total: ctx.character.abilityScores[ability[1] as 'dex'] };
  if (stat === 'hp.max') return { total: ctx.character.hp.max };
  return { total: 0 };
});

const feat = AbilitySchema.parse({ id: 'f', name: 'Feat', kind: 'feature', params: { types: { kind: 'tags', category: 'creatureType' } } });

function setup(phase: 'always' | 'event' = 'always') {
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration', 'aquatic'], size: 'large', hurt: 'bloodied', distanceFeet: 20 })], toggles: { sniping: true }, tags: ['underwater'], prompts: { 'knowledge:aberration': 24 } });
  const ctx = makeCtx({
    character: makeCharacter({ abilities: [{ abilityId: 'f', enabled: true, paramValues: { types: ['aberration'] } }, { abilityId: 'other', enabled: true, paramValues: { types: ['dragon'] } }, { abilityId: 'off', enabled: false, paramValues: { types: ['giant'] } }], vars: { trophyMultiplier: 2 } }),
    battle,
    target: battle.combatants[0],
    attack: { profile: { id: 'bow', name: 'Bow', kind: 'ranged', baseDice: '1d8', enhancement: 1, critRange: 20, critMult: 3, attackAbility: 'dex', damageAbilityMultiplier: 1 }, kind: 'ranged', index: 2, modeId: 'full' },
  });
  ctx.library.abilities['f'] = feat;
  ctx.library.globals = { season: 'winter' };
  const sink = newSink();
  const patches: Patch[] = [];
  const trace: Trace = { emitted: false };
  const api = makeApi(
    ctx,
    {
      phase,
      source: { ability: feat, instance: ctx.character.abilities[0], label: 'Feat' },
      script: { id: 's', events: [phase === 'always' ? 'always' : 'hit'], source: '', enabled: true, priority: 0 },
      ...(phase === 'event' ? { event: { kind: 'hit' as const, result: 'hit' as const, damage: 9, targetId: 'c1' } } : {}),
    },
    sink,
    patches,
    trace,
  );
  return { ctx, sink, patches, trace, api };
}

test('reads: paths, enums, predicates trace themselves', () => {
  const { api, trace } = setup();
  expect(api.player.level).toBe(6); expect(api.player.mod.dex).toBe(3); expect(api.player.skills.spot!.ranks).toBe(9); expect(api.player.classes.ranger).toBe(5);
  expect(api.target.size).toBe(SIZE.LARGE); expect(api.target.hurt).toBe(HURT.BLOODIED); expect(api.target.distance).toBe(20);
  expect(api.target.is('aquatic')).toBe(true); expect(trace.last).toEqual({ text: 'target is Aquatic', result: true });
  expect(api.target.within(10)).toBe(false); expect(trace.last).toEqual({ text: 'target within 10 ft', result: false });
  expect(api.target.isOneOf(api.params.types!)).toBe(true);
  expect(api.attack.isRanged).toBe(true); expect(api.attack.index).toBe(2);
  expect(api.battle.on('sniping')).toBe(true); expect(api.battle.prompts.knowledge).toBe(24);
  expect(api.vars.trophyMultiplier).toBe(2); expect(api.vars.season).toBe('winter'); expect(api.vars.nope).toBeUndefined();
});

test('API_NAMES matches the api object exactly (the preamble destructures it)', () => {
  const { api } = setup();
  expect(Object.keys(api).sort()).toEqual([...API_NAMES].sort());
});

test('compute helpers fill the sink with source attribution; event helpers throw in always phase', () => {
  const { api, sink } = setup();
  api.bonus(['attack', 'damage'], 2, 'morale'); api.bonus('ac', 1, 'dodge', { as: 'Dodging' }); api.dice('1d6', 'fire'); api.flag('ignoreConcealment'); api.note('hi'); api.slot('ring'); api.attackMode({ id: 'rs', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' }); api.extraAttack(1);
  expect(sink.bonuses.map((b) => [b.stat, b.value, b.bonusType, b.label, b.source])).toEqual([['attack', 2, 'morale', 'Feat', 'f'], ['damage', 2, 'morale', 'Feat', 'f'], ['ac', 1, 'dodge', 'Dodging', 'f']]);
  expect(sink.dice[0]).toMatchObject({ dice: '1d6', damageType: 'fire' }); expect(sink.flags).toEqual({ ignoreConcealment: true }); expect(sink.slots.ring).toBe(1); expect(sink.modes[0]!.modeId).toBe('rs'); expect(sink.extraAttacks[0]).toMatchObject({ n: 1, base: 'full' });
  expect(sink.notes[0]).toEqual({ text: 'hi', source: 'f', sourceName: 'Feat' });
  expect(() => api.bonus('attac', 1)).toThrow(/unknown stat/);
  expect(() => api.bonus('attack', 1, 'moral')).toThrow(/unknown bonus type/);
  expect(() => api.heal(5)).toThrow(/only in event scripts/);
  expect(() => api.check('Chuul Gloves', { save: 'fort', dc: 15, effect: 'paralysed' })).toThrow(/check\(\) works only in event scripts/);
  expect(() => { (api.player as unknown as { level: number }).level = 3; }).toThrow(/read-only/);
});

test('the remaining compute and event helpers reach the sink and the patch list', () => {
  const { api, sink, trace } = setup();
  expect(trace.emitted).toBe(false);
  api.penalty('attack', 2, 'circumstance'); api.setStat('speed', 20); api.scale('damage', 2); api.naturalAttack({ name: 'Bite', dice: '1d6' });
  expect(trace.emitted).toBe(true);
  expect(sink.bonuses[0]).toMatchObject({ stat: 'attack', value: -2, bonusType: 'circumstance' });
  expect(sink.sets[0]).toEqual({ stat: 'speed', value: 20, source: 'f' });
  expect(sink.multipliers[0]).toEqual({ stat: 'damage', factor: 2, source: 'f' });
  expect(sink.naturals[0]).toEqual({ name: 'Bite', dice: '1d6', count: 1, attackBonus: 0, source: 'f', sourceName: 'Feat' });
  expect(() => api.dice('d6')).toThrow(/bad dice/);
  expect(() => api.slot('pocket')).toThrow(/unknown slot/);

  const ev = setup('event');
  ev.api.condition('self', 'raging', 3 * ROUND); ev.api.target.unmark('flanked'); ev.api.hurt(2); ev.api.temp(5); ev.api.charges('rage').restore();
  expect(ev.patches).toEqual([
    { k: 'tag', to: 'self', tag: 'raging', duration: 18 },
    { k: 'untag', to: 'target', tag: 'flanked' },
    { k: 'hp', op: 'damage', amount: 2 },
    { k: 'hp', op: 'temp', amount: 5 },
    { k: 'resource', id: 'rage', op: 'restore', amount: 1 },
  ]);
});

test('ask registers a prompt when unanswered and returns the stored value otherwise; tier maps', () => {
  const { api, sink } = setup();
  expect(api.ask('knowledge', { per: 'creatureType' })).toBe(24);
  expect(api.ask('spellcraft')).toBe(0); expect(sink.prompts[0]).toMatchObject({ promptId: 'spellcraft', source: 'f' });
  expect(api.tier(24, [15, 1], [25, 2], [Infinity, 5])).toBe(2);
});

test('event helpers queue patches; compute helpers throw in event phase', () => {
  const { api, patches } = setup('event');
  api.target.mark('flanked', ROUND); api.heal(5); api.charges('boots-rounds').use(2); api.setVar('kills', 1); api.emit('rage-ended', { by: 'f' }); api.grant('haste', 3 * ROUND); api.suppress('dodge'); api.reveal(); api.log('hi'); api.check('Chuul Gloves: paralysis', { save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' });
  expect(patches.map((p) => p.k)).toEqual(['tag', 'hp', 'resource', 'setVar', 'emit', 'grant', 'suppress', 'reveal', 'log', 'check']);
  expect(patches[0]).toEqual({ k: 'tag', to: 'target', tag: 'flanked', duration: 6 });
  expect(patches.at(-1)).toEqual({ k: 'check', name: 'Chuul Gloves: paralysis', save: 'fort', dc: 15, effect: 'paralysed (Fort negates)' });
  expect(api.event!.damage).toBe(9); expect(api.player.lastDamage).toBe(9);
  expect(() => api.bonus('attack', 1)).toThrow(/only in always scripts/);
  expect(() => api.check('X', { save: 'nope' as 'fort', dc: 10, effect: 'y' })).toThrow(/unknown save/);
});

test('event is frozen: one script cannot change what the next script (or this one) reads back', () => {
  const ev = setup('event');
  expect(() => { (ev.api.event as unknown as { damage: number }).damage = 999; }).toThrow();
  expect(ev.api.event!.damage).toBe(9); // the assignment did not stick even though it threw
  // a second api built off the very same run.event object (as runEventScripts does for every
  // script in one event) still sees the original value
  const api2 = makeApi(ev.ctx, { phase: 'event', source: { ability: feat, instance: ev.ctx.character.abilities[0], label: 'Feat' }, script: { id: 's2', events: ['hit'], source: '', enabled: true, priority: 0 }, event: { kind: 'hit', result: 'hit', damage: 9, targetId: 'c1', payload: { x: 1 } } }, ev.sink, ev.patches, ev.trace);
  expect(() => { (api2.event as unknown as { payload: { x: number } }).payload.x = 2; }).toThrow();
  expect(api2.event!.payload).toEqual({ x: 1 });
});

const skipReason = (fn: () => void): string | undefined => {
  try { fn(); } catch (e) { return e instanceof ScriptSkip ? e.because : `not a skip: ${String(e)}`; }
  return undefined;
};

test('need() throws a skip carrying the last false predicate', () => {
  const { api, trace } = setup();
  api.target.within(10);
  expect(skipReason(() => api.need(trace.last?.result))).toBe('target within 10 ft');
  expect(skipReason(() => api.need(false, 'you must be raging'))).toBe('you must be raging');
  expect(skipReason(() => api.need(true))).toBeUndefined();
});

test('lists are handed out as copies, so a script cannot mutate stored state', () => {
  const { api, ctx } = setup();
  api.battle.tags.push('on-fire');
  api.target.tags.push('on-fire');
  api.params.types!.push('dragon');
  (api.sel('self.param.types') as string[]).push('dragon');
  expect(ctx.battle!.tags).toEqual(['underwater']);
  expect(ctx.target!.tags).toEqual(['aberration', 'aquatic']);
  expect(ctx.character.abilities[0]!.paramValues.types).toEqual(['aberration']);
  expect(api.target.is('on-fire')).toBe(false);
  expect(api.battle.tags).toEqual(['underwater']);
});

test('player.paramsOf(recordId) reads another record\'s chosen tags, as a copy, and [] when that record is not on the sheet', () => {
  const { api, ctx } = setup();
  expect(api.player.paramsOf('other').types).toEqual(['dragon']);
  expect(api.player.paramsOf('f').types).toEqual(['aberration']); // same as this record's own params
  expect(api.player.paramsOf('missing').types).toEqual([]);
  expect(api.player.paramsOf('off').types).toEqual([]); // on the sheet but switched off: does not feed a derived check
  api.player.paramsOf('other').types!.push('giant');
  expect(ctx.character.abilities.find((a) => a.abilityId === 'other')!.paramValues.types).toEqual(['dragon']);
});

test("sel('self.param.x') hands out a copy, whether read off the record's own instance or found by scanning the character's abilities", () => {
  const { ctx } = setup();
  (readSelector(ctx, 'self.param.types') as string[]).push('dragon'); // no ctx.abilityInstance: falls through to the scan-abilities branch
  expect(ctx.character.abilities[0]!.paramValues.types).toEqual(['aberration']);
  const withInstance = { ...ctx, abilityInstance: ctx.character.abilities[0] };
  (readSelector(withInstance, 'self.param.types') as string[]).push('dragon'); // ctx.abilityInstance set: the fromInst branch
  expect(ctx.character.abilities[0]!.paramValues.types).toEqual(['aberration']);
});

test('assigning a var is setVar in event scripts and an error in always scripts', () => {
  const ev = setup('event');
  ev.api.vars.kills = 2;
  expect(ev.patches).toEqual([{ k: 'setVar', name: 'kills', value: 2 }]);
  expect(() => { (ev.api.vars as Record<string, unknown>).loot = { gp: 5 }; }).toThrow(/number, text or true\/false/);

  const always = setup();
  expect(() => { always.api.vars.kills = 2; }).toThrow(/read-only/);
  expect(always.patches).toEqual([]);
});

test('a compiled script cannot write through the façade, strict mode or not', () => {
  const { api } = setup();
  const c = compile('player.level = 3');
  expect(c.ok).toBe(true);
  if (c.ok) expect(() => c.run(api, () => {})).toThrow(/read-only/);
  const m = compile('player.mod.cha += 1');
  if (m.ok) expect(() => m.run(api, () => {})).toThrow(/read-only/);
  // even without the compiler's "use strict", the set trap still refuses
  const sloppy = new Function('api', 'api.player.level = 3;') as (a: unknown) => void;
  expect(() => sloppy(api)).toThrow(/read-only/);
});

test('history helper counts with friendly defaults', () => {
  const { api, ctx } = setup();
  ctx.battle!.log.push({ id: 'e1', round: 1, seq: 1, kind: 'attack', actor: 'self', targetId: 'c1', result: 'miss' }, { id: 'e2', round: 1, seq: 2, kind: 'attack', actor: 'self', targetId: 'c1', result: 'miss' });
  expect(api.history('miss')).toBe(2); expect(api.history('hit')).toBe(0); expect(api.history('miss', { since: 'lastRound' })).toBe(0);
});
