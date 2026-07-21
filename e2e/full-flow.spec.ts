import { expect, test } from '@playwright/test';
import { stat } from 'node:fs/promises';
import type { EstablishmentCost, IrrigationEstimate } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('completes evidence, design, irrigation and costs, then protects persistence behind sign-in', async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByText('02 · Multi-source evidence')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Sentinel field water')).toBeVisible();
  await expect(page.getByTestId('existing-vegetation-audit')).toBeVisible();
  await expect(page.getByTestId('existing-vegetation-audit')).toContainText('0 protected woody areas');
  await expect(page.getByText('Sentinel-1:', { exact: false })).toBeVisible();
  await expect(page.getByTestId('evidence-traceability')).toContainText('Data read');
  await expect(page.getByTestId('evidence-traceability')).toContainText('Growaf calculation');
  await expect(page.getByTestId('evidence-traceability')).toContainText('Decision affected');
  await expect(page.getByTestId('evidence-traceability').locator('a')).toHaveCount(0);
  await expect(page.locator('.satellite-image img')).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-evidence.png', fullPage: false });

  await page.getByTestId('step-species').click();
  await expect(page.getByText('Evidence-ranked palette')).toBeVisible();
  await expect(page.getByText('species selected across strata', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await expect(page.getByText('3 reproducible layouts generated.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.variant-tabs button')).toHaveCount(3);
  await expect(page.getByText('Canopy Y20')).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-design.png', fullPage: false });

  const initialCostsPromise = page.waitForResponse((response) => response.url().endsWith('/api/costs/calculate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Size water + calculate costs' }).click();
  const initialCostsResponse = await initialCostsPromise;
  const initialCosts = await initialCostsResponse.json() as { irrigation: IrrigationEstimate; establishment: EstablishmentCost };
  await expect(page.getByText('05 · Water balance')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Current satellite scheduling')).toBeVisible();
  await expect(page.getByText('Year 5 annual OPEX')).toBeVisible();
  await expect(page.getByTestId('hydraulic-plan')).toContainText('Hydraulic duty point');
  await expect(page.getByTestId('hydraulic-plan')).toContainText('Pipe to buy');
  await expect(page.getByTestId('hydraulic-plan')).toContainText('not the field centroid');
  await expect(page.getByTestId('hydraulic-plan')).toContainText('Drag the blue S marker');
  await expect(page.getByTestId('irrigation-bom')).toContainText('Pressure-compensating emitters');
  await expect(page.getByTestId('irrigation-bom')).toContainText('Main filtration unit');
  await page.getByRole('button', { name: 'Map layers' }).click();
  const layerPanel = page.getByTestId('map-layer-panel');
  const boundaryLayer = layerPanel.getByRole('button', { name: 'Show or hide the field boundary' });
  const treeLayer = layerPanel.getByRole('button', { name: 'Show or hide planned trees' });
  const machineryLayer = layerPanel.getByRole('button', { name: 'Show or hide machinery transit areas' });
  const irrigationLayer = layerPanel.getByRole('button', { name: 'Show or hide the irrigation network' });
  const ndmiLayer = layerPanel.getByRole('button', { name: 'Toggle NDMI raster' });
  const waterPriorityLayer = layerPanel.getByRole('button', { name: 'Toggle water-priority samples' });
  await expect(boundaryLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(treeLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(irrigationLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(ndmiLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(waterPriorityLayer).toHaveAttribute('aria-pressed', 'false');
  await ndmiLayer.click();
  await waterPriorityLayer.click();
  await expect(ndmiLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(waterPriorityLayer).toHaveAttribute('aria-pressed', 'true');
  await ndmiLayer.click();
  await waterPriorityLayer.click();
  await boundaryLayer.click();
  await treeLayer.click();
  await irrigationLayer.click();
  await expect(boundaryLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(treeLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(irrigationLayer).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-machinery-only.png', fullPage: false });

  await machineryLayer.click();
  await irrigationLayer.click();
  await expect(treeLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(irrigationLayer).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-irrigation-only.png', fullPage: false });

  await treeLayer.click();
  await irrigationLayer.click();
  await expect(treeLayer).toHaveAttribute('aria-pressed', 'true');
  await expect(machineryLayer).toHaveAttribute('aria-pressed', 'false');
  await expect(irrigationLayer).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-trees-only.png', fullPage: false });

  await boundaryLayer.click();
  await machineryLayer.click();
  await irrigationLayer.click();
  await page.getByRole('button', { name: 'Close map layers' }).click();
  await page.getByTestId('hydraulic-plan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-water.png', fullPage: false });

  await page.getByRole('button', { name: 'Review complete cost plan' }).click();
  await expect(page.getByTestId('economic-configuration')).toContainText('Economic profile · IT');
  await expect(page.getByLabel('Currency code')).toHaveValue('EUR');
  await expect(page.getByText('Establishment total')).toBeVisible();
  await expect(page.getByText('Active system · year 5')).toBeVisible();
  await expect(page.getByTestId('cost-timeline')).toContainText('Annual operating cost over time');
  await expect(page.getByText('Planting labour', { exact: false })).toBeVisible();
  await expect(page.getByText('Water + operation · year 5')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-costs.png', fullPage: false });

  await page.getByTestId('open-operational-schedule').click();
  const schedule = page.getByTestId('operational-schedule');
  await expect(schedule).toContainText('Planting, irrigation and management schedule');
  await expect(schedule).toContainText('Ground-truth the field and water source');
  await expect(schedule).toContainText('Plant order and labour sheet');
  await expect(schedule).toContainText('Irrigation procurement and monthly demand');
  await expect(schedule).toContainText('Pressure-compensating emitters');
  await expect(schedule).toContainText('Evidence register');
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-operational-schedule.png', fullPage: false });
  await schedule.getByText('Evidence register').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-operational-schedule-evidence.png', fullPage: false });
  const schedulePdf = '/private/tmp/growaf-operational-schedule.pdf';
  await page.pdf({ path: schedulePdf, format: 'A4', printBackground: true });
  expect((await stat(schedulePdf)).size).toBeGreaterThan(30_000);
  await schedule.getByRole('button', { name: 'Close work plan' }).click();

  const matureCostsPromise = page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/costs/calculate') || response.request().method() !== 'POST') return false;
    return (response.request().postDataJSON() as { designYear?: number } | null)?.designYear === 29;
  });
  await page.getByLabel('Succession year').fill('29');
  const matureCostsResponse = await matureCostsPromise;
  const matureCosts = await matureCostsResponse.json() as { irrigation: IrrigationEstimate; establishment: EstablishmentCost };
  expect(matureCosts.irrigation.activePlantCount).toBeLessThanOrEqual(initialCosts.irrigation.activePlantCount);
  expect(matureCosts.irrigation.annualWaterM3).toBeLessThan(initialCosts.irrigation.annualWaterM3);
  expect(matureCosts.irrigation.annualOperation.totalCost).toBeLessThan(initialCosts.irrigation.annualOperation.totalCost);
  expect(matureCosts.establishment.activeSystem.totalReplacementCost).toBeLessThanOrEqual(initialCosts.establishment.activeSystem.totalReplacementCost);
  expect(matureCosts.establishment.totalCost).toBe(initialCosts.establishment.totalCost);
  await expect(page.getByText('Active system · year 29')).toBeVisible();
  await expect(page.getByText('Water + operation · year 29')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-year-29-costs.png', fullPage: false });
  await page.locator('.language-select select').selectOption('it');
  await page.getByTestId('cost-timeline').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('economic-configuration').getByText(/Stima globale in USD convertita/).first()).toBeVisible();
  await expect(page.getByText(/Global USD planning estimate converted/)).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-syntropic-cost-curve-it.png', fullPage: false });
  await page.locator('.language-select select').selectOption('en');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'Keep every field design together.' })).toBeVisible();
  await expect(page.getByText('Sign in with Google before saving this project.')).toBeVisible();
  const exportLink = page.locator('a.button').filter({ hasText: 'GeoJSON' });
  await expect(exportLink).toHaveCount(1);
  await expect(exportLink).not.toHaveAttribute('href', /.+/);
  const projectsResponse = await page.request.get('/api/projects');
  expect(projectsResponse.status()).toBe(401);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  const temporaryCloudOrigin = new URL(page.url()).hostname.endsWith('.run.app');
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !message.includes('Google Maps JavaScript API has been loaded directly') &&
    !(temporaryCloudOrigin && message === 'Failed to load resource: the server responded with a status of 403 ()'),
  );
  expect(unexpectedConsoleErrors, consoleErrors.join('\n')).toEqual([]);
});
