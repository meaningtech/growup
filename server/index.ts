import 'dotenv/config';
import { initializeApp } from './app.js';

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || '127.0.0.1';
const app = await initializeApp({ skipDatabaseMigration: process.env.GROWUP_SKIP_DATABASE_MIGRATION === '1' });

app.listen(port, host, () => {
  console.log(`Growup listening on http://${host}:${port}`);
});
