import { test, expect } from '@playwright/test';

test('gargoyle fight: knowledge check, woodland archer +4 after a miss, monster blow charge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Battle' })).toBeVisible();
  await page.getByRole('button', { name: /New battle/ }).click();
  await expect(page.getByText(/Round 1/)).toBeVisible();

  // add a gargoyle (monstrous humanoid = favored enemy #1)
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByPlaceholder('Gargoyle').fill('Gargoyle');
  await page.getByRole('button', { name: 'Monstrous Humanoid', exact: true }).click();
  await page.getByRole('button', { name: /^Add Gargoyle$/ }).click();

  // full attack rows: +12 / +7 with favored enemy damage +4 → 1d8+6
  const rows = page.locator('[data-attack]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('+12');
  await expect(rows.nth(0)).toContainText('1d8 +7');
  await expect(rows.nth(1)).toContainText('+7');

  // knowledge devotion warning → enter check 22 → +2 insight
  await page.getByRole('button', { name: /Knowledge Devotion: roll Knowledge/ }).click();
  await page.getByLabel(/Roll result/).fill('22');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rows.nth(0)).toContainText('+14');
  await expect(rows.nth(0)).toContainText('1d8 +9');

  // miss attack 1 → attack 2 gets Woodland Archer +4 (7+2+4 = 13)
  await rows.nth(0).getByRole('button', { name: 'Miss' }).click();
  await expect(rows.nth(0)).toContainText('MISS');
  await expect(rows.nth(0)).toContainText('+14'); // frozen at the number it was rolled with
  await expect(rows.nth(1)).toContainText('+13');
  await rows.nth(1).locator("button").first().click();
  await expect(rows.nth(1)).toContainText('Adjust for Range');
  // undo the miss → bonus disappears, row is live again; redo the miss
  await rows.nth(0).getByRole('button', { name: 'Undo' }).click();
  await expect(rows.nth(1)).toContainText('+9');
  await rows.nth(0).getByRole('button', { name: 'Miss' }).click();
  await expect(rows.nth(1)).toContainText('+13');

  // hit attack 2 → Distracting Attack flanks the target
  await rows.nth(1).getByRole('button', { name: 'Hit' }).click();
  await expect(page.getByText('Flanked').first()).toBeVisible();

  // monster blow: declare chip shows; usable 1/1; use it → 0/1
  const blowChip = page.getByRole('button', { name: /⚡ Monster Blow/ });
  await expect(blowChip).toContainText('1/1');
  await page.locator('[data-activation="monster-blow"]').getByRole('button', { name: 'Use' }).click();
  await expect(blowChip).toContainText('0/1');

  // next round clears the +4
  await page.getByRole('button', { name: /Next round/ }).click();
  await expect(page.getByText(/Round 2/)).toBeVisible();
  await expect(rows.nth(1)).toContainText('+9');

  // persists across reload
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByText(/Round 2/)).toBeVisible();
  await expect(page.getByText('Gargoyle')).toBeVisible();
});

test('settings export produces an importable pack', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export library pack' }).click();
  const file = await dl;
  const path = await file.path();
  const text = require('node:fs').readFileSync(path!, 'utf8');
  const pack = JSON.parse(text);
  expect(pack.abilities.length).toBeGreaterThan(40);
  expect(pack.characters[0].name).toBe('Memento');
});
