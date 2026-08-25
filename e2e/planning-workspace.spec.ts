import { expect, test, type Page } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { mockPlanningApi } from './support/mockPlanningApi';
import { importSiteFixture } from './support/siteFixture';

const FIELD_RING = [
  { lat: 36.92130, lng: 14.75300 },
  { lat: 36.92105, lng: 14.75365 },
  { lat: 36.92073, lng: 14.75320 },
];
const LAKE_RING = [
  { lat: 36.92108, lng: 14.75322 },
  { lat: 36.92108, lng: 14.75334 },
  { lat: 36.92096, lng: 14.75328 },
];

async function mockSiteValidate(page: Page) {
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

async function enterCoordinates(page: Page, points: Array<{ lat: number; lng: number }>) {
  for (const coordinate of points) {
    await page.getByLabel('Coordinate latitude').fill(String(coordinate.lat));
    await page.getByLabel('Coordinate longitude').fill(String(coordinate.lng));
    await page.getByRole('button', { name: 'Add coordinate' }).click();
  }
}

test('idles field-drawing tools when leaving the Site step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Draw a new field' }).click();
  await expect(page.locator('.drawing-status')).toBeVisible();
  await expect(page.locator('.drawing-status')).toContainText('Drawing field boundary');

  await page.getByTestId('step-species').click();
  await expect(page.locator('.drawing-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw a new field' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.drawing-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw a new field' })).toHaveCount(0);

  await page.getByTestId('step-site').click();
  await expect(page.getByRole('button', { name: 'Draw a new field' })).toBeVisible();
  await expect(page.locator('.drawing-status')).toHaveCount(0);
});

test('inspects a usable species by default and keeps blocked taxa as an exclusion note', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-palette').click();

  await expect(page.getByTestId('species-safety-gate')).toContainText('blocked');
  await expect(page.locator('.drawing-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw a new field' })).toHaveCount(0);
  await expect(page.getByTestId('species-inspector')).toHaveCount(0);
  await page.locator('.species-match-toggle').first().click();
  await expect(page.getByTestId('species-inspector')).not.toHaveClass(/blocked/);
  await expect(page.getByTestId('species-inspector')).toContainText('Linked evidence');
  await expect(page.getByTestId('species-inspector')).toContainText('Evidence readiness');

  await page.getByTestId('species-safety-gate').getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByTestId('species-inspector')).toHaveClass(/blocked/);
  await expect(page.getByTestId('species-inspector')).toContainText('Excluded from generated layouts');
  await expect(page.getByTestId('species-inspector')).not.toContainText('Checks before use');
  await expect(page.getByTestId('species-inspector')).not.toContainText('Evidence readiness');

  await page.getByTestId('species-inspector').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('species-inspector')).toHaveCount(0);
});

test('cuts a hole after the outer field perimeter is already finished', async ({ page }) => {
  await mockSiteValidate(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await enterCoordinates(page, FIELD_RING);
  await page.getByRole('button', { name: 'Finish geometry' }).click();
  await expect(page.getByText('Authoritative user-defined boundary')).toBeVisible();

  await page.locator('.site-tool-grid').getByRole('button', { name: /^Hole/ }).click();
  await expect(page.locator('.drawing-status')).toContainText('Drawing site hole');
  await enterCoordinates(page, [
    { lat: 36.925, lng: 14.76 },
    { lat: 36.926, lng: 14.761 },
    { lat: 36.925, lng: 14.762 },
  ]);
  await page.getByRole('button', { name: 'Finish geometry' }).click();
  await expect(page.getByText('Every hole must be a valid polygon contained by the field.')).toBeVisible();
  await expect(page.locator('.drawing-status')).toContainText('Drawing site hole');
  await expect(page.getByText('Site hole', { exact: true })).toHaveCount(0);

  await page.locator('.site-tool-grid').getByRole('button', { name: /^Hole/ }).click();
  await enterCoordinates(page, LAKE_RING);
  await page.getByRole('button', { name: 'Finish geometry' }).click();
  await expect(page.getByText('Site hole', { exact: true })).toBeVisible();
  await expect(page.locator('.drawing-status')).toHaveCount(0);
});

test('keeps harvest products on one row and does not resize irrigation when the year changes', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  let costCalls = 0;
  await page.route('**/api/costs/calculate', async (route) => {
    costCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { irrigation: { designYear: 5, annualWaterM3: 1 }, establishment: { totalCost: 1 } },
    });
  });
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await expect(page.getByTestId('layout-composition')).toBeVisible();
  await page.getByTestId('step-harvest').click();
  await page.getByRole('tab', { name: 'Species' }).click();
  const facts = page.locator('.harvest-facts').first();
  await expect(facts).toBeVisible();
  expect(await facts.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length)).toBe(4);
  await page.getByRole('tab', { name: 'Sources' }).click();
  await expect(page.getByTestId('harvest-sources').locator('.fire-evidence-card').first()).toBeVisible();
  await expect(page.getByTestId('harvest-sources').locator('.fire-evidence-card').first()).toContainText('Open source');
  await page.getByTestId('step-care').click();
  await page.getByRole('tab', { name: 'Sources' }).click();
  const careSource = page.getByTestId('care-sources').locator('.fire-evidence-card').first();
  await expect(careSource).toBeVisible();
  await expect(careSource).toContainText('Open source');
  await expect(careSource.locator('a')).toHaveCSS('color', 'rgb(125, 71, 42)');
  await page.getByTestId('step-harvest').click();
  const before = costCalls;
  await page.locator('.harvest-year input').fill('18');
  await page.getByTestId('succession-timeline').locator('input[type="range"]').fill('12');
  await page.waitForTimeout(500);
  expect(costCalls).toBe(before);
});

test('adds a catalogue species and stores an editable planting row', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-palette').click();

  await page.locator('.species-row:not(.selected) .species-toggle').first().click();
  await page.getByTestId('species-tab-mix').click();
  await expect(page.getByTestId('species-mix-config').getByLabel(/Planting distance/)).not.toHaveCount(0);

  await page.getByRole('button', { name: 'Draw a planting row' }).click();
  await expect(page.locator('.drawing-status')).toContainText('Drawing planting row');
  await expect(page.getByRole('button', { name: 'Finish geometry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit planting rows' })).toBeVisible();
});
