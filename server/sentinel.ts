import { fromArrayBuffer } from 'geotiff';
import { createLocalProjection, pointInPolygon, polygonCentroid } from '../src/lib/geometry.js';
import { boundaryGeoJsonGeometry, siteContainsCoordinate, sitePolygons } from '../src/lib/siteGeometry.js';
import type {
  Coordinate,
  Evidence,
  ExistingVegetationPatch,
  ExistingVegetationProfile,
  SatelliteIndexSummary,
  SatelliteOpticalObservation,
  SatelliteProfile,
  SatelliteRadarObservation,
  SatelliteWaterSample,
  SiteBoundary,
} from '../src/types.js';

const DEFAULT_STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const DEFAULT_DATA_URL = 'https://planetarycomputer.microsoft.com/api/data/v1';
const OPTICAL_COLLECTION = 'sentinel-2-l2a' as const;
const RADAR_COLLECTION = 'sentinel-1-rtc' as const;
const ANNUAL_LAND_COVER_COLLECTION = 'io-lulc-annual-v02' as const;
const WORLD_COVER_COLLECTION = 'esa-worldcover' as const;
const DEFAULT_COPERNICUS_WVL_WMS_URL = 'https://copernicus.discomap.eea.europa.eu/arcgis/services/GioLandPublic/HRL_WoodyVegetationLayer_2021/ImageServer/WMSServer';
const ANNUAL_LAND_COVER_YEARS = [2021, 2022, 2023] as const;
const MAXIMUM_ACCEPTED_WOODY_COVER_PERCENT = 25;
const OPTICAL_EXPRESSIONS = [
  '(B08_b1-B04_b1)/(B08_b1+B04_b1)',
  '(B08_b1-B11_b1)/(B08_b1+B11_b1)',
  '(B03_b1-B08_b1)/(B03_b1+B08_b1)',
  '(B11_b1+B04_b1-B08_b1-B02_b1)/(B11_b1+B04_b1+B08_b1+B02_b1)',
  'SCL_b1',
];
const RADAR_EXPRESSIONS = ['vv_b1', 'vh_b1'];
const CLEAR_SURFACE_CLASSES = new Set([2, 4, 5, 6, 7]);
const CLOUD_OR_INVALID_CLASSES = new Set([0, 1, 3, 8, 9, 10, 11]);

export type SentinelProviderConfig = {
  fetchImpl?: typeof fetch;
  planetaryComputerStacUrl?: string;
  planetaryComputerDataUrl?: string;
  now?: () => Date;
};

type StacItem = {
  id: string;
  properties: {
    datetime?: string;
    platform?: string;
    'eo:cloud_cover'?: number;
    'sat:orbit_state'?: string;
    'sat:relative_orbit'?: number;
  };
  assets?: Record<string, unknown>;
};

type RasterBounds = [number, number, number, number];

type OpticalRasterResult = {
  observation: SatelliteOpticalObservation;
  pixels: Array<{ rasterIndex: number; coordinate: Coordinate; ndmi: number; ndvi: number }>;
  bounds: RasterBounds;
  width: number;
  height: number;
};

type LandCoverRasterResult = {
  year: number;
  classes: number[];
  mask: number[];
  bounds: RasterBounds;
  width: number;
  height: number;
};

export async function fetchSatelliteProfile(
  site: SiteBoundary,
  config: SentinelProviderConfig = {},
): Promise<SatelliteProfile> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now?.() ?? new Date();
  const stacUrl = trimSlash(config.planetaryComputerStacUrl ?? process.env.PLANETARY_COMPUTER_STAC_URL ?? DEFAULT_STAC_URL);
  const dataUrl = trimSlash(config.planetaryComputerDataUrl ?? process.env.PLANETARY_COMPUTER_DATA_URL ?? DEFAULT_DATA_URL);
  const [optical, radar] = await Promise.all([
    fetchOptical(site, now, fetchImpl, stacUrl, dataUrl).catch(() => null),
    fetchRadar(site, now, fetchImpl, stacUrl, dataUrl).catch(() => null),
  ]);
  const generatedAt = now.toISOString();
  const status = optical && radar ? 'available' : optical || radar ? 'partial' : 'unavailable';
  const scheduling = irrigationScheduling(optical?.history[0] ?? null, radar?.observations ?? []);

  return {
    status,
    generatedAt,
    optical: {
      collection: OPTICAL_COLLECTION,
      latest: optical?.history[0] ?? null,
      history: optical?.history ?? [],
      waterSamples: optical?.waterSamples ?? [],
      ndmiPreviewUrl: optical?.ndmiPreviewUrl ?? null,
      trueColorPreviewUrl: optical?.trueColorPreviewUrl ?? null,
    },
    radar: {
      collection: RADAR_COLLECTION,
      latest: radar?.observations[0] ?? null,
      history: radar?.observations ?? [],
      baselineSceneCount: radar?.baselineCount ?? 0,
      latestVvAnomalyDb: radar?.anomalyDb ?? null,
      latestVvPercentile: radar?.percentile ?? null,
      surfaceMoistureSignal: radar?.signal ?? 'unavailable',
    },
    existingVegetation: optical?.existingVegetation ?? unavailableExistingVegetation(generatedAt),
    irrigationScheduling: scheduling,
    evidence: satelliteEvidence(generatedAt, stacUrl, dataUrl),
    limitations: [
      'Sentinel-2 indices describe canopy and surface water response; they are not volumetric soil-water measurements.',
      'Sentinel-1 backscatter also responds to vegetation, roughness, row geometry and recent field operations. The signal is a same-orbit anomaly, not a calibrated moisture percentage.',
      'Use field probes and soil samples to calibrate irrigation execution; satellite data is used here to prioritize inspection and scheduling zones.',
      'Annual irrigation volume remains climate- and crop-coefficient-based. A current satellite scene only adjusts the next scheduling recommendation.',
    ],
  };
}

