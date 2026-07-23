import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.GROWUP_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:52174';
const browserChannel = process.env.GROWUP_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    ...(browserChannel ? { channel: browserChannel } : {}),
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [],
      origins: [{
        origin: baseURL,
        localStorage: [{
          name: 'growup:onboarding:v1',
          value: JSON.stringify({ status: 'skipped', step: 'welcome', updatedAt: '2026-07-22T00:00:00.000Z' }),
        }],
      }],
    },
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
