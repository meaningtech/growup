import { MongoClient, type Collection, type Db, type IndexDescriptionInfo } from 'mongodb';
import type { CalculationSnapshot, ProjectRevisionSummary, ProjectState, SiteBoundary, SiteValidation } from '../src/types.js';
import { normalizeEconomicConfiguration } from '../src/data/economicProfiles.js';
import { normalizeProjectCollaboration } from '../src/lib/collaboration.js';
import { disabledFirebreakPlan } from '../src/lib/firebreak.js';
import { normalizeFireOperationsPlan } from '../src/lib/fireOperations.js';
import { normalizeHarvestPlan } from '../src/lib/harvest.js';
import { normalizeOperationsPlan } from '../src/lib/operations.js';
import { normalizeIrrigationConfiguration } from '../src/lib/irrigation.js';
import { normalizeDesignConfiguration } from '../src/lib/layout.js';
import { normalizeSiteBoundary } from '../src/lib/siteGeometry.js';
import { normalizeUserSpecies } from '../src/lib/userCatalogue.js';
import { buildRevisionArtifacts, projectContentHash } from './revisions.js';

const EXISTING_MONGO_HOST = 'b062e978-4d93-4760-9d00-907071c84bbe.europe-west1.firestore.goog';
const EXISTING_MONGO_DATABASE = 'solaraf';
const USERS_COLLECTION = 'growup_users';
const PROJECTS_COLLECTION = 'growup_projects';
const REVISIONS_COLLECTION = 'growup_project_revisions';
const CALCULATION_RUNS_COLLECTION = 'growup_calculation_runs';

export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  locale: string | null;
};

export type OnboardingPreference = {
  status: 'active' | 'skipped' | 'completed';
  step: 'welcome' | 'location' | 'boundary' | 'analysis' | 'species' | 'design' | 'water' | 'fire' | 'costs' | 'review' | 'care' | 'complete';
  updatedAt: string;
  projectName?: string;
};

export type GrowupUserPreferences = {
  onboarding?: OnboardingPreference;
};

export type GrowupUser = {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  locale: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  preferences: GrowupUserPreferences;
};

export type ProjectSummary = Pick<ProjectState, 'id' | 'name' | 'updatedAt'> & { archivedAt: string | null };

export type GrowupDatabase = {
  health: () => Promise<boolean>;
  geometryMetrics: (site: SiteBoundary) => Promise<SiteValidation>;
  getUser: (id: string) => Promise<GrowupUser | null>;
  upsertUser: (identity: GoogleIdentity) => Promise<GrowupUser>;
  updateUserOnboarding: (id: string, preference: OnboardingPreference) => Promise<GrowupUser>;
  getProject: (ownerUserId: string, id: string) => Promise<ProjectState | null>;
  getSharedProject: (id: string) => Promise<{ ownerUserId: string; project: ProjectState } | null>;
  listProjects: (ownerUserId: string) => Promise<ProjectSummary[]>;
  setProjectArchived: (ownerUserId: string, id: string, archivedAt: string | null) => Promise<ProjectSummary>;
  listProjectRevisions: (ownerUserId: string, projectId: string) => Promise<ProjectRevisionSummary[]>;
  getProjectRevision: (ownerUserId: string, projectId: string, revision: number) => Promise<ProjectState | null>;
  getCalculationRun: (ownerUserId: string, projectId: string, calculationRunId: string) => Promise<CalculationSnapshot | null>;
  saveProject: (ownerUserId: string, project: ProjectState) => Promise<ProjectState>;
};

type UserDocument = Omit<GrowupUser, 'id'> & { _id: string };
type ProjectDocument = {
  _id: string;
  ownerUserId: string;
  name: string;
  state: ProjectState;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  archivedAt?: string | null;
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
  await ensureIndex(db.collection<UserDocument>(USERS_COLLECTION), { _id: 1 }, { unique: true, name: 'growup_users_id_unique' });
  await ensureIndex(db.collection<UserDocument>(USERS_COLLECTION), { email: 1 }, { unique: true, sparse: true, name: 'growup_users_email_unique' });
  await ensureIndex(db.collection<ProjectDocument>(PROJECTS_COLLECTION), { _id: 1 }, { unique: true, name: 'growup_projects_id_unique' });
  await ensureIndex(db.collection<ProjectDocument>(PROJECTS_COLLECTION), { ownerUserId: 1, updatedAt: -1 }, { name: 'growup_projects_owner_updated' });
  await ensureIndex(db.collection<ProjectRevisionDocument>(REVISIONS_COLLECTION), { _id: 1 }, { unique: true, name: 'growup_revisions_id_unique' });
  await ensureIndex(db.collection<ProjectRevisionDocument>(REVISIONS_COLLECTION), { ownerUserId: 1, projectId: 1, revision: -1 }, { name: 'growup_revisions_owner_project_revision' });
  await ensureIndex(db.collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION), { _id: 1 }, { unique: true, name: 'growup_calculations_id_unique' });
  await ensureIndex(db.collection<CalculationRunDocument>(CALCULATION_RUNS_COLLECTION), { ownerUserId: 1, projectId: 1, createdAt: -1 }, { name: 'growup_calculations_owner_project_created' });
}

