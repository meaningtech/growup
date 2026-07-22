import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.querySelector('.app-shell')) && !document.querySelector('.toast .spin'));
  await page.evaluate(() => window.localStorage.removeItem('growup:onboarding:v1'));
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('growup:onboarding:v1'))).toBeNull();
  await page.reload();
});

test('guides a first-time visitor into a resumable project setup', async ({ page }) => {
  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toContainText('Turn a field into a buildable plan.');
  await tour.getByLabel('Project name').fill('North field transition');
  await tour.getByRole('button', { name: 'Create my project' }).click();
  await expect(tour).toContainText('Start from the right place.');
  await page.reload();
  await expect(tour).toContainText('Start from the right place.');
  await expect(page.getByLabel('Project name')).toHaveValue('North field transition');
  await tour.locator('.onboarding-skip').click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Tour' }).click();
  await expect(tour).toContainText('Turn a field into a buildable plan.');
});

test('keeps the tour usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const tour = page.getByTestId('onboarding-tour');
  await expect(tour).toBeVisible();
  const box = await tour.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-mobile-onboarding.png', fullPage: false });
});
