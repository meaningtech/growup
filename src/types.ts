export type Coordinate = {
  lat: number;
  lng: number;
};

export type SitePath = {
  id: string;
  name: string;
  points: Coordinate[];
  widthM: number;
};

export type SitePoint = {
  id: string;
  name: string;
  coordinate: Coordinate;
};

export type ExistingTreeObservation = SitePoint & {
  speciesName: string | null;
  crownDiameterM: number;
  protectionBufferM: number;
};

export type Evidence = {
  source: string;
  sourceUrl: string;
  version: string;
  /**
   * Legacy primary timestamp kept for saved-project compatibility.
   * New consumers should prefer the explicitly labelled temporal fields below.
   */
  observedAt: string;
  dataObservedAt?: string;
  coverageStart?: string;
  coverageEnd?: string;
  publishedAt?: string;
  retrievedAt?: string;
  computedAt?: string;
  confidence: 'high' | 'medium' | 'low';
  resolution?: string;
};

export type SiteBoundary = {
  id: string;
  name: string;
  polygon: Coordinate[];
  additionalPolygons: Coordinate[][];
  holes: Coordinate[][];
  exclusions: Coordinate[][];
  paths: SitePath[];
  accessPoints: SitePoint[];
  waterPoints: SitePoint[];
  existingTrees: ExistingTreeObservation[];
  setbackM: number;
};

export type SiteValidation = {
  valid: boolean;
  reason: string;
  areaM2: number;
  perimeterM: number;
  plantableAreaM2: number;
  geometryType: 'Polygon' | 'MultiPolygon';
  counts: {
    polygons: number;
    holes: number;
    exclusions: number;
    paths: number;
    accessPoints: number;
    waterPoints: number;
    existingTrees: number;
  };
};

export type LocationSearchResult = {
  id: string;
  displayName: string;
  coordinate: Coordinate;
  boundingBox: { south: number; north: number; west: number; east: number } | null;
  type: string;
};

export type SatelliteIndexSummary = {
  mean: number;
  median: number;
  standardDeviation: number;
  percentile02: number;
  percentile98: number;
  validPixels: number;
};

export type SatelliteOpticalObservation = {
  sceneId: string;
  acquiredAt: string;
  platform: string;
  sceneCloudPercent: number;
  fieldCloudPercent: number;
  ndvi: SatelliteIndexSummary;
  ndmi: SatelliteIndexSummary;
  ndwi: SatelliteIndexSummary;
  bareSoilIndex: SatelliteIndexSummary;
};

export type SatelliteRadarObservation = {
  sceneId: string;
  acquiredAt: string;
  platform: string;
  orbitState: 'ascending' | 'descending' | 'unknown';
  relativeOrbit: number | null;
  vvMeanLinear: number;
  vhMeanLinear: number;
  vvMeanDb: number;
  vhMeanDb: number;
  vhVvRatio: number;
  validPixels: number;
};

export type SatelliteWaterSample = {
  coordinate: Coordinate;
  ndmi: number;
  ndvi: number;
  irrigationPriority: 'high' | 'medium' | 'low';
};

export type ExistingVegetationPatch = {
  id: string;
  centroid: Coordinate;
  polygon: Coordinate[];
  detectedAreaM2: number;
  protectedAreaM2: number;
  pixelCount: number;
  currentNdvi: number;
  medianNdvi: number;
  persistentGreenFraction: number;
  annualTreeVotes: number;
  worldCoverTree: boolean;
  copernicusWoody: boolean;
  confidence: Evidence['confidence'];
  signals: string[];
};

export type ExistingVegetationProfile = {
  status: 'available' | 'partial' | 'unavailable';
  suitability: 'clear-with-exclusions' | 'review-required' | 'reject';
  analyzedOpticalScenes: number;
  annualLandCoverYears: number[];
  woodyVegetationLayerAvailable: boolean;
  detectedCoverPercent: number;
  protectedCoverPercent: number;
  maximumAcceptedCoverPercent: number;
  patches: ExistingVegetationPatch[];
  evidence: Evidence[];
  conclusion: string;
};

export type SatelliteProfile = {
  status: 'available' | 'partial' | 'unavailable';
  generatedAt: string;
  optical: {
    collection: 'sentinel-2-l2a';
    latest: SatelliteOpticalObservation | null;
    history: SatelliteOpticalObservation[];
    waterSamples: SatelliteWaterSample[];
    ndmiPreviewUrl: string | null;
    trueColorPreviewUrl: string | null;
  };
  radar: {
    collection: 'sentinel-1-rtc';
    latest: SatelliteRadarObservation | null;
    history: SatelliteRadarObservation[];
    baselineSceneCount: number;
    latestVvAnomalyDb: number | null;
    latestVvPercentile: number | null;
    surfaceMoistureSignal: 'wetter-than-recent-baseline' | 'near-recent-baseline' | 'drier-than-recent-baseline' | 'unavailable';
  };
  existingVegetation: ExistingVegetationProfile;
  irrigationScheduling: {
    adjustmentPercent: number;
    recommendation: string;
    confidence: Evidence['confidence'];
    annualVolumeAdjusted: false;
  };
  evidence: Evidence[];
  limitations: string[];
};

export type SoilPropertyEstimateKey =
  | 'ph'
  | 'sand'
  | 'silt'
  | 'clay'
  | 'organic-carbon'
  | 'total-nitrogen'
  | 'cation-exchange-capacity'
  | 'bulk-density'
  | 'coarse-fragments'
  | 'organic-carbon-stock'
  | 'water-field-capacity'
  | 'water-wilting-point'
  | 'plant-available-water'
  | 'carbon-nitrogen-ratio';

export type SoilPropertyEstimate = {
  key: SoilPropertyEstimateKey;
  category: 'chemical' | 'physical' | 'derived';
  value: number | null;
  unit: string;
  depthTopCm: number;
  depthBottomCm: number;
  predictionInterval90: { low: number; high: number } | null;
  estimateType: 'modelled-mean' | 'derived-from-modelled';
  evidence: Evidence;
};

