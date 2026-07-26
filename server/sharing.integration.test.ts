import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout';
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
    let project: ProjectState = {
      id: 'shared-project',
      name: 'Shared project',
      site: TEMPERATE_OPEN_FIELD_FIXTURE,
      siteProfile: null,
      selectedSpeciesIds: [],
      designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
      irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
      economicConfiguration: defaultEconomicConfiguration(''),
      variants: [],
      selectedVariantId: null,
      timelineYear: 5,
      irrigation: null,
      costs: null,
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
      listProjects: async () => [{ id: project.id, name: project.name, updatedAt: project.updatedAt }],
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
    const shared = await request(app).post(`/api/projects/${project.id}/share`).set('Cookie', cookie).send({
      mode: 'review',
      expiresAt: '2026-08-26T10:00:00.000Z',
    }).expect(200);
    expect(shared.body).toEqual(expect.objectContaining({ enabled: true, mode: 'review', path: expect.stringMatching(/^\/shared\//) }));
    const token = shared.body.path.split('/').pop();
    const publicRead = await request(app).get(`/api/shared/projects/${token}`).expect(200);
    expect(publicRead.body.collaboration.share).not.toHaveProperty('tokenVersion');

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
