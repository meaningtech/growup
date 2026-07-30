import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { polygonCentroid } from '../src/lib/geometry.js';
import { siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import { fetchDepthToBedrock, fetchGroundwaterContext, fetchSoil, fetchSolarWeather, reverseGeocodeLocation, terrainSamplingPoints } from './site.js';

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
    for (const [index, depth] of ['5-15cm', '15-30cm', '30-60cm', '60-100cm', '100-200cm'].entries()) {
      rawByCoverage[`phh2o_${depth}_mean`] = 73 + index;
      rawByCoverage[`soc_${depth}_mean`] = 150 - index * 20;
      rawByCoverage[`clay_${depth}_mean`] = 270 + index * 15;
      rawByCoverage[`cfvo_${depth}_mean`] = 90 + index * 10;
      rawByCoverage[`bdod_${depth}_mean`] = 138 + index * 3;
    }
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

    expect(requests).toHaveLength(45);
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
        retrievedAt: '2026-07-25T08:00:00.000Z',
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
    expect(soil.verticalProfile).toHaveLength(6);
    expect(soil.verticalProfile?.[5]).toEqual(expect.objectContaining({
      depthTopCm: 100,
      depthBottomCm: 200,
      ph: 7.7,
      organicCarbonGKg: 7,
      clayPercent: 33,
      coarseFragmentsPercent: 13,
      bulkDensityKgDm3: 1.5,
    }));
    expect(soil.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('not laboratory measurements'),
      expect.stringContaining('phosphorus, potassium'),
    ]));
  });
});

describe('subsurface evidence providers', () => {
  it('summarizes sampled model cells without presenting them as field measurements', async () => {
    const points = terrainSamplingPoints(TEMPERATE_OPEN_FIELD_FIXTURE);
    const depth = await fetchDepthToBedrock(points, {
      depthToBedrockUrl: 'https://soil.example.test/depth.tif',
      now: () => new Date('2026-07-25T09:00:00.000Z'),
      depthToBedrockSampler: async (coordinates) => coordinates.slice(0, 4).map((coordinate, index) => ({
        coordinate,
        depthM: [0.8, 1.2, 2.4, 3.6][index],
        cellBounds: {
          south: coordinate.lat - 0.001,
          north: coordinate.lat + 0.001,
          west: coordinate.lng - 0.001,
          east: coordinate.lng + 0.001,
        },
      })),
    });

    expect(depth).toEqual(expect.objectContaining({
      status: 'available',
      modelledDepthM: 1.8,
      minimumDepthM: 0.8,
      maximumDepthM: 3.6,
      evidence: expect.objectContaining({
        source: expect.stringContaining('depth-to-bedrock'),
        publishedAt: '2017-03-10',
        retrievedAt: '2026-07-25T09:00:00.000Z',
      }),
    }));
    expect(depth.limitations.join(' ')).toContain('not measured effective rooting depth');
  });

  it('retains WHYMAP aquifer and recharge classes as regional context', async () => {
    const groundwater = await fetchGroundwaterContext({ lat: 37.5, lng: 14.5 }, async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/groundwater/11/query');
      expect(url.searchParams.get('geometry')).toBe('14.5,37.5');
      return new Response(JSON.stringify({
        features: [{
          attributes: {
            aquif_type: 'complex hydrogeological structures',
            recharge: 'medium (20 - 100)',
            HYGEO2: 23,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, {
      groundwaterMapServerUrl: 'https://water.example.test/groundwater',
      now: () => new Date('2026-07-25T10:00:00.000Z'),
    });

    expect(groundwater).toEqual(expect.objectContaining({
      status: 'available',
      aquiferType: 'complex hydrogeological structures',
      rechargeClass: 'medium (20 - 100)',
      resourceClass: 'complex hydrogeological structure',
      mapLayerId: 11,
      evidence: expect.objectContaining({
        source: 'BGR / UNESCO WHYMAP',
        retrievedAt: '2026-07-25T10:00:00.000Z',
      }),
    }));
    expect(groundwater.limitations.join(' ')).toContain('not water-table depth');
  });
});
