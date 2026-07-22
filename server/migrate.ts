import 'dotenv/config';
import { databasePool, migrateDatabase } from './db.js';

await migrateDatabase();
await databasePool().end();
console.log('Growup PostGIS schema is ready');
