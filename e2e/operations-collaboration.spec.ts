import { expect, test, type Page } from '@playwright/test';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { firebreakConfigurationFromFuelModel } from '../src/data/firebreak';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from '../src/lib/layout';
import type { ProjectState } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { openFieldProfile } from '../test/fixtures/siteProfile';

const observedAt = '2026-07-26T10:00:00.000Z';

function projectFixture(): ProjectState {
  const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
  const species = DESIGN_SPECIES.slice(0, 5);
  const design = {
    ...DEFAULT_DESIGN_CONFIGURATION,
    firebreak: { ...firebreakConfigurationFromFuelModel('shrub-edge'), enabled: true },
  };
  const variants = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, design);
  return {
    id: 'operations-browser-project',
    name: 'Operations browser project',
    site: TEMPERATE_OPEN_FIELD_FIXTURE,
    siteProfile: profile,
    selectedSpeciesIds: species.map((item) => item.id),
    designConfiguration: design,
    irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
    economicConfiguration: defaultEconomicConfiguration(profile.location.countryCode ?? ''),
    variants,
    selectedVariantId: variants[0].id,
    timelineYear: 5,
    irrigation: null,
    costs: null,
    fireOperations: defaultFireOperationsPlan(observedAt),
    collaboration: defaultProjectCollaboration(),
    revision: 1,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

async function mockBase(page: Page, authenticated = false) {
  await page.route('**/api/config', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      googleMapsApiKey: '',
      initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
      climatePeriod: '2021–2025',
      modelVersion: 'test',
      assistant: { configured: false, interface: 'openai-compatible' },
      auth: { configured: authenticated, googleClientId: authenticated ? 'test.apps.googleusercontent.com' : '' },
      sharing: { configured: true },
    },
  }));
  await page.route('**/api/catalog/stats', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: { total: DESIGN_SPECIES.length, treeLike: DESIGN_SPECIES.length, globUnt: 0, designReady: DESIGN_SPECIES.length },
  }));
  await page.route('**/api/recommendations', async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { recommendations: [], palette: [] } }));
  await page.route('**/api/site/validate', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      valid: true,
      reason: 'Valid site geometry',
      areaM2: 117_200,
      perimeterM: 1_420,
      plantableAreaM2: 110_000,
      geometryType: 'Polygon',
      counts: { polygons: 1, holes: 0, exclusions: 0, paths: 0, accessPoints: 0, waterPoints: 0, existingTrees: 0 },
    },
  }));
  await page.route('**/api/auth/session', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: authenticated
      ? { authenticated: true, configured: true, user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner', pictureUrl: null, locale: 'en', preferences: {} } }
      : { authenticated: false, configured: false, user: null },
  }));
}

async function loadRecoveryDraft(page: Page, project: ProjectState) {
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem('growup:draft:v2')) window.localStorage.setItem('growup:draft:v2', JSON.stringify(value));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover' }).click();
}

test('persists fire operations and advanced group edits through local recovery', async ({ page }) => {
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project);
  await page.getByTestId('step-layout').click();

  const treeSelect = page.getByLabel('Select planned tree');
  await treeSelect.selectOption(project.variants[0].trees[0].id);
  const bulkEditor = page.getByTestId('bulk-editor');
  await bulkEditor.getByRole('button', { name: 'Same row' }).click();
  await expect(bulkEditor).not.toContainText('0 plants selected');
  await bulkEditor.getByRole('button', { name: 'Entire design' }).click();
  const replacement = project.selectedSpeciesIds.find((id) => id !== project.variants[0].trees[0].speciesId)!;
  await bulkEditor.getByLabel('Replace selected species').selectOption(replacement);
  await bulkEditor.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(bulkEditor.getByRole('button', { name: 'Equal spacing' })).toBeEnabled();

  await page.getByRole('button', { name: 'Fire operations' }).click();
  const operations = page.getByTestId('fire-operations-panel');
  await expect(operations).toContainText('EFFIS · FWI');
  await expect(operations).toContainText('8 km forecast grid');
  const firstTask = operations.locator('.fire-task-list article').filter({ hasText: 'Remove accumulated surface fuels' });
  await firstTask.locator('select').selectOption('complete');
  await firstTask.getByPlaceholder('Field note').fill('Cleared and photographed.');
  await operations.getByLabel('Next field inspection').fill('2026-08-15');
  await page.screenshot({ path: '/private/tmp/growup-fire-operations-checklist.png', fullPage: false });
  await operations.getByRole('button', { name: 'Show on map' }).click();
  await operations.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Map layers' }).click();
  const fireWeather = page.getByTestId('map-layer-panel').getByRole('button', { name: 'Show or hide EFFIS fire weather' });
  await expect(fireWeather).toHaveAttribute('aria-pressed', 'true');
  await fireWeather.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-operations-and-fire-weather.png', fullPage: false });
  await expect.poll(async () => {
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('growup:draft:v2') ?? 'null') as ProjectState | null);
    return saved?.fireOperations.tasks[0].status;
  }).toBe('complete');
  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('growup:draft:v2') ?? 'null') as ProjectState);
  const savedVariant = saved.variants.find((item) => item.id === saved.selectedVariantId)!;
  expect(savedVariant.trees.some((tree) => tree.locked && tree.speciesId === replacement)).toBe(true);

  await page.reload();
  await page.getByRole('button', { name: 'Recover' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('#mobile-product-menu').getByRole('button', { name: 'Fire operations' }).click();
  await expect(page.getByTestId('fire-operations-panel')).toContainText('1 of 5 controls closed');
});

