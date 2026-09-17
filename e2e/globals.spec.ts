import { test, expect } from '@playwright/test';

test('Variables tab: add, edit, persist, and warn about shadowing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  const shared = page.locator('[data-section="shared"]');
  await shared.getByPlaceholder('name').fill('partySize');
  await shared.getByPlaceholder('value').fill('4');
  await shared.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('[data-global="partySize"]');
  await expect(row).toBeVisible();
  await row.getByRole('textbox').fill('5');
  await row.getByRole('textbox').blur();
  // survives a reload (persisted under hl.globals); the store debounces writes, so give it a moment to flush first
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(page.locator('[data-global="partySize"]').getByRole('textbox')).toHaveValue('5');
  // a name the character already has is shadowed
  await shared.getByPlaceholder('name').fill('trophyMultiplier');
  await shared.getByPlaceholder('value').fill('2');
  await shared.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('[data-global="trophyMultiplier"]')).toContainText('shadowed');
});

test('Variables tab: typing a negative decimal into a shared variable keeps every keystroke', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  const shared = page.locator('[data-section="shared"]');
  await shared.getByPlaceholder('name').fill('tempAdjust');
  await shared.getByPlaceholder('value').fill('1.5');
  await shared.getByRole('button', { name: 'Add', exact: true }).click();
  const input = page.locator('[data-global="tempAdjust"]').getByRole('textbox');
  await input.click();
  await input.press('ControlOrMeta+A');
  // Typed keystroke-by-keystroke (not `.fill`): every intermediate string, including the leading `-`,
  // must survive — a per-keystroke `Number(...) || 0` coercion would turn this into 275 (or drop the sign).
  await input.pressSequentially('-2.5');
  await expect(input).toHaveValue('-2.5');
  await input.blur();
  await expect(input).toHaveValue('-2.5');
  await page.waitForTimeout(600); // let the store's debounced write flush
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(page.locator('[data-global="tempAdjust"]').getByRole('textbox')).toHaveValue('-2.5');
});

test("Variables tab: Memento's own favoredEnemyBonus1 is editable and persists on the character", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  const row = page.locator('[data-var="favoredEnemyBonus1"]');
  await expect(row).toBeVisible();
  await expect(row.getByRole('textbox')).toHaveValue('4');
  await row.getByRole('textbox').fill('6');
  await row.getByRole('textbox').blur();
  await page.waitForTimeout(600); // let the store's debounced write flush

  await page.getByRole('button', { name: 'Settings' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Full backup' }).click();
  const file = await dl;
  const path = await file.path();
  const backup = JSON.parse(require('node:fs').readFileSync(path!, 'utf8'));
  expect(backup.character.vars.favoredEnemyBonus1).toBe(6);

  // and it's still there after a reload, read straight off the character's own row
  await page.reload();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(page.locator('[data-var="favoredEnemyBonus1"]').getByRole('textbox')).toHaveValue('6');
});
