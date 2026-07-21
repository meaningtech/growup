import { expect, test } from '@playwright/test';

test('renders the real Ragusa Ibla site on Google satellite imagery', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeVisible();
  await expect(page.locator('.gm-style')).toBeVisible();
  await expect(page.getByText('Oops! Something went wrong.')).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveCSS('height', '68px');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-initial.png', fullPage: false });

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes('Google Maps JavaScript API has been loaded directly')), consoleErrors.join('\n')).toEqual([]);
});
