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
  landCover: {
    classification: string;
    osmTags: Record<string, string>;
    evidence: Evidence;
  };
  satellite: SatelliteProfile;
  warnings: string[];
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
  nativeMediterranean: boolean;
  nativeItaly: boolean;
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
  purchasePriceEur: number;
  purchasePriceRangeEur: [number, number];
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
  composition: {
    byStratum: Partial<Record<Stratum, number>>;
    bySuccession: Partial<Record<SuccessionPhase, number>>;
    productivePercent: number;
    nativePercent: number;
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
};

export type IrrigationEstimate = {
  climatePeriod: string;
  annualNetMm: number;
  annualGrossMm: number;
  annualWaterM3: number;
  peakDayM3: number;
  zones: number;
  emitterCount: number;
  lateralPipeM: number;
  mainlinePipeM: number;
  installation: {
    materialsEur: number;
    laborHours: number;
    laborEur: number;
    totalEur: number;
  };
  annualOperation: {
    waterEur: number;
    pumpingKwh: number;
    energyEur: number;
    maintenanceEur: number;
    totalEur: number;
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
  monthly: Array<{ month: number; netM3: number; grossM3: number; costEur: number }>;
};

export type EstablishmentCost = {
  plantPurchaseEur: number;
  plantingLaborHours: number;
  plantingLaborEur: number;
  protectionAndStakesEur: number;
  irrigationInstallationEur: number;
  totalEur: number;
  bySpecies: Array<{
    speciesId: string;
    count: number;
    unitPlantEur: number;
    unitLaborHours: number;
    subtotalEur: number;
  }>;
};

export type ProjectState = {
  id: string;
  name: string;
  site: SiteBoundary;
  siteProfile: SiteProfile | null;
  selectedSpeciesIds: string[];
  designConfiguration: DesignConfiguration;
  variants: LayoutVariant[];
  selectedVariantId: string | null;
  timelineYear: number;
  irrigation: IrrigationEstimate | null;
  costs: EstablishmentCost | null;
  createdAt: string;
  updatedAt: string;
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