export function unavailableSatelliteProfile(now = new Date()): SatelliteProfile {
  const generatedAt = now.toISOString();
  return {
    status: 'unavailable',
    generatedAt,
    optical: {
      collection: OPTICAL_COLLECTION,
      latest: null,
      history: [],
      waterSamples: [],
      ndmiPreviewUrl: null,
      trueColorPreviewUrl: null,
    },
    radar: {
      collection: RADAR_COLLECTION,
      latest: null,
      history: [],
      baselineSceneCount: 0,
      latestVvAnomalyDb: null,
      latestVvPercentile: null,
      surfaceMoistureSignal: 'unavailable',
    },
    existingVegetation: unavailableExistingVegetation(generatedAt),
    irrigationScheduling: {
      adjustmentPercent: 0,
      recommendation: 'No current satellite scheduling adjustment is available.',
      confidence: 'low',
      annualVolumeAdjusted: false,
    },
    evidence: satelliteEvidence(generatedAt, DEFAULT_STAC_URL, DEFAULT_DATA_URL),
    limitations: ['Satellite providers were unavailable. Irrigation remains based on historical climate and crop coefficients.'],
  };
}

function unavailableExistingVegetation(observedAt: string): ExistingVegetationProfile {
  return {
    status: 'unavailable',
    suitability: 'review-required',
    analyzedOpticalScenes: 0,
    annualLandCoverYears: [],
    woodyVegetationLayerAvailable: false,
    detectedCoverPercent: 0,
    protectedCoverPercent: 0,
    maximumAcceptedCoverPercent: MAXIMUM_ACCEPTED_WOODY_COVER_PERCENT,
    patches: [],
    evidence: existingVegetationEvidence(observedAt),
    conclusion: 'Existing woody vegetation could not be classified automatically. A field survey is required before placing plants.',
  };
}

async function fetchOptical(
  site: SiteBoundary,
  now: Date,
  fetchImpl: typeof fetch,
  stacUrl: string,
  dataUrl: string,
) {
  const items = await searchItems(fetchImpl, stacUrl, {
    collections: [OPTICAL_COLLECTION],
    intersects: boundaryGeoJsonGeometry(site),
    datetime: dateRange(now, 480),
    query: { 'eo:cloud_cover': { lt: 35 } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: 180,
  });
  const candidates = selectOpticalCandidates(items, 10);
  const loaded = await Promise.all(candidates.map(async (item) => {
    try {
      return await loadOpticalRaster(site, item, fetchImpl, dataUrl);
    } catch {
      return null;
    }
  }));
  const usable = loaded
    .filter((item): item is OpticalRasterResult => item !== null)
    .sort((a, b) => b.observation.acquiredAt.localeCompare(a.observation.acquiredAt));
  const clean = usable.filter((item) => item.observation.fieldCloudPercent <= 20);
  const selected = (clean.length ? clean : usable).slice(0, 8);
  if (!selected.length) throw new Error('No usable Sentinel-2 raster intersects the site');
  const latest = selected[0];
  const waterSamples = classifyWaterSamples(latest.pixels);
  const existingVegetation = await classifyExistingVegetation(
    site,
    selected,
    fetchImpl,
    stacUrl,
    dataUrl,
    now.toISOString(),
  );
  return {
    history: selected.map((item) => item.observation),
    waterSamples,
    existingVegetation,
    ndmiPreviewUrl: previewUrl(dataUrl, latest.bounds, latest.observation.sceneId, 'ndmi'),
    trueColorPreviewUrl: previewUrl(dataUrl, latest.bounds, latest.observation.sceneId, 'true-color'),
  };
}

async function loadOpticalRaster(
  site: SiteBoundary,
  item: StacItem,
  fetchImpl: typeof fetch,
  dataUrl: string,
): Promise<OpticalRasterResult> {
  const coordinates = sitePolygons(site).flat();
  const rasterBounds = paddedBounds(coordinates, 0.08);
  const size = rasterDimensions(rasterBounds, coordinates);
  const raster = await fetchExpressionRaster(
    fetchImpl,
    dataUrl,
    OPTICAL_COLLECTION,
    item.id,
    rasterBounds,
    size,
    OPTICAL_EXPRESSIONS,
  );
  if (raster.bands.length < 6) throw new Error('Sentinel-2 raster is missing index, SCL or mask bands');
  const [ndviBand, ndmiBand, ndwiBand, bareSoilBand, sclBand, maskBand] = raster.bands;
  const ndvi: number[] = [];
  const ndmi: number[] = [];
  const ndwi: number[] = [];
  const bareSoil: number[] = [];
  const pixels: OpticalRasterResult['pixels'] = [];
  let observedPixels = 0;
  let cloudPixels = 0;

  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const coordinate = pixelCoordinate(index, raster.width, raster.height, rasterBounds);
    if (!siteContainsCoordinate(site, coordinate) || Number(maskBand[index]) <= 0) continue;
    const scl = Math.round(Number(sclBand[index]));
    observedPixels += 1;
    if (CLOUD_OR_INVALID_CLASSES.has(scl)) cloudPixels += 1;
    if (!CLEAR_SURFACE_CLASSES.has(scl)) continue;
    const values = [ndviBand, ndmiBand, ndwiBand, bareSoilBand].map((band) => Number(band[index]));
    if (values.some((value) => !Number.isFinite(value) || value < -1.5 || value > 1.5)) continue;
    ndvi.push(values[0]);
    ndmi.push(values[1]);
    ndwi.push(values[2]);
    bareSoil.push(values[3]);
    pixels.push({ rasterIndex: index, coordinate, ndvi: values[0], ndmi: values[1] });
  }
  if (ndmi.length < 3) throw new Error('Sentinel-2 has too few clear pixels over the site');
  const acquiredAt = requiredDate(item);
  return {
    observation: {
      sceneId: item.id,
      acquiredAt,
      platform: item.properties.platform ?? item.id.slice(0, 3),
      sceneCloudPercent: round(Number(item.properties['eo:cloud_cover'] ?? 100), 2),
      fieldCloudPercent: round(observedPixels ? cloudPixels / observedPixels * 100 : 100, 2),
      ndvi: summarizeIndex(ndvi),
      ndmi: summarizeIndex(ndmi),
      ndwi: summarizeIndex(ndwi),
      bareSoilIndex: summarizeIndex(bareSoil),
    },
    pixels,
    bounds: rasterBounds,
    width: raster.width,
    height: raster.height,
  };
}