export type SoilSatelliteScreening = {
  status: 'usable' | 'limited' | 'unavailable';
  bareSoilObservationCount: number;
  totalObservationCount: number;
  latestBareSoilIndex: number | null;
  use: 'variability-screening-only';
  evidence: Evidence | null;
  limitations: string[];
};

export type SoilDepthLayer = {
  depthTopCm: number;
  depthBottomCm: number;
  ph: number | null;
  organicCarbonGKg: number | null;
  clayPercent: number | null;
  coarseFragmentsPercent: number | null;
  bulkDensityKgDm3: number | null;
  plantAvailableWaterPercent: number | null;
  evidence: Evidence;
};

export type DepthToBedrockSample = {
  coordinate: Coordinate;
  depthM: number;
  cellBounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
};

export type DepthToBedrockProfile = {
  status: 'available' | 'partial' | 'unavailable';
  modelledDepthM: number | null;
  minimumDepthM: number | null;
  maximumDepthM: number | null;
  samples: DepthToBedrockSample[];
  evidence: Evidence;
  limitations: string[];
};

export type GroundwaterProfile = {
  status: 'available' | 'partial' | 'unavailable';
  aquiferType: string | null;
  rechargeClass: string | null;
  resourceClass: string | null;
  mapLayerId: number;
  evidence: Evidence;
  limitations: string[];
};

export type SiteProfile = {
  generatedAt: string;
  centroid: Coordinate;
  areaM2: number;
  perimeterM: number;
  location: {
    displayName: string;
    municipality: string | null;
    province: string | null;
    region: string | null;
    countryCode: string | null;
    evidence: Evidence;
  };
  terrain: {
    elevationMeanM: number;
    elevationMinM: number;
    elevationMaxM: number;
    slopePercent: number;
    aspectDegrees: number;
    aspectLabel: string;
    samples: Array<Coordinate & { elevationM: number }>;
    evidence: Evidence;
  };
  climate: {
    period: string;
    meanTemperatureC: number;
    absoluteMinTemperatureC: number;
    absoluteMaxTemperatureC: number;
    annualPrecipitationMm: number;
    annualEt0Mm: number;
    aridityIndex: number;
    monthly: Array<{
      month: number;
      temperatureC: number;
      precipitationMm: number;
      et0Mm: number;
    }>;
    evidence: Evidence;
  };
  solar: SolarResourceProfile;
  soil: {
    ph: number | null;
    sandPercent: number | null;
    siltPercent: number | null;
    clayPercent: number | null;
    organicCarbonGKg: number | null;
    textureClass: string | null;
    evidence: Evidence;
    status: 'available' | 'partial' | 'unavailable';
    properties?: SoilPropertyEstimate[];
    reactionClass?: 'strongly-acidic' | 'acidic' | 'slightly-acidic' | 'neutral' | 'alkaline' | 'strongly-alkaline' | 'unknown';
    carbonNitrogenRatio?: number | null;
    satelliteScreening?: SoilSatelliteScreening;
    verticalProfile?: SoilDepthLayer[];
    depthToBedrock?: DepthToBedrockProfile;
    limitations?: string[];
  };
  fieldConditions?: {
    soilDepthM: number | null;
    drainageClass: 'very-poor' | 'poor' | 'moderate' | 'good' | 'rapid' | 'unknown';
    availableWaterMmM: number | null;
    frostRisk: 'low' | 'moderate' | 'high' | 'unknown';
    droughtRisk: 'low' | 'moderate' | 'high' | 'unknown';
    salinityRisk: 'low' | 'moderate' | 'high' | 'unknown';
    windExposure: 'sheltered' | 'moderate' | 'exposed' | 'unknown';
    waterloggingRisk: 'low' | 'moderate' | 'high' | 'unknown';
    irrigationAvailable: boolean | null;
    waterQualityClass: 'good' | 'restricted' | 'unsuitable' | 'unknown';
  };
  overrides?: SiteProfileOverride[];
  landCover: {
    classification: string;
    osmTags: Record<string, string>;
    evidence: Evidence;
  };
  groundwater?: GroundwaterProfile;
  satellite: SatelliteProfile;
  nasaLandscape?: NasaLandscapeContext;
  warnings: string[];
};

export type NasaLandscapeSampleId = 'precipitation' | 'aerosol' | 'surface-water' | 'flood' | 'disturbance';

export type NasaLandscapeSample = {
  id: NasaLandscapeSampleId;
  layer: string;
  status: 'available' | 'nodata' | 'unavailable';
  label: string | null;
  value: number | null;
  unit: string | null;
  evidence: Evidence;
};

export type NasaLandscapeContext = {
  status: 'available' | 'partial' | 'unavailable';
  observedAt: string;
  samples: NasaLandscapeSample[];
  limitations: string[];
};

export type SiteProfileOverrideField =
  | 'terrain.elevationMeanM'
  | 'terrain.slopePercent'
  | 'terrain.aspectDegrees'
  | 'climate.meanTemperatureC'
  | 'climate.absoluteMinTemperatureC'
  | 'climate.absoluteMaxTemperatureC'
  | 'climate.annualPrecipitationMm'
  | 'climate.annualEt0Mm'
  | 'soil.ph'
  | 'soil.sandPercent'
  | 'soil.siltPercent'
  | 'soil.clayPercent'
  | 'soil.organicCarbonGKg'
  | 'soil.textureClass'
  | 'fieldConditions.soilDepthM'
  | 'fieldConditions.drainageClass'
  | 'fieldConditions.availableWaterMmM'
  | 'fieldConditions.frostRisk'
  | 'fieldConditions.droughtRisk'
  | 'fieldConditions.salinityRisk'
  | 'fieldConditions.windExposure'
  | 'fieldConditions.waterloggingRisk'
  | 'fieldConditions.irrigationAvailable'
  | 'fieldConditions.waterQualityClass';

export type SiteProfileOverride = {
  id: string;
  field: SiteProfileOverrideField;
  previousValue: string | number | boolean | null;
  value: string | number | boolean | null;
  unit: string | null;
  reason: string;
  sourceLabel: string;
  observedAt: string;
  appliedAt: string;
};

