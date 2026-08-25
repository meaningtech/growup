import { expect, test } from '@playwright/test';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { generateLayoutVariants } from '../src/lib/layout';
import { rankSpecies, recommendedPalette } from '../src/lib/recommendations';
import type { DesignConfiguration, LayoutVariant, SiteBoundary } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { importSiteFixture } from './support/siteFixture';

test('reserves editable machinery corridors and turning headlands in the generated layout', async ({ page }) => {
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
    const body = route.request().postDataJSON() as { objectives: DesignConfiguration['objectives']; system?: DesignConfiguration['system'] };
    const recommendations = rankSpecies(DESIGN_SPECIES, profile, body.objectives);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { recommendations, palette: recommendedPalette(recommendations, body.system ?? 'syntropic').map((item) => item.species) },
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
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByRole('tab', { name: /Satellite/ }).click();
  await expect(page.getByTestId('existing-vegetation-audit')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-species').click();
  await page.getByTestId('planning-tab-machinery').click();

  const machinery = page.getByTestId('machinery-config');
  await expect(machinery).toBeVisible();
  await expect(page.getByLabel('Reserve space')).not.toBeChecked();
  await expect(page.getByLabel('Reference machine')).toBeDisabled();
  await page.getByLabel('Reserve space').check();
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
  expect(variants[0].machinery.perimeterLoops).toEqual([
    expect.objectContaining({
      closed: true,
      clearanceSatisfied: true,
      lengthM: expect.any(Number),
    }),
  ]);
  expect(variants[0].machinery.manoeuvreRoutes).toEqual([
    expect.objectContaining({
      closed: false,
      clearanceSatisfied: true,
      connectedCorridorIds: variants[0].machinery.corridors.map((corridor) => corridor.id),
    }),
  ]);
  await expect(page.getByTestId('machinery-plan')).toContainText('Machinery clearances reserved');
  await expect(page.getByTestId('machinery-plan')).toContainText('Drivable perimeter');
  await expect(page.getByTestId('machinery-plan')).toContainText('Manoeuvre route');
  await page.getByTestId('machinery-plan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-machinery.png', fullPage: false });
});
