import { expect, test, type Page } from '@playwright/test';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { firebreakConfigurationFromFuelModel } from '../src/data/firebreak';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { calculateEstablishmentCost } from '../src/lib/costs';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { projectAnalysisFingerprint } from '../src/lib/projectAnalysis';
import { calculateIrrigation, DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from '../src/lib/layout';
import type { DesignConfiguration, EconomicConfiguration, IrrigationConfiguration, LayoutVariant, ProjectState, SiteBoundary, SiteProfile } from '../src/types';
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
  const economics = defaultEconomicConfiguration(profile.location.countryCode ?? '');
  return {
    id: 'operations-browser-project',
    name: 'Operations browser project',
    site: TEMPERATE_OPEN_FIELD_FIXTURE,
    siteProfile: profile,
    selectedSpeciesIds: species.map((item) => item.id),
    designConfiguration: design,
    irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
    economicConfiguration: economics,
    variants,
    selectedVariantId: variants[0].id,
    timelineYear: 5,
    irrigation: calculateIrrigation(variants[0], species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, DEFAULT_IRRIGATION_CONFIGURATION, economics),
    costs: null,
    fireOperations: defaultFireOperationsPlan(observedAt),
    collaboration: defaultProjectCollaboration(),
    revision: 1,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

async function mockBase(page: Page, authenticated = false, assistantConfigured = false) {
  await page.route('**/api/config', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      googleMapsApiKey: '',
      initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
      climatePeriod: '2021–2025',
      modelVersion: 'test',
      assistant: { configured: assistantConfigured, interface: 'openai-compatible' },
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
  await page.route('**/api/layout/generate', async (route) => {
    const input = route.request().postDataJSON() as {
      site: SiteBoundary;
      siteProfile: SiteProfile;
      selectedSpeciesIds: string[];
      designConfiguration: DesignConfiguration;
    };
    const species = DESIGN_SPECIES.filter((item) => input.selectedSpeciesIds.includes(item.id));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { variants: generateLayoutVariants(input.site, input.siteProfile, species, input.designConfiguration) },
    });
  });
  await page.route('**/api/costs/calculate', async (route) => {
    const input = route.request().postDataJSON() as {
      variant: LayoutVariant;
      site: SiteBoundary;
      siteProfile: SiteProfile;
      selectedSpeciesIds: string[];
      designYear: number;
      irrigationConfiguration: IrrigationConfiguration;
      economicConfiguration: EconomicConfiguration;
    };
    const species = DESIGN_SPECIES.filter((item) => input.selectedSpeciesIds.includes(item.id));
    const irrigation = calculateIrrigation(
      input.variant,
      species,
      input.site,
      input.siteProfile,
      input.designYear,
      input.irrigationConfiguration,
      input.economicConfiguration,
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        irrigation,
        establishment: calculateEstablishmentCost(input.variant, species, irrigation, input.economicConfiguration),
      },
    });
  });
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

async function loadRecoveryDraft(page: Page, project: ProjectState, recoveryLabel = 'Recover') {
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem('growup:draft:v2')) window.localStorage.setItem('growup:draft:v2', JSON.stringify(value));
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: recoveryLabel }).click();
}

test('persists fire operations and advanced group edits through local recovery', async ({ page }) => {
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project);
  await page.getByTestId('step-layout').click();
  await page.getByTestId('layout-tab-edit').click();

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

  await page.getByTestId('layout-tab-summary').click();
  await page.getByRole('button', { name: 'Fire operations' }).click();
  const operations = page.getByTestId('fire-operations-panel');
  await expect(operations).toContainText('EFFIS · FWI');
  await expect(operations).toContainText('8 km forecast grid');
  await operations.getByRole('tab', { name: 'Operations' }).click();
  const firstTask = operations.locator('.fire-task-list article').filter({ hasText: 'Remove accumulated surface fuels' });
  await firstTask.locator('select').selectOption('complete');
  await firstTask.getByPlaceholder('Field note').fill('Cleared and photographed.');
  await operations.getByLabel('Next field inspection').fill('2026-08-15');
  await page.screenshot({ path: '/private/tmp/growup-fire-operations-checklist.png', fullPage: false });
  await operations.getByRole('tab', { name: 'Analysis' }).click();
  await operations.getByRole('button', { name: 'Show on map' }).click();

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
  await page.getByTestId('step-fire').click();
  await page.getByTestId('fire-operations-panel').getByRole('tab', { name: 'Operations' }).click();
  await expect(page.getByTestId('fire-operations-panel')).toContainText('1 of 5 controls closed');
});

