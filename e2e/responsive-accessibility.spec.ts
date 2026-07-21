import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('keeps the complete map-layer control keyboard-accessible on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
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
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-mobile-layers.png', fullPage: false });
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
