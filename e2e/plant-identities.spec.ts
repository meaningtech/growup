import { expect, test } from '@playwright/test';
import { DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies';
import { growthState } from '../src/lib/growth';
import { plantPositionCode, plantSpeciesInitials } from '../src/lib/plantIdentity';
import type { LayoutVariant } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { mockGoogleMaps } from './support/mockGoogleMaps';
import { mockPlanningApi } from './support/mockPlanningApi';
import { importSiteFixture } from './support/siteFixture';

test('labels every active plant point and opens its row-sequence identity from the map', async ({ page }) => {
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

  await page.getByTestId('step-costs').click();
  await page.evaluate(({ code }) => {
    const marker = (window as any).__growupMapMarkers.find((item: any) => item.active && item.options.title?.startsWith(`${code} · `));
    marker.emit('click', { domEvent: { shiftKey: false } });
  }, { code: expectedCode });

  const selected = page.getByTestId('selected-tree-identity');
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute('data-plant-code', expectedCode);
  await expect(selected).toContainText(firstSpecies.commonName);
  await expect(selected).toContainText(firstSpecies.scientificName);
  await expect(selected).toContainText(`Row ${expectedCode.replace(/\d+$/, '')}`);
});
