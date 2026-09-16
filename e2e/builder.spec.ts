import { test, expect } from '@playwright/test';

test('script editor: a new feature stores its source and defaults to always', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Archer');
  await sheet.getByLabel(/^Id/).fill('test-archer');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("if (attack.isRanged) bonus('attack', 4)");
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json).toMatchObject({
    id: 'test-archer', name: 'Test Archer', kind: 'feature', acquired: { kind: 'feat' },
    scripts: [{ events: ['always'], source: "if (attack.isRanged) bonus('attack', 4)", enabled: true, priority: 0 }],
    activations: [],
  });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Test Archer')).toBeVisible();
});

test('item editor: category, slot and an activation with charges and a duration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Boots');
  await sheet.getByLabel(/^Id/).fill('test-boots');
  await sheet.locator('#item-cat').selectOption('wondrous');
  await sheet.getByRole('button', { name: 'Feet', exact: true }).click();
  await sheet.getByRole('button', { name: '+ add activation' }).click();
  await sheet.getByRole('button', { name: '+ limit uses' }).click();
  await sheet.getByPlaceholder('max', { exact: true }).fill('10');
  await sheet.getByRole('button', { name: '+ set duration' }).click();
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json).toMatchObject({
    id: 'test-boots', name: 'Test Boots', kind: 'item',
    item: { category: 'wondrous', slot: 'feet' },
    activations: [{ action: 'standard', charges: { max: 10, resetOn: 'day' }, duration: 'untilMyNextTurn' }],
  });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Test Boots')).toBeVisible();
});

test('script row: the event dropdown is a single-select that writes one event, and no snippet chips render', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Trigger');
  await sheet.getByLabel(/^Id/).fill('test-trigger');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  const row = sheet.locator('[data-role="script"]').first();
  await row.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("target.mark('shaken', 3 * ROUND)");

  // Defaults to Always; no per-event pill chips and no snippet chip row exist anymore.
  await expect(row.locator('[data-role="script-event"]')).toHaveValue('always');
  await expect(row.locator('[data-role="script-events"]')).toHaveCount(0);
  for (const label of ['flat bonus', 'two stats', 'ranged & close', 'vs a type', 'on hit: mark']) {
    await expect(row.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  // The insert menu exists, is one button, and is closed by default.
  const insertMenu = row.locator('[data-role="script-insert"]');
  await expect(insertMenu).toHaveCount(1);
  await expect(insertMenu).not.toHaveAttribute('open');

  await row.locator('[data-role="script-event"]').selectOption({ label: 'When I hit' });
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0]).toMatchObject({ events: ['hit'], source: "target.mark('shaken', 3 * ROUND)" });
});

test('editor: the insert ▾ menu opens, inserts a picked item at the cursor, and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Insert Menu');
  await sheet.getByLabel(/^Id/).fill('test-insert-menu');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  const row = sheet.locator('[data-role="script"]').first();
  await row.locator('[data-role="script-source"] .cm-content').click();

  const insertMenu = row.locator('[data-role="script-insert"]');
  await insertMenu.locator('summary').click();
  await expect(insertMenu).toHaveAttribute('open', '');
  await insertMenu.getByRole('button', { name: 'ROUND', exact: true }).click();
  await expect(row.locator('[data-role="script-source"] .cm-content')).toContainText('ROUND');
  await expect(insertMenu).not.toHaveAttribute('open');
  await sheet.getByRole('button', { name: 'JSON' }).click();
  expect(JSON.parse(await sheet.locator('textarea').inputValue()).scripts[0].source).toContain('ROUND');
});

test('script row: ⋯ is closed by default (even for a brand-new row) and opens label/id/enabled/priority/switch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Priority');
  await sheet.getByLabel(/^Id/).fill('test-priority');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  const row = sheet.locator('[data-role="script"]').first();
  await row.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("bonus('attack', 1)");

  // Closed by default: none of the folded controls are on the page yet.
  await expect(row.locator('[data-role="script-priority"]')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'call a function' })).toHaveCount(0);
  // ...but the "use a function instead" link is findable without opening ⋯.
  await expect(row.getByRole('button', { name: 'use a function instead' })).toBeVisible();

  await row.locator('[data-role="script-more"]').click();
  const priority = row.locator('[data-role="script-priority"]');
  await priority.click();
  await priority.press('ControlOrMeta+A');
  // Typed, not `.fill`, so the leading `-` (which a per-keystroke `Number(...) || 0` used to eat) survives.
  await priority.pressSequentially('-5');
  await expect(priority).toHaveValue('-5');
  await priority.blur();
  await sheet.getByRole('button', { name: 'JSON' }).click();
  expect(JSON.parse(await sheet.locator('textarea').inputValue()).scripts[0]).toMatchObject({ priority: -5, source: "bonus('attack', 1)" });

  // Switching that same row to "call a function" (via the ⋯ switch, reopened after the JSON round trip)
  // must not leave `source` sitting around dead (the engine prefers `call` over `source`, so a stale one
  // would silently never run again), and must seed `fn` with a real function rather than an empty selection.
  await sheet.getByRole('button', { name: 'Feature', exact: true }).click();
  await row.locator('[data-role="script-more"]').click();
  await row.getByRole('button', { name: 'call a function' }).click();
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const after = JSON.parse(await sheet.locator('textarea').inputValue()).scripts[0];
  expect(after.source).toBe('');
  expect(after.call.fn).not.toBe('');
});