export type SolarClimateBin = {
  month: number;
  hour: number;
  directNormalWm2: number;
  diffuseWm2: number;
  shortwaveWm2: number;
  windSpeedMs: number;
  windDirectionDegrees: number;
  sampleCount: number;
};

export type WindDirectionSector = {
  directionLabel: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  centerDegrees: number;
  frequencyPercent: number;
  meanSpeedMs: number;
  sampleCount: number;
};

export type WindClimatologyPeriod = {
  period: 'annual' | 'winter' | 'spring' | 'summer' | 'autumn';
  prevailingDirectionDegrees: number | null;
  prevailingDirectionLabel: WindDirectionSector['directionLabel'] | null;
  meanSpeedMs: number | null;
  speedP90Ms: number | null;
  calmFrequencyPercent: number | null;
  sampleCount: number;
  sectors: WindDirectionSector[];
};

export type SolarResourceProfile = {
  status: 'available' | 'unavailable';
  period: string;
  annualGlobalHorizontalKwhM2: number;
  annualDirectNormalKwhM2: number;
  prevailingWindDirectionDegrees: number | null;
  prevailingWindDirectionLabel: string | null;
  meanWindSpeedMs: number | null;
  windSpeedP90Ms?: number | null;
  calmWindFrequencyPercent?: number | null;
  windClimatology?: WindClimatologyPeriod[];
  hourlyClimatology: SolarClimateBin[];
  evidence: Evidence;
  limitations: string[];
};

export type Stratum = 'emergent' | 'high' | 'medium' | 'low' | 'ground' | 'climber';
export type SuccessionPhase = 'placenta' | 'secondary' | 'climax';
export type CrownArchetype = 'round' | 'oval' | 'columnar' | 'umbrella' | 'weeping' | 'irregular' | 'shrub';
export type StockClass = 'forestry-seedling' | 'shrub-pot' | 'fruit-grafted' | 'citrus-grafted' | 'large-pot' | 'cutting';

export type SpeciesSource = {
  label: string;
  url: string;
  supports: string[];
  version: string;
};

export type DesignSpecies = {
  id: string;
  scientificName: string;
  commonName: string;
  family: string;
  treeLike: boolean;
  invasiveStatus: 'none' | 'monitor' | 'blocked';
  invasiveNote?: string;
  stratum: Stratum;
  succession: SuccessionPhase;
  roles: string[];
  crown: CrownArchetype;
  evergreen: boolean;
  nitrogenFixer: boolean;
  minTemperatureC: number;
  maxTemperatureC: number;
  annualRainMinMm: number;
  annualRainMaxMm: number;
  phMin: number;
  phMax: number;
  droughtTolerance: 1 | 2 | 3 | 4 | 5;
  waterloggingTolerance: 1 | 2 | 3 | 4 | 5;
  matureHeightM: number;
  matureCrownDiameterM: number;
  initialHeightM: number;
  growthRate: number;
  growthShape: number;
  spacingM: number;
  productiveFromYear: number | null;
  lifespanYears: number;
  kcInitial: number;
  kcMid: number;
  kcLate: number;
  rootDepthM: number;
  stockClass: StockClass;
  referencePurchasePrice: number;
  referencePurchasePriceRange: [number, number];
  plantingLaborHours: number;
  color: string;
  sources: SpeciesSource[];
  envelopeConfidence?: 'sourced' | 'unknown';
};

export type CatalogueSpecies = {
  id: string;
  scientificName: string;
  sourceCount: number;
  treeLike: boolean;
  wfoId: string | null;
  wcvpId: string | null;
  globUnt: boolean;
  designReady: boolean;
  stratum: Stratum | null;
  succession: SuccessionPhase | null;
  roles: string[];
  evergreen: boolean | null;
  nitrogenFixer: boolean | null;
  droughtTolerance: number | null;
  evidenceCount: number;
};

export type SuitabilityComponent = {
  key: string;
  label: string;
  score: number;
  weight: number;
  status: 'good' | 'conditional' | 'poor' | 'unknown' | 'blocked';
  explanation: string;
};

export type SpeciesRecommendation = {
  species: DesignSpecies;
  score: number;
  status: 'recommended' | 'conditional' | 'poor' | 'blocked';
  components: SuitabilityComponent[];
  reasons: string[];
  mitigations: string[];
};

export type TreeInstance = {
  id: string;
  speciesId: string;
  coordinate: Coordinate;
  rowIndex: number;
  positionIndex: number;
  plantedYear: number;
  removedYear: number | null;
  locked: boolean;
  seed: number;
};

export type DesignSystemId = 'syntropic' | 'alley-cropping' | 'mixed-orchard' | 'monoculture' | 'windbreak' | 'boundary-buffer';
export type PlantingExtent = 'full-field' | 'perimeter-band' | 'selected-edges';
export type OrientationObjective = 'solar-crop' | 'contour' | 'operations' | 'wind-protection' | 'custom';
export type AgriculturalMachinePresetId = 'bcs-740' | 'john-deere-1025r' | 'john-deere-3033r' | 'new-holland-t4f';
export type FirebreakFuelModel = 'managed-herbaceous' | 'crop-residue' | 'shrub-edge' | 'woodland-edge' | 'custom';
export type FirebreakTreatment = 'mown' | 'bare-ground' | 'low-fuel-vegetation';
export type MaintenanceTaskId = 'vegetation-control' | 'training-pruning' | 'biomass-succession' | 'inspection-replanting';
export type MaintenancePhase = 'establishment' | 'development' | 'mature';
export type MaintenanceModelBasis = 'measured-agroforestry-reference' | 'enterprise-budget-reference' | 'practice-standard-reference' | 'triangulated-planning-default';

export type OperationsArchetypeId =
  | 'grafted-deciduous-fruit'
  | 'citrus-evergreen'
  | 'mediterranean-evergreen-crop'
  | 'forestry-evergreen-climax'
  | 'forestry-deciduous-climax'
  | 'placenta-biomass'
  | 'mediterranean-shrub'
  | 'climber-vine'
  | 'succulent-cutting'
  | 'woody-default';

