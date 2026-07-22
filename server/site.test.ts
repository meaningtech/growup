import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { polygonCentroid } from '../src/lib/geometry.js';
import { siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import { reverseGeocodeLocation, terrainSamplingPoints } from './site.js';

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

describe('location provider resilience', () => {
  it('falls back to server-side Google reverse geocoding without exposing the key in evidence', async () => {
    const result = await reverseGeocodeLocation({ lat: 1.0806, lng: 34.175 }, {
      googleMapsServerApiKey: 'server-only-geocoding-key',
      now: () => new Date('2026-07-22T12:00:00.000Z'),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'nominatim.openstreetmap.org') return new Response(null, { status: 503 });
        expect(url.hostname).toBe('maps.googleapis.com');
        expect(url.searchParams.get('key')).toBe('server-only-geocoding-key');
        return new Response(JSON.stringify({
          status: 'OK',
          results: [{
            place_id: 'google-place-1',
            formatted_address: 'Sample locality, Sample region',
            geometry: { location: { lat: 1.0806, lng: 34.175 } },
            address_components: [
              { long_name: 'Sample locality', short_name: 'Sample locality', types: ['locality'] },
              { long_name: 'Sample region', short_name: 'SR', types: ['administrative_area_level_1'] },
              { long_name: 'Sample country', short_name: 'XZ', types: ['country'] },
            ],
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    expect(result).toEqual(expect.objectContaining({
      displayName: 'Sample locality, Sample region',
      municipality: 'Sample locality',
      region: 'Sample region',
      countryCode: 'XZ',
      evidence: expect.objectContaining({ source: 'Google Maps Geocoding API', observedAt: '2026-07-22T12:00:00.000Z' }),
    }));
    expect(result.evidence.sourceUrl).not.toContain('server-only-geocoding-key');
  });
});