export async function getUser(id: string): Promise<GrowupUser | null> {
  const document = await users().then((collection) => collection.findOne({ _id: id }));
  return document ? userFromDocument(document) : null;
}

export async function upsertUser(identity: GoogleIdentity): Promise<GrowupUser> {
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
  if (!document) throw new Error('The Growup user profile could not be stored.');
  return userFromDocument(document);
}

export async function updateUserOnboarding(id: string, preference: OnboardingPreference): Promise<GrowupUser> {
  const now = new Date().toISOString();
  const document = await users().then((collection) => collection.findOneAndUpdate(
    { _id: id },
    { $set: { 'preferences.onboarding': preference, updatedAt: now } },
    { returnDocument: 'after' },
  ));
  if (!document) throw databaseError(404, 'USER_NOT_FOUND', 'The Growup user profile was not found.');
  return userFromDocument(document);
}

export async function getProject(ownerUserId: string, id: string): Promise<ProjectState | null> {
  const document = await projects().then((collection) => collection.findOne({ _id: id, ownerUserId }));
  return document ? normalizeProject({ ...document.state, revision: document.revision ?? document.state.revision ?? 0 }) : null;
}

export async function getSharedProject(id: string): Promise<{ ownerUserId: string; project: ProjectState } | null> {
  const document = await projects().then((collection) => collection.findOne({ _id: id }));
  return document
    ? { ownerUserId: document.ownerUserId, project: normalizeProject({ ...document.state, revision: document.revision ?? document.state.revision ?? 0 }) }
    : null;
}

export async function listProjects(ownerUserId: string): Promise<ProjectSummary[]> {
  const documents = await projects().then((collection) => collection
    .find({ ownerUserId }, { projection: { _id: 1, name: 1, updatedAt: 1, archivedAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray());
  return documents.map((document) => ({ id: document._id, name: document.name, updatedAt: document.updatedAt, archivedAt: document.archivedAt ?? null }));
}

export async function setProjectArchived(ownerUserId: string, id: string, archivedAt: string | null): Promise<ProjectSummary> {
  const document = await projects().then((collection) => collection.findOneAndUpdate(
    { _id: id, ownerUserId },
    { $set: { archivedAt } },
    { returnDocument: 'after', projection: { _id: 1, name: 1, updatedAt: 1, archivedAt: 1 } },
  ));
  if (!document) throw databaseError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return { id: document._id, name: document.name, updatedAt: document.updatedAt, archivedAt: document.archivedAt ?? null };
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
  if (existing && existing.ownerUserId !== ownerUserId) throw databaseError(403, 'PROJECT_OWNERSHIP_MISMATCH', 'This project belongs to another Growup user.');
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
          schemaVersion: 4,
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
        schemaVersion: 4,
        revision: artifacts.summary.revision,
        contentHash: artifacts.summary.contentHash,
        archivedAt: null,
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

function userFromDocument(document: UserDocument): GrowupUser {
  return { id: document._id, email: document.email, name: document.name, pictureUrl: document.pictureUrl, locale: document.locale, createdAt: document.createdAt, updatedAt: document.updatedAt, lastLoginAt: document.lastLoginAt, preferences: document.preferences ?? {} };
}

function normalizeProject(project: ProjectState): ProjectState {
  const countryCode = project.siteProfile?.location.countryCode ?? '';
  const designConfiguration = normalizeDesignConfiguration(project.designConfiguration);
  const stableTimestamp = project.updatedAt || project.createdAt || new Date(0).toISOString();
  return {
    ...project,
    site: normalizeSiteBoundary(project.site),
    userSpecies: normalizeUserSpecies(project.userSpecies),
    designConfiguration,
    variants: project.variants.map((variant) => {
      const design = normalizeDesignConfiguration(variant.design);
      return { ...variant, design, firebreak: variant.firebreak ?? disabledFirebreakPlan(design.firebreak) };
    }),
    irrigationConfiguration: normalizeIrrigationConfiguration(project.irrigationConfiguration),
    economicConfiguration: normalizeEconomicConfiguration(project.economicConfiguration, countryCode),
    fireOperations: normalizeFireOperationsPlan(project.fireOperations, stableTimestamp),
    operations: normalizeOperationsPlan(project.operations),
    harvest: normalizeHarvestPlan(project.harvest),
    harvestPriceOverrides: project.harvestPriceOverrides ?? {},
    collaboration: normalizeProjectCollaboration(project.collaboration ?? {
      share: {
        enabled: false,
        mode: 'view',
        includeCosts: false,
        tokenVersion: `project-${project.id}`,
        createdAt: null,
        expiresAt: null,
      },
    }),
  };
}

function databaseError(code: number, status: string, message: string) {
  return { code, status, message };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && Number((error as { code?: unknown }).code) === 11000;
}
