import { expect, test } from '@playwright/test';
import { DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies';
import { growthState } from '../src/lib/growth';
import { plantPositionCode, plantSpeciesInitials } from '../src/lib/plantIdentity';
import type { LayoutVariant } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { mockGoogleMaps } from './support/mockGoogleMaps';
import { mockPlanningApi } from './support/mockPlanningApi';
import { importSiteFixture } from './support/siteFixture';

test('labels every active plant point and opens its row-sequence identity from the map', async ({ page }, testInfo) => {
  await mockGoogleMaps(page);
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await page.getByTestId('step-species').click();

  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/layout/generate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  const { variants } = await (await responsePromise).json() as { variants: LayoutVariant[] };
  const variant = variants[0];
  const activeTrees = variant.trees.filter((tree) => {
    const species = DESIGN_SPECIES_BY_ID.get(tree.speciesId);
    return species && growthState(species, tree, 5).active;
  });
  const firstTree = [...activeTrees].sort((a, b) => a.rowIndex - b.rowIndex || a.positionIndex - b.positionIndex)[0];
  const firstSpecies = DESIGN_SPECIES_BY_ID.get(firstTree.speciesId)!;
  const expectedCode = plantPositionCode(firstTree);
  const expectedInitials = plantSpeciesInitials(firstSpecies.commonName, 'en');

  const layoutTabs = page.getByTestId('layout-tabs');
  await expect(layoutTabs.getByRole('tab')).toHaveCount(4);
  await expect(page.getByTestId('layout-tab-summary')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('generation-audit')).toHaveCount(0);
  await expect(page.getByTestId('plan-species-summary')).toHaveCount(0);
  await page.getByTestId('layout-tab-plants').click();
  await expect(page.getByTestId('plan-species-summary')).toBeVisible();
  await page.getByTestId('layout-tab-solar').click();
  await expect(page.getByTestId('daily-solar-exposure')).toBeVisible();
  await page.getByTestId('layout-tab-edit').click();
  await expect(page.getByTestId('bulk-editor')).toBeVisible();

  await expect.poll(() => page.evaluate(() => (
    (window as any).__growupMapMarkers.filter((marker: any) => marker.active && marker.options.title?.match(/^[A-Z]+\d+ · /)).length
  ))).toBe(activeTrees.length);
  const identity = await page.evaluate(({ code }) => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.startsWith(`${code} · `));
    return { label: marker.options.label.text, title: marker.options.title, scale: marker.options.icon.scale };
  }, { code: expectedCode });
  expect(identity).toEqual(expect.objectContaining({
    label: expectedInitials,
    title: `${expectedCode} · ${firstSpecies.commonName} · ${firstSpecies.scientificName}`,
  }));
  expect(identity.scale).toBeGreaterThanOrEqual(9);

  await page.evaluate(({ code }) => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.startsWith(`${code} · `));
    marker.emit('mouseover');
  }, { code: expectedCode });
  const mapTooltip = page.getByTestId('map-plant-tooltip');
  await expect(mapTooltip).toBeVisible();
  await expect(mapTooltip).toHaveAttribute('data-plant-code', expectedCode);
  await expect(mapTooltip).toContainText(firstSpecies.commonName);
  await expect(mapTooltip).toContainText(firstSpecies.scientificName);
  await expect(mapTooltip).toContainText(`Row ${expectedCode.replace(/\d+$/, '')}`);
  await page.evaluate(({ code }) => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.startsWith(`${code} · `));
    marker.emit('mouseout');
  }, { code: expectedCode });
  await expect(mapTooltip).toBeHidden();

  await page.getByTestId('step-costs').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(({ code }) => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.startsWith(`${code} · `));
    marker.emit('click', { domEvent: { shiftKey: false } });
  }, { code: expectedCode });

  await expect(mapTooltip).toBeVisible();
  const tooltipBox = await mapTooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(390);

  const selected = page.getByTestId('selected-tree-identity');
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute('data-plant-code', expectedCode);
  await expect(selected).toContainText(firstSpecies.commonName);
  await expect(selected).toContainText(firstSpecies.scientificName);
  await expect(selected).toContainText(`Row ${expectedCode.replace(/\d+$/, '')}`);
  await page.locator('.map-stage').screenshot({ path: testInfo.outputPath('mobile-plant-tooltip.png') });
});
