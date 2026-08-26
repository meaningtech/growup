import { expect, test } from '@playwright/test';
import type { LayoutVariant } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';
import { mockPlanningApi } from './support/mockPlanningApi';

test('stores exact species targets and manual succession in the generated plan', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-mix').click();

  const mix = page.getByTestId('species-mix-config');
  const rows = mix.locator('.species-mix-rows article');
  await expect(rows).toHaveCount(9);
  await expect(mix).toContainText(/100(?:\.0)?% total/);
  const firstRow = rows.first();
  const speciesId = await firstRow.getAttribute('data-species-id');
  expect(speciesId).toBeTruthy();

  await firstRow.getByRole('spinbutton', { name: /Target share/ }).fill('60');
  await firstRow.getByRole('combobox', { name: /Succession/ }).selectOption('placenta');
  await expect(firstRow.getByRole('spinbutton', { name: /Target share/ })).toHaveValue('60');
  await expect(mix).toContainText(/100(?:\.0)?% total/);
  const targetTotal = await mix.getByRole('spinbutton', { name: /Target share/ }).evaluateAll((inputs) => (
    inputs.reduce((sum, input) => sum + Number((input as HTMLInputElement).value), 0)
  ));
  expect(targetTotal).toBeCloseTo(100, 5);

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const { variants } = await response.json() as { variants: LayoutVariant[] };
  const entry = variants[0].design.speciesMix[speciesId!];
  expect(entry).toEqual({ targetPercent: 60, successionOverride: 'placenta', spacingOverrideM: null });
  const count = variants[0].trees.filter((tree) => tree.speciesId === speciesId).length;
  expect(count / variants[0].trees.length * 100).toBeGreaterThan(20);
  expect(variants[0].warnings).toEqual(expect.arrayContaining([
    expect.stringMatching(/60\.0% target; spacing and hard site constraints take precedence/),
  ]));

  await page.getByTestId('layout-tab-plants').click();
  const summary = page.getByTestId('plan-species-summary');
  await expect(summary).toContainText(`${variants[0].trees.length} exact positions`);
  const speciesToggle = summary.locator(`[data-species-id="${speciesId}"]`);
  await expect(speciesToggle).toContainText(String(count));
  await expect(speciesToggle).toContainText(`${(count / variants[0].trees.length * 100).toFixed(1)}%`);
  await expect(speciesToggle).toHaveAttribute('aria-pressed', 'true');
  await speciesToggle.click();
  await expect(speciesToggle).toHaveAttribute('aria-pressed', 'false');
  await speciesToggle.click();
  await expect(speciesToggle).toHaveAttribute('aria-pressed', 'true');
});

test('shows a syntropic side-view of one planting row after the grid is generated', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await expect(page.getByTestId('layout-tab-profile')).toBeVisible();
  await page.getByTestId('layout-tab-profile').click();
  await expect(page.getByTestId('succession-profile')).toBeVisible();
  await expect(page.getByTestId('succession-profile')).toContainText('Side view of one planting row');
  await page.getByRole('button', { name: 'Year 20' }).first().click();
  await expect(page.getByTestId('succession-timeline').locator('input')).toHaveValue('20');
});