export type OperationsPackId = string;
export type OperationsClimateGroup = 'mediterranean' | 'temperate' | 'tropical';
export type OperationsMatchLevel = 'country-pack' | 'climate-group' | 'genus' | 'archetype' | 'woody-default' | 'unknown';
export type OperationsPlantingMethod = 'bare-root' | 'container' | 'cutting' | 'grafted' | 'pad';
export type OperationsFrostConstraint = 'plant-dormant' | 'wait-after-frost' | 'autumn-evergreen-ok' | 'unknown';
export type OperationsPruningStyle = 'training' | 'production' | 'coppice' | 'pollard' | 'sanitary-only' | 'minimal';
export type OperationsPhenologyAnchor = 'dormant' | 'after-harvest' | 'after-flowering' | 'biomass-cycle' | 'avoid-wet-wood';
export type OperationsPruningFrequency = 'annual' | 'biennial' | 'every-3-years' | 'as-needed';
export type OperationsFirstYearWater = 'critical' | 'moderate' | 'minimal-once-established';
export type OperationsStepId =
  | 'plant.water-in'
  | 'plant.firm-soil'
  | 'plant.orient-graft'
  | 'plant.stake'
  | 'plant.mulch-basin'
  | 'care.first-summer-water'
  | 'care.weed-circle'
  | 'care.inspect-guards'
  | 'prune.formative'
  | 'prune.remove-dead'
  | 'prune.keep-leader'
  | 'coppice.biomass-on-site';
export type OperationsCalendarEventId = 'plant' | 'water-check' | 'train' | 'prune' | 'coppice' | 'inspect' | 'mulch' | 'guard-check';
export type OperationsFieldBasis = 'species-record' | 'genus' | 'archetype' | 'site-climate' | 'irrigation-model' | 'maintenance-model';

export type MonthWindow = {
  startMonth: number;
  endMonth: number;
  confidence: Evidence['confidence'];
  sources: SpeciesSource[];
};

export type SpeciesOperationsFields = {
  planting: {
    window: MonthWindow | null;
    method: OperationsPlantingMethod | null;
    holeWidthM: number | null;
    holeDepthM: number | null;
    establishmentYears: number;
    frostConstraint: OperationsFrostConstraint;
    steps: OperationsStepId[];
  };
  pruning: {
    style: OperationsPruningStyle | null;
    phenologyAnchor: OperationsPhenologyAnchor | null;
    window: MonthWindow | null;
    frequency: OperationsPruningFrequency | null;
    productivePruningExcluded: true;
  };
  care: {
    firstYearWater: OperationsFirstYearWater | null;
    mulch: boolean | null;
    guards: boolean | null;
    notes: OperationsStepId[];
  };
  phenology: {
    leafOut: MonthWindow | null;
    flowering: MonthWindow | null;
    harvest: MonthWindow | null;
    leafFall: MonthWindow | null;
  };
  limitations: string[];
};

export type SpeciesOperationsRecord = SpeciesOperationsFields & {
  scientificName: string;
  wfoId: string | null;
  speciesId: string | null;
  packId: OperationsPackId;
  archetypeId: OperationsArchetypeId;
  sources: SpeciesSource[];
  confidence: Evidence['confidence'];
};

export type OperationsCuratedOverlay = {
  scientificName: string;
  wfoId?: string | null;
  speciesId?: string | null;
  archetypeId?: OperationsArchetypeId;
  plantStart?: number;
  plantEnd?: number;
  pruneStart?: number;
  pruneEnd?: number;
  pruneAnchor?: OperationsPhenologyAnchor;
  flowerStart?: number;
  flowerEnd?: number;
  harvestStart?: number;
  harvestEnd?: number;
};

export type OperationsPackFile = {
  packId: OperationsPackId;
  modelVersion: string;
  updatedAt: string;
  records: SpeciesOperationsRecord[];
};

export type OperationsCoverageReport = {
  modelVersion: string;
  generatedAt: string;
  packId: OperationsPackId;
  passes: number;
  recordCount: number;
  designReadyComplete: number;
  designReadyTotal: number;
  incomplete: Array<{ scientificName: string; missing: string[] }>;
  complete: boolean;
};

export type ResolvedOperationsProfile = SpeciesOperationsFields & {
  modelVersion: string;
  scientificName: string;
  wfoId: string | null;
  speciesId: string | null;
  packId: OperationsPackId | null;
  climateGroup: OperationsClimateGroup | null;
  archetypeId: OperationsArchetypeId;
  matchLevel: OperationsMatchLevel;
  sources: SpeciesSource[];
  confidence: Evidence['confidence'];
  unknownFields: string[];
};

export type ProjectOperationsSpeciesEntry = {
  speciesId: string;
  scientificName: string;
  count: number;
  profile: ResolvedOperationsProfile;
  resolvedPlantingWindow: MonthWindow | null;
  resolvedPruningWindow: MonthWindow | null;
  basis: OperationsFieldBasis[];
  confidence: Evidence['confidence'];
};

export type ProjectOperationsCalendarEvent = {
  yearOffset: number;
  month: number;
  startDate?: string | null;
  endDate?: string | null;
  event: OperationsCalendarEventId;
  speciesId: string | null;
  scientificName: string | null;
  titleKey: string;
  basis: OperationsFieldBasis;
  confidence: Evidence['confidence'];
};

export type OperationsLunarCue = 'waning' | null;

export type OperationsYearTaskSpecies = {
  speciesId: string;
  scientificName: string;
  count: number;
};

export type OperationsYearTask = {
  event: OperationsCalendarEventId;
  months: number[];
  species: OperationsYearTaskSpecies[];
  lunarCue: OperationsLunarCue;
  companionEvents: OperationsCalendarEventId[];
  overlappingPlantMonths: number[];
};

export type OperationsYearPlan = {
  year: number;
  yearOffset: number;
  tasks: OperationsYearTask[];
};

export type ProjectOperationsPlan = {
  modelVersion: string;
  generatedAt: string;
  plantingDate: string | null;
  packId: OperationsPackId | null;
  siteCountryCode: string | null;
  species: ProjectOperationsSpeciesEntry[];
  calendar: ProjectOperationsCalendarEvent[];
  warnings: string[];
  sources: SpeciesSource[];
};

