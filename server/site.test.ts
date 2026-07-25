import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { polygonCentroid } from '../src/lib/geometry.js';
import { siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import { fetchSoil, fetchSolarWeather, reverseGeocodeLocation, terrainSamplingPoints } from './site.js';

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

describe('Open-Meteo wind climatology provider', () => {
  it('retains annual and seasonal direction distributions from hourly wind observations', async () => {
    const time = [
      '2021-01-01T00:00', '2021-01-01T01:00',
      '2021-04-01T00:00', '2021-04-01T01:00',
      '2021-07-01T00:00', '2021-07-01T01:00',
      '2021-10-01T00:00', '2021-10-01T01:00',
    ];
    const speeds = [0.2, 4, 3, 5, 6, 4, 5, 2];
    const directions = [0, 315, 315, 315, 315, 315, 315, 90];
    const requests: URL[] = [];
    const profile = await fetchSolarWeather({ lat: 36.92, lng: 14.75 }, async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      return new Response(JSON.stringify({
        hourly: {
          time,
          direct_normal_irradiance: time.map(() => 300),
          diffuse_radiation: time.map(() => 80),
          shortwave_radiation: time.map(() => 260),
          wind_speed_10m: speeds,
          wind_direction_10m: directions,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, {
      openMeteoArchiveUrl: 'https://weather.example.test/archive',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('hourly')).toContain('wind_speed_10m');
    expect(requests[0].searchParams.get('hourly')).toContain('wind_direction_10m');
    expect(profile).toEqual(expect.objectContaining({
      status: 'available',
      prevailingWindDirectionLabel: 'NW',
      windSpeedP90Ms: 6,
      calmWindFrequencyPercent: 12.5,
      windClimatology: expect.any(Array),
    }));
    expect(profile.windClimatology).toHaveLength(5);
    const annual = profile.windClimatology?.find((item) => item.period === 'annual');
    expect(annual).toEqual(expect.objectContaining({
      prevailingDirectionLabel: 'NW',
      sampleCount: 8,
      calmFrequencyPercent: 12.5,
    }));
    expect(annual?.sectors.find((sector) => sector.directionLabel === 'NW')).toEqual(expect.objectContaining({
      frequencyPercent: 75,
      sampleCount: 6,
    }));
    expect(profile.windClimatology?.find((item) => item.period === 'summer')).toEqual(expect.objectContaining({
      sampleCount: 2,
      prevailingDirectionLabel: 'NW',
    }));
  });
});

describe('SoilGrids composition provider', () => {
  it('normalizes chemical and physical properties with prediction intervals and provenance', async () => {
    const rawByCoverage: Record<string, number> = {
      'phh2o_0-5cm_mean': 72,
      'phh2o_0-5cm_Q0.05': 65,
      'phh2o_0-5cm_Q0.95': 79,
      'sand_0-5cm_mean': 340,
      'silt_0-5cm_mean': 400,
      'clay_0-5cm_mean': 260,
      'soc_0-5cm_mean': 180,
      'soc_0-5cm_Q0.05': 100,
      'soc_0-5cm_Q0.95': 280,
      'nitrogen_0-5cm_mean': 150,
      'nitrogen_0-5cm_Q0.05': 80,
      'nitrogen_0-5cm_Q0.95': 240,
      'cec_0-5cm_mean': 220,
      'cec_0-5cm_Q0.05': 140,
      'cec_0-5cm_Q0.95': 300,
      'bdod_0-5cm_mean': 135,
      'cfvo_0-5cm_mean': 80,
      'ocs_0-30cm_mean': 45,
      'wv0033_0-5cm_mean': 310,
      'wv1500_0-5cm_mean': 140,
    };
    const requests: URL[] = [];
    const soil = await fetchSoil(TEMPERATE_OPEN_FIELD_FIXTURE.polygon, async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const coverageId = url.searchParams.get('COVERAGEID') ?? '';
      const raw = rawByCoverage[coverageId];
      if (raw === undefined) return new Response(null, { status: 404 });
      const tiff = writeArrayBuffer(new Uint16Array([raw]), {
        width: 1,
        height: 1,
        ModelPixelScale: [1, 1, 0],
        ModelTiepoint: [0, 0, 0, 0, 0, 0],
        GeographicTypeGeoKey: 4326,
      });
      return new Response(tiff, { status: 200, headers: { 'Content-Type': 'image/tiff' } });
    }, {
      soilGridsWcsUrl: 'https://soil.example.test/mapserv',
      now: () => new Date('2026-07-25T08:00:00.000Z'),
    });

    expect(requests).toHaveLength(20);
    expect(requests.every((url) => url.searchParams.get('SERVICE') === 'WCS')).toBe(true);
    expect(soil).toEqual(expect.objectContaining({
      status: 'available',
      ph: 7.2,
      sandPercent: 34,
      siltPercent: 40,
      clayPercent: 26,
      organicCarbonGKg: 18,
      textureClass: 'loam',
      reactionClass: 'neutral',
      carbonNitrogenRatio: 12,
      evidence: expect.objectContaining({
        source: 'ISRIC SoilGrids WCS',
        sourceUrl: 'https://soil.example.test/mapserv',
        observedAt: '2026-07-25T08:00:00.000Z',
        resolution: expect.stringContaining('250 m'),
      }),
    }));
    expect(soil.properties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'ph',
        value: 7.2,
        unit: 'pH',
        depthTopCm: 0,
        depthBottomCm: 5,
        predictionInterval90: { low: 6.5, high: 7.9 },
        estimateType: 'modelled-mean',
      }),
      expect.objectContaining({
        key: 'total-nitrogen',
        value: 1.5,
        unit: 'g/kg',
        predictionInterval90: { low: 0.8, high: 2.4 },
      }),
      expect.objectContaining({ key: 'cation-exchange-capacity', value: 22 }),
      expect.objectContaining({ key: 'bulk-density', value: 1.35 }),
      expect.objectContaining({ key: 'organic-carbon-stock', value: 4.5, depthBottomCm: 30 }),
      expect.objectContaining({ key: 'plant-available-water', value: 17, estimateType: 'derived-from-modelled' }),
      expect.objectContaining({ key: 'carbon-nitrogen-ratio', value: 12, estimateType: 'derived-from-modelled' }),
    ]));
    expect(soil.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('not laboratory measurements'),
      expect.stringContaining('phosphorus, potassium'),
    ]));
  });
});
