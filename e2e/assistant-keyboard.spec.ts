import { expect, test } from '@playwright/test';

test('submits Ask AF with Enter and keeps Shift+Enter as a line break', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        googleMapsApiKey: '',
        initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
        climatePeriod: '2021–2025',
        modelVersion: 'test',
        assistant: { configured: true, interface: 'openai-compatible' },
        auth: { configured: false, googleClientId: '' },
      },
    });
  });
  await page.route('**/api/catalog/stats', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', json: { total: 1, treeLike: 1, globUnt: 1, designReady: 1, sources: [] } });
  });
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', json: { authenticated: false, configured: false, user: null } });
  });
  let submittedMessage = '';
  await page.route('**/api/assistant/plan', async (route) => {
    submittedMessage = (await route.request().postDataJSON() as { message: string }).message;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        id: 'keyboard-test',
        model: 'test-provider',
        summary: 'Keyboard request received',
        rationale: 'The request was submitted from the composer.',
        warnings: [],
        actions: [],
        requiresConfirmation: false,
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Ask AF' }).click();
  const composer = page.getByRole('textbox', { name: 'Ask AF' });
  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Second line');
  await expect(composer).toHaveValue('First line\nSecond line');
  expect(submittedMessage).toBe('');

  await composer.press('Enter');
  await expect(page.getByTestId('assistant-proposal')).toContainText('Keyboard request received');
  expect(submittedMessage).toBe('First line\nSecond line');
});
