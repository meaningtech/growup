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
  observedAt: string;
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
  satellite: SatelliteProfile;
  warnings: string[];
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

export type SolarResourceProfile = {
  status: 'available' | 'unavailable';
  period: string;
  annualGlobalHorizontalKwhM2: number;
  annualDirectNormalKwhM2: number;
  prevailingWindDirectionDegrees: number | null;
  prevailingWindDirectionLabel: string | null;
  meanWindSpeedMs: number | null;
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

export type DesignObjectives = {
  production: number;
  biodiversity: number;
  nativeHabitat: number;
  waterResilience: number;
  lowMaintenance: number;
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
  machinery: MachineryConfiguration;
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
  clearanceSatisfied: boolean;
  notes: string[];
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
    managementLaborCost: number;
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
  designConfiguration: DesignConfiguration;
  irrigationConfiguration: IrrigationConfiguration;
  economicConfiguration: EconomicConfiguration;
  variants: LayoutVariant[];
  selectedVariantId: string | null;
  timelineYear: number;
  irrigation: IrrigationEstimate | null;
  costs: EstablishmentCost | null;
  revision?: number;
  revisionId?: string | null;
  calculationRunId?: string | null;
  createdAt: string;
  updatedAt: string;
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
    economics: string;
  };
  evidenceVersions: Array<{ source: string; version: string; observedAt: string }>;
  outputSummary: {
    treeCount: number;
    annualWaterM3: number | null;
    establishmentCost: number | null;
    currencyCode: string;
  };
};

export type AssistantProjectContext = {
  site: SiteBoundary | null;
  siteProfile: SiteProfile | null;
  selectedSpeciesIds: string[];
  designConfiguration: DesignConfiguration;
  variants: Array<Pick<LayoutVariant, 'id' | 'name' | 'description' | 'score' | 'metrics'>>;
  selectedVariantId: string | null;
  timelineYear: number;
  irrigation: IrrigationEstimate | null;
  costs: EstablishmentCost | null;
  section: 'site' | 'profile' | 'species' | 'layout' | 'water' | 'costs';
};

export type AssistantAction =
  | { type: 'add_species'; speciesIds: string[] }
  | { type: 'remove_species'; speciesIds: string[] }
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
