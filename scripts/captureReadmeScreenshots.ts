import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { siteFixtureGeoJson } from '../e2e/support/siteFixture';

const outputDirectory = resolve('docs/images');
const baseUrl = process.env.GROWUP_SCREENSHOT_URL ?? 'https://growup.earth';

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});

await context.addInitScript(() => {
  localStorage.setItem('growup.locale', 'en');
  localStorage.setItem('growup:onboarding:v1', JSON.stringify({
    status: 'skipped',
    step: 'welcome',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }));
});

const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('input[type="file"][accept*="geojson"]').setInputFiles({
  name: `${EQUATORIAL_OPEN_FIELD_FIXTURE.id}.geojson`,
  mimeType: 'application/geo+json',
  buffer: Buffer.from(JSON.stringify(siteFixtureGeoJson(EQUATORIAL_OPEN_FIELD_FIXTURE))),
});
await page.getByText(EQUATORIAL_OPEN_FIELD_FIXTURE.name).waitFor();
await page.screenshot({ path: resolve(outputDirectory, 'workspace-overview.png'), fullPage: false });
console.log('Captured docs/images/workspace-overview.png');

await page.locator('.mobile-menu-trigger').click();
await page.locator('.mobile-product-menu').getByRole('button', { name: 'Info', exact: true }).click();
await page.getByRole('heading', { name: 'Data driven agroforestry planning.' }).waitFor();
await page.screenshot({ path: resolve(outputDirectory, 'product-information.png'), fullPage: false });
console.log('Captured docs/images/product-information.png');

await browser.close();