export type HarvestProductId =
  | 'olives'
  | 'olive-oil'
  | 'carob-pods'
  | 'carob-kernel'
  | 'almonds-inshell'
  | 'grapes'
  | 'wine'
  | 'figs'
  | 'citrus-fruit'
  | 'pistachios-inshell'
  | 'prickly-pear';

export type HarvestKgRange = { low: number; base: number; high: number };

export type HarvestProductRecord = {
  id: HarvestProductId;
  kgPerTreeMature: HarvestKgRange;
  conversionFrom?: { productId: HarvestProductId; ratio: number };
  sources: SpeciesSource[];
  confidence: Evidence['confidence'];
};

export type HarvestSpeciesRecord = {
  scientificName: string;
  speciesId: string;
  plateauYear: number;
  bearing: 'annual' | 'alternate';
  irrigatedFactor: number;
  products: HarvestProductRecord[];
  limitations: string[];
};

export type HarvestYearRow = {
  speciesId: string;
  scientificName: string;
  count: number;
  productId: HarvestProductId;
  derived: boolean;
  kgLow: number;
  kgBase: number;
  kgHigh: number;
  valueLow: number;
  valueBase: number;
  valueHigh: number;
  unitPriceLocal: number;
  confidence: Evidence['confidence'];
};

export type HarvestYearPlan = {
  year: number;
  rows: HarvestYearRow[];
  kgBase: number;
  valueBase: number;
  unknownSpecies: number;
};

export type ProjectHarvestPlan = {
  modelVersion: string;
  generatedAt: string;
  year: number;
  irrigated: boolean;
  priceOverrides: Record<string, number>;
  years: HarvestYearPlan[];
  current: HarvestYearPlan;
  sources: SpeciesSource[];
  warnings: string[];
};

export type MaintenanceTaskEstimate = {
  id: MaintenanceTaskId;
  hours: number;
  cost: number;
  areaHours: number;
  plantHours: number;
  fixedHours: number;
};

export type SystemMaintenanceEstimate = {
  modelVersion: string;
  system: DesignSystemId;
  year: number;
  phase: MaintenancePhase;
  siteAreaHectares: number;
  managedAreaHectares: number;
  activePlantCount: number;
  laborCostPerHour: number;
  totalHours: number;
  totalCost: number;
  tasks: MaintenanceTaskEstimate[];
  basis: MaintenanceModelBasis;
  confidence: Evidence['confidence'];
  sources: Array<{
    id: string;
    organization: string;
    title: string;
    version: string;
    url: string;
  }>;
  exclusions: Array<'harvest' | 'annual-crops' | 'materials-inputs' | 'extraordinary-work'>;
};

export type MachineryConfiguration = {
  enabled: boolean;
  presetId: AgriculturalMachinePresetId;
  widthM: number;
  lengthM: number;
  turningRadiusM: number;
  implementWidthM: number;
  safetyClearanceM: number;
  protectPipeCrossings: boolean;
};

export type FirebreakConfiguration = {
  enabled: boolean;
  fuelModel: FirebreakFuelModel;
  treatment: FirebreakTreatment;
  expectedFlameLengthM: number;
  widthM: number;
  supportVehicleAccess: boolean;
  protectPipeCrossings: boolean;
};

export type DesignObjectives = {
  production: number;
  biodiversity: number;
  nativeHabitat: number;
  waterResilience: number;
  lowMaintenance: number;
};

export type SpeciesMixEntry = {
  targetPercent: number;
  successionOverride: SuccessionPhase | null;
  spacingOverrideM: number | null;
};

export type PlantingLine = {
  id: string;
  points: Coordinate[];
};

export type DesignConfiguration = {
  system: DesignSystemId;
  extent: PlantingExtent;
  perimeterBandM: number;
  cropAlleyWidthM: number;
  windbreakRows: number;
  orientationObjective: OrientationObjective;
  customBearingDegrees: number;
  analysisYear: number;
  monocultureSpeciesId: string | null;
  seed: number;
  objectives: DesignObjectives;
  speciesMix: Record<string, SpeciesMixEntry>;
  plantingLines: PlantingLine[];
  machinery: MachineryConfiguration;
  firebreak: FirebreakConfiguration;
};

export type SolarOrientationAssessment = {
  status: 'available' | 'unavailable';
  bearingDegrees: number;
  terrainPlaneKwhM2Year: number | null;
  cropSolarAccessPercent: number | null;
  shadedCropAreaPercent: number | null;
  winterSunHoursPerDay: number | null;
  summerSunHoursPerDay: number | null;
  windAlignmentDegrees: number | null;
  contourAlignmentDegrees: number;
  confidence: Evidence['confidence'];
  method: string;
  limitations: string[];
};

export type LayoutGenerationConflict = {
  code: 'LOCKED_TREE_SPACING' | 'LOCKED_TREE_SKIPPED_CANDIDATE';
  severity: 'warning';
  message: string;
  treeIds: string[];
};

export type LayoutGenerationAudit = {
  engineVersion: string;
  mode: 'full' | 'partial';
  seed: number;
  lockedTreeCount: number;
  generatedTreeCount: number;
  assumptions: Array<{ label: string; value: string }>;
  conflicts: LayoutGenerationConflict[];
};

export type MachineryCorridor = {
  id: string;
  points: Coordinate[];
  widthM: number;
};

export type MachineryTurningArea = {
  id: string;
  center: Coordinate;
  radiusM: number;
  rowIndexes: number[];
};

export type MachineryRoute = {
  id: string;
  points: Coordinate[];
  widthM: number;
  lengthM: number;
  closed: boolean;
  connectedCorridorIds: string[];
  clearanceSatisfied: boolean;
};

export type MachineryPlan = {
  enabled: boolean;
  presetId: AgriculturalMachinePresetId;
  machineWidthM: number;
  machineLengthM: number;
  implementWidthM: number;
  safetyClearanceM: number;
  requiredCorridorWidthM: number;
  headlandDepthM: number;
  effectiveRowSpacingM: number;
  reservedAreaM2: number;
  corridors: MachineryCorridor[];
  turningAreas: MachineryTurningArea[];
  perimeterLoops: MachineryRoute[];
  manoeuvreRoutes: MachineryRoute[];
  clearanceSatisfied: boolean;
  notes: string[];
};

