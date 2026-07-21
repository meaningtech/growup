import { MongoClient, type Collection, type Db, type IndexDescriptionInfo } from 'mongodb';
import type { CalculationSnapshot, ProjectRevisionSummary, ProjectState, SiteBoundary, SiteValidation } from '../src/types.js';
import { normalizeEconomicConfiguration } from '../src/data/economicProfiles.js';
import { normalizeIrrigationConfiguration } from '../src/lib/irrigation.js';
import { normalizeSiteBoundary } from '../src/lib/siteGeometry.js';
import { buildRevisionArtifacts, projectContentHash } from './revisions.js';

const EXISTING_MONGO_HOST = 'b062e978-4d93-4760-9d00-907071c84bbe.europe-west1.firestore.goog';
const EXISTING_MONGO_DATABASE = 'solaraf';
const USERS_COLLECTION = 'growaf_users';
const PROJECTS_COLLECTION = 'growaf_projects';
const REVISIONS_COLLECTION = 'growaf_project_revisions';
const CALCULATION_RUNS_COLLECTION = 'growaf_calculation_runs';

export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  locale: string | null;
};

export type GrowafUser = {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  locale: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type ProjectSummary = Pick<ProjectState, 'id' | 'name' | 'updatedAt'>;

export type GrowafDatabase = {
  health: () => Promise<boolean>;
  geometryMetrics: (site: SiteBoundary) => Promise<SiteValidation>;
  getUser: (id: string) => Promise<GrowafUser | null>;
  upsertUser: (identity: GoogleIdentity) => Promise<GrowafUser>;
  getProject: (ownerUserId: string, id: string) => Promise<ProjectState | null>;
  listProjects: (ownerUserId: string) => Promise<ProjectSummary[]>;
  listProjectRevisions: (ownerUserId: string, projectId: string) => Promise<ProjectRevisionSummary[]>;
  getProjectRevision: (ownerUserId: string, projectId: string, revision: number) => Promise<ProjectState | null>;
  getCalculationRun: (ownerUserId: string, projectId: string, calculationRunId: string) => Promise<CalculationSnapshot | null>;
  saveProject: (ownerUserId: string, project: ProjectState) => Promise<ProjectState>;
};

type UserDocument = Omit<GrowafUser, 'id'> & { _id: string };
type ProjectDocument = {
  _id: string;
  ownerUserId: string;
  name: string;
  state: ProjectState;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};
type ProjectRevisionDocument = {
  _id: string;
  ownerUserId: string;
  projectId: string;
  revision: number;
  contentHash: string;
  calculationRunId: string | null;
  name: string;
  selectedVariantId: string | null;
  treeCount: number;
  state: ProjectState;
  createdAt: string;
};
type CalculationRunDocument = CalculationSnapshot & {
  _id: string;
  ownerUserId: string;
};

let client: MongoClient | null = null;
let database: Db | null = null;

export function existingMongoConnectionUri(): string {
  const value = process.env.MONGODB_URI?.trim();
  if (!value) throw new Error('MONGODB_URI is required for the existing Mongo-compatible database.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'mongodb:' || parsed.hostname !== EXISTING_MONGO_HOST || parsed.pathname !== `/${EXISTING_MONGO_DATABASE}`) {
    throw new Error('MONGODB_URI must target the configured existing Firestore Enterprise database.');
  }
  return value;
}

export async function mongoDatabase(): Promise<Db> {
  if (database) return database;
  client = new MongoClient(existingMongoConnectionUri(), {
    maxPoolSize: 12,
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });
  await client.connect();
  database = client.db(EXISTING_MONGO_DATABASE);
  return database;
}

export async function closeMongoConnection(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

export async function mongoHealth(): Promise<boolean> {
  try {
    await (await mongoDatabase()).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function assertMongoIndexesReady(): Promise<void> {
  const db = await mongoDatabase();
  const userIndexes = await indexes(db.collection<UserDocument>(USERS_COLLECTION));
  const projectIndexes = await indexes(db.collection<ProjectDocument>(PROJECTS_COLLECTION));
  const revisionIndexes = await indexes(db.collection<ProjectRevisionDocument>(REVISIONS_COLLECTION));
  const calculationIndexes = await indexes(db.collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION));
  assertIndex(userIndexes, { _id: 1 }, true, USERS_COLLECTION);
  assertIndex(userIndexes, { email: 1 }, true, USERS_COLLECTION);
  assertIndex(projectIndexes, { _id: 1 }, true, PROJECTS_COLLECTION);
  assertIndex(projectIndexes, { ownerUserId: 1, updatedAt: -1 }, false, PROJECTS_COLLECTION);
  assertIndex(revisionIndexes, { _id: 1 }, true, REVISIONS_COLLECTION);
  assertIndex(revisionIndexes, { ownerUserId: 1, projectId: 1, revision: -1 }, false, REVISIONS_COLLECTION);
  assertIndex(calculationIndexes, { _id: 1 }, true, CALCULATION_RUNS_COLLECTION);
  assertIndex(calculationIndexes, { ownerUserId: 1, projectId: 1, createdAt: -1 }, false, CALCULATION_RUNS_COLLECTION);
}

export async function ensureMongoIndexes(): Promise<void> {
  const db = await mongoDatabase();
  await ensureIndex(db.collection<UserDocument>(USERS_COLLECTION), { _id: 1 }, { unique: true, name: 'growaf_users_id_unique' });
  await ensureIndex(db.collection<UserDocument>(USERS_COLLECTION), { email: 1 }, { unique: true, sparse: true, name: 'growaf_users_email_unique' });
  await ensureIndex(db.collection<ProjectDocument>(PROJECTS_COLLECTION), { _id: 1 }, { unique: true, name: 'growaf_projects_id_unique' });
  await ensureIndex(db.collection<ProjectDocument>(PROJECTS_COLLECTION), { ownerUserId: 1, updatedAt: -1 }, { name: 'growaf_projects_owner_updated' });
  await ensureIndex(db.collection<ProjectRevisionDocument>(REVISIONS_COLLECTION), { _id: 1 }, { unique: true, name: 'growaf_revisions_id_unique' });
  await ensureIndex(db.collection<ProjectRevisionDocument>(REVISIONS_COLLECTION), { ownerUserId: 1, projectId: 1, revision: -1 }, { name: 'growaf_revisions_owner_project_revision' });
  await ensureIndex(db.collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION), { _id: 1 }, { unique: true, name: 'growaf_calculations_id_unique' });
  await ensureIndex(db.collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION), { ownerUserId: 1, projectId: 1, createdAt: -1 }, { name: 'growaf_calculations_owner_project_created' });
}

export async function getUser(id: string): Promise<GrowafUser | null> {
  const document = await users().then((collection) => collection.findOne({ _id: id }));
  return document ? userFromDocument(document) : null;
}

export async function upsertUser(identity: GoogleIdentity): Promise<GrowafUser> {
  const now = new Date().toISOString();
  const document = await users().then((collection) => collection.findOneAndUpdate(
    { _id: identity.subject },
    {
      $set: {
        email: identity.email,
        name: identity.name,
        pictureUrl: identity.pictureUrl,
        locale: identity.locale,
        updatedAt: now,
        lastLoginAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  ));
  if (!document) throw new Error('The Growaf user profile could not be stored.');
  return userFromDocument(document);
}

export async function getProject(ownerUserId: string, id: string): Promise<ProjectState | null> {
  const document = await projects().then((collection) => collection.findOne({ _id: id, ownerUserId }));
  return document ? normalizeProject({ ...document.state, revision: document.revision ?? document.state.revision ?? 0 }) : null;
}

export async function listProjects(ownerUserId: string): Promise<ProjectSummary[]> {
  const documents = await projects().then((collection) => collection
    .find({ ownerUserId }, { projection: { _id: 1, name: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray());
  return documents.map((document) => ({ id: document._id, name: document.name, updatedAt: document.updatedAt }));
}

export async function listProjectRevisions(ownerUserId: string, projectId: string): Promise<ProjectRevisionSummary[]> {
  const documents = await projectRevisions().then((collection) => collection
    .find(
      { ownerUserId, projectId },
      { projection: { _id: 1, revision: 1, contentHash: 1, calculationRunId: 1, name: 1, selectedVariantId: 1, treeCount: 1, createdAt: 1 } },
    )
    .sort({ revision: -1 })
    .limit(200)
    .toArray());
  return documents.map((document) => ({
    revision: document.revision,
    revisionId: document._id,
    calculationRunId: document.calculationRunId,
    createdAt: document.createdAt,
    contentHash: document.contentHash,
    name: document.name,
    selectedVariantId: document.selectedVariantId,
    treeCount: document.treeCount,
  }));
}

export async function getProjectRevision(ownerUserId: string, projectId: string, revision: number): Promise<ProjectState | null> {
  const document = await projectRevisions().then((collection) => collection.findOne({ ownerUserId, projectId, revision }));
  return document ? normalizeProject(document.state) : null;
}

export async function getCalculationRun(ownerUserId: string, projectId: string, calculationRunId: string): Promise<CalculationSnapshot | null> {
  const document = await calculationRuns().then((collection) => collection.findOne({ _id: calculationRunId, ownerUserId, projectId }));
  if (!document) return null;
  const { _id: _documentId, ownerUserId: _ownerUserId, ...snapshot } = document;
  return snapshot;
}

export async function saveProject(ownerUserId: string, project: ProjectState): Promise<ProjectState> {
  const normalized = normalizeProject(project);
  const collection = await projects();
  const existing = await collection.findOne({ _id: normalized.id });
  if (existing && existing.ownerUserId !== ownerUserId) throw databaseError(403, 'PROJECT_OWNERSHIP_MISMATCH', 'This project belongs to another Growaf user.');
  const currentRevision = existing?.revision ?? existing?.state.revision ?? 0;
  const expectedRevision = normalized.revision ?? 0;
  if (existing?.contentHash && existing.contentHash === projectContentHash(normalized)) return normalizeProject(existing.state);
  if (currentRevision !== expectedRevision) throw databaseError(409, 'PROJECT_REVISION_CONFLICT', `This project changed after revision ${expectedRevision}. Reload the latest revision before saving.`);
  const artifacts = buildRevisionArtifacts(ownerUserId, normalized, currentRevision + 1);
  const revisionDocument: ProjectRevisionDocument = {
    _id: artifacts.summary.revisionId,
    ownerUserId,
    projectId: normalized.id,
    revision: artifacts.summary.revision,
    contentHash: artifacts.summary.contentHash,
    calculationRunId: artifacts.summary.calculationRunId,
    name: artifacts.summary.name,
    selectedVariantId: artifacts.summary.selectedVariantId,
    treeCount: artifacts.summary.treeCount,
    state: artifacts.state,
    createdAt: artifacts.summary.createdAt,
  };
  let revisionInserted = false;
  let calculationInserted = false;
  try {
    await (await projectRevisions()).insertOne(revisionDocument);
    revisionInserted = true;
    if (artifacts.calculation) {
      await (await calculationRuns()).insertOne({ ...artifacts.calculation, _id: artifacts.calculation.id, ownerUserId });
      calculationInserted = true;
    }
    if (existing) {
      const update = await collection.updateOne(
        { _id: normalized.id, ownerUserId, revision: currentRevision },
        { $set: {
          name: artifacts.state.name,
          state: artifacts.state,
          schemaVersion: 2,
          revision: artifacts.summary.revision,
          contentHash: artifacts.summary.contentHash,
          updatedAt: artifacts.state.updatedAt,
        } },
      );
      if (update.matchedCount !== 1) throw databaseError(409, 'PROJECT_REVISION_CONFLICT', 'This project was updated concurrently. Reload before saving.');
    } else {
      await collection.insertOne({
        _id: normalized.id,
        ownerUserId,
        name: artifacts.state.name,
        state: artifacts.state,
        schemaVersion: 2,
        revision: artifacts.summary.revision,
        contentHash: artifacts.summary.contentHash,
        createdAt: artifacts.state.createdAt,
        updatedAt: artifacts.state.updatedAt,
      });
    }
  } catch (error) {
    if (revisionInserted) await (await projectRevisions()).deleteOne({ _id: artifacts.summary.revisionId, ownerUserId });
    if (calculationInserted && artifacts.calculation) await (await calculationRuns()).deleteOne({ _id: artifacts.calculation.id, ownerUserId });
    if (isDuplicateKeyError(error)) throw databaseError(409, 'PROJECT_REVISION_CONFLICT', 'This project was updated concurrently. Reload before saving.');
    throw error;
  }
  return artifacts.state;
}

async function users(): Promise<Collection<UserDocument>> {
  return (await mongoDatabase()).collection<UserDocument>(USERS_COLLECTION);
}

async function projects(): Promise<Collection<ProjectDocument>> {
  return (await mongoDatabase()).collection<ProjectDocument>(PROJECTS_COLLECTION);
}

async function projectRevisions(): Promise<Collection<ProjectRevisionDocument>> {
  return (await mongoDatabase()).collection<ProjectRevisionDocument>(REVISIONS_COLLECTION);
}

async function calculationRuns(): Promise<Collection<CalculationRunDocument>> {
  return (await mongoDatabase()).collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION);
}

async function indexes<T extends object>(collection: Collection<T>): Promise<IndexDescriptionInfo[]> {
  try {
    return await collection.listIndexes().toArray();
  } catch {
    return [];
  }
}

async function ensureIndex<T extends object>(collection: Collection<T>, key: Record<string, 1 | -1>, options: { unique?: boolean; sparse?: boolean; name: string }) {
  const current = await indexes(collection);
  if (current.some((index) => sameKey(index.key as Record<string, unknown>, key) && (!options.unique || index.unique === true))) return;
  await collection.createIndex(key, options);
}

function assertIndex(indexesForCollection: IndexDescriptionInfo[], key: Record<string, 1 | -1>, unique: boolean, collection: string) {
  const found = indexesForCollection.some((index) => sameKey(index.key as Record<string, unknown>, key) && (!unique || index.unique === true));
  if (!found) throw new Error(`Required READY index missing for ${collection}: ${JSON.stringify(key)}`);
}

function sameKey(actual: Record<string, unknown>, expected: Record<string, 1 | -1>) {
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return actualEntries.length === expectedEntries.length && expectedEntries.every(([field, order], index) => (
    actualEntries[index]?.[0] === field && Number(actualEntries[index]?.[1]) === order
  ));
}

function userFromDocument(document: UserDocument): GrowafUser {
  return { id: document._id, email: document.email, name: document.name, pictureUrl: document.pictureUrl, locale: document.locale, createdAt: document.createdAt, updatedAt: document.updatedAt, lastLoginAt: document.lastLoginAt };
}

function normalizeProject(project: ProjectState): ProjectState {
  const countryCode = project.siteProfile?.location.countryCode ?? '';
  return {
    ...project,
    site: normalizeSiteBoundary(project.site),
    irrigationConfiguration: normalizeIrrigationConfiguration(project.irrigationConfiguration),
    economicConfiguration: normalizeEconomicConfiguration(project.economicConfiguration, countryCode),
  };
}

function databaseError(code: number, status: string, message: string) {
  return { code, status, message };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Number((error as { code?: unknown }).code) === 11000;
}
