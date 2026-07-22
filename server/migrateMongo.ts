import 'dotenv/config';
import { assertMongoIndexesReady, closeMongoConnection, ensureMongoIndexes } from './mongo.js';

await ensureMongoIndexes();
await assertMongoIndexesReady();
await closeMongoConnection();
console.log('Growup Mongo-compatible indexes are READY');
