import { expect, test } from '@playwright/test';
import type { LayoutVariant, SpeciesRecommendation } from '../src/types';

test('applies objectives to suitability, filters the source catalogue and checks planned composition', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByTestId('existing-vegetation-audit')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-species').click();

  await expect(page.getByTestId('species-safety-gate')).toContainText('blocked');
  await expect(page.getByTestId('design-objectives')).toBeVisible();
  await expect(page.getByTestId('species-inspector')).toContainText('Linked evidence');
  await expect(page.getByTestId('species-inspector')).toContainText('Evidence readiness');

  const rerankResponse = page.waitForResponse((response) => response.url().endsWith('/api/recommendations') && response.request().method() === 'POST');
  await page.getByRole('slider', { name: 'Native habitat' }).fill('100');
  const response = await rerankResponse;
  expect(response.ok()).toBeTruthy();
  const ranking = await response.json() as { recommendations: SpeciesRecommendation[] };
  expect(ranking.recommendations[0].components.reduce((sum, component) => sum + component.weight, 0)).toBeCloseTo(1, 8);
  expect(ranking.recommendations.find((item) => item.status === 'blocked')?.score).toBe(0);

  await page.getByLabel('Search scientific catalogue').fill('Olea');
  await page.getByLabel('Design-ready').check();
  const catalogueResponse = page.waitForResponse((item) => item.url().includes('/api/catalog/search') && item.request().method() === 'GET');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  expect((await catalogueResponse).ok()).toBeTruthy();
  await expect(page.locator('.catalogue-results > span')).toHaveCount(1);
  await expect(page.locator('.catalogue-results')).toContainText('Olea europaea');
  await page.getByTestId('design-objectives').scrollIntoViewIfNeeded();
  await page.locator('.panel-body').evaluate((element) => { element.scrollTop = 140; });
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-objectives-species.png', fullPage: false });

  const generateButton = page.getByRole('button', { name: /Generate three evidence-scored designs/ });
  expect(await generateButton.evaluate((element) => window.getComputedStyle(element).position)).toBe('static');
  await generateButton.scrollIntoViewIfNeeded();
  await expect(generateButton).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-species-no-overlap.png', fullPage: false });
  const layoutResponse = page.waitForResponse((item) => item.url().endsWith('/api/layout/generate') && item.request().method() === 'POST');
  await generateButton.click();
  const generated = await layoutResponse;
  expect(generated.ok()).toBeTruthy();
  const { variants } = await generated.json() as { variants: LayoutVariant[] };
  expect(variants[0].composition.targets.nativePercent).toBeGreaterThanOrEqual(75);
  expect(Object.keys(variants[0].composition.byStratum).length).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('layout-composition')).toBeVisible();
  await expect(page.getByTestId('layout-composition')).toContainText('actual');
});
