import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RAGUSA_IBLA_TEST_SITE } from '../src/data/ragusaIblaSite.js';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { createLocalProjection, pointInPolygon, polygonCentroid } from '../src/lib/geometry.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import { distanceToSiteBoundaryM } from '../src/lib/siteGeometry.js';
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
    centroid: polygonCentroid(RAGUSA_IBLA_TEST_SITE.polygon),
    areaM2: 2746.51,
    perimeterM: 233.1,
    location: {
      displayName: 'Ragusa Ibla, Ragusa, Sicilia, Italia',
      municipality: 'Ragusa',
      province: 'Ragusa',
      region: 'Sicilia',
      countryCode: 'IT',
      evidence: evidence('Location test'),
    },
    terrain: {
      elevationMeanM: 281,
      elevationMinM: 277,
      elevationMaxM: 286,
      slopePercent: 14,
      aspectDegrees: 135,
      aspectLabel: 'SE',
      samples: [{ ...polygonCentroid(RAGUSA_IBLA_TEST_SITE.polygon), elevationM: 281 }],
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

describe('Growaf API integration', () => {
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
    expect(config.body.defaultSite.id).toBe('ragusa-ibla-south-of-hedgerow-field');
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
      .send({ site: RAGUSA_IBLA_TEST_SITE, siteProfile: profile, selectedSpeciesIds })
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
    const projection = createLocalProjection(polygonCentroid(RAGUSA_IBLA_TEST_SITE.polygon));
    const protectedPolygon = patch.polygon.map(projection.project);
    expect(variant.trees.every((tree: { coordinate: { lat: number; lng: number } }) => (
      !pointInPolygon(projection.project(tree.coordinate), protectedPolygon)
    ))).toBe(true);

    const perimeterResponse = await request(app)
      .post('/api/layout/generate')
      .send({
        site: RAGUSA_IBLA_TEST_SITE,
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
      const distance = distanceToSiteBoundaryM(RAGUSA_IBLA_TEST_SITE, tree.coordinate);
      return distance >= RAGUSA_IBLA_TEST_SITE.setbackM && distance <= 8;
    })).toBe(true);

    const monocultureResponse = await request(app)
      .post('/api/layout/generate')
      .send({
        site: RAGUSA_IBLA_TEST_SITE,
        siteProfile: profile,
        selectedSpeciesIds: Array.from(new Set([...selectedSpeciesIds, 'olea-europaea'])),
        designConfiguration: { ...DEFAULT_DESIGN_CONFIGURATION, system: 'monoculture', monocultureSpeciesId: 'olea-europaea' },
      })
      .expect(200);
    expect(new Set(monocultureResponse.body.variants[0].trees.map((tree: { speciesId: string }) => tree.speciesId))).toEqual(new Set(['olea-europaea']));

    const costsResponse = await request(app)
      .post('/api/costs/calculate')
      .send({ variant, siteProfile: profile, selectedSpeciesIds, designYear: 5 })
      .expect(200);
    expect(costsResponse.body.irrigation.annualWaterM3).toBeGreaterThan(0);
    expect(costsResponse.body.irrigation.installation.laborHours).toBeGreaterThan(0);
    expect(costsResponse.body.establishment.plantingLaborHours).toBeGreaterThan(0);
    expect(costsResponse.body.establishment.totalEur).toBeGreaterThan(0);

    const project: ProjectState = {
      id: 'api-integration-project',
      name: 'API integration project',
      site: RAGUSA_IBLA_TEST_SITE,
      siteProfile: profile,
      selectedSpeciesIds,
      designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
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
      site: RAGUSA_IBLA_TEST_SITE,
      siteProfile: siteProfile(),
      selectedSpeciesIds: ['unknown'],
    }).expect(400);
    expect(invalidPalette.body.error.status).toBe('INVALID_PALETTE');

    const mismatch = await request(app).put('/api/projects/wrong-id').set('Cookie', sessionCookie).send({ id: 'right-id', site: RAGUSA_IBLA_TEST_SITE }).expect(400);
    expect(mismatch.body.error.status).toBe('PROJECT_ID_MISMATCH');

    const rejectedProfile = siteProfile();
    rejectedProfile.satellite.existingVegetation.suitability = 'reject';
    rejectedProfile.satellite.existingVegetation.conclusion = 'Existing woody cover exceeds the accepted threshold.';
    const woodyReject = await request(app).post('/api/layout/generate').send({
      site: RAGUSA_IBLA_TEST_SITE,
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
        site: RAGUSA_IBLA_TEST_SITE,
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
        expect(url.searchParams.get('q')).toBe('Ragusa Ibla');
        expect(new Headers(init?.headers).get('User-Agent')).toContain('Growaf');
        return new Response(JSON.stringify([{
          place_id: 42,
          display_name: 'Ragusa Ibla, Ragusa, Sicilia, Italia',
          lat: '36.9251',
          lon: '14.7307',
          boundingbox: ['36.91', '36.94', '14.71', '14.75'],
          type: 'historic',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const response = await request(app).get('/api/locations/search?q=Ragusa%20Ibla').expect(200);
    expect(response.body).toEqual([expect.objectContaining({
      id: '42',
      coordinate: { lat: 36.9251, lng: 14.7307 },
      boundingBox: { south: 36.91, north: 36.94, west: 14.71, east: 14.75 },
    })]);
    const invalid = await request(app).get('/api/locations/search?q=R').expect(400);
    expect(invalid.body.error.status).toBe('INVALID_LOCATION_QUERY');
  });
});
