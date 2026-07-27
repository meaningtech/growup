import type { Evidence, LayoutVariant, SiteProfile } from '../types';

export type FireScreeningLevel = 'low' | 'moderate' | 'high' | 'very-high';
export type FireScreeningComponentId = 'dryness' | 'wind' | 'terrain' | 'fuels' | 'protection';

export type FireScreeningMetric = {
  id: string;
  value: number | null;
  unit: string;
};

export type FireScreeningComponent = {
  id: FireScreeningComponentId;
  score: number | null;
  level: FireScreeningLevel | null;
  weight: number;
  metrics: FireScreeningMetric[];
  evidence: Evidence[];
};

export type FireScreeningAssessment = {
  status: 'available' | 'partial' | 'unavailable';
  score: number | null;
  level: FireScreeningLevel | null;
  confidence: Evidence['confidence'];
  coveragePercent: number;
  annualWaterDeficitMm: number | null;
  dryMonthCount: number | null;
  components: FireScreeningComponent[];
  dominantDrivers: FireScreeningComponentId[];
  limitations: string[];
};

const WEIGHTS: Record<FireScreeningComponentId, number> = {
  dryness: 0.35,
  wind: 0.25,
  terrain: 0.15,
  fuels: 0.15,
  protection: 0.1,
};

export function assessFireScreening(profile: SiteProfile | null, variant: LayoutVariant | null): FireScreeningAssessment {
  if (!profile) {
    return {
      status: 'unavailable',
      score: null,
      level: null,
      confidence: 'low',
      coveragePercent: 0,
      annualWaterDeficitMm: null,
      dryMonthCount: null,
      components: componentIds().map((id) => component(id, null, [], [])),
      dominantDrivers: [],
      limitations: ['A site profile is required before parcel-scale planning indicators can be calculated.'],
    };
  }

  const annualWaterDeficitMm = round(Math.max(0, profile.climate.annualEt0Mm - profile.climate.annualPrecipitationMm), 0);
  const dryMonthCount = profile.climate.monthly.filter((month) => month.precipitationMm < month.et0Mm * 0.5).length;
  const drynessScore = weightedMean([
    [scoreAridity(profile.climate.aridityIndex), 0.45],
    [clamp(dryMonthCount / 8 * 100), 0.3],
    [scoreTemperature(profile.climate.absoluteMaxTemperatureC), 0.25],
  ]);

  const windP90 = profile.solar.status === 'available' ? profile.solar.windSpeedP90Ms ?? null : null;
  const windMean = profile.solar.status === 'available' ? profile.solar.meanWindSpeedMs : null;
  const windScore = windP90 === null && windMean === null
    ? null
    : weightedMean([
      [windP90 === null ? null : scoreWind(windP90), 0.7],
      [windMean === null ? null : scoreWind(windMean * 1.35), 0.3],
    ]);

  const terrainScore = scoreSlope(profile.terrain.slopePercent);
  const vegetation = profile.satellite.existingVegetation;
  const assumedFuelScore = variant ? scoreFuelModel(variant.firebreak.fuelModel) : null;
  const vegetationScore = vegetation.status === 'unavailable' ? null : scoreVegetation(vegetation.protectedCoverPercent);
  const fuelScore = weightedMean([
    [assumedFuelScore, 0.6],
    [vegetationScore, 0.4],
  ]);

  const protectionScore = variant ? scoreProtection(variant) : null;
  const components = [
    component('dryness', drynessScore, [
      metric('water-deficit', annualWaterDeficitMm, 'mm/year'),
      metric('dry-months', dryMonthCount, 'months'),
      metric('maximum-temperature', profile.climate.absoluteMaxTemperatureC, '°C'),
      metric('aridity-index', profile.climate.aridityIndex, 'P/ET₀'),
    ], [profile.climate.evidence]),
    component('wind', windScore, [
      metric('mean-wind', windMean, 'm/s'),
      metric('wind-p90', windP90, 'm/s'),
      metric('prevailing-direction', profile.solar.prevailingWindDirectionDegrees, '°'),
    ], profile.solar.status === 'available' ? [profile.solar.evidence] : []),
    component('terrain', terrainScore, [
      metric('slope', profile.terrain.slopePercent, '%'),
      metric('aspect', profile.terrain.aspectDegrees, '°'),
      metric('elevation-range', profile.terrain.elevationMaxM - profile.terrain.elevationMinM, 'm'),
    ], [profile.terrain.evidence]),
    component('fuels', fuelScore, [
      metric('protected-woody-cover', vegetation.status === 'unavailable' ? null : vegetation.protectedCoverPercent, '%'),
      metric('woody-patches', vegetation.status === 'unavailable' ? null : vegetation.patches.length, 'patches'),
      metric('expected-flame-length', variant?.firebreak.expectedFlameLengthM ?? null, 'm'),
    ], vegetation.evidence),
    component('protection', protectionScore, [
      metric('planned-width', variant?.firebreak.plannedWidthM ?? null, 'm'),
      metric('minimum-width', variant?.firebreak.minimumPlanningWidthM ?? null, 'm'),
      metric('reserved-area', variant?.firebreak.reservedAreaM2 ?? null, 'm²'),
      metric('windward-sections', variant?.firebreak.lines.filter((line) => line.priority === 'windward').length ?? null, 'sections'),
    ], variant?.firebreak.evidence ?? []),
  ];
  const available = components.filter((item) => item.score !== null);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const score = availableWeight > 0
    ? round(available.reduce((sum, item) => sum + item.score! * item.weight, 0) / availableWeight, 0)
    : null;
  const inputCoverage = (
    WEIGHTS.dryness
    + (windScore === null ? 0 : WEIGHTS.wind)
    + WEIGHTS.terrain
    + WEIGHTS.fuels * ((assumedFuelScore === null ? 0 : 0.6) + (vegetationScore === null ? 0 : 0.4))
    + (protectionScore === null ? 0 : WEIGHTS.protection)
  );
  const coveragePercent = round(inputCoverage * 100, 0);
  const dominantDrivers = available
    .slice()
    .sort((left, right) => right.score! - left.score!)
    .slice(0, 2)
    .map((item) => item.id);

  return {
    status: coveragePercent >= 85 ? 'available' : 'partial',
    score,
    level: score === null ? null : levelForScore(score),
    confidence: coveragePercent >= 85 ? 'medium' : 'low',
    coveragePercent,
    annualWaterDeficitMm,
    dryMonthCount,
    components,
    dominantDrivers,
    limitations: [
      'This is a transparent planning-attention index, not an official fire-danger class, ignition probability or flame-spread simulation.',
      'Climate and wind inputs are gridded historical estimates; local gusts, fuel moisture, fuel continuity and recent management require field verification.',
      'The EFFIS Fire Weather Index layer is displayed separately because its regional forecast value is not numerically sampled at parcel scale.',
    ],
  };
}

