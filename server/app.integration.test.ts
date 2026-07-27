import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles.js';
import { createLocalProjection, pointInPolygon, polygonCentroid } from '../src/lib/geometry.js';
import { defaultProjectCollaboration } from '../src/lib/collaboration.js';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations.js';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import { distanceToSiteBoundaryM, siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import type { DesignConfiguration, Evidence, ProjectState, SiteProfile } from '../src/types.js';
import { createApp, type GrowupAppConfig } from './app.js';
import type { GrowupUser } from './mongo.js';
import { buildRevisionArtifacts } from './revisions.js';
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
const testUser: GrowupUser = {
  id: 'google-subject-1',
  email: 'planner@example.test',
  name: 'Test Planner',
  pictureUrl: null,
  locale: 'en',
  createdAt: observedAt,
  updatedAt: observedAt,
  lastLoginAt: observedAt,
  preferences: {},
};
const testAuth = {
  googleOAuthClientId: 'growup-test.apps.googleusercontent.com',
  authSessionSecret: 'growup-integration-session-secret-32-bytes',
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

describe('Growup API integration', () => {
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
      expect(variant.machinery).toEqual(expect.objectContaining({ enabled: false, clearanceSatisfied: true, corridors: [], turningAreas: [] }));
      expect(variant.design).toEqual(expect.objectContaining({ machinery: expect.objectContaining({ enabled: false }) }));
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
    expect(irrigation.body.network.routingValid).toBe(true);
    expect(irrigation.body.network.unroutableLineIds).toEqual([]);
    expect(irrigation.body.network.lines.every((line: { routingStatus: string }) => line.routingStatus === 'clear')).toBe(true);
    expect(irrigation.body.network.components.length).toBeGreaterThan(8);
    expect(irrigation.body.network.totalPurchasePipeM).toBeGreaterThanOrEqual(irrigation.body.network.totalMeasuredPipeM);
    expect(irrigation.body.network.requiredDynamicHeadM).toBeGreaterThan(10);
    expect(irrigation.body.economics).toEqual(expect.objectContaining({ countryCode: 'QZ', currencyCode: 'USD', baseCurrencyCode: 'USD', pricingStatus: 'usd-estimate' }));
    expect(irrigation.body.annualOperation.waterCost).toBeGreaterThan(0);
    expect(irrigation.body.systemMaintenance).toEqual(expect.objectContaining({
      modelVersion: 'growup-maintenance-1.1.0',
      system: 'syntropic',
      year: 5,
      basis: 'measured-agroforestry-reference',
      confidence: 'medium',
    }));
    expect(irrigation.body.systemMaintenance.totalHours).toBeGreaterThan(0);
    expect(irrigation.body.systemMaintenance.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vegetation-control' }),
      expect.objectContaining({ id: 'biomass-succession' }),
    ]));
    expect(irrigation.body.annualOperation.managementLaborHours).toBe(irrigation.body.systemMaintenance.totalHours);
    expect(irrigation.body.annualOperation.managementLaborCost).toBe(irrigation.body.systemMaintenance.totalCost);

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

    const blockedIrrigation = await request(app)
      .post('/api/irrigation/calculate')
      .send({
        site: {
          ...EQUATORIAL_OPEN_FIELD_FIXTURE,
          existingTrees: [{
            id: 'blocking-canopy',
            name: 'Blocking canopy test fixture',
            speciesName: null,
            coordinate: polygonCentroid(EQUATORIAL_OPEN_FIELD_FIXTURE.polygon),
            crownDiameterM: 500,
            protectionBufferM: 10,
          }],
        },
        siteProfile: profile,
        variant: response.body.variants[0],
        selectedSpeciesIds,
        irrigationConfiguration: { sourceType: 'tank', availableFlowM3Hour: 4.5, tankCapacityM3: 20 },
      })
      .expect(200);
    expect(blockedIrrigation.body.network.routingValid).toBe(false);
    expect(blockedIrrigation.body.network.unroutableLineIds.length).toBeGreaterThan(0);
    expect(blockedIrrigation.body.network.lines.some((line: { routingStatus: string }) => line.routingStatus === 'blocked')).toBe(true);

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
    expect(costs.body.establishment.timeline[0].maintenanceLaborHours).toBeGreaterThan(0);
    expect(costs.body.establishment.timeline[0].maintenanceTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vegetation-control', hours: expect.any(Number), cost: expect.any(Number) }),
    ]));
    expect(costs.body.establishment.timeline[29].maintenanceLaborHours)
      .toBeLessThan(costs.body.establishment.timeline[0].maintenanceLaborHours);

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
    let storedArchivedAt: string | null = null;
    let storedUser = testUser;
    const revisionStates: ProjectState[] = [];
    const calculationRuns = new Map<string, ReturnType<typeof buildRevisionArtifacts>['calculation']>();
    const database: NonNullable<GrowupAppConfig['database']> = {
      health: async () => true,
      geometryMetrics: async () => geometryValidation,
      getUser: async (id) => id === testUser.id ? storedUser : null,
      upsertUser: async () => storedUser,
      updateUserOnboarding: async (id, preference) => {
        expect(id).toBe(testUser.id);
        storedUser = { ...storedUser, preferences: { ...storedUser.preferences, onboarding: preference } };
        return storedUser;
      },
      getProject: async (ownerUserId, id) => ownerUserId === testUser.id && stored?.id === id ? stored : null,
      getSharedProject: async (id) => stored?.id === id ? { ownerUserId: testUser.id, project: stored } : null,
      listProjects: async (ownerUserId) => ownerUserId === testUser.id && stored ? [{ id: stored.id, name: stored.name, updatedAt: stored.updatedAt, archivedAt: storedArchivedAt }] : [],
      setProjectArchived: async (ownerUserId, id, archivedAt) => {
        if (ownerUserId !== testUser.id || id !== stored?.id) throw { code: 404, status: 'PROJECT_NOT_FOUND', message: 'Project not found' };
        storedArchivedAt = archivedAt;
        return { id, name: stored.name, updatedAt: stored.updatedAt, archivedAt };
      },
      listProjectRevisions: async (ownerUserId, projectId) => ownerUserId === testUser.id && projectId === stored?.id
        ? revisionStates.map((state) => buildRevisionArtifacts(testUser.id, state, state.revision ?? 0).summary).reverse()
        : [],
      getProjectRevision: async (ownerUserId, projectId, revision) => ownerUserId === testUser.id && projectId === stored?.id
        ? revisionStates.find((state) => state.revision === revision) ?? null
        : null,
      getCalculationRun: async (ownerUserId, projectId, calculationRunId) => ownerUserId === testUser.id && projectId === stored?.id
        ? calculationRuns.get(calculationRunId) ?? null
        : null,
      saveProject: async (ownerUserId, project) => {
        expect(ownerUserId).toBe(testUser.id);
        const currentRevision = stored?.revision ?? 0;
        if ((project.revision ?? 0) !== currentRevision) throw { code: 409, status: 'PROJECT_REVISION_CONFLICT', message: 'Reload before saving.' };
        const artifacts = buildRevisionArtifacts(ownerUserId, project, currentRevision + 1);
        stored = artifacts.state;
        revisionStates.push(artifacts.state);
        if (artifacts.calculation) calculationRuns.set(artifacts.calculation.id, artifacts.calculation);
        return artifacts.state;
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
    const onboardingPreference = { status: 'active', step: 'review', updatedAt: '2026-07-22T09:00:00.000Z' };
    const onboarding = await request(app).put('/api/user/preferences/onboarding').set('Cookie', sessionCookie).send(onboardingPreference).expect(200);
    expect(onboarding.body.preferences.onboarding).toEqual(onboardingPreference);
    const persistedOnboarding = await request(app).get('/api/auth/session').set('Cookie', sessionCookie).expect(200);
    expect(persistedOnboarding.body.user.preferences.onboarding).toEqual(onboardingPreference);
    await request(app).put('/api/user/preferences/onboarding').set('Cookie', sessionCookie).send({ status: 'active', step: 'unknown', updatedAt: observedAt }).expect(400);
    await request(app).put('/api/user/preferences/onboarding').send(onboardingPreference).expect(401);

    const profile = siteProfile();
    const recommendationResponse = await request(app)
      .post('/api/recommendations')
      .send({ siteProfile: profile, objectives: { production: 95, biodiversity: 60, nativeHabitat: 80, waterResilience: 90, lowMaintenance: 55 } })
      .expect(200);
    const selectedSpeciesIds = recommendationResponse.body.palette.map((species: { id: string }) => species.id);
    expect(selectedSpeciesIds).toHaveLength(9);
    const speciesMix: DesignConfiguration['speciesMix'] = Object.fromEntries(selectedSpeciesIds.map((id: string, index: number) => [
      id,
      {
        targetPercent: index === 0 ? 50 : 6.25,
        successionOverride: index === 0 ? 'placenta' : null,
      },
    ]));

    const layoutResponse = await request(app)
      .post('/api/layout/generate')
      .send({
        site: TEMPERATE_OPEN_FIELD_FIXTURE,
        siteProfile: profile,
        selectedSpeciesIds,
        designConfiguration: {
          ...DEFAULT_DESIGN_CONFIGURATION,
          speciesMix,
          machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: true },
          firebreak: {
            ...DEFAULT_DESIGN_CONFIGURATION.firebreak,
            enabled: true,
            expectedFlameLengthM: 2,
            widthM: 5,
          },
        },
      })
      .expect(200);
    expect(layoutResponse.body.variants).toHaveLength(3);
    const variant = layoutResponse.body.variants[0];
    const pricedSpeciesId = variant.trees[0].speciesId;
    const economicConfiguration = defaultEconomicConfiguration(profile.location.countryCode ?? '');
    economicConfiguration.plantUnitCostOverrides[pricedSpeciesId] = 42.35;
    expect(variant.trees.length).toBeGreaterThan(20);
    expect(variant.solar.status).toBe('available');
    expect(variant.solar.cropSolarAccessPercent).toBeGreaterThan(0);
    expect(variant.composition).toEqual(expect.objectContaining({
      byStratum: expect.any(Object),
      bySuccession: expect.any(Object),
      targets: expect.objectContaining({ minimumStrata: expect.any(Number) }),
    }));
    expect(variant.firebreak).toEqual(expect.objectContaining({
      enabled: true,
      minimumPlanningWidthM: 5,
      plannedWidthM: 5,
      planningWidthSatisfied: true,
      localReviewRequired: true,
      lines: expect.any(Array),
      evidence: expect.arrayContaining([
        expect.objectContaining({ source: 'Italian Civil Protection Department' }),
      ]),
    }));
    expect(variant.firebreak.lines).toHaveLength(TEMPERATE_OPEN_FIELD_FIXTURE.polygon.length);
    expect(variant.machinery.perimeterLoops).toEqual([
      expect.objectContaining({ closed: true, clearanceSatisfied: true, lengthM: expect.any(Number) }),
    ]);
    expect(variant.machinery.manoeuvreRoutes).toEqual([
      expect.objectContaining({
        closed: false,
        clearanceSatisfied: true,
        connectedCorridorIds: variant.machinery.corridors.map((corridor: { id: string }) => corridor.id),
      }),
    ]);
    expect(variant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => (
      distanceToSiteBoundaryM(TEMPERATE_OPEN_FIELD_FIXTURE, tree.coordinate) >= 4.95
    ))).toBe(true);
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
      engineVersion: expect.stringMatching(/^growup-layout-/),
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
      .send({ variant, site: TEMPERATE_OPEN_FIELD_FIXTURE, siteProfile: profile, selectedSpeciesIds, designYear: 5, economicConfiguration })
      .expect(200);
    expect(costsResponse.body.irrigation.annualWaterM3).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.installation.laborHours).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.network.lines.length).toBeGreaterThan(5);
    expect(costsResponse.body.irrigation.network.components.length).toBeGreaterThan(8);
    expect(costsResponse.body.irrigation.network.protectedCrossingCount).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.network.components.some((component: { label: string }) => component.label === 'Operational crossing sleeve')).toBe(true);
    expect(costsResponse.body.irrigation.network.totalPurchasePipeM).toBeGreaterThanOrEqual(costsResponse.body.irrigation.network.totalMeasuredPipeM);
    expect(costsResponse.body.establishment.plantingLaborHours).toBeGreaterThan(0);
    expect(costsResponse.body.establishment.totalCost).toBeGreaterThan(0);
    expect(costsResponse.body.establishment.bySpecies.find((item: { speciesId: string }) => item.speciesId === pricedSpeciesId).unitPlantCost).toBe(42.35);

    const fireOperations = defaultFireOperationsPlan(observedAt);
    fireOperations.reviewedAt = observedAt;
    fireOperations.nextInspectionAt = '2026-08-01T08:00:00.000Z';
    fireOperations.tasks[0] = {
      ...fireOperations.tasks[0],
      status: 'complete',
      completedAt: observedAt,
      notes: 'Surface fuels inspected after mowing.',
    };
    const collaboration = defaultProjectCollaboration();
    collaboration.comments.push({
      id: 'authenticated-persistence-comment',
      authorName: 'Test Planner',
      message: 'Keep the western firebreak accessible.',
      coordinate: { lat: 36.92102, lng: 14.75325 },
      target: 'firebreak',
      targetId: variant.firebreak?.lines[0]?.id ?? null,
      revision: 0,
      createdAt: observedAt,
      resolvedAt: null,
    });
    const project: ProjectState = {
      id: 'api-integration-project',
      name: 'API integration project',
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: profile,
      selectedSpeciesIds,
      designConfiguration: variant.design,
      irrigationConfiguration: costsResponse.body.irrigation.configuration,
      economicConfiguration: costsResponse.body.establishment.economics,
      variants: layoutResponse.body.variants,
      selectedVariantId: variant.id,
      timelineYear: 5,
      irrigation: costsResponse.body.irrigation,
      costs: costsResponse.body.establishment,
      fireOperations,
      analysis: {
        id: 'persisted-formal-review',
        model: 'integration-review-model',
        generatedAt: observedAt,
        contextFingerprint: 'review-integration',
        verdict: 'revise',
        overallScore: 72,
        executiveSummary: 'A local fire review remains open.',
        dimensions: [],
        findings: [],
        assumptions: [],
        limitations: ['Not a legal certification.'],
      },
      collaboration,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    await request(app).put(`/api/projects/${project.id}`).send(project).expect(401);
    const saved = await request(app).put(`/api/projects/${project.id}`).set('Cookie', sessionCookie).send(project).expect(200);
    expect(saved.body).toEqual(expect.objectContaining({ revision: 1, revisionId: expect.any(String), calculationRunId: expect.any(String) }));
    const storedResponse = await request(app).get(`/api/projects/${project.id}`).set('Cookie', sessionCookie).expect(200);
    expect(storedResponse.body).toEqual(expect.objectContaining({ id: project.id, revision: 1 }));
    expect(storedResponse.body.designConfiguration.speciesMix[selectedSpeciesIds[0]]).toEqual({
      targetPercent: 50,
      successionOverride: 'placenta',
    });
    expect(storedResponse.body.economicConfiguration.plantUnitCostOverrides).toEqual({ [pricedSpeciesId]: 42.35 });
    expect(storedResponse.body.fireOperations).toEqual(expect.objectContaining({
      reviewedAt: observedAt,
      nextInspectionAt: '2026-08-01T08:00:00.000Z',
    }));
    expect(storedResponse.body.fireOperations.tasks[0]).toEqual(expect.objectContaining({
      status: 'complete',
      completedAt: observedAt,
      notes: 'Surface fuels inspected after mowing.',
    }));
    expect(storedResponse.body.analysis).toEqual(expect.objectContaining({
      id: 'persisted-formal-review',
      verdict: 'revise',
      overallScore: 72,
    }));
    expect(storedResponse.body.collaboration.comments).toEqual([
      expect.objectContaining({
        id: 'authenticated-persistence-comment',
        target: 'firebreak',
        message: 'Keep the western firebreak accessible.',
      }),
    ]);
    const archived = await request(app).patch(`/api/projects/${project.id}/archive`).set('Cookie', sessionCookie).send({ archived: true }).expect(200);
    expect(archived.body).toEqual(expect.objectContaining({ id: project.id, archivedAt: expect.any(String) }));
    const archivedList = await request(app).get('/api/projects').set('Cookie', sessionCookie).expect(200);
    expect(archivedList.body).toEqual([expect.objectContaining({ id: project.id, archivedAt: archived.body.archivedAt })]);
    const restoredFromArchive = await request(app).patch(`/api/projects/${project.id}/archive`).set('Cookie', sessionCookie).send({ archived: false }).expect(200);
    expect(restoredFromArchive.body.archivedAt).toBeNull();
    await request(app).patch(`/api/projects/${project.id}/archive`).set('Cookie', sessionCookie).send({ archived: 'yes' }).expect(400);
    const revisions = await request(app).get(`/api/projects/${project.id}/revisions`).set('Cookie', sessionCookie).expect(200);
    expect(revisions.body).toEqual([expect.objectContaining({ revision: 1, treeCount: variant.trees.length })]);
    const historical = await request(app).get(`/api/projects/${project.id}/revisions/1`).set('Cookie', sessionCookie).expect(200);
    expect(historical.body).toEqual(expect.objectContaining({ id: project.id, revision: 1 }));
    const calculation = await request(app).get(`/api/projects/${project.id}/calculations/${saved.body.calculationRunId}`).set('Cookie', sessionCookie).expect(200);
    expect(calculation.body).toEqual(expect.objectContaining({
      projectId: project.id,
      revision: 1,
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      geometryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      modelVersions: expect.objectContaining({ growth: 'growup-growth-1.0.0', irrigation: 'growup-irrigation-1.0.0', maintenance: 'growup-maintenance-1.1.0' }),
      outputSummary: expect.objectContaining({ treeCount: variant.trees.length, maintenanceLaborHours: expect.any(Number), maintenanceLaborCost: expect.any(Number) }),
    }));
    const second = await request(app).put(`/api/projects/${project.id}`).set('Cookie', sessionCookie).send({ ...saved.body, name: 'Revised API project', updatedAt: '2026-07-21T01:00:00.000Z' }).expect(200);
    expect(second.body.revision).toBe(2);
    const conflict = await request(app).put(`/api/projects/${project.id}`).set('Cookie', sessionCookie).send({ ...project, name: 'Stale edit' }).expect(409);
    expect(conflict.body.error.status).toBe('PROJECT_REVISION_CONFLICT');
    const restored = await request(app).post(`/api/projects/${project.id}/revisions/1/restore`).set('Cookie', sessionCookie).expect(200);
    expect(restored.body).toEqual(expect.objectContaining({ revision: 3, name: project.name }));

    const exportResponse = await request(app).get(`/api/projects/${project.id}/export.geojson`).set('Cookie', sessionCookie).expect(200);
    expect(exportResponse.type).toContain('application/geo+json');
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'existing_woody_vegetation')).toBe(true);
    expect(exportResponse.body.features.filter((feature: { properties: { kind: string } }) => feature.properties.kind === 'tree')).toHaveLength(variant.trees.length);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'machinery_corridor')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'machinery_perimeter_loop')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'machinery_manoeuvre_route')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'firebreak')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'review_comment')).toBe(true);
    expect(exportResponse.body.features.some((feature: { properties: { kind: string } }) => feature.properties.kind === 'irrigation_line')).toBe(true);
    expect(exportResponse.body.fireOperations.tasks[0]).toEqual(expect.objectContaining({ status: 'complete' }));
    expect(exportResponse.body.commentCount).toBe(1);
    expect(exportResponse.body.maintenance).toEqual(expect.objectContaining({ modelVersion: 'growup-maintenance-1.1.0', totalHours: expect.any(Number), totalCost: expect.any(Number) }));
    expect(exportResponse.body.features.find((feature: { properties: { kind: string } }) => feature.properties.kind === 'tree').properties).toEqual(expect.objectContaining({
      plantCode: expect.stringMatching(/^[A-Z]+\d+$/),
      heightLowM: expect.any(Number),
      heightM: expect.any(Number),
      heightHighM: expect.any(Number),
      growthModel: expect.stringMatching(/^growup-growth-/),
    }));
    const repeatedGeoJson = await request(app).get(`/api/projects/${project.id}/export.geojson`).set('Cookie', sessionCookie).expect(200);
    expect(repeatedGeoJson.body).toEqual(exportResponse.body);

    await request(app).get(`/api/projects/${project.id}/export.csv`).expect(401);
    const csvResponse = await request(app).get(`/api/projects/${project.id}/export.csv`).set('Cookie', sessionCookie).expect(200);
    expect(csvResponse.type).toContain('text/csv');
    expect(csvResponse.headers['content-disposition']).toContain(`${project.id}.csv`);
    const csvLines = csvResponse.text.trim().split('\n');
    expect(csvLines).toHaveLength(variant.trees.length + 1);
    expect(csvLines[0]).toContain('tree_id,plant_code,species_id');
    expect(csvLines[0]).toContain('unit_purchase_cost,planting_labor_hours,planting_labor_cost');
    expect(csvLines[0]).toContain('height_low_m,height_base_m,height_high_m');
    expect(csvLines[0]).toContain('maintenance_year,maintenance_model,maintenance_phase,maintenance_hours,maintenance_labor_cost');
    expect(csvLines[0]).toContain('fire_controls_complete,fire_controls_due,review_status,review_comment_count');
    const repeatedCsv = await request(app).get(`/api/projects/${project.id}/export.csv`).set('Cookie', sessionCookie).expect(200);
    expect(repeatedCsv.text).toBe(csvResponse.text);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', sessionCookie).expect(200);
    expect(String(logout.headers['set-cookie'][0])).toContain('Max-Age=0');
  });

  it('validates audited site overrides and advanced design-ready catalogue filters', async () => {
    const app = createApp({ skipDatabaseMigration: true, now: () => new Date('2026-07-21T12:30:00.000Z') });
    const profile = siteProfile();
    const overridden = await request(app)
      .post('/api/site/profile/override')
      .send({
        siteProfile: profile,
        override: {
          field: 'soil.ph',
          value: '6.4',
          reason: 'Composite laboratory sample from five field points.',
          sourceLabel: 'Accredited soil laboratory',
          observedAt: '2026-07-18',
        },
      })
      .expect(200);
    expect(overridden.body.soil.ph).toBe(6.4);
    expect(overridden.body.generatedAt).toBe('2026-07-21T12:30:00.000Z');
    expect(overridden.body.overrides).toEqual([expect.objectContaining({
      field: 'soil.ph',
      previousValue: 7.2,
      value: 6.4,
      unit: 'pH',
      sourceLabel: 'Accredited soil laboratory',
      observedAt: '2026-07-18T00:00:00.000Z',
    })]);
    await request(app)
      .post('/api/site/profile/override')
      .send({ siteProfile: profile, override: { field: 'soil.ph', value: 15, reason: 'Measured', sourceLabel: 'Lab', observedAt: '2026-07-18' } })
      .expect(400);

    const filtered = await request(app)
      .get('/api/catalog/search?q=Olea&designReady=true&stratum=medium&succession=climax&evergreen=true&droughtMin=4&evidenceMin=3')
      .expect(200);
    expect(filtered.body.results).toEqual([expect.objectContaining({
      scientificName: 'Olea europaea',
      designReady: true,
      stratum: 'medium',
      succession: 'climax',
      evergreen: true,
      droughtTolerance: 5,
    })]);
    const mismatched = await request(app).get('/api/catalog/search?q=Olea&evergreen=false').expect(200);
    expect(mismatched.body.total).toBe(0);

    const desertProfile = {
      ...profile,
      location: { countryCode: 'DZ', displayName: 'Sahara test field' },
      climate: {
        ...profile.climate,
        absoluteMinTemperatureC: 5,
        absoluteMaxTemperatureC: 46,
        annualPrecipitationMm: 50,
        annualEt0Mm: 2200,
        aridityIndex: 0.02,
      },
    };
    const recommendations = await request(app)
      .post('/api/recommendations')
      .send({ siteProfile: desertProfile })
      .expect(200);
    expect(recommendations.body.palette.map((species: { id: string }) => species.id)).not.toContain('quercus-ilex');
    expect(recommendations.body.recommendations).toContainEqual(expect.objectContaining({
      species: expect.objectContaining({ id: 'quercus-ilex' }),
      status: 'poor',
      components: expect.arrayContaining([expect.objectContaining({ key: 'water', status: 'poor' })]),
    }));
  });

  it('rejects invalid palettes and mismatched project IDs', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      database: {
        health: async () => true,
        geometryMetrics: async () => geometryValidation,
        getUser: async (id) => id === testUser.id ? testUser : null,
        upsertUser: async () => testUser,
        updateUserOnboarding: async (_id, preference) => ({ ...testUser, preferences: { onboarding: preference } }),
        getProject: async () => null,
        getSharedProject: async () => null,
        listProjects: async () => [],
        setProjectArchived: async (_ownerUserId, id, archivedAt) => ({ id, name: 'Project', updatedAt: observedAt, archivedAt }),
        listProjectRevisions: async () => [],
        getProjectRevision: async () => null,
        getCalculationRun: async () => null,
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
              { type: 'navigate', section: 'fire' },
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
        irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
        economicConfiguration: defaultEconomicConfiguration('IT'),
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
      { type: 'navigate', section: 'fire' },
    ]);
  });

  it('runs a structured formal AI review grounded in the complete project context', async () => {
    const selectedSpeciesIds = DESIGN_SPECIES.slice(0, 3).map((species) => species.id);
    let formalReviewCalls = 0;
    const app = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      fetchImpl: async (_input, init) => {
        formalReviewCalls += 1;
        const body = JSON.parse(String(init?.body));
        expect(body.messages[0].content).toContain('independent senior agroforestry project reviewer');
        expect(body.messages[0].content).toContain('EFFIS FWI is a regional weather-danger forecast');
        expect(body.messages[0].content).toContain('Missing evidence is unknown');
        expect(body.messages[1].content).toContain('Formal review fixture');
        expect(body.messages[1].content).toContain('Italian');
        expect(body.messages[1].content).toContain('"economicConfiguration"');
        expect(body.messages[1].content).toContain('"irrigationConfiguration"');
        expect(body.messages[1].content).toContain('"waterPointCount"');
        expect(body.max_tokens).toBe(5_000);
        if (formalReviewCalls === 1) {
          expect(body.response_format).toEqual({ type: 'json_object' });
          return new Response(JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '' } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        expect(body.response_format).toBeUndefined();
        expect(body.messages.at(-1).content).toContain('previous JSON-mode response was empty');
        const formalReview = {
          verdict: 'revise',
          overallScore: 78,
          executiveSummary: 'Il progetto è coerente, ma richiede una verifica operativa antincendio.',
          dimensions: [
            { id: 'evidence', score: 82, status: 'pass', summary: 'Fonti tracciate.' },
            { id: 'species', score: 80, status: 'pass', summary: 'Palette compatibile.' },
            { id: 'design', score: 79, status: 'pass', summary: 'Geometria coerente.' },
            { id: 'water', score: 76, status: 'attention', summary: 'Confermare la fonte.' },
            { id: 'fire', score: 62, status: 'attention', summary: 'Serve verifica locale.' },
            { id: 'operations', score: 68, status: 'attention', summary: 'Checklist aperta.' },
            { id: 'economics', score: 75, status: 'pass', summary: 'Costi tracciati.' },
            { id: 'coherence', score: 81, status: 'pass', summary: 'Nessuna contraddizione bloccante.' },
          ],
          findings: [{
            id: 'fire-local-review',
            severity: 'major',
            area: 'fire',
            title: 'Verifica antincendio locale aperta',
            explanation: 'La fascia è un output progettuale e non prova la realizzazione sul campo.',
            evidence: ['project.fireOperations.tasks.authority-review', 'selectedVariant.firebreak.localReviewRequired'],
            recommendation: 'Confermare requisiti AIB e condizioni del combustibile sul campo.',
          }],
          assumptions: ['La sorgente irrigua resta disponibile nella stagione secca.'],
          limitations: ['La revisione AI non costituisce certificazione legale o antincendio.'],
        };
        return new Response(JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: `\`\`\`json\n${JSON.stringify(formalReview)}\n\`\`\`` } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const response = await request(app).post('/api/assistant/review').send({
      locale: 'it',
      context: {
        site: { ...TEMPERATE_OPEN_FIELD_FIXTURE, name: 'Formal review fixture' },
        siteProfile: siteProfile(),
        selectedSpeciesIds,
        designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
        irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
        economicConfiguration: defaultEconomicConfiguration('IT'),
        variants: [],
        selectedVariantId: null,
        timelineYear: 5,
        irrigation: null,
        costs: null,
        fireOperations: defaultFireOperationsPlan('2026-07-27T08:00:00.000Z'),
        section: 'analysis',
      },
    }).expect(200);

    expect(response.body).toEqual(expect.objectContaining({
      verdict: 'revise',
      overallScore: 74,
      model: expect.any(String),
      contextFingerprint: expect.stringMatching(/^review-[a-f0-9]{8}$/),
      generatedAt: expect.any(String),
    }));
    expect(response.body.dimensions).toHaveLength(8);
    expect(response.body.findings[0]).toEqual(expect.objectContaining({
      severity: 'major',
      area: 'fire',
    }));
    expect(formalReviewCalls).toBe(2);
  });

  it('retries only transient AI-provider failures and classifies provider timeouts', async () => {
    const selectedSpeciesIds = DESIGN_SPECIES.slice(0, 3).map((species) => species.id);
    const context = {
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: siteProfile(),
      selectedSpeciesIds,
      designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
      irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
      economicConfiguration: defaultEconomicConfiguration('IT'),
      variants: [],
      selectedVariantId: null,
      timelineYear: 5,
      irrigation: null,
      costs: null,
      section: 'species',
    };
    let transientCalls = 0;
    const retryingApp = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      aiProviderMaxAttempts: 2,
      aiProviderRetryDelayMs: 0,
      fetchImpl: async () => {
        transientCalls += 1;
        if (transientCalls === 1) return new Response(JSON.stringify({ error: { message: 'Temporary provider outage' } }), { status: 503 });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: 'No changes required.', rationale: 'The current project remains valid.', warnings: [], actions: [] }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await request(retryingApp).post('/api/assistant/plan').send({ message: 'Review this project.', context }).expect(200);
    expect(transientCalls).toBe(2);

    let emptyJsonCalls = 0;
    const deepseekApp = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      aiProviderBaseUrl: 'https://api.deepseek.com',
      aiProviderModel: 'deepseek-v4-pro',
      aiProviderMaxAttempts: 2,
      aiProviderRetryDelayMs: 0,
      fetchImpl: async (_input, init) => {
        emptyJsonCalls += 1;
        const body = JSON.parse(String(init?.body));
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body.max_tokens).toBeGreaterThanOrEqual(2_500);
        if (emptyJsonCalls === 1) {
          expect(body.response_format).toEqual({ type: 'json_object' });
          return new Response(JSON.stringify({
            choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'internal reasoning omitted' } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        expect(body.response_format).toBeUndefined();
        expect(body.messages.at(-1).content).toContain('previous JSON-mode response was empty');
        return new Response(JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'No changes required.', rationale: 'The current project remains valid.', warnings: [], actions: [] }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await request(deepseekApp).post('/api/assistant/plan').send({ message: 'Review this project.', context }).expect(200);
    expect(emptyJsonCalls).toBe(2);

    let rejectedCalls = 0;
    const rejectedApp = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      aiProviderMaxAttempts: 3,
      aiProviderRetryDelayMs: 0,
      fetchImpl: async () => {
        rejectedCalls += 1;
        return new Response(JSON.stringify({ error: { message: 'Invalid provider credential' } }), { status: 401 });
      },
    });
    const rejected = await request(rejectedApp).post('/api/assistant/plan').send({ message: 'Review this project.', context }).expect(502);
    expect(rejected.body.error.status).toBe('AI_PROVIDER_ERROR');
    expect(rejectedCalls).toBe(1);

    let timeoutCalls = 0;
    const timeoutApp = createApp({
      skipDatabaseMigration: true,
      aiProviderApiKey: 'server-only-test-key',
      aiProviderMaxAttempts: 2,
      aiProviderRetryDelayMs: 0,
      fetchImpl: async () => {
        timeoutCalls += 1;
        throw new DOMException('Timed out', 'TimeoutError');
      },
    });
    const timedOut = await request(timeoutApp).post('/api/assistant/plan').send({ message: 'Review this project.', context }).expect(504);
    expect(timedOut.body.error.status).toBe('AI_PROVIDER_TIMEOUT');
    expect(timeoutCalls).toBe(2);
  });

  it('proxies address search without exposing provider details to the browser', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        expect(url.hostname).toBe('nominatim.openstreetmap.org');
        expect(url.searchParams.get('q')).toBe('Sample field');
        expect(new Headers(init?.headers).get('User-Agent')).toContain('Growup');
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

  it('falls back to server-side Google geocoding when the primary place search is unavailable', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      googleMapsServerApiKey: 'server-only-geocoding-key',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'nominatim.openstreetmap.org') return new Response(null, { status: 503 });
        expect(url.hostname).toBe('maps.googleapis.com');
        expect(url.searchParams.get('address')).toBe('Sample fallback');
        expect(url.searchParams.get('key')).toBe('server-only-geocoding-key');
        return new Response(JSON.stringify({
          status: 'OK',
          results: [{
            place_id: 'google-place-1',
            formatted_address: 'Sample fallback result',
            types: ['locality'],
            geometry: {
              location: { lat: 1.0806, lng: 34.175 },
              viewport: { southwest: { lat: 1.05, lng: 34.14 }, northeast: { lat: 1.11, lng: 34.2 } },
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const response = await request(app).get('/api/locations/search?q=Sample%20fallback').expect(200);
    expect(response.body).toEqual([{
      id: 'google-place-1',
      displayName: 'Sample fallback result',
      coordinate: { lat: 1.0806, lng: 34.175 },
      boundingBox: { south: 1.05, north: 1.11, west: 34.14, east: 34.2 },
      type: 'locality',
    }]);
    expect(JSON.stringify(response.body)).not.toContain('server-only-geocoding-key');
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
    const staticRoot = mkdtempSync(join(tmpdir(), 'growup-static-'));
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Growup production shell</title>');
    writeFileSync(join(staticRoot, 'asset.txt'), 'production asset');
    writeFileSync(join(staticRoot, 'growup-social-card-v2.jpg'), 'social card');
    const app = createApp({ staticRoot, skipDatabaseMigration: true });

    try {
      const home = await request(app).get('/').expect(200);
      expect(home.text).toContain('Growup production shell');
      const asset = await request(app).get('/asset.txt').expect(200, 'production asset');
      expect(asset.headers['cross-origin-resource-policy']).toBe('same-origin');
      const socialCard = await request(app).get('/growup-social-card-v2.jpg').expect(200);
      expect(socialCard.body.toString()).toBe('social card');
      expect(socialCard.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const clientRoute = await request(app).get('/projects/demo').expect(200);
      expect(clientRoute.text).toContain('Growup production shell');
      const unknownApi = await request(app).get('/api/not-a-route').expect(404);
      expect(unknownApi.text).not.toContain('Growup production shell');
    } finally {
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  it('enforces origin, browser-header and compute-rate security boundaries', async () => {
    const app = createApp({
      skipDatabaseMigration: true,
      allowedOrigins: ['https://growup.earth'],
      computeRateLimit: 1,
      rateLimitWindowMs: 60_000,
    });

    const allowed = await request(app)
      .get('/api/config')
      .set('Origin', 'https://growup.earth')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://growup.earth');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['x-powered-by']).toBeUndefined();
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['strict-transport-security']).toContain('includeSubDomains');
    expect(allowed.headers['content-security-policy']).toContain("default-src 'self'");
    expect(allowed.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(allowed.headers['permissions-policy']).toContain('camera=()');

    const denied = await request(app).get('/api/config').set('Origin', 'https://attacker.example').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const payload = { siteProfile: siteProfile(), objectives: DEFAULT_DESIGN_CONFIGURATION.objectives };
    const first = await request(app).post('/api/recommendations').send(payload).expect(200);
    expect(first.headers['ratelimit-limit']).toBe('1');
    expect(first.headers['ratelimit-remaining']).toBe('0');
    const limited = await request(app).post('/api/recommendations').send(payload).expect(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.body.error).toEqual(expect.objectContaining({ code: 429, status: 'RATE_LIMITED' }));
  });
});
