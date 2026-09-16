import { readFileSync } from 'node:fs';
import { convertV1, convertV2, isV1Ability, convertToV3, convertToV4, convertV3toV4, convertDurationV4, convertPack, convertBattle } from '../src/migrate';
import { AbilitySchema, BattleSchema } from '../src/schema';

/**
 * These cases pin the v1/v2 → v3 hop. Since the schema now validates rules format v4 (scripts), the
 * v3 shape is asserted on the raw converted object; Task 7's printer adds the v4 assertions.
 */
type Any = Record<string, any>;
/** The v1→v2→v3 hop on its own: `convertToV3` now runs the whole chain and hands back v4. */
const v3 = (a: unknown, lookup?: (id: string) => Any | undefined): Any => convertV2(convertV1(a), lookup ? (id) => { const x = lookup(id); return x ? convertV1(x) : undefined; } : undefined);
const acts = (a: Any): Any[] => (a.activations ?? []) as Any[];
const pools = (a: Any): Any[] => (a.pools ?? []) as Any[];

const v1 = {
  id: 'x', name: 'X', source: 'feat', activation: 'declare',
  resources: [{ id: 'x', max: 1, per: 'day' }],
  effects: [
    { id: 'a', when: { kind: 'all', of: [{ kind: 'attack.kind', attackKind: 'ranged' }, { kind: 'log', event: 'miss', target: 'current', scope: 'thisRound' }, { kind: 'target.hasTag', tag: 'aquatic' }, { kind: 'target.hurtAtMost', hurt: 'bloodied' }, { kind: 'param', name: 'types', includesTargetTag: true }, { kind: 'toggle', id: 'x' }, { kind: 'attack.withinFeet', feet: 30 }, { kind: 'resource', id: 'x', remainingAtLeast: 1 }] },
      do: [{ kind: 'bonus', to: 'attack', value: 4, bonusType: 'untyped' }, { kind: 'extraDice', dice: '1d6', damageType: 'fire' }, { kind: 'applyTag', to: 'target', tag: 'flanked', duration: 'endOfNextTurn' }, { kind: 'bonusFromTable', promptId: 'knowledge', perTagCategory: 'creatureType', to: 'damage', bonusType: 'insight', table: [{ upTo: 15, value: 1 }, { value: 2 }] }] },
    { id: 'b', trigger: 'onUse', do: [{ kind: 'consume', resourceId: 'x' }, { kind: 'extraSlot', slot: 'ring' }, { kind: 'attackMode', modeId: 'rs', label: 'RS', base: 'full', extraAttacksAtTop: 1, penalty: -2, attackKind: 'ranged' }] },
  ],
};

test('detects v1 by kind-based effects', () => {
  expect(isV1Ability(v1)).toBe(true);
  expect(isV1Ability(convertV1(v1))).toBe(false);
});

test('converts conditions to selector forms', () => {
  const a = v3(v1);
  expect(acts(a)[0]!.whileActive[0]!.when).toEqual({
    all: [
      { compare: 'attack.kind', op: '=', value: 'ranged' },
      { history: { event: 'miss', by: 'me', vs: 'current', scope: 'round' }, op: '>=', value: 1 },
      { is: 'target.tag.aquatic' },
      { compare: 'target.hurt', op: '>=', value: 'bloodied' },
      { in: 'target.tags', param: 'types' },
      { compare: 'target.distance', op: '<=', value: 30 },
      { compare: 'self.resource.x.left', op: '>=', value: 1 },
    ],
  });
});

test('converts effects to verbs and the envelope', () => {
  const a = v3(v1);
  expect(a.kind === 'feature').toBe(true);
  expect(acts(a)[0]!.charges).toMatchObject({ max: 1, resetOn: 'day' });
  expect(acts(a)[0]!.whileActive[0]!.do).toEqual([
    { verb: 'modify', to: 'attack', value: 4, type: 'untyped', mode: 'add' },
    { verb: 'dice', dice: '1d6', damageType: 'fire' },
    { verb: 'tag', to: 'target', tag: 'flanked', duration: 'untilMyNextTurn' },
    { verb: 'modify', to: 'damage', value: { prompt: 'knowledge', per: 'creatureType', table: [{ upTo: 15, value: 1 }, { value: 2 }] }, type: 'insight', mode: 'add' },
  ]);
  expect(acts(a)[0]!.onUse[0]!.do).toEqual([
    { verb: 'resource', id: 'x', op: 'consume', amount: 1 },
    { verb: 'slot', slot: 'ring', count: 1 },
    { verb: 'attack', mode: { id: 'rs', label: 'RS', base: 'full' }, extraAttacks: 1, penaltyAll: -2, attackKind: 'ranged' },
  ]);
});

