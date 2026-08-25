import { expect, test } from '@playwright/test';

test('serves indexable metadata, crawler files and the social sharing image', async ({ request }) => {
  const page = await request.get('/');
  expect(page.ok()).toBe(true);
  const html = await page.text();
  expect(html).toContain('<title>GrowUp - Data driven agroforestry planning</title>');
  expect(html).toContain('<link rel="canonical" href="https://growup.earth/"');
  expect(html).toContain('property="og:image" content="https://growup.earth/growup-social-card-v2.jpg"');
  expect(html).toContain('property="og:image:type" content="image/jpeg"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('name="twitter:site" content="@turinglabsorg"');
  expect(html).toContain('<h1>Data driven agroforestry planning</h1>');
  expect(html).toContain('<h2 id="seo-about-title">From field boundary to buildable plan</h2>');
  expect(html).toContain('<h2 id="seo-sources-title">Data sources</h2>');
  expect(html).toContain('Open-Meteo');
  expect(html).toContain('SoilGrids');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"');
  expect(html).toContain('<link rel="manifest" href="/site.webmanifest"');
  expect(html).toContain('type="application/ld+json"');

  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toContain('Sitemap: https://growup.earth/sitemap.xml');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://growup.earth/</loc>');

  const llms = await request.get('/llms.txt');
  expect(llms.ok()).toBe(true);
  expect(await llms.text()).toContain('# GrowUp');

  const image = await request.get('/growup-social-card-v2.jpg');
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/jpeg');
  if (process.env.GROWUP_BASE_URL) expect(image.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  const imageSize = (await image.body()).byteLength;
  expect(imageSize).toBeGreaterThan(50_000);
  expect(imageSize).toBeLessThan(500_000);

  const favicon = await request.get('/favicon-32x32.png');
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()['content-type']).toContain('image/png');

  const appleTouchIcon = await request.get('/apple-touch-icon.png');
  expect(appleTouchIcon.ok()).toBe(true);
  expect(appleTouchIcon.headers()['content-type']).toContain('image/png');

  const manifest = await request.get('/site.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  expect(await manifest.json()).toMatchObject({ name: 'GrowUp - Data driven agroforestry planning', short_name: 'GrowUp', start_url: '/' });
});

test('keeps product information behind an explicit control on a computer', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  await expect(page.getByTestId('info-landing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Info' }).click();
  const panel = page.getByTestId('info-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Data driven agroforestry planning.' })).toBeVisible();
  await expect(panel).toContainText('Read the land');
  await expect(panel).toContainText('Design the system');
  await expect(panel).toContainText('Prepare implementation');
  await expect(panel).toContainText('Open-Meteo Historical Weather API');
  await expect(panel).toContainText('ISRIC SoilGrids');
  await expect(panel).toContainText('Copernicus Sentinel-2 L2A');
  await expect(panel).toContainText('GrowUp supports planning decisions');
  const repository = panel.getByRole('link', { name: /GrowUp is open source/ });
  await expect(repository).toHaveAttribute('href', 'https://github.com/meaningtech/growup');
  await expect(panel).toHaveAttribute('role', 'dialog');
  await page.screenshot({ path: testInfo.outputPath('growup-info-desktop.png'), fullPage: false });
  await panel.getByRole('button', { name: 'Close information' }).click();
  await expect(panel).toHaveCount(0);
});
