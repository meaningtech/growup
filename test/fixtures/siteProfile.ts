import { unavailableSatelliteProfile } from '../../server/sentinel';
import { polygonAreaM2, polygonCentroid, polygonPerimeterM } from '../../src/lib/geometry';
import type { Evidence, SiteBoundary, SiteProfile } from '../../src/types';

const observedAt = '2026-07-21T00:00:00.000Z';

export function openFieldProfile(site: SiteBoundary, countryCode = 'XZ'): SiteProfile {
  const centroid = polygonCentroid(site.polygon);
  const source = (name: string): Evidence => ({
    source: name,
    sourceUrl: 'https://example.test/source',
    version: 'fixture-1',
    observedAt,
    confidence: 'medium',
    resolution: 'test fixture',
  });
  const satellite = unavailableSatelliteProfile(new Date(observedAt));
  satellite.status = 'available';
  satellite.existingVegetation = {
    ...satellite.existingVegetation,
    status: 'available',
    suitability: 'clear-with-exclusions',
    analyzedOpticalScenes: 5,
    detectedCoverPercent: 0,
    protectedCoverPercent: 0,
    maximumAcceptedCoverPercent: 25,
    patches: [],
    evidence: [source('Existing vegetation fixture')],
    conclusion: 'No persistent woody vegetation was included in this open-field fixture.',
  };
  return {
    generatedAt: observedAt,
    centroid,
    areaM2: polygonAreaM2(site.polygon),
    perimeterM: polygonPerimeterM(site.polygon),
    location: {
      displayName: 'Open field fixture',
      municipality: null,
      province: null,
      region: null,
      countryCode,
      evidence: source('Location fixture'),
    },
    terrain: {
      elevationMeanM: 120,
      elevationMinM: 115,
      elevationMaxM: 126,
      slopePercent: 6,
      aspectDegrees: 135,
      aspectLabel: 'SE',
      samples: site.polygon.map((coordinate, index) => ({ ...coordinate, elevationM: 126 - index })),
      evidence: source('Terrain fixture'),
    },
    climate: {
      period: '2021–2025',
      meanTemperatureC: 19,
      absoluteMinTemperatureC: -1,
      absoluteMaxTemperatureC: 39,
      annualPrecipitationMm: 720,
      annualEt0Mm: 1_100,
      aridityIndex: 0.65,
      monthly: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        temperatureC: 13 + index,
        precipitationMm: index < 4 || index > 8 ? 80 : 30,
        et0Mm: index < 4 || index > 8 ? 60 : 140,
      })),
      evidence: source('Climate fixture'),
    },
    solar: {
      status: 'unavailable',
      period: '2021–2025',
      annualGlobalHorizontalKwhM2: 0,
      annualDirectNormalKwhM2: 0,
      prevailingWindDirectionDegrees: null,
      prevailingWindDirectionLabel: null,
      meanWindSpeedMs: null,
      hourlyClimatology: [],
      evidence: source('Solar fixture'),
      limitations: ['No hourly solar fixture.'],
    },
    soil: {
      ph: 6.8,
      sandPercent: 38,
      siltPercent: 37,
      clayPercent: 25,
      organicCarbonGKg: 20,
      textureClass: 'loam',
      evidence: source('Soil fixture'),
      status: 'available',
    },
    landCover: {
      classification: 'cropland',
      osmTags: { landuse: 'farmland' },
      evidence: source('Land-cover fixture'),
    },
    satellite,
    warnings: [],
  };
}
