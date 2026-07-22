import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.GROWUP_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:52174';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev:test',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
