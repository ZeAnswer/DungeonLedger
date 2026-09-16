import { test, expect } from '@playwright/test';

test('Functions tab: bundled functions list their callers, and a new function persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Functions', exact: true }).click();

  const haste = page.locator('[data-function="haste"]');
  const favoredEnemy = page.locator('[data-function="favoredEnemy"]');
  const trophy = page.locator('[data-function="trophy"]');
  await expect(haste).toBeVisible();
  await expect(favoredEnemy).toBeVisible();
  await expect(trophy).toBeVisible();

  // haste (core-3.5e): used by the Haste status itself and Boots of Speed
  await expect(haste).toContainText('used by');
  await expect(haste).toContainText('Haste');
  await expect(haste).toContainText('Boots of Speed');

  // favoredEnemy (core-3.5e): used by both ranger favored-enemy records
  await expect(favoredEnemy).toContainText('Favored Enemy (1st)');
  await expect(favoredEnemy).toContainText('Favored Enemy (2nd)');

  // trophy (memento): used by the three Monster Hunter trophy items
  await expect(trophy).toContainText('Chuul Gloves (trophy)');
  await expect(trophy).toContainText('Gargoyle Bracers (trophy)');
  await expect(trophy).toContainText('Shield Amulet (shield guardian trophy)');

  // Create a new function: one number param `n`, body returns its double
  await page.getByRole('button', { name: '+ New function' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Double');
  await sheet.getByLabel(/^Id/).fill('double');
  await sheet.getByRole('button', { name: '+ add parameter' }).click();
  await sheet.getByPlaceholder('name').fill('n');
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type('return n * 2;');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Survives a reload (persisted with the library); the store debounces writes, so give it a moment to flush first
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Functions', exact: true }).click();
  const doubleRow = page.locator('[data-function="double"]');
  await expect(doubleRow).toBeVisible();
  await expect(doubleRow).toContainText('double(n)');
  await doubleRow.click();
  await expect(sheet.getByLabel('Name')).toHaveValue('Double');
});
