import { test, expect } from '@playwright/test';

test('"for the monster": a hit shows the checks the DM rolls, on the attack row and in the Log; undo clears them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New battle/ }).click();

  // Aberration is one of Memento's chosen Monster Killer types (same setup as the gargoyle fight test).
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByPlaceholder('Gargoyle').fill('Gargoyle');
  await page.getByRole('button', { name: 'Aberration', exact: true }).click();
  await page.getByRole('button', { name: /^Add Gargoyle$/ }).click();

  // Chuul Gloves are equipped by default on Memento's seed sheet; its `hit` script fires on any hit.
  const rows = page.locator('[data-attack]');
  await rows.nth(0).getByRole('button', { name: 'Hit' }).click();

  // DC = fn.trophyDc({ base: 11 }) = 11 + Monster Hunter 1 + Wis mod 3 = 15.
  const forTheMonster = rows.nth(0).getByText('Chuul Gloves: paralysis');
  await expect(forTheMonster).toContainText('Fort DC 15');

  await page.getByRole('button', { name: /Log \(/ }).click();
  await expect(page.getByText('Chuul Gloves: paralysis')).toContainText('Fort DC 15');

  // Undo (from the Log) removes the event, and with it the checks it carried.
  await page.getByRole('button', { name: 'Undo last' }).click();
  await expect(page.getByText('Chuul Gloves: paralysis')).toHaveCount(0);
  await page.getByRole('button', { name: /Attack/ }).click();
  await expect(rows.nth(0).getByText('Chuul Gloves: paralysis')).toHaveCount(0);
});

test('concealment: a miss-chance line appears for a concealed target; Pierce the Foliage strikes it through next round', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New battle/ }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByPlaceholder('Gargoyle').fill('Gargoyle');
  await page.getByRole('button', { name: 'Aberration', exact: true }).click();
  await page.getByRole('button', { name: /^Add Gargoyle$/ }).click();

  // Right-click (long-press desktop equivalent) the roster chip to open its edit sheet, mark it Concealed.
  await page.getByRole('button', { name: /Gargoyle/ }).first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Concealed', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();

  const rows = page.locator('[data-attack]');
  await expect(rows.nth(0)).toContainText('Miss chance 20% — concealed');

  // Hit despite concealment this round → Woodland Archer's Pierce the Foliage ignores it next round.
  await rows.nth(0).getByRole('button', { name: 'Hit' }).click();
  await page.getByRole('button', { name: /Next round/ }).click();
  const pierced = rows.nth(0).locator('.line-through');
  await expect(pierced).toContainText('Miss chance 20% — Pierce the Foliage');
});
