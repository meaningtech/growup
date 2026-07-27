import { expect, test } from '@playwright/test';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout';
import type { ProjectState } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';

test('creates a read-only project link from the library and exposes no mutation controls', async ({ page }) => {
  const now = '2026-07-27T10:00:00.000Z';
  const collaboration = defaultProjectCollaboration();
  const project: ProjectState = {
    id: 'read-only-project',
    name: 'Lanterna',
    site: TEMPERATE_OPEN_FIELD_FIXTURE,
    siteProfile: null,
    selectedSpeciesIds: [],
    designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
    irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
    economicConfiguration: defaultEconomicConfiguration(''),
    variants: [],
    selectedVariantId: null,
    timelineYear: 5,
    irrigation: null,
    costs: null,
    fireOperations: defaultFireOperationsPlan(now),
    analysis: null,
    collaboration,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const summary = { id: project.id, name: project.name, updatedAt: project.updatedAt, archivedAt: null };
  let submittedMode: string | null = null;

  await page.route('**/api/config', (route) => route.fulfill({ json: {
    googleMapsApiKey: '',
    initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
    climatePeriod: '2021-01-01 to 2025-12-31',
    modelVersion: 'sharing-test',
    assistant: { configured: false, interface: 'openai-compatible' },
    auth: { configured: true, googleClientId: 'sharing-test.apps.googleusercontent.com' },
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
      id: 'sharing-user',
      email: 'planner@example.test',
      name: 'Planner',
      pictureUrl: null,
      locale: 'en',
      preferences: {},
    },
  } }));
  await page.route('**/api/projects/read-only-project/share', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { enabled: false, project } });
      return;
    }
    const body = route.request().postDataJSON() as { mode: string };
    submittedMode = body.mode;
    project.collaboration.share = {
      enabled: true,
      mode: 'view',
      tokenVersion: 'server-only-token-version',
      createdAt: now,
      expiresAt: '2026-08-26T10:00:00.000Z',
    };
    await route.fulfill({ json: {
      enabled: true,
      mode: 'view',
      expiresAt: project.collaboration.share.expiresAt,
      path: '/shared/read-only-token',
      project,
    } });
  });
  await page.route('**/api/shared/projects/read-only-token', (route) => route.fulfill({ json: {
    ...project,
    collaboration: {
      ...project.collaboration,
      share: {
        enabled: true,
        mode: 'view',
        createdAt: now,
        expiresAt: '2026-08-26T10:00:00.000Z',
      },
    },
  } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [summary] }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Share Lanterna as read-only' }).click();
  const dialog = page.getByTestId('project-read-only-share');
  await expect(dialog).toContainText('No project changes are allowed');
  await expect(dialog).toContainText('cannot edit, comment, approve, save or overwrite');
  await dialog.getByRole('button', { name: 'Create read-only link' }).click();
  expect(submittedMode).toBe('view');
  await expect(dialog.getByRole('textbox', { name: 'Active share link' })).toHaveValue(`${new URL(page.url()).origin}/shared/read-only-token`);
  await expect(dialog).toContainText('View only');

  await page.goto('/shared/read-only-token');
  await expect(page.getByText('Read-only project map')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve revision' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0);
});