test('script preview: probes the script against the live character', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Preview');
  await sheet.getByLabel(/^Id/).fill('test-preview');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("bonus('attack', 2)");
  const preview = sheet.locator('[data-role="script-preview"]');
  await expect(preview).toContainText('attack');
  await expect(preview).toContainText('+2');

  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type("need(false, 'never'); bonus('attack', 2)");
  await expect(preview).toContainText('needs never');
});

test('function form: "use a function" hides code entirely; addToAbility renders a Str…Cha dropdown and previews live', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Function Form');
  await sheet.getByLabel(/^Id/).fill('test-function-form');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  const row = sheet.locator('[data-role="script"]').first();
  await row.getByRole('button', { name: 'use a function instead' }).click();

  // No code box at all once a row calls a function.
  await expect(row.locator('[data-role="script-source"]')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'write code instead' })).toBeVisible();

  await row.locator('[data-role="call-fn"]').selectOption('addToAbility');
  await row.locator('[data-role="arg-ability"] select').selectOption('ability.str');
  await row.locator('[data-role="arg-amount"] input').fill('2');

  // The bonus-type dropdown's first option reads "not specified" and stores 'untyped'.
  const typeSelect = row.locator('[data-role="arg-type"] select');
  await expect(typeSelect.locator('option').first()).toHaveText('not specified');
  await expect(typeSelect.locator('option').first()).toHaveAttribute('value', 'untyped');

  // The "Right now" preview still renders for a call row.
  const preview = row.locator('[data-role="script-preview"]');
  await expect(preview).toContainText('ability.str');
  await expect(preview).toContainText('+2');

  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Test Function Form')).toBeVisible();

  // Reopen the record: the call round-tripped through Save.
  await page.locator('[data-record="test-function-form"]').getByRole('button').first().click();
  const reopened = page.locator('.fixed.inset-0');
  await reopened.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await reopened.locator('textarea').inputValue());
  expect(json.scripts[0].call).toMatchObject({ fn: 'addToAbility', args: { ability: { k: 'lit', v: 'ability.str' }, amount: { k: 'lit', v: 2 } } });

  // ...and back to code: the link under the form gets you there without opening ⋯.
  await reopened.getByRole('button', { name: 'Feature', exact: true }).click();
  const reopenedRow = reopened.locator('[data-role="script"]').first();
  await reopenedRow.getByRole('button', { name: 'write code instead' }).click();
  await expect(reopenedRow.locator('[data-role="script-source"]')).toBeVisible();
});

test('call form: a stored function call round-trips through the form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Caller');
  await sheet.getByLabel(/^Id/).fill('test-caller');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  const row = sheet.locator('[data-role="script"]').first();
  await row.getByRole('button', { name: 'use a function instead' }).click();
  await row.locator('[data-role="call-fn"]').selectOption('favoredEnemy');
  await row.locator('[data-role="arg-amount"] input').fill('4');

  // ƒx round trip on a tags-typed (array) param: lit -> expr seeds a JSON-quoted literal, expr -> lit
  // recovers the original value when the expression still parses as that shape.
  const typesBox = row.locator('[data-role="arg-types"]');
  const typesFx = typesBox.getByRole('button', { name: 'ƒx' });
  await typesBox.getByRole('button', { name: 'Dragon', exact: true }).click();
  await typesFx.click();
  await expect(typesBox.locator('input')).toHaveValue('["dragon"]');
  await typesFx.click();
  await expect(typesBox.getByRole('button', { name: 'Dragon', exact: true })).toHaveClass(/bg-amber-500/);
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const roundTripped = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(roundTripped.scripts[0].call.args.types).toEqual({ k: 'lit', v: ['dragon'] });
  await sheet.getByRole('button', { name: 'Feature' }).click();

  await typesFx.click();
  await row.locator('[data-role="arg-types"] input').fill('params.types');
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0].call).toEqual({ fn: 'favoredEnemy', args: { types: { k: 'expr', v: 'params.types' }, amount: { k: 'lit', v: 4 } } });
  // and back: reopening the form shows the same values
  await sheet.getByRole('button', { name: 'Feature' }).click();
  await expect(row.locator('[data-role="arg-amount"] input')).toHaveValue('4');
  await expect(row.locator('[data-role="arg-types"] input')).toHaveValue('params.types');
});
