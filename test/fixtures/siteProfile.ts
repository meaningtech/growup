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
  const soilEvidence = source('ISRIC SoilGrids WCS');
  soilEvidence.sourceUrl = 'https://docs.isric.org/globaldata/soilgrids/index.html';
  soilEvidence.version = 'SoilGrids 2.0 modelled means and 90% prediction intervals';
  soilEvidence.resolution = '250 m; 0–5 cm unless labelled otherwise';
  const soilProperty = (
    key: NonNullable<SiteProfile['soil']['properties']>[number]['key'],
    category: NonNullable<SiteProfile['soil']['properties']>[number]['category'],
    value: number,
    unit: string,
    predictionInterval90: { low: number; high: number } | null = null,
    depthBottomCm = 5,
    estimateType: NonNullable<SiteProfile['soil']['properties']>[number]['estimateType'] = 'modelled-mean',
  ): NonNullable<SiteProfile['soil']['properties']>[number] => ({
    key,
    category,
    value,
    unit,
    depthTopCm: 0,
    depthBottomCm,
    predictionInterval90,
    estimateType,
    evidence: { ...soilEvidence },
  });
  const windPeriod = (
    period: NonNullable<SiteProfile['solar']['windClimatology']>[number]['period'],
    direction: number,
    label: NonNullable<SiteProfile['solar']['windClimatology']>[number]['prevailingDirectionLabel'],
    mean: number,
    p90: number,
    calm: number,
    frequencies: number[],
  ): NonNullable<SiteProfile['solar']['windClimatology']>[number] => ({
    period,
    prevailingDirectionDegrees: direction,
    prevailingDirectionLabel: label,
    meanSpeedMs: mean,
    speedP90Ms: p90,
    calmFrequencyPercent: calm,
    sampleCount: 8_760,
    sectors: frequencies.map((frequencyPercent, index) => ({
      directionLabel: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][index] as NonNullable<SiteProfile['solar']['windClimatology']>[number]['sectors'][number]['directionLabel'],
      centerDegrees: index * 45,
      frequencyPercent,
      meanSpeedMs: 2.4 + index * 0.35,
      sampleCount: Math.round(8_760 * frequencyPercent / 100),
    })),
  });
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
      status: 'available',
      period: '2021–2025',
      annualGlobalHorizontalKwhM2: 1_720,
      annualDirectNormalKwhM2: 1_960,
      prevailingWindDirectionDegrees: 315,
      prevailingWindDirectionLabel: 'NW',
      meanWindSpeedMs: 3.8,
      windSpeedP90Ms: 6.4,
      calmWindFrequencyPercent: 7.5,
      windClimatology: [
        windPeriod('annual', 315, 'NW', 3.8, 6.4, 7.5, [7, 6, 8, 9, 10, 12, 15, 25]),
        windPeriod('winter', 300, 'NW', 4.4, 7.2, 6, [8, 6, 7, 8, 9, 13, 18, 25]),
        windPeriod('spring', 315, 'NW', 3.7, 6.1, 8, [7, 5, 7, 9, 11, 12, 17, 24]),
        windPeriod('summer', 335, 'NW', 3.2, 5.4, 10, [8, 7, 9, 10, 12, 13, 13, 18]),
        windPeriod('autumn', 290, 'W', 4, 6.8, 6, [6, 5, 7, 8, 9, 14, 20, 25]),
      ],
      hourlyClimatology: Array.from({ length: 12 }, (_, month) => Array.from({ length: 24 }, (_, hour) => ({
        month: month + 1,
        hour,
        directNormalWm2: hour >= 7 && hour <= 17 ? 610 : 0,
        diffuseWm2: hour >= 7 && hour <= 17 ? 100 : 0,
        shortwaveWm2: hour >= 7 && hour <= 17 ? 515 : 0,
        windSpeedMs: 3.8,
        windDirectionDegrees: 315,
        sampleCount: 150,
      }))).flat(),
      evidence: {
        ...source('Open-Meteo Historical Weather API'),
        sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
        version: 'ERA5-family reanalysis, 2021–2025 hourly aggregate',
        resolution: 'hourly radiation and 10 m wind grid',
      },
      limitations: ['Reanalysis does not resolve local obstacles, hedges or gust corridors; verify damaging winds on site.'],
    },
    soil: {
      ph: 6.8,
      sandPercent: 38,
      siltPercent: 37,
      clayPercent: 25,
      organicCarbonGKg: 20,
      textureClass: 'loam',
      evidence: soilEvidence,
      status: 'available',
      properties: [
        soilProperty('ph', 'chemical', 6.8, 'pH', { low: 6.1, high: 7.5 }),
        soilProperty('organic-carbon', 'chemical', 20, 'g/kg', { low: 11, high: 31 }),
        soilProperty('total-nitrogen', 'chemical', 1.7, 'g/kg', { low: 0.9, high: 2.6 }),
        soilProperty('cation-exchange-capacity', 'chemical', 21, 'cmol(c)/kg', { low: 14, high: 29 }),
        soilProperty('organic-carbon-stock', 'chemical', 4.8, 'kg/m²', null, 30),
        soilProperty('carbon-nitrogen-ratio', 'chemical', 11.8, 'ratio', null, 5, 'derived-from-modelled'),
        soilProperty('sand', 'physical', 38, '%'),
        soilProperty('silt', 'physical', 37, '%'),
        soilProperty('clay', 'physical', 25, '%'),
        soilProperty('bulk-density', 'physical', 1.32, 'kg/dm³'),
        soilProperty('coarse-fragments', 'physical', 7, 'vol%'),
        soilProperty('water-field-capacity', 'physical', 31, 'vol%'),
        soilProperty('water-wilting-point', 'physical', 14, 'vol%'),
        soilProperty('plant-available-water', 'derived', 17, 'vol%', null, 5, 'derived-from-modelled'),
      ],
      reactionClass: 'neutral',
      carbonNitrogenRatio: 11.8,
      satelliteScreening: {
        status: 'unavailable',
        bareSoilObservationCount: 0,
        totalObservationCount: 0,
        latestBareSoilIndex: null,
        use: 'variability-screening-only',
        evidence: null,
        limitations: ['No bare-soil optical observations in this fixture.'],
      },
      limitations: [
        'Values are global model predictions, not laboratory measurements from this parcel.',
        'SoilGrids explains approximately 30–70% of observed variation depending on property and location.',
        'Total nitrogen is not plant-available nitrogen; phosphorus, potassium, micronutrients, salinity and contaminants are not estimated here.',
        'Use georeferenced laboratory samples before fertilisation, amendment or contamination decisions.',
      ],
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