test('creates the authenticated share link and renders the public review surface', async ({ page }) => {
  let project = projectFixture();
  await mockBase(page, true);
  await page.route('**/api/projects', async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: [{ id: project.id, name: project.name, updatedAt: project.updatedAt }] }));
  await page.route(`**/api/projects/${project.id}/revisions`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', json: [] }));
  await page.route(`**/api/projects/${project.id}/share`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', json: { enabled: false, project } });
    const input = route.request().postDataJSON() as { mode: 'view' | 'review'; expiresAt: string | null; includeCosts: boolean };
    project = {
      ...project,
      revision: (project.revision ?? 0) + 1,
      collaboration: {
        ...project.collaboration,
        share: { ...project.collaboration.share, enabled: true, mode: input.mode, includeCosts: input.includeCosts, createdAt: observedAt, expiresAt: input.expiresAt },
      },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', json: { enabled: true, mode: input.mode, includeCosts: input.includeCosts, path: '/shared/browser-review-token', project } });
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
  await panel.getByRole('checkbox', { name: /Include cost plan/ }).check();
  await panel.getByRole('button', { name: 'Create secure link' }).click();
  await expect(panel.getByLabel('Active share link')).toHaveValue(/\/shared\/browser-review-token$/);
  await expect(panel).toContainText('costs included');
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
  await page.getByRole('textbox', { name: 'Comment' }).fill('Access and perimeter treatment verified.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByText('Access and perimeter treatment verified.')).toBeVisible();
  await page.getByLabel('Review note').fill('Approved subject to the recorded inspection.');
  await page.getByRole('button', { name: 'Approve revision' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-public-review.png', fullPage: false });
});

test('gives authenticated project selection its own mobile page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = projectFixture();
  await mockBase(page, true);
  await page.route('**/api/projects', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: [
      { id: project.id, name: project.name, updatedAt: project.updatedAt },
      { id: 'second-project', name: 'Northern orchard', updatedAt: '2026-07-25T09:00:00.000Z' },
    ],
  }));
  await loadRecoveryDraft(page, project);

  const assistantTrigger = page.getByRole('button', { name: 'Ask' });
  const projectsTrigger = page.getByRole('button', { name: 'Projects' });
  const menuTrigger = page.getByRole('button', { name: 'Open menu' });
  await expect(assistantTrigger).toBeVisible();
  await expect(projectsTrigger).toBeVisible();
  expect((await assistantTrigger.textContent())?.trim()).toBe('');
  expect((await projectsTrigger.textContent())?.trim()).toBe('');
  const [assistantBox, projectsTriggerBox, menuBox] = await Promise.all([
    assistantTrigger.boundingBox(),
    projectsTrigger.boundingBox(),
    menuTrigger.boundingBox(),
  ]);
  expect(assistantBox).not.toBeNull();
  expect(projectsTriggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(assistantBox!.width).toBe(assistantBox!.height);
  expect(projectsTriggerBox!.width).toBe(projectsTriggerBox!.height);
  expect(assistantBox!.x + assistantBox!.width).toBeLessThan(projectsTriggerBox!.x);
  expect(projectsTriggerBox!.x + projectsTriggerBox!.width).toBeLessThan(menuBox!.x);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(380);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-authenticated-top-actions.png'), fullPage: false });

  await projectsTrigger.click();
  const projectsPage = page.getByTestId('projects-page');
  await expect(projectsPage).toBeVisible();
  await expect(projectsPage.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await expect(projectsPage.getByRole('button', { name: 'New project' })).toContainText('New project');
  await expect(projectsPage.getByRole('button', { name: `Open ${project.name}` })).toHaveAttribute('aria-current', 'page');
  await expect(projectsPage.getByRole('button', { name: 'Open Northern orchard' })).toBeVisible();
  const projectsBox = await projectsPage.boundingBox();
  expect(projectsBox).not.toBeNull();
  expect(projectsBox!.width).toBe(390);
  expect(projectsBox!.height).toBe(844);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-projects-page.png'), fullPage: false });

  await projectsPage.getByRole('button', { name: 'Close projects' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.locator('.mobile-project-select')).toHaveCount(0);
});

test('opens fire analysis first and keeps operations secondary on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project);
  await page.locator('.toast button').click();
  const fireStep = page.getByTestId('step-fire');
  await expect(fireStep).toBeVisible();
  await expect(fireStep).toContainText('Fire');
  await fireStep.click();
  await expect(fireStep).toHaveClass(/active/);
  const operations = page.getByTestId('fire-operations-panel');
  await expect(operations).toBeVisible();
  await expect(operations.getByText('EFFIS · FWI')).toBeVisible();
  await expect(operations.getByTestId('fire-analysis-overview')).toBeVisible();
  await expect(operations.locator('.fire-component-list article')).toHaveCount(5);
  await expect(operations.locator('.fire-task-list article')).toHaveCount(0);
  await operations.locator('.fire-analysis-hero').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growup-fire-analysis-mobile.png', fullPage: false });
  await operations.getByRole('tab', { name: 'Data' }).click();
  await expect(operations.getByTestId('fire-analysis-data')).toBeVisible();
  await expect(operations.locator('.fire-data-section')).toHaveCount(5);
  await expect(operations.getByText('35% weight')).toBeVisible();
  await operations.getByRole('tab', { name: 'Sources' }).click();
  await expect(operations.getByTestId('fire-analysis-sources')).toBeVisible();
  await expect(operations.locator('.fire-evidence-card')).not.toHaveCount(0);
  await operations.getByRole('tab', { name: 'Operations' }).click();
  await expect(operations.locator('.fire-task-list article')).toHaveCount(5);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Inspect, maintain and record' })).toHaveCount(0);
  const [operationsBox, inspectorBox] = await Promise.all([
    operations.boundingBox(),
    page.locator('.inspector').boundingBox(),
  ]);
  expect(operationsBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(operationsBox!.x).toBeGreaterThanOrEqual(inspectorBox!.x);
  expect(operationsBox!.x + operationsBox!.width).toBeLessThanOrEqual(inspectorBox!.x + inspectorBox!.width);
  await page.screenshot({ path: '/private/tmp/growup-fire-operations-mobile.png', fullPage: false });
});

test('runs and persists the final formal AI review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectBase = projectFixture();
  const project = {
    ...projectBase,
    costs: calculateEstablishmentCost(
      projectBase.variants[0],
      DESIGN_SPECIES.filter((species) => projectBase.selectedSpeciesIds.includes(species.id)),
      projectBase.irrigation!,
      projectBase.economicConfiguration,
    ),
  };
  await mockBase(page, false, true);
  let reviewCalls = 0;
  await page.route('**/api/assistant/review', async (route) => {
    reviewCalls += 1;
    const request = route.request().postDataJSON() as { context: Parameters<typeof projectAnalysisFingerprint>[0] };
    const remediated = reviewCalls > 2;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        id: remediated ? 'formal-review-agent-browser' : 'formal-review-browser',
        model: 'review-test-model',
        generatedAt: observedAt,
        contextFingerprint: projectAnalysisFingerprint(request.context),
        verdict: remediated ? 'ready' : 'revise',
        overallScore: remediated ? 84 : 72,
        executiveSummary: remediated ? 'The selected project inconsistency is resolved.' : 'The plan is coherent but needs a documented local fire review.',
        dimensions: [
          ['evidence', 82, 'pass'],
          ['species', 80, 'pass'],
          ['design', 78, 'pass'],
          ['water', 74, 'attention'],
          ['fire', remediated ? 84 : 62, remediated ? 'pass' : 'attention'],
          ['operations', 66, 'attention'],
          ['economics', 70, 'attention'],
          ['coherence', 81, 'pass'],
        ].map(([id, score, status]) => ({ id, score, status, summary: `${id} review summary.` })),
        findings: remediated ? [] : [{
          id: 'mechanical-clearance',
          severity: 'major',
          area: 'design',
          title: 'Machinery clearance remains insufficient',
          explanation: 'The configured crop alley does not provide the requested machinery envelope.',
          evidence: ['designConfiguration.cropAlleyWidthM', 'selectedVariant.machinery.clearanceSatisfied'],
          recommendation: 'Increase crop alley spacing and regenerate dependent layouts.',
        }],
        assumptions: ['The irrigation source remains available during the dry season.'],
        limitations: ['This AI review is not a legal or wildfire-safety certification.'],
      },
    });
  });
  await page.route('**/api/assistant/plan', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      id: 'finding-solution-browser',
      model: 'review-test-model',
      summary: 'Increase crop alley spacing to 16 metres.',
      rationale: 'This is an executable geometry change and dependent outputs will be regenerated.',
      warnings: ['Field verification remains open.'],
      actions: [{ type: 'set_design_spacing', cropAlleyWidthM: 16 }],
      requiresConfirmation: true,
    },
  }));
  await loadRecoveryDraft(page, project);
  await page.locator('.toast button').click();
  await page.getByTestId('step-analysis').click();
  const analysis = page.getByTestId('project-analysis-panel');
  await expect(analysis).toBeVisible();
  await expect(analysis.locator('.analysis-protocol > header > b')).toHaveText('8/8');
  await analysis.getByRole('button', { name: 'Run formal review' }).click();
  const report = page.getByTestId('formal-review-report');
  await expect(report).toContainText('Revision required');
  await expect(report).toContainText('72');
  await expect(report).toContainText('Machinery clearance remains insufficient');
  await expect(report).not.toContainText('selectedVariant.machinery.clearanceSatisfied');
  await expect(report.locator('code')).toHaveCount(0);
  await expect(report).toContainText('1 open');
  await expect(report).toContainText('0 handled');
  const finding = page.getByTestId('review-finding-mechanical-clearance');
  await finding.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(finding).toHaveAttribute('data-resolution', 'resolved');
  await expect(report).toContainText('0 open');
  await expect(report).toContainText('1 handled');
  await finding.getByRole('button', { name: 'Reopen' }).click();
  await finding.getByRole('button', { name: 'Accept risk' }).click();
  await expect(finding).toHaveAttribute('data-resolution', 'accepted');
  await expect.poll(async () => {
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('growup:draft:v2') ?? 'null') as ProjectState | null);
    return saved?.analysis?.findings[0].resolution?.status;
  }).toBe('accepted');
  await page.screenshot({ path: '/private/tmp/growup-analysis-resolution-mobile.png', fullPage: false });
  await finding.getByRole('button', { name: 'Reopen' }).click();
  await finding.getByRole('button', { name: 'Solve', exact: true }).click();
  const agent = page.getByTestId('analysis-agent');
  await expect(agent).toContainText('1 selected');
  await page.getByLabel('Succession year').fill('6');
  await expect(report.locator('.analysis-stale')).toBeVisible();
  await expect.poll(async () => {
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('growup:draft:v2') ?? 'null') as ProjectState | null);
    return `${saved?.timelineYear}:${saved?.irrigation?.designYear}`;
  }).toBe('6:6');
  const startAgent = agent.getByRole('button', { name: 'Start Agent' });
  await expect(startAgent).toBeEnabled();
  await startAgent.click();
  await expect(agent).toContainText('Selected findings resolved');
  await expect(agent).toContainText('72');
  await expect(agent).toContainText('84');
  expect(reviewCalls).toBe(3);
  await expect(page.getByTestId('assistant-proposal')).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/growup-formal-analysis-desktop.png', fullPage: false });
  await expect.poll(async () => {
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('growup:draft:v2') ?? 'null') as ProjectState | null);
    return `${saved?.analysis?.id}:${saved?.analysis?.agentRun?.status}:${saved?.designConfiguration.cropAlleyWidthM}:${saved?.variants[0]?.design.cropAlleyWidthM}`;
  }).toBe('formal-review-agent-browser:resolved:16:16');
});

