import { test, expect } from '@playwright/test';

test('a script that writes to a read-only value is reported on the record and in Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Broken');
  await sheet.getByLabel(/^Id/).fill('test-broken');
  await sheet.getByRole('button', { name: '+ add script' }).click();
  await sheet.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type('player.mod.cha += 1');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // put it on the sheet so the compute pass runs it
  await page.locator('[data-record="test-broken"]').getByRole('button', { name: 'add' }).click();
  // scoped to the bottom nav: the bundled pack also has library records named "Memento Aqua"/"Memento Formido"
  await page.getByRole('navigation').getByRole('button', { name: /Memento/ }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('[data-error="test-broken"]')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/read-only/)).toBeVisible();
  // "Clear and retry" drops the recorded error everywhere it's shown
  await page.getByRole('button', { name: 'Clear and retry' }).click();
  await expect(page.getByText(/read-only/)).not.toBeVisible();
  // scoped to the bottom nav: Settings' "Export library pack" button also matches "Library" by substring
  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('[data-error="test-broken"]')).not.toBeVisible();
});

test('an activation script gets the same live preview a record-level script gets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Activation Preview');
  await sheet.getByLabel(/^Id/).fill('test-activation-preview');
  await sheet.getByRole('button', { name: '+ add activation' }).click();
  const actEditor = sheet.locator('.border-amber-900\\/60');
  await actEditor.getByRole('button', { name: '+ add script' }).click();
  await actEditor.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type("bonus('attack', 3)");
  // Before the fix, ActivationEditor never passed `ability` to ScriptsEditor, so this never rendered.
  await expect(actEditor.locator('[data-role="script-preview"]')).toContainText('+3');
});

test('an activation script that fails when actually used is reported inline in its own editor, not just the record dot', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: '+ New feature' }).click();
  const sheet = page.locator('.fixed.inset-0');
  await sheet.getByLabel('Name').fill('Test Activation Broken');
  await sheet.getByLabel(/^Id/).fill('test-activation-broken');
  await sheet.getByRole('button', { name: '+ add activation' }).click();
  const actEditor = sheet.locator('.border-amber-900\\/60');
  await actEditor.getByRole('button', { name: '+ add script' }).click();
  // Run it on `use` (the activation's own "Use" button), not the compute pass's `always`.
  await actEditor.locator('[data-role="script-event"]').selectOption({ label: 'When used' });
  await actEditor.locator('[data-role="script-source"] .cm-content').click();
  await page.keyboard.type('player.mod.cha += 1');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // put it on the sheet, then actually use it in a battle so the real (non-probe) run fails
  await page.locator('[data-record="test-activation-broken"]').getByRole('button', { name: 'add' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Battle' }).click();
  await page.getByRole('button', { name: /New battle/ }).click();
  await page.locator('[data-activation="test-activation-broken"]').getByRole('button', { name: 'Use' }).click();

  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('[data-error="test-activation-broken"]')).toBeVisible();
  // reopen the record: the activation's own scripts editor must show the error row too, not just the dot
  await page.locator('[data-record="test-activation-broken"]').getByRole('button').first().click();
  await expect(sheet.locator('.border-amber-900\\/60').getByText(/read-only/).first()).toBeVisible();
});
