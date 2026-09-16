/** The shapes the authored packs actually use, one tap each. */
export const SNIPPETS: { label: string; insert: string }[] = [
  { label: 'flat bonus', insert: "bonus('attack', 1);" },
  { label: 'two stats', insert: "bonus(['attack', 'damage'], 1, 'competence');" },
  { label: 'ranged & close', insert: "if (attack.isRanged && target.within(30)) bonus(['attack', 'damage'], 1);" },
  { label: 'vs a type', insert: "if (target.is('aberration')) bonus('damage', 2);" },
  { label: 'switched on', insert: "if (battle.on('sniping')) penalty('attack', 2);" },
  { label: 'after a miss', insert: "if (history('miss', { since: 'round' }) >= 1) bonus('attack', 4);" },
  { label: 'check result', insert: "bonus('attack', tier(ask('knowledge', { per: 'creatureType' }), [15, 1], [20, 2], [Infinity, 3]));" },
  { label: 'attack mode', insert: "attackMode({ id: 'rapid-shot', label: 'Rapid Shot', base: 'full', extra: 1, penalty: 2, kind: 'ranged' });" },
  { label: 'extra attack', insert: "extraAttack(1, { base: 'full' });" },
  { label: 'explicit reason', insert: "need(player.wearing('strong-arm-composite-longbow'), 'the longbow equipped');" },
  { label: 'note', insert: "note('DC {10 + player.level} Will save');" },
  { label: 'on hit: mark', insert: "target.mark('shaken', 3 * ROUND);" },
  { label: 'on use: spend', insert: "charges('monster-blow').use(1);" },
  { label: 'on hit: remember', insert: "setVar('lastHitRound', battle.round);" },
  { label: 'wake another script', insert: "emit('trophyTaken', { id: target.type });" },
];