test('is idempotent on v2 input', () => {
  const once = convertV1(v1);
  expect(convertV1(once)).toEqual(once);
});

const boots = { id: 'boots-of-speed', name: 'Boots of Speed', origin: 'item', binding: 'none', activation: { action: 'free' }, duration: 'endOfRound', item: { category: 'wondrous', slot: 'feet', tags: [] }, resources: [{ id: 'boots-rounds', label: 'Haste rounds', max: 10, resetOn: 'day', resetTo: 'max' }], cost: [{ kind: 'charge', resourceId: 'boots-rounds', amount: 1 }], grants: [], enabledByDefault: true, effects: [{ id: 'haste', trigger: 'always', when: { all: [] }, do: [{ verb: 'attack', extraAttacks: 1, penaltyAll: 0, appliesToBase: 'full' }] }] };
const monsterBlow = { id: 'monster-blow', name: 'Monster Blow', origin: 'classFeature', binding: 'none', activation: 'declare', cost: [], resources: [{ id: 'monster-blow', max: '1 + floor(classLevel(monster-hunter) / 5)', resetOn: 'day', resetTo: 'max' }], grants: [], enabledByDefault: true, effects: [
  { id: 'declared', trigger: 'always', when: { all: [{ is: 'battle.toggle.monster-blow' }, { in: 'target.tags', param: 'types' }] }, do: [{ verb: 'note', text: 'MONSTER BLOW' }] },
  { id: 'use', trigger: 'onUse', when: { all: [] }, do: [{ verb: 'resource', id: 'monster-blow', op: 'consume', amount: 1 }] },
] };
const hog = { id: 'hand-of-glory', name: 'Hand of Glory', origin: 'item', binding: 'none', activation: 'passive', cost: [], resources: [], grants: ['hog-daylight'], enabledByDefault: true, item: { category: 'wondrous', slot: 'neck', tags: [] }, effects: [{ id: 'slot', trigger: 'always', when: { all: [] }, do: [{ verb: 'slot', slot: 'ring', count: 1 }] }] };
const daylight = { id: 'hog-daylight', name: 'Daylight', origin: 'spell', binding: 'none', activation: { action: 'standard' }, cost: [], resources: [{ id: 'hog-daylight', label: 'Daylight', max: 1, resetOn: 'day', resetTo: 'max' }], grants: [], enabledByDefault: true, effects: [] };
const flaming = { id: 'flaming-bow', name: 'Flaming', origin: 'item', binding: 'thisWeapon', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, item: { category: 'weapon', slot: 'mainHand', tags: [], weapon: { kind: 'ranged', dice: '1d8', attackAbility: 'dex' } }, effects: [{ id: 'f', trigger: 'always', when: { all: [] }, do: [{ verb: 'dice', dice: '1d6', damageType: 'fire' }] }] };
const shaken = { id: 'shaken', name: 'Shaken', origin: 'condition', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, duration: 'whileActive', effects: [{ id: 's', trigger: 'always', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: -2, type: 'untyped', mode: 'add' }, { verb: 'tag', to: 'self', tag: 'x', duration: 'endOfRound' }] }] };
const memory = { id: 'memento-aqua', name: 'Memento Aqua', origin: 'memory', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] };
const potion = { id: 'potion-cmw', name: 'Potion', origin: 'item', binding: 'none', activation: { action: 'standard' }, item: { category: 'potion', tags: [] }, cost: [{ kind: 'item', abilityId: 'potion-cmw', quantity: 1 }], resources: [], grants: [], enabledByDefault: true, effects: [{ id: 'h', trigger: 'onUse', when: { all: [] }, do: [{ verb: 'hp', op: 'heal', amount: 10 }] }] };
const classFeat = { id: 'rapid-shot', name: 'Rapid Shot', origin: 'classFeature', classId: 'ranger', classLevel: 2, binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] };

