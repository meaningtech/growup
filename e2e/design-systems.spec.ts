import { expect, test } from '@playwright/test';
import { distanceToSiteBoundaryM } from '../src/lib/siteGeometry';
import type { LayoutVariant, SiteProfile } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('keeps the crop interior empty in perimeter mode and exposes measured solar evidence', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);

  const profilePromise = page.waitForResponse((response) => response.url().endsWith('/api/site/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  const profileResponse = await profilePromise;
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as SiteProfile;
  expect(profile.solar.status).toBe('available');
  expect(profile.solar.hourlyClimatology).toHaveLength(288);
  expect(profile.solar.annualGlobalHorizontalKwhM2).toBeGreaterThan(1_000);

  await page.getByTestId('step-species').click();
  await page.getByRole('radio', { name: 'Boundary buffer / productive hedge' }).click();
  await expect(page.getByRole('button', { name: 'Perimeter only' })).toHaveClass(/active/);
  await page.getByRole('slider', { name: 'Boundary band' }).fill('7');
  await page.getByLabel('Orientation objective').selectOption('solar-crop');

  const layoutPromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const layoutResponse = await layoutPromise;
  expect(layoutResponse.ok()).toBeTruthy();
  const { variants } = await layoutResponse.json() as { variants: LayoutVariant[] };
  expect(variants).toHaveLength(3);

  for (const variant of variants) {
    expect(variant.design.system).toBe('boundary-buffer');
    expect(variant.design.extent).toBe('perimeter-band');
    expect(variant.metrics.cropInteriorAreaM2).toBeGreaterThan(500);
    expect(variant.solar.status).toBe('available');
    expect(variant.solar.terrainPlaneKwhM2Year).toBeGreaterThan(1_000);
    expect(variant.trees.length).toBeGreaterThan(20);
    expect(variant.trees.every((tree) => {
      const distance = distanceToSiteBoundaryM(TEMPERATE_OPEN_FIELD_FIXTURE, tree.coordinate);
      return distance >= TEMPERATE_OPEN_FIELD_FIXTURE.setbackM - 0.05 && distance <= 7.05;
    })).toBe(true);
  }

  await expect(page.getByText(/crop solar access/).first()).toBeVisible();
  await expect(page.getByText(/kept free of new trees/).first()).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-perimeter-solar.png', fullPage: false });

  await page.getByTestId('step-species').click();
  await page.getByRole('radio', { name: 'Monoculture orchard' }).click();
  const monoculturePromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const monocultureResponse = await monoculturePromise;
  const monoculture = await monocultureResponse.json() as { variants: LayoutVariant[] };
  expect(new Set(monoculture.variants[0].trees.map((tree) => tree.speciesId)).size).toBe(1);
});
