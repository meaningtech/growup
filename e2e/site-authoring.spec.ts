import { expect, test } from '@playwright/test';
import { createLocalProjection, pointInPolygon, polygonCentroid } from '../src/lib/geometry';
import { distanceToSiteBoundaryM, distanceToSitePathM, importSiteGeoJson, siteContainsCoordinate } from '../src/lib/siteGeometry';
import type { LayoutVariant, SiteProfile } from '../src/types';

test('imports and validates complete site infrastructure before generating on the Ragusa field', async ({ page }) => {
  const geojson = ragusaInfrastructureGeoJson();
  const expectedSite = importSiteGeoJson(geojson);
  const multiSite = importSiteGeoJson({
    type: 'MultiPolygon',
    coordinates: [
      [(geojson.features[0].geometry as { coordinates: number[][][] }).coordinates[0]],
      [[
        [14.75410, 36.92140], [14.75435, 36.92140], [14.75435, 36.92120], [14.75410, 36.92120], [14.75410, 36.92140],
      ]],
    ],
  });
  const multiValidationResponse = await page.request.post('/api/site/validate', { data: multiSite });
  expect(multiValidationResponse.ok()).toBeTruthy();
  const multiValidation = await multiValidationResponse.json();
  expect(multiValidation).toEqual(expect.objectContaining({ valid: true, geometryType: 'MultiPolygon', counts: expect.objectContaining({ polygons: 2 }) }));

  await page.goto('/');
  await expect(page.locator('.gm-style')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Import site GeoJSON').setInputFiles({
    name: 'ragusa-complete-site.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify(geojson)),
  });
  await expect(page.getByText(/Polygon imported:/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Authoritative geometry valid')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 planting region')).toBeVisible();
  await expect(page.getByText('Management path 1')).toBeVisible();
  await expect(page.getByText('Observed tree 1')).toBeVisible();

  await page.getByRole('button', { name: 'Remove hole 1' }).click();
  await expect(page.getByRole('button', { name: 'Remove hole 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo site' }).click();
  await expect(page.getByRole('button', { name: 'Remove hole 1' })).toBeVisible();

  const keyboardExclusion = [
    { lat: 36.92088, lng: 14.75312 },
    { lat: 36.92088, lng: 14.75318 },
    { lat: 36.92084, lng: 14.75316 },
  ];
  await page.getByRole('button', { name: /Exclusion/ }).click();
  for (const coordinate of keyboardExclusion) {
    await page.getByLabel('Coordinate latitude').fill(String(coordinate.lat));
    await page.getByLabel('Coordinate longitude').fill(String(coordinate.lng));
    await page.getByRole('button', { name: 'Add coordinate' }).click();
  }
  await page.getByRole('button', { name: 'Finish geometry' }).click();
  await expect(page.getByRole('button', { name: 'Remove exclusion 2' })).toBeVisible();
  expectedSite.exclusions.push(keyboardExclusion);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-site-authoring.png', fullPage: false });

  const profilePromise = page.waitForResponse((response) => response.url().endsWith('/api/site/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  const profileResponse = await profilePromise;
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as SiteProfile;
  expect(profile.areaM2).toBeGreaterThan(2_700);

  await page.getByTestId('step-species').click();
  const layoutPromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const layoutResponse = await layoutPromise;
  expect(layoutResponse.ok()).toBeTruthy();
  const { variants } = await layoutResponse.json() as { variants: LayoutVariant[] };
  expect(variants).toHaveLength(3);

  const projection = createLocalProjection(polygonCentroid(expectedSite.polygon));
  const exclusions = expectedSite.exclusions.map((polygon) => polygon.map(projection.project));
  for (const variant of variants) {
    expect(variant.warnings.some((warning) => warning.includes('management path'))).toBe(true);
    expect(variant.warnings.some((warning) => warning.includes('field-observed existing'))).toBe(true);
    for (const tree of variant.trees) {
      expect(siteContainsCoordinate(expectedSite, tree.coordinate)).toBe(true);
      expect(distanceToSiteBoundaryM(expectedSite, tree.coordinate)).toBeGreaterThanOrEqual(expectedSite.setbackM - 0.05);
      expect(expectedSite.paths.every((path) => distanceToSitePathM(tree.coordinate, path) >= path.widthM / 2 - 0.05)).toBe(true);
      expect(exclusions.some((polygon) => pointInPolygon(projection.project(tree.coordinate), polygon))).toBe(false);
      expect(expectedSite.existingTrees.every((existing) => {
        const local = createLocalProjection(existing.coordinate).project(tree.coordinate);
        return Math.hypot(local.x, local.y) >= existing.crownDiameterM / 2 + existing.protectionBufferM - 0.05;
      })).toBe(true);
    }
  }
});

function ragusaInfrastructureGeoJson() {
  const ring = (points: number[][]) => [...points, points[0]];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'site', id: 'ragusa-infrastructure-e2e', name: 'Ragusa infrastructure validation', setbackM: 1.5 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            ring([[14.75300, 36.92130], [14.75365, 36.92105], [14.75368, 36.92085], [14.75320, 36.92073], [14.75292, 36.92085]]),
            ring([[14.75317, 36.92096], [14.75323, 36.92096], [14.75323, 36.92091], [14.75317, 36.92091]]),
          ],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'manual_exclusion', id: 'habitat-pocket' },
        geometry: { type: 'Polygon', coordinates: [ring([[14.75346, 36.92099], [14.75351, 36.92097], [14.75349, 36.92092], [14.75343, 36.92094]])] },
      },
      {
        type: 'Feature',
        properties: { kind: 'management_path', id: 'main-path', name: 'Management path 1', widthM: 3 },
        geometry: { type: 'LineString', coordinates: [[14.75304, 36.92086], [14.75355, 36.92103]] },
      },
      {
        type: 'Feature',
        properties: { kind: 'access_point', id: 'south-gate', name: 'South gate' },
        geometry: { type: 'Point', coordinates: [14.75306, 36.92086] },
      },
      {
        type: 'Feature',
        properties: { kind: 'water_point', id: 'tank', name: 'Header tank' },
        geometry: { type: 'Point', coordinates: [14.75355, 36.92100] },
      },
      {
        type: 'Feature',
        properties: { kind: 'existing_tree', id: 'observed-tree', name: 'Observed tree 1', speciesName: 'Olea europaea', crownDiameterM: 4, protectionBufferM: 2.5 },
        geometry: { type: 'Point', coordinates: [14.75331, 36.92095] },
      },
    ],
  };
}
