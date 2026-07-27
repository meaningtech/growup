import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';
import { mockGoogleMaps } from './support/mockGoogleMaps';
import { mockPlanningApi } from './support/mockPlanningApi';

test('analyses hourly plant exposure and renders reversible crown shadows on the map', async ({ page }) => {
  await mockGoogleMaps(page);
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();

  const analysis = page.getByTestId('daily-solar-exposure');
  await expect(analysis).toBeVisible();
  await expect(analysis).toContainText('Exposure through the day');
  await expect(analysis).toContainText('Open-Meteo');
  await expect(analysis).toContainText('2021–2025');
  await expect(page.getByTestId('solar-day-timeline').getByRole('listitem')).toHaveCount(16);
  await expect(analysis).toContainText('Sun elevation');
  await expect(analysis).toContainText('Direct sun');

  const hour = page.getByTestId('solar-hour');
  await hour.fill('5');
  await expect(analysis).toContainText('0 W/m²');
  await page.getByTestId('solar-map-toggle').check();
  await expect(page.getByTestId('solar-map-legend')).toContainText('sun below the horizon');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapPolygons.filter((overlay: any) => overlay.active && overlay.options.growupLayer === 'solar-shadow').length
  ))).toBe(0);

  await hour.fill('12');
  await expect(page.getByTestId('solar-map-legend')).toContainText('12:00 solar time');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapPolygons.filter((overlay: any) => overlay.active && overlay.options.growupLayer === 'solar-shadow').length
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapCircles.filter((overlay: any) => overlay.active && overlay.options.growupLayer === 'solar-plant-status').length
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapPolylines.filter((overlay: any) => overlay.active && overlay.options.growupLayer === 'solar-direction').length
  ))).toBe(1);

  await page.getByTestId('solar-map-toggle').uncheck();
  await expect(page.getByTestId('solar-map-legend')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapPolygons.filter((overlay: any) => overlay.active && overlay.options.growupLayer === 'solar-shadow').length
  ))).toBe(0);
});

test('keeps the daily exposure controls inside the mobile inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGoogleMaps(page);
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();

  const analysis = page.getByTestId('daily-solar-exposure');
  await analysis.scrollIntoViewIfNeeded();
  await expect(analysis).toBeVisible();
  const geometry = await analysis.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
});
