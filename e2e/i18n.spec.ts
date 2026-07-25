import { expect, test } from '@playwright/test';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('switches English and Italian through an extensible persisted locale', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Language')).toBeVisible();
  await page.getByLabel('Language').selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await expect(page.getByText('Nessun terreno attivo')).toBeVisible();
  await expect(page.getByText('Importa GeoJSON', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chiedi AF' })).toBeVisible();

  await page.getByTestId('step-profile').click();
  await expect(page.getByRole('heading', { name: 'Nessun profilo di evidenze' })).toBeVisible();

  await page.getByTestId('step-layout').click();
  await expect(page.getByRole('heading', { name: 'Nessun sistema generato' })).toBeVisible();

  await page.getByTestId('step-water').click();
  await expect(page.getByRole('heading', { name: 'Impianto irriguo non dimensionato' })).toBeVisible();

  await page.getByTestId('step-costs').click();
  await expect(page.getByTestId('economic-configuration')).toContainText('Profilo economico · XX');
  await expect(page.getByLabel('Codice valuta')).toHaveValue('USD');
  await expect(page.getByLabel('Costo manodopera')).toHaveValue('18');
  await expect(page.getByText(/Stima globale di pianificazione in USD/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nessun piano dei costi' })).toBeVisible();

  await page.getByTestId('step-species').click();
  await expect(page.getByLabel('Sistema di impianto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solo perimetro' })).toBeVisible();
  await expect(page.getByPlaceholder('Cerca un genere o nome scientifico')).toHaveValue('');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await page.getByLabel('Lingua').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('step-site')).toContainText('Site');
});

test('renders live field evidence, Sentinel notices and source traceability entirely in Italian', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('it');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analizza questo terreno' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analizza questo terreno' }).click();

  await expect(page.getByText('02 · Evidenze multi-sorgente')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Satellite/ }).click();
  await expect(page.getByText('Acqua del terreno da Sentinel')).toBeVisible();
  await expect(page.getByText(/Pixel liberi da nuvole del/)).toBeVisible();
  await expect(page.getByText(/Evidenze pronte:/)).toBeVisible();
  await page.getByRole('tab', { name: /Fonti/ }).click();
  const traceability = page.getByTestId('evidence-traceability');
  await expect(traceability).toContainText('Dato letto');
  await expect(traceability).toContainText('Calcolo Growup');
  await expect(traceability).toContainText('Decisione influenzata');
  await expect(traceability.locator('a')).not.toHaveCount(0);
});
