import { expect, test } from '@playwright/test';
import type { LayoutVariant } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('preserves locked trees and exposes deterministic growth uncertainty during partial regeneration', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByText('02 · Multi-source evidence')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-species').click();

  const generationPromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const generationResponse = await generationPromise;
  const generated = await generationResponse.json() as { variants: LayoutVariant[] };
  const originalTree = generated.variants[0].trees[0];

  await page.getByLabel('Select planned tree').selectOption(originalTree.id);
  await expect(page.getByTestId('tree-growth-model')).toContainText('Height low · base · high');
  await expect(page.getByTestId('tree-growth-model')).toContainText('Crown low · base · high');
  await expect(page.getByTestId('tree-growth-model')).toContainText('growaf-growth-1.0.0');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();

  const regenerationPromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/regenerate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Regenerate unlocked' }).click();
  const regenerationResponse = await regenerationPromise;
  expect(regenerationResponse.ok()).toBeTruthy();
  const regenerated = await regenerationResponse.json() as { variant: LayoutVariant };
  expect(regenerated.variant.generation).toEqual(expect.objectContaining({ mode: 'partial', lockedTreeCount: 1 }));
  expect(regenerated.variant.trees.find((tree) => tree.id === originalTree.id)).toEqual({ ...originalTree, locked: true });

  await expect(page.getByTestId('generation-audit')).toContainText('Partial deterministic regeneration');
  await expect(page.getByTestId('generation-audit')).toContainText('growaf-layout-1.1.0');
  await expect(page.getByTestId('generation-audit')).toContainText('1');
  await expect.poll(async () => Number(await page.locator('.map-canvas').getAttribute('data-zoom'))).toBeGreaterThan(15);
  await page.getByTestId('generation-audit').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-partial-regeneration.png', fullPage: false });
});
