import { test, expect } from '@playwright/test';

// Dispatched directly on the element (bypassing real cursor movement) so a row below the fold — e.g. a
// skill list on a phone-height viewport — still gets pressed without first scrolling it into view.
async function longPress(page: import('@playwright/test').Page, selector: string) {
  const locator = page.locator(selector).first();
  await locator.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true, cancelable: true, isPrimary: true });
  await page.waitForTimeout(600);
  await locator.dispatchEvent('pointerup', { pointerId: 1, bubbles: true, cancelable: true, isPrimary: true });
}

test('long-press on a skill reveals its script path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Skills/ }).click(); // sections start collapsed
  await longPress(page, '[data-path="player.skills.spot.total"]');
  const toast = page.locator('[data-role="path-toast"]');
  await expect(toast).toContainText('player.skills.spot.total');
  await expect(toast.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('long-press on an ability score reveals its path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Stats/ }).click();
  await longPress(page, '[data-path="player.stats.dex"]');
  await expect(page.locator('[data-role="path-toast"]')).toContainText('player.stats.dex');
});
