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

test('long-press on a dotted stat (Will save) reveals a bracket-quoted, usable path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Stats/ }).click();
  await longPress(page, `[data-path="player.stats['save.will']"]`);
  const toast = page.locator('[data-role="path-toast"]');
  await expect(toast).toContainText("player.stats['save.will']");
  await expect(toast).toContainText('my Will');
});

test('a cancelled long-press does not swallow the next ordinary tap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New battle/ }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByPlaceholder('Gargoyle').fill('Gargoyle');
  await page.getByRole('button', { name: 'Monstrous Humanoid', exact: true }).click();
  await page.getByRole('button', { name: /^Add Gargoyle$/ }).click();

  // "Sniping" is a battle toggle (rendered via ToggleChip, which carries the long-press hook); its own
  // click toggles its active styling, amber when on.
  const chip = page.getByRole('button', { name: 'Sniping', exact: true });
  await expect(chip).not.toHaveClass(/bg-amber-500/);

  // Held past the threshold (toast shows) but the gesture ends in pointercancel, not a click.
  await chip.dispatchEvent('pointerdown', { pointerId: 1, bubbles: true, cancelable: true, isPrimary: true });
  await page.waitForTimeout(600);
  await expect(page.locator('[data-role="path-toast"]')).toBeVisible();
  await chip.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true, cancelable: true, isPrimary: true });
  await page.getByRole('button', { name: 'Dismiss' }).click();

  // A plain, unrelated tap right after must still toggle the chip on — it must not be swallowed as if it
  // were the click that follows a fired long-press.
  await chip.click();
  await expect(chip).toHaveClass(/bg-amber-500/);
});