test('rebuilds the palette when the planting system changes and searches the monoculture crop', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-palette').click();
  await page.getByLabel('Search scientific catalogue').fill('grape');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results')).toContainText('Grapevine');
  await expect(page.locator('.catalogue-results')).toContainText('Vitis vinifera');
  await expect(page.locator('.catalogue-results').getByRole('button', { name: /Add|Remove/ }).first()).toBeVisible();
  const chips = page.getByTestId('species-selected-strip').locator('.species-chip');
  await expect(chips).toHaveCount(9);
  const syntropic = await chips.allTextContents();

  const orchardRequest = page.waitForRequest((request) => request.url().endsWith('/api/recommendations') && request.method() === 'POST');
  await page.getByTestId('species-tab-system').click();
  await page.getByRole('radio', { name: 'Mixed orchard' }).click();
  expect((await orchardRequest).postDataJSON()).toEqual(expect.objectContaining({ system: 'mixed-orchard' }));
  await expect(page.getByTestId('species-tab-system')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('species-tab-palette').click();
  await expect(chips).toHaveCount(5);
  expect(await chips.allTextContents()).not.toEqual(syntropic);

  await page.getByTestId('species-tab-system').click();
  await page.getByRole('radio', { name: 'Monoculture orchard' }).click();
  await expect(page.getByTestId('monoculture-picker-trigger')).toBeVisible();
  await page.getByTestId('monoculture-picker-trigger').click();
  const picker = page.getByTestId('monoculture-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByText('Preferred for this site')).toBeVisible();
  await picker.getByLabel('Search by common or scientific name').fill('grape');
  await expect(picker.getByTestId('monoculture-design-hits')).toContainText('Grapevine');
  await expect(picker.getByTestId('monoculture-design-hits')).toContainText('Vitis vinifera');
  await picker.getByLabel('Search by common or scientific name').fill('Olea');
  await picker.getByRole('button', { name: /Olea europaea/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('monoculture-picker-trigger')).toContainText('Olive');
  await expect(page.getByTestId('monoculture-picker-trigger')).toContainText('Olea europaea');
  await page.getByTestId('species-tab-palette').click();
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Olive');
});

test('adds a Switchboard taxon that is not in the 51-species design catalogue', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-palette').click();
  await page.getByLabel('Search scientific catalogue').fill('cacao');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.catalogue-results')).toContainText('Theobroma cacao');
  await expect(page.locator('.catalogue-results')).toContainText('Climate, growth and price unknown');
  await page.locator('.catalogue-results').getByRole('button', { name: 'Add' }).first().click();
  const spacing = page.getByTestId('catalogue-spacing-dialog');
  await expect(spacing).toBeVisible();
  await spacing.getByRole('spinbutton', { name: 'Planting distance' }).fill('5');
  const generate = page.waitForRequest((request) => request.url().endsWith('/api/layout/generate') && request.method() === 'POST');
  await spacing.getByRole('button', { name: 'Add to palette' }).click();
  await expect(page.getByTestId('species-selected-strip')).toContainText('Theobroma cacao');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const payload = (await generate).postDataJSON() as { selectedSpeciesIds: string[]; userSpecies: Array<{ id: string; spacingM: number; envelopeConfidence: string }> };
  expect(payload.selectedSpeciesIds).toContain('switchboard-theobroma-cacao');
  expect(payload.userSpecies).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'switchboard-theobroma-cacao', spacingM: 5, envelopeConfidence: 'unknown' }),
  ]));
});

test('rebuilds plants and shares when design objectives change', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-mix').click();
  const mix = page.getByTestId('species-mix-config');
  const beforeShares = await mix.getByRole('spinbutton', { name: /Target share/ }).evaluateAll((inputs) => (
    inputs.map((input) => Number((input as HTMLInputElement).value))
  ));
  const beforeNames = await mix.locator('.species-mix-rows article strong').allTextContents();

  const objectiveRequest = page.waitForRequest((request) => request.url().endsWith('/api/recommendations') && request.method() === 'POST');
  await page.getByTestId('species-tab-system').click();
  await page.getByRole('slider', { name: 'Food & production' }).fill('100');
  await page.getByRole('slider', { name: 'Biodiversity' }).fill('5');
  expect((await objectiveRequest).postDataJSON()).toEqual(expect.objectContaining({
    objectives: expect.objectContaining({ production: 100 }),
  }));
  await expect(page.getByText('Proposed plants and shares rebuilt for these priorities.')).toBeVisible();
  await expect(page.getByTestId('species-tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('objective-palette-strip')).toBeVisible();
  const afterChipNames = await page.getByTestId('objective-palette-strip').locator('.species-chip').allTextContents();
  await page.getByTestId('species-tab-mix').click();
  const afterShares = await mix.getByRole('spinbutton', { name: /Target share/ }).evaluateAll((inputs) => (
    inputs.map((input) => Number((input as HTMLInputElement).value))
  ));
  const afterNames = await mix.locator('.species-mix-rows article strong').allTextContents();
  expect(afterShares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 5);
  expect(afterChipNames.length).toBeGreaterThan(0);
  expect(
    afterShares.join() === beforeShares.join()
    && afterNames.join() === beforeNames.join()
    && afterChipNames.join() === beforeNames.join(),
  ).toBe(false);
});
