import type {
  DesignSpecies,
  EstablishmentCost,
  Evidence,
  IrrigationEstimate,
  LayoutVariant,
  SiteProfile,
} from '../types';

export const OPERATIONAL_TASKS = ['verify-field', 'set-out', 'install-irrigation', 'plant', 'commission', 'monitor'] as const;
export const MANAGEMENT_PHASES = ['establishment', 'development', 'mature'] as const;

export type OperationalSchedule = {
  summary: {
    treeCount: number;
    speciesCount: number;
    plantingLaborHours: number;
    machineryCorridorCount: number;
    machineryReservedAreaM2: number;
    machineryHeadlandDepthM: number;
    purchasePipeM: number;
    emitterCount: number;
    zones: number;
    requiredFlowM3Hour: number;
    requiredDynamicHeadM: number;
    pumpRequired: boolean;
    annualWaterM3: number;
    annualOperatingCost: number;
  };
  tasks: Array<(typeof OPERATIONAL_TASKS)[number]>;
  planting: Array<{
    speciesId: string;
    scientificName: string;
    commonName: string;
    count: number;
    unitPlantCost: number;
    unitLaborHours: number;
    laborHours: number;
    subtotalCost: number;
  }>;
  infrastructure: IrrigationEstimate['network']['components'];
  irrigationMonths: IrrigationEstimate['monthly'];
  managementPhases: Array<(typeof MANAGEMENT_PHASES)[number]>;
  evidence: Evidence[];
  warnings: string[];
};

export function buildOperationalSchedule(
  profile: SiteProfile,
  variant: LayoutVariant,
  species: DesignSpecies[],
  irrigation: IrrigationEstimate,
  costs: EstablishmentCost,
): OperationalSchedule {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const planting = costs.bySpecies.map((row) => {
    const item = speciesById.get(row.speciesId);
    if (!item) throw new Error(`Operational schedule cannot resolve species ${row.speciesId}.`);
    return {
      ...row,
      scientificName: item.scientificName,
      commonName: item.commonName,
      laborHours: round(row.count * row.unitLaborHours),
    };
  });
  const evidence = uniqueEvidence([
    profile.location.evidence,
    profile.terrain.evidence,
    profile.climate.evidence,
    profile.solar.evidence,
    profile.soil.evidence,
    profile.landCover.evidence,
    ...profile.satellite.evidence,
    ...profile.satellite.existingVegetation.evidence,
    ...species.flatMap((item) => item.sources.map((source): Evidence => ({
      source: source.label,
      sourceUrl: source.url,
      version: source.version,
      observedAt: profile.generatedAt,
      confidence: 'medium',
    }))),
  ]);
  return {
    summary: {
      treeCount: variant.trees.length,
      speciesCount: planting.length,
      plantingLaborHours: costs.plantingLaborHours,
      machineryCorridorCount: variant.machinery.corridors.length,
      machineryReservedAreaM2: variant.machinery.reservedAreaM2,
      machineryHeadlandDepthM: variant.machinery.headlandDepthM,
      purchasePipeM: irrigation.network.totalPurchasePipeM,
      emitterCount: irrigation.emitterCount,
      zones: irrigation.zones,
      requiredFlowM3Hour: irrigation.network.requiredFlowM3Hour,
      requiredDynamicHeadM: irrigation.network.requiredDynamicHeadM,
      pumpRequired: irrigation.network.pumpRequired,
      annualWaterM3: irrigation.annualWaterM3,
      annualOperatingCost: irrigation.annualOperation.totalCost,
    },
    tasks: [...OPERATIONAL_TASKS],
    planting,
    infrastructure: irrigation.network.components.map((component) => ({ ...component })),
    irrigationMonths: irrigation.monthly.map((month) => ({ ...month })),
    managementPhases: [...MANAGEMENT_PHASES],
    evidence,
    warnings: [...new Set([...profile.warnings, ...variant.warnings, ...irrigation.network.warnings])],
  };
}

function uniqueEvidence(records: Evidence[]): Evidence[] {
  const result = new Map<string, Evidence>();
  for (const item of records) result.set(`${item.source}|${item.version}|${item.observedAt}`, item);
  return [...result.values()].sort((left, right) => left.source.localeCompare(right.source));
}

function round(value: number) {
  return Number(value.toFixed(2));
}
