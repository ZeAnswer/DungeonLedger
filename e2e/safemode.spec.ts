import { test, expect } from '@playwright/test';

test('?safe=1 turns scripts off, the banner turns them back on', async ({ page }) => {
  await page.goto('/?safe=1');
  const banner = page.locator('[data-role="safe-banner"]');
  await expect(banner).toContainText('Scripts are off');
  await page.getByRole('button', { name: 'Turn scripts back on' }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hl.safeMode'))).toBeNull();
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
