import { expect, test } from '@playwright/test';
import { WOODY_FIELD_FIXTURE } from '../test/fixtures/sites';
import type { Coordinate, DesignSpecies, LayoutVariant, SiteProfile } from '../src/types';

test('detects a known tree and rejects or protects the wooded test parcel', async ({ request }) => {
  const profileResponse = await request.post('/api/site/profile', { data: WOODY_FIELD_FIXTURE });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as SiteProfile;
  const vegetation = profile.satellite.existingVegetation;

  expect(vegetation.status).toBe('available');
  expect(vegetation.analyzedOpticalScenes).toBeGreaterThanOrEqual(4);
  expect(vegetation.woodyVegetationLayerAvailable).toBe(true);
  expect(vegetation.patches.length).toBeGreaterThanOrEqual(2);
  expect(vegetation.detectedCoverPercent).toBeGreaterThan(5);
  const knownTree = { lat: 36.92017345, lng: 14.75195536 };
  expect(vegetation.patches.some((patch) => distanceM(knownTree, patch.centroid) < 18)).toBe(true);

  const recommendationResponse = await request.post('/api/recommendations', { data: { siteProfile: profile } });
  expect(recommendationResponse.ok()).toBeTruthy();
  const recommendationPayload = await recommendationResponse.json() as { palette: DesignSpecies[] };
  const selectedSpeciesIds = recommendationPayload.palette.map((species) => species.id);

  const layoutResponse = await request.post('/api/layout/generate', {
    data: { site: WOODY_FIELD_FIXTURE, siteProfile: profile, selectedSpeciesIds },
  });
  if (vegetation.suitability === 'reject') {
    expect(layoutResponse.status()).toBe(422);
    const errorPayload = await layoutResponse.json() as { error: { status: string } };
    expect(errorPayload.error.status).toBe('SITE_WOODY_COVER_TOO_HIGH');
    return;
  }
  expect(layoutResponse.ok()).toBeTruthy();
  const { variants } = await layoutResponse.json() as { variants: LayoutVariant[] };
  expect(variants).toHaveLength(3);
  for (const variant of variants) {
    expect(variant.warnings.some((warning) => warning.includes('existing woody'))).toBe(true);
    for (const tree of variant.trees) {
      expect(vegetation.patches.some((patch) => pointInPolygon(tree.coordinate, patch.polygon))).toBe(false);
    }
  }
});

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = (currentPoint.lat > point.lat) !== (previousPoint.lat > point.lat)
      && point.lng < (previousPoint.lng - currentPoint.lng) * (point.lat - currentPoint.lat) / (previousPoint.lat - currentPoint.lat) + currentPoint.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceM(a: Coordinate, b: Coordinate) {
  const latitudeM = (a.lat - b.lat) * 111_320;
  const longitudeM = (a.lng - b.lng) * 111_320 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.hypot(latitudeM, longitudeM);
}
