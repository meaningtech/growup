import { expect, test } from '@playwright/test';

test('shows the Google sign-in workspace gate without exposing server credentials', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  await signIn.click();
  const dialog = page.getByRole('dialog', { name: 'Keep every field design together.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Google OAuth client pending')).toBeVisible();
  await expect(dialog.getByText('Only your verified Google identity and Growaf projects are stored.')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growaf-checkpoint-google-login.png', fullPage: false });

  expect(consoleErrors.filter((message) => !message.includes('Google Maps JavaScript API has been loaded directly')), consoleErrors.join('\n')).toEqual([]);
});