function selectOpticalCandidates(items: StacItem[], limit: number) {
  const sorted = [...items].sort((a, b) => requiredDate(b).localeCompare(requiredDate(a)));
  const selected: StacItem[] = [];
  for (const item of sorted) {
    const timestamp = Date.parse(requiredDate(item));
    const separated = selected.every((candidate) => Math.abs(timestamp - Date.parse(requiredDate(candidate))) >= 28 * 24 * 60 * 60 * 1000);
    if (separated) selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected.length >= 4 ? selected : sorted.slice(0, limit);
}

async function classifyExistingVegetation(
  site: SiteBoundary,
  opticalScenes: OpticalRasterResult[],
  fetchImpl: typeof fetch,
  stacUrl: string,
  dataUrl: string,
  observedAt: string,
): Promise<ExistingVegetationProfile> {
  const latest = opticalScenes[0];
  const landCover = await loadIndependentLandCover(site, latest, fetchImpl, stacUrl, dataUrl);
  const timeSeries = new Map<number, Array<{ ndvi: number; fieldMedian: number; fieldStandardDeviation: number }>>();
  for (const scene of opticalScenes) {
    for (const pixel of scene.pixels) {
      timeSeries.set(pixel.rasterIndex, [
        ...(timeSeries.get(pixel.rasterIndex) ?? []),
        {
          ndvi: pixel.ndvi,
          fieldMedian: scene.observation.ndvi.median,
          fieldStandardDeviation: scene.observation.ndvi.standardDeviation,
        },
      ]);
    }
  }
  const latestPixels = new Map(latest.pixels.map((pixel) => [pixel.rasterIndex, pixel]));
  const worldClasses = landCover.worldCover?.classes ?? [];
  const candidates = new Map<number, {
    coordinate: Coordinate;
    currentNdvi: number;
    medianNdvi: number;
    persistentGreenFraction: number;
    annualTreeVotes: number;
    worldCoverTree: boolean;
    copernicusWoody: boolean;
    confidence: Evidence['confidence'];
    signals: string[];
  }>();

  for (let index = 0; index < latest.width * latest.height; index += 1) {
    const coordinate = pixelCoordinate(index, latest.width, latest.height, latest.bounds);
    if (!siteContainsCoordinate(site, coordinate)) continue;
    const entries = timeSeries.get(index) ?? [];
    if (!entries.length) continue;
    const values = entries.map((entry) => entry.ndvi);
    const current = latestPixels.get(index);
    const currentNdvi = current?.ndvi ?? values[0];
    const medianNdvi = median(values);
    const absolutePersistence = values.filter((value) => value >= 0.35).length / values.length;
    const relativePersistence = entries.filter((entry) => (
      entry.ndvi - entry.fieldMedian >= Math.max(0.08, entry.fieldStandardDeviation * 1.4)
    )).length / entries.length;
    const persistentGreenFraction = Math.max(absolutePersistence, relativePersistence);
    const medianNdviAnomaly = median(entries.map((entry) => entry.ndvi - entry.fieldMedian));
    const validAnnual = landCover.annual.filter((raster) => Number(raster.mask[index]) > 0);
    const treeYears = validAnnual.filter((raster) => Math.round(Number(raster.classes[index])) === 2).length;
    const annualTreeVotes = validAnnual.length ? treeYears / validAnnual.length : 0;
    const worldCoverTree = Boolean(landCover.worldCover && Number(landCover.worldCover.mask[index]) > 0 && Math.round(Number(worldClasses[index])) === 10);
    const copernicusWoody = Boolean(landCover.woodyVegetation && Number(landCover.woodyVegetation.mask[index]) > 0 && Math.round(Number(landCover.woodyVegetation.classes[index])) === 1);
    const maxNdvi = Math.max(...values);
    const spectralPersistence = medianNdvi >= 0.32 && persistentGreenFraction >= 0.4;
    const strongCurrentCrown = currentNdvi >= 0.43 && maxNdvi >= 0.48;
    const persistentLinearVegetation = medianNdviAnomaly >= 0.08 && relativePersistence >= 0.5 && maxNdvi >= 0.32;
    const classifiedTree = annualTreeVotes >= 0.5 || worldCoverTree || copernicusWoody;
    const score = annualTreeVotes * 0.35
      + (worldCoverTree ? 0.12 : 0)
      + (copernicusWoody ? 0.25 : 0)
      + normalize(medianNdvi, 0.2, 0.55) * 0.12
      + persistentGreenFraction * 0.09
      + normalize(currentNdvi, 0.25, 0.55) * 0.07;
    const detected = (classifiedTree && score >= 0.44)
      || annualTreeVotes >= 0.67
      || (strongCurrentCrown && spectralPersistence)
      || ((worldCoverTree || copernicusWoody) && spectralPersistence)
      || persistentLinearVegetation;
    if (!detected) continue;
    const signals = [
      ...(annualTreeVotes >= 0.5 ? [`tree class in ${treeYears}/${validAnnual.length} annual maps`] : []),
      ...(worldCoverTree ? ['ESA WorldCover tree class'] : []),
      ...(copernicusWoody ? ['Copernicus 5 m woody-vegetation class'] : []),
      ...(spectralPersistence ? ['persistent multi-date NDVI'] : []),
      ...(strongCurrentCrown ? [`current NDVI ${round(currentNdvi, 2)}`] : []),
      ...(persistentLinearVegetation ? [`persistent NDVI anomaly +${round(medianNdviAnomaly, 2)}`] : []),
    ];
    const independentAgreement = copernicusWoody && (annualTreeVotes >= 0.5 || worldCoverTree);
    const confidence: Evidence['confidence'] = independentAgreement && (spectralPersistence || strongCurrentCrown || persistentLinearVegetation)
      ? 'high'
      : classifiedTree || (spectralPersistence && strongCurrentCrown) || persistentLinearVegetation
        ? 'medium'
        : 'low';
    candidates.set(index, {
      coordinate,
      currentNdvi,
      medianNdvi,
      persistentGreenFraction,
      annualTreeVotes,
      worldCoverTree,
      copernicusWoody,
      confidence,
      signals,
    });
  }

  const patches = vegetationPatches(candidates, latest);
  const fieldAreaM2 = sitePolygons(site).reduce((sum, polygon) => sum + polygonAreaApproxM2(polygon), 0)
    - site.holes.reduce((sum, polygon) => sum + polygonAreaApproxM2(polygon), 0);
  const detectedAreaM2 = patches.reduce((sum, patch) => sum + patch.detectedAreaM2, 0);
  const protectedAreaM2 = patches.reduce((sum, patch) => sum + patch.protectedAreaM2, 0);
  const detectedCoverPercent = round(Math.min(100, detectedAreaM2 / fieldAreaM2 * 100), 1);
  const protectedCoverPercent = round(Math.min(100, protectedAreaM2 / fieldAreaM2 * 100), 1);
  const sourceCount = landCover.annual.length + (landCover.worldCover ? 1 : 0) + (landCover.woodyVegetation ? 1 : 0);
  const status: ExistingVegetationProfile['status'] = opticalScenes.length >= 3 && sourceCount >= 2
    ? 'available'
    : opticalScenes.length > 0 && sourceCount > 0
      ? 'partial'
      : 'unavailable';
  const suitability: ExistingVegetationProfile['suitability'] = detectedCoverPercent > MAXIMUM_ACCEPTED_WOODY_COVER_PERCENT
    ? 'reject'
    : status !== 'available' || detectedCoverPercent > 15
      ? 'review-required'
      : 'clear-with-exclusions';
  const conclusion = suitability === 'reject'
    ? `Reject this parcel for a blank-slate layout: ${detectedCoverPercent}% is classified as existing woody vegetation.`
    : patches.length
      ? `${patches.length} existing woody ${patches.length === 1 ? 'patch' : 'patches'} detected and protected before layout generation.`
      : 'No existing woody patch met the multi-source detection threshold; field verification remains mandatory.';

  return {
    status,
    suitability,
    analyzedOpticalScenes: opticalScenes.length,
    annualLandCoverYears: landCover.annual.map((item) => item.year).sort(),
    woodyVegetationLayerAvailable: Boolean(landCover.woodyVegetation),
    detectedCoverPercent,
    protectedCoverPercent,
    maximumAcceptedCoverPercent: MAXIMUM_ACCEPTED_WOODY_COVER_PERCENT,
    patches,
    evidence: existingVegetationEvidence(observedAt),
    conclusion,
  };
}

async function loadIndependentLandCover(
  site: SiteBoundary,
  reference: OpticalRasterResult,
  fetchImpl: typeof fetch,
  stacUrl: string,
  dataUrl: string,
) {
  const [annualItems, worldItems, woodyVegetation] = await Promise.all([
    searchItems(fetchImpl, stacUrl, {
      collections: [ANNUAL_LAND_COVER_COLLECTION],
      intersects: boundaryGeoJsonGeometry(site),
      limit: 20,
    }),
    searchItems(fetchImpl, stacUrl, {
      collections: [WORLD_COVER_COLLECTION],
      intersects: boundaryGeoJsonGeometry(site),
      limit: 10,
    }),
    loadCopernicusWoodyVegetation(reference, fetchImpl).catch(() => null),
  ]);
  const annualCandidates = ANNUAL_LAND_COVER_YEARS.flatMap((year) => {
    const item = annualItems.find((candidate) => candidate.id.endsWith(`-${year}`));
    return item ? [{ year, item }] : [];
  });
  const annual = (await Promise.all(annualCandidates.map(async ({ year, item }) => {
    try {
      return await loadLandCoverRaster(item, year, ANNUAL_LAND_COVER_COLLECTION, 'data_b1', reference, fetchImpl, dataUrl);
    } catch {
      return null;
    }
  }))).filter((item): item is LandCoverRasterResult => item !== null);
  const worldItem = worldItems.find((item) => item.id.includes('2021_v200')) ?? worldItems[0];
  let worldCover: LandCoverRasterResult | null = null;
  if (worldItem) {
    try {
      worldCover = await loadLandCoverRaster(worldItem, 2021, WORLD_COVER_COLLECTION, 'map_b1', reference, fetchImpl, dataUrl);
    } catch {
      worldCover = null;
    }
  }
  return { annual, worldCover, woodyVegetation };
}

async function loadCopernicusWoodyVegetation(
  reference: OpticalRasterResult,
  fetchImpl: typeof fetch,
): Promise<LandCoverRasterResult> {
  const url = new URL(process.env.COPERNICUS_WVL_WMS_URL ?? DEFAULT_COPERNICUS_WVL_WMS_URL);
  url.search = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'HRL_WoodyVegetationLayer_2021',
    styles: '',
    crs: 'CRS:84',
    bbox: reference.bounds.map((value) => value.toFixed(7)).join(','),
    width: String(reference.width),
    height: String(reference.height),
    format: 'image/tiff',
    transparent: 'true',
  }).toString();
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { Accept: 'image/tiff' } }, 35_000);
  if (!response.ok) throw new Error(`Copernicus woody-vegetation WMS returned ${response.status}`);
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const classes = Array.from(rasters[0] as ArrayLike<number>, Number);
  if (classes.length !== reference.width * reference.height) throw new Error('Copernicus woody-vegetation raster dimensions do not match the analysis grid');
  return {
    year: 2021,
    classes,
    mask: classes.map((value) => value === 255 ? 0 : 1),
    bounds: reference.bounds,
    width: reference.width,
    height: reference.height,
  };
}

