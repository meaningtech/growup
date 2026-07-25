import type { FirebreakConfiguration, FirebreakFuelModel } from '../types';

export type FirebreakFuelPreset = {
  id: Exclude<FirebreakFuelModel, 'custom'>;
  expectedFlameLengthM: number;
  defaultWidthM: number;
};

export const FIREBREAK_WIDTH_TO_FLAME_RATIO = 2.5;

export const FIREBREAK_FUEL_PRESETS: FirebreakFuelPreset[] = [
  { id: 'managed-herbaceous', expectedFlameLengthM: 1.2, defaultWidthM: 3 },
  { id: 'crop-residue', expectedFlameLengthM: 2, defaultWidthM: 5 },
  { id: 'shrub-edge', expectedFlameLengthM: 3, defaultWidthM: 7.5 },
  { id: 'woodland-edge', expectedFlameLengthM: 4, defaultWidthM: 10 },
];

export const DEFAULT_FIREBREAK_CONFIGURATION: FirebreakConfiguration = {
  enabled: false,
  fuelModel: 'crop-residue',
  treatment: 'mown',
  expectedFlameLengthM: 2,
  widthM: 5,
  supportVehicleAccess: true,
  protectPipeCrossings: true,
};

export function firebreakConfigurationFromFuelModel(id: FirebreakFuelModel): FirebreakConfiguration {
  const preset = FIREBREAK_FUEL_PRESETS.find((item) => item.id === id);
  if (!preset) return { ...DEFAULT_FIREBREAK_CONFIGURATION, enabled: true, fuelModel: 'custom' };
  return {
    ...DEFAULT_FIREBREAK_CONFIGURATION,
    enabled: true,
    fuelModel: id,
    expectedFlameLengthM: preset.expectedFlameLengthM,
    widthM: preset.defaultWidthM,
  };
}

export function normalizeFirebreakConfiguration(value?: Partial<FirebreakConfiguration> | null): FirebreakConfiguration {
  const fuelModels: FirebreakFuelModel[] = ['managed-herbaceous', 'crop-residue', 'shrub-edge', 'woodland-edge', 'custom'];
  const treatments: FirebreakConfiguration['treatment'][] = ['mown', 'bare-ground', 'low-fuel-vegetation'];
  const fallback = DEFAULT_FIREBREAK_CONFIGURATION;
  return {
    enabled: value?.enabled === true,
    fuelModel: fuelModels.includes(value?.fuelModel as FirebreakFuelModel) ? value!.fuelModel! : fallback.fuelModel,
    treatment: treatments.includes(value?.treatment as FirebreakConfiguration['treatment']) ? value!.treatment! : fallback.treatment,
    expectedFlameLengthM: round(clamp(Number(value?.expectedFlameLengthM ?? fallback.expectedFlameLengthM), 0.2, 20), 1),
    widthM: round(clamp(Number(value?.widthM ?? fallback.widthM), 1, 60), 1),
    supportVehicleAccess: value?.supportVehicleAccess !== false,
    protectPipeCrossings: value?.protectPipeCrossings !== false,
  };
}

export function firebreakEnvelope(configuration: FirebreakConfiguration) {
  const normalized = normalizeFirebreakConfiguration(configuration);
  const minimumPlanningWidthM = round(Math.max(3, normalized.expectedFlameLengthM * FIREBREAK_WIDTH_TO_FLAME_RATIO), 1);
  return {
    minimumPlanningWidthM,
    plannedWidthM: normalized.widthM,
    planningWidthSatisfied: normalized.widthM + 1e-6 >= minimumPlanningWidthM,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