export type FirebreakLine = {
  id: string;
  points: Coordinate[];
  widthM: number;
  lengthM: number;
  priority: 'windward' | 'standard';
};

export type FirebreakPlan = {
  enabled: boolean;
  fuelModel: FirebreakFuelModel;
  treatment: FirebreakTreatment;
  expectedFlameLengthM: number;
  minimumPlanningWidthM: number;
  plannedWidthM: number;
  totalLengthM: number;
  reservedAreaM2: number;
  supportVehicleAccess: boolean;
  protectPipeCrossings: boolean;
  planningWidthSatisfied: boolean;
  localReviewRequired: true;
  lines: FirebreakLine[];
  notes: string[];
  evidence: Evidence[];
};

export type LayoutVariant = {
  id: string;
  name: string;
  description: string;
  directionDegrees: number;
  rowSpacingM: number;
  treeSpacingM: number;
  design: DesignConfiguration;
  solar: SolarOrientationAssessment;
  score: number;
  trees: TreeInstance[];
  warnings: string[];
  generation: LayoutGenerationAudit;
  machinery: MachineryPlan;
  firebreak: FirebreakPlan;
  composition: {
    byStratum: Partial<Record<Stratum, number>>;
    bySuccession: Partial<Record<SuccessionPhase, number>>;
    productivePercent: number;
    nativePercent: number | null;
    nativeDataAvailable: boolean;
    nitrogenFixerPercent: number;
    targets: {
      productivePercent: number;
      nativePercent: number;
      nitrogenFixerPercent: number;
      minimumStrata: number;
    };
  };
  metrics: {
    totalTrees: number;
    speciesCount: number;
    treesPerHectare: number;
    densityBasisAreaM2: number;
    projectedCanopyYear10Percent: number;
    projectedCanopyYear20Percent: number;
    cropInteriorAreaM2: number;
  };
};

export type GrowthState = {
  year: number;
  heightM: number;
  crownDiameterM: number;
  active: boolean;
  uncertainty: {
    heightLowM: number;
    heightHighM: number;
    crownDiameterLowM: number;
    crownDiameterHighM: number;
  };
  model: {
    version: string;
    level: 'species-parameterized';
    confidence: Evidence['confidence'];
    sourceLabels: string[];
  };
};

export type IrrigationSourceType = 'network' | 'well' | 'tank' | 'reservoir';

export type IrrigationConfiguration = {
  sourceType: IrrigationSourceType;
  sourcePointId: string | null;
  availableFlowM3Hour: number;
  inletPressureBar: number;
  wellLiftM: number;
  tankCapacityM3: number;
  emitterFlowLHour: number;
  emittersPerPlant: number;
  distributionEfficiencyPercent: number;
  targetVelocityMS: number;
  maxZoneRuntimeHours: number;
  lineOverrides: Record<string, Coordinate[]>;
};

export type EconomicConfiguration = {
  countryCode: string;
  currencyCode: string;
  currencyLocale: string;
  baseCurrencyCode: 'USD';
  exchangeRateToLocal: number;
  laborCostPerHour: number;
  waterCostPerM3: number;
  electricityCostPerKwh: number;
  plantReferenceMultiplier: number;
  plantUnitCostOverrides: Record<string, number>;
  irrigationReferenceMultiplier: number;
  smallProtectionUnitCost: number;
  largeProtectionUnitCost: number;
  pricingStatus: 'usd-estimate' | 'currency-converted-estimate' | 'user-supplied';
  missingLocalRates: string[];
  sourceSummary: string;
  sourceVersion: string;
  sourceObservedAt: string;
  confidence: Evidence['confidence'];
};

export type IrrigationLine = {
  id: string;
  kind: 'mainline' | 'submain' | 'lateral' | 'protected-crossing';
  routingStatus: 'clear' | 'blocked';
  zoneId: string | null;
  points: Coordinate[];
  lengthM: number;
  diameterMm: number;
  designFlowM3Hour: number;
  velocityMS: number;
  headLossM: number;
  startElevationM: number;
  endElevationM: number;
};

export type IrrigationComponent = {
  id: string;
  category: 'pipe' | 'emitter' | 'fitting' | 'valve' | 'filter' | 'control' | 'pump' | 'storage' | 'protection';
  label: string;
  specification: string;
  unit: 'm' | 'each';
  measuredQuantity: number;
  purchaseQuantity: number;
  unitCost: number;
  totalCost: number;
};

export type IrrigationNetworkPlan = {
  source: {
    type: IrrigationSourceType;
    coordinate: Coordinate;
    elevationM: number;
    placement: 'user-water-point' | 'highest-terrain-sample' | 'field-centroid';
    requiresHydrogeologicalSurvey: boolean;
  };
  lines: IrrigationLine[];
  components: IrrigationComponent[];
  requiredFlowM3Hour: number;
  availableFlowM3Hour: number;
  requiredDynamicHeadM: number;
  availablePressureHeadM: number;
  pumpRequired: boolean;
  pumpPowerKw: number;
  peakZoneRuntimeHours: number;
  protectedCrossingCount: number;
  routedObstacleCount: number;
  routingValid: boolean;
  unroutableLineIds: string[];
  manualOverrideCount: number;
  totalMeasuredPipeM: number;
  totalPurchasePipeM: number;
  warnings: string[];
};

