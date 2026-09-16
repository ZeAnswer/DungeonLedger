import { test, expect } from '@playwright/test';

const PACK = JSON.stringify({
  id: 'test-code-pack', name: 'Test code pack', version: 1,
  abilities: [{ id: 'test-imported', name: 'Test Imported', kind: 'feature', scripts: [{ id: 's1', events: ['always'], source: "bonus('init', 1)" }] }],
});

const CODE_FREE_PACK = JSON.stringify({
  id: 'test-code-free-pack', name: 'Test code-free pack', version: 1,
  abilities: [{ id: 'test-plain', name: 'Test Plain', kind: 'feature', scripts: [] }],
});

test('a pack carrying scripts asks before importing, and can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('…or paste pack JSON here').fill(PACK);
  await page.getByRole('button', { name: 'Import pasted JSON' }).click();
  const dialog = page.locator('[data-role="code-confirm"]');
  await expect(dialog).toContainText('runs as code');
  await expect(dialog).toContainText('1 script');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // scoped to the bottom nav: Settings' "Export library pack" button also matches "Library" by substring
  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Test Imported')).toHaveCount(0);
});

test('confirming imports the pack', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('…or paste pack JSON here').fill(PACK);
  await page.getByRole('button', { name: 'Import pasted JSON' }).click();
  await page.locator('[data-role="code-confirm"]').getByRole('button', { name: 'Import anyway' }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();
  // scoped to the bottom nav: Settings' "Export library pack" button also matches "Library" by substring
  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Test Imported')).toBeVisible();
});

test('a pack with no scripts or functions imports straight away, no confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('…or paste pack JSON here').fill(CODE_FREE_PACK);
  await page.getByRole('button', { name: 'Import pasted JSON' }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();
  await expect(page.locator('[data-role="code-confirm"]')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Test Plain')).toBeVisible();
});
