import { expect, test } from '@playwright/test';

test('opens a full-page searchable project library and archives projects reversibly', async ({ page }) => {
  const projects = [
    { id: 'lanterna', name: 'Lanterna', updatedAt: '2026-07-27T09:00:00.000Z', archivedAt: null },
    { id: 'costa-verde', name: 'Costa Verde', updatedAt: '2026-07-26T09:00:00.000Z', archivedAt: null },
    { id: 'old-field', name: 'Old Field', updatedAt: '2026-06-20T09:00:00.000Z', archivedAt: '2026-07-01T09:00:00.000Z' },
  ];
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    googleMapsApiKey: '',
    initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
    climatePeriod: '2021-01-01 to 2025-12-31',
    modelVersion: 'projects-test',
    assistant: { configured: false, interface: 'openai-compatible' },
    auth: { configured: true, googleClientId: 'projects-test.apps.googleusercontent.com' },
    sharing: { configured: true },
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
      id: 'projects-user',
      email: 'planner@example.test',
      name: 'Planner',
      pictureUrl: null,
      locale: 'en',
      preferences: {},
    },
  } }));
  await page.route('**/api/projects/*/archive', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const input = route.request().postDataJSON() as { archived: boolean };
    const project = projects.find((item) => item.id === id)!;
    project.archivedAt = input.archived ? '2026-07-27T10:00:00.000Z' : null;
    await route.fulfill({ json: project });
  });
  await page.route('**/api/projects', (route) => route.fulfill({ json: projects }));
  await page.goto('/');

  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const library = page.getByTestId('projects-page');
  await expect(library).toBeVisible();
  await expect(library.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(library).not.toHaveAttribute('role', 'dialog');
  const pageBox = await library.boundingBox();
  expect(pageBox).not.toBeNull();
  expect(pageBox!.width).toBeGreaterThanOrEqual(1400);
  expect(pageBox!.height).toBeGreaterThanOrEqual(890);

  const search = page.getByRole('textbox', { name: 'Search projects' });
  await search.fill('Lanterna');
  await expect(page.getByRole('button', { name: 'Open Lanterna' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Costa Verde' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear project search' }).click();

  await page.getByRole('button', { name: 'Archive Costa Verde' }).click();
  await expect(page.getByRole('button', { name: 'Open Costa Verde' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Archived/ }).click();
  await expect(page.getByRole('button', { name: 'Open Costa Verde' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Old Field' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Costa Verde' }).click();
  await expect(page.getByRole('button', { name: 'Open Costa Verde' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Active/ }).click();
  await expect(page.getByRole('button', { name: 'Open Costa Verde' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await library.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.width).toBe(390);
  expect(mobileBox!.height).toBe(844);
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  await expect(library.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(library.getByRole('button', { name: 'New project' })).toContainText('New project');

  await library.getByRole('button', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(library).toHaveCount(0);
  await expect(page.getByTestId('step-site')).toHaveAttribute('class', /active/);
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Close projects' }).click();
  await expect(page).toHaveURL(/\/$/);
});
