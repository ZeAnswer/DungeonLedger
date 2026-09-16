import type { AttackCtx, EvalContext } from '../../src/context';
import { AbilitySchema, type Ability, type FunctionDef } from '../../src/schema';
import { clearComputeCache, computePass, runOne } from '../../src/scripts/compute';
import { newSink } from '../../src/scripts/sink';
import { diagnostics } from '../../src/scripts/diagnostics';
import { setStatResolver } from '../../src/scripts/registry';
import { makeBattle, makeCharacter, makeCombatant, makeCtx } from '../fixtures';

/**
 * Task 6 registers the real `resolveStat`. Here a stand-in that feeds the compute pass back into
 * itself for `ac` (base 10 + dex 3 + whatever scripts have contributed so far), which is exactly the
 * re-entrant read `computePass` has to survive: the nested call must see the partial sink.
 */
setStatResolver((ctx: EvalContext, stat: string) => ({
  total: stat === 'ac' ? 13 + computePass(ctx).bonuses.filter((b) => b.stat === 'ac').reduce((s, b) => s + b.value, 0) : 0,
}));

const bow: AttackCtx = {
  profile: { id: 'bow', name: 'Bow', kind: 'ranged', baseDice: '1d8', enhancement: 0, critRange: 20, critMult: 2, attackAbility: 'dex', damageAbilityMultiplier: 1 },
  kind: 'ranged', index: 1, modeId: 'single',
};

function ctxWith(records: Ability[], opts: { target?: boolean; distance?: number; functions?: Record<string, FunctionDef> } = {}): EvalContext {
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1', tags: ['aberration'], distanceFeet: opts.distance ?? 20 })] });
  const c = makeCtx({
    character: makeCharacter({ abilities: records.map((r) => ({ abilityId: r.id, enabled: true, paramValues: {} })) }),
    battle,
    ...(opts.target === false ? {} : { target: battle.combatants[0] }),
  });
  for (const r of records) c.library.abilities[r.id] = r;
  c.library.functions = opts.functions ?? {};
  return c;
}

test('always scripts fill the sink; a script that emits nothing records its last false predicate as a near miss', () => {
  const pbs = AbilitySchema.parse({ id: 'pbs', name: 'Point Blank Shot', kind: 'feature', scripts: [{ id: 's', source: "if (attack.isRanged && target.within(30)) bonus(['attack', 'damage'], 1)" }] });
  const sink = computePass({ ...ctxWith([pbs], { distance: 60 }), attack: bow });
  expect(sink.bonuses).toEqual([]);
  expect(sink.skipped[0]).toMatchObject({ source: 'pbs', sourceName: 'Point Blank Shot', failed: 'target within 30 ft' });
  const near = computePass({ ...ctxWith([pbs], { distance: 20 }), attack: bow });
  expect(near.bonuses.map((b) => [b.stat, b.value])).toEqual([['attack', 1], ['damage', 1]]);
});

test('a throwing script is reported, quarantined after three passes, and never breaks the pass', () => {
  diagnostics.clear();
  const bad = AbilitySchema.parse({ id: 'bad', name: 'Bad', kind: 'feature', scripts: [{ id: 's', source: 'player.mod.cha += 1' }] });
  const ok = AbilitySchema.parse({ id: 'ok', name: 'Ok', kind: 'feature', scripts: [{ id: 's', source: "bonus('init', 4)" }] });
  let c = ctxWith([bad, ok]);
  for (let i = 0; i < 3; i++) {
    const s = computePass(c);
    expect(s.bonuses[0]!.stat).toBe('init');
    expect(s.errors[0]).toMatchObject({ recordId: 'bad', message: expect.stringMatching(/read-only/) });
    c = { ...c, character: { ...c.character } };
  }
  expect(diagnostics.quarantined('bad/s')).toBe(true);
});

test('a probe run reports its error in the sink but never quarantines the script', () => {
  diagnostics.clear();
  const bad = AbilitySchema.parse({ id: 'probe-bad', name: 'Probe Bad', kind: 'feature', scripts: [{ id: 's', source: 'player.mod.cha += 1' }] });
  const c = ctxWith([bad]);
  const src = { ability: bad, instance: c.character.abilities[0]!, label: bad.name };
  for (let i = 0; i < 5; i++) {
    const sink = newSink();
    expect(runOne(c, { phase: 'always', source: src, script: bad.scripts[0]!, probe: true }, sink, [])).toBe('error');
    expect(sink.errors[0]).toMatchObject({ recordId: 'probe-bad', message: expect.stringMatching(/read-only/) });
  }
  expect(diagnostics.quarantined('probe-bad/s')).toBe(false);
  expect(diagnostics.errors()).toEqual([]);
  diagnostics.clear();
});

