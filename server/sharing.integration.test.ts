import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { firebreakConfigurationFromFuelModel } from '../src/data/firebreak';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { calculateEstablishmentCost } from '../src/lib/costs';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { calculateIrrigation, DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from '../src/lib/layout';
import type { ProjectState } from '../src/types';
import { createApp, type GrowupAppConfig } from './app';
import type { GrowupUser } from './mongo';

describe('shared project review integration', () => {
  it('creates, reviews, persists and revokes a signed project link', async () => {
    const now = '2026-07-26T10:00:00.000Z';
    const user: GrowupUser = {
      id: 'owner-1',
      email: 'owner@example.test',
      name: 'Owner',
      pictureUrl: null,
      locale: 'en',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      preferences: {},
    };
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    profile.satellite.optical.trueColorPreviewUrl = 'https://imagery.example.test/sentinel-2-true-color.png';
    profile.satellite.evidence[0] = {
      ...profile.satellite.evidence[0],
      dataObservedAt: '2026-07-20T09:42:00.000Z',
      retrievedAt: now,
    };
    const species = DESIGN_SPECIES.slice(0, 4);
    const design = {
      ...DEFAULT_DESIGN_CONFIGURATION,
      firebreak: { ...firebreakConfigurationFromFuelModel('shrub-edge'), enabled: true },
    };
    const variants = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, design);
    const economics = defaultEconomicConfiguration(profile.location.countryCode ?? '');
    const irrigation = calculateIrrigation(variants[0], species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, DEFAULT_IRRIGATION_CONFIGURATION, economics);
    const costs = calculateEstablishmentCost(variants[0], species, irrigation, economics);
    let project: ProjectState = {
      id: 'shared-project',
      name: 'Shared project',
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: profile,
      selectedSpeciesIds: species.map((item) => item.id),
      designConfiguration: design,
      irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
      economicConfiguration: economics,
      variants,
      selectedVariantId: variants[0].id,
      timelineYear: 5,
      irrigation,
      costs,
      fireOperations: defaultFireOperationsPlan(now),
      collaboration: defaultProjectCollaboration(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const database: NonNullable<GrowupAppConfig['database']> = {
      health: async () => true,
      geometryMetrics: async () => ({ valid: true, reason: 'Valid', areaM2: 1_000, perimeterM: 140, plantableAreaM2: 900, geometryType: 'Polygon', counts: { polygons: 1, holes: 0, exclusions: 0, paths: 0, accessPoints: 0, waterPoints: 0, existingTrees: 0 } }),
      getUser: async (id) => id === user.id ? user : null,
      upsertUser: async () => user,
      updateUserOnboarding: async () => user,
      getProject: async (ownerUserId, id) => ownerUserId === user.id && id === project.id ? project : null,
      getSharedProject: async (id) => id === project.id ? { ownerUserId: user.id, project } : null,
      listProjects: async () => [{ id: project.id, name: project.name, updatedAt: project.updatedAt, archivedAt: null }],
      setProjectArchived: async (_ownerUserId, id, archivedAt) => ({ id, name: project.name, updatedAt: project.updatedAt, archivedAt }),
      listProjectRevisions: async () => [],
      getProjectRevision: async () => null,
      getCalculationRun: async () => null,
      saveProject: async (ownerUserId, next) => {
        expect(ownerUserId).toBe(user.id);
        project = { ...next, revision: (project.revision ?? 0) + 1 };
        return project;
      },
    };
    const app = createApp({
      database,
      skipDatabaseMigration: true,
      googleOAuthClientId: 'growup-sharing.apps.googleusercontent.com',
      authSessionSecret: 'test-sharing-secret-with-sufficient-entropy',
      now: () => new Date(now),
      verifyGoogleToken: async () => ({ subject: user.id, email: user.email, name: user.name, pictureUrl: null, locale: 'en' }),
    });
    const login = await request(app).post('/api/auth/google').send({ credential: 'valid-test-token' }).expect(200);
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
    const viewOnly = await request(app).post(`/api/projects/${project.id}/share`).set('Cookie', cookie).send({
      mode: 'view',
      includeCosts: false,
      expiresAt: '2026-08-26T10:00:00.000Z',
    }).expect(200);
    expect(viewOnly.body).toEqual(expect.objectContaining({ enabled: true, mode: 'view', includeCosts: false, path: expect.stringMatching(/^\/shared\//) }));
    const viewToken = viewOnly.body.path.split('/').pop();
    const viewOnlyProject = await request(app).get(`/api/shared/projects/${viewToken}`).expect(200);
    expect(viewOnlyProject.body).toEqual(expect.objectContaining({
      siteProfile: expect.objectContaining({ soil: expect.any(Object), satellite: expect.any(Object) }),
      variants: expect.arrayContaining([expect.objectContaining({ trees: expect.any(Array), firebreak: expect.any(Object), machinery: expect.any(Object) })]),
      fireOperations: expect.any(Object),
      economicConfiguration: null,
      costs: null,
    }));
    expect(viewOnlyProject.body.siteProfile.generatedAt).toBe(profile.generatedAt);
    expect(viewOnlyProject.body.siteProfile.soil.verticalProfile).toEqual(profile.soil.verticalProfile);
    expect(viewOnlyProject.body.siteProfile.soil.depthToBedrock).toEqual(profile.soil.depthToBedrock);
    expect(viewOnlyProject.body.siteProfile.groundwater).toEqual(profile.groundwater);
    expect(viewOnlyProject.body.siteProfile.satellite).toEqual(profile.satellite);
    expect(viewOnlyProject.body.siteProfile.soil.verticalProfile[0].evidence).toEqual(expect.objectContaining({
      publishedAt: '2021-06-14',
      retrievedAt: profile.soil.evidence.retrievedAt,
    }));
    expect(viewOnlyProject.body.siteProfile.soil.depthToBedrock.evidence).toEqual(expect.objectContaining({
      publishedAt: '2017-03-10',
      retrievedAt: profile.soil.depthToBedrock?.evidence.retrievedAt,
    }));
    expect(viewOnlyProject.body.siteProfile.satellite.evidence[0]).toEqual(expect.objectContaining({
      dataObservedAt: '2026-07-20T09:42:00.000Z',
      retrievedAt: now,
    }));
    expect(viewOnlyProject.body.irrigation).toEqual(expect.objectContaining({
      annualWaterM3: expect.any(Number),
      network: expect.objectContaining({ lines: expect.any(Array), components: expect.any(Array) }),
    }));
    expect(viewOnlyProject.body.irrigation).not.toHaveProperty('economics');
    expect(viewOnlyProject.body.irrigation.installation).not.toHaveProperty('materialsCost');
    expect(viewOnlyProject.body.irrigation.annualOperation).not.toHaveProperty('waterCost');
    expect(viewOnlyProject.body.irrigation.systemMaintenance).not.toHaveProperty('totalCost');
    expect(viewOnlyProject.body.irrigation.systemMaintenance.tasks[0]).not.toHaveProperty('cost');
    expect(viewOnlyProject.body.irrigation.network.components[0]).not.toHaveProperty('unitCost');
    expect(viewOnlyProject.body.irrigation.monthly[0]).not.toHaveProperty('cost');
    expect(viewOnlyProject.body.collaboration.share).toEqual(expect.objectContaining({ enabled: true, mode: 'view', includeCosts: false }));
    expect(viewOnlyProject.body.collaboration.share).not.toHaveProperty('tokenVersion');
    expect(viewOnlyProject.body).not.toHaveProperty('analysis');
    await request(app).post(`/api/shared/projects/${viewToken}/comments`).send({
      authorName: 'Read-only visitor',
      message: 'This must not be stored.',
    }).expect(403);
    await request(app).post(`/api/shared/projects/${viewToken}/review`).send({
      status: 'approved',
      reviewerName: 'Read-only visitor',
    }).expect(403);
    expect(project.collaboration.comments).toHaveLength(0);
    expect(project.collaboration.review).toBeNull();

    const shared = await request(app).post(`/api/projects/${project.id}/share`).set('Cookie', cookie).send({
      mode: 'review',
      includeCosts: true,
      expiresAt: '2026-08-26T10:00:00.000Z',
    }).expect(200);
    expect(shared.body).toEqual(expect.objectContaining({ enabled: true, mode: 'review', includeCosts: true, path: expect.stringMatching(/^\/shared\//) }));
    const token = shared.body.path.split('/').pop();
    const publicRead = await request(app).get(`/api/shared/projects/${token}`).expect(200);
    expect(publicRead.body.economicConfiguration).toEqual(expect.objectContaining({ currencyCode: economics.currencyCode }));
    expect(publicRead.body.costs).toEqual(expect.objectContaining({ totalCost: costs.totalCost }));
    expect(publicRead.body.irrigation.economics).toEqual(expect.objectContaining({ currencyCode: economics.currencyCode }));
    expect(publicRead.body.collaboration.share).not.toHaveProperty('tokenVersion');
    expect(publicRead.body).not.toHaveProperty('analysis');

    const commented = await request(app).post(`/api/shared/projects/${token}/comments`).send({
      authorName: 'Field reviewer',
      message: 'Confirm vehicle turning space here.',
      coordinate: { lat: 37.01, lng: 14.01 },
      target: 'firebreak',
    }).expect(200);
    expect(commented.body.collaboration.comments).toHaveLength(1);
    const approved = await request(app).post(`/api/shared/projects/${token}/review`).send({
      status: 'approved',
      reviewerName: 'Field reviewer',
      note: 'Approved subject to local AIB verification.',
    }).expect(200);
    expect(approved.body.collaboration.review.status).toBe('approved');
    expect(project.collaboration.comments).toHaveLength(1);
    expect(project.collaboration.review?.status).toBe('approved');

    await request(app).delete(`/api/projects/${project.id}/share`).set('Cookie', cookie).expect(200);
    await request(app).get(`/api/shared/projects/${token}`).expect(404);
  });
});