test('stops Agent mode without falsely resolving a field-only finding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectBase = projectFixture();
  const project = {
    ...projectBase,
    costs: calculateEstablishmentCost(
      projectBase.variants[0],
      DESIGN_SPECIES.filter((species) => projectBase.selectedSpeciesIds.includes(species.id)),
      projectBase.irrigation!,
      projectBase.economicConfiguration,
    ),
  };
  await mockBase(page, false, true);
  await page.route('**/api/assistant/review', async (route) => {
    const request = route.request().postDataJSON() as { context: Parameters<typeof projectAnalysisFingerprint>[0] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        id: 'formal-review-field-blocker',
        model: 'review-test-model',
        generatedAt: observedAt,
        contextFingerprint: projectAnalysisFingerprint(request.context),
        verdict: 'revise',
        overallScore: 70,
        executiveSummary: 'A field authority review remains necessary.',
        dimensions: ['evidence', 'species', 'design', 'water', 'fire', 'operations', 'economics', 'coherence']
          .map((id) => ({ id, score: 70, status: 'attention', summary: `${id} summary.` })),
        findings: [{
          id: 'authority-field-check',
          severity: 'major',
          area: 'fire',
          title: 'Authority field check required',
          explanation: 'No field record or authority decision is present.',
          evidence: ['fireOperations.tasks.authority-review'],
          recommendation: 'Complete and document the local authority review.',
        }],
        assumptions: [],
        limitations: ['Software cannot complete an authority review.'],
      },
    });
  });
  await page.route('**/api/assistant/plan', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      id: 'field-blocked-agent-step',
      model: 'review-test-model',
      summary: 'This finding requires a documented external review.',
      rationale: 'No software edit can establish the missing authority decision.',
      warnings: ['Keep the finding open until evidence is recorded.'],
      actions: [],
      requiresConfirmation: false,
    },
  }));
  await loadRecoveryDraft(page, project);
  await page.locator('.toast button').click();
  await page.getByTestId('step-analysis').click();
  await page.getByRole('button', { name: 'Run formal review' }).click();
  const finding = page.getByTestId('review-finding-authority-field-check');
  await finding.getByRole('button', { name: 'Solve', exact: true }).click();
  await page.getByTestId('analysis-agent-start').click();
  const agent = page.getByTestId('analysis-agent');
  await expect(agent).toContainText('Agent stopped at a blocker');
  await expect(agent).toContainText('No safe software action');
  await expect(finding).toHaveAttribute('data-resolution', 'open');
  await expect(page.getByTestId('formal-review-report')).toContainText('1 open');
});

