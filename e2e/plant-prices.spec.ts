import { expect, test } from '@playwright/test';
import type { EconomicConfiguration, EstablishmentCost } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';
import { mockPlanningApi } from './support/mockPlanningApi';

test('edits a species unit price and applies it to project costs', async ({ page }) => {
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await page.getByRole('button', { name: 'Size water + calculate costs' }).click();
  await page.getByTestId('step-costs').click();
  await expect(page.getByTestId('cost-tabs').getByRole('tab')).toHaveCount(4);
  await expect(page.getByTestId('costs-tab-summary')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Establishment total')).toBeVisible();
  await page.getByTestId('costs-tab-parameters').click();

  const prices = page.getByTestId('plant-unit-price-overrides');
  await expect(prices.locator('label')).toHaveCount(9);
  const firstRow = prices.locator('label').first();
  const speciesId = await firstRow.getAttribute('data-species-id');
  expect(speciesId).toBeTruthy();
  const input = firstRow.getByRole('spinbutton');
  const referenceValue = await input.inputValue();
  await input.fill('42.35');
  await expect(firstRow).toContainText('Custom project price');

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/costs/calculate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Recalculate with these rates' }).click();
  const response = await responsePromise;
  const body = await response.json() as { establishment: EstablishmentCost };
  const submitted = response.request().postDataJSON() as { economicConfiguration: EconomicConfiguration };

  expect(submitted.economicConfiguration.plantUnitCostOverrides).toEqual({ [speciesId!]: 42.35 });
  expect(body.establishment.bySpecies.find((item) => item.speciesId === speciesId)?.unitPlantCost).toBe(42.35);
  await expect(input).toHaveValue('42.35');

  await firstRow.getByRole('button', { name: /Restore reference price/ }).click();
  await expect(input).toHaveValue(referenceValue);
  await expect(firstRow).toContainText('Reference estimate');

  await page.getByTestId('costs-tab-installation').click();
  await expect(page.getByTestId('cost-installation-table')).toBeVisible();
  await page.getByTestId('costs-tab-management').click();
  await expect(page.getByTestId('open-operational-schedule')).toBeVisible();
});
