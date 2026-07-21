import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { createLocalProjection, pointInPolygon, polygonCentroid } from '../src/lib/geometry.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import { distanceToSiteBoundaryM, siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import type { Evidence, ProjectState, SiteProfile } from '../src/types.js';
import { createApp, type GrowafAppConfig } from './app.js';
import type { GrowafUser } from './mongo.js';
import { unavailableSatelliteProfile } from './sentinel.js';

const observedAt = '2026-07-21T00:00:00.000Z';
const geometryValidation = {
  valid: true,
  reason: 'Valid site geometry',
  areaM2: 2746.51,
  perimeterM: 233.1,
  plantableAreaM2: 2450,
  geometryType: 'Polygon' as const,
  counts: { polygons: 1, holes: 0, exclusions: 0, paths: 0, accessPoints: 0, waterPoints: 0, existingTrees: 0 },
};
const evidence = (source: string): Evidence => ({
  source,
  sourceUrl: 'https://example.test/source',
  version: 'test',
  observedAt,
  confidence: 'high',
  resolution: 'integration fixture',
});
const testUser: GrowafUser = {
  id: 'google-subject-1',
  email: 'planner@example.test',
  name: 'Test Planner',
  pictureUrl: null,
  locale: 'en',
  createdAt: observedAt,
  updatedAt: observedAt,
  lastLoginAt: observedAt,
};
const testAuth = {
  googleOAuthClientId: 'growaf-test.apps.googleusercontent.com',
  authSessionSecret: 'growaf-integration-session-secret-32-bytes',
  verifyGoogleToken: async () => ({
    subject: testUser.id,
    email: testUser.email,
    name: testUser.name,
    pictureUrl: testUser.pictureUrl,
    locale: testUser.locale,
  }),
};

function siteProfile(): SiteProfile {
  const satellite = unavailableSatelliteProfile(new Date(observedAt));
  satellite.status = 'available';
  satellite.existingVegetation = {
    status: 'available',
    suitability: 'clear-with-exclusions',
    analyzedOpticalScenes: 6,
    annualLandCoverYears: [2021, 2022, 2023],
    woodyVegetationLayerAvailable: true,
    detectedCoverPercent: 3.5,
    protectedCoverPercent: 7.2,
    maximumAcceptedCoverPercent: 25,
    patches: [{
      id: 'existing-woody-test',
      centroid: { lat: 36.92102, lng: 14.75325 },
      polygon: [
        { lat: 36.92096, lng: 14.75316 },
        { lat: 36.92096, lng: 14.75334 },
        { lat: 36.92108, lng: 14.75334 },
        { lat: 36.92108, lng: 14.75316 },
      ],
      detectedAreaM2: 130,
      protectedAreaM2: 215,
      pixelCount: 5,
      currentNdvi: 0.51,
      medianNdvi: 0.48,
      persistentGreenFraction: 0.83,
      annualTreeVotes: 1,
      worldCoverTree: true,
      copernicusWoody: true,
      confidence: 'high',
      signals: ['test tree consensus'],
    }],
    evidence: [evidence('Existing vegetation test')],
    conclusion: 'One existing woody patch is protected.',
  };
  return {
    generatedAt: observedAt,
    centroid: polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon),
    areaM2: 2746.51,
    perimeterM: 233.1,
    location: {
      displayName: 'Temperate test field',
      municipality: 'Test municipality',
      province: 'Test province',
      region: 'Test region',
      countryCode: 'XZ',
      evidence: evidence('Location test'),
    },
    terrain: {
      elevationMeanM: 281,
      elevationMinM: 277,
      elevationMaxM: 286,
      slopePercent: 14,
      aspectDegrees: 135,
      aspectLabel: 'SE',
      samples: [{ ...polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon), elevationM: 281 }],
      evidence: evidence('Terrain test'),
    },
    climate: {
      period: '2021–2025',
      meanTemperatureC: 18,
      absoluteMinTemperatureC: -2.2,
      absoluteMaxTemperatureC: 43.8,
      annualPrecipitationMm: 589,
      annualEt0Mm: 1307,
      aridityIndex: 0.45,
      monthly: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        temperatureC: 10 + index,
        precipitationMm: index < 4 || index > 8 ? 70 : 20,
        et0Mm: index < 4 || index > 8 ? 55 : 165,
      })),
      evidence: evidence('Climate test'),
    },
    solar: {
      status: 'available',
      period: '2021–2025',
      annualGlobalHorizontalKwhM2: 1780,
      annualDirectNormalKwhM2: 2050,
      prevailingWindDirectionDegrees: 300,
      prevailingWindDirectionLabel: 'NW',
      meanWindSpeedMs: 3.6,
      hourlyClimatology: Array.from({ length: 12 }, (_, month) => Array.from({ length: 24 }, (_, hour) => ({
        month: month + 1,
        hour,
        directNormalWm2: hour >= 7 && hour <= 17 ? 610 : 0,
        diffuseWm2: hour >= 7 && hour <= 17 ? 100 : 0,
        shortwaveWm2: hour >= 7 && hour <= 17 ? 515 : 0,
        windSpeedMs: 3.6,
        windDirectionDegrees: 300,
        sampleCount: 150,
      }))).flat(),
      evidence: evidence('Solar test'),
      limitations: ['Reanalysis fixture.'],
    },
    soil: {
      ph: 7.2,
      sandPercent: 34,
      siltPercent: 40,
      clayPercent: 26,
      organicCarbonGKg: 18,
      textureClass: 'loam',
      evidence: evidence('Soil test'),
      status: 'available',
    },
    landCover: {
      classification: 'arable field',
      osmTags: { landuse: 'farmland' },
      evidence: evidence('Land cover test'),
    },
    satellite,
    warnings: [],
  };
}

