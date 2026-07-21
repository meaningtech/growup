import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.GROWAF_BASE_URL ?? 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: process.env.GROWAF_BASE_URL ?? 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
