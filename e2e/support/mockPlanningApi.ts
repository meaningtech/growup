import type { Page } from '@playwright/test';
import { defaultEconomicConfiguration } from '../../src/data/economicProfiles';
import { DESIGN_SPECIES } from '../../src/data/designSpecies';
import { calculateEstablishmentCost } from '../../src/lib/costs';
import { calculateIrrigation } from '../../src/lib/irrigation';
import { generateLayoutVariants } from '../../src/lib/layout';
import { rankSpecies, recommendedPalette } from '../../src/lib/recommendations';
import { normalizeUserSpecies } from '../../src/lib/userCatalogue';
import type {
  CatalogueSpecies,
  DesignConfiguration,
  DesignSpecies,
  EconomicConfiguration,
  IrrigationConfiguration,
  LayoutVariant,
  SiteBoundary,
} from '../../src/types';
import { openFieldProfile } from '../../test/fixtures/siteProfile';

export async function mockPlanningApi(page: Page, site: SiteBoundary) {
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
  await page.route('**/api/catalog/search**', async (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('en');
    const cacao: CatalogueSpecies = {
      id: 'switchboard-theobroma-cacao',
      scientificName: 'Theobroma cacao',
      sourceCount: 4,
      treeLike: true,
      wfoId: null,
      wcvpId: null,
      globUnt: false,
      designReady: false,
      stratum: 'medium',
      succession: 'secondary',
      roles: ['food'],
      evergreen: false,
      nitrogenFixer: false,
      droughtTolerance: null,
      evidenceCount: 1,
    };
    const curated = DESIGN_SPECIES.filter((species) => (
      species.scientificName.toLocaleLowerCase('en').includes(query)
      || species.commonName.toLocaleLowerCase('en').includes(query)
    )).map((species): CatalogueSpecies => ({
      id: species.id,
      scientificName: species.scientificName,
      sourceCount: species.sources.length,
      treeLike: species.treeLike,
      wfoId: null,
      wcvpId: null,
      globUnt: false,
      designReady: true,
      stratum: species.stratum,
      succession: species.succession,
      roles: species.roles,
      evergreen: species.evergreen,
      nitrogenFixer: species.nitrogenFixer,
      droughtTolerance: species.droughtTolerance,
      evidenceCount: species.sources.length,
    }));
    const extra = 'theobroma cacao'.includes(query) || query.includes('cacao') ? [cacao] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { results: [...extra, ...curated].slice(0, 18) },
    });
  });
  await page.route('**/api/recommendations', async (route) => {
    const body = route.request().postDataJSON() as { objectives: DesignConfiguration['objectives']; system?: DesignConfiguration['system']; userSpecies?: DesignSpecies[] };
    const extras = normalizeUserSpecies(body.userSpecies);
    const catalogue = rankSpecies(DESIGN_SPECIES, profile, body.objectives);
    const extraRecommendations = extras.length ? rankSpecies(extras, profile, body.objectives) : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { recommendations: [...extraRecommendations, ...catalogue], palette: recommendedPalette(catalogue, body.system ?? 'syntropic', undefined, body.objectives).map((item) => item.species) },
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
      userSpecies?: DesignSpecies[];
      designConfiguration: DesignConfiguration;
    };
    const extras = normalizeUserSpecies(input.userSpecies);
    const species = input.selectedSpeciesIds
      .map((id) => DESIGN_SPECIES.find((item) => item.id === id) ?? extras.find((item) => item.id === id))
      .filter((item): item is DesignSpecies => Boolean(item));
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
      userSpecies?: DesignSpecies[];
      designYear: number;
      irrigationConfiguration: IrrigationConfiguration;
      economicConfiguration: EconomicConfiguration;
    };
    const extras = normalizeUserSpecies(input.userSpecies);
    const species = input.selectedSpeciesIds
      .map((id) => DESIGN_SPECIES.find((item) => item.id === id) ?? extras.find((item) => item.id === id))
      .filter((item): item is DesignSpecies => Boolean(item));
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
  return profile;
}
