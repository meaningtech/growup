import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('growup:test:onboarding-reset')) return;
    window.localStorage.removeItem('growup:onboarding:v1');
    window.sessionStorage.setItem('growup:test:onboarding-reset', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.querySelector('.app-shell')) && !document.querySelector('.toast .spin'));
});

test('guides a first-time visitor into a resumable project setup', async ({ page }) => {
  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toContainText('Turn a field into a buildable plan.');
  await tour.getByLabel('Project name').fill('North field transition');
  await tour.getByRole('button', { name: 'Create my project' }).click();
  await expect(tour).toContainText('Start from the right place.');
  await expect(tour.getByRole('button', { name: 'Select a specific place first' })).toBeDisabled();
  await expect(tour).toContainText('Select a specific search result or enter exact coordinates.');
  await page.reload();
  await expect(tour).toContainText('Start from the right place.');
  await expect(page.getByLabel('Project name')).toHaveValue('North field transition');
  await tour.locator('.onboarding-skip').click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Tour' }).click();
  await expect(tour).toContainText('Turn a field into a buildable plan.');
});

test('keeps the tour usable on a narrow mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toBeVisible();
  const box = await tour.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await tour.getByLabel('Project name').fill('Mobile field');
  await tour.getByRole('button', { name: 'Create my project' }).click();
  await expect(tour.getByRole('button', { name: 'Select a specific place first' })).toBeDisabled();
  await expect.poll(async () => {
    const searchBox = await page.getByLabel('Search place or address').boundingBox();
    return searchBox && searchBox.y >= 0 ? searchBox.y + searchBox.height : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(800);
  const toastClose = page.locator('.toast button');
  if (await toastClose.count() === 1 && await toastClose.isVisible()) await toastClose.click();
  await page.screenshot({ path: testInfo.outputPath('growup-checkpoint-mobile-location.png'), fullPage: false });
});

test('covers fire, costs, formal review and completion as explicit checkpoints', async ({ page }) => {
  await page.route('**/api/config', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      googleMapsApiKey: '',
      initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
      climatePeriod: '2021–2025',
      modelVersion: 'test',
      assistant: { configured: false, interface: 'openai-compatible' },
      auth: { configured: false, googleClientId: '' },
      sharing: { configured: false },
    },
  }));
  await page.evaluate(() => window.localStorage.setItem('growup:onboarding:v1', JSON.stringify({
    status: 'active',
    step: 'fire',
    updatedAt: '2026-07-27T12:00:00.000Z',
    projectName: 'Complete flow field',
  })));
  await page.reload();

  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toContainText('Guided setup · 8 of 12');
  await expect(tour).toContainText('Read fire conditions before planning operations.');
  await tour.getByRole('button', { name: /Continue to project costs/ }).click();
  await expect(tour).toContainText('Guided setup · 9 of 12');
  await expect(tour).toContainText('Check every economic assumption.');
  await tour.getByRole('button', { name: /Continue to final analysis/ }).click();
  await expect(tour).toContainText('Guided setup · 10 of 12');
  await expect(tour).toContainText('Run the formal coherence gate.');
  await tour.getByRole('button', { name: /Continue to planting care/ }).click();
  await expect(tour).toContainText('Guided setup · 11 of 12');
  await expect(tour).toContainText('Read when and how to plant.');
  await tour.getByRole('button', { name: /Continue to finish/ }).click();
  await expect(tour).toContainText('Guided setup · 12 of 12');
  await expect(tour).toContainText('Your first project is ready.');
  await tour.getByRole('button', { name: 'Finish tour' }).click();
  await expect(tour).toHaveCount(0);
});

test('shows a clear blocking loader while a workspace calculation is running', async ({ page }) => {
  await page.getByTestId('onboarding-tour').locator('.onboarding-close').click();
  await page.route('**/api/catalog/search**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0 }),
    });
  });
  await page.getByTestId('step-species').click();
  await page.getByLabel('Search scientific catalogue').fill('olive');
  await page.locator('.catalogue-search').getByRole('button', { name: 'Search' }).click();

  const loader = page.getByTestId('workspace-loader');
  await expect(loader).toBeVisible();
  await expect(loader).toContainText('Searching the evidence catalogue');
  await expect(loader).toContainText('Keep this page open. This state will clear automatically when the result is ready.');
  await expect(loader).toHaveCount(0, { timeout: 5_000 });
});
