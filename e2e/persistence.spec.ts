import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('offers explicit local recovery without silently preloading a field', async ({ page }) => {
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem('growup:draft:v2')))).toBe(true);

  await page.reload();
  await expect(page.getByText('No active field')).toBeVisible();
  const recovery = page.getByRole('status').filter({ hasText: 'Unsaved local project found' });
  await expect(recovery).toBeVisible();
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toHaveCount(0);

  await recovery.getByRole('button', { name: 'Recover' }).click();
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('save-status')).toContainText('saved in this browser');
});

test('can discard a browser recovery draft permanently', async ({ page }) => {
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem('growup:draft:v2')))).toBe(true);
  await page.reload();

  const recovery = page.getByRole('status').filter({ hasText: 'Unsaved local project found' });
  await recovery.getByRole('button', { name: 'Discard' }).click();
  await expect(recovery).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('growup:draft:v2'))).toBeNull();
});
