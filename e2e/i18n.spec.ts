import { expect, test } from '@playwright/test';
import { DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';

test('switches English and Italian through an extensible persisted locale', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const languagePicker = page.getByRole('dialog', { name: 'Menu' }).getByRole('group', { name: 'Language' });
  await expect(languagePicker).toBeVisible();
  await languagePicker.getByRole('button', { name: 'Italiano' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await expect(page.getByText('Nessun terreno attivo')).toBeVisible();
  await expect(page.getByText('Importa GeoJSON', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chiedi' })).toBeVisible();

  await page.getByTestId('step-profile').click();
  await expect(page.getByRole('heading', { name: 'Nessun profilo di evidenze' })).toBeVisible();

  await page.getByTestId('step-layout').click();
  await expect(page.getByTestId('step-layout')).toContainText('Piano');
  await expect(page.getByRole('heading', { name: 'Nessun sistema generato' })).toBeVisible();

  await page.getByTestId('step-water').click();
  await expect(page.getByRole('heading', { name: 'Impianto irriguo non dimensionato' })).toBeVisible();
  await expect(page.getByTestId('water-tabs').getByRole('tab')).toHaveCount(4);
  await page.getByTestId('water-tab-configuration').click();
  await expect(page.getByTestId('water-configuration')).toBeVisible();

  await page.getByTestId('step-costs').click();
  await expect(page.getByTestId('cost-tabs').getByRole('tab')).toHaveCount(4);
  await page.getByTestId('costs-tab-parameters').click();
  await expect(page.getByTestId('economic-configuration')).toContainText('Profilo economico · XX');
  await expect(page.getByLabel('Codice valuta')).toHaveValue('USD');
  await expect(page.getByLabel('Costo manodopera')).toHaveValue('18');
  await expect(page.getByText(/Tariffe di pianificazione stimate per l’area del progetto/)).toBeVisible();
  await page.getByTestId('costs-tab-summary').click();
  await expect(page.getByRole('heading', { name: 'Nessun piano dei costi' })).toBeVisible();

  await page.getByTestId('step-species').click();
  await expect(page.getByTestId('step-species')).toContainText('Progetta');
  await expect(page.getByTestId('step-fire')).toContainText('Incendi');
  await expect(page.getByTestId('step-analysis')).toContainText('Analisi');
  await expect(page.getByRole('tab', { name: 'Specie' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Tagliafuoco' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Mezzi di lavoro' })).toBeVisible();
  await expect(page.getByTestId('recommendation-basis')).toContainText(`catalogo curato di ${DESIGN_SPECIES_BY_ID.size} specie`);
  await expect(page.getByLabel('Sistema di impianto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solo perimetro' })).toBeVisible();
  await expect(page.getByPlaceholder('Cerca un genere o nome scientifico')).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  const workflowLabelsFit = await page.locator('.step-rail button > span:last-child').evaluateAll((labels) => labels.every((label) => {
    const labelBox = label.getBoundingClientRect();
    const buttonBox = label.parentElement?.getBoundingClientRect();
    return Boolean(buttonBox && labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right);
  }));
  expect(workflowLabelsFit).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-italian-workflow.png'), fullPage: false });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('step-site')).toContainText('Terreno');
  await page.getByRole('button', { name: 'Apri menu' }).click();
  const italianLanguagePicker = page.getByRole('dialog', { name: 'Menu' }).getByRole('group', { name: 'Lingua' });
  await expect(italianLanguagePicker.getByRole('button', { name: 'Italiano' })).toHaveAttribute('aria-pressed', 'true');
  await italianLanguagePicker.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('step-site')).toContainText('Site');
});

test('renders live field evidence, Sentinel notices and source traceability entirely in Italian', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Italiano' }).click();
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
