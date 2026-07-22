import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('keeps the complete map-layer control keyboard-accessible on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  const toolbar = page.locator('.map-toolbar');
  const mapStage = page.locator('.map-stage');
  const [toolbarBox, mapBox] = await Promise.all([toolbar.boundingBox(), mapStage.boundingBox()]);
  expect(toolbarBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect((mapBox!.y + mapBox!.height) - (toolbarBox!.y + toolbarBox!.height)).toBeLessThanOrEqual(14);
  const toolbarButtonTops = await toolbar.locator('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(toolbarButtonTops).size).toBe(1);
  await expect(page.getByLabel('Search place or address')).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: 'Map layers' }).focus();
  await page.keyboard.press('Enter');

  const panel = page.getByTestId('map-layer-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.map-layer-toggle').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');

  const unlabeled = await page.locator('.app-shell button, .app-shell a, .app-shell input, .app-shell select, .app-shell textarea').evaluateAll((elements) => elements
    .filter((element) => {
      const htmlElement = element as HTMLElement;
      if (!htmlElement.offsetParent || htmlElement.getAttribute('aria-hidden') === 'true') return false;
      const ariaLabel = htmlElement.getAttribute('aria-label')?.trim();
      const labelledBy = htmlElement.getAttribute('aria-labelledby')?.trim();
      const title = htmlElement.getAttribute('title')?.trim();
      const text = htmlElement.textContent?.trim();
      const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent?.trim()).filter(Boolean) : [];
      return !ariaLabel && !labelledBy && !title && !text && labels.length === 0;
    })
    .map((element) => element.outerHTML.slice(0, 180)));
  expect(unlabeled).toEqual([]);

  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-mobile-layers.png', fullPage: false });
});

test('keeps map, inspector and workflow navigation usable on a tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.locator('.map-stage')).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.step-rail')).toBeVisible();
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
});

test('prevents focus zoom on a phone in landscape without disabling page zoom', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.getByLabel('Search place or address')).toHaveCSS('font-size', '16px');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
});
