import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  getProjectRevision,
  getCalculationRun,
  getUser,
  listProjectRevisions,
  listProjects,
  mongoDatabase,
  mongoHealth,
  saveProject,
  upsertUser,
} from './mongo.js';

const mongoUriFile = process.env.GROWUP_MONGODB_URI_FILE?.trim();
if (!process.env.MONGODB_URI && mongoUriFile) process.env.MONGODB_URI = readFileSync(mongoUriFile, 'utf8').trim();
const sessionSecretFile = process.env.GROWUP_AUTH_SESSION_SECRET_FILE?.trim();
if (!process.env.AUTH_SESSION_SECRET && sessionSecretFile) process.env.AUTH_SESSION_SECRET = readFileSync(sessionSecretFile, 'utf8').trim();
const runLive = process.env.GROWUP_LIVE_MONGO_TEST === '1';

describe.runIf(runLive)('existing Mongo live persistence integration', () => {
  it('signs in, saves, lists and reopens an owner-isolated Growup project', async () => {
    const marker = `growup-live-${randomUUID()}`;
    const project: ProjectState = {
      id: marker,
      name: 'Growup live persistence test',
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
    const database = { health: mongoHealth, geometryMetrics, getUser, upsertUser, getProject, listProjects, listProjectRevisions, getProjectRevision, getCalculationRun, saveProject };
    const app = createApp({
      database,
      skipDatabaseMigration: true,
      googleOAuthClientId: 'growup-live.apps.googleusercontent.com',
      authSessionSecret: process.env.AUTH_SESSION_SECRET,
      verifyGoogleToken: async () => ({
        subject: marker,
        email: `${marker}@example.invalid`,
        name: 'Growup live test',
        pictureUrl: null,
        locale: 'en',
      }),
    });

    try {
      await assertMongoIndexesReady();
      const login = await request(app).post('/api/auth/google').send({ credential: 'live-test-token' }).expect(200);
      const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
      const saved = await request(app).put(`/api/projects/${marker}`).set('Cookie', cookie).send(project).expect(200);
      expect(saved.body.revision).toBe(1);
      const list = await request(app).get('/api/projects').set('Cookie', cookie).expect(200);
      expect(list.body).toContainEqual(expect.objectContaining({ id: marker, name: project.name }));
      const reopened = await request(app).get(`/api/projects/${marker}`).set('Cookie', cookie).expect(200);
      expect(reopened.body).toEqual(expect.objectContaining({ id: marker, name: project.name, revision: 1 }));
      const revisions = await request(app).get(`/api/projects/${marker}/revisions`).set('Cookie', cookie).expect(200);
      expect(revisions.body).toEqual([expect.objectContaining({ revision: 1 })]);
      const revision = await request(app).get(`/api/projects/${marker}/revisions/1`).set('Cookie', cookie).expect(200);
      expect(revision.body).toEqual(expect.objectContaining({ id: marker, revision: 1 }));
      const updated = { ...saved.body, name: 'Growup live persistence test · revised', updatedAt: new Date(Date.now() + 1_000).toISOString() };
      const savedAgain = await request(app).put(`/api/projects/${marker}`).set('Cookie', cookie).send(updated).expect(200);
      expect(savedAgain.body.revision).toBe(2);
      const immutableHistory = await request(app).get(`/api/projects/${marker}/revisions`).set('Cookie', cookie).expect(200);
      expect(immutableHistory.body.map((item: { revision: number }) => item.revision)).toEqual([2, 1]);
      const original = await request(app).get(`/api/projects/${marker}/revisions/1`).set('Cookie', cookie).expect(200);
      expect(original.body.name).toBe('Growup live persistence test');
      await request(app).put(`/api/projects/${marker}`).set('Cookie', cookie).send({ ...project, name: 'Stale overwrite attempt' }).expect(409);
      expect(await getProject('another-owner', marker)).toBeNull();

      const liveDatabase = await mongoDatabase();
      const projectPlan = JSON.stringify(await liveDatabase.collection('growup_projects').find({ ownerUserId: marker }).sort({ updatedAt: -1 }).limit(100).explain('executionStats'));
      const revisionPlan = JSON.stringify(await liveDatabase.collection('growup_project_revisions').find({ ownerUserId: marker, projectId: marker }).sort({ revision: -1 }).limit(200).explain('executionStats'));
      expect(projectPlan).not.toMatch(/COLLSCAN|collection scan/i);
      expect(revisionPlan).not.toMatch(/COLLSCAN|collection scan/i);
      expect(projectPlan).toMatch(/index/i);
      expect(revisionPlan).toMatch(/index/i);
    } finally {
      if (marker.startsWith('growup-live-')) {
        const database = await mongoDatabase();
        await database.collection<{ _id: string }>('growup_projects').deleteOne({ _id: marker });
        await database.collection<{ _id: string }>('growup_users').deleteOne({ _id: marker });
        await database.collection<{ ownerUserId: string }>('growup_project_revisions').deleteMany({ ownerUserId: marker });
        await database.collection<{ ownerUserId: string }>('growup_calculation_runs').deleteMany({ ownerUserId: marker });
      }
    }
  }, 60_000);
});