test('creates the authenticated share link and renders the public review surface', async ({ page }) => {
  let project = projectFixture();
  await mockBase(page, true);
  await page.route('**/api/projects', async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: [{ id: project.id, name: project.name, updatedAt: project.updatedAt }] }));
  await page.route(`**/api/projects/${project.id}/revisions`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: [] }));
  await page.route(`**/api/projects/${project.id}/share`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', json: { enabled: false, project } });
    const input = route.request().postDataJSON() as { mode: 'view' | 'review'; expiresAt: string | null };
    project = {
      ...project,
      revision: (project.revision ?? 0) + 1,
      collaboration: {
        ...project.collaboration,
        share: { ...project.collaboration.share, enabled: true, mode: input.mode, createdAt: observedAt, expiresAt: input.expiresAt },
      },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', json: { enabled: true, mode: input.mode, path: '/shared/browser-review-token', project } });
  });
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      project = { ...(route.request().postDataJSON() as ProjectState), revision: (project.revision ?? 0) + 1 };
      return route.fulfill({ status: 200, contentType: 'application/json', json: project });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', json: project });
  });
  await loadRecoveryDraft(page, project);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Share and review' }).click();
  const panel = page.getByTestId('collaboration-panel');
  await panel.getByLabel('Permission').selectOption('review');
  await panel.getByRole('button', { name: 'Create secure link' }).click();
  await expect(panel.getByLabel('Active share link')).toHaveValue(/\/shared\/browser-review-token$/);
  await page.screenshot({ path: '/private/tmp/growup-sharing-panel.png', fullPage: false });

  await page.route('**/api/shared/projects/browser-review-token/comments', async (route) => {
    const input = route.request().postDataJSON() as { authorName: string; message: string };
    project = {
      ...project,
      revision: (project.revision ?? 0) + 1,
      collaboration: {
        ...project.collaboration,
        comments: [...project.collaboration.comments, {
          id: 'browser-comment',
          authorName: input.authorName,
          message: input.message,
          coordinate: null,
          target: 'general',
          targetId: null,
          revision: project.revision ?? 0,
          createdAt: observedAt,
          resolvedAt: null,
        }],
      },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', json: project });
  });
  await page.route('**/api/shared/projects/browser-review-token/review', async (route) => {
    const input = route.request().postDataJSON() as { reviewerName: string; note: string };
    project = {
      ...project,
      revision: (project.revision ?? 0) + 1,
      collaboration: {
        ...project.collaboration,
        review: { status: 'approved', reviewerName: input.reviewerName, note: input.note, revision: project.revision ?? 0, updatedAt: observedAt },
      },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', json: project });
  });
  await page.route('**/api/shared/projects/browser-review-token', async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: project }));
  await page.goto('/shared/browser-review-token');
  await expect(page.getByText('Growup project review')).toBeVisible();
  await expect(page.getByText(project.name)).toBeVisible();
  await expect(page.getByText('Click the map to pin the next comment')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve revision' })).toBeVisible();
  await page.getByLabel('Your name').fill('Field reviewer');
  await page.getByLabel('Comment').fill('Access and perimeter treatment verified.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByText('Access and perimeter treatment verified.')).toBeVisible();
  await page.getByLabel('Review note').fill('Approved subject to the recorded inspection.');
  await page.getByRole('button', { name: 'Approve revision' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-public-review.png', fullPage: false });
});

test('keeps the fire checklist usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('#mobile-product-menu').getByRole('button', { name: 'Fire operations' }).click();
  const operations = page.getByTestId('fire-operations-panel');
  await expect(operations).toBeVisible();
  await expect(operations.getByText('EFFIS · FWI')).toBeVisible();
  await expect(operations.locator('.fire-task-list article')).toHaveCount(5);
  await page.screenshot({ path: '/private/tmp/growup-fire-operations-mobile.png', fullPage: false });
});