function component(id: FireScreeningComponentId, score: number | null, metrics: FireScreeningMetric[], evidence: Evidence[]): FireScreeningComponent {
  const normalizedScore = score === null ? null : round(clamp(score), 0);
  return {
    id,
    score: normalizedScore,
    level: normalizedScore === null ? null : levelForScore(normalizedScore),
    weight: WEIGHTS[id],
    metrics,
    evidence: uniqueEvidence(evidence),
  };
}

function metric(id: string, value: number | null, unit: string): FireScreeningMetric {
  return { id, value: value === null || !Number.isFinite(value) ? null : round(value, 1), unit };
}

function scoreAridity(value: number) {
  if (value <= 0.3) return 90;
  if (value <= 0.5) return 75;
  if (value <= 0.65) return 58;
  if (value <= 0.8) return 38;
  return 20;
}

function scoreTemperature(value: number) {
  if (value >= 42) return 90;
  if (value >= 38) return 75;
  if (value >= 34) return 58;
  if (value >= 30) return 40;
  return 22;
}

function scoreWind(value: number) {
  if (value >= 12) return 92;
  if (value >= 8) return 75;
  if (value >= 5) return 58;
  if (value >= 3) return 38;
  return 22;
}

function scoreSlope(value: number) {
  if (value >= 30) return 90;
  if (value >= 20) return 75;
  if (value >= 10) return 58;
  if (value >= 5) return 38;
  return 22;
}

function scoreVegetation(value: number) {
  if (value >= 60) return 88;
  if (value >= 30) return 70;
  if (value >= 10) return 50;
  return 28;
}

function scoreFuelModel(value: LayoutVariant['firebreak']['fuelModel']) {
  if (value === 'woodland-edge') return 88;
  if (value === 'shrub-edge') return 72;
  if (value === 'custom') return 60;
  if (value === 'crop-residue') return 48;
  return 30;
}

function scoreProtection(variant: LayoutVariant) {
  const plan = variant.firebreak;
  if (!plan.enabled) return 92;
  let score = plan.planningWidthSatisfied ? 30 : 78;
  if (!plan.supportVehicleAccess) score += 12;
  if (!plan.protectPipeCrossings) score += 6;
  return clamp(score);
}

function weightedMean(items: Array<[number | null, number]>) {
  const available = items.filter((item): item is [number, number] => item[0] !== null);
  const weight = available.reduce((sum, item) => sum + item[1], 0);
  return weight ? available.reduce((sum, item) => sum + item[0] * item[1], 0) / weight : null;
}

function levelForScore(score: number): FireScreeningLevel {
  if (score >= 75) return 'very-high';
  if (score >= 55) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

function uniqueEvidence(items: Evidence[]) {
  const unique = new Map<string, Evidence>();
  for (const item of items) unique.set(`${item.source}|${item.version}|${item.observedAt}`, item);
  return [...unique.values()];
}

function componentIds(): FireScreeningComponentId[] {
  return ['dryness', 'wind', 'terrain', 'fuels', 'protection'];
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
