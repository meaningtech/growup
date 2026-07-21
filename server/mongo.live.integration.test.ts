import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation.js';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles.js';
import type { ProjectState } from '../src/types.js';
import { createApp } from './app.js';
import { geometryMetrics } from './db.js';
import {
  assertMongoIndexesReady,
  getProject,
  getUser,
  listProjects,
  mongoDatabase,
  mongoHealth,
  saveProject,
  upsertUser,
} from './mongo.js';

const runLive = process.env.GROWAF_LIVE_MONGO_TEST === '1';

describe.runIf(runLive)('existing Mongo live persistence integration', () => {
  it('signs in, saves, lists and reopens an owner-isolated Growaf project', async () => {
    const marker = `growaf-live-${randomUUID()}`;
    const project: ProjectState = {
      id: marker,
      name: 'Growaf live persistence test',
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const database = { health: mongoHealth, geometryMetrics, getUser, upsertUser, getProject, listProjects, saveProject };
    const app = createApp({
      database,
      skipDatabaseMigration: true,
      googleOAuthClientId: 'growaf-live.apps.googleusercontent.com',
      authSessionSecret: process.env.AUTH_SESSION_SECRET,
      verifyGoogleToken: async () => ({
        subject: marker,
        email: `${marker}@example.invalid`,
        name: 'Growaf live test',
        pictureUrl: null,
        locale: 'en',
      }),
    });

    try {
      await assertMongoIndexesReady();
      const login = await request(app).post('/api/auth/google').send({ credential: 'live-test-token' }).expect(200);
      const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
      await request(app).put(`/api/projects/${marker}`).set('Cookie', cookie).send(project).expect(200);
      const list = await request(app).get('/api/projects').set('Cookie', cookie).expect(200);
      expect(list.body).toContainEqual(expect.objectContaining({ id: marker, name: project.name }));
      const reopened = await request(app).get(`/api/projects/${marker}`).set('Cookie', cookie).expect(200);
      expect(reopened.body).toEqual(expect.objectContaining({ id: marker, name: project.name }));
      expect(await getProject('another-owner', marker)).toBeNull();
    } finally {
      if (marker.startsWith('growaf-live-')) {
        const database = await mongoDatabase();
        await database.collection<{ _id: string }>('growaf_projects').deleteOne({ _id: marker });
        await database.collection<{ _id: string }>('growaf_users').deleteOne({ _id: marker });
      }
    }
  });
});
