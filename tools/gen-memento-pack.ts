/**
 * Generates packs/memento.json from what the RPG Scribe export + DM handouts say.
 * Fields marked `todo` need the player's confirmation. Run: npx tsx tools/gen-memento-pack.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PackSchema, type Pack } from '../packages/engine/src/schema';
import { THIS_ATTACK, UNTIL_MY_NEXT_TURN } from '../packages/engine/src/scripts/units';

const rpgscribePath = new URL('./data/memento-rpgscribe.json', import.meta.url);
const rpgscribe = existsSync(rpgscribePath) ? JSON.parse(readFileSync(rpgscribePath, 'utf8')) : undefined;
const FEAT_ALIAS: Record<string, string> = { 'track?': 'track', 'weapon-focus?': 'weapon-focus-ranged', 'rapid-shot?': 'rapid-shot', 'point-blank-shot?': 'point-blank-shot', 'favored-enemy': 'favored-enemy-1', '2nd-favored-enemy': 'favored-enemy-2', 'knowledge-devotion': 'knowledge-devotion', 'woodland-archer': 'woodland-archer' };
// Class features vs general feats. RPG Scribe lists both under "feats"; general feat slots are level 1 (x2, human), 3, 6.
const CLASS_FEATURES = new Set(['track', 'favored-enemy-1', 'favored-enemy-2', 'rapid-shot', 'endurance', 'wild-empathy', 'ranger-spells', 'distracting-attack', 'monster-killer', 'monster-blow', 'trophy-crafting']);
const RANGER_FEATURES: Record<number, string[]> = { 1: ['favored-enemy-1', 'track', 'wild-empathy'], 2: ['rapid-shot'], 3: ['endurance'], 4: ['distracting-attack', 'ranger-spells'], 5: ['favored-enemy-2'] };
const MH_FEATURES: Record<number, string[]> = { 1: ['monster-killer', 'monster-blow', 'trophy-crafting'] };
const HP_ROLLS: Record<number, number> = { 5: 6, 6: 6 }; // export stores "1" for levels 5-6; player states rolled total 44 → 32 + 12
const EXTRA_FEATS: Record<number, string[]> = { 1: ['point-blank-shot'], 3: ['knowledge-devotion'] }; // not in export history; guessed slots
const levelHistory = (rpgscribe?.levelHistory ?? []).map((r: { level: number; classId: string; hpRolled: number; featsTaken: string[]; notes?: string }) => {
  const all = r.featsTaken.map((f) => (f === 'favored-enemy' && r.level > 1 ? 'favored-enemy-2' : FEAT_ALIAS[f] ?? f));
  const classLevel = r.classId === 'ranger' ? r.level : r.level - 5;
  const features = new Set([...(r.classId === 'ranger' ? RANGER_FEATURES[classLevel] ?? [] : MH_FEATURES[classLevel] ?? []), ...all.filter((f) => CLASS_FEATURES.has(f))]);
  return {
    ...r,
    hpRolled: HP_ROLLS[r.level] ?? r.hpRolled,
    featsTaken: [...all.filter((f) => !CLASS_FEATURES.has(f)), ...(EXTRA_FEATS[r.level] ?? [])],
    featuresGained: [...features],
    notes: [r.notes, HP_ROLLS[r.level] ? 'HP roll guessed (export unclear); total of levels 5+6 is 12' : '', EXTRA_FEATS[r.level] ? `${EXTRA_FEATS[r.level]!.join(', ')}: slot guessed, not in RPG Scribe history` : ''].filter(Boolean).join(' · ') || undefined,
  };
});

// Inventory: instances of library items. Equipped state from the RPG Scribe equipped-slot map.
const inv = (abilityId: string, equipped: boolean, extra: Record<string, unknown> = {}) => ({ id: `inv-${abilityId}`, abilityId, quantity: 1, equipped, ...extra });
const inventory = [
  inv('strong-arm-composite-longbow-1', true, { slotIndex: 0 }),
  inv('studded-leather', true, { slotIndex: 0 }),
  inv('ring-of-protection-1', true, { slotIndex: 0 }),
  inv('ring-of-swimming', true, { slotIndex: 1, notes: 'Cursed: cannot be removed; must explore new bodies of water (Will save).' }),
  inv('boots-of-speed', true, { slotIndex: 0 }),
  inv('hand-of-glory', true, { slotIndex: 0 }),
  inv('bracers-of-archery-lesser', true, { slotIndex: 0 }),
  inv('chuul-gloves', true, { slotIndex: 0 }),
  inv('belt-of-strength', true, { slotIndex: 0 }),
  inv('whistle-of-agony', true),
  inv('vaelors-manual', true),
  inv('pearl-of-sirines', false),
  inv('bracers-of-armor-1', false, { notes: 'Not worn: arms slot holds the Bracers of Archery.' }),
  inv('potion-cure-moderate', false),
  inv('potion-cure-serious', false),
  inv('gargoyle-hands', false),
  inv('gorgon-scale', false),
];
const equippedAbilities = new Set(inventory.filter((i) => i.equipped).map((i) => i.abilityId));
const linkedAbilities = new Set(inventory.map((i) => i.abilityId));

const KD_TABLE = [{ upTo: 15, value: 1 }, { upTo: 25, value: 2 }, { upTo: 30, value: 3 }, { upTo: 35, value: 4 }, { value: 5 }];
/** Monster Killer's chosen types, read from that record so callers never re-collect the same choice. */
const monsterKillerTypes = "player.paramsOf('monster-killer').types";

