import { expect, test } from '@playwright/test';

test.describe('unsigned phone information page', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('shows only the information page, sources and disclaimer', async ({ page }, testInfo) => {
    await page.goto('/');
    const landing = page.getByTestId('info-landing');
    await expect(landing).toBeVisible();
    const panel = page.getByTestId('info-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.map-stage')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close information' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    await expect(panel).not.toHaveAttribute('role', 'dialog');

    await expect(panel.getByRole('heading', { name: 'Data driven agroforestry planning.' })).toBeVisible();
    await expect(panel).toContainText('Read the land');
    await expect(panel).toContainText('Design the system');
    await expect(panel).toContainText('Prepare implementation');
    await expect(panel.getByRole('heading', { name: 'Where the numbers come from' })).toBeVisible();
    await expect(panel).toContainText('Open-Meteo Historical Weather API');
    await expect(panel).toContainText('ISRIC SoilGrids');
    await expect(panel).toContainText('Copernicus Sentinel-2 L2A');
    await expect(panel).toContainText('NASA GIBS');
    await expect(panel).toContainText('EFFIS Fire Weather Index');
    await expect(panel).toContainText('GrowUp supports planning decisions');
    await expect(panel.getByRole('link', { name: /GrowUp is open source/ })).toHaveAttribute('href', 'https://github.com/meaningtech/growup');
    await expect(page.getByTestId('topbar-account')).toHaveAttribute('aria-label', 'Sign in');

    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThanOrEqual(1);
    expect(bounds!.y).toBeGreaterThanOrEqual(59);
    expect(bounds!.width).toBeGreaterThanOrEqual(380);
    expect(bounds!.height).toBeGreaterThan(700);

    await page.screenshot({ path: testInfo.outputPath('growup-info-phone.png'), fullPage: false });
    await panel.getByText('GrowUp supports planning decisions').scrollIntoViewIfNeeded();
    await expect(panel.getByText('GrowUp supports planning decisions')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('growup-info-phone-disclaimer.png'), fullPage: false });

    await page.getByRole('button', { name: 'Italiano' }).click();
    await expect(panel.getByRole('heading', { name: 'Progettazione agroforestale guidata dai dati.' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Da dove arrivano i numeri' })).toBeVisible();
    await expect(panel).toContainText('GrowUp supporta le decisioni di progetto');

    await page.getByRole('button', { name: 'Accedi' }).click();
    await expect(page.getByRole('dialog', { name: 'Tutti i progetti dei terreni, insieme.' })).toBeVisible();
  });

  test('does not replace a public shared project with the information page', async ({ page }) => {
    await page.route('**/api/shared/projects/phone-share-token', (route) => route.fulfill({
      status: 404,
      contentType: 'application/json',
      json: { error: 'Shared project is unavailable' },
    }));
    await page.goto('/shared/phone-share-token');
    await expect(page.getByTestId('info-landing')).toHaveCount(0);
    await expect(page.locator('.shared-error')).toBeVisible();
  });
});

test.describe('signed-in phone library', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('shows the project library instead of the planning editor', async ({ page }, testInfo) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: {
      googleMapsApiKey: '',
      initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
      climatePeriod: '2021-01-01 to 2025-12-31',
      modelVersion: 'phone-auth-test',
      assistant: { configured: false, interface: 'openai-compatible' },
      auth: { configured: true, googleClientId: 'phone-test.apps.googleusercontent.com' },
      sharing: { configured: false },
    } }));
    await page.route('**/api/catalog/stats', (route) => route.fulfill({ json: {
      total: 51,
      treeLike: 51,
      globUnt: 0,
      designReady: 51,
    } }));
    await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
      authenticated: true,
      configured: true,
      user: {
        id: 'phone-user',
        email: 'phone@example.test',
        name: 'Phone User',
        pictureUrl: null,
        locale: 'en',
        preferences: {},
      },
    } }));
    await page.route('**/api/projects', (route) => route.fulfill({ json: [
      { id: 'lanterna', name: 'Lanterna', updatedAt: '2026-07-27T09:00:00.000Z', archivedAt: null },
    ] }));
    await page.goto('/');
    await expect(page.getByTestId('phone-library')).toBeVisible();
    await expect(page.getByTestId('info-landing')).toHaveCount(0);
    await expect(page.locator('.map-stage')).toHaveCount(0);
    await expect(page.getByTestId('step-site')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
    await expect(page.locator('.phone-planning-note')).toContainText('Planning stays on a computer.');
    await expect(page.getByRole('button', { name: 'Open Lanterna' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('growup-phone-library.png'), fullPage: false });
  });
});
