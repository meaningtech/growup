import type {
  DesignSystemId,
  EconomicConfiguration,
  MaintenanceModelBasis,
  MaintenanceTaskId,
  SystemMaintenanceEstimate,
} from '../types';

export const MAINTENANCE_MODEL_VERSION = 'growup-maintenance-1.0.0';

type TaskWorkloadProfile = {
  initialAreaHoursPerHa: number;
  matureAreaHoursPerHa: number;
  initialHoursPerPlant: number;
  matureHoursPerPlant: number;
  initialFixedHours: number;
  matureFixedHours: number;
  curveExponent: number;
};

type MaintenanceProfile = {
  transitionYears: number;
  managedAreaFraction: number;
  managedFootprintM2PerPlant: number;
  basis: MaintenanceModelBasis;
  confidence: SystemMaintenanceEstimate['confidence'];
  sourceIds: string[];
  tasks: Record<MaintenanceTaskId, TaskWorkloadProfile>;
};

const SOURCES: Record<string, SystemMaintenanceEstimate['sources'][number]> = {
  'embrapa-diversified-costs': {
    id: 'embrapa-diversified-costs',
    organization: 'Embrapa',
    title: 'Economic evaluation of a diversified agroforestry system',
    version: '2014',
    url: 'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1006456/1/2014AA18.pdf',
  },
  'embrapa-management-practices': {
    id: 'embrapa-management-practices',
    organization: 'Embrapa',
    title: 'Main management practices in agroforestry systems',
    version: 'accessed 2026-07-23',
    url: 'https://www.atermaisdigital.cnptia.embrapa.br/web/saf/principais-manejos',
  },
  'ucce-almond-budget': {
    id: 'ucce-almond-budget',
    organization: 'University of California Cooperative Extension',
    title: 'Sample costs to establish an almond orchard and produce almonds',
    version: '2006',
    url: 'https://ucanr.edu/sites/Tehama/files/23080.pdf',
  },
  'usfs-alley-model': {
    id: 'usfs-alley-model',
    organization: 'USDA Forest Service',
    title: 'Alley Crop Financial Decision Support Tool — The ALLEY Model 2.0',
    version: '2018',
    url: 'https://research.fs.usda.gov/treesearch/57480',
  },
  'nrcs-windbreak-standard': {
    id: 'nrcs-windbreak-standard',
    organization: 'USDA Natural Resources Conservation Service',
    title: 'Windbreak/Shelterbelt Establishment and Renovation — Conservation Practice Standard 380',
    version: '2021',
    url: 'https://www.nrcs.usda.gov/resources/guides-and-instructions/windbreakshelterbelt-establishment-and-renovation-ft-380',
  },
};

const ZERO_TASK: TaskWorkloadProfile = {
  initialAreaHoursPerHa: 0,
  matureAreaHoursPerHa: 0,
  initialHoursPerPlant: 0,
  matureHoursPerPlant: 0,
  initialFixedHours: 0,
  matureFixedHours: 0,
  curveExponent: 1,
};

const PROFILES: Record<DesignSystemId, MaintenanceProfile> = {
  syntropic: {
    transitionYears: 12,
    managedAreaFraction: 1,
    managedFootprintM2PerPlant: 18,
    basis: 'measured-agroforestry-reference',
    confidence: 'medium',
    sourceIds: ['embrapa-diversified-costs', 'embrapa-management-practices'],
    tasks: {
      'vegetation-control': task(155, 28, 0.015, 0.004, 4, 2, 0.3),
      'training-pruning': task(0, 0, 0.045, 0.05, 3, 4, 0.75),
      'biomass-succession': task(28, 10, 0.115, 0.045, 4, 4, 0.45),
      'inspection-replanting': task(18, 10, 0.025, 0.007, 4, 3, 0.35),
    },
  },
  monoculture: {
    transitionYears: 8,
    managedAreaFraction: 1,
    managedFootprintM2PerPlant: 24,
    basis: 'enterprise-budget-reference',
    confidence: 'medium',
    sourceIds: ['ucce-almond-budget'],
    tasks: {
      'vegetation-control': task(65, 52, 0.002, 0.002, 2, 2, 0.75),
      'training-pruning': task(0, 0, 0.05, 0.15, 3, 4, 1),
      'biomass-succession': ZERO_TASK,
      'inspection-replanting': task(10, 10, 0.014, 0.006, 3, 3, 0.65),
    },
  },
  'mixed-orchard': {
    transitionYears: 10,
    managedAreaFraction: 1,
    managedFootprintM2PerPlant: 24,
    basis: 'triangulated-planning-default',
    confidence: 'low',
    sourceIds: ['embrapa-diversified-costs', 'ucce-almond-budget'],
    tasks: {
      'vegetation-control': task(100, 42, 0.006, 0.002, 3, 3, 0.45),
      'training-pruning': task(0, 0, 0.07, 0.14, 3, 4, 0.9),
      'biomass-succession': task(12, 8, 0.025, 0.015, 2, 2, 0.7),
      'inspection-replanting': task(14, 10, 0.018, 0.006, 3, 3, 0.5),
    },
  },
  'alley-cropping': {
    transitionYears: 10,
    managedAreaFraction: 0.55,
    managedFootprintM2PerPlant: 26,
    basis: 'triangulated-planning-default',
    confidence: 'low',
    sourceIds: ['usfs-alley-model', 'embrapa-management-practices'],
    tasks: {
      'vegetation-control': task(90, 34, 0.006, 0.002, 3, 2, 0.45),
      'training-pruning': task(0, 0, 0.065, 0.1, 3, 3, 0.85),
      'biomass-succession': task(12, 7, 0.02, 0.018, 2, 2, 0.7),
      'inspection-replanting': task(12, 8, 0.015, 0.006, 3, 3, 0.5),
    },
  },
  windbreak: {
    transitionYears: 8,
    managedAreaFraction: 0.18,
    managedFootprintM2PerPlant: 30,
    basis: 'practice-standard-reference',
    confidence: 'medium',
    sourceIds: ['nrcs-windbreak-standard'],
    tasks: {
      'vegetation-control': task(105, 18, 0.01, 0.002, 3, 2, 0.35),
      'training-pruning': task(0, 0, 0.035, 0.07, 2, 2, 0.8),
      'biomass-succession': task(7, 4, 0.012, 0.01, 1, 1, 0.65),
      'inspection-replanting': task(10, 6, 0.025, 0.005, 3, 3, 0.35),
    },
  },
  'boundary-buffer': {
    transitionYears: 8,
    managedAreaFraction: 0.15,
    managedFootprintM2PerPlant: 25,
    basis: 'practice-standard-reference',
    confidence: 'medium',
    sourceIds: ['nrcs-windbreak-standard'],
    tasks: {
      'vegetation-control': task(100, 20, 0.01, 0.002, 3, 2, 0.35),
      'training-pruning': task(0, 0, 0.04, 0.075, 2, 2, 0.8),
      'biomass-succession': task(6, 4, 0.01, 0.008, 1, 1, 0.65),
      'inspection-replanting': task(11, 7, 0.025, 0.006, 3, 3, 0.35),
    },
  },
};

