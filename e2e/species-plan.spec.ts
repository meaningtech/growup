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
  const targetTotal = await mix.locator('input[type="number"]').evaluateAll((inputs) => (
    inputs.reduce((sum, input) => sum + Number((input as HTMLInputElement).value), 0)
  ));
  expect(targetTotal).toBeCloseTo(100, 5);

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const { variants } = await response.json() as { variants: LayoutVariant[] };
  const entry = variants[0].design.speciesMix[speciesId!];
  expect(entry).toEqual({ targetPercent: 60, successionOverride: 'placenta' });
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
