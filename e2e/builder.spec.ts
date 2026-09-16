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

test('script editor: events are a multi-select and always is exclusive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Trigger');
  await sheet.getByLabel(/^Id/).fill('test-trigger');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("target.mark('shaken', 3 * ROUND)");
  const events = sheet.locator('[data-role="script-events"]');
  await events.getByRole('button', { name: 'hit', exact: true }).click();
  await events.getByRole('button', { name: 'crit', exact: true }).click();
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0]).toMatchObject({ events: ['hit', 'crit'], source: "target.mark('shaken', 3 * ROUND)" });
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

test('call form: a stored function call round-trips through the form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Caller');
  await sheet.getByLabel(/^Id/).fill('test-caller');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.getByRole('button', { name: 'call a function' }).click();
  await sheet.locator('[data-role="call-fn"]').selectOption('favoredEnemy');
  await sheet.locator('[data-role="arg-amount"] input').fill('4');
  await sheet.locator('[data-role="arg-types"] button', { hasText: 'ƒx' }).click();
  await sheet.locator('[data-role="arg-types"] input').fill('params.types');
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json.scripts[0].call).toEqual({ fn: 'favoredEnemy', args: { types: { k: 'expr', v: 'params.types' }, amount: { k: 'lit', v: 4 } } });
  // and back: reopening the form shows the same values
  await sheet.getByRole('button', { name: 'Feature' }).click();
  await expect(sheet.locator('[data-role="arg-amount"] input')).toHaveValue('4');
  await expect(sheet.locator('[data-role="arg-types"] input')).toHaveValue('params.types');
});
