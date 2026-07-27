import { expect, test } from '@playwright/test';
import { EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('starts with an empty editable workspace and no bundled local field', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByLabel('Project name')).toHaveValue('Untitled Growup project');
  await expect(page.getByText('No active field')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
  await expect(page.getByText('Import GeoJSON', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ragusa/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeDisabled();
  await expect(page.locator('.site-validation')).toHaveCount(0);
  await expect(page.locator('.map-badge')).toHaveCount(0);
  await expect(page.locator('.gm-style')).toBeVisible();
  await expect(page.getByText('Oops! Something went wrong.')).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveCSS('height', '60px');
  await expect(page.locator('.top-actions > button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  const menuBox = await page.getByRole('button', { name: 'Open menu' }).boundingBox();
  expect(menuBox).not.toBeNull();
  expect(1440 - (menuBox!.x + menuBox!.width)).toBeLessThanOrEqual(10);

  const config = await (await page.request.get('/api/config')).json();
  expect(config).not.toHaveProperty('defaultSite');
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-initial-empty.png', fullPage: false });

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('Google Maps JavaScript API has been loaded directly')), consoleErrors.join('\n')).toEqual([]);
});

test('clears the active field only after confirmation and can undo the deletion', async ({ page }) => {
  await page.goto('/');
  await importSiteFixture(page, EQUATORIAL_OPEN_FIELD_FIXTURE);
  await expect(page.getByText(EQUATORIAL_OPEN_FIELD_FIXTURE.name)).toBeVisible();

  await page.getByRole('button', { name: 'Clear field' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Clear this field from the workspace?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(EQUATORIAL_OPEN_FIELD_FIXTURE.name)).toBeVisible();

  await page.getByRole('button', { name: 'Clear field' }).click();
  await dialog.getByRole('button', { name: 'Clear field' }).click();
  await expect(page.getByText('No active field')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo site' })).toBeEnabled();

  await page.getByRole('button', { name: 'Undo site' }).click();
  await expect(page.getByText(EQUATORIAL_OPEN_FIELD_FIXTURE.name)).toBeVisible();
});

test('shows a crosshair, progressive geometry and a numbered marker for every field point', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(page.locator('.map-stage')).toHaveClass(/drawing/);
  await expect(page.locator('.map-canvas')).toHaveCSS('cursor', 'crosshair');
  await expect(page.getByText('0 points placed')).toBeVisible();

  const points = [
    { lat: 1.08120, lng: 34.18120 },
    { lat: 1.08180, lng: 34.18145 },
    { lat: 1.08130, lng: 34.18195 },
  ];
  for (let index = 0; index < points.length; index += 1) {
    await page.getByLabel('Coordinate latitude').fill(String(points[index].lat));
    await page.getByLabel('Coordinate longitude').fill(String(points[index].lng));
    await page.getByRole('button', { name: 'Add coordinate' }).click();
    await expect(page.getByText(`${index + 1} points placed`)).toBeVisible();
  }
  await expect(page.getByText('Ready: use the check button to finish')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-drawing.png', fullPage: false });

  await page.getByRole('button', { name: 'Finish geometry' }).click();
  await expect(page.getByText('Authoritative user-defined boundary')).toBeVisible();
  await expect(page.locator('.site-validation')).toBeVisible();
});
