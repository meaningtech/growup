import { expect, test } from '@playwright/test';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { calculateEstablishmentCost } from '../src/lib/costs';
import { calculateIrrigation } from '../src/lib/irrigation';
import { generateLayoutVariants } from '../src/lib/layout';
import { rankSpecies, recommendedPalette } from '../src/lib/recommendations';
import type {
  DesignConfiguration,
  EconomicConfiguration,
  IrrigationConfiguration,
  LayoutVariant,
  SiteBoundary,
} from '../src/types';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('isolates supply pipes and drip laterals before irrigation geometry editing', async ({ page }) => {
  const site = TEMPERATE_OPEN_FIELD_FIXTURE;
  const profile = openFieldProfile(site);
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
  await page.route('**/api/costs/calculate', async (route) => {
    const input = route.request().postDataJSON() as {
      variant: LayoutVariant;
      site: SiteBoundary;
      selectedSpeciesIds: string[];
      designYear: number;
      irrigationConfiguration: IrrigationConfiguration;
      economicConfiguration: EconomicConfiguration;
    };
    const species = DESIGN_SPECIES.filter((item) => input.selectedSpeciesIds.includes(item.id));
    const irrigation = calculateIrrigation(
      input.variant,
      species,
      input.site,
      profile,
      input.designYear,
      input.irrigationConfiguration,
      input.economicConfiguration,
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        irrigation,
        establishment: calculateEstablishmentCost(input.variant, species, irrigation, irrigation.economics),
      },
    });
  });

  await page.goto('/');
  await importSiteFixture(page, site);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await page.getByRole('button', { name: 'Size water + calculate costs' }).click();

  const controls = page.getByTestId('irrigation-layer-controls');
  const supplyPipes = controls.getByRole('button', { name: /Supply pipes/ });
  const dripLaterals = controls.getByRole('button', { name: /Drip laterals/ });
  const editPipes = page.getByRole('button', { name: 'Edit pipes' });
  await expect(supplyPipes).toHaveAttribute('aria-pressed', 'true');
  await expect(dripLaterals).toHaveAttribute('aria-pressed', 'true');

  await dripLaterals.click();
  await expect(dripLaterals).toHaveAttribute('aria-pressed', 'false');
  await editPipes.click();
  await expect(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
  await expect(dripLaterals).toHaveAttribute('aria-pressed', 'false');

  await supplyPipes.click();
  await expect(supplyPipes).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Edit pipes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish editing' })).toHaveCount(0);

  await dripLaterals.click();
  await expect(dripLaterals).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Edit pipes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit pipes' }).click();
  await dripLaterals.click();
  await expect(page.getByRole('button', { name: 'Edit pipes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish editing' })).toHaveCount(0);
});
