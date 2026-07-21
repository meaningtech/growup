import 'dotenv/config';
import { initializeApp } from './app.js';

const port = Number(process.env.PORT || 8788);
const app = await initializeApp();

app.listen(port, '127.0.0.1', () => {
  console.log(`Growaf API listening on http://127.0.0.1:${port}`);
});
