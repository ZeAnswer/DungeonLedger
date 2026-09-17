import { test, expect } from '@playwright/test';
test('sheets close via button and browser back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Features/ }).click();
  await page.getByRole('button', { name: /Woodland Archer/ }).click();
  await expect(page.getByRole('button', { name: 'Remove from character' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('button', { name: 'Remove from character' })).toHaveCount(0);
  // back button also closes
  await page.getByRole('button', { name: /Woodland Archer/ }).click();
  await expect(page.getByRole('button', { name: 'Remove from character' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Remove from character' })).toHaveCount(0);
  await page.getByRole('button', { name: /Inventory/ }).click();
  await page.getByRole('button', { name: /All items/ }).click();
});

test('charges sheet lists every pool and edits it; long rest refills daily charges and heals per level', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  const boots = page.locator('[data-charge="boots-rounds"]');
  await expect(boots).toContainText('8/10');
  await boots.getByRole('button', { name: '− use' }).click();
  await expect(boots).toContainText('7/10');
  await boots.getByRole('button', { name: 'Reset' }).click();
  await expect(boots).toContainText('10/10');
  await boots.getByRole('button', { name: '− use' }).click();
  await page.getByRole('button', { name: 'Close' }).first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Long rest' }).click();
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  await expect(page.locator('[data-charge="boots-rounds"]')).toContainText('10/10');
});
