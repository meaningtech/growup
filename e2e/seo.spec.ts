import { expect, test } from '@playwright/test';

test('serves indexable metadata, crawler files and the social sharing image', async ({ request }) => {
  const page = await request.get('/');
  expect(page.ok()).toBe(true);
  const html = await page.text();
  expect(html).toContain('<title>Growup — Evidence-led agroforestry planning</title>');
  expect(html).toContain('<link rel="canonical" href="https://growup.earth/"');
  expect(html).toContain('property="og:image" content="https://growup.earth/growup-social-card.png"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
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
  expect(await llms.text()).toContain('# Growup');

  const image = await request.get('/growup-social-card.png');
  expect(image.ok()).toBe(true);
  expect(image.headers()['content-type']).toContain('image/png');
  expect((await image.body()).byteLength).toBeGreaterThan(100_000);
});