async function loadLandCoverRaster(
  item: StacItem,
  year: number,
  collection: string,
  expression: string,
  reference: OpticalRasterResult,
  fetchImpl: typeof fetch,
  dataUrl: string,
): Promise<LandCoverRasterResult> {
  const raster = await fetchExpressionRaster(
    fetchImpl,
    dataUrl,
    collection,
    item.id,
    reference.bounds,
    { width: reference.width, height: reference.height },
    [expression],
  );
  if (raster.bands.length < 2) throw new Error(`${collection} raster is missing class or mask band`);
  return {
    year,
    classes: Array.from(raster.bands[0], Number),
    mask: Array.from(raster.bands[1], Number),
    bounds: reference.bounds,
    width: reference.width,
    height: reference.height,
  };
}

function vegetationPatches(
  candidates: Map<number, {
    coordinate: Coordinate;
    currentNdvi: number;
    medianNdvi: number;
    persistentGreenFraction: number;
    annualTreeVotes: number;
    worldCoverTree: boolean;
    copernicusWoody: boolean;
    confidence: Evidence['confidence'];
    signals: string[];
  }>,
  raster: OpticalRasterResult,
): ExistingVegetationPatch[] {
  if (!candidates.size) return [];
  const remaining = new Set(candidates.keys());
  const components: number[][] = [];
  while (remaining.size) {
    const start = remaining.values().next().value as number;
    remaining.delete(start);
    const queue = [start];
    const component: number[] = [];
    while (queue.length) {
      const current = queue.pop()!;
      component.push(current);
      const x = current % raster.width;
      const y = Math.floor(current / raster.width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= raster.width || ny >= raster.height) continue;
          const neighbour = ny * raster.width + nx;
          if (remaining.delete(neighbour)) queue.push(neighbour);
        }
      }
    }
    components.push(component);
  }

  const meanLat = average(Array.from(candidates.values()).map((item) => item.coordinate.lat));
  const cellWidthM = (raster.bounds[2] - raster.bounds[0]) * 111_320 * Math.cos(meanLat * Math.PI / 180) / raster.width;
  const cellHeightM = (raster.bounds[3] - raster.bounds[1]) * 111_320 / raster.height;
  const cellAreaM2 = cellWidthM * cellHeightM;
  const projection = createLocalProjection(polygonCentroid(Array.from(candidates.values()).map((item) => item.coordinate)));

  return components.map((component, componentIndex) => {
    const samples = component.map((index) => candidates.get(index)!);
    const local = samples.map((sample) => projection.project(sample.coordinate));
    const minX = Math.min(...local.map((point) => point.x)) - cellWidthM / 2 - 2.5;
    const maxX = Math.max(...local.map((point) => point.x)) + cellWidthM / 2 + 2.5;
    const minY = Math.min(...local.map((point) => point.y)) - cellHeightM / 2 - 2.5;
    const maxY = Math.max(...local.map((point) => point.y)) + cellHeightM / 2 + 2.5;
    const polygon = [
      projection.unproject({ x: minX, y: minY }),
      projection.unproject({ x: maxX, y: minY }),
      projection.unproject({ x: maxX, y: maxY }),
      projection.unproject({ x: minX, y: maxY }),
    ];
    const confidence = samples.some((sample) => sample.confidence === 'high')
      ? 'high' as const
      : samples.some((sample) => sample.confidence === 'medium')
        ? 'medium' as const
        : 'low' as const;
    return {
      id: `existing-woody-${componentIndex + 1}`,
      centroid: projection.unproject({
        x: average(local.map((point) => point.x)),
        y: average(local.map((point) => point.y)),
      }),
      polygon,
      detectedAreaM2: round(component.length * cellAreaM2, 1),
      protectedAreaM2: round((maxX - minX) * (maxY - minY), 1),
      pixelCount: component.length,
      currentNdvi: round(average(samples.map((sample) => sample.currentNdvi)), 3),
      medianNdvi: round(average(samples.map((sample) => sample.medianNdvi)), 3),
      persistentGreenFraction: round(average(samples.map((sample) => sample.persistentGreenFraction)), 2),
      annualTreeVotes: round(average(samples.map((sample) => sample.annualTreeVotes)), 2),
      worldCoverTree: samples.some((sample) => sample.worldCoverTree),
      copernicusWoody: samples.some((sample) => sample.copernicusWoody),
      confidence,
      signals: Array.from(new Set(samples.flatMap((sample) => sample.signals))),
    };
  }).sort((a, b) => b.protectedAreaM2 - a.protectedAreaM2);
}

