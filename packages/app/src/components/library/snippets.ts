import { PATHS, describePath } from '@hl/engine';

export type InsertItem = { label: string; insert: string; doc?: string };
export type InsertGroup = { label: string; items: InsertItem[] };

/** Data for the editor's `insert ▾` menu: common helper lines, every documented path, and the duration units. */
export const INSERT_GROUPS: InsertGroup[] = [
  {
    label: 'helpers',
    items: [
      { label: "bonus('attack', 1)", insert: "bonus('attack', 1);" },
      { label: "note('…')", insert: "note('…');" },
      { label: "target.mark('shaken', ROUND)", insert: "target.mark('shaken', ROUND);" },
      { label: "charges('id').use()", insert: "charges('id').use();" },
      { label: 'if (attack.isRanged) { }', insert: 'if (attack.isRanged) {\n  \n}' },
      { label: "if (target.is('undead')) { }", insert: "if (target.is('undead')) {\n  \n}" },
      { label: "if (battle.on('switch')) { }", insert: "if (battle.on('switch')) {\n  \n}" },
    ],
  },
  {
    label: 'paths',
    items: PATHS.map((p) => ({ label: p.path, insert: p.path, doc: describePath(p.path) })),
  },
  {
    label: 'units',
    items: [
      { label: 'ROUND', insert: 'ROUND' },
      { label: 'MINUTE', insert: 'MINUTE' },
      { label: 'HOUR', insert: 'HOUR' },
      { label: 'ENCOUNTER', insert: 'ENCOUNTER' },
      { label: 'UNTIL_MY_NEXT_TURN', insert: 'UNTIL_MY_NEXT_TURN' },
    ],
  },
];
