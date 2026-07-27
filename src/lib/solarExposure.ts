import type { Coordinate, DesignSpecies, Evidence, LayoutVariant, SiteProfile, TreeInstance } from '../types';
import { createLocalProjection, pointInPolygon, type PointM } from './geometry';
import { growthState } from './growth';
import { solarPositionNoaa } from './solar';

export type PlantSolarExposure = {
  treeId: string;
  speciesId: string;
  status: 'sunlit' | 'shaded' | 'night';
  exposurePercent: number;
  shadowLengthM: number;
  shadowPolygon: Coordinate[];
  shadedByTreeIds: string[];
};

export type SolarExposureHour = {
  localSolarHour: number;
  utcHour: number;
  elevationDegrees: number;
  azimuthDegrees: number;
  directNormalWm2: number;
  diffuseWm2: number;
  estimatedHorizontalWm2: number;
  activePlantCount: number;
  sunlitCount: number;
  shadedCount: number;
  sunlitPercent: number;
  plants: PlantSolarExposure[];
};

export type DailyPlantSolarExposure = {
  status: 'available' | 'unavailable';
  month: number;
  growthYear: number;
  hours: SolarExposureHour[];
  source: string;
  sourcePeriod: string;
  sourceVersion: string;
  observedAt: string;
  confidence: Evidence['confidence'];
  method: string;
  limitations: string[];
};