test('keeps the evidence and fire pages connected to the next project step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project);
  await page.locator('.toast button').click();

  await page.getByTestId('step-profile').click();
  const evidenceContinue = page.getByTestId('evidence-continue');
  await expect(evidenceContinue).toBeVisible();
  await expect(evidenceContinue).toContainText('Continue to planning');
  await evidenceContinue.click();
  await expect(page.getByTestId('step-species')).toHaveClass(/active/);

  await page.getByTestId('step-fire').click();
  const fireContinue = page.getByTestId('fire-continue-costs');
  await expect(fireContinue).toBeVisible();
  await expect(fireContinue).toContainText('Continue to costs');
  await fireContinue.click();
  await expect(page.getByTestId('step-costs')).toHaveClass(/active/);
});

test('keeps the populated water page locked to the mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem('growup.locale', 'it'));
  const project = projectFixture();
  await mockBase(page);
  await loadRecoveryDraft(page, project, 'Recupera bozza');
  await page.locator('.toast button').click();
  await page.getByTestId('step-water').click();
  await expect(page.getByTestId('system-water-model')).toBeVisible();
  const timeline = page.locator('.timeline-control');
  const [timelineBox, mapBox] = await Promise.all([
    timeline.boundingBox(),
    page.locator('.map-stage').boundingBox(),
  ]);
  expect(timelineBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect(await timeline.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
  expect(timelineBox!.y).toBeGreaterThanOrEqual(mapBox!.y);
  expect(timelineBox!.y + timelineBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height);

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
    widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
      .filter((item) => item.right > document.documentElement.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 5),
  }));
  expect(overflow.widest, JSON.stringify(overflow.widest)).toEqual([]);
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  expect(overflow.scrollX).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-water-locked.png'), fullPage: false });
  await expect(page.getByTestId('water-tabs').getByRole('tab')).toHaveCount(4);
  await page.getByTestId('water-tab-network').click();
  const layerControls = page.getByTestId('irrigation-layer-controls');
  await layerControls.scrollIntoViewIfNeeded();
  const layerButtons = layerControls.getByRole('button');
  await expect(layerButtons).toHaveCount(2);
  for (const button of await layerButtons.all()) {
    const geometry = await button.evaluate((element) => {
      const title = element.querySelector('strong')?.getBoundingClientRect();
      const description = element.querySelector('small')?.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        titleBottom: title?.bottom ?? 0,
        descriptionTop: description?.top ?? 0,
        descriptionRight: description?.right ?? 0,
        cardRight: bounds.right,
      };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(80);
    expect(geometry.descriptionTop).toBeGreaterThanOrEqual(geometry.titleBottom);
    expect(geometry.descriptionRight).toBeLessThanOrEqual(geometry.cardRight);
  }
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-irrigation-layer-cards.png'), fullPage: false });

  await page.getByTestId('step-costs').click();
  const costTabs = page.getByTestId('cost-tabs').getByRole('tab');
  await expect(costTabs).toHaveCount(4);
  for (const tab of await costTabs.all()) {
    const geometry = await tab.evaluate((element) => {
      const label = element.querySelector('span')?.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return {
        labelLeft: label?.left ?? 0,
        labelRight: label?.right ?? 0,
        buttonLeft: bounds.left,
        buttonRight: bounds.right,
      };
    });
    expect(geometry.labelLeft).toBeGreaterThanOrEqual(geometry.buttonLeft);
    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.buttonRight);
  }
  await expect(page.getByTestId('costs-tab-management')).toBeDisabled();
  await page.getByTestId('costs-tab-parameters').click();
  await expect(page.getByTestId('economic-configuration')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-cost-tabs.png'), fullPage: false });
});
