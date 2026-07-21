import type { DesignSpecies, DesignSystemId } from '../types';

export type SystemEconomicsProfile = {
  system: DesignSystemId;
  matureSupplementalFraction: number;
  supportSpeciesFraction: number;
  transitionYears: number;
  managementHoursPerPlantInitial: number;
  managementHoursPerPlantMature: number;
  basis: 'measured-system-reference' | 'conservative-planning-default';
};

const PROFILES: Record<DesignSystemId, SystemEconomicsProfile> = {
  syntropic: {
    system: 'syntropic',
    matureSupplementalFraction: 0.5,
    supportSpeciesFraction: 0.08,
    transitionYears: 12,
    managementHoursPerPlantInitial: 0.22,
    managementHoursPerPlantMature: 0.1,
    basis: 'measured-system-reference',
  },
  monoculture: {
    system: 'monoculture',
    matureSupplementalFraction: 1,
    supportSpeciesFraction: 1,
    transitionYears: 1,
    managementHoursPerPlantInitial: 0.08,
    managementHoursPerPlantMature: 0.08,
    basis: 'conservative-planning-default',
  },
  'mixed-orchard': {
    system: 'mixed-orchard',
    matureSupplementalFraction: 0.9,
    supportSpeciesFraction: 0.75,
    transitionYears: 10,
    managementHoursPerPlantInitial: 0.11,
    managementHoursPerPlantMature: 0.09,
    basis: 'conservative-planning-default',
  },
  'alley-cropping': {
    system: 'alley-cropping',
    matureSupplementalFraction: 0.85,
    supportSpeciesFraction: 0.55,
    transitionYears: 10,
    managementHoursPerPlantInitial: 0.12,
    managementHoursPerPlantMature: 0.09,
    basis: 'conservative-planning-default',
  },
  windbreak: {
    system: 'windbreak',
    matureSupplementalFraction: 0.75,
    supportSpeciesFraction: 0.4,
    transitionYears: 8,
    managementHoursPerPlantInitial: 0.08,
    managementHoursPerPlantMature: 0.05,
    basis: 'conservative-planning-default',
  },
  'boundary-buffer': {
    system: 'boundary-buffer',
    matureSupplementalFraction: 0.75,
    supportSpeciesFraction: 0.4,
    transitionYears: 8,
    managementHoursPerPlantInitial: 0.08,
    managementHoursPerPlantMature: 0.05,
    basis: 'conservative-planning-default',
  },
};

export function systemEconomicsProfile(system: DesignSystemId): SystemEconomicsProfile {
  return PROFILES[system];
}

export function systemMaturityProgress(system: DesignSystemId, year: number): number {
  const profile = systemEconomicsProfile(system);
  if (profile.transitionYears <= 1) return 1;
  return clamp((year - 1) / (profile.transitionYears - 1), 0, 1);
}

export function supplementalIrrigationFactor(system: DesignSystemId, species: DesignSpecies, year: number): number {
  const profile = systemEconomicsProfile(system);
  const progress = systemMaturityProgress(system, year);
  const systemFraction = interpolate(1, profile.matureSupplementalFraction, progress);
  if (!isSupportSpecies(species)) return systemFraction;
  return systemFraction * interpolate(1, profile.supportSpeciesFraction, progress);
}

export function managementLaborHours(system: DesignSystemId, activePlantCount: number, year: number): number {
  const profile = systemEconomicsProfile(system);
  const hoursPerPlant = interpolate(profile.managementHoursPerPlantInitial, profile.managementHoursPerPlantMature, systemMaturityProgress(system, year));
  return activePlantCount * hoursPerPlant;
}

export function isSupportSpecies(species: DesignSpecies): boolean {
  const productive = species.productiveFromYear !== null || species.roles.some((role) => /fruit|nut|food|crop|culinary|aromatic|resin|fodder/i.test(role));
  return !productive && (species.roles.includes('biomass') || species.nitrogenFixer || species.droughtTolerance >= 4);
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
