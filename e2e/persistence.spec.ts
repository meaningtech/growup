import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

async function mockSiteValidate(page: import('@playwright/test').Page) {
  await page.route('**/api/site/validate', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      valid: true,
      reason: 'Valid site geometry',
      areaM2: 2_400,
      perimeterM: 210,
      plantableAreaM2: 2_200,
      geometryType: 'Polygon',
      counts: { polygons: 1, holes: 0, exclusions: 0, paths: 0, accessPoints: 0, waterPoints: 0, existingTrees: 0 },
    },
  }));
}

test('reopens the last field and workspace step after a refresh', async ({ page }) => {
  await mockSiteValidate(page);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem('growup:draft:v2')))).toBe(true);
  await page.getByTestId('step-species').click();
  await expect(page.getByTestId('step-species')).toHaveClass(/active/);

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved local project found' })).toHaveCount(0);
  await expect(page.getByText('No active field')).toHaveCount(0);
  await expect(page.getByTestId('step-species')).toHaveClass(/active/);
  await page.getByTestId('step-site').click();
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('save-status')).toContainText('saved in this browser');
});

test('starts empty after the local session is cleared', async ({ page }) => {
  await mockSiteValidate(page);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect.poll(() => page.evaluate(() => Boolean(window.localStorage.getItem('growup:draft:v2')))).toBe(true);
  await page.getByRole('button', { name: 'Clear field' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear field' }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('growup:draft:v2'))).toBeNull();

  await page.reload();
  await expect(page.getByText('No active field')).toBeVisible();
  await expect(page.getByText(TEMPERATE_OPEN_FIELD_FIXTURE.name)).toHaveCount(0);
});
