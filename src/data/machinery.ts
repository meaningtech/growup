import type { AgriculturalMachinePresetId, MachineryConfiguration } from '../types';

export type MachineryPreset = {
  id: AgriculturalMachinePresetId;
  referenceModel: string;
  category: 'two-wheel-tractor' | 'sub-compact-tractor' | 'compact-tractor' | 'orchard-tractor';
  widthM: number;
  lengthM: number;
  turningRadiusM: number;
  implementWidthM: number;
  safetyClearanceM: number;
  sourceUrl: string;
  sourceNote: string;
};

export const MACHINERY_PRESETS: MachineryPreset[] = [
  {
    id: 'bcs-740',
    referenceModel: 'BCS 740 Action',
    category: 'two-wheel-tractor',
    widthM: 0.79,
    lengthM: 2,
    turningRadiusM: 1.2,
    implementWidthM: 0.8,
    safetyClearanceM: 0.35,
    sourceUrl: 'https://bcsagri.com/en-001/product/740-action/',
    sourceNote: 'Manufacturer envelope; turning allowance includes operator and mounted implement.',
  },
  {
    id: 'john-deere-1025r',
    referenceModel: 'John Deere 1025R',
    category: 'sub-compact-tractor',
    widthM: 1.2,
    lengthM: 2.65,
    turningRadiusM: 2.51,
    implementWidthM: 1.35,
    safetyClearanceM: 0.5,
    sourceUrl: 'https://www.deere.com/en/tractors/compact-tractors/1-series-sub-compact-tractors/1025r/',
    sourceNote: 'Manufacturer turning radius and tread data; editable working envelope includes tyres and implement.',
  },
  {
    id: 'john-deere-3033r',
    referenceModel: 'John Deere 3033R',
    category: 'compact-tractor',
    widthM: 1.55,
    lengthM: 3.3,
    turningRadiusM: 2.8,
    implementWidthM: 1.8,
    safetyClearanceM: 0.6,
    sourceUrl: 'https://www.deere.com/en/tractors/compact-tractors/3-series-compact-tractors/3033r/',
    sourceNote: 'Manufacturer turning radius and tread data; editable working envelope includes tyres and implement.',
  },
  {
    id: 'new-holland-t4f',
    referenceModel: 'New Holland T4F',
    category: 'orchard-tractor',
    widthM: 1.57,
    lengthM: 3.9,
    turningRadiusM: 2.9,
    implementWidthM: 2.1,
    safetyClearanceM: 0.65,
    sourceUrl: 'https://www.newholland.com/en-us/nar/products/tractors-telehandlers/t4fv',
    sourceNote: 'Manufacturer minimum width and specialty-tractor turning data; length and implement remain editable.',
  },
];

export const MACHINERY_PRESET_BY_ID = new Map(MACHINERY_PRESETS.map((preset) => [preset.id, preset]));

export const DEFAULT_MACHINERY_CONFIGURATION: MachineryConfiguration = {
  enabled: true,
  presetId: 'bcs-740',
  widthM: 0.79,
  lengthM: 2,
  turningRadiusM: 1.2,
  implementWidthM: 0.8,
  safetyClearanceM: 0.35,
  protectPipeCrossings: true,
};

export function machineryConfigurationFromPreset(id: AgriculturalMachinePresetId): MachineryConfiguration {
  const preset = MACHINERY_PRESET_BY_ID.get(id) ?? MACHINERY_PRESETS[0];
  return {
    enabled: true,
    presetId: preset.id,
    widthM: preset.widthM,
    lengthM: preset.lengthM,
    turningRadiusM: preset.turningRadiusM,
    implementWidthM: preset.implementWidthM,
    safetyClearanceM: preset.safetyClearanceM,
    protectPipeCrossings: true,
  };
}

export function normalizeMachineryConfiguration(value?: Partial<MachineryConfiguration> | null): MachineryConfiguration {
  const fallback = DEFAULT_MACHINERY_CONFIGURATION;
  const presetId = MACHINERY_PRESET_BY_ID.has(value?.presetId as AgriculturalMachinePresetId)
    ? value!.presetId as AgriculturalMachinePresetId
    : fallback.presetId;
  return {
    enabled: value?.enabled !== false,
    presetId,
    widthM: clamp(Number(value?.widthM ?? fallback.widthM), 0.35, 4),
    lengthM: clamp(Number(value?.lengthM ?? fallback.lengthM), 0.8, 8),
    turningRadiusM: clamp(Number(value?.turningRadiusM ?? fallback.turningRadiusM), 0.4, 12),
    implementWidthM: clamp(Number(value?.implementWidthM ?? fallback.implementWidthM), 0.35, 8),
    safetyClearanceM: clamp(Number(value?.safetyClearanceM ?? fallback.safetyClearanceM), 0.1, 3),
    protectPipeCrossings: value?.protectPipeCrossings !== false,
  };
}

export function machineryEnvelope(configuration: MachineryConfiguration) {
  if (!configuration.enabled) return { corridorWidthM: 0, headlandDepthM: 0, turningAreaRadiusM: 0 };
  return {
    corridorWidthM: Math.max(configuration.widthM, configuration.implementWidthM) + configuration.safetyClearanceM * 2,
    headlandDepthM: Math.max(
      configuration.lengthM + configuration.safetyClearanceM * 2,
      configuration.turningRadiusM * 2 + configuration.safetyClearanceM,
    ),
    turningAreaRadiusM: configuration.turningRadiusM + configuration.safetyClearanceM,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