export type IrrigationEstimate = {
  designYear: number;
  activePlantCount: number;
  irrigatedPlantCount: number;
  inactivePlantCount: number;
  configuration: IrrigationConfiguration;
  economics: EconomicConfiguration;
  network: IrrigationNetworkPlan;
  climatePeriod: string;
  annualNetMm: number;
  annualGrossMm: number;
  annualWaterM3: number;
  potentialAnnualWaterM3: number;
  waterModel: {
    system: DesignSystemId;
    supplementalIrrigationPercent: number;
    matureSupplementalTargetPercent: number;
    transitionYears: number;
    basis: 'measured-system-reference' | 'conservative-planning-default';
  };
  peakDayM3: number;
  zones: number;
  emitterCount: number;
  lateralPipeM: number;
  mainlinePipeM: number;
  installation: {
    materialsCost: number;
    laborHours: number;
    laborCost: number;
    totalCost: number;
  };
  annualOperation: {
    waterCost: number;
    pumpingKwh: number;
    energyCost: number;
    maintenanceCost: number;
    managementLaborHours: number;
    managementLaborCost: number;
    totalCost: number;
  };
  systemMaintenance: SystemMaintenanceEstimate;
  satelliteScheduling: {
    adjustmentPercent: number;
    recommendation: string;
    confidence: Evidence['confidence'];
    sceneAt: string | null;
    highPrioritySamples: number;
    mediumPrioritySamples: number;
    lowPrioritySamples: number;
    annualVolumeAdjusted: false;
  };
  assumptions: Array<{ label: string; value: string; source: string; sourceUrl: string }>;
  monthly: Array<{ month: number; netM3: number; grossM3: number; cost: number }>;
};

export type EstablishmentCost = {
  economics: EconomicConfiguration;
  plantPurchaseCost: number;
  plantingLaborHours: number;
  plantingLaborCost: number;
  protectionAndStakesCost: number;
  irrigationInstallationCost: number;
  totalCost: number;
  bySpecies: Array<{
    speciesId: string;
    count: number;
    unitPlantCost: number;
    unitLaborHours: number;
    subtotalCost: number;
  }>;
  activeSystem: {
    designYear: number;
    activePlantCount: number;
    inactivePlantCount: number;
    plantPurchaseCost: number;
    plantingLaborHours: number;
    plantingLaborCost: number;
    protectionAndStakesCost: number;
    irrigationInstallationCost: number;
    totalReplacementCost: number;
    bySpecies: Array<{
      speciesId: string;
      count: number;
      unitPlantCost: number;
      unitLaborHours: number;
      subtotalCost: number;
    }>;
  };
  timeline: Array<{
    year: number;
    activePlantCount: number;
    annualWaterM3: number;
    waterAndEnergyCost: number;
    maintenanceLaborHours: number;
    managementLaborCost: number;
    maintenanceTasks: MaintenanceTaskEstimate[];
    maintenanceCost: number;
    annualOperatingCost: number;
    activeReplacementCost: number;
    cumulativeOperatingCost: number;
  }>;
};

