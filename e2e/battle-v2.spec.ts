import { test, expect } from '@playwright/test';

async function startWithGargoyle(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /New battle/ }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByPlaceholder('Gargoyle').fill('Gargoyle');
  await page.getByRole('button', { name: 'Monstrous Humanoid', exact: true }).click();
  await page.getByRole('button', { name: /^Add Gargoyle$/ }).click();
}

test('Hand of Glory: Daylight and See Invisibility are separate actions with their own charges', async ({ page }) => {
  await startWithGargoyle(page);
  const daylight = page.locator('[data-activation="hog-daylight"]');
  const seeInvis = page.locator('[data-activation="hog-see-invisibility"]');
  await expect(daylight).toContainText('Hand of Glory');
  await expect(daylight).toContainText('1/1');
  await daylight.getByRole('button', { name: 'Use' }).click();
  await expect(daylight).toContainText('0/1');
  await expect(seeInvis).toContainText('1/1');
});

test('distance chip enables Point Blank Shot; Boots of Speed toggle adds an attack and ticks per round', async ({ page }) => {
  await startWithGargoyle(page);
  const rows = page.locator('[data-attack]');
  await expect(rows.nth(0)).toContainText('+11');
  await page.getByRole('button', { name: '30 ft', exact: true }).click();
  await expect(rows.nth(0)).toContainText('+12'); // Point Blank Shot
  await expect(rows).toHaveCount(2);
  const boots = page.locator('[data-activation="boots-rounds"]');
  await expect(boots).toContainText('8/10');
  await boots.getByRole('button', { name: 'Use' }).click();
  await expect(rows).toHaveCount(3); // haste extra attack this round
  await expect(rows.nth(0)).toContainText('+13'); // +1 dodge
  await expect(boots).toContainText('7/10');
  await expect(boots).toContainText('ACTIVE');
  await page.getByRole('button', { name: /Next round/ }).click();
  await expect(rows).toHaveCount(2); // expired: choose again
  await expect(boots).toContainText('7/10');
  await boots.getByRole('button', { name: 'Use' }).click();
  await expect(rows).toHaveCount(3);
  await expect(boots).toContainText('6/10');
});

test('it hit me: logs enemy action and reduces HP', async ({ page }) => {
  await startWithGargoyle(page);
  await page.getByPlaceholder('dmg').fill('7');
  await page.getByRole('button', { name: 'it hit me' }).click();
  await page.getByRole('button', { name: /Log \(/ }).click();
  await expect(page.getByText('R1Gargoyle hit you for 7')).toBeVisible();
  await page.getByRole('button', { name: /Memento/ }).click();
  await expect(page.getByRole('button', { name: '/ 50' })).toBeVisible();
  await expect(page.getByText('43', { exact: true })).toBeVisible();
});

test('Monster Blow: declare chip lasts one attack and spends its charge', async ({ page }) => {
  await startWithGargoyle(page);
  const chip = page.getByRole('button', { name: /⚡ Monster Blow/ });
  const row = page.locator('[data-activation="monster-blow"]');
  await expect(chip).toContainText('1/1');
  await chip.click();
  await expect(row).toContainText('ACTIVE');
  await expect(chip).toContainText('0/1');
  // the declaration is spent by the first attack it applies to
  await page.locator('[data-attack]').nth(0).getByRole('button', { name: 'Hit' }).click();
  await expect(row).not.toContainText('ACTIVE');
  await expect(chip).toContainText('0/1');
});
