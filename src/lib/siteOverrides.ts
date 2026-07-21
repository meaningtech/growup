import type { SiteProfile, SiteProfileOverride, SiteProfileOverrideField } from '../types';

type OverrideValueType = 'number' | 'text' | 'choice' | 'boolean';

export type SiteProfileOverrideDefinition = {
  field: SiteProfileOverrideField;
  labelKey: string;
  valueType: OverrideValueType;
  unit: string | null;
  minimum?: number;
  maximum?: number;
  options?: string[];
};

export const SITE_PROFILE_OVERRIDE_DEFINITIONS: SiteProfileOverrideDefinition[] = [
  definition('terrain.elevationMeanM', 'profile.overrideField.elevation', 'number', 'm', -450, 9_000),
  definition('terrain.slopePercent', 'profile.overrideField.slope', 'number', '%', 0, 300),
  definition('terrain.aspectDegrees', 'profile.overrideField.aspect', 'number', '°', 0, 360),
  definition('climate.meanTemperatureC', 'profile.overrideField.meanTemperature', 'number', '°C', -60, 60),
  definition('climate.absoluteMinTemperatureC', 'profile.overrideField.minimumTemperature', 'number', '°C', -90, 50),
  definition('climate.absoluteMaxTemperatureC', 'profile.overrideField.maximumTemperature', 'number', '°C', -40, 70),
  definition('climate.annualPrecipitationMm', 'profile.overrideField.precipitation', 'number', 'mm/year', 0, 15_000),
  definition('climate.annualEt0Mm', 'profile.overrideField.et0', 'number', 'mm/year', 0, 5_000),
  definition('soil.ph', 'profile.overrideField.ph', 'number', 'pH', 2, 12),
  definition('soil.sandPercent', 'profile.overrideField.sand', 'number', '%', 0, 100),
  definition('soil.siltPercent', 'profile.overrideField.silt', 'number', '%', 0, 100),
  definition('soil.clayPercent', 'profile.overrideField.clay', 'number', '%', 0, 100),
  definition('soil.organicCarbonGKg', 'profile.overrideField.organicCarbon', 'number', 'g/kg', 0, 600),
  choice('soil.textureClass', 'profile.overrideField.texture', ['sand', 'loamy-sand', 'sandy-loam', 'loam', 'silt-loam', 'silt', 'sandy-clay-loam', 'clay-loam', 'silty-clay-loam', 'sandy-clay', 'silty-clay', 'clay']),
  definition('fieldConditions.soilDepthM', 'profile.overrideField.soilDepth', 'number', 'm', 0.05, 10),
  choice('fieldConditions.drainageClass', 'profile.overrideField.drainage', ['very-poor', 'poor', 'moderate', 'good', 'rapid', 'unknown']),
  definition('fieldConditions.availableWaterMmM', 'profile.overrideField.availableWater', 'number', 'mm/m', 0, 500),
  choice('fieldConditions.frostRisk', 'profile.overrideField.frostRisk', ['low', 'moderate', 'high', 'unknown']),
  choice('fieldConditions.droughtRisk', 'profile.overrideField.droughtRisk', ['low', 'moderate', 'high', 'unknown']),
  choice('fieldConditions.salinityRisk', 'profile.overrideField.salinityRisk', ['low', 'moderate', 'high', 'unknown']),
  choice('fieldConditions.windExposure', 'profile.overrideField.windExposure', ['sheltered', 'moderate', 'exposed', 'unknown']),
  choice('fieldConditions.waterloggingRisk', 'profile.overrideField.waterloggingRisk', ['low', 'moderate', 'high', 'unknown']),
  { field: 'fieldConditions.irrigationAvailable', labelKey: 'profile.overrideField.irrigationAvailable', valueType: 'boolean', unit: null },
  choice('fieldConditions.waterQualityClass', 'profile.overrideField.waterQuality', ['good', 'restricted', 'unsuitable', 'unknown']),
];

const DEFINITIONS_BY_FIELD = new Map(SITE_PROFILE_OVERRIDE_DEFINITIONS.map((item) => [item.field, item]));

