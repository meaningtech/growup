import { expect, test } from '@playwright/test';
import { defaultEconomicConfiguration } from '../src/data/economicProfiles';
import { defaultProjectCollaboration } from '../src/lib/collaboration';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout';
import type { LayoutVariant, ProjectState } from '../src/types';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { mockPlanningApi } from './support/mockPlanningApi';

test('chooses exact orchard quantities, preserves both modes and recovers the generated plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
  const counts = { 'morus-nigra': 10, 'prunus-persica': 5, 'prunus-dulcis': 20 };
  const project: ProjectState = {
    id: 'species-count-browser-test', name: 'Orchard quantities',
    site: TEMPERATE_OPEN_FIELD_FIXTURE, siteProfile: profile,
    selectedSpeciesIds: Object.keys(counts),
    designConfiguration: { ...DEFAULT_DESIGN_CONFIGURATION, system: 'mixed-orchard' },
    irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
    economicConfiguration: defaultEconomicConfiguration('XZ'),
    variants: [], selectedVariantId: null, timelineYear: 5, irrigation: null, costs: null,
    fireOperations: defaultFireOperationsPlan(), collaboration: defaultProjectCollaboration(),
    createdAt: profile.generatedAt, updatedAt: profile.generatedAt,
  };
  await page.addInitScript((draft) => {
    if (!localStorage.getItem('growup:draft:v2')) localStorage.setItem('growup:draft:v2', JSON.stringify(draft));
  }, project);
  await page.goto('/');
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-mix').click();
  const mix = page.getByTestId('species-mix-config');
  await mix.getByRole('button', { name: 'Number of plants', exact: true }).click();
  const generate = page.getByRole('button', { name: /Generate three evidence-scored designs/ });
  await expect(generate).toBeDisabled();
  for (const [id, count] of Object.entries(counts)) {
    await mix.locator(`[data-species-id="${id}"]`).getByRole('spinbutton', { name: /Number of plants/ }).fill(String(count));
  }
  await expect(mix).toContainText('35 plants');
  await mix.getByRole('button', { name: 'Percentage', exact: true }).click();
  await mix.locator('[data-species-id="morus-nigra"]').getByRole('spinbutton', { name: /Target share/ }).fill('50');
  await expect(mix).toContainText('100.0% total');
  await mix.getByRole('button', { name: 'Number of plants', exact: true }).click();
  for (const [id, count] of Object.entries(counts)) {
    await expect(mix.locator(`[data-species-id="${id}"]`).getByRole('spinbutton', { name: /Number of plants/ })).toHaveValue(String(count));
  }
  await page.screenshot({ path: 'test-results/species-count-inputs.png' });
  const generated = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate'));
  await generate.click();
  const variants = (await (await generated).json()).variants as LayoutVariant[];
  expect(variants[0].trees).toHaveLength(35);
  await expect(page.getByTestId('quantity-result')).toHaveText('35 plants placed · 35 requested.');
  await page.getByTestId('layout-tab-plants').click();
  const summary = page.getByTestId('plan-species-summary');
  for (const [id, count] of Object.entries(counts)) {
    const row = summary.locator(`[data-species-id="${id}"]`);
    await expect(row.locator('.plan-species-count strong')).toHaveText(String(count));
    await expect(row.locator('.plan-species-percent strong')).toHaveText(String(count));
  }
  await page.screenshot({ path: 'test-results/species-count-plan.png' });
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('growup:draft:v2') ?? '{}').designConfiguration?.speciesCounts)).toEqual(counts);
  await page.reload();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-mix').click();
  await expect(mix.getByRole('button', { name: 'Number of plants', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(mix).toContainText('35 plants');
  await mix.locator('[data-species-id="morus-nigra"]').getByRole('spinbutton', { name: /Number of plants/ }).fill('1000');
  await mix.locator('[data-species-id="prunus-persica"]').getByRole('spinbutton', { name: /Number of plants/ }).fill('0');
  await generate.click();
  await expect(page.getByTestId('quantity-result')).toContainText('Some requested plants do not fit');
  await page.getByTestId('layout-tab-plants').click();
  await expect(summary.locator('[data-species-id="morus-nigra"] .plan-species-percent strong')).toHaveText('1000');
  await page.screenshot({ path: 'test-results/species-count-shortfall.png' });
  expect(errors).toEqual([]);
});