test('library functions are callable with named args and share the budget', () => {
  const trophy: FunctionDef = { id: 'trophy', name: 'Trophy', params: [{ name: 'stat', type: 'stat', required: true }, { name: 'base', type: 'number', required: true }], source: "bonus(stat, base * (vars.trophyMultiplier ?? 1), 'enhancement')" };
  const gloves = AbilitySchema.parse({ id: 'gloves', name: 'Gloves', kind: 'item', item: { category: 'trophy', slot: 'hands' }, scripts: [{ id: 's', source: "fn.trophy({ stat: 'init', base: 4 })" }] });
  const viaCall = AbilitySchema.parse({ id: 'amulet', name: 'Amulet', kind: 'item', item: { category: 'trophy', slot: 'neck' }, scripts: [{ id: 's', call: { fn: 'trophy', args: { stat: { k: 'lit', v: 'ac' }, base: { k: 'expr', v: '2 + 2' } } } }] });
  const c = ctxWith([gloves, viaCall], { functions: { trophy } });
  c.character.vars = { trophyMultiplier: 2 };
  expect(computePass(c).bonuses.map((b) => [b.stat, b.value, b.source])).toEqual([['init', 8, 'gloves'], ['ac', 8, 'amulet']]);
});

test('per-source params: a script reads its own record\'s choices', () => {
  const rec = (id: string, tag: string) => AbilitySchema.parse({ id, name: id, kind: 'feature', params: { types: { kind: 'tags' } }, scripts: [{ id: 's', source: `if (sel('self.param.types').includes('${tag}')) bonus('init', 1, 'untyped', { as: '${id}' })` }] });
  const a = rec('a', 'aberration');
  const b = rec('b', 'dragon');
  const battle = makeBattle({ combatants: [makeCombatant({ id: 'c1' })] });
  const c = makeCtx({
    character: makeCharacter({ abilities: [{ abilityId: 'a', enabled: true, paramValues: { types: ['aberration'] } }, { abilityId: 'b', enabled: true, paramValues: { types: ['dragon'] } }] }),
    battle, target: battle.combatants[0],
  });
  c.library.abilities['a'] = a;
  c.library.abilities['b'] = b;
  expect(computePass(c).bonuses.map((x) => x.source)).toEqual(['a', 'b']);
});

test('a library edit (a new library object) is a new pass', () => {
  const rec = AbilitySchema.parse({ id: 'r', name: 'R', kind: 'feature', scripts: [{ id: 's', source: "bonus('init', 1)" }] });
  const edited = AbilitySchema.parse({ id: 'r', name: 'R', kind: 'feature', scripts: [{ id: 's', source: "bonus('init', 5)" }] });
  const c = ctxWith([rec]);
  expect(computePass(c).bonuses[0]!.value).toBe(1);
  const after = { ...c, library: { ...c.library, abilities: { ...c.library.abilities, r: edited } } };
  expect(computePass(after).bonuses[0]!.value).toBe(5);
});

test('the pass is cached per character/battle/library/target/attack and a nested stat read sees earlier scripts', () => {
  const a = AbilitySchema.parse({ id: 'a', name: 'A', kind: 'feature', scripts: [{ id: 's', source: "bonus('ac', 2, 'armor')" }] });
  const b = AbilitySchema.parse({ id: 'b', name: 'B', kind: 'feature', scripts: [{ id: 's', source: "if (player.stats.ac >= 15) bonus('attack', 1)" }] });
  const c = ctxWith([a, b]);
  const s1 = computePass(c);
  expect(computePass(c)).toBe(s1);
  expect(s1.bonuses.some((x) => x.stat === 'attack')).toBe(true); // base 10 + dex 3 + armor 2 = 15
  clearComputeCache(); // a library edit leaves character and battle untouched, so the cache needs a hammer
  expect(computePass(c)).not.toBe(s1);
});
