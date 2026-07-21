import { MongoClient, type Collection, type Db, type IndexDescriptionInfo } from 'mongodb';
import type { ProjectState, SiteBoundary, SiteValidation } from '../src/types.js';
import { normalizeEconomicConfiguration } from '../src/data/economicProfiles.js';
import { normalizeIrrigationConfiguration } from '../src/lib/irrigation.js';
import { normalizeSiteBoundary } from '../src/lib/siteGeometry.js';

const EXISTING_MONGO_HOST = 'b062e978-4d93-4760-9d00-907071c84bbe.europe-west1.firestore.goog';
const EXISTING_MONGO_DATABASE = 'solaraf';
const USERS_COLLECTION = 'growaf_users';
const PROJECTS_COLLECTION = 'growaf_projects';

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
  saveProject: (ownerUserId: string, project: ProjectState) => Promise<ProjectState>;
};

type UserDocument = Omit<GrowafUser, 'id'> & { _id: string };
type ProjectDocument = {
  _id: string;
  ownerUserId: string;
  name: string;
  state: ProjectState;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
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
  assertIndex(userIndexes, { _id: 1 }, true, USERS_COLLECTION);
  assertIndex(userIndexes, { email: 1 }, true, USERS_COLLECTION);
  assertIndex(projectIndexes, { _id: 1 }, true, PROJECTS_COLLECTION);
  assertIndex(projectIndexes, { ownerUserId: 1, updatedAt: -1 }, false, PROJECTS_COLLECTION);
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
  return document ? normalizeProject(document.state) : null;
}

export async function listProjects(ownerUserId: string): Promise<ProjectSummary[]> {
  const documents = await projects().then((collection) => collection
    .find({ ownerUserId }, { projection: { _id: 1, name: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray());
  return documents.map((document) => ({ id: document._id, name: document.name, updatedAt: document.updatedAt }));
}

export async function saveProject(ownerUserId: string, project: ProjectState): Promise<ProjectState> {
  const normalized = normalizeProject(project);
  const collection = await projects();
  const existing = await collection.findOne({ _id: normalized.id }, { projection: { ownerUserId: 1 } });
  if (existing && existing.ownerUserId !== ownerUserId) throw databaseError(403, 'PROJECT_OWNERSHIP_MISMATCH', 'This project belongs to another Growaf user.');
  await collection.updateOne(
    { _id: normalized.id, ownerUserId },
    {
      $set: {
        name: normalized.name,
        state: normalized,
        schemaVersion: 1,
        updatedAt: normalized.updatedAt,
      },
      $setOnInsert: { createdAt: normalized.createdAt },
    },
    { upsert: true },
  );
  return normalized;
}

async function users(): Promise<Collection<UserDocument>> {
  return (await mongoDatabase()).collection<UserDocument>(USERS_COLLECTION);
}

async function projects(): Promise<Collection<ProjectDocument>> {
  return (await mongoDatabase()).collection<ProjectDocument>(PROJECTS_COLLECTION);
}

async function indexes<T extends object>(collection: Collection<T>): Promise<IndexDescriptionInfo[]> {
  try {
    return await collection.listIndexes().toArray();
  } catch {
    return [];
  }
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
