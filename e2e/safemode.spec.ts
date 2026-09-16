import { test, expect } from '@playwright/test';

test('?safe=1 turns scripts off, the banner turns them back on', async ({ page }) => {
  await page.goto('/?safe=1');
  const banner = page.locator('[data-role="safe-banner"]');
  await expect(banner).toContainText('Scripts are off');

  // Memento's default longbow carries two always-on script bonuses to attack (Weapon Focus and
  // Bracers of Archery, Lesser, both +1). With scripts off the attack row should show the base
  // total without them.
  await page.getByRole('button', { name: /New battle/ }).click();
  const row = page.locator('[data-attack]').first();
  await expect(row).toContainText('+10');

  await page.getByRole('button', { name: 'Turn scripts back on' }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hl.safeMode'))).toBeNull();

  // The attack number updates in place, right there on the Battle screen, with no remount needed.
  await expect(row).toContainText('+12');
});

test('safe mode survives a reload once it is stored, and Settings switches it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('hl.safeMode', '1'));
  await page.reload();
  await expect(page.locator('[data-role="safe-banner"]')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Run scripts' }).click();
  await expect(page.locator('[data-role="safe-banner"]')).toHaveCount(0);
});
