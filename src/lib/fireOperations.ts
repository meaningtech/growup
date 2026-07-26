import type { FireMaintenanceTask, FireOperationsPlan, SiteBoundary } from '../types';

export const EFFIS_FWI_SOURCE_URL = 'https://forest-fire.emergency.copernicus.eu/apps/effis.csv/';
export const EFFIS_WMTS_URL = 'https://maps.effis.emergency.copernicus.eu/effist/wmts/1.0.0';
export const EFFIS_FWI_LAYER = 'ecmwf.fwi';
const EFFIS_TILE_MATRIX = 'ECMWF3857';
const EFFIS_MAX_ZOOM = 6;

const TASK_IDS: FireMaintenanceTask['id'][] = [
  'surface-fuels',
  'vehicle-access',
  'pipe-crossings',
  'cut-biomass',
  'authority-review',
];

export function defaultFireOperationsPlan(now = new Date().toISOString()): FireOperationsPlan {
  return {
    reviewedAt: null,
    nextInspectionAt: null,
    notes: '',
    tasks: TASK_IDS.map((id) => ({ id, status: 'due', dueAt: null, completedAt: null, notes: '' })),
    sourceSnapshot: {
      provider: 'EFFIS',
      layer: EFFIS_FWI_LAYER,
      forecastDate: now.slice(0, 10),
      sourceUrl: EFFIS_FWI_SOURCE_URL,
      resolutionKm: 8,
      observedAt: now,
    },
  };
}

export function normalizeFireOperationsPlan(value: Partial<FireOperationsPlan> | null | undefined, now = new Date().toISOString()): FireOperationsPlan {
  const fallback = defaultFireOperationsPlan(now);
  const byId = new Map((Array.isArray(value?.tasks) ? value.tasks : []).map((task) => [task.id, task]));
  return {
    reviewedAt: validDate(value?.reviewedAt) ? value?.reviewedAt ?? null : null,
    nextInspectionAt: validDate(value?.nextInspectionAt) ? value?.nextInspectionAt ?? null : null,
    notes: boundedText(value?.notes, 2_000),
    tasks: fallback.tasks.map((task) => {
      const candidate = byId.get(task.id);
      const status = ['due', 'scheduled', 'complete', 'not-applicable'].includes(candidate?.status ?? '')
        ? candidate?.status ?? task.status
        : task.status;
      return {
        id: task.id,
        status,
        dueAt: validDate(candidate?.dueAt) ? candidate?.dueAt ?? null : null,
        completedAt: status === 'complete' && validDate(candidate?.completedAt) ? candidate?.completedAt ?? null : null,
        notes: boundedText(candidate?.notes, 500),
      };
    }),
    sourceSnapshot: {
      ...fallback.sourceSnapshot,
      forecastDate: /^\d{4}-\d{2}-\d{2}$/.test(value?.sourceSnapshot?.forecastDate ?? '')
        ? value?.sourceSnapshot?.forecastDate ?? fallback.sourceSnapshot.forecastDate
        : fallback.sourceSnapshot.forecastDate,
      observedAt: validDate(value?.sourceSnapshot?.observedAt)
        ? value?.sourceSnapshot?.observedAt ?? fallback.sourceSnapshot.observedAt
        : fallback.sourceSnapshot.observedAt,
    },
  };
}

export function effisFireWeatherTile(site: SiteBoundary, forecastDate: string) {
  const coordinates = [site.polygon, ...site.additionalPolygons].flat();
  const center = {
    lat: coordinates.reduce((sum, coordinate) => sum + coordinate.lat, 0) / coordinates.length,
    lng: coordinates.reduce((sum, coordinate) => sum + coordinate.lng, 0) / coordinates.length,
  };
  const tileCount = 2 ** EFFIS_MAX_ZOOM;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, center.lat));
  const latitudeRadians = latitude * Math.PI / 180;
  const x = Math.max(0, Math.min(tileCount - 1, Math.floor((center.lng + 180) / 360 * tileCount)));
  const y = Math.max(0, Math.min(tileCount - 1, Math.floor(
    (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * tileCount,
  )));
  const latitudeAtRow = (row: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / tileCount))) * 180 / Math.PI;
  return {
    url: `${EFFIS_WMTS_URL}/${EFFIS_FWI_LAYER}/default/${encodeURIComponent(forecastDate)}/${EFFIS_TILE_MATRIX}/${EFFIS_MAX_ZOOM}/${y}/${x}.png`,
    bounds: {
      north: latitudeAtRow(y),
      south: latitudeAtRow(y + 1),
      east: (x + 1) / tileCount * 360 - 180,
      west: x / tileCount * 360 - 180,
    },
  };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}
