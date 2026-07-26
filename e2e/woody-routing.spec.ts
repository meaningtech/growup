import { expect, test } from '@playwright/test';
import type { Coordinate, IrrigationEstimate, SiteProfile } from '../src/types';
import { WOODY_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('renders canopy-scale woody ellipses and rejects or routes around them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Italiano' }).click();
  await importSiteFixture(page, WOODY_FIELD_FIXTURE);
  const profilePromise = page.waitForResponse((response) => response.url().endsWith('/api/site/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Analizza questo terreno' }).click();
  const profileResponse = await profilePromise;
  const profile = await profileResponse.json() as SiteProfile;
  expect(profile.satellite.existingVegetation.patches.length).toBeGreaterThanOrEqual(2);
  expect(profile.satellite.existingVegetation.patches.every((patch) => patch.polygon.length === 24)).toBe(true);
  await expect(page.getByText('Evidenze multi-sorgente', { exact: false })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-elliptical-canopies.png', fullPage: false });

  if (profile.satellite.existingVegetation.suitability === 'reject') return;
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: 'Genera tre progetti valutati' }).click();
  await expect(page.getByText('3 disposizioni riproducibili generate.')).toBeVisible({ timeout: 30_000 });
  const irrigationPromise = page.waitForResponse((response) => response.url().endsWith('/api/costs/calculate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Dimensiona irrigazione e costi' }).click();
  const irrigation = (await irrigationPromise).json() as Promise<{ irrigation: IrrigationEstimate }>;
  const result = await irrigation;
  for (const line of result.irrigation.network.lines.filter((line) => line.kind !== 'protected-crossing')) {
    for (let index = 1; index < line.points.length; index += 1) {
      for (const patch of profile.satellite.existingVegetation.patches) {
        expect(segmentCrossesPolygon(line.points[index - 1], line.points[index], patch.polygon)).toBe(false);
      }
    }
  }
  await expect(page.getByTestId('hydraulic-plan')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-obstacle-routing.png', fullPage: false });
});

function segmentCrossesPolygon(start: Coordinate, end: Coordinate, polygon: Coordinate[]) {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon) || pointInPolygon({ lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 }, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentsIntersect(start, end, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return false;
}

function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate) {
  const cross = (p: Coordinate, q: Coordinate, r: Coordinate) => (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < -1e-18 && cdA * cdB < -1e-18;
}

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const prior = polygon[previous];
    if ((current.lat > point.lat) !== (prior.lat > point.lat) && point.lng < (prior.lng - current.lng) * (point.lat - current.lat) / (prior.lat - current.lat) + current.lng) inside = !inside;
  }
  return inside;
}
