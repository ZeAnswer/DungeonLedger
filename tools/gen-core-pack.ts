/**
 * Generates packs/core-3.5e.json: creature type tags, subtypes, conditions, skills, XP table,
 * Ranger class table, and common feats/buffs. Run: npx tsx tools/gen-core-pack.ts
 */
import { writeFileSync } from 'node:fs';
import { PackSchema, type Pack } from '../packages/engine/src/schema';
import { ROUND } from '../packages/engine/src/scripts/units';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const tag = (label: string, category: Pack['tags'][number]['category']) => ({ id: slug(label), label, category });

const creatureTypes = ['Aberration', 'Animal', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Giant', 'Humanoid', 'Magical Beast', 'Monstrous Humanoid', 'Ooze', 'Outsider', 'Plant', 'Undead', 'Vermin'];
const subtypes = ['Air', 'Earth', 'Fire', 'Water', 'Cold', 'Evil', 'Good', 'Chaotic', 'Lawful', 'Incorporeal', 'Shapechanger', 'Swarm', 'Extraplanar', 'Native', 'Augmented', 'Reptilian', 'Goblinoid', 'Elf', 'Dwarf', 'Human', 'Orc', 'Gnome', 'Halfling'];
const habitats = ['Aquatic', 'Subterranean', 'Forest', 'Swamp', 'Desert', 'Mountain', 'Urban', 'Flying'];
const conditions = ['Flanked', 'Prone', 'Stunned', 'Dazed', 'Entangled', 'Invisible', 'Concealed', 'Blinded', 'Paralyzed', 'Helpless', 'Frightened', 'Shaken', 'Panicked', 'Fatigued', 'Exhausted', 'Sickened', 'Nauseated', 'Grappled', 'Flat-Footed', 'Hasted', 'Slowed', 'Cowering', 'Immobile'];
const sizes = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];

const skillDefs: [string, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', boolean?, boolean?][] = [
  ['Appraise', 'int'], ['Balance', 'dex', false, true], ['Bluff', 'cha'], ['Climb', 'str', false, true], ['Concentration', 'con'],
  ['Craft', 'int'], ['Decipher Script', 'int', true], ['Diplomacy', 'cha'], ['Disable Device', 'int', true], ['Disguise', 'cha'],
  ['Escape Artist', 'dex', false, true], ['Forgery', 'int'], ['Gather Information', 'cha'], ['Handle Animal', 'cha', true], ['Heal', 'wis'],
  ['Hide', 'dex', false, true], ['Intimidate', 'cha'], ['Jump', 'str', false, true],
  ['Knowledge (Arcana)', 'int', true], ['Knowledge (Architecture)', 'int', true], ['Knowledge (Dungeoneering)', 'int', true], ['Knowledge (Geography)', 'int', true],
  ['Knowledge (History)', 'int', true], ['Knowledge (Local)', 'int', true], ['Knowledge (Nature)', 'int', true], ['Knowledge (Nobility)', 'int', true],
  ['Knowledge (Religion)', 'int', true], ['Knowledge (The Planes)', 'int', true],
  ['Listen', 'wis'], ['Move Silently', 'dex', false, true], ['Open Lock', 'dex', true], ['Perform', 'cha'], ['Profession', 'wis', true], ['Ride', 'dex'],
  ['Search', 'int'], ['Sense Motive', 'wis'], ['Sleight of Hand', 'dex', true, true], ['Spellcraft', 'int', true], ['Spot', 'wis'], ['Survival', 'wis'],
  ['Swim', 'str', false, true], ['Tumble', 'dex', true, true], ['Use Magic Device', 'cha', true], ['Use Rope', 'dex'],
];

const xpTable = Array.from({ length: 20 }, (_, i) => ({ level: i + 1, xp: (i * (i + 1) * 1000) / 2 }));