function equatorialSiteProfile(): SiteProfile {
  const profile = siteProfile();
  const centroid = polygonCentroid(EQUATORIAL_OPEN_FIELD_FIXTURE.polygon);
  return {
    ...profile,
    centroid,
    areaM2: 6_200,
    perimeterM: 330,
    location: {
      ...profile.location,
      displayName: 'Equatorial test field',
      municipality: 'Test municipality',
      province: null,
      region: 'Eastern Region',
      countryCode: 'QZ',
    },
    terrain: {
      ...profile.terrain,
      elevationMeanM: 1_145,
      elevationMinM: 1_141,
      elevationMaxM: 1_151,
      slopePercent: 5.5,
      aspectDegrees: 110,
      aspectLabel: 'ESE',
      samples: [
        { ...centroid, elevationM: 1_145 },
        { ...EQUATORIAL_OPEN_FIELD_FIXTURE.polygon[0], elevationM: 1_151 },
        { ...EQUATORIAL_OPEN_FIELD_FIXTURE.polygon[2], elevationM: 1_141 },
      ],
    },
    climate: {
      ...profile.climate,
      meanTemperatureC: 22.1,
      absoluteMinTemperatureC: 10.4,
      absoluteMaxTemperatureC: 34.8,
      annualPrecipitationMm: 1_420,
      annualEt0Mm: 1_180,
      aridityIndex: 1.2,
    },
    satellite: {
      ...profile.satellite,
      existingVegetation: {
        ...profile.satellite.existingVegetation,
        detectedCoverPercent: 0,
        protectedCoverPercent: 0,
        patches: [],
        conclusion: 'No persistent woody vegetation was included in this test fixture.',
      },
    },
  };
}