export function applySiteProfileOverride(
  profile: SiteProfile,
  input: {
    field: SiteProfileOverrideField;
    value: unknown;
    reason: string;
    sourceLabel: string;
    observedAt: string;
    appliedAt?: string;
  },
): SiteProfile {
  const definition = DEFINITIONS_BY_FIELD.get(input.field);
  if (!definition) throw overrideError('UNKNOWN_OVERRIDE_FIELD', 'The selected site-profile field cannot be overridden.');
  const reason = input.reason.trim();
  const sourceLabel = input.sourceLabel.trim();
  if (reason.length < 4 || reason.length > 500) throw overrideError('INVALID_OVERRIDE_REASON', 'An override reason of 4–500 characters is required.');
  if (sourceLabel.length < 2 || sourceLabel.length > 160) throw overrideError('INVALID_OVERRIDE_SOURCE', 'An override source of 2–160 characters is required.');
  const observedAt = validTimestamp(input.observedAt, 'INVALID_OVERRIDE_OBSERVED_AT');
  const appliedAt = validTimestamp(input.appliedAt ?? new Date().toISOString(), 'INVALID_OVERRIDE_APPLIED_AT');
  const value = normalizeOverrideValue(input.value, definition);
  const previousValue = overrideValue(profile, input.field);
  const record: SiteProfileOverride = {
    id: `override-${Date.parse(appliedAt)}-${input.field.replaceAll('.', '-')}-${(profile.overrides?.length ?? 0) + 1}`,
    field: input.field,
    previousValue,
    value,
    unit: definition.unit,
    reason,
    sourceLabel,
    observedAt,
    appliedAt,
  };
  const next = structuredClone(profile);
  ensureFieldConditions(next);
  setOverrideValue(next, input.field, value);
  next.overrides = [...(profile.overrides ?? []), record];
  next.generatedAt = appliedAt;
  if (input.field === 'terrain.aspectDegrees') next.terrain.aspectLabel = aspectLabel(Number(value));
  if (input.field === 'terrain.elevationMeanM') {
    next.terrain.elevationMinM = Math.min(next.terrain.elevationMinM, Number(value));
    next.terrain.elevationMaxM = Math.max(next.terrain.elevationMaxM, Number(value));
  }
  if (input.field.startsWith('climate.')) {
    next.climate.aridityIndex = next.climate.annualEt0Mm > 0
      ? Number((next.climate.annualPrecipitationMm / next.climate.annualEt0Mm).toFixed(2))
      : 0;
  }
  if (input.field.startsWith('soil.')) next.soil.status = 'available';
  return next;
}

export function overrideValue(profile: SiteProfile, field: SiteProfileOverrideField): string | number | boolean | null {
  const conditions = profile.fieldConditions ?? defaultFieldConditions();
  switch (field) {
    case 'terrain.elevationMeanM': return profile.terrain.elevationMeanM;
    case 'terrain.slopePercent': return profile.terrain.slopePercent;
    case 'terrain.aspectDegrees': return profile.terrain.aspectDegrees;
    case 'climate.meanTemperatureC': return profile.climate.meanTemperatureC;
    case 'climate.absoluteMinTemperatureC': return profile.climate.absoluteMinTemperatureC;
    case 'climate.absoluteMaxTemperatureC': return profile.climate.absoluteMaxTemperatureC;
    case 'climate.annualPrecipitationMm': return profile.climate.annualPrecipitationMm;
    case 'climate.annualEt0Mm': return profile.climate.annualEt0Mm;
    case 'soil.ph': return profile.soil.ph;
    case 'soil.sandPercent': return profile.soil.sandPercent;
    case 'soil.siltPercent': return profile.soil.siltPercent;
    case 'soil.clayPercent': return profile.soil.clayPercent;
    case 'soil.organicCarbonGKg': return profile.soil.organicCarbonGKg;
    case 'soil.textureClass': return profile.soil.textureClass;
    case 'fieldConditions.soilDepthM': return conditions.soilDepthM;
    case 'fieldConditions.drainageClass': return conditions.drainageClass;
    case 'fieldConditions.availableWaterMmM': return conditions.availableWaterMmM;
    case 'fieldConditions.frostRisk': return conditions.frostRisk;
    case 'fieldConditions.droughtRisk': return conditions.droughtRisk;
    case 'fieldConditions.salinityRisk': return conditions.salinityRisk;
    case 'fieldConditions.windExposure': return conditions.windExposure;
    case 'fieldConditions.waterloggingRisk': return conditions.waterloggingRisk;
    case 'fieldConditions.irrigationAvailable': return conditions.irrigationAvailable;
    case 'fieldConditions.waterQualityClass': return conditions.waterQualityClass;
  }
}

export function defaultFieldConditions(): NonNullable<SiteProfile['fieldConditions']> {
  return {
    soilDepthM: null,
    drainageClass: 'unknown',
    availableWaterMmM: null,
    frostRisk: 'unknown',
    droughtRisk: 'unknown',
    salinityRisk: 'unknown',
    windExposure: 'unknown',
    waterloggingRisk: 'unknown',
    irrigationAvailable: null,
    waterQualityClass: 'unknown',
  };
}

