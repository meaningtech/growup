import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('uses the configured AI provider to propose and apply a confirmed species change', async ({ page }) => {
  const configResponse = await page.request.get('/api/config');
  const config = await configResponse.json();
  test.skip(!config.assistant?.configured, 'The AI assistant is not configured on this server.');

  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analyse this field' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyse this field' }).click();
  await expect(page.getByText('02 · Multi-source evidence')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('step-species').click();
  await page.getByRole('button', { name: /Generate three evidence-scored designs/ }).click();
  await expect(page.getByText('3 reproducible layouts generated.')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Ask AF' }).click();
  await expect(page.getByRole('complementary', { name: 'Growup AI assistant' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask AF' }).fill(
    'Aggiungi Olea europaea alla selezione, rigenera i tre layout e ricalcola acqua e costi. Non rimuovere specie.',
  );
  await page.getByRole('button', { name: 'Send to AI assistant' }).click();
  await expect(page.getByTestId('assistant-proposal')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Changes awaiting confirmation')).toBeVisible();
  await expect(page.getByText('Add Olive')).toBeVisible();
  await page.screenshot({ path: '/private/tmp/growup-checkpoint-assistant.png', fullPage: false });

  await page.getByRole('button', { name: 'Apply validated changes' }).click();
  await expect(page.getByText('AI proposal validated and applied to the Growup project.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('assistant-proposal')).toHaveCount(0);
  await page.getByTestId('step-species').click();
  await expect(page.getByText('10 species selected. Configure plants, fire access and working equipment in one place.')).toBeVisible();
  await page.getByTestId('step-costs').click();
  await expect(page.getByText('Establishment total')).toBeVisible();
  await expect(page.getByText('Water + operation · year 5')).toBeVisible();
});