export type ProjectState = {
  id: string;
  name: string;
  site: SiteBoundary;
  siteProfile: SiteProfile | null;
  selectedSpeciesIds: string[];
  userSpecies?: DesignSpecies[];
  designConfiguration: DesignConfiguration;
  irrigationConfiguration: IrrigationConfiguration;
  economicConfiguration: EconomicConfiguration;
  variants: LayoutVariant[];
  selectedVariantId: string | null;
  timelineYear: number;
  irrigation: IrrigationEstimate | null;
  costs: EstablishmentCost | null;
  fireOperations: FireOperationsPlan;
  operations?: ProjectOperationsPlan | null;
  harvest?: ProjectHarvestPlan | null;
  harvestPriceOverrides?: Record<string, number>;
  analysis?: ProjectAnalysisReport | null;
  collaboration: ProjectCollaboration;
  revision?: number;
  revisionId?: string | null;
  calculationRunId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SharedSystemMaintenanceEstimate = Omit<SystemMaintenanceEstimate, 'laborCostPerHour' | 'totalCost' | 'tasks'> & {
  tasks: Array<Omit<MaintenanceTaskEstimate, 'cost'>>;
};

export type SharedIrrigationEstimate = Omit<IrrigationEstimate, 'economics' | 'network' | 'installation' | 'annualOperation' | 'systemMaintenance' | 'monthly'> & {
  network: Omit<IrrigationNetworkPlan, 'components'> & {
    components: Array<Omit<IrrigationComponent, 'unitCost' | 'totalCost'>>;
  };
  installation: Pick<IrrigationEstimate['installation'], 'laborHours'>;
  annualOperation: Pick<IrrigationEstimate['annualOperation'], 'pumpingKwh' | 'managementLaborHours'>;
  systemMaintenance: SharedSystemMaintenanceEstimate;
  monthly: Array<Omit<IrrigationEstimate['monthly'][number], 'cost'>>;
};

export type SharedProjectState = Omit<ProjectState, 'economicConfiguration' | 'irrigation' | 'collaboration' | 'analysis'> & {
  economicConfiguration: EconomicConfiguration | null;
  irrigation: IrrigationEstimate | SharedIrrigationEstimate | null;
  collaboration: Omit<ProjectCollaboration, 'share'> & {
    share: Omit<ProjectCollaboration['share'], 'tokenVersion'>;
  };
};

export type FireMaintenanceTaskStatus = 'due' | 'scheduled' | 'complete' | 'not-applicable';

export type FireMaintenanceTask = {
  id: 'surface-fuels' | 'vehicle-access' | 'pipe-crossings' | 'cut-biomass' | 'authority-review';
  status: FireMaintenanceTaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  notes: string;
};

export type FireOperationsPlan = {
  reviewedAt: string | null;
  nextInspectionAt: string | null;
  notes: string;
  tasks: FireMaintenanceTask[];
  sourceSnapshot: {
    provider: 'EFFIS';
    layer: 'ecmwf.fwi';
    forecastDate: string;
    sourceUrl: string;
    resolutionKm: 8;
    observedAt: string;
  };
};

export type ProjectCommentTarget = 'general' | 'tree' | 'firebreak' | 'water';

export type ProjectComment = {
  id: string;
  authorName: string;
  message: string;
  coordinate: Coordinate | null;
  target: ProjectCommentTarget;
  targetId: string | null;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
};

export type ProjectReviewStatus = 'pending' | 'approved' | 'changes-requested';

export type ProjectReview = {
  status: ProjectReviewStatus;
  reviewerName: string;
  note: string;
  revision: number;
  updatedAt: string;
};

export type ProjectCollaboration = {
  share: {
    enabled: boolean;
    mode: 'view' | 'review';
    includeCosts: boolean;
    tokenVersion: string;
    createdAt: string | null;
    expiresAt: string | null;
  };
  comments: ProjectComment[];
  review: ProjectReview | null;
};

export type ProjectRevisionSummary = {
  revision: number;
  revisionId: string;
  calculationRunId: string | null;
  createdAt: string;
  contentHash: string;
  name: string;
  selectedVariantId: string | null;
  treeCount: number;
};

export type CalculationSnapshot = {
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
  inputHash: string;
  geometryHash: string;
  selectedVariantId: string | null;
  selectedSpeciesIds: string[];
  modelVersions: {
    application: string;
    layout: string | null;
    growth: string;
    irrigation: string;
    maintenance: string;
    economics: string;
  };
  evidenceVersions: Array<{ source: string; version: string; observedAt: string }>;
  outputSummary: {
    treeCount: number;
    annualWaterM3: number | null;
    maintenanceLaborHours: number | null;
    maintenanceLaborCost: number | null;
    establishmentCost: number | null;
    currencyCode: string;
  };
};

export type AssistantProjectContext = {
  site: SiteBoundary | null;
  siteProfile: SiteProfile | null;
  selectedSpeciesIds: string[];
  userSpecies?: DesignSpecies[];
  designConfiguration: DesignConfiguration;
  irrigationConfiguration: IrrigationConfiguration;
  economicConfiguration: EconomicConfiguration;
  variants: Array<Pick<LayoutVariant, 'id' | 'name' | 'description' | 'score' | 'metrics' | 'solar' | 'composition' | 'machinery' | 'firebreak' | 'warnings' | 'generation'>>;
  selectedVariantId: string | null;
  timelineYear: number;
  irrigation: IrrigationEstimate | null;
  costs: EstablishmentCost | null;
  fireOperations: FireOperationsPlan;
  operations?: ProjectOperationsPlan | null;
  harvest?: ProjectHarvestPlan | null;
  section: 'site' | 'profile' | 'species' | 'layout' | 'water' | 'fire' | 'costs' | 'analysis' | 'care' | 'harvest';
};

export type AssistantAction =
  | { type: 'add_species'; speciesIds: string[] }
  | { type: 'remove_species'; speciesIds: string[] }
  | { type: 'set_species_mix'; entries: Array<{ speciesId: string; targetPercent: number; successionOverride: SuccessionPhase | null }> }
  | { type: 'set_design_spacing'; cropAlleyWidthM?: number; perimeterBandM?: number; analysisYear?: number; customBearingDegrees?: number }
  | { type: 'set_machinery_parameters'; enabled?: boolean; presetId?: AgriculturalMachinePresetId; widthM?: number; lengthM?: number; turningRadiusM?: number; implementWidthM?: number; safetyClearanceM?: number }
  | { type: 'set_firebreak_parameters'; enabled?: boolean; fuelModel?: FirebreakFuelModel; treatment?: FirebreakTreatment; expectedFlameLengthM?: number; widthM?: number; supportVehicleAccess?: boolean }
  | { type: 'set_irrigation_parameters'; availableFlowM3Hour?: number; inletPressureBar?: number; emitterFlowLHour?: number; emittersPerPlant?: number; distributionEfficiencyPercent?: number; maxZoneRuntimeHours?: number }
  | { type: 'select_variant'; variantId: string }
  | { type: 'set_timeline_year'; year: number }
  | { type: 'regenerate_layout' }
  | { type: 'recalculate_water_and_costs' }
  | { type: 'navigate'; section: AssistantProjectContext['section'] };

export type AssistantProposal = {
  id: string;
  model: string;
  summary: string;
  rationale: string;
  warnings: string[];
  actions: AssistantAction[];
  requiresConfirmation: boolean;
};

export type ProjectAnalysisDimensionId = 'evidence' | 'species' | 'design' | 'water' | 'fire' | 'operations' | 'economics' | 'coherence';
export type ProjectAnalysisVerdict = 'ready' | 'revise' | 'incomplete';
export type ProjectAnalysisSeverity = 'blocking' | 'major' | 'minor' | 'info';
export type ProjectAnalysisFindingResolutionStatus = 'resolved' | 'accepted';
export type ProjectAnalysisAgentStatus = 'running' | 'resolved' | 'improved' | 'blocked' | 'stopped' | 'failed';
export type ProjectAnalysisAgentStopReason = 'selected-resolved' | 'max-iterations' | 'no-actions' | 'repeated-actions' | 'score-plateau' | 'user-stopped' | 'error';

export type ProjectAnalysisAgentStep = {
  iteration: number;
  generatedAt: string;
  scoreBefore: number;
  scoreAfter: number | null;
  proposalSummary: string;
  actionTypes: AssistantAction['type'][];
  outcome: 'improved' | 'unchanged' | 'regressed' | 'blocked';
};

export type ProjectAnalysisAgentRun = {
  id: string;
  status: ProjectAnalysisAgentStatus;
  stopReason: ProjectAnalysisAgentStopReason | null;
  selectedFindingIds: string[];
  selectedFindingTitles: string[];
  startedAt: string;
  completedAt: string | null;
  initialScore: number;
  currentScore: number;
  iteration: number;
  maxIterations: number;
  steps: ProjectAnalysisAgentStep[];
};

export type ProjectAnalysisDimension = {
  id: ProjectAnalysisDimensionId;
  score: number;
  status: 'pass' | 'attention' | 'fail' | 'unknown';
  summary: string;
};

export type ProjectAnalysisFinding = {
  id: string;
  severity: ProjectAnalysisSeverity;
  area: ProjectAnalysisDimensionId;
  title: string;
  explanation: string;
  evidence: string[];
  recommendation: string;
  resolution?: {
    status: ProjectAnalysisFindingResolutionStatus;
    updatedAt: string;
  };
};

export type ProjectAnalysisReport = {
  id: string;
  model: string;
  generatedAt: string;
  contextFingerprint: string;
  verdict: ProjectAnalysisVerdict;
  overallScore: number;
  executiveSummary: string;
  dimensions: ProjectAnalysisDimension[];
  findings: ProjectAnalysisFinding[];
  assumptions: string[];
  limitations: string[];
  agentRun?: ProjectAnalysisAgentRun;
};
