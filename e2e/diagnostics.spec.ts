import { test, expect } from '@playwright/test';

test('a script that writes to a read-only value is reported on the record and in Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Broken');
  await sheet.getByLabel(/^Id/).fill('test-broken');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"]').fill('player.mod.cha += 1');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // put it on the sheet so the compute pass runs it
  await page.locator('[data-record="test-broken"]').getByRole('button', { name: 'add' }).click();
  // scoped to the bottom nav: the bundled pack also has library records named "Memento Aqua"/"Memento Formido"
  await page.getByRole('navigation').getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('[data-error="test-broken"]')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/read-only/)).toBeVisible();
});
