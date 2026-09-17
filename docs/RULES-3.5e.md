# 3.5e advancement rules the app implements

Sources: SRD (Ranger, Humans, Hit Points via dandwiki.com/wiki/SRD:*), PHB level-dependent benefits table, the DM's Monster Hunter prestige class PDF (`~/Documents/memento character details/`).

## Hit points
- Level 1: maximum hit die + Con modifier. Every later level: roll the class hit die + Con modifier, minimum 1 hp per level.
- Con modifier is applied per level, so it changes retroactively when Con changes.
- Engine: `derivedFromLevels().hpFromLevels = Σ hpRolled + Con × levels` (min 1/level); `resolveStat('hp.max')` adds `hpAdjust` and any ability bonuses (Toughness = `bonus hp.max +3`). Without a ledger the stored `hp.max` is used.
- 0 hp disabled, −1 to −9 dying, −10 dead (the tracker clamps at −10).

## Level-dependent benefits (PHB)
- General feat at level 1 and every 3rd level (3, 6, 9, 12, 15, 18). Human: one extra feat at level 1.
- +1 to one ability score at levels 4, 8, 12, 16, 20 (recorded per level in the ledger; the sheet's scores already include them).
- Max skill ranks: level + 3 for class skills, half that for cross-class. Cross-class ranks cost 2 points each.
- Skill points: (class points + Int modifier, minimum 1) per level, ×4 at level 1. Human: +4 at level 1, +1 per level.
- XP to reach level n: 500 × n × (n − 1). No multiclass penalty for prestige classes; human favored class is any.

## Ranger (SRD)
- d8, 6 + Int skill points, full BAB, good Fort and Ref, poor Will.
- 1: 1st favored enemy (+2), Track, wild empathy. 2: combat style (archery → Rapid Shot). 3: Endurance. 4: animal companion (Memento: replaced by Distracting Attack, PHB2), spells. 5: 2nd favored enemy (+2) and one existing favored enemy improves by +2. 6: improved combat style (archery → Manyshot). 7: woodland stride. 8: swift tracker. 9: evasion. 10: 3rd favored enemy.
- Spells from level 4: prepared, Wis-based, caster level = half ranger level. 1st-level slots: 0 at ranger 4–5, 1 at 6–13; bonus slot for Wis 12+. Memento (ranger 5, Wis 16): 1 first-level spell/day.
- Combat style benefits only in light or no armor.

## Monster Hunter (DM's prestige class)
- Requirements: BAB +5, 2nd Favored Enemy feat, 8 ranks Craft (Taxidermy/Trophy), a favored-enemy language, at least one neutral alignment component, a prepared token.
- d10, 4 + Int skill points, full BAB, good Fort and Ref, poor Will. Class skills = ranger list + Craft (Taxidermy/Trophy) + Knowledge (Monsters).
- Knowledge (Monsters) is **Wis-based**; ranks only after gaining MH levels, cap = MH level + 5 (max 15 at MH 10).
- 1: Monster Killer (3 types; monstrous humanoid, magical beast, outsider each cost 2; dragon+giant cost 1; must include a favored enemy; no humanoids), Monster Blow 1/day, Trophy (4 active slots). 2: Monster Lore. 3: Craft Magic Arms and Armor (free) + imbue trophies into arms/armor. 4: 6 trophy slots, Modify Trophy. 5: 5 types, Monster Blow 2/day, trophy bonuses ×2. 6: Craft Wondrous Item (free) + imbue into wondrous items. 7: 8 slots. 8: 7 types, Monster Blow 3/day. 10: unlimited slots, Monster Horror, trophy bonuses ×3.
- Monster Blow: declare before the attack; target must be a chosen type and below 50% of its starting HP; on hit, Fort DC = damage + MH level + Wis mod or die.
- Trophies: harvest from Large+ (one size category bigger than you) chosen types you damaged, within 1 minute; 500 gp and 24 h to prepare; ≤2 parts unless Knowledge (Monsters) DC 10 + MH. Max held = MH × 2 + Wis mod. Trophy bonuses are enhancement-type and do not stack with like bonuses; trophy save DCs = MH level + Wis mod + listed bonus. Wearing more than the active slot limit negates all trophies.
- Memento's trophies from Table A: Chuul gloves (paralysis DC +11 Fort, Improved Initiative), Gargoyle bracers (DR 10/magic, freeze DC +15, +2 Con), Drider ring (SR 14, darkness at will), Shield amulet (+4 natural armor, store one spell each of level 4/5/6), Medusa mask (petrifying gaze 1/day DC +12, snake attacks), Minotaur horn helmet (+2d6 on charge, never flat-footed, rage 1/day).

## Memento's current sheet (level 6, human ranger 5 / MH 1)
- HP 50 = 44 rolled + 6 × Con +1. Dex 16 includes the level-4 increase.
- General feat slots: level 1 ×2 (Precise Shot, Point Blank Shot — player-confirmed), level 3 (Knowledge Devotion*), level 6 (Woodland Archer). *guessed placement.
- Skill points: 40 at level 1 (6 + 3 Int + 1 human, ×4), 10 per level after.
