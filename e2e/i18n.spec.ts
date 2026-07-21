import { expect, test } from '@playwright/test';

test('switches English and Italian through an extensible persisted locale', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Language')).toBeVisible();
  await page.getByLabel('Language').selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await expect(page.getByRole('button', { name: 'Analizza questo terreno' })).toBeVisible();

  await page.getByTestId('step-species').click();
  await expect(page.getByLabel('Sistema di impianto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solo perimetro' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await page.getByLabel('Lingua').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('step-site')).toContainText('Site');
});