test('v2 item with a charged, sustained activation becomes one activation with inline charges and whileActive blocks', () => {
  const a = v3(boots);
  expect(a.kind).toBe('item');
  expect(a.effects).toEqual([]);
  const [act] = acts(a);
  expect(act).toMatchObject({ id: 'boots-rounds', action: 'free', charges: { max: 10, resetOn: 'day', label: 'Haste rounds' }, cost: [], duration: 'untilMyNextTurn' });
  expect(act!.whileActive.map((b: Any) => b.id)).toEqual(['haste']);
  expect(pools(a)).toEqual([]);
});

test('declare ability becomes a free activation lasting this attack; its own toggle condition is stripped', () => {
  const a = v3(monsterBlow);
  const [act] = acts(a);
  expect(act).toMatchObject({ id: 'monster-blow', action: 'free', duration: 'thisAttack', charges: { max: '1 + floor(classLevel(monster-hunter) / 5)', resetOn: 'day' } });
  expect(act!.whileActive[0]!.when).toEqual({ all: [{ in: 'target.tags', param: 'types' }] });
  expect(act!.onUse).toEqual([{ id: 'use', when: { all: [] }, do: [{ verb: 'resource', id: 'monster-blow', op: 'consume', amount: 1 }] }]);
  if (a.kind === 'feature') expect(a.acquired).toEqual({ kind: 'class' });
});

