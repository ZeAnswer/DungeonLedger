import { printBlock, printExpr, printWarnings, clearPrintWarnings, EVENT_ONLY_WARNING } from '../../src/scripts/print';
import { compile } from '../../src/scripts/compile';
import { convertPack } from '../../src/migrate';

/**
 * The block printer is the v3 → v4 converter: one effect block in, one script out.
 * Each case pins the exact printed source — two-space indent, one statement per line,
 * `;` terminators, single quotes — because these strings become the shipped packs.
 */
type Any = Record<string, any>;
const src = (block: Any, phase: 'always' | 'use' = 'always', owner = 'owner') => printBlock(block as never, phase, owner).source;
beforeEach(() => clearPrintWarnings());

const cases: { name: string; block: Any; phase?: 'always' | 'use'; owner?: string; events?: string[]; want: string }[] = [
  {
    name: 'Point Blank Shot: traced leaves join the if test',
    block: {
      id: 'pbs',
      when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { compare: 'target.distance', op: '<=', value: 30 }] },
      do: [{ verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }, { verb: 'modify', to: 'damage', value: 1, type: 'untyped', mode: 'add' }],
    },
    want: "if (attack.isRanged && target.within(30)) {\n  bonus('attack', 1);\n  bonus('damage', 1);\n}",
  },
  {
    name: 'Rapid Shot: the attack verb with a mode prints attackMode',
    block: { id: 'mode', when: { all: [] }, do: [{ verb: 'attack', mode: { id: 'rapid-shot', label: 'Rapid Shot', base: 'full' }, extraAttacks: 1, penaltyAll: -2, attackKind: 'ranged' }] },
    want: "attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: -2, kind: 'ranged' });",
  },
  {
    name: 'Woodland Archer: an untraced history member becomes a need() line',
    block: {
      id: 'adjust', label: 'Adjust for Range',
      when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' } }] },
      do: [{ verb: 'modify', to: 'attack', value: '4 * sel(history.miss.me.current.thisRound)', type: 'untyped', mode: 'add' }],
    },
    want: "if (attack.isRanged) {\n  need(history('miss') >= 1, 'you missed this target this round');\n  bonus('attack', 4 * history('miss'));\n}",
  },
  {
    name: 'Monster Blow: param membership is traced, the ordinal compare is a need(); note interpolates {expr}',
    block: {
      id: 'declared', label: 'Monster Blow',
      when: { all: [{ in: 'target.tags', param: 'types' }, { compare: 'target.hurt', op: '>=', value: 'bloodied' }] },
      do: [{ verb: 'note', text: 'MONSTER BLOW: on hit, Fort DC = {damage + classLevel(monster-hunter) + wisMod} or die.' }],
    },
    want: 'if (target.isOneOf(params.types)) {\n'
      + "  need(target.hurt >= HURT.BLOODIED, 'target is bloodied or worse');\n"
      + "  note(`MONSTER BLOW: on hit, Fort DC = ${player.lastDamage + player.classes['monster-hunter'] + player.mod.wis} or die.`);\n"
      + '}',
  },
  {
    name: 'Boots of Speed: an unconditional whileActive block prints bare statements',
    block: {
      id: 'haste', label: 'Haste', when: { all: [] },
      do: [
        { verb: 'attack', extraAttacks: 1, penaltyAll: 0, appliesToBase: 'full' },
        { verb: 'modify', to: 'attack', value: 1, type: 'dodge', mode: 'add' },
        { verb: 'modify', to: 'ac', value: 1, type: 'dodge', mode: 'add' },
        { verb: 'modify', to: 'save.ref', value: 1, type: 'dodge', mode: 'add' },
        { verb: 'modify', to: 'speed', value: 30, type: 'untyped', mode: 'add' },
      ],
    },
    want: "extraAttack(1, { base: 'full' });\nbonus('attack', 1, 'dodge');\nbonus('ac', 1, 'dodge');\nbonus('save.ref', 1, 'dodge');\nbonus('speed', 30);",
  },
  {
    name: 'Hand of Glory: slot',
    block: { id: 'slot', when: { all: [] }, do: [{ verb: 'slot', slot: 'ring', count: 1 }] },
    want: "slot('ring', 1);",
  },
  {
    name: 'Potion: an onUse block is a use-event script',
    block: { id: 'h', when: { all: [] }, do: [{ verb: 'hp', op: 'heal', amount: 10 }] },
    phase: 'use', events: ['use'],
    want: 'heal(10);',
  },
  {
    name: 'Knowledge Devotion: a table value becomes one ask() const and a tier() per bonus',
    block: {
      id: 'kd', label: 'Knowledge Devotion', when: { all: [] },
      do: [
        { verb: 'modify', to: 'attack', value: { prompt: 'knowledge', per: 'creatureType', table: [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { upTo: 30, value: 3 }, { upTo: 35, value: 4 }, { value: 5 }] }, type: 'insight', mode: 'add' },
        { verb: 'modify', to: 'damage', value: { prompt: 'knowledge', per: 'creatureType', table: [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { upTo: 30, value: 3 }, { upTo: 35, value: 4 }, { value: 5 }] }, type: 'insight', mode: 'add' },
      ],
    },
    want: "const knowledge = ask('knowledge', { per: 'creatureType' });\n"
      + 'if (knowledge) {\n'
      + "  bonus('attack', tier(knowledge, [15, 1], [25, 2], [30, 3], [35, 4], [Infinity, 5]), 'insight');\n"
      + "  bonus('damage', tier(knowledge, [15, 1], [25, 2], [30, 3], [35, 4], [Infinity, 5]), 'insight');\n"
      + '}',
  },
  {
    name: 'a battle toggle at the root is one traced if',
    block: { id: 'sniper', label: 'Moving Sniper', when: { is: 'battle.toggle.sniping' }, do: [{ verb: 'note', text: 'Moving Sniper: after a hit while sniping, take one move action before re-hiding.' }] },
    want: "if (battle.on('sniping')) {\n  note('Moving Sniper: after a hit while sniping, take one move action before re-hiding.');\n}",
  },
  {
    name: 'a weapon tag at the root is one traced if',
    block: { id: 'wf', when: { is: 'attack.weapon.tag.longbow' }, do: [{ verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add' }] },
    want: "if (attack.weapon.is('longbow')) {\n  bonus('attack', 1);\n}",
  },
  {
    name: 'onHit tag becomes a hit-event target.mark with the duration constant',
    block: { id: 'flank', trigger: 'onHit', when: { all: [] }, do: [{ verb: 'tag', to: 'target', tag: 'flanked', duration: 'untilMyNextTurn' }] },
    events: ['hit'],
    want: "target.mark('flanked', UNTIL_MY_NEXT_TURN);",
  },
  {
    name: 'attackKind on a modify adds the attack predicate to the if',
    block: { id: 'k', when: { all: [] }, do: [{ verb: 'modify', to: 'attack', value: 1, type: 'untyped', mode: 'add', attackKind: 'ranged' }] },
    want: "if (attack.isRanged) {\n  bonus('attack', 1);\n}",
  },
];

for (const c of cases) {
  test(`prints ${c.name}`, () => {
    const script = printBlock(c.block as never, c.phase ?? 'always', c.owner ?? 'owner');
    expect(script.source).toBe(c.want);
    if (c.events) expect(script.events).toEqual(c.events);
    expect(compile(script.source).ok, `does not compile: ${script.source}`).toBe(true);
  });
}

test('the block label becomes the script label and the trigger becomes the events', () => {
  expect(printBlock({ id: 'b', label: 'Haste', trigger: 'always', when: { all: [] }, do: [{ verb: 'flag', flag: 'x' }] } as never, 'always', 'owner')).toMatchObject({ id: 'b', label: 'Haste', events: ['always'] });
  const triggers = { always: 'always', onHit: 'hit', onMiss: 'miss', onCrit: 'crit', onDamaged: 'damaged', onRoundStart: 'roundStart', onRoundEnd: 'roundEnd' };
  for (const [trigger, event] of Object.entries(triggers)) {
    expect(printBlock({ id: 'b', trigger, when: { all: [] }, do: [{ verb: 'reveal' }] } as never, 'always', 'owner').events).toEqual([event]);
  }
  // the onUse phase wins over the stored trigger
  expect(printBlock({ id: 'b', trigger: 'always', when: { all: [] }, do: [{ verb: 'reveal' }] } as never, 'use', 'owner').events).toEqual(['use']);
  // a block without an id falls back to the owner id
  expect(printBlock({ when: { all: [] }, do: [{ verb: 'reveal' }] } as never, 'always', 'boots-rounds').id).toBe('boots-rounds');
});

test('untraced condition trees print as JS with the v3 sentence as the need() reason', () => {
  expect(src({ id: 'x', when: { any: [{ compare: 'battle.round', op: '>=', value: 2 }, { exists: 'battle.prompt.knowledge' }] }, do: [{ verb: 'flag', flag: 'f' }] }))
    .toBe("if (battle.round >= 2 || battle.prompts.knowledge !== undefined) {\n  flag('f');\n}");
  expect(src({ id: 'x', when: { all: [{ is: 'target.tag.aquatic' }, { none: [{ compare: 'target.size', op: '>=', value: 'large' }] }] }, do: [{ verb: 'flag', flag: 'f' }] }))
    .toBe("if (target.is('aquatic')) {\n  need(!(target.size >= SIZE.LARGE), 'none of: target is large or larger');\n  flag('f');\n}");
  expect(src({ id: 'x', when: { count: [{ is: 'self.tag.raging' }, { is: 'target.tag.aquatic' }], atLeast: 2 }, do: [{ verb: 'flag', flag: 'f' }] }))
    .toBe("if ([player.is('raging'), target.is('aquatic')].filter(Boolean).length >= 2) {\n  flag('f');\n}");
  expect(src({ id: 'x', when: { all: [{ history: { event: 'hit', by: 'me', vs: 'current', scope: 'lastRound' }, op: '>=', value: 2 }] }, do: [{ verb: 'flag', flag: 'f' }] }))
    .toBe("need(history('hit', { since: 'lastRound' }) >= 2, 'you hit this target last round (>= 2)');\nflag('f');");
});

test('the remaining verbs print to their helpers', () => {
  const one = (e: Any, want: string, phase: 'always' | 'use' = 'always') => expect(src({ id: 'x', when: { all: [] }, do: [e] }, phase)).toBe(want);
  one({ verb: 'dice', dice: '1d6', damageType: 'fire' }, "dice('1d6', 'fire');");
  one({ verb: 'dice', dice: '1d6' }, "dice('1d6');");
  one({ verb: 'dice', dice: '1d6', label: 'Flaming' }, "dice('1d6', undefined, { as: 'Flaming' });");
  one({ verb: 'note', text: 'Save or die.', dc: 15 }, "note('Save or die. (DC 15)');");
  one({ verb: 'flag', flag: 'ignoreConcealment', value: true }, "flag('ignoreConcealment');");
  one({ verb: 'flag', flag: 'x', value: false }, "flag('x', false);");
  one({ verb: 'tag', to: 'self', tag: 'raging', duration: { rounds: 3 } }, "condition('self', 'raging', 3 * ROUND);", 'use');
  one({ verb: 'tag', to: 'allEnemies', tag: 'shaken', duration: { minutes: 1 } }, "condition('allEnemies', 'shaken', MINUTE);", 'use');
  one({ verb: 'tag', to: 'target', tag: 'marked', duration: 'untilRemoved' }, "target.mark('marked');", 'use');
  one({ verb: 'grant', ability: 'haste', duration: 'encounter' }, "grant('haste', ENCOUNTER);", 'use');
  one({ verb: 'grant', ability: 'haste' }, "grant('haste');", 'use');
  one({ verb: 'suppress', ability: 'rage' }, "suppress('rage');", 'use');
  one({ verb: 'resource', id: 'monster-blow', op: 'consume', amount: 1 }, "charges('monster-blow').use();", 'use');
  one({ verb: 'resource', id: 'p', op: 'restore', amount: 2 }, "charges('p').restore(2);", 'use');
  one({ verb: 'resource', id: 'p', op: 'set', amount: 0 }, "charges('p').set(0);", 'use');
  one({ verb: 'hp', op: 'damage', amount: '2 * level' }, 'hurt(2 * player.level);', 'use');
  one({ verb: 'hp', op: 'temp', amount: 5 }, 'temp(5);', 'use');
  one({ verb: 'reveal' }, 'target.reveal();', 'use');
  one({ verb: 'prompt', id: 'knowledge', per: 'creatureType' }, "ask('knowledge', { per: 'creatureType' });");
  one({ verb: 'note', text: 'Save DC {10 + level} to resist.', dc: '15 + wisMod' }, 'note(`Save DC ${10 + player.level} to resist. (DC ${15 + player.mod.wis})`);');
  one({ verb: 'note', text: "ignore this foe's concealment" }, "note(`ignore this foe's concealment`);");
  one({ verb: 'modify', to: 'ac', value: 2, mode: 'set' }, "setStat('ac', 2);");
  one({ verb: 'modify', to: 'speed', value: 2, mode: 'multiply' }, "scale('speed', 2);");
  one({ verb: 'attack', extraAttacks: 1, penaltyAll: -2 }, "extraAttack(1);\nbonus('attack', -2);");
  one({ verb: 'attack', naturalAttack: { name: 'Claw', dice: '1d4', count: 2, attackBonus: 0 } }, "naturalAttack({ name: 'Claw', dice: '1d4', count: 2 });");
});

test('printExpr maps the v3 expression vocabulary to script paths', () => {
  expect(printExpr('max(2, 2 * sel(self.equipped.count.tag.trophy-aberration))')).toBe("max(2, 2 * player.equipped.tag['trophy-aberration'])");
  expect(printExpr('4 * trophyMultiplier')).toBe('4 * vars.trophyMultiplier');
  expect(printExpr('favoredEnemyBonus1')).toBe('vars.favoredEnemyBonus1');
  expect(printExpr('1 + floor(classLevel(monster-hunter) / 5)')).toBe("1 + floor(player.classes['monster-hunter'] / 5)");
  expect(printExpr('damage + wisMod + level + bab + round')).toBe('player.lastDamage + player.mod.wis + player.level + player.bab + battle.round');
  expect(printExpr('prompt(knowledge)')).toBe('battle.prompts.knowledge');
  expect(printExpr('sel(history.hit.target.any.encounter)')).toBe("history('hit', { by: 'target', vs: 'any', since: 'encounter' })");
  // a selector with a script path prints the path; anything else keeps the sel() escape hatch
  expect(printExpr('sel(self.skill.swim.ranks)')).toBe('player.skills.swim.ranks');
  expect(printExpr('sel(self.resource.boots-rounds.left)')).toBe("player.left('boots-rounds')");
  expect(printExpr('sel(self.made.up.path)')).toBe("sel('self.made.up.path')");
});

test('a dotted bare name is a selector, not a var', () => {
  expect(printExpr('self.class.ranger.level')).toBe('player.classes.ranger');
  expect(printExpr('self.level + 1')).toBe('player.level + 1');
  expect(printExpr('2 * self.skill.swim.total')).toBe('2 * player.skills.swim.total');
  expect(printExpr('floor(self.class.monster-hunter.level / 2) + wisMod')).toBe("floor(player.classes['monster-hunter'] / 2) + player.mod.wis");
  expect(printExpr('battle.round + trophyMultiplier')).toBe('battle.round + vars.trophyMultiplier');
});

test('need() reasons use the pack\'s tag and skill names', () => {
  const pack = convertPack({
    id: 'p', name: 'P', version: 1,
    tags: [{ id: 'raging', label: 'Raging', category: 'condition' }],
    skills: [{ id: 'swim', name: 'Swim', ability: 'str' }],
    abilities: [{
      id: 'a', name: 'A', kind: 'feature', acquired: { kind: 'feat' }, enabledByDefault: true, activations: [], pools: [],
      effects: [{ id: 'b', trigger: 'always', when: { all: [{ none: [{ is: 'self.tag.raging' }] }, { compare: 'self.skill.swim.total', op: '>=', value: 5 }] }, do: [{ verb: 'flag', flag: 'f' }] }],
    }],
  }) as { abilities: Any[] };
  expect(pack.abilities[0]!.scripts[0]!.source).toBe(
    "need(!(player.is('raging')), 'none of: you are Raging');\n"
    + "need(player.skills.swim.total >= 5, 'Swim total at least 5');\n"
    + "flag('f');",
  );
});

test('attackKind guards only the verbs that carry it', () => {
  expect(src({
    id: 'x', when: { all: [{ is: 'target.tag.aquatic' }] },
    do: [{ verb: 'modify', to: 'attack', value: 1, mode: 'add', attackKind: 'ranged' }, { verb: 'modify', to: 'damage', value: 1, mode: 'add' }],
  })).toBe("if (target.is('aquatic')) {\n  if (attack.isRanged) {\n    bonus('attack', 1);\n  }\n  bonus('damage', 1);\n}");
  // a kind the block already tests for is not repeated
  expect(src({
    id: 'x', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }] },
    do: [{ verb: 'modify', to: 'attack', value: 1, mode: 'add', attackKind: 'ranged' }],
  })).toBe("if (attack.isRanged) {\n  bonus('attack', 1);\n}");
});

