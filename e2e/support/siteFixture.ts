import type { Page } from '@playwright/test';
import type { SiteBoundary } from '../../src/types';

export function siteFixtureGeoJson(site: SiteBoundary) {
  const ring = (points: SiteBoundary['polygon']) => [
    ...points.map((point) => [point.lng, point.lat]),
    [points[0].lng, points[0].lat],
  ];
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: 'site', id: site.id, name: site.name, setbackM: site.setbackM },
      geometry: { type: 'Polygon', coordinates: [ring(site.polygon)] },
    }],
  };
}

export async function importSiteFixture(page: Page, site: SiteBoundary) {
  await page.locator('input[type="file"][accept*="geojson"]').setInputFiles({
    name: `${site.id}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify(siteFixtureGeoJson(site))),
  });
}
