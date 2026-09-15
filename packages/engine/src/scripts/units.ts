import { SIZE_ORDER, HURT_ORDER } from '../context';
import { BonusTypeSchema } from '../schema';

export const SECOND = 1, ROUND = 6 * SECOND, MINUTE = 10 * ROUND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const THIS_ATTACK = 'thisAttack' as const, UNTIL_MY_NEXT_TURN = 'untilMyNextTurn' as const, ENCOUNTER = 'encounter' as const, UNTIL_REMOVED = 'untilRemoved' as const;
/** Rounds a seconds-duration occupies in the battle round model (minimum 1 for any positive duration). */
export function toRounds(seconds: number): number { return seconds <= 0 ? 0 : Math.max(1, Math.ceil(seconds / ROUND)); }

const enumOf = (names: readonly string[]) => Object.freeze(Object.fromEntries(names.map((n, i) => [n.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(), i])));
export const SIZE = enumOf(SIZE_ORDER) as Readonly<Record<'FINE'|'DIMINUTIVE'|'TINY'|'SMALL'|'MEDIUM'|'LARGE'|'HUGE'|'GARGANTUAN'|'COLOSSAL', number>>;
export const HURT = enumOf(HURT_ORDER) as Readonly<Record<'UNHURT'|'SCRATCHED'|'BLOODIED'|'NEAR_DEATH', number>>;
export const BONUS = Object.freeze(Object.fromEntries(BonusTypeSchema.options.map((t) => [t.toUpperCase(), t]))) as Readonly<Record<string, string>>;
export const STAT = Object.freeze({ ATTACK: 'attack', DAMAGE: 'damage', AC: 'ac', AC_TOUCH: 'ac.touch', AC_FLAT_FOOTED: 'ac.flatFooted', FORT: 'save.fort', REF: 'save.ref', WILL: 'save.will', INIT: 'init', SPEED: 'speed', HP_MAX: 'hp.max', CRIT_RANGE: 'critRange', CRIT_MULT: 'critMult', STR: 'ability.str', DEX: 'ability.dex', CON: 'ability.con', INT: 'ability.int', WIS: 'ability.wis', CHA: 'ability.cha' });