type ShadowCaster = {
  tree: TreeInstance;
  polygon: PointM[];
  geographicPolygon: Coordinate[];
  shadowLengthM: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

const HOURS = Array.from({ length: 16 }, (_, index) => index + 5);
const SHADOW_GRID_CELL_M = 24;
const MAX_SHADOW_LENGTH_M = 120;

export function simulateDailyPlantExposure(
  profile: SiteProfile,
  variant: LayoutVariant,
  species: DesignSpecies[],
  month: number,
  growthYear: number,
): DailyPlantSolarExposure {
  const normalizedMonth = clamp(Math.round(month), 1, 12);
  const base = {
    month: normalizedMonth,
    growthYear,
    source: profile.solar?.evidence?.source ?? 'Open-Meteo historical weather API',
    sourcePeriod: profile.solar?.period ?? 'unknown',
    sourceVersion: profile.solar?.evidence?.version ?? 'unknown',
    observedAt: profile.solar?.evidence?.observedAt ?? profile.generatedAt,
    confidence: profile.solar?.evidence?.confidence ?? 'low',
    method: 'Representative mid-month NOAA solar geometry with Open-Meteo UTC hourly radiation climatology and species growth-model crown shadows',
    limitations: [
      'Local horizon, buildings and vegetation outside the mapped project are not included.',
      'Crown density, pruning and spectral crop PAR require field calibration.',
      'Hours are approximate local solar time rather than civil clock time.',
    ],
  } satisfies Omit<DailyPlantSolarExposure, 'status' | 'hours'>;

  if (profile.solar?.status !== 'available' || !profile.solar.hourlyClimatology.length) {
    return { ...base, status: 'unavailable', hours: [] };
  }

  const speciesById = new Map(species.map((item) => [item.id, item]));
  const activePlants = variant.trees.flatMap((tree) => {
    const item = speciesById.get(tree.speciesId);
    if (!item) return [];
    const growth = growthState(item, tree, growthYear);
    return growth.active ? [{ tree, growth }] : [];
  });
  const projection = createLocalProjection(profile.centroid);

  const hours = HOURS.map((localSolarHour) => {
    const date = representativeDate(profile.centroid.lng, normalizedMonth, localSolarHour);
    const sun = solarPositionNoaa(date, profile.centroid.lat, profile.centroid.lng);
    const climate = nearestClimateBin(profile, normalizedMonth, date.getUTCHours());
    const elevationRadians = toRadians(Math.max(0, sun.elevationDegrees));
    const directHorizontalWm2 = climate.directNormalWm2 * Math.sin(elevationRadians);
    const estimatedHorizontalWm2 = Math.max(0, directHorizontalWm2 + climate.diffuseWm2);
    const daylight = sun.elevationDegrees > 0 && estimatedHorizontalWm2 >= 5;

    if (!daylight) {
      return {
        localSolarHour,
        utcHour: date.getUTCHours(),
        elevationDegrees: round(sun.elevationDegrees, 1),
        azimuthDegrees: round(sun.azimuthDegrees, 1),
        directNormalWm2: round(climate.directNormalWm2, 0),
        diffuseWm2: round(climate.diffuseWm2, 0),
        estimatedHorizontalWm2: round(estimatedHorizontalWm2, 0),
        activePlantCount: activePlants.length,
        sunlitCount: 0,
        shadedCount: 0,
        sunlitPercent: 0,
        plants: activePlants.map(({ tree }) => ({
          treeId: tree.id,
          speciesId: tree.speciesId,
          status: 'night' as const,
          exposurePercent: 0,
          shadowLengthM: 0,
          shadowPolygon: [],
          shadedByTreeIds: [],
        })),
      };
    }

    const shadowAzimuthRadians = toRadians((sun.azimuthDegrees + 180) % 360);
    const direction = { x: Math.sin(shadowAzimuthRadians), y: Math.cos(shadowAzimuthRadians) };
    const casters = activePlants.map(({ tree, growth }) => createShadowCaster(
      tree,
      projection.project(tree.coordinate),
      growth.heightM,
      growth.crownDiameterM,
      elevationRadians,
      direction,
      projection.unproject,
    ));
    const casterByTreeId = new Map(casters.map((caster) => [caster.tree.id, caster]));
    const shadowGrid = indexShadowCasters(casters);
    const diffuseShare = clamp(climate.diffuseWm2 / Math.max(1, estimatedHorizontalWm2), 0, 1);

    const plants = activePlants.map(({ tree }) => {
      const point = projection.project(tree.coordinate);
      const shadedBy = candidateShadowIndexes(point, shadowGrid)
        .filter((index) => casters[index].tree.id !== tree.id && pointInPolygon(point, casters[index].polygon))
        .map((index) => casters[index].tree.id);
      const ownShadow = casterByTreeId.get(tree.id);
      return {
        treeId: tree.id,
        speciesId: tree.speciesId,
        status: shadedBy.length ? 'shaded' as const : 'sunlit' as const,
        exposurePercent: shadedBy.length ? round(diffuseShare * 100, 1) : 100,
        shadowLengthM: ownShadow?.shadowLengthM ?? 0,
        shadowPolygon: ownShadow?.geographicPolygon ?? [],
        shadedByTreeIds: shadedBy,
      };
    });
    const shadedCount = plants.filter((plant) => plant.status === 'shaded').length;
    const sunlitCount = plants.length - shadedCount;

    return {
      localSolarHour,
      utcHour: date.getUTCHours(),
      elevationDegrees: round(sun.elevationDegrees, 1),
      azimuthDegrees: round(sun.azimuthDegrees, 1),
      directNormalWm2: round(climate.directNormalWm2, 0),
      diffuseWm2: round(climate.diffuseWm2, 0),
      estimatedHorizontalWm2: round(estimatedHorizontalWm2, 0),
      activePlantCount: plants.length,
      sunlitCount,
      shadedCount,
      sunlitPercent: plants.length ? round(sunlitCount / plants.length * 100, 1) : 0,
      plants,
    };
  });

  return { ...base, status: 'available', hours };
}

function createShadowCaster(
  tree: TreeInstance,
  center: PointM,
  heightM: number,
  crownDiameterM: number,
  elevationRadians: number,
  direction: PointM,
  unproject: (point: PointM) => Coordinate,
): ShadowCaster {
  const halfWidth = Math.max(0.3, crownDiameterM / 2);
  const geometricLength = heightM / Math.max(0.08, Math.tan(elevationRadians)) + halfWidth;
  const shadowLengthM = clamp(geometricLength, halfWidth, MAX_SHADOW_LENGTH_M);
  const perpendicular = { x: -direction.y, y: direction.x };
  const front = {
    x: center.x - direction.x * halfWidth * 0.35,
    y: center.y - direction.y * halfWidth * 0.35,
  };
  const end = {
    x: center.x + direction.x * shadowLengthM,
    y: center.y + direction.y * shadowLengthM,
  };
  const polygon = [
    offset(front, perpendicular, halfWidth),
    offset(end, perpendicular, halfWidth * 0.72),
    offset(end, perpendicular, -halfWidth * 0.72),
    offset(front, perpendicular, -halfWidth),
  ];
  return {
    tree,
    polygon,
    geographicPolygon: polygon.map(unproject),
    shadowLengthM: round(shadowLengthM, 1),
    bounds: polygon.reduce((result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }),
  };
}

function indexShadowCasters(casters: ShadowCaster[]) {
  const grid = new Map<string, number[]>();
  casters.forEach((caster, index) => {
    for (let x = cell(caster.bounds.minX); x <= cell(caster.bounds.maxX); x += 1) {
      for (let y = cell(caster.bounds.minY); y <= cell(caster.bounds.maxY); y += 1) {
        const key = `${x}:${y}`;
        grid.set(key, [...(grid.get(key) ?? []), index]);
      }
    }
  });
  return grid;
}

function candidateShadowIndexes(point: PointM, grid: Map<string, number[]>) {
  return grid.get(`${cell(point.x)}:${cell(point.y)}`) ?? [];
}

function nearestClimateBin(profile: SiteProfile, month: number, utcHour: number) {
  const bins = profile.solar.hourlyClimatology.filter((bin) => bin.month === month);
  return bins.reduce((nearest, bin) => (
    circularHourDistance(bin.hour, utcHour) < circularHourDistance(nearest.hour, utcHour) ? bin : nearest
  ), bins[0] ?? {
    month,
    hour: utcHour,
    directNormalWm2: 0,
    diffuseWm2: 0,
    shortwaveWm2: 0,
    windSpeedMs: 0,
    windDirectionDegrees: 0,
    sampleCount: 0,
  });
}

function representativeDate(longitudeDegrees: number, month: number, localSolarHour: number) {
  const utcHour = localSolarHour - longitudeDegrees / 15;
  const wholeHour = Math.floor(utcHour);
  return new Date(Date.UTC(2024, month - 1, 15, wholeHour, Math.round((utcHour - wholeHour) * 60)));
}

function circularHourDistance(a: number, b: number) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 24 - difference);
}

function offset(origin: PointM, direction: PointM, distance: number): PointM {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

function cell(value: number) {
  return Math.floor(value / SHADOW_GRID_CELL_M);
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}