function polygonAreaApproxM2(polygon: Coordinate[]) {
  if (polygon.length < 3) return 1;
  const projection = createLocalProjection(polygonCentroid(polygon));
  const points = polygon.map(projection.project);
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.max(1, Math.abs(twiceArea) / 2);
}

function normalize(value: number, minimum: number, maximum: number) {
  return clamp((value - minimum) / (maximum - minimum), 0, 1);
}

async function fetchRadar(
  site: SiteBoundary,
  now: Date,
  fetchImpl: typeof fetch,
  stacUrl: string,
  dataUrl: string,
) {
  const items = await searchItems(fetchImpl, stacUrl, {
    collections: [RADAR_COLLECTION],
    intersects: boundaryGeoJsonGeometry(site),
    datetime: dateRange(now, 180),
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: 40,
  });
  const candidates = items.filter((item) => item.assets?.vv && item.assets?.vh);
  const latest = candidates[0];
  if (!latest) throw new Error('No Sentinel-1 VV/VH scene intersects the site');
  const relativeOrbit = numberOrNull(latest.properties['sat:relative_orbit']);
  const orbitState = radarOrbit(latest.properties['sat:orbit_state']);
  const comparable = candidates.filter((item) => (
    numberOrNull(item.properties['sat:relative_orbit']) === relativeOrbit &&
    radarOrbit(item.properties['sat:orbit_state']) === orbitState
  )).slice(0, 6);
  const observations = (await Promise.all(comparable.map(async (item) => {
    try {
      return await loadRadarRaster(site, item, fetchImpl, dataUrl);
    } catch {
      return null;
    }
  })))
    .filter((item): item is SatelliteRadarObservation => item !== null)
    .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
  if (!observations.length) throw new Error('Sentinel-1 raster processing failed');
  const baseline = observations.slice(1).map((item) => item.vvMeanDb);
  const latestDb = observations[0].vvMeanDb;
  const anomalyDb = baseline.length >= 2 ? round(latestDb - median(baseline), 2) : null;
  const percentile = observations.length >= 3
    ? round(observations.filter((item) => item.vvMeanDb <= latestDb).length / observations.length * 100, 0)
    : null;
  const threshold = Math.max(0.75, standardDeviation(baseline) * 0.5);
  const signal = anomalyDb === null
    ? 'unavailable' as const
    : anomalyDb > threshold
      ? 'wetter-than-recent-baseline' as const
      : anomalyDb < -threshold
        ? 'drier-than-recent-baseline' as const
        : 'near-recent-baseline' as const;
  return { observations, baselineCount: baseline.length, anomalyDb, percentile, signal };
}