const pack: Pack = PackSchema.parse({
  id: 'core-3.5e',
  name: 'Core 3.5e',
  version: 5,
  description: 'Creature types, subtypes, conditions, skills, XP table, Ranger class, common feats and buffs.',
  // Library functions: shared script bodies with typed parameters, called as `fn.<id>({ … })` from a
  // record's script (or from a stored `call`, which compiles to the same thing). They live in the core
  // pack because core records call them: a pack may only call functions of its own or of core-3.5e.
  functions: [
    {
      id: 'haste', name: 'Haste', description: 'The haste package: one extra attack on a full attack, +1 dodge to attack and AC, +1 Reflex, +30 ft speed.',
      params: [],
      source: "extraAttack(1, { base: 'full' });\nbonus('attack', 1, 'dodge');\nbonus('ac', 1, 'dodge');\nbonus('save.ref', 1, 'dodge');\nbonus('speed', 30);",
    },
    {
      id: 'favoredEnemy', name: 'Favored enemy', description: 'Bonus damage and Bluff/Listen/Sense Motive/Spot/Survival against the chosen creature types.',
      params: [
        { name: 'types', type: 'tags', label: 'Creature types', required: true },
        { name: 'amount', type: 'number', label: 'Bonus', required: true },
      ],
      source: "if (target.isOneOf(types)) {\n  bonus('damage', amount);\n  bonus(['skill.bluff', 'skill.listen', 'skill.sense-motive', 'skill.spot', 'skill.survival'], amount);\n}",
    },
  ],
  tags: [
    ...creatureTypes.map((t) => tag(t, 'creatureType')),
    ...subtypes.map((t) => tag(t, 'subtype')),
    ...habitats.map((t) => tag(t, 'habitat')),
    ...conditions.map((t) => tag(t, 'condition')),
    ...sizes.map((t) => tag(t, 'size')),
  ],
  skills: skillDefs.map(([name, ability, trainedOnly, armorCheck]) => ({ id: slug(name), name, ability, trainedOnly: !!trainedOnly, armorCheck: !!armorCheck })),
  xpTable,
  classTables: [
    {
      id: 'ranger', name: 'Ranger', hitDie: 8, skillPointsPerLevel: 6, babProgression: 'full',
      saves: { fort: 'good', ref: 'good', will: 'poor' },
      classSkills: ['climb', 'concentration', 'craft', 'handle-animal', 'heal', 'hide', 'jump', 'knowledge-dungeoneering', 'knowledge-geography', 'knowledge-nature', 'listen', 'move-silently', 'profession', 'ride', 'search', 'spot', 'survival', 'swim', 'use-rope'],
      levelFeatures: { '1': ['favored-enemy-1', 'track', 'wild-empathy'], '2': ['rapid-shot'], '3': ['endurance'], '4': ['animal-companion', 'ranger-spells'], '5': ['favored-enemy-2'], '6': ['manyshot'], '7': ['woodland-stride'], '8': ['swift-tracker'], '9': ['evasion'], '10': ['favored-enemy-3'], '11': ['improved-precise-shot'], '13': ['camouflage'], '15': ['favored-enemy-4'], '17': ['hide-in-plain-sight'], '20': ['favored-enemy-5'] },
    },
  ],
  abilities: [
    // ---- ranger class features ----
    {
      // v4: calls the `favoredEnemy` library function (defined above, in this pack) instead of six bonus lines.
      id: 'favored-enemy-1', name: 'Favored Enemy (1st)', kind: 'feature', acquired: { kind: 'class' }, sourceRef: 'PHB p.47',
      text: '+2 on Bluff, Listen, Sense Motive, Spot and Survival checks and weapon damage rolls against the chosen creature type. Increases by +2 at ranger levels 5, 10, 15, 20 (choose which favored enemy improves).',
      params: { types: { kind: 'tags', label: 'Creature type', category: 'creatureType', count: 1 } },
      scripts: [{ id: 'fe', label: 'Favored enemy', events: ['always'], source: 'fn.favoredEnemy({ types: params.types, amount: vars.favoredEnemyBonus1 });' }],
    },
    {
      id: 'favored-enemy-2', name: 'Favored Enemy (2nd)', kind: 'feature', acquired: { kind: 'class' }, sourceRef: 'PHB p.47',
      text: 'Second favored enemy, gained at ranger level 5.',
      params: { types: { kind: 'tags', label: 'Creature type', category: 'creatureType', count: 1 } },
      scripts: [{ id: 'fe', label: 'Favored enemy', events: ['always'], source: 'fn.favoredEnemy({ types: params.types, amount: vars.favoredEnemyBonus2 });' }],
    },
    { id: 'track', name: 'Track', source: 'feat', text: 'Use Survival to follow tracks.', effects: [] },
    { id: 'endurance', name: 'Endurance', source: 'feat', text: '+4 on checks and saves to resist nonlethal damage from exertion, environment, starvation, etc. Sleep in light or medium armor without fatigue.', effects: [] },
    { id: 'craft-magic-arms-and-armor', name: 'Craft Magic Arms and Armor', source: 'feat', text: 'Create magic weapons, armor and shields (caster level 5 normally).', effects: [] },
    { id: 'craft-wondrous-item', name: 'Craft Wondrous Item', source: 'feat', text: 'Create wondrous items (caster level 3 normally).', effects: [] },
    {
      id: 'ranger-spells', name: 'Ranger Spells', source: 'class', activation: { action: 'standard' },
      text: 'From ranger level 4: divine spells from the ranger list, prepared daily, Wis-based (DC 10 + spell level + Wis mod). Caster level = half ranger level. Base 1st-level slots: 0 at ranger 4-5, 1 at 6-13, 2 at 14+; plus 1 bonus 1st-level slot for Wis 12-19 (2 for Wis 20+). Set the per-day totals in character vars rangerSpells1..rangerSpells4.',
      resources: [{ id: 'ranger-spell-1', label: '1st-level spells', max: 'rangerSpells1', per: 'day' }],
      effects: [],
    },
    { id: 'wild-empathy', name: 'Wild Empathy', source: 'class', text: 'Improve the attitude of an animal like a Diplomacy check: 1d20 + ranger level + Cha mod.', effects: [] },
    // ---- archery feats ----
    {
      id: 'point-blank-shot', name: 'Point Blank Shot', source: 'feat', sourceRef: 'PHB p.98',
      text: '+1 on attack and damage rolls with ranged weapons at ranges up to 30 feet.',
      effects: [{
        id: 'pbs', label: 'Point Blank Shot', when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { compare: 'target.distance', op: '<=', value: 30 }] },
        do: [{ kind: 'bonus', to: 'attack', value: 1 }, { kind: 'bonus', to: 'damage', value: 1 }],
      }],
    },
    { id: 'precise-shot', name: 'Precise Shot', source: 'feat', sourceRef: 'PHB p.98', text: 'No -4 penalty for shooting into melee.', effects: [{ id: 'n', when: { kind: 'attack.kind', attackKind: 'ranged' }, do: [{ kind: 'note', text: 'Precise Shot: no -4 for firing into melee.' }] }] },
    {
      id: 'rapid-shot', name: 'Rapid Shot', source: 'feat', sourceRef: 'PHB p.99',
      text: 'One extra ranged attack at your highest bonus during a full attack; all attacks that round take -2.',
      effects: [{ id: 'mode', do: [{ kind: 'attackMode', modeId: 'rapid-shot', label: 'Rapid Shot', base: 'full', extraAttacksAtTop: 1, penalty: -2, attackKind: 'ranged' }] }],
    },
    {
      id: 'manyshot', name: 'Manyshot', source: 'feat', sourceRef: 'PHB p.97',
      text: 'As a standard action fire two arrows at a single target within 30 ft with one attack roll at -4 (three arrows at BAB +11 for -6, four at +16 for -8). Precision damage applies once.',
      effects: [{ id: 'mode', do: [{ kind: 'attackMode', modeId: 'manyshot', label: 'Manyshot (2 arrows)', base: 'single', penalty: -4, attackKind: 'ranged', note: 'Manyshot: one roll, both arrows hit or miss together; roll weapon damage twice, precision/extra dice once. Target within 30 ft.' }] }],
    },
    { id: 'weapon-focus-ranged', name: 'Weapon Focus (ranged weapon)', source: 'feat', sourceRef: 'PHB p.102', text: '+1 on attack rolls with the chosen weapon.', effects: [{ id: 'wf', when: { kind: 'attack.kind', attackKind: 'ranged' }, do: [{ kind: 'bonus', to: 'attack', value: 1 }] }] },
    { id: 'improved-initiative', name: 'Improved Initiative', source: 'feat', effects: [{ id: 'ii', do: [{ kind: 'bonus', to: 'init', value: 4 }] }] },
    { id: 'dodge', name: 'Dodge', source: 'feat', text: '+1 dodge bonus to AC against one designated opponent.', effects: [{ id: 'd', when: { kind: 'toggle', id: 'dodge-target' }, do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'dodge' }] }] },
    // ---- buffs ----
    {
      id: 'haste', name: 'Haste', kind: 'status', harmful: false, duration: 10 * ROUND,
      text: 'One extra attack at full BAB on a full attack, +1 dodge to attack and AC, +1 Reflex, +30 ft speed.',
      scripts: [{ id: 'h', events: ['always'], source: 'fn.haste();' }],
    },
    { id: 'bless', name: 'Bless', source: 'buff', duration: { rounds: 10 }, effects: [{ id: 'b', do: [{ kind: 'bonus', to: 'attack', value: 1, bonusType: 'morale' }, { kind: 'bonus', to: 'save.will', value: 1, bonusType: 'morale' }] }] },
    { id: 'inspire-courage-1', name: 'Inspire Courage +1', source: 'buff', duration: 'untilRemoved', text: 'Bard song: +1 morale on attack and weapon damage, +1 vs charm and fear.', effects: [{ id: 'ic', do: [{ kind: 'bonus', to: 'attack', value: 1, bonusType: 'morale' }, { kind: 'bonus', to: 'damage', value: 1, bonusType: 'morale' }] }] },
    { id: 'inspire-courage-2', name: 'Inspire Courage +2', source: 'buff', duration: 'untilRemoved', effects: [{ id: 'ic', do: [{ kind: 'bonus', to: 'attack', value: 2, bonusType: 'morale' }, { kind: 'bonus', to: 'damage', value: 2, bonusType: 'morale' }] }] },
    { id: 'prayer', name: 'Prayer', source: 'buff', duration: { rounds: 6 }, effects: [{ id: 'p', do: [{ kind: 'bonus', to: 'attack', value: 1, bonusType: 'luck' }, { kind: 'bonus', to: 'damage', value: 1, bonusType: 'luck' }, { kind: 'bonus', to: 'save.fort', value: 1, bonusType: 'luck' }, { kind: 'bonus', to: 'save.ref', value: 1, bonusType: 'luck' }, { kind: 'bonus', to: 'save.will', value: 1, bonusType: 'luck' }] }] },
    { id: 'shaken', name: 'Shaken', source: 'condition', duration: 'untilRemoved', effects: [{ id: 's', do: [{ kind: 'bonus', to: 'attack', value: -2 }, { kind: 'bonus', to: 'save.fort', value: -2 }, { kind: 'bonus', to: 'save.ref', value: -2 }, { kind: 'bonus', to: 'save.will', value: -2 }] }] },
    { id: 'prone-self', name: 'Prone', source: 'condition', duration: 'untilRemoved', text: 'Prone: -4 melee attack, cannot use bows effectively (crossbows ok), +4 AC vs ranged, -4 AC vs melee.', effects: [{ id: 'p', when: { kind: 'attack.kind', attackKind: 'melee' }, do: [{ kind: 'bonus', to: 'attack', value: -4 }] }] },
    // ---- generic situational helpers (targets) ----
    { id: 'higher-ground', name: 'Higher ground', source: 'situational', duration: 'untilRemoved', effects: [{ id: 'h', when: { kind: 'attack.kind', attackKind: 'melee' }, do: [{ kind: 'bonus', to: 'attack', value: 1 }] }] },
  ],
});

writeFileSync(new URL('../packs/core-3.5e.json', import.meta.url), JSON.stringify(pack, null, 2) + '\n');
console.log(`core pack: ${pack.tags.length} tags, ${pack.skills.length} skills, ${pack.abilities.length} abilities`);
