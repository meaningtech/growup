import { expect, test } from '@playwright/test';

test('submits Ask AF with Enter and keeps Shift+Enter as a line break', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, assistant: { configured: true, interface: 'openai-compatible' } } });
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