describe('Growaf API integration', () => {
  it('generates a location-independent design for an equatorial field', async () => {
    const app = createApp({ skipDatabaseMigration: true });
    const profile = equatorialSiteProfile();
    const selectedSpeciesIds = DESIGN_SPECIES
      .filter((species) => species.invasiveStatus !== 'blocked')
      .slice(0, 9)
      .map((species) => species.id);
    const response = await request(app)
      .post('/api/layout/generate')
      .send({ site: EQUATORIAL_OPEN_FIELD_FIXTURE, siteProfile: profile, selectedSpeciesIds })
      .expect(200);
    expect(response.body.variants).toHaveLength(3);
    for (const variant of response.body.variants) {
      expect(variant.trees.length).toBeGreaterThan(10);
      expect(variant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => siteContainsCoordinate(EQUATORIAL_OPEN_FIELD_FIXTURE, tree.coordinate))).toBe(true);
      expect(variant.machinery).toEqual(expect.objectContaining({ enabled: true, clearanceSatisfied: true }));
      expect(variant.design).toEqual(expect.objectContaining({ machinery: expect.objectContaining({ enabled: true }) }));
    }
    const irrigation = await request(app)
      .post('/api/irrigation/calculate')
      .send({
        site: EQUATORIAL_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        variant: response.body.variants[0],
        selectedSpeciesIds,
        irrigationConfiguration: { sourceType: 'tank', availableFlowM3Hour: 4.5, tankCapacityM3: 20 },
      })
      .expect(200);
    expect(irrigation.body.network.source).toEqual(expect.objectContaining({ placement: 'highest-terrain-sample', elevationM: 1151 }));
    expect(irrigation.body.network.source.coordinate).toEqual(EQUATORIAL_OPEN_FIELD_FIXTURE.polygon[0]);
    expect(irrigation.body.network.lines.filter((line: { kind: string }) => line.kind === 'lateral').length).toBeGreaterThan(2);
    expect(irrigation.body.network.components.length).toBeGreaterThan(8);
    expect(irrigation.body.network.totalPurchasePipeM).toBeGreaterThanOrEqual(irrigation.body.network.totalMeasuredPipeM);
    expect(irrigation.body.network.requiredDynamicHeadM).toBeGreaterThan(10);
    expect(irrigation.body.economics).toEqual(expect.objectContaining({ countryCode: 'QZ', currencyCode: 'USD', baseCurrencyCode: 'USD', pricingStatus: 'usd-estimate' }));
    expect(irrigation.body.annualOperation.waterCost).toBeGreaterThan(0);

    const editableLine = irrigation.body.network.lines.find((line: { kind: string }) => line.kind === 'mainline');
    const editedLine = await request(app)
      .post('/api/irrigation/calculate')
      .send({
        site: EQUATORIAL_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        variant: response.body.variants[0],
        selectedSpeciesIds,
        irrigationConfiguration: {
          sourceType: 'tank',
          availableFlowM3Hour: 4.5,
          tankCapacityM3: 20,
          lineOverrides: {
            [editableLine.id]: [editableLine.points[0], polygonCentroid(EQUATORIAL_OPEN_FIELD_FIXTURE.polygon), editableLine.points[editableLine.points.length - 1]],
          },
        },
      })
      .expect(200);
    expect(editedLine.body.network.manualOverrideCount).toBe(1);
    expect(editedLine.body.network.lines.find((line: { id: string }) => line.id === editableLine.id).points.length).toBeGreaterThanOrEqual(3);

    const movedCoordinate = polygonCentroid(EQUATORIAL_OPEN_FIELD_FIXTURE.polygon);
    const movedSourceSite = {
      ...EQUATORIAL_OPEN_FIELD_FIXTURE,
      waterPoints: [{ id: 'mapped-water-source', name: 'Mapped water source', coordinate: movedCoordinate }],
    };
    const movedIrrigation = await request(app)
      .post('/api/irrigation/calculate')
      .send({
        site: movedSourceSite,
        siteProfile: profile,
        variant: response.body.variants[0],
        selectedSpeciesIds,
        irrigationConfiguration: { sourceType: 'tank', sourcePointId: 'mapped-water-source', availableFlowM3Hour: 4.5, tankCapacityM3: 20 },
      })
      .expect(200);
    expect(movedIrrigation.body.network.source).toEqual(expect.objectContaining({
      placement: 'user-water-point',
      coordinate: movedCoordinate,
    }));
    expect(movedIrrigation.body.network.lines.find((line: { kind: string }) => line.kind === 'mainline').points[0]).toEqual(movedCoordinate);

    const phasedVariant = {
      ...response.body.variants[0],
      trees: response.body.variants[0].trees.map((tree: { removedYear: number | null }, index: number) => index % 4 === 0 ? { ...tree, removedYear: 10 } : tree),
    };
    const costs = await request(app)
      .post('/api/costs/calculate')
      .send({
        site: EQUATORIAL_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        variant: phasedVariant,
        selectedSpeciesIds,
        designYear: 5,
        irrigationConfiguration: { sourceType: 'tank', availableFlowM3Hour: 4.5, tankCapacityM3: 20 },
      })
      .expect(200);
    expect(costs.body.establishment.economics.currencyCode).toBe('USD');
    expect(costs.body.establishment.economics.missingLocalRates).toEqual([]);
    expect(costs.body.establishment.plantPurchaseCost).toBeGreaterThan(0);
    expect(costs.body.establishment.plantingLaborCost).toBeGreaterThan(0);
    expect(costs.body.establishment.activeSystem.activePlantCount).toBe(phasedVariant.trees.length);

    const matureCosts = await request(app)
      .post('/api/costs/calculate')
      .send({
        site: EQUATORIAL_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        variant: phasedVariant,
        selectedSpeciesIds,
        designYear: 29,
        irrigationConfiguration: { sourceType: 'tank', availableFlowM3Hour: 4.5, tankCapacityM3: 20 },
      })
      .expect(200);
    expect(matureCosts.body.irrigation.designYear).toBe(29);
    expect(matureCosts.body.irrigation.activePlantCount).toBeLessThan(costs.body.irrigation.activePlantCount);
    expect(matureCosts.body.irrigation.emitterCount).toBeLessThan(costs.body.irrigation.emitterCount);
    expect(matureCosts.body.irrigation.annualWaterM3).toBeLessThan(costs.body.irrigation.annualWaterM3);
    expect(matureCosts.body.irrigation.annualOperation.totalCost).toBeLessThan(costs.body.irrigation.annualOperation.totalCost);
    expect(matureCosts.body.establishment.timeline).toHaveLength(30);
    expect(matureCosts.body.establishment.timeline[29].annualOperatingCost).toBeLessThan(matureCosts.body.establishment.timeline[4].annualOperatingCost);
    expect(matureCosts.body.establishment.totalCost).toBe(costs.body.establishment.totalCost);
    expect(matureCosts.body.establishment.activeSystem.totalReplacementCost).toBeLessThan(costs.body.establishment.activeSystem.totalReplacementCost);
  });

  it('generates a protected layout, calculates costs, persists it and exports evidence geometry', async () => {
    let stored: ProjectState | null = null;
    const database: NonNullable<GrowafAppConfig['database']> = {
      health: async () => true,
      geometryMetrics: async () => geometryValidation,
      getUser: async (id) => id === testUser.id ? testUser : null,
      upsertUser: async () => testUser,
      getProject: async (ownerUserId, id) => ownerUserId === testUser.id && stored?.id === id ? stored : null,
      listProjects: async (ownerUserId) => ownerUserId === testUser.id && stored ? [{ id: stored.id, name: stored.name, updatedAt: stored.updatedAt }] : [],
      saveProject: async (ownerUserId, project) => {
        expect(ownerUserId).toBe(testUser.id);
        stored = project;
        return project;
      },
    };
    const app = createApp({ database, skipDatabaseMigration: true, ...testAuth });
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toEqual({ ok: true, database: 'ready' });

    const config = await request(app).get('/api/config').expect(200);
    expect(config.body.initialMapViewport).toEqual({ center: { lat: 0, lng: 0 }, zoom: 2 });
    expect(config.body).not.toHaveProperty('defaultSite');
    expect(config.body.auth).toEqual({ configured: true, googleClientId: testAuth.googleOAuthClientId });
    expect(JSON.stringify(config.body)).not.toContain(testAuth.authSessionSecret);
    const filteredCatalogue = await request(app).get('/api/catalog/search?q=Olea&tree=true&designReady=true').expect(200);
    expect(filteredCatalogue.body.results).toEqual([
      expect.objectContaining({ scientificName: 'Olea europaea', treeLike: true, designReady: true }),
    ]);
    const login = await request(app).post('/api/auth/google').send({ credential: 'signed-google-token' }).expect(200);
    const sessionCookie = String(login.headers['set-cookie'][0]).split(';')[0];
    expect(login.body.user.email).toBe(testUser.email);
    const session = await request(app).get('/api/auth/session').set('Cookie', sessionCookie).expect(200);
    expect(session.body).toEqual(expect.objectContaining({ authenticated: true, user: expect.objectContaining({ id: testUser.id }) }));

    const profile = siteProfile();
    const recommendationResponse = await request(app)
      .post('/api/recommendations')
      .send({ siteProfile: profile, objectives: { production: 95, biodiversity: 60, nativeHabitat: 80, waterResilience: 90, lowMaintenance: 55 } })
      .expect(200);
    const selectedSpeciesIds = recommendationResponse.body.palette.map((species: { id: string }) => species.id);
    expect(selectedSpeciesIds).toHaveLength(9);

    const layoutResponse = await request(app)
      .post('/api/layout/generate')
      .send({ site: TEMPERATE_OPEN_FIELD_FIXTURE, siteProfile: profile, selectedSpeciesIds })
      .expect(200);
    expect(layoutResponse.body.variants).toHaveLength(3);
    const variant = layoutResponse.body.variants[0];
    expect(variant.trees.length).toBeGreaterThan(20);
    expect(variant.solar.status).toBe('available');
    expect(variant.solar.cropSolarAccessPercent).toBeGreaterThan(0);
    expect(variant.composition).toEqual(expect.objectContaining({
      byStratum: expect.any(Object),
      bySuccession: expect.any(Object),
      targets: expect.objectContaining({ minimumStrata: expect.any(Number) }),
    }));
    const patch = profile.satellite.existingVegetation.patches[0];
    const projection = createLocalProjection(polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon));
    const protectedPolygon = patch.polygon.map(projection.project);
    expect(variant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => (
      !pointInPolygon(projection.project(tree.coordinate), protectedPolygon)
    ))).toBe(true);

    const lockedTree = { ...variant.trees[0], locked: true };
    const previousVariant = { ...variant, trees: variant.trees.map((tree: { id: string }) => tree.id === lockedTree.id ? lockedTree : tree) };
    const regenerationPayload = {
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: profile,
      selectedSpeciesIds,
      previousVariant,
      designConfiguration: previousVariant.design,
    };
    const regenerationResponse = await request(app)
      .post('/api/layout/regenerate')
      .send(regenerationPayload)
      .expect(200);
    const regeneratedVariant = regenerationResponse.body.variant;
    expect(regeneratedVariant.generation).toEqual(expect.objectContaining({
      mode: 'partial',
      lockedTreeCount: 1,
      engineVersion: expect.stringMatching(/^growaf-layout-/),
    }));
    expect(regeneratedVariant.trees.find((tree: { id: string }) => tree.id === lockedTree.id)).toEqual(lockedTree);
    expect(regeneratedVariant.trees.filter((tree: { locked: boolean }) => tree.locked)).toHaveLength(1);
    expect(regeneratedVariant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => siteContainsCoordinate(TEMPERATE_OPEN_FIELD_FIXTURE, tree.coordinate))).toBe(true);
    const repeatedRegeneration = await request(app)
      .post('/api/layout/regenerate')
      .send(regenerationPayload)
      .expect(200);
    expect(repeatedRegeneration.body.variant).toEqual(regeneratedVariant);

    const perimeterResponse = await request(app)
      .post('/api/layout/generate')
      .send({
        site: TEMPERATE_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        selectedSpeciesIds,
        designConfiguration: { ...DEFAULT_DESIGN_CONFIGURATION, system: 'boundary-buffer', extent: 'perimeter-band', perimeterBandM: 8 },
      })
      .expect(200);
    const perimeterVariant = perimeterResponse.body.variants[0];
    expect(perimeterVariant.design.extent).toBe('perimeter-band');
    expect(perimeterVariant.metrics.cropInteriorAreaM2).toBeGreaterThan(500);
    expect(perimeterVariant.trees.length).toBeGreaterThan(10);
    expect(perimeterVariant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => {
      const distance = distanceToSiteBoundaryM(TEMPERATE_OPEN_FIELD_FIXTURE, tree.coordinate);
      return distance >= TEMPERATE_OPEN_FIELD_FIXTURE.setbackM && distance <= 8;
    })).toBe(true);

    const monocultureResponse = await request(app)
      .post('/api/layout/generate')
      .send({
        site: TEMPERATE_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        selectedSpeciesIds: Array.from(new Set([...selectedSpeciesIds, 'olea-europaea'])),
        designConfiguration: { ...DEFAULT_DESIGN_CONFIGURATION, system: 'monoculture', monocultureSpeciesId: 'olea-europaea' },
      })
      .expect(200);
    expect(new Set(monocultureResponse.body.variants[0].trees.map((tree: { speciesId: string }) => tree.speciesId))).toEqual(new Set(['olea-europaea']));

    const costsResponse = await request(app)
      .post('/api/costs/calculate')
      .send({ variant, site: TEMPERATE_OPEN_FIELD_FIXTURE, siteProfile: profile, selectedSpeciesIds, designYear: 5 })
      .expect(200);
    expect(costsResponse.body.irrigation.annualWaterM3).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.installation.laborHours).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.network.lines.length).toBeGreaterThan(5);
    expect(costsResponse.body.irrigation.network.components.length).toBeGreaterThan(8);
    expect(costsResponse.body.irrigation.network.totalPurchasePipeM).toBeGreaterThanOrEqual(costsResponse.body.irrigation.network.totalMeasuredPipeM);
    expect(costsResponse.body.establishment.plantingLaborHours).toBeGreaterThan(0);
    expect(costsResponse.body.establishment.totalCost).toBeGreaterThan(0);

    const project: ProjectState = {
      id: 'api-integration-project',
      name: 'API integration project',
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: profile,
      selectedSpeciesIds,
      designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
      irrigationConfiguration: costsResponse.body.irrigation.configuration,
      economicConfiguration: costsResponse.body.establishment.economics,
      variants: layoutResponse.body.variants,
      selectedVariantId: variant.id,
      timelineYear: 5,
      irrigation: costsResponse.body.irrigation,
      costs: costsResponse.body.establishment,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    await request(app).put(`/api/projects/${project.id}`).send(project).expect(401);
    await request(app).put(`/api/projects/${project.id}`).set('Cookie', sessionCookie).send(project).expect(200);
    const storedResponse = await request(app).get(`/api/projects/${project.id}`).set('Cookie', sessionCookie).expect(200);
    expect(storedResponse.body.id).toBe(project.id);

    const exportResponse = await request(app).get(`/api/projects/${project.id}/export.geojson`).set('Cookie', sessionCookie).expect(200);
    expect(exportResponse.type).toContain('application/geo+json');
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'existing_woody_vegetation')).toBe(true);
    expect(exportResponse.body.features.filter((feature: { properties: { kind: string } }) => feature.properties.kind === 'tree')).toHaveLength(variant.trees.length);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'machinery_corridor')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'irrigation_line')).toBe(true);
    expect(exportResponse.body.features.find((feature: { properties: { kind: string } }) => feature.properties.kind === 'tree').properties).toEqual(expect.objectContaining({
      heightLowM: expect.any(Number),
      heightM: expect.any(Number),
      heightHighM: expect.any(Number),
      growthModel: expect.stringMatching(/^growaf-growth-/),
    }));
    const repeatedGeoJson = await request(app).get(`/api/projects/${project.id}/export.geojson`).set('Cookie', sessionCookie).expect(200);
    expect(repeatedGeoJson.body).toEqual(exportResponse.body);

    await request(app).get(`/api/projects/${project.id}/export.csv`).expect(401);
    const csvResponse = await request(app).get(`/api/projects/${project.id}/export.csv`).set('Cookie', sessionCookie).expect(200);
    expect(csvResponse.type).toContain('text/csv');
    expect(csvResponse.headers['content-disposition']).toContain(`${project.id}.csv`);
    const csvLines = csvResponse.text.trim().split('\n');
    expect(csvLines).toHaveLength(variant.trees.length + 1);
    expect(csvLines[0]).toContain('unit_purchase_cost,planting_labor_hours,planting_labor_cost');
    expect(csvLines[0]).toContain('height_low_m,height_base_m,height_high_m');
    const repeatedCsv = await request(app).get(`/api/projects/${project.id}/export.csv`).set('Cookie', sessionCookie).expect(200);
    expect(repeatedCsv.text).toBe(csvResponse.text);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', sessionCookie).expect(200);
    expect(String(logout.headers['set-cookie'][0])).toContain('Max-Age=0');
  });

  it('rejects invalid palettes and mismatched project IDs', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      database: {
        health: async () => true,
        geometryMetrics: async () => geometryValidation,
        getUser: async (id) => id === testUser.id ? testUser : null,
        upsertUser: async () => testUser,
        getProject: async () => null,
        listProjects: async () => [],
        saveProject: async (_ownerUserId, project) => project,
      },
      ...testAuth,
    });
    const login = await request(app).post('/api/auth/google').send({ credential: 'signed-google-token' }).expect(200);
    const sessionCookie = String(login.headers['set-cookie'][0]).split(';')[0];
    const invalidPalette = await request(app).post('/api/layout/generate').send({
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: siteProfile(),
      selectedSpeciesIds: ['unknown'],
    }).expect(400);
    expect(invalidPalette.body.error.status).toBe('INVALID_PALETTE');

    const mismatch = await request(app).put('/api/projects/wrong-id').set('Cookie', sessionCookie).send({ id: 'right-id', site: TEMPERATE_OPEN_FIELD_FIXTURE }).expect(400);
    expect(mismatch.body.error.status).toBe('PROJECT_ID_MISMATCH');

    const rejectedProfile = siteProfile();
    rejectedProfile.satellite.existingVegetation.suitability = 'reject';
    rejectedProfile.satellite.existingVegetation.conclusion = 'Existing woody cover exceeds the accepted threshold.';
    const woodyReject = await request(app).post('/api/layout/generate').send({
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: rejectedProfile,
      selectedSpeciesIds: DESIGN_SPECIES.slice(0, 3).map((species) => species.id),
    }).expect(422);
    expect(woodyReject.body.error.status).toBe('SITE_WOODY_COVER_TOO_HIGH');
  });

  it('keeps the AI-provider credential server-side and validates proposed project actions', async () => {
    const selectedSpeciesIds = DESIGN_SPECIES
      .filter((species) => species.id !== 'olea-europaea')
      .slice(0, 3)
      .map((species) => species.id);
    const app = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      aiProviderBaseUrl: 'https://provider.example.test',
      aiProviderModel: 'test-planning-model',
      fetchImpl: async (_input, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer server-only-test-key');
        const body = JSON.parse(String(init?.body));
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages[1].content).toContain('Olea europaea');
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            summary: 'Add olive to the current palette.',
            rationale: 'Olea europaea is drought-tolerant and available in the validated catalogue.',
            warnings: ['Confirm nursery stock and cultivar before procurement.'],
            actions: [
              { type: 'add_species', speciesIds: ['Olea europaea'] },
              { type: 'regenerate_layout' },
              { type: 'recalculate_water_and_costs' },
            ],
          }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const config = await request(app).get('/api/config').expect(200);
    expect(config.body.assistant).toEqual({ configured: true, interface: 'openai-compatible' });
    expect(JSON.stringify(config.body)).not.toContain('server-only-test-key');

    const response = await request(app).post('/api/assistant/plan').send({
      message: 'Add Olea europaea and update the project.',
      context: {
        site: TEMPERATE_OPEN_FIELD_FIXTURE,
        siteProfile: siteProfile(),
        selectedSpeciesIds,
        designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
        variants: [],
        selectedVariantId: null,
        timelineYear: 5,
        irrigation: null,
        costs: null,
        section: 'species',
      },
    }).expect(200);

    expect(response.body.requiresConfirmation).toBe(true);
    expect(response.body.actions).toEqual([
      { type: 'add_species', speciesIds: ['olea-europaea'] },
      { type: 'regenerate_layout' },
      { type: 'recalculate_water_and_costs' },
    ]);
  });

  it('proxies address search without exposing provider details to the browser', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        expect(url.hostname).toBe('nominatim.openstreetmap.org');
        expect(url.searchParams.get('q')).toBe('Sample field');
        expect(new Headers(init?.headers).get('User-Agent')).toContain('Growaf');
        return new Response(JSON.stringify([{
          place_id: 42,
          display_name: 'Sample field result',
          lat: '1.0806',
          lon: '34.1750',
          boundingbox: ['1.05', '1.11', '34.14', '34.20'],
          type: 'city',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const response = await request(app).get('/api/locations/search?q=Sample%20field').expect(200);
    expect(response.body).toEqual([expect.objectContaining({
      id: '42',
      coordinate: { lat: 1.0806, lng: 34.175 },
      boundingBox: { south: 1.05, north: 1.11, west: 34.14, east: 34.2 },
    })]);
    const invalid = await request(app).get('/api/locations/search?q=R').expect(400);
    expect(invalid.body.error.status).toBe('INVALID_LOCATION_QUERY');
  });

  it('converts the single USD planning basket through a dynamic field currency without country branches', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('currency.json')) return new Response(JSON.stringify({ XZ: 'XCU' }), { status: 200 });
        if (url.includes('open.er-api.com')) return new Response(JSON.stringify({
          result: 'success',
          time_last_update_utc: 'Tue, 21 Jul 2026 00:00:01 +0000',
          rates: { USD: 1, XCU: 2.5 },
        }), { status: 200 });
        throw new Error(`Unexpected provider URL ${url}`);
      },
    });
    const profile = siteProfile();
    profile.location.countryCode = 'XZ';
    profile.location.displayName = 'Dynamic field jurisdiction';
    const response = await request(app).post('/api/economics/profile').send({ siteProfile: profile }).expect(200);
    expect(response.body).toEqual(expect.objectContaining({
      countryCode: 'XZ',
      baseCurrencyCode: 'USD',
      currencyCode: 'XCU',
      exchangeRateToLocal: 2.5,
      pricingStatus: 'currency-converted-estimate',
      laborCostPerHour: 45,
      plantReferenceMultiplier: 2.5,
      sourceObservedAt: '2026-07-21T00:00:01.000Z',
      confidence: 'medium',
    }));
    expect(JSON.stringify(response.body)).not.toMatch(/country-specific|regional-reference/i);
  });

  it('serves the production client and keeps unknown API routes out of the SPA fallback', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'growaf-static-'));
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Growaf production shell</title>');
    writeFileSync(join(staticRoot, 'asset.txt'), 'production asset');
    const app = createApp({ staticRoot, skipDatabaseMigration: true });

    try {
      const home = await request(app).get('/').expect(200);
      expect(home.text).toContain('Growaf production shell');
      await request(app).get('/asset.txt').expect(200, 'production asset');
      const clientRoute = await request(app).get('/projects/demo').expect(200);
      expect(clientRoute.text).toContain('Growaf production shell');
      const unknownApi = await request(app).get('/api/not-a-route').expect(404);
      expect(unknownApi.text).not.toContain('Growaf production shell');
    } finally {
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });
});
