/** The one event a script runs on, as the row's dropdown shows it. `always` is the compute phase and
 * cannot be combined with the others; `custom` reveals a name box and stores `custom:<name>`. */
export const EVENT_OPTIONS = [
  { value: 'always', label: 'Always' },
  { value: 'hit', label: 'When I hit' },
  { value: 'miss', label: 'When I miss' },
  { value: 'crit', label: 'When I crit' },
  { value: 'damaged', label: "When I'm hit" },
  { value: 'roundStart', label: 'Round start' },
  { value: 'roundEnd', label: 'Round end' },
  { value: 'use', label: 'When used' },
  { value: 'equip', label: 'When equipped' },
  { value: 'unequip', label: 'When unequipped' },
  { value: 'custom', label: 'Custom…' },
] as const;