async function loadRadarRaster(
  site: SiteBoundary,
  item: StacItem,
  fetchImpl: typeof fetch,
  dataUrl: string,
): Promise<SatelliteRadarObservation> {
  const coordinates = sitePolygons(site).flat();
  const rasterBounds = paddedBounds(coordinates, 0.04);
  const size = rasterDimensions(rasterBounds, coordinates);
  const raster = await fetchExpressionRaster(fetchImpl, dataUrl, RADAR_COLLECTION, item.id, rasterBounds, size, RADAR_EXPRESSIONS);
  if (raster.bands.length < 3) throw new Error('Sentinel-1 raster is missing VV, VH or mask bands');
  const [vvBand, vhBand, maskBand] = raster.bands;
  const vv: number[] = [];
  const vh: number[] = [];
  for (let index = 0; index < raster.width * raster.height; index += 1) {
    const coordinate = pixelCoordinate(index, raster.width, raster.height, rasterBounds);
    if (!siteContainsCoordinate(site, coordinate) || Number(maskBand[index]) <= 0) continue;
    const vvValue = Number(vvBand[index]);
    const vhValue = Number(vhBand[index]);
    if (vvValue > 0 && vhValue > 0 && Number.isFinite(vvValue) && Number.isFinite(vhValue)) {
      vv.push(vvValue);
      vh.push(vhValue);
    }
  }
  if (vv.length < 3) throw new Error('Sentinel-1 has too few valid pixels over the site');
  const vvMean = average(vv);
  const vhMean = average(vh);
  return {
    sceneId: item.id,
    acquiredAt: requiredDate(item),
    platform: item.properties.platform ?? item.id.slice(0, 3),
    orbitState: radarOrbit(item.properties['sat:orbit_state']),
    relativeOrbit: numberOrNull(item.properties['sat:relative_orbit']),
    vvMeanLinear: round(vvMean, 5),
    vhMeanLinear: round(vhMean, 5),
    vvMeanDb: round(toDb(vvMean), 2),
    vhMeanDb: round(toDb(vhMean), 2),
    vhVvRatio: round(vhMean / vvMean, 3),
    validPixels: vv.length,
  };
}

