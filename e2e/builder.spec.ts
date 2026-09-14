import { test, expect } from '@playwright/test';

test('block builder: build Adjust for Range from selectors, JSON matches v3', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Archer');
  await sheet.getByLabel(/^Id/).fill('test-archer');
  // a fresh feature has no blocks: add one, then build its condition tree
  await sheet.getByRole('button', { name: '+ add effect block' }).click();
  const forms = sheet.locator('[data-role="cond-form"]');
  // root is ALL of []; add child 1 → compare attack.kind = ranged
  await sheet.getByRole('button', { name: '+ add condition' }).first().click();
  await forms.nth(1).selectOption('compare');
  await sheet.locator('[data-role="sel-domain"]').first().selectOption('attack');
  await sheet.locator('[data-role="sel-field"]').first().selectOption('kind');
  await sheet.locator('[data-role="cond-op"]').first().selectOption('=');
  await sheet.locator('[data-role="cond-value"]').first().selectOption('ranged');
  // child 2 → history (defaults: I missed this target this round)
  await sheet.getByRole('button', { name: '+ add condition' }).first().click();
  await forms.nth(2).selectOption('history');
  // DO: default modify attack 1 → 4
  await sheet.getByPlaceholder(/e.g. 2, wisMod/).fill('4');
  await sheet.getByRole('button', { name: 'JSON' }).click();
  const json = JSON.parse(await sheet.locator('textarea').inputValue());
  expect(json).toMatchObject({
    id: 'test-archer', name: 'Test Archer', kind: 'feature', acquired: { kind: 'feat' },
    effects: [{
      trigger: 'always',
      when: { all: [{ compare: 'attack.kind', op: '=', value: 'ranged' }, { history: { event: 'miss', by: 'me', vs: 'current', scope: 'thisRound' }, op: '>=', value: 1 }] },
      do: [{ verb: 'modify', to: 'attack', value: 4, type: 'untyped', mode: 'add' }],
    }],
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