const pack: Pack = PackSchema.parse({
  id: 'memento',
  name: 'Memento (Ranger 5 / Monster Hunter 1)',
  version: 14, // bump when regenerating so installed apps merge the new abilities (the stored character is never overwritten)
  description: 'Memento the archer: homebrew Monster Hunter prestige class, DM-granted memories, items, trophies, Vaelor\'s Monsters\' Manual.',
  // Library functions: shared script bodies with typed parameters, called as `fn.<id>({ … })` from a
  // record's script (or from a stored `call`, which compiles to the same thing). `haste` and
  // `favoredEnemy` live in the core pack, which every library loads; only the Monster Hunter trophy
  // multiplier is specific to this pack.
  functions: [
    {
      id: 'trophy', name: 'Trophy bonus', description: 'A Monster Hunter trophy bonus, multiplied by the character\'s trophyMultiplier (×2 at MH5, ×3 at MH10).',
      params: [
        { name: 'stat', type: 'stat', label: 'Stat', required: true },
        { name: 'base', type: 'number', label: 'Base bonus', required: true },
        { name: 'type', type: 'bonusType', label: 'Bonus type', default: 'enhancement' },
      ],
      source: 'bonus(stat, base * (vars.trophyMultiplier ?? 1), type);',
    },
  ],
  tags: [
    { id: 'analyzed', label: 'Analyzed (Hunter\'s Analysis)', category: 'condition' },
    { id: 'oversized', label: 'Oversized (above Large)', category: 'custom' },
  ],
  skills: [
    { id: 'knowledge-monsters', name: 'Knowledge (Monsters)', ability: 'wis', trainedOnly: true },
    { id: 'craft-taxidermy', name: 'Craft (Taxidermy/Trophy)', ability: 'int' },
  ],
  classTables: [
    {
      id: 'monster-hunter', name: 'Monster Hunter', hitDie: 10, skillPointsPerLevel: 4, babProgression: 'full',
      saves: { fort: 'good', ref: 'good', will: 'poor' },
      classSkills: ['climb', 'concentration', 'craft', 'handle-animal', 'heal', 'hide', 'jump', 'knowledge-dungeoneering', 'knowledge-geography', 'knowledge-nature', 'listen', 'move-silently', 'profession', 'ride', 'search', 'spot', 'survival', 'swim', 'use-rope', 'craft-taxidermy', 'knowledge-monsters'],
      levelFeatures: { '1': ['monster-killer', 'monster-blow', 'trophy-crafting'], '2': ['monster-lore'], '3': ['craft-magic-arms-and-armor', 'imbue-trophy-arms'], '4': ['modify-trophy'], '6': ['craft-wondrous-item', 'imbue-trophy-wondrous'], '10': ['monster-horror'] },
    },
  ],
  abilities: [
    // ---- feats bound to gear ----
    { id: 'weapon-focus-longbow', name: 'Weapon Focus (longbow)', origin: 'feat', sourceRef: 'PHB p.102', text: '+1 on attack rolls with longbows.', effects: [{ id: 'wf', when: { is: 'attack.weapon.tag.longbow' }, do: [{ verb: 'modify', to: 'attack', value: 1 }] }] },
    // ---- DM feats / memories ----
    {
      id: 'woodland-archer', name: 'Woodland Archer', source: 'feat', sourceRef: 'Races of the Wild p.154',
      text: 'Adjust for Range: after missing a foe with a ranged attack, +4 on later ranged attacks vs that foe this round (DM ruling: stacks per miss). Pierce the Foliage: after hitting despite concealment, next round your ranged attacks vs that foe ignore that concealment. Moving Sniper: after a successful sniping attack you may move once before re-hiding.',
      effects: [
        {
          id: 'adjust', label: 'Adjust for Range',
          when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' } }] },
          do: [{ verb: 'modify', to: 'attack', value: '4 * sel(history.miss.me.current.thisRound)' }],
        },
        {
          id: 'pierce', label: 'Pierce the Foliage',
          when: { kind: 'all', of: [{ kind: 'attack.kind', attackKind: 'ranged' }, { kind: 'target.hasCondition', condition: 'concealed' }, { kind: 'log', event: 'hit', target: 'current', scope: 'lastRound' }] },
          do: [{ kind: 'ignoreConcealment' }, { kind: 'note', text: 'Pierce the Foliage: ignore this foe\'s concealment miss chance this round.' }],
        },
        { id: 'sniper', label: 'Moving Sniper', when: { kind: 'toggle', id: 'sniping' }, do: [{ kind: 'note', text: 'Moving Sniper: after a hit while sniping, take one move action before re-hiding.' }] },
      ],
    },
    {
      id: 'knowledge-devotion', name: 'Knowledge Devotion', source: 'feat', sourceRef: 'Complete Champion',
      text: 'Once per creature type per combat, make a Knowledge check (need 1+ rank in the matching Knowledge skill). Insight bonus on attack and damage vs that type: 15 or less +1, 16-25 +2, 26-30 +3, 31-35 +4, 36+ +5.',
      effects: [{
        id: 'kd', label: 'Knowledge Devotion',
        do: [
          { kind: 'bonusFromTable', promptId: 'knowledge', perTagCategory: 'creatureType', to: 'attack', bonusType: 'insight', table: KD_TABLE },
          { kind: 'bonusFromTable', promptId: 'knowledge', perTagCategory: 'creatureType', to: 'damage', bonusType: 'insight', table: KD_TABLE },
        ],
      }],
    },
    {
      id: 'distracting-attack', name: 'Distracting Attack', source: 'class', sourceRef: 'PHB2 ranger variant (replaces animal companion)',
      text: 'Whenever you hit an enemy with a weapon attack, that enemy is considered flanked by you until the end of your next turn.',
      todo: 'Confirm exact duration and whether the flank counts for you or only allies.',
      effects: [{ id: 'flank', trigger: 'onHit', do: [{ kind: 'applyTag', to: 'target', tag: 'flanked', duration: 'endOfNextTurn' }] }],
    },
    {
      id: 'memento-aqua', name: 'Memento Aqua', source: 'memory',
      text: 'Memory fragment: +2 Swim; +2 attack and damage vs creatures whose habitat is mainly aquatic.',
      effects: [
        { id: 'swim', do: [{ kind: 'bonus', to: 'skill.swim', value: 2 }] },
        { id: 'aqua', label: 'vs aquatic', when: { kind: 'target.hasTag', tag: 'aquatic' }, do: [{ kind: 'bonus', to: 'attack', value: 2 }, { kind: 'bonus', to: 'damage', value: 2 }] },
      ],
    },
    {
      id: 'memento-formido', name: 'Memento Formido', kind: 'feature', acquired: { kind: 'dm' },
      text: '+2 Will vs your favored enemy and Monster Killer types (taken from those records).',
      scripts: [{
        id: 'will', events: ['always'],
        source: "const types = [...player.paramsOf('favored-enemy-1').types, ...player.paramsOf('favored-enemy-2').types, ...player.paramsOf('monster-killer').types];\nif (target.isOneOf(types)) bonus('save.will', 2);",
      }],
    },
    { id: 'the-shit-ive-seen', name: 'The Shit I\'ve Seen', source: 'feat', text: '+4 Survival.', effects: [{ id: 's', do: [{ kind: 'bonus', to: 'skill.survival', value: 4 }] }] },
    // ---- Monster Hunter class ----
    {
      id: 'monster-killer', name: 'Monster Killer', source: 'class',
      text: 'Chosen monster types (3 at MH1, 5 at MH5, 7 at MH8) usable for trophies, Monster Blow and Monster Horror. Monstrous Humanoid, Magical Beast and Outsider cost 2 picks; Dragon+Giant together cost 1.',
      todo: 'Confirm the 3 chosen types.',
      params: { types: { kind: 'tags', label: 'Monster Killer types', category: 'creatureType' } },
      effects: [],
    },
    {
      id: 'monster-blow', name: 'Monster Blow', kind: 'feature', acquired: { kind: 'class' },
      text: 'Declare before the attack roll. Target must be a Monster Killer type and below 50% HP. On hit: Fortitude save DC = damage dealt + MH level + Wis mod or die.',
      activations: [{
        id: 'monster-blow', action: 'free', duration: THIS_ATTACK,
        charges: { max: '1 + floor(classLevel(monster-hunter) / 5) + floor(classLevel(monster-hunter) / 8)', resetOn: 'day', label: 'Monster Blow' },
        scripts: [
          { id: 'use', events: ['use'], source: "charges('monster-blow').use();" },
          {
            id: 'declared', label: 'Monster Blow', events: ['always'],
            source: "if (target.isOneOf(" + monsterKillerTypes + ")) {\n  need(target.hurt >= HURT.BLOODIED, 'target is bloodied or worse');\n  note(`MONSTER BLOW: on hit, Fort DC = damage + ${player.classes['monster-hunter'] + player.mod.wis} or die.`);\n}",
          },
        ],
      }],
    },
    {
      id: 'trophy-crafting', name: 'Trophy Crafting', source: 'class',
      text: 'Harvest ≤2 parts (more with Knowledge (Monsters) DC 10+MH) within 1 minute from Large+ monsters you damaged, Monster Killer types only. Max trophies = MH×2 + Wis mod; active slots 4 (MH1), 6 (MH4), 8 (MH7). Trophy bonuses ×2 at MH5, ×3 at MH10.',
      effects: [],
    },
    { id: 'imbue-trophy-arms', name: 'Imbue Trophy (Arms & Armor)', source: 'class', enabledByDefault: false, text: 'MH3: imbue trophies into magic weapons/armor/shields. 1 week, 1,000 gp per +1 equivalent, 50% failure destroys both.', effects: [] },
    { id: 'modify-trophy', name: 'Modify Trophy', source: 'class', enabledByDefault: false, text: 'MH4: change a trophy\'s slot once. Knowledge (Monsters) DC 15+MH, Craft (Taxidermy) DC 20, 500 gp and 500 XP × MH level.', effects: [] },
    { id: 'imbue-trophy-wondrous', name: 'Imbue Trophy (Wondrous Item)', source: 'class', enabledByDefault: false, text: 'MH6: imbue trophies into wondrous items. 25% failure; salvage trophy with Craft DC 30.', effects: [] },
    { id: 'monster-horror', name: 'Monster Horror', source: 'class', enabledByDefault: false, text: 'MH10: immune to mind-affecting abilities of chosen types; +2 attack/damage/saves per matching trophy worn (min +2), enemies -2.', effects: [] },
    {
      id: 'monster-lore', name: 'Monster Lore', source: 'class', enabledByDefault: false,
      text: 'MH2: Locate monster type DC 20, specific monster DC 30, assess below 50% HP DC 25 (+3 per size above Large).', effects: [],
    },
    // ---- items ----
    {
      // v4: the spent haste round is the activation's own charge pool; the while-active script calls fn.haste().
      id: 'boots-of-speed', name: 'Boots of Speed', kind: 'item', item: { category: 'wondrous', slot: 'feet', weight: 1, price: '12,000 gp' },
      text: 'Free action: spend one haste round (10 per day). This round: one extra attack on a full attack, +1 dodge to attack and AC, +1 Reflex, +30 ft speed. Choose again each round.',
      activations: [{
        id: 'boots-rounds', action: 'free', duration: UNTIL_MY_NEXT_TURN,
        charges: { max: 10, resetOn: 'day', label: 'Haste rounds' },
        scripts: [{ id: 'haste', label: 'Haste', events: ['always'], source: 'fn.haste();' }],
      }],
    },
    { id: 'ring-of-protection-1', item: { category: 'wondrous', slot: 'ring', price: '2,000 gp' }, name: 'Ring of Protection +1', source: 'item', effects: [{ id: 'r', do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'deflection' }] }] },
    { id: 'bracers-of-armor-1', item: { category: 'wondrous', slot: 'arms', weight: 1 }, name: 'Bracers of Armor +1', source: 'item', effects: [{ id: 'b', do: [{ kind: 'bonus', to: 'ac', value: 1, bonusType: 'armor' }] }] },
    { id: 'ring-of-swimming', item: { category: 'wondrous', slot: 'ring' }, name: 'Ring of Swimming (cursed)', source: 'item', text: 'Cursed: cannot remove; must explore any new body of water (Will save).', effects: [{ id: 's', do: [{ kind: 'bonus', to: 'skill.swim', value: 5, bonusType: 'competence' }] }] },
    { id: 'bracers-of-archery-lesser', name: 'Bracers of Archery, Lesser', origin: 'item', item: { category: 'wondrous', slot: 'arms' }, text: '+1 competence bonus on attack rolls with any bow (not crossbows); grants bow proficiency.', effects: [{ id: 'b', when: { is: 'attack.weapon.tag.bow' }, do: [{ verb: 'modify', to: 'attack', value: 1, type: 'competence' }] }] },
    { id: 'belt-of-strength', item: { category: 'wondrous', slot: 'waist' }, name: 'Belt of Strength +2', source: 'item', text: '+2 enhancement bonus to Strength while worn.', effects: [{ id: 'str', do: [{ kind: 'bonus', to: 'ability.str', value: 2, bonusType: 'enhancement' }] }] },
    {
      id: 'hand-of-glory', name: 'Hand of Glory', origin: 'item', item: { category: 'wondrous', slot: 'neck', weight: 2, price: '8,000 gp' },
      text: 'Worn around the neck. Grants an extra ring slot (a ring worn on the hand works), Daylight 1/day and See Invisibility 1/day.',
      grants: ['hog-daylight', 'hog-see-invisibility'],
      effects: [{ id: 'slot', do: [{ verb: 'slot', slot: 'ring', count: 1 }] }],
    },
    { id: 'hog-daylight', name: 'Daylight', origin: 'spell', activation: { action: 'standard' }, text: 'CL 5: 60-ft radius bright light for 50 minutes.', resources: [{ id: 'hog-daylight', label: 'Daylight', max: 1, resetOn: 'day' }], effects: [] },
    { id: 'hog-see-invisibility', name: 'See Invisibility', origin: 'spell', activation: { action: 'standard' }, text: 'CL 5: see invisible creatures and objects for 50 minutes.', resources: [{ id: 'hog-see-invis', label: 'See Invisibility', max: 1, resetOn: 'day' }], effects: [] },
    { id: 'pearl-of-sirines', item: { category: 'wondrous', slot: 'none' }, name: 'Pearl of the Sirines', source: 'item', text: 'Water breathing / freedom of movement underwater while held.', effects: [] },
    {
      id: 'whistle-of-agony', item: { category: 'wondrous', slot: 'none' }, name: 'Monsters\' Agony Whisper Whistle', source: 'item', activation: { action: 'standard' },
      text: '1/day: every Monstrous Humanoid, Magical Beast, Aberration and oversized (above Large) monster within 2 km cries out, revealing itself. Listen DC 15 for direction. They also learn your direction. Outsiders unaffected.',
      resources: [{ id: 'whistle', label: 'Whistle', max: 1, per: 'day' }],
      effects: [],
    },
    // ---- plain gear (no rules yet) ----
    { id: 'strong-arm-composite-longbow-1', name: 'Strong-Arm Composite Longbow +1', source: 'item', item: { category: 'weapon', slot: 'mainHand', weight: 3, tags: ['bow', 'longbow', 'composite'], weapon: { kind: 'ranged', dice: '1d8', critRange: 20, critMult: 3, rangeIncrement: 110, attackAbility: 'dex', damageAbility: 'str', maxDamageAbilityBonus: 4, enhancement: 1, twoHanded: true } }, text: 'Composite longbow with a +1 enhancement bonus. DM homebrew: adds your full Strength modifier to damage, up to +4 (no penalty for a low score). Two-handed. 1d8, ×3, 110 ft.', effects: [] },
    { id: 'studded-leather', name: 'Studded Leather Armor', source: 'item', item: { category: 'armor', slot: 'armor', weight: 20, price: '25 gp' }, text: 'Light armor: +3 AC, max Dex +5, armor check penalty -1, 15% arcane spell failure.', effects: [{ id: 'ac', do: [{ kind: 'bonus', to: 'ac', value: 3, bonusType: 'armor' }] }] },
    { id: 'potion-cure-moderate', name: 'Potion of Cure Moderate Wounds', origin: 'item', item: { category: 'potion', weight: 0, price: '300 gp' }, text: 'CL 3: heals 2d8+3 hp. Standard action to drink; one potion is used up.', activation: { action: 'standard' }, cost: [{ kind: 'item', abilityId: 'potion-cure-moderate' }], effects: [{ id: 'n', trigger: 'onUse', do: [{ verb: 'note', text: 'Roll 2d8+3 and apply as healing.' }] }] },
    { id: 'potion-cure-serious', name: 'Potion of Cure Serious Wounds', origin: 'item', item: { category: 'potion', weight: 0, price: '750 gp' }, text: 'CL 5: heals 3d8+5 hp. Standard action to drink; one potion is used up.', activation: { action: 'standard' }, cost: [{ kind: 'item', abilityId: 'potion-cure-serious' }], effects: [{ id: 'n', trigger: 'onUse', do: [{ verb: 'note', text: 'Roll 3d8+5 and apply as healing.' }] }] },
    {
      id: 'vaelors-manual', name: "Vaelor's Monsters' Manual", kind: 'item', item: { category: 'wondrous', slot: 'none', weight: 5 },
      text: 'Unique artifact, no slot, CL 12. Grants Monster Knowledge, Hunter\'s Analysis, Hunter\'s Instinct and the Bestiary Collection.',
      effects: [
        { id: 'instinct', label: "Hunter's Instinct", do: [{ verb: 'modify', to: 'skill.knowledge-monsters', value: 1 }] },
        { id: 'crit', label: 'Analyzed target', when: { is: 'target.condition.analyzed' }, do: [{ verb: 'modify', to: 'critRange', value: 1 }, { verb: 'note', text: 'Hunter\'s Analysis: threat range doubled vs this target (if base is 19-20 use 17-20). If crit-immune: DR/SR -1 for 1 round, or suppress one ability (Knowledge DC 20).' }] },
      ],
      activations: [
        { id: 'monster-knowledge', name: 'Monster Knowledge', action: 'standard', onUse: [{ id: 'reveal', when: { compare: 'battle.prompt.knowledge', op: '>=', value: 16 }, do: [{ verb: 'reveal' }] }] },
        { id: 'hunters-analysis', name: "Hunter's Analysis", action: 'fullRound', onUse: [{ id: 'mark', do: [{ verb: 'tag', to: 'target', tag: 'analyzed', duration: 'encounter' }] }] },
      ],
    },
    // ---- tombstones: folded into vaelors-manual in v10; kept as inert records so the merge overwrites the v9 copies
    // that are still in installed libraries (merge never deletes) and any lingering character instance contributes nothing.
    { id: 'monster-knowledge', name: 'Monster Knowledge (merged)', kind: 'item', item: { category: 'gear', tags: [] }, text: 'Merged into Vaelor\'s Monsters\' Manual.' },
    { id: 'hunters-analysis', name: "Hunter's Analysis (merged)", kind: 'item', item: { category: 'gear', tags: [] }, text: 'Merged into Vaelor\'s Monsters\' Manual.' },
    { id: 'hunters-instinct', name: "Hunter's Instinct (merged)", kind: 'item', item: { category: 'gear', tags: [] }, text: 'Merged into Vaelor\'s Monsters\' Manual.' },
    { id: 'gargoyle-hands', name: "Gargoyle's hands", source: 'item', item: { category: 'material' }, text: 'Trophy crafting material (Monstrous humanoid). Crafts: Gargoyle bracers — DR 10/magic, freeze DC +15, +2 Con.', effects: [] },
    { id: 'gorgon-scale', name: "Gorgon's scale", source: 'item', item: { category: 'material' }, text: 'Trophy crafting material (Magical beast). Crafts: Gorgon belt — +2d6 damage when charging, petrifying cone 60 ft 1/day DC +14 Fort negates.', effects: [] },
    // ---- trophies (Monster Hunter) ----
    {
      id: 'chuul-gloves', kind: 'item', item: { category: 'trophy', slot: 'hands' }, name: 'Chuul Gloves (trophy)', text: 'Trophy: +4 initiative (improved initiative); paralysis touch DC 11+, Fort negates.',
      scripts: [{ id: 'i', events: ['always'], source: "fn.trophy({ stat: 'init', base: 4 });" }],
    },
    {
      id: 'gargoyle-bracers', kind: 'item', item: { category: 'trophy', slot: 'arms' }, name: 'Gargoyle Bracers (trophy)',
      text: 'Trophy: DR 10/magic, freeze (appear as statue, Spot DC 15 + MH + Wis), +2 Con. Trophy bonuses are enhancement-type.', todo: 'Equip in Inventory if worn.',
      scripts: [{ id: 'con', events: ['always'], source: "fn.trophy({ stat: 'ability.con', base: 2 });\nnote('Gargoyle bracers: DR 10/magic.');" }],
    },
    { id: 'rider-ring', item: { category: 'trophy', slot: 'ring' }, name: 'Rider Ring (drider trophy)', source: 'item', enabledByDefault: false, text: 'Trophy: SR 14, darkness at will.', todo: 'Enable if worn.', effects: [] },
    { id: 'medusa-mask', item: { category: 'trophy', slot: 'head' }, name: 'Medusa Mask (trophy)', source: 'item', enabledByDefault: false, text: 'Trophy: petrifying gaze 1/day DC 12 Fort; 3 snake attacks 5 ft +3, 1d4 + poison 1d6 Str DC 12.', todo: 'Enable if worn.', resources: [{ id: 'medusa-gaze', label: 'Petrifying gaze', max: 1, per: 'day' }], effects: [] },
    {
      id: 'shield-amulet', kind: 'item', item: { category: 'trophy', slot: 'neck' }, name: 'Shield Amulet (shield guardian trophy)',
      text: 'Trophy: +4 natural armor; stores one spell of each level 4/5/6.', todo: 'Enable if worn.',
      scripts: [{ id: 'n', events: ['always'], source: "fn.trophy({ stat: 'ac', base: 4, type: 'natural' });" }],
    },
  ],
  characters: [{
    id: 'memento', name: 'Memento',
    abilityScores: { str: 12, dex: 16, con: 12, int: 16, wis: 16, cha: 11 },
    xp: 16088,
    classLevels: [{ classId: 'ranger', level: 5 }, { classId: 'monster-hunter', level: 1 }],
    hp: { max: 50, current: 50, temp: 0, nonlethal: 0 },
    baseArmor: 0, baseShield: 0, baseNaturalArmor: 0, speed: 30,
    skills: {
      spot: { ranks: 8 }, hide: { ranks: 7 }, 'move-silently': { ranks: 7 }, survival: { ranks: 7 }, listen: { ranks: 6 }, climb: { ranks: 2 },
      'knowledge-monsters': { ranks: 8 }, 'craft-taxidermy': { ranks: 6 },
    },
    attackProfiles: [],
    abilities: [
      { abilityId: 'favored-enemy-1', paramValues: { types: ['aberration'] } },
      { abilityId: 'favored-enemy-2', paramValues: { types: ['outsider'] } },
      { abilityId: 'track' }, { abilityId: 'endurance' }, { abilityId: 'wild-empathy', enabled: false },
      { abilityId: 'point-blank-shot' }, { abilityId: 'rapid-shot' }, { abilityId: 'weapon-focus-longbow' }, { abilityId: 'ranger-spells' },
      { abilityId: 'woodland-archer' }, { abilityId: 'knowledge-devotion' }, { abilityId: 'distracting-attack' },
      { abilityId: 'memento-aqua' }, { abilityId: 'memento-formido' },
      { abilityId: 'the-shit-ive-seen' },
      { abilityId: 'monster-killer', paramValues: { types: ['aberration', 'dragon', 'giant', 'construct'] } },
      { abilityId: 'monster-blow' },
      { abilityId: 'trophy-crafting' }, { abilityId: 'monster-lore', enabled: false },
      ...[...linkedAbilities].map((abilityId) => ({ abilityId, enabled: equippedAbilities.has(abilityId) })),
      { abilityId: 'gargoyle-bracers', enabled: false }, { abilityId: 'rider-ring', enabled: false }, { abilityId: 'medusa-mask', enabled: false }, { abilityId: 'shield-amulet', enabled: false },
    ],
    inventory,
    resourceState: { 'boots-rounds': { used: 2 } },
    levelHistory,
    extraSkillPointsPerLevel: 1,
    extraFeatAtFirstLevel: true,
    journal: [{ at: '2026-09-07T00:00:00Z', kind: 'note', text: 'Imported from RPG Scribe export (2026-09-06). Max HP = 44 rolled + 6 Con = 50.' }],
    vars: { favoredEnemyBonus1: 4, favoredEnemyBonus2: 2, trophyMultiplier: 1, rangerSpells1: 1 },
    notes: [
      'Bow: Strong-Arm Composite Longbow +1 (DM homebrew: Str to damage up to +4). Armor: studded leather +3. No melee weapon. Bracers of Armor +1 carried, not worn (arms slot: Bracers of Archery; would not stack with armor anyway).',
      'TODO confirm: favored enemy types (export params 321140E5, E6E711CC), which one is +4.',
      'TODO confirm: Monster Killer 3 types. Guessed monstrous humanoid + aberration + magical beast (MH says Monstrous Humanoid costs 2 picks).',
      'TODO confirm: system feats from export (1109FFDC, 3A4A00BD, 4DEAF3B6, B186BA2D+weapon). Guessed Point Blank Shot (human bonus, lvl 1), Rapid Shot (combat style), Track, Weapon Focus (lvl 1). Knowledge Devotion assumed to be the level-3 feat. General feat slots used: lvl1 ×2, lvl3, lvl6 (Woodland Archer).',
      'Ranger spells: 1 first-level spell/day (0 base + Wis bonus). Spells known are unresolved UUIDs in the export; edit vars.rangerSpells1 if different.',
      'Knowledge (Monsters) is Wis-based per the class PDF; cap = MH level + 5 (6 now). Export shows 8 ranks: check with DM.',
      'TODO confirm: 4 unknown skills with ranks 8/8/8/7 and one class-skill override with 6 (export uuids D11C1603, 700AC2F3, D80DE6A9, ECB3CA28, 40AD06C4).',
      'Skill ranks = export value / 2 (export stores half-ranks). Human: +1 skill point/level (matches 40 points at level 1).',
      'Level ledger imported from RPG Scribe (tools/rpgscribe-import.ts); unknown-* skills are the 5 unresolved ones above.',
      'Ability scores are base values (RPG Scribe raw); the Belt of Strength adds +2 STR as an enhancement bonus on top.',
      'Trophies worn: only Chuul Gloves enabled; enable others in Character > Abilities if worn.',
    ].join('\n'),
  }],
});

writeFileSync(new URL('../packs/memento.json', import.meta.url), JSON.stringify(pack, null, 2) + '\n');
console.log(`memento pack: ${pack.abilities.length} abilities, character with ${pack.characters[0]!.abilities.length} ability instances`);
