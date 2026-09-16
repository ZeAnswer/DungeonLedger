import { test, expect } from '@playwright/test';

test('Globals tab: add, edit, persist, and warn about shadowing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Globals', exact: true }).click();
  await page.getByPlaceholder('name').fill('partySize');
  await page.getByPlaceholder('value').fill('4');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('[data-global="partySize"]');
  await expect(row).toBeVisible();
  await row.getByRole('textbox').fill('5');
  await row.getByRole('textbox').blur();
  // survives a reload (persisted under hl.globals); the store debounces writes, so give it a moment to flush first
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Globals', exact: true }).click();
  await expect(page.locator('[data-global="partySize"]').getByRole('textbox')).toHaveValue('5');
  // a name the character already has is shadowed
  await page.getByPlaceholder('name').fill('trophyMultiplier');
  await page.getByPlaceholder('value').fill('2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('[data-global="trophyMultiplier"]')).toContainText('shadowed');
});
