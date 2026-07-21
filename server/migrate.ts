import 'dotenv/config';
import { databasePool, migrateDatabase } from './db.js';

await migrateDatabase();
await databasePool().end();
console.log('Growaf PostGIS schema is ready');
