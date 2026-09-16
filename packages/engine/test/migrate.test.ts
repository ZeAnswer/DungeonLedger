import { convertV1, isV1Ability, convertToV3, convertPack, convertBattle } from '../src/migrate';

/**
 * These cases pin the v1/v2 → v3 hop. Since the schema now validates rules format v4 (scripts), the
 * v3 shape is asserted on the raw converted object; Task 7's printer adds the v4 assertions.
 */
type Any = Record<string, any>;
const v3 = (a: unknown, lookup?: (id: string) => Any | undefined): Any => convertToV3(a, lookup) as Any;
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
  expect(b.statuses[0]!.effects[0]!.do[0]).toEqual({ verb: 'modify', to: 'attack', value: 2, type: 'untyped', mode: 'add' });
});
