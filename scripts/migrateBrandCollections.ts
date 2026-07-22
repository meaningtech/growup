import { readFileSync } from 'node:fs';
import { MongoClient, type AnyBulkWriteOperation, type Document } from 'mongodb';

const MONGO_HOST = 'b062e978-4d93-4760-9d00-907071c84bbe.europe-west1.firestore.goog';
const DATABASE = 'solaraf';
const BATCH_SIZE = 100;
const COLLECTIONS = [
  ['growaf_users', 'growup_users'],
  ['growaf_projects', 'growup_projects'],
  ['growaf_project_revisions', 'growup_project_revisions'],
  ['growaf_calculation_runs', 'growup_calculation_runs'],
] as const;

const uriFile = process.env.GROWUP_MONGODB_URI_FILE?.trim();
if (!uriFile) throw new Error('GROWUP_MONGODB_URI_FILE must reference a protected file containing the existing Mongo URI.');
const uri = readFileSync(uriFile, 'utf8').trim();
const parsed = new URL(uri);
if (parsed.protocol !== 'mongodb:' || parsed.hostname !== MONGO_HOST || parsed.pathname !== `/${DATABASE}`) {
  throw new Error('The migration URI must target the configured existing Firestore Enterprise database.');
}

const client = new MongoClient(uri, {
  maxPoolSize: 4,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
});

try {
  await client.connect();
  const database = client.db(DATABASE);
  const report: Array<{ source: string; target: string; sourceCount: number; targetBefore: number; targetAfter: number; copied: number }> = [];

  for (const [sourceName, targetName] of COLLECTIONS) {
    const source = database.collection<Document>(sourceName);
    const target = database.collection<Document>(targetName);
    await assertIdIndex(sourceName, source.listIndexes().toArray());
    await assertIdIndex(targetName, target.listIndexes().toArray());
    const sourceCount = await source.estimatedDocumentCount();
    const targetBefore = await target.estimatedDocumentCount();
    let copied = 0;
    let operations: AnyBulkWriteOperation<Document>[] = [];

    for await (const document of source.find({}, { batchSize: BATCH_SIZE })) {
      operations.push({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } });
      if (operations.length < BATCH_SIZE) continue;
      const result = await target.bulkWrite(operations, { ordered: false });
      copied += result.upsertedCount + result.modifiedCount + result.matchedCount;
      operations = [];
    }
    if (operations.length) {
      const result = await target.bulkWrite(operations, { ordered: false });
      copied += result.upsertedCount + result.modifiedCount + result.matchedCount;
    }

    const targetAfter = await target.estimatedDocumentCount();
    if (targetAfter < sourceCount) throw new Error(`Brand migration incomplete for ${targetName}: ${targetAfter}/${sourceCount} documents.`);
    report.push({ source: sourceName, target: targetName, sourceCount, targetBefore, targetAfter, copied });
  }

  console.log(JSON.stringify({ database: DATABASE, collections: report }, null, 2));
} finally {
  await client.close();
}

async function assertIdIndex(collection: string, indexesPromise: Promise<Array<{ key?: unknown; unique?: boolean }>>) {
  const indexes = await indexesPromise;
  const ready = indexes.some((index) => {
    const entries = Object.entries(index.key as Record<string, unknown> ?? {});
    return entries.length === 1 && entries[0]?.[0] === '_id' && Number(entries[0]?.[1]) === 1 && index.unique === true;
  });
  if (!ready) throw new Error(`Required unique _id index is not ready for ${collection}.`);
}
