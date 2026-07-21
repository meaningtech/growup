import { expect, test } from '@playwright/test';
import type { LayoutVariant } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('reserves editable machinery corridors and turning headlands in the generated layout', async ({ page }) => {
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByTestId('existing-vegetation-audit')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-species').click();

  const machinery = page.getByTestId('machinery-config');
  await expect(machinery).toBeVisible();
  await page.getByLabel('Reference machine').selectOption('new-holland-t4f');
  await page.getByLabel('Machine width').fill('2.40');
  await page.getByLabel('Turning radius').fill('4.00');
  await expect(machinery).toContainText('3.70 m');
  await expect(machinery).toContainText('8.65 m');

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const { variants } = await response.json() as { variants: LayoutVariant[] };
  expect(variants[0].machinery).toEqual(expect.objectContaining({
    enabled: true,
    presetId: 'new-holland-t4f',
    requiredCorridorWidthM: 3.7,
    headlandDepthM: 8.65,
    clearanceSatisfied: true,
  }));
  expect(variants[0].machinery.corridors.length).toBeGreaterThan(0);
  expect(variants[0].machinery.turningAreas.length).toBeGreaterThan(0);
  await expect(page.getByTestId('machinery-plan')).toContainText('Machinery clearances reserved');
  await page.getByTestId('machinery-plan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-machinery.png', fullPage: false });
});