test('grants become activations casting the granted spell with the spell\'s charges; the spell loses its resources', () => {
  const lookup = (id: string) => ({ 'hog-daylight': daylight } as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
  const item = v3(hog, lookup);
  expect(acts(item)).toEqual([expect.objectContaining({ id: 'hog-daylight', name: 'Daylight', spell: 'hog-daylight', charges: { max: 1, resetOn: 'day', label: 'Daylight' } })]);
  const spell = v3(daylight);
  expect(spell).toMatchObject({ kind: 'spell', castingAction: 'standard' });
  expect((spell as Record<string, unknown>).resources).toBeUndefined();
});

test('binding thisWeapon becomes a weapon-id condition on every block', () => {
  const a = v3(flaming);
  expect(a.effects[0]!.when).toEqual({ all: [{ compare: 'attack.weapon.id', op: '=', value: 'flaming-bow' }] });
});

test('conditions become harmful statuses; durations inside effects are converted', () => {
  const a = v3(shaken);
  expect(a).toMatchObject({ kind: 'status', harmful: true, duration: 'untilRemoved' });
  expect(a.effects[0]!.do[1]).toMatchObject({ verb: 'tag', duration: 'untilMyNextTurn' });
});

test('memory → feature acquired dm; classFeature keeps class and level; potion keeps item cost and onUse', () => {
  expect(v3(memory)).toMatchObject({ kind: 'feature', acquired: { kind: 'dm' } });
  expect(v3(classFeat)).toMatchObject({ acquired: { kind: 'class', classId: 'ranger', level: 2 } });
  const p = v3(potion);
  expect(acts(p)[0]).toMatchObject({ id: 'potion-cmw', cost: [{ kind: 'item', abilityId: 'potion-cmw', quantity: 1 }] });
  expect(acts(p)[0]!.onUse[0]!.do).toEqual([{ verb: 'hp', op: 'heal', amount: 10 }]);
});

test('convertToV3 is idempotent and handles v1 input', () => {
  const once = convertToV3(boots);
  expect(convertToV3(once)).toEqual(once);
  const fromV1 = v3(({ id: 'x', name: 'X', source: 'feat', activation: 'declare', resources: [{ id: 'x', max: 1, per: 'day' }], effects: [{ id: 'b', trigger: 'onUse', do: [{ kind: 'consume', resourceId: 'x' }] }] }));
  expect(acts(fromV1)[0]).toMatchObject({ id: 'x', action: 'free', duration: 'thisAttack', charges: { max: 1, resetOn: 'day' } });
});

test('convertPack converts abilities with sibling lookup; convertBattle renames situational and keys buffs by activation', () => {
  const pack = convertPack({ id: 'p', name: 'P', version: 1, abilities: [hog, daylight] }) as { abilities: { kind: string; activations?: unknown[] }[] };
  expect(pack.abilities.map((a) => a.kind)).toEqual(['item', 'spell']);
  expect(pack.abilities[0]!.activations).toHaveLength(1);
  const b = convertBattle({ id: 'b', startedAt: 'now', situational: [{ id: 'sit-1', name: 'Darkness', origin: 'situational', binding: 'none', activation: 'passive', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [] }], activeBuffs: [{ instanceId: 'i', abilityId: 'boots-of-speed', owner: 'self', suppressed: false, remainingRounds: 1 }] }, (id) => (id === 'boots-of-speed' ? (v3(boots) as { kind: string; activations?: { id: string }[] }) : undefined)) as Any;
  expect(b.statuses[0]).toMatchObject({ id: 'sit-1', kind: 'status' });
  expect(b.activeBuffs[0]).toMatchObject({ abilityId: 'boots-of-speed', activationId: 'boots-rounds' });
});

test('stripToggle removes a bare root toggle leaf', () => {
  const a = v3(({ id: 'mb2', name: 'MB2', origin: 'classFeature', binding: 'none', activation: 'declare', cost: [], resources: [], grants: [], enabledByDefault: true, effects: [{ id: 'declared', trigger: 'always', when: { is: 'battle.toggle.mb2' }, do: [{ verb: 'note', text: 'x' }] }] }));
  const [act] = acts(a);
  expect(act!.whileActive[0]!.when).toEqual({ all: [] });
});

const reactionFeat = { id: 'react-feat', name: 'React Feat', origin: 'feat', activation: { reaction: 'onDamaged' }, effects: [{ id: 'r', trigger: 'always', do: [{ verb: 'note', text: 'x' }] }] };

test('reaction activation sets the trigger on passive blocks and builds no activation', () => {
  const a = v3(reactionFeat);
  expect(a.effects[0]!.trigger).toBe('onDamaged');
  expect(acts(a)).toEqual([]);
});

test('convertBattle leaves a v3 battle alone: a grant buff keeps its missing activationId', () => {
  const v3Battle = { id: 'b', startedAt: 'now', statuses: [], activeBuffs: [{ instanceId: 'i', abilityId: 'boots-of-speed', owner: 'self', suppressed: false, remainingRounds: 1 }] };
  const out = convertBattle(v3Battle, (id) => (id === 'boots-of-speed' ? (v3(boots) as { kind: string; activations?: { id: string }[] }) : undefined)) as typeof v3Battle;
  expect(out).toEqual(v3Battle);
  expect(out.activeBuffs[0]).not.toHaveProperty('activationId');
});

test('convertPack is idempotent on a v2 pack', () => {
  const once = convertPack({ id: 'p', name: 'P', version: 1, abilities: [hog, daylight, monsterBlow, shaken, potion] });
  expect(convertPack(once)).toEqual(once);
});

test('a v1 situational entry converts to a status', () => {
  const b = convertBattle({ id: 'b', startedAt: 'now', situational: [{ id: 'flanking', name: 'Flanking', source: 'situational', effects: [{ id: 'f', do: [{ kind: 'bonus', to: 'attack', value: 2, bonusType: 'untyped' }] }] }] }) as Any;
  expect(b.statuses[0]).toMatchObject({ id: 'flanking', name: 'Flanking', kind: 'status', harmful: false });
  expect(b.statuses[0]!.effects).toBeUndefined();
  expect(b.statuses[0]!.scripts[0]!.source).toBe("bonus('attack', 2);");
});

// ---------- v3 → v4 ----------

test('convertToV4 replaces effect blocks with scripts on the record and on every activation', () => {
  const a = convertToV4(boots) as Any; // v1/v2 in, v4 out: convertToV3 now runs the whole chain
  expect(a.effects).toBeUndefined();
  expect(a.scripts).toEqual([]);
  const act = acts(a)[0]!;
  expect(act.onUse).toBeUndefined();
  expect(act.whileActive).toBeUndefined();
  expect(act.scripts).toEqual([{ id: 'haste', events: ['always'], source: "extraAttack(1, { base: 'full' });", enabled: true, priority: 0 }]);
  expect(AbilitySchema.safeParse(a).success).toBe(true);
});

test('convertToV4 prints onUse blocks as use scripts before the whileActive ones', () => {
  const a = convertToV4(monsterBlow) as Any;
  const act = acts(a)[0]!;
  expect(act.scripts).toEqual([
    { id: 'use', events: ['use'], source: "charges('monster-blow').use();", enabled: true, priority: 0 },
    { id: 'declared', events: ['always'], source: "if (target.isOneOf(params.types)) {\n  note('MONSTER BLOW');\n}", enabled: true, priority: 0 },
  ]);
});

test('convertToV4 is idempotent: a record that already has scripts is returned untouched', () => {
  const once = convertToV4(monsterBlow);
  expect(convertToV4(once)).toEqual(once);
  const v4 = { id: 'x', name: 'X', kind: 'feature', scripts: [{ id: 's', events: ['always'], source: "bonus('attack', 1);" }], activations: [], pools: [] };
  expect(convertV3toV4(v4)).toBe(v4);
  expect(convertToV3(v4)).toBe(v4);
});

test('durations become seconds; sentinels and numbers pass through', () => {
  expect(convertDurationV4({ rounds: 10 })).toBe(60);
  expect(convertDurationV4({ minutes: 2 })).toBe(120);
  expect(convertDurationV4('thisTurn')).toBe(6);
  expect(convertDurationV4('untilMyNextTurn')).toBe('untilMyNextTurn');
  expect(convertDurationV4('encounter')).toBe('encounter');
  expect(convertDurationV4(42)).toBe(42);
  expect(convertDurationV4(undefined)).toBeUndefined();
  const spell = convertV3toV4({ id: 's', name: 'S', kind: 'spell', castingAction: 'standard', duration: { rounds: 10 }, effects: [] }) as Any;
  expect(spell.duration).toBe(60);
  const item = convertV3toV4({ id: 'i', name: 'I', kind: 'item', item: { category: 'wondrous', tags: [] }, effects: [], pools: [], activations: [{ id: 'i', cost: [], duration: { minutes: 1 }, onUse: [], whileActive: [] }] }) as Any;
  expect(acts(item)[0]!.duration).toBe(60);
});

test('convertPack converts the shipped v3 memento pack: no record keeps an effects key', () => {
  const raw = JSON.parse(readFileSync(new URL('../../../packs/memento.json', import.meta.url), 'utf8'));
  const pack = convertPack(raw) as { abilities: Any[] };
  for (const a of pack.abilities) {
    expect(a.effects, `${a.id} still has effects`).toBeUndefined();
    expect(Array.isArray(a.scripts), `${a.id} has no scripts`).toBe(true);
    for (const act of (a.activations ?? []) as Any[]) {
      expect(act.onUse).toBeUndefined();
      expect(act.whileActive).toBeUndefined();
    }
    expect(AbilitySchema.safeParse(a).success, `${a.id}: ${JSON.stringify(AbilitySchema.safeParse(a).error?.issues?.[0])}`).toBe(true);
  }
});

test('convertBattle converts stored statuses and every duration it carries', () => {
  const raw = {
    id: 'b', startedAt: 'now', round: 2,
    statuses: [{ id: 'shaken', name: 'Shaken', kind: 'status', harmful: true, duration: { rounds: 3 }, effects: [{ id: 's', trigger: 'always', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: -2, type: 'untyped', mode: 'add' }] }] }],
    activeBuffs: [{ instanceId: 'i', abilityId: 'boots-of-speed', activationId: 'boots-rounds', owner: 'self', expires: { rounds: 1 } }],
    selfConditions: [{ tag: 'raging', expires: { minutes: 1 } }],
    combatants: [{ id: 'c', name: 'Gorgon', conditions: [{ tag: 'flanked', expires: 'thisTurn' }] }],
  };
  const b = convertBattle(raw) as Any;
  expect(b.statuses[0]!.effects).toBeUndefined();
  expect(b.statuses[0]!.duration).toBe(18);
  expect(b.statuses[0]!.scripts[0]!.source).toBe("bonus('attack', -2);");
  expect(b.activeBuffs[0]!.expires).toBe(6);
  expect(b.selfConditions[0]!.expires).toBe(60);
  expect(b.combatants[0]!.conditions[0]!.expires).toBe(6);
  expect(BattleSchema.safeParse(raw).success).toBe(true);
  expect(convertBattle(b)).toEqual(b);
});
