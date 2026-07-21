import { expect, test } from '@playwright/test';

test('completes evidence, design, irrigation and costs, then protects persistence behind sign-in', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByText('02 · Multi-source evidence')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Sentinel field water')).toBeVisible();
  await expect(page.getByTestId('existing-vegetation-audit')).toBeVisible();
  await expect(page.getByText('0 protected patches')).toBeVisible();
  await expect(page.getByText('Sentinel-1:', { exact: false })).toBeVisible();
  await expect(page.locator('.satellite-image img')).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-evidence.png', fullPage: false });

  await page.getByTestId('step-species').click();
  await expect(page.getByText('Evidence-ranked palette')).toBeVisible();
  await expect(page.getByText('species selected across strata', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await expect(page.getByText('3 reproducible layouts generated.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.variant-tabs button')).toHaveCount(3);
  await expect(page.getByText('Canopy Y20')).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-design.png', fullPage: false });

  await page.getByRole('button', { name: 'Size water + calculate costs' }).click();
  await expect(page.getByText('05 · Water balance')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Current satellite scheduling')).toBeVisible();
  await expect(page.getByText('Annual OPEX')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-water.png', fullPage: false });

  await page.getByRole('button', { name: 'Review complete cost plan' }).click();
  await expect(page.getByText('Establishment total')).toBeVisible();
  await expect(page.getByText('Planting labour', { exact: false })).toBeVisible();
  await expect(page.getByText('Annual water + operation')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-costs.png', fullPage: false });

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'Keep every field design together.' })).toBeVisible();
  await expect(page.getByText('Sign in with Google before saving this project.')).toBeVisible();
  const exportLink = page.locator('a.button').filter({ hasText: 'GeoJSON' });
  await expect(exportLink).toHaveCount(1);
  await expect(exportLink).not.toHaveAttribute('href', /.+/);
  const projectsResponse = await page.request.get('/api/projects');
  expect(projectsResponse.status()).toBe(401);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('Google Maps JavaScript API has been loaded directly')), consoleErrors.join('\n')).toEqual([]);
});
