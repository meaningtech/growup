import type {
  DesignSpecies,
  EstablishmentCost,
  Evidence,
  IrrigationEstimate,
  LayoutVariant,
  ProjectOperationsPlan,
  SiteProfile,
  SystemMaintenanceEstimate,
} from '../types';
import { buildOperationsPlan } from './operations';

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
    machineryPerimeterLengthM: number;
    machineryManoeuvreLengthM: number;
    firebreakLengthM: number;
    firebreakWidthM: number;
    firebreakReservedAreaM2: number;
    purchasePipeM: number;
    emitterCount: number;
    zones: number;
    requiredFlowM3Hour: number;
    requiredDynamicHeadM: number;
    pumpRequired: boolean;
    annualWaterM3: number;
    annualOperatingCost: number;
    maintenanceLaborHours: number;
    maintenanceLaborCost: number;
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
  maintenance: IrrigationEstimate['systemMaintenance'];
  managementPhases: Array<(typeof MANAGEMENT_PHASES)[number]>;
  operations: ProjectOperationsPlan;
  evidence: Evidence[];
  warnings: string[];
};

export function buildOperationalSchedule(
  profile: SiteProfile,
  variant: LayoutVariant,
  species: DesignSpecies[],
  irrigation: IrrigationEstimate,
  costs: EstablishmentCost,
  plantingDate: string | null = null,
): OperationalSchedule {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const maintenance = irrigation.systemMaintenance ?? legacyMaintenance(irrigation);
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
    ...(variant.firebreak?.evidence ?? []),
    ...maintenance.sources.map((source): Evidence => ({
      source: `${source.organization}: ${source.title}`,
      sourceUrl: source.url,
      version: source.version,
      observedAt: profile.generatedAt,
      confidence: maintenance.confidence,
    })),
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
      machineryPerimeterLengthM: (variant.machinery.perimeterLoops ?? []).reduce((sum, route) => sum + route.lengthM, 0),
      machineryManoeuvreLengthM: (variant.machinery.manoeuvreRoutes ?? []).reduce((sum, route) => sum + route.lengthM, 0),
      firebreakLengthM: variant.firebreak?.totalLengthM ?? 0,
      firebreakWidthM: variant.firebreak?.plannedWidthM ?? 0,
      firebreakReservedAreaM2: variant.firebreak?.reservedAreaM2 ?? 0,
      purchasePipeM: irrigation.network.totalPurchasePipeM,
      emitterCount: irrigation.emitterCount,
      zones: irrigation.zones,
      requiredFlowM3Hour: irrigation.network.requiredFlowM3Hour,
      requiredDynamicHeadM: irrigation.network.requiredDynamicHeadM,
      pumpRequired: irrigation.network.pumpRequired,
      annualWaterM3: irrigation.annualWaterM3,
      annualOperatingCost: irrigation.annualOperation.totalCost,
      maintenanceLaborHours: maintenance.totalHours,
      maintenanceLaborCost: maintenance.totalCost,
    },
    tasks: [...OPERATIONAL_TASKS],
    planting,
    infrastructure: irrigation.network.components.map((component) => ({ ...component })),
    irrigationMonths: irrigation.monthly.map((month) => ({ ...month })),
    maintenance: {
      ...maintenance,
      tasks: maintenance.tasks.map((task) => ({ ...task })),
      sources: maintenance.sources.map((source) => ({ ...source })),
      exclusions: [...maintenance.exclusions],
    },
    managementPhases: [...MANAGEMENT_PHASES],
    operations: buildOperationsPlan(profile, variant, species, irrigation, profile.generatedAt, plantingDate),
    evidence,
    warnings: [...new Set([...profile.warnings, ...variant.warnings, ...irrigation.network.warnings])],
  };
}

function legacyMaintenance(irrigation: IrrigationEstimate): SystemMaintenanceEstimate {
  const totalHours = irrigation.annualOperation.managementLaborHours ?? 0;
  const totalCost = irrigation.annualOperation.managementLaborCost ?? 0;
  return {
    modelVersion: 'legacy-project-recalculation-required',
    system: irrigation.waterModel.system,
    year: irrigation.designYear,
    phase: irrigation.designYear <= 2 ? 'establishment' : irrigation.designYear <= irrigation.waterModel.transitionYears ? 'development' : 'mature',
    siteAreaHectares: 0,
    managedAreaHectares: 0,
    activePlantCount: irrigation.activePlantCount,
    laborCostPerHour: irrigation.economics.laborCostPerHour,
    totalHours,
    totalCost,
    tasks: [],
    basis: 'triangulated-planning-default',
    confidence: 'low',
    sources: [],
    exclusions: ['harvest', 'annual-crops', 'materials-inputs', 'extraordinary-work'],
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
