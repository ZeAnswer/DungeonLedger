import { test, expect } from '@playwright/test';

test('skills: budgeted +/- then accept; JSON override', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Skills/ }).click();
  await page.getByRole('button', { name: 'Edit' }).nth(0).click(); // skills edit (stats section is collapsed → its Edit is still rendered; pick by sheet title instead)
  const sheet = page.locator('.fixed.inset-0');
  await expect(sheet.getByText(/Edit (skills|stats)/)).toBeVisible();
  if (await sheet.getByText('Edit stats').isVisible()) { await sheet.getByRole('button', { name: 'Close' }).first().click(); await page.getByRole('button', { name: 'Edit' }).nth(1).click(); }
  await expect(sheet.getByText('Edit skills')).toBeVisible();
  const remaining = sheet.getByText(/Points remaining:/);
  // The seed character's authoritative skill list spends the whole budget (remaining: 0), so every +
  // button starts disabled; free one point elsewhere first, same as a player over budget would have to.
  await sheet.getByPlaceholder('Filter skills…').fill('Climb');
  await sheet.getByRole('button', { name: '−' }).first().click();
  const before = Number((await remaining.textContent())!.match(/remaining: (-?\d+)/)![1]);
  await sheet.getByPlaceholder('Filter skills…').fill('Spot');
  await sheet.getByRole('button', { name: '+' }).first().click();
  await expect(remaining).toContainText(`remaining: ${before - 1}`);
  await sheet.getByRole('button', { name: /Accept/ }).click();
  await expect(page.getByText('Spot9 ranks')).toBeVisible();

  // override: set Spot back to 8 via JSON
  await page.getByRole('button', { name: 'Edit' }).nth(1).click();
  await sheet.getByRole('button', { name: 'Override (JSON)' }).click();
  const ta = sheet.locator('textarea');
  const json = JSON.parse(await ta.inputValue());
  json.skills.spot.ranks = 8;
  await ta.fill(JSON.stringify(json));
  await sheet.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByText('Spot8 ranks')).toBeVisible();
});

test('stats: +1 ability consumes an unspent level increase only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Stats/ }).click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const sheet = page.locator('.fixed.inset-0');
  await expect(sheet.getByText(/unspent level increases: 0/)).toBeVisible();
  // level 4 increase already recorded (dex) → all + buttons disabled
  const plus = sheet.locator('button', { hasText: '+' }).first();
  await expect(plus).toBeDisabled();
  await sheet.getByRole('button', { name: 'Override (JSON)' }).click();
  await expect(sheet.locator('textarea')).toContainText(/"abilityScores"/);
});