function definition(field: SiteProfileOverrideField, labelKey: string, valueType: OverrideValueType, unit: string | null, minimum: number, maximum: number): SiteProfileOverrideDefinition {
  return { field, labelKey, valueType, unit, minimum, maximum };
}

function choice(field: SiteProfileOverrideField, labelKey: string, options: string[]): SiteProfileOverrideDefinition {
  return { field, labelKey, valueType: 'choice', unit: null, options };
}

function normalizeOverrideValue(value: unknown, definition: SiteProfileOverrideDefinition): string | number | boolean {
  if (definition.valueType === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < Number(definition.minimum) || numeric > Number(definition.maximum)) {
      throw overrideError('INVALID_OVERRIDE_VALUE', `The override must be between ${definition.minimum} and ${definition.maximum}${definition.unit ? ` ${definition.unit}` : ''}.`);
    }
    return Number(numeric.toFixed(3));
  }
  if (definition.valueType === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw overrideError('INVALID_OVERRIDE_VALUE', 'The override must be yes or no.');
  }
  const text = String(value ?? '').trim();
  if (definition.options && !definition.options.includes(text)) throw overrideError('INVALID_OVERRIDE_VALUE', 'The selected override option is not supported.');
  if (!definition.options && (text.length < 1 || text.length > 120)) throw overrideError('INVALID_OVERRIDE_VALUE', 'The override text must contain 1–120 characters.');
  return text;
}

function setOverrideValue(profile: SiteProfile, field: SiteProfileOverrideField, value: string | number | boolean) {
  const conditions = profile.fieldConditions!;
  switch (field) {
    case 'terrain.elevationMeanM': profile.terrain.elevationMeanM = Number(value); break;
    case 'terrain.slopePercent': profile.terrain.slopePercent = Number(value); break;
    case 'terrain.aspectDegrees': profile.terrain.aspectDegrees = Number(value); break;
    case 'climate.meanTemperatureC': profile.climate.meanTemperatureC = Number(value); break;
    case 'climate.absoluteMinTemperatureC': profile.climate.absoluteMinTemperatureC = Number(value); break;
    case 'climate.absoluteMaxTemperatureC': profile.climate.absoluteMaxTemperatureC = Number(value); break;
    case 'climate.annualPrecipitationMm': profile.climate.annualPrecipitationMm = Number(value); break;
    case 'climate.annualEt0Mm': profile.climate.annualEt0Mm = Number(value); break;
    case 'soil.ph': profile.soil.ph = Number(value); break;
    case 'soil.sandPercent': profile.soil.sandPercent = Number(value); break;
    case 'soil.siltPercent': profile.soil.siltPercent = Number(value); break;
    case 'soil.clayPercent': profile.soil.clayPercent = Number(value); break;
    case 'soil.organicCarbonGKg': profile.soil.organicCarbonGKg = Number(value); break;
    case 'soil.textureClass': profile.soil.textureClass = String(value); break;
    case 'fieldConditions.soilDepthM': conditions.soilDepthM = Number(value); break;
    case 'fieldConditions.drainageClass': conditions.drainageClass = value as typeof conditions.drainageClass; break;
    case 'fieldConditions.availableWaterMmM': conditions.availableWaterMmM = Number(value); break;
    case 'fieldConditions.frostRisk': conditions.frostRisk = value as typeof conditions.frostRisk; break;
    case 'fieldConditions.droughtRisk': conditions.droughtRisk = value as typeof conditions.droughtRisk; break;
    case 'fieldConditions.salinityRisk': conditions.salinityRisk = value as typeof conditions.salinityRisk; break;
    case 'fieldConditions.windExposure': conditions.windExposure = value as typeof conditions.windExposure; break;
    case 'fieldConditions.waterloggingRisk': conditions.waterloggingRisk = value as typeof conditions.waterloggingRisk; break;
    case 'fieldConditions.irrigationAvailable': conditions.irrigationAvailable = Boolean(value); break;
    case 'fieldConditions.waterQualityClass': conditions.waterQualityClass = value as typeof conditions.waterQualityClass; break;
  }
}

function ensureFieldConditions(profile: SiteProfile) {
  profile.fieldConditions = { ...defaultFieldConditions(), ...(profile.fieldConditions ?? {}) };
}

function validTimestamp(value: string, status: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw overrideError(status, 'A valid observation date is required.');
  return parsed.toISOString();
}

function aspectLabel(degrees: number): string {
  const labels = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return labels[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

function overrideError(status: string, message: string) {
  return { code: 400, status, message };
}