async function fetchExpressionRaster(
  fetchImpl: typeof fetch,
  dataUrl: string,
  collection: string,
  itemId: string,
  rasterBounds: RasterBounds,
  size: { width: number; height: number },
  expressions: string[],
) {
  const boundsPath = rasterBounds.map((value) => value.toFixed(7)).join(',');
  const url = new URL(`${dataUrl}/item/bbox/${boundsPath}/${size.width}x${size.height}.tif`);
  url.searchParams.set('collection', collection);
  url.searchParams.set('item', itemId);
  url.searchParams.set('expression', expressions.join(';'));
  url.searchParams.set('resampling', 'nearest');
  url.searchParams.set('return_mask', 'true');
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { Accept: 'image/tiff' } }, 35_000);
  if (!response.ok) throw new Error(`Satellite raster API returned ${response.status}`);
  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bands: Array.from(rasters as ArrayLike<ArrayLike<number>>),
  };
}

async function searchItems(fetchImpl: typeof fetch, stacUrl: string, body: Record<string, unknown>): Promise<StacItem[]> {
  const response = await fetchWithTimeout(fetchImpl, `${stacUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify(body),
  }, 30_000);
  if (!response.ok) throw new Error(`Satellite STAC search returned ${response.status}`);
  const payload = await response.json() as { features?: StacItem[] };
  return payload.features ?? [];
}

function classifyWaterSamples(pixels: OpticalRasterResult['pixels']): SatelliteWaterSample[] {
  if (!pixels.length) return [];
  const ndmiValues = pixels.map((pixel) => pixel.ndmi);
  const dryThreshold = quantile(ndmiValues, 0.33);
  const wetThreshold = quantile(ndmiValues, 0.67);
  const maxSamples = 48;
  const stride = Math.max(1, Math.ceil(pixels.length / maxSamples));
  return pixels.filter((_, index) => index % stride === 0).slice(0, maxSamples).map((pixel) => ({
    coordinate: pixel.coordinate,
    ndmi: round(pixel.ndmi, 3),
    ndvi: round(pixel.ndvi, 3),
    irrigationPriority: pixel.ndmi <= dryThreshold ? 'high' : pixel.ndmi >= wetThreshold ? 'low' : 'medium',
  }));
}

function irrigationScheduling(
  optical: SatelliteOpticalObservation | null,
  radar: SatelliteRadarObservation[],
): SatelliteProfile['irrigationScheduling'] {
  const latestRadar = radar[0] ?? null;
  const baseline = radar.slice(1).map((item) => item.vvMeanDb);
  let adjustmentPercent = 0;
  if (latestRadar && baseline.length >= 2) {
    const anomalyDb = latestRadar.vvMeanDb - median(baseline);
    const thresholdDb = Math.max(0.75, standardDeviation(baseline) * 0.5);
    if (anomalyDb < -thresholdDb) adjustmentPercent += 8;
    else if (anomalyDb > thresholdDb) adjustmentPercent -= 8;
  }
  if (optical) {
    if (optical.ndmi.median < 0.05) adjustmentPercent += 4;
    else if (optical.ndmi.median > 0.3) adjustmentPercent -= 4;
  }
  adjustmentPercent = clamp(adjustmentPercent, -12, 12);
  const recommendation = adjustmentPercent > 0
    ? `Increase the next irrigation pulse by ${adjustmentPercent}% in high-priority zones, then verify with a field probe.`
    : adjustmentPercent < 0
      ? `Reduce or defer the next irrigation pulse by ${Math.abs(adjustmentPercent)}%, subject to a field probe check.`
      : 'Keep the climate-based irrigation pulse and inspect high-priority NDMI zones before changing runtime.';
  const confidence: Evidence['confidence'] = optical && latestRadar && baseline.length >= 3 && optical.fieldCloudPercent <= 10 ? 'medium' : 'low';
  return { adjustmentPercent, recommendation, confidence, annualVolumeAdjusted: false };
}

function summarizeIndex(values: number[]): SatelliteIndexSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: round(average(sorted), 3),
    median: round(quantile(sorted, 0.5), 3),
    standardDeviation: round(standardDeviation(sorted), 3),
    percentile02: round(quantile(sorted, 0.02), 3),
    percentile98: round(quantile(sorted, 0.98), 3),
    validPixels: sorted.length,
  };
}

function previewUrl(dataUrl: string, rasterBounds: RasterBounds, itemId: string, kind: 'ndmi' | 'true-color') {
  const expanded = expandBounds(rasterBounds, 0.3);
  const boundsPath = expanded.map((value) => value.toFixed(7)).join(',');
  const url = new URL(`${dataUrl}/item/bbox/${boundsPath}/720x520.png`);
  url.searchParams.set('collection', OPTICAL_COLLECTION);
  url.searchParams.set('item', itemId);
  if (kind === 'ndmi') {
    url.searchParams.set('expression', OPTICAL_EXPRESSIONS[1]);
    url.searchParams.set('rescale', '-0.2,0.5');
    url.searchParams.set('colormap_name', 'brbg');
  } else {
    url.searchParams.append('assets', 'visual');
    url.searchParams.append('bidx', '1');
    url.searchParams.append('bidx', '2');
    url.searchParams.append('bidx', '3');
  }
  return url.toString();
}

function satelliteEvidence(observedAt: string, stacUrl: string, dataUrl: string): Evidence[] {
  return [
    {
      source: 'Copernicus Sentinel-2 Level-2A via Microsoft Planetary Computer',
      sourceUrl: `${stacUrl}/collections/${OPTICAL_COLLECTION}`,
      version: 'Level-2A surface reflectance',
      observedAt,
      confidence: 'medium',
      resolution: '10–20 m native bands; nearest-neighbour SCL mask',
    },
    {
      source: 'Copernicus Sentinel-1 Radiometrically Terrain Corrected via Microsoft Planetary Computer',
      sourceUrl: `${stacUrl}/collections/${RADAR_COLLECTION}`,
      version: 'RTC gamma-naught VV/VH',
      observedAt,
      confidence: 'medium',
      resolution: '10 m pixel spacing; same relative orbit comparison',
    },
    {
      source: 'Microsoft Planetary Computer Data API',
      sourceUrl: dataUrl,
      version: 'public TiTiler raster processing API',
      observedAt,
      confidence: 'high',
      resolution: 'field-clipped GeoTIFF statistics',
    },
  ];
}

function existingVegetationEvidence(observedAt: string): Evidence[] {
  return [
    {
      source: 'Sentinel-2 multi-date NDVI persistence',
      sourceUrl: `${DEFAULT_STAC_URL}/collections/${OPTICAL_COLLECTION}`,
      version: 'Field-clipped surface-reflectance time series',
      observedAt,
      confidence: 'medium',
      resolution: '10 m native NIR/red bands',
    },
    {
      source: 'Impact Observatory annual land-use/land-cover V2',
      sourceUrl: `${DEFAULT_STAC_URL}/collections/${ANNUAL_LAND_COVER_COLLECTION}`,
      version: '2021–2023 tree-class consensus',
      observedAt,
      confidence: 'medium',
      resolution: '10 m annual Sentinel-2 composites',
    },
    {
      source: 'ESA WorldCover 2021',
      sourceUrl: `${DEFAULT_STAC_URL}/collections/${WORLD_COVER_COLLECTION}`,
      version: 'v200 tree-cover class',
      observedAt,
      confidence: 'medium',
      resolution: '10 m Sentinel-1/Sentinel-2 classification',
    },
    {
      source: 'Copernicus HRL Woody Vegetation Layer 2021',
      sourceUrl: 'https://land.copernicus.eu/en/products/high-resolution-layer-small-landscape-features/woody-vegetation-layer-2021',
      version: 'WVL 2021 raster',
      observedAt,
      confidence: 'high',
      resolution: '5 m woody vegetation, including isolated trees and permanent crops',
    },
  ];
}

function polygonGeometry(polygon: Coordinate[]) {
  const ring = [...polygon.map((point) => [point.lng, point.lat]), [polygon[0].lng, polygon[0].lat]];
  return { type: 'Polygon', coordinates: [ring] };
}

function paddedBounds(polygon: Coordinate[], paddingRatio: number): RasterBounds {
  const lng = polygon.map((point) => point.lng);
  const lat = polygon.map((point) => point.lat);
  return expandBounds([Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)], paddingRatio);
}

function expandBounds(bounds: RasterBounds, ratio: number): RasterBounds {
  const width = Math.max(0.0001, bounds[2] - bounds[0]);
  const height = Math.max(0.0001, bounds[3] - bounds[1]);
  return [bounds[0] - width * ratio, bounds[1] - height * ratio, bounds[2] + width * ratio, bounds[3] + height * ratio];
}

function rasterDimensions(bounds: RasterBounds, polygon: Coordinate[]) {
  const meanLat = average(polygon.map((point) => point.lat));
  const widthM = (bounds[2] - bounds[0]) * 111_320 * Math.cos(meanLat * Math.PI / 180);
  const heightM = (bounds[3] - bounds[1]) * 111_320;
  return { width: clamp(Math.ceil(widthM / 5), 24, 96), height: clamp(Math.ceil(heightM / 5), 24, 96) };
}

function pixelCoordinate(index: number, width: number, height: number, bounds: RasterBounds): Coordinate {
  const x = index % width;
  const y = Math.floor(index / width);
  return {
    lng: bounds[0] + (x + 0.5) / width * (bounds[2] - bounds[0]),
    lat: bounds[3] - (y + 0.5) / height * (bounds[3] - bounds[1]),
  };
}

function dateRange(now: Date, days: number) {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return `${start.toISOString()}/${now.toISOString()}`;
}

function requiredDate(item: StacItem) {
  if (!item.properties.datetime) throw new Error(`STAC item ${item.id} is missing a datetime`);
  return item.properties.datetime;
}

function radarOrbit(value: unknown): SatelliteRadarObservation['orbitState'] {
  return value === 'ascending' || value === 'descending' ? value : 'unknown';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string | URL, init: RequestInit, timeoutMs: number) {
  return fetchImpl(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

function quantile(values: number[], probability: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values: number[]) { return quantile(values, 0.5); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
function toDb(value: number) { return 10 * Math.log10(value); }
function round(value: number, digits: number) { return Number(value.toFixed(digits)); }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function trimSlash(value: string) { return value.replace(/\/$/, ''); }