export function calculateSystemMaintenance(
  system: DesignSystemId,
  year: number,
  siteAreaM2: number,
  activePlantCount: number,
  economics: Pick<EconomicConfiguration, 'laborCostPerHour'>,
): SystemMaintenanceEstimate {
  const profile = PROFILES[system];
  const normalizedYear = Math.max(1, Math.round(year));
  const normalizedPlantCount = Math.max(0, Math.round(activePlantCount));
  const siteAreaHectares = Math.max(0, siteAreaM2) / 10_000;
  const footprintAreaHectares = normalizedPlantCount * profile.managedFootprintM2PerPlant / 10_000;
  const managedAreaHectares = Math.min(siteAreaHectares, Math.max(siteAreaHectares * profile.managedAreaFraction, footprintAreaHectares));
  const laborCostPerHour = Math.max(0, economics.laborCostPerHour);
  const tasks = (Object.entries(profile.tasks) as Array<[MaintenanceTaskId, TaskWorkloadProfile]>).map(([id, workload]) => {
    const progress = taskProgress(normalizedYear, profile.transitionYears, workload.curveExponent);
    const areaHours = managedAreaHectares * interpolate(workload.initialAreaHoursPerHa, workload.matureAreaHoursPerHa, progress);
    const plantHours = normalizedPlantCount * interpolate(workload.initialHoursPerPlant, workload.matureHoursPerPlant, progress);
    const fixedHours = interpolate(workload.initialFixedHours, workload.matureFixedHours, progress);
    const hours = areaHours + plantHours + fixedHours;
    return {
      id,
      hours: round(hours),
      cost: round(hours * laborCostPerHour),
      areaHours: round(areaHours),
      plantHours: round(plantHours),
      fixedHours: round(fixedHours),
    };
  }).filter((item) => item.hours > 0);
  const totalHours = tasks.reduce((sum, item) => sum + item.hours, 0);

  return {
    modelVersion: MAINTENANCE_MODEL_VERSION,
    system,
    year: normalizedYear,
    phase: normalizedYear <= 2 ? 'establishment' : normalizedYear <= profile.transitionYears ? 'development' : 'mature',
    siteAreaHectares: round(siteAreaHectares),
    managedAreaHectares: round(managedAreaHectares),
    activePlantCount: normalizedPlantCount,
    laborCostPerHour,
    totalHours: round(totalHours),
    totalCost: round(totalHours * laborCostPerHour),
    tasks,
    basis: profile.basis,
    confidence: profile.confidence,
    sources: profile.sourceIds.map((id) => SOURCES[id]),
    exclusions: ['harvest', 'annual-crops', 'materials-inputs', 'extraordinary-work'],
  };
}

export function maintenanceProfile(system: DesignSystemId) {
  return PROFILES[system];
}

function task(
  initialAreaHoursPerHa: number,
  matureAreaHoursPerHa: number,
  initialHoursPerPlant: number,
  matureHoursPerPlant: number,
  initialFixedHours: number,
  matureFixedHours: number,
  curveExponent: number,
): TaskWorkloadProfile {
  return {
    initialAreaHoursPerHa,
    matureAreaHoursPerHa,
    initialHoursPerPlant,
    matureHoursPerPlant,
    initialFixedHours,
    matureFixedHours,
    curveExponent,
  };
}

function taskProgress(year: number, transitionYears: number, exponent: number): number {
  if (transitionYears <= 1) return 1;
  const linear = clamp((year - 1) / (transitionYears - 1), 0, 1);
  return Math.pow(linear, exponent);
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}
