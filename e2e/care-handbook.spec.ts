import { expect, test } from '@playwright/test';

test('opens the last-step care handbook as an empty state until a design exists', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('step-care').click();
  await expect(page.getByTestId('care-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Generate a design first' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open design' })).toBeVisible();
});

test('keeps the nine workflow labels inside the mobile rail', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.getByTestId('step-care')).toContainText('Care');
  const labelsFit = await page.locator('.step-rail button > span:last-child').evaluateAll((labels) => labels.every((label) => {
    const labelBox = label.getBoundingClientRect();
    const buttonBox = label.parentElement?.getBoundingClientRect();
    return Boolean(buttonBox && labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right + 0.5);
  }));
  expect(labelsFit).toBe(true);
  await expect(page.locator('.step-rail button')).toHaveCount(9);
});
