import { expect, test } from '@playwright/test';

test('submits the assistant request with Enter and keeps Shift+Enter as a line break', async ({ page }, testInfo) => {
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
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByText('Validated actions only')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a productive species suited to the site and regenerate the design.' })).toHaveCount(0);
  await expect(page.locator('.assistant-body')).toHaveCount(0);
  const compactPanelBox = await page.getByRole('complementary', { name: 'Growup AI assistant' }).boundingBox();
  expect(compactPanelBox).not.toBeNull();
  expect(compactPanelBox!.height).toBeLessThan(200);
  await page.screenshot({ path: testInfo.outputPath('growup-assistant-compact.png'), fullPage: false });
  const composer = page.getByRole('textbox', { name: 'Ask' });
  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('Second line');
  await expect(composer).toHaveValue('First line\nSecond line');
  expect(submittedMessage).toBe('');

  await composer.press('Enter');
  await expect(page.getByTestId('assistant-proposal')).toContainText('Keyboard request received');
  expect(submittedMessage).toBe('First line\nSecond line');
});
