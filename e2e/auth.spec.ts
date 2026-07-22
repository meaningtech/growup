import { expect, test } from '@playwright/test';

test('loads the real optional Google sign-in client without exposing server credentials', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  const config = await (await page.request.get('/api/config')).json() as { auth: { configured: boolean; googleClientId: string } };
  expect(config.auth.configured).toBe(true);
  expect(config.auth.googleClientId).toMatch(/\.apps\.googleusercontent\.com$/);
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  await signIn.click();
  const dialog = page.getByRole('dialog', { name: 'Keep every field design together.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Google OAuth client pending')).toHaveCount(0);
  const googleFrame = dialog.locator('.google-signin iframe');
  await expect(googleFrame).toHaveCount(1, { timeout: 15_000 });
  await expect(googleFrame).toHaveAttribute('src', /accounts\.google\.com\/gsi\/button/);
  const googleArea = dialog.locator('.google-signin');
  await expect(googleArea).toBeVisible();
  const buttonBounds = await googleArea.boundingBox();
  expect(buttonBounds?.width).toBeGreaterThanOrEqual(300);
  expect(buttonBounds?.height).toBeGreaterThanOrEqual(40);
  await expect(dialog.getByText('Only your verified Google identity and Growup projects are stored.')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-google-login.png', fullPage: false });

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Continue with Google/ }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/accounts\.google\.com/);
  await popup.close();

  const unexpectedResponses = failedResponses.filter((item) => !item.startsWith('403 https://accounts.google.com/gsi/button?'));
  expect(unexpectedResponses, failedResponses.join('\n')).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !message.includes('Google Maps JavaScript API has been loaded directly') &&
    !message.includes('Failed to load resource: the server responded with a status of 403'),
  );
  expect(unexpectedConsoleErrors, consoleErrors.join('\n')).toEqual([]);
});
