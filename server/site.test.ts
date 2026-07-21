import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { polygonCentroid } from '../src/lib/geometry.js';
import { siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import { terrainSamplingPoints } from './site.js';

describe('terrain sampling', () => {
  it.each([TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE])('covers the interior of $name with a dense field-clipped grid', (site) => {
    const points = terrainSamplingPoints(site);
    const centroid = polygonCentroid(site.polygon);

    expect(points.length).toBeGreaterThan(35);
    expect(points.some((point) => Math.abs(point.lat - centroid.lat) < 1e-9 && Math.abs(point.lng - centroid.lng) < 1e-9)).toBe(true);
    expect(points.every((point) => siteContainsCoordinate(site, point))).toBe(true);
    expect(new Set(points.map((point) => `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`)).size).toBe(points.length);
  });
});
