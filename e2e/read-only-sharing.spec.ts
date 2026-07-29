import { expect, test } from '@playwright/test';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { firebreakConfigurationFromFuelModel } from '../src/data/firebreak';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { calculateEstablishmentCost } from '../src/lib/costs';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { calculateIrrigation, DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from '../src/lib/layout';
import type { ProjectState } from '../src/types';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { mockGoogleMaps } from './support/mockGoogleMaps';

test('creates a read-only project link from the library and exposes no mutation controls', async ({ page }, testInfo) => {
  const now = '2026-07-27T10:00:00.000Z';
  const collaboration = defaultProjectCollaboration();
  const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
  const species = DESIGN_SPECIES.slice(0, 4);
  const design = {
    ...DEFAULT_DESIGN_CONFIGURATION,
    firebreak: { ...firebreakConfigurationFromFuelModel('shrub-edge'), enabled: true },
  };
  const variants = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, design);
  const economics = defaultEconomicConfiguration(profile.location.countryCode ?? '');
  const irrigation = calculateIrrigation(variants[0], species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, DEFAULT_IRRIGATION_CONFIGURATION, economics);
  const project: ProjectState = {
    id: 'read-only-project',
    name: 'Lanterna',
    site: TEMPERATE_OPEN_FIELD_FIXTURE,
    siteProfile: profile,
    selectedSpeciesIds: species.map((item) => item.id),
    designConfiguration: design,
    irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
    economicConfiguration: economics,
    variants,
    selectedVariantId: variants[0].id,
    timelineYear: 5,
    irrigation,
    costs: calculateEstablishmentCost(variants[0], species, irrigation, economics),
    fireOperations: defaultFireOperationsPlan(now),
    analysis: {
      id: 'shared-analysis',
      model: 'sharing-test',
      generatedAt: now,
      contextFingerprint: 'sharing-test',
      verdict: 'revise',
      overallScore: 74,
      executiveSummary: 'The plan is coherent, with one local fire review still required.',
      dimensions: [{ id: 'site-evidence', score: 82, status: 'ready', summary: 'Site evidence is suitable for planning.' }],
      findings: [{
        id: 'shared-finding',
        dimension: 'fire-safety',
        severity: 'major',
        title: 'Confirm the firebreak with the local authority',
        explanation: 'The planned geometry meets the modelled width, but local approval remains required.',
        recommendation: 'Record the local review before field implementation.',
        evidence: ['project.variants[0].firebreak.localReviewRequired'],
      }],
      assumptions: [],
      limitations: ['This is a planning review, not a legal certification.'],
    },
    collaboration,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const summary = { id: project.id, name: project.name, updatedAt: project.updatedAt, archivedAt: null };
  let submittedMode: string | null = null;
  let submittedIncludeCosts: boolean | null = null;

  await mockGoogleMaps(page);
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
    const body = route.request().postDataJSON() as { mode: string; includeCosts: boolean };
    submittedMode = body.mode;
    submittedIncludeCosts = body.includeCosts;
    project.collaboration.share = {
      enabled: true,
      mode: 'view',
      includeCosts: body.includeCosts,
      tokenVersion: 'server-only-token-version',
      createdAt: now,
      expiresAt: '2026-08-26T10:00:00.000Z',
    };
    await route.fulfill({ json: {
      enabled: true,
      mode: 'view',
      includeCosts: body.includeCosts,
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
        includeCosts: false,
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
  await expect(dialog).toContainText('complete plan');
  await expect(dialog.getByRole('checkbox', { name: /Include cost plan/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Create read-only link' }).click();
  expect(submittedMode).toBe('view');
  expect(submittedIncludeCosts).toBe(false);
  await expect(dialog.getByRole('textbox', { name: 'Active share link' })).toHaveValue(`${new URL(page.url()).origin}/shared/read-only-token`);
  await expect(dialog).toContainText('View only');

  await page.goto('/shared/read-only-token');
  await expect(page.getByText('Interactive read-only plan')).toHaveCount(0);
  await expect(page.getByText('Read-only project map')).toHaveCount(0);
  await expect(page.locator('.shared-map-hint')).toHaveCount(0);
  await expect(page.getByTestId('shared-map')).toHaveAttribute('data-fake-google-map', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#root').evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);
  const sectionNavigation = page.getByRole('navigation', { name: 'Shared project sections' });
  const sectionButtons = sectionNavigation.getByRole('button');
  await expect(sectionButtons).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Costs', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analysis', exact: true })).toHaveCount(0);
  const sectionButtonRows = await sectionButtons.evaluateAll((buttons) => buttons.reduce<number[]>((rows, button) => {
    const y = Math.round(button.getBoundingClientRect().y);
    if (!rows.some((row) => Math.abs(row - y) <= 2)) rows.push(y);
    return rows;
  }, []));
  expect(sectionButtonRows).toHaveLength(2);
  const sectionButtonColumns = await sectionButtons.evaluateAll((buttons) => buttons.reduce<number[]>((columns, button) => {
    const x = Math.round(button.getBoundingClientRect().x);
    if (!columns.some((column) => Math.abs(column - x) <= 2)) columns.push(x);
    return columns;
  }, []));
  expect(sectionButtonColumns).toHaveLength(3);
  const [mapBox, layerTriggerBox, layerPanelBox] = await Promise.all([
    page.locator('.shared-map').boundingBox(),
    page.getByRole('button', { name: 'Map layers' }).boundingBox(),
    page.getByTestId('shared-layer-panel').boundingBox(),
  ]);
  expect(mapBox).not.toBeNull();
  expect(layerTriggerBox).not.toBeNull();
  expect(layerPanelBox).not.toBeNull();
  expect(layerTriggerBox!.y - mapBox!.y).toBeGreaterThanOrEqual(56);
  expect(layerPanelBox!.y).toBeGreaterThanOrEqual(layerTriggerBox!.y + layerTriggerBox!.height + 6);
  expect(layerPanelBox!.y + layerPanelBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height - 8);
  await sectionNavigation.screenshot({ path: testInfo.outputPath('shared-navigation-mobile.png') });
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByText('What is known about this site')).toBeVisible();
  await expect(page.getByText('Data sources used')).toBeVisible();
  await expect(page.getByTestId('shared-climate-chart')).toBeVisible();
  await expect(page.getByTestId('wind-rose')).toBeVisible();
  await page.getByRole('button', { name: 'Summer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Summer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('wind-climatology').screenshot({ path: testInfo.outputPath('shared-wind-mobile.png') });
  await page.getByRole('button', { name: 'Species', exact: true }).click();
  await expect(page.getByText('Species, quantities and sequence')).toBeVisible();
  await expect(page.locator('.shared-species-list article')).not.toHaveCount(0);
  await sectionNavigation.locator('button[data-section="layout"]').click();
  await expect(page.getByTestId('shared-solar-analysis')).toBeVisible();
  await expect(page.getByTestId('shared-solar-timeline')).toBeVisible();
  expect(await page.locator('#root').evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);
  await expect.poll(async () => {
    const [navigationAfterSectionChange, sharedSectionAfterChange] = await Promise.all([
      sectionNavigation.boundingBox(),
      page.locator('.shared-section-frame > header').boundingBox(),
    ]);
    return Boolean(
      navigationAfterSectionChange
      && sharedSectionAfterChange
      && sharedSectionAfterChange.y >= navigationAfterSectionChange.y + navigationAfterSectionChange.height,
    );
  }).toBe(true);
  const solarMapToggle = page.getByRole('checkbox', { name: 'Show shadows on the map' });
  await expect(solarMapToggle).not.toBeChecked();
  await solarMapToggle.check();
  await expect(page.getByTestId('shared-layer-panel').getByRole('button', { name: 'Sun and shade' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('shared-solar-analysis').screenshot({ path: testInfo.outputPath('shared-solar-mobile.png') });
  await page.getByRole('button', { name: 'Water', exact: true }).click();
  await expect(page.getByText('Irrigation demand and network')).toBeVisible();
  await expect(page.getByTestId('shared-water-chart')).toBeVisible();
  await page.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(page.getByText('Firebreak and operational analysis')).toBeVisible();
  await expect(page.getByText('The plan is coherent, with one local fire review still required.')).toHaveCount(0);
  await expect(page.getByText('project.variants[0].firebreak.localReviewRequired')).toHaveCount(0);
  const machineryLayer = page.getByTestId('shared-layer-panel').getByRole('button', { name: 'Machinery' });
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'false');
  await machineryLayer.click();
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.match(/^[A-Z]+\d+ · /));
    marker?.emit('click');
  });
  await expect(page.getByTestId('shared-tree-detail')).toContainText(/[A-Z]+\d+/);
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve revision' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0);
});