test('an event-only helper in an always block is printed, flagged in the source and reported', () => {
  const script = printBlock({ id: 'b', when: { all: [] }, do: [{ verb: 'resource', id: 'p', op: 'consume', amount: 1 }, { verb: 'flag', flag: 'f' }] } as never, 'always', 'owner');
  expect(script.source).toBe(`${EVENT_ONLY_WARNING}\ncharges('p').use();\nflag('f');`);
  expect(printWarnings).toEqual(['owner/b: event-only helper (resource) in an always script']);
  // the same verbs in a use or hit script are fine
  clearPrintWarnings();
  printBlock({ id: 'b', trigger: 'onHit', when: { all: [] }, do: [{ verb: 'reveal' }] } as never, 'always', 'owner');
  printBlock({ id: 'b', when: { all: [] }, do: [{ verb: 'reveal' }] } as never, 'use', 'owner');
  expect(printWarnings).toEqual([]);
});

test('a note placeholder that is not an expression is refused', () => {
  expect(() => src({ id: 'x', when: { all: [] }, do: [{ verb: 'note', text: 'roll {2d6 fire} now' }] })).toThrow(/note text: bad \{expr\}/);
  // a stray "${" is plain text in a quoted string, and escaped when the text needs a template literal
  expect(src({ id: 'x', when: { all: [] }, do: [{ verb: 'note', text: 'costs ${gold' }] })).toBe("note('costs ${gold');");
  expect(src({ id: 'x', when: { all: [] }, do: [{ verb: 'note', text: "it's ${gold" }] })).toBe('note(`it\'s \\${gold`);');
});
