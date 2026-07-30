import { expect, test } from '@playwright/test';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { generateLayoutVariants } from '../src/lib/layout';
import { rankSpecies, recommendedPalette } from '../src/lib/recommendations';
import { distanceToSiteBoundaryM } from '../src/lib/siteGeometry';
import type { DesignConfiguration, LayoutVariant, SiteBoundary } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { importSiteFixture } from './support/siteFixture';

test('configures, maps and enforces a perimeter firebreak', async ({ page }) => {
  const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.route('**/api/config', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      googleMapsApiKey: '',
      initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
      climatePeriod: '2021–2025',
      modelVersion: 'test',
      assistant: { configured: false, interface: 'openai-compatible' },
      auth: { configured: false, googleClientId: '' },
    },
  }));
  await page.route('**/api/catalog/stats', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: { total: DESIGN_SPECIES.length, treeLike: DESIGN_SPECIES.length, globUnt: 0, designReady: DESIGN_SPECIES.length },
  }));
  await page.route('**/api/auth/session', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: { authenticated: false, configured: false, user: null },
  }));
  await page.route('**/api/site/validate', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      valid: true,
      reason: 'Valid site geometry',
      areaM2: profile.areaM2,
      perimeterM: profile.perimeterM,
      plantableAreaM2: profile.areaM2,
      geometryType: 'Polygon',
      counts: { polygons: 1, holes: 0, exclusions: 0, paths: 0, accessPoints: 0, waterPoints: 0, existingTrees: 0 },
    },
  }));
  await page.route('**/api/site/profile', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: profile,
  }));
  await page.route('**/api/recommendations', async (route) => {
    const objectives = (route.request().postDataJSON() as { objectives: DesignConfiguration['objectives'] }).objectives;
    const recommendations = rankSpecies(DESIGN_SPECIES, profile, objectives);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { recommendations, palette: recommendedPalette(recommendations).map((item) => item.species) },
    });
  });
  await page.route('**/api/economics/profile', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: defaultEconomicConfiguration(profile.location.countryCode ?? ''),
  }));
  await page.route('**/api/layout/generate', async (route) => {
    const input = route.request().postDataJSON() as {
      site: SiteBoundary;
      selectedSpeciesIds: string[];
      designConfiguration: DesignConfiguration;
    };
    const species = DESIGN_SPECIES.filter((item) => input.selectedSpeciesIds.includes(item.id));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { variants: generateLayoutVariants(input.site, profile, species, input.designConfiguration) },
    });
  });

  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);

  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  const profilePromise = page.waitForResponse((response) => response.url().endsWith('/api/site/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  expect((await profilePromise).ok()).toBeTruthy();
  await expect(page.getByTestId('evidence-tabs').getByRole('tab')).toHaveCount(6);
  await expect(page.getByTestId('wind-map-legend')).toContainText('From NW');
  await page.getByRole('tab', { name: /Wind/ }).click();
  const windClimatology = page.getByTestId('wind-climatology');
  await expect(windClimatology).toContainText('Wind climatology');
  await expect(windClimatology).toContainText('Hourly speed · P90');
  await expect(windClimatology).toContainText('Applied to the plan');
  await expect(page.getByTestId('wind-rose')).toBeVisible();
  await windClimatology.getByRole('button', { name: 'Summer' }).click();
  await expect(windClimatology.getByRole('button', { name: 'Summer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(windClimatology).toContainText('3.2');
  await windClimatology.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-wind-climatology.png', fullPage: false });

  await page.getByRole('tab', { name: /Soil/ }).click();
  const soilComposition = page.getByTestId('soil-composition');
  await expect(soilComposition).toContainText('Total nitrogen');
  await expect(soilComposition).toContainText('Cation exchange capacity');
  await expect(soilComposition).toContainText('90% prediction interval');
  await expect(soilComposition).toContainText('global model prediction, not a parcel sample');
  await expect(soilComposition.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', /soilgrids/);
  await soilComposition.scrollIntoViewIfNeeded();
  await page.getByRole('tab', { name: /Subsurface/ }).click();
  const subsurface = page.getByTestId('subsurface-evidence');
  await expect(subsurface).toContainText('Modelled depth to bedrock');
  await expect(subsurface).toContainText('1.85 m');
  await expect(subsurface).toContainText('Regional groundwater context');
  await expect(subsurface).toContainText('complex hydrogeological structure');
  await expect(subsurface).toContainText('100–200 cm');
  await expect(subsurface).toContainText('Publication / release');
  await expect(subsurface).toContainText('Retrieved');
  await subsurface.getByRole('button', { name: 'Show depth cells' }).click();
  await expect(page.getByTestId('map-layer-panel').getByRole('button', { name: 'Show or hide modelled depth-to-bedrock cells' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close map layers' }).click();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-soil-composition.png', fullPage: false });

  await page.getByTestId('step-species').click();
  await page.getByTestId('planning-tab-firebreak').click();
  const firebreakConfiguration = page.getByTestId('firebreak-config');
  await expect(firebreakConfiguration).toBeVisible();
  await page.getByLabel('Reserve firebreak').check();
  await page.getByLabel('Adjacent fuel model').selectOption('shrub-edge');
  await expect(page.getByLabel('Expected flame length')).toHaveValue('3');
  await expect(page.getByLabel('Planned width')).toHaveValue('7.5');
  await expect(firebreakConfiguration).toContainText('Basis met');

  await page.getByLabel('Planned width').fill('7');
  await expect(firebreakConfiguration).toContainText('Increase width');
  await page.getByLabel('Planned width').fill('7.5');
  await expect(firebreakConfiguration).toContainText('Basis met');
  await firebreakConfiguration.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-firebreak-configuration.png', fullPage: false });

  const layoutPromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const layoutResponse = await layoutPromise;
  expect(layoutResponse.ok()).toBeTruthy();
  const { variants } = await layoutResponse.json() as { variants: LayoutVariant[] };

  for (const variant of variants) {
    expect(variant.firebreak.enabled).toBe(true);
    expect(variant.firebreak.fuelModel).toBe('shrub-edge');
    expect(variant.firebreak.plannedWidthM).toBe(7.5);
    expect(variant.firebreak.minimumPlanningWidthM).toBe(7.5);
    expect(variant.firebreak.planningWidthSatisfied).toBe(true);
    expect(variant.firebreak.localReviewRequired).toBe(true);
    expect(variant.firebreak.lines).toHaveLength(TEMPERATE_OPEN_FIELD_FIXTURE.polygon.length);
    expect(variant.firebreak.lines.some((line) => line.priority === 'windward')).toBe(true);
    expect(variant.trees.every((tree) => (
      distanceToSiteBoundaryM(TEMPERATE_OPEN_FIELD_FIXTURE, tree.coordinate) >= 7.45
    ))).toBe(true);
  }

  const firebreakPlan = page.getByTestId('firebreak-plan');
  await expect(firebreakPlan).toBeVisible();
  await expect(firebreakPlan).toContainText('7.5 m');
  await expect(firebreakPlan).toContainText('local fire authority');
  await firebreakPlan.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-firebreak-plan.png', fullPage: false });

  await page.getByRole('button', { name: 'Map layers' }).click();
  const firebreakLayer = page.getByTestId('map-layer-panel').getByRole('button', { name: 'Show or hide the perimeter firebreak' });
  await expect(firebreakLayer).toHaveAttribute('aria-pressed', 'true');
  await firebreakLayer.click();
  await expect(firebreakLayer).toHaveAttribute('aria-pressed', 'false');
  await firebreakLayer.click();
  await expect(firebreakLayer).toHaveAttribute('aria-pressed', 'true');
  const windLayer = page.getByTestId('map-layer-panel').getByRole('button', { name: 'Show or hide the historical wind vector' });
  await expect(windLayer).toHaveAttribute('aria-pressed', 'true');
  await windLayer.click();
  await expect(page.getByTestId('wind-map-legend')).toHaveCount(0);
  await windLayer.click();
  await expect(page.getByTestId('wind-map-legend')).toBeVisible();

  await page.screenshot({ path: '/private/tmp/growup-checkpoint-firebreak.png', fullPage: false });
  await page.getByRole('button', { name: 'Close map layers' }).click();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-wind-map.png', fullPage: false });

  await page.getByTestId('step-profile').click();
  await page.getByRole('tab', { name: /Sources/ }).click();
  const traceability = page.getByTestId('evidence-traceability');
  await expect(traceability).toContainText('Natural England and Defra');
  await expect(traceability).toContainText('Data read');
  await expect(traceability).toContainText('Growup calculation');
  await expect(traceability).toContainText('Decision affected');
  await expect(traceability.getByRole('link', { name: 'Open source' }).first()).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-evidence-tabs.png', fullPage: false });

  const toast = page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Close' }) });
  if (await toast.isVisible()) await toast.getByRole('button', { name: 'Close' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: /Subsurface/ }).click();
  await expect(page.getByTestId('subsurface-evidence')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const mobileSubsurfaceBox = await page.getByTestId('subsurface-evidence').boundingBox();
  expect(mobileSubsurfaceBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((mobileSubsurfaceBox?.x ?? 0) + (mobileSubsurfaceBox?.width ?? 500)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-subsurface-mobile.png', fullPage: false });
});
