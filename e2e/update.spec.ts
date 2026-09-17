import { test, expect } from '@playwright/test';

test('an older install merges newer built-in packs on startup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Battle' })).toBeVisible();
  await page.waitForTimeout(1200); // let the first save flush
  // Pretend this install only ever saw bestiary v1 with one monster missing.
  await page.evaluate(async () => {
    const { get, set } = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm');
    const lib = await get('hl.library');
    delete lib.monsters['bestiary-tarrasque'];
    for (const k of Object.keys(lib.meta)) if (lib.meta[k].packId === 'bestiary') lib.meta[k].version = 1;
    await set('hl.library', lib);
  });
  await page.reload();
  await expect(page.getByText(/Updated built-in packs: Hunter's Bestiary/)).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Monsters', exact: true }).first().click();
  await page.getByPlaceholder('Search monsters…').fill('tarrasque');
  await expect(page.getByText('Tarrasque')).toBeVisible();
});

test('a pack update restores a skill the seed character has but the stored one is missing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Battle' })).toBeVisible();
  await page.waitForTimeout(1200); // let the first save flush
  // Pretend this install only ever saw an older Memento (before Handle Animal was on her sheet).
  await page.evaluate(async () => {
    const { get, set } = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm');
    const lib = await get('hl.library');
    for (const k of Object.keys(lib.meta)) if (lib.meta[k].packId === 'memento') lib.meta[k].version = 1;
    await set('hl.library', lib);
    const ch = await get('hl.character');
    delete ch.skills['handle-animal'];
    await set('hl.character', ch);
  });
  await page.reload();
  await expect(page.getByText(/Updated built-in packs:.*Memento/)).toBeVisible();
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Skills/ }).click();
  await expect(page.getByRole('button', { name: /Handle Animal/ })).toContainText('8 ranks');
  await page.getByRole('button', { name: /^▸ History/ }).click();
  await expect(page.getByText(/Skills restored from built-in pack:.*Handle Animal/)).toBeVisible();
});
