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

test('a pack update retires a record it no longer ships and drops it from the stored character', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Battle' })).toBeVisible();
  await page.waitForTimeout(1200); // let the first save flush
  // Pretend this install is still on memento v14, back when Weapon Focus (longbow) was on the sheet
  // (removed in v15 — see Part 1: the level-1 feat was Precise Shot, not Weapon Focus).
  await page.evaluate(async () => {
    const { get, set } = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm');
    const lib = await get('hl.library');
    lib.abilities['weapon-focus-longbow'] = {
      id: 'weapon-focus-longbow', name: 'Weapon Focus (longbow)', text: '+1 on attack rolls with longbows.', sourceRef: 'PHB p.102',
      scripts: [{ id: 'wf', events: ['always'], source: "if (attack.weapon.is('longbow')) {\n  bonus('attack', 1);\n}", enabled: true, priority: 0 }],
      kind: 'feature', acquired: { kind: 'feat' }, enabledByDefault: true, activations: [], pools: [],
    };
    lib.meta['ability:weapon-focus-longbow'] = { packId: 'memento', version: 14 };
    for (const k of Object.keys(lib.meta)) if (lib.meta[k].packId === 'memento') lib.meta[k].version = 14;
    await set('hl.library', lib);
    const ch = await get('hl.character');
    ch.abilities.push({ abilityId: 'weapon-focus-longbow', enabled: true, paramValues: {} });
    await set('hl.character', ch);
  });
  await page.reload();
  await expect(page.getByText(/Updated built-in packs:.*Memento/)).toBeVisible();

  // Gone from Character › Features.
  await page.getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: /^▸ Features/ }).click();
  await expect(page.getByText('Weapon Focus (longbow)')).toHaveCount(0);

  // Journal line.
  await page.getByRole('button', { name: /^▸ History/ }).click();
  await expect(page.getByText(/Removed from sheet \(no longer in the pack\):.*Weapon Focus \(longbow\)/)).toBeVisible();

  // The attack total no longer carries the stale +1.
  await page.getByRole('button', { name: /Battle/ }).click();
  await page.getByRole('button', { name: /New battle/ }).click();
  await expect(page.locator('[data-attack]').first()).toContainText('+11');
});
