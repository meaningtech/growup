import type { Coordinate, SiteBoundary } from '../types';

export const GIBS_WMTS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const GIBS_WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const GIBS_SOURCE_URL = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api';
export const WORLDVIEW_ORIGIN = 'https://worldview.earthdata.nasa.gov';
export const FIRMS_SOURCE_URL = 'https://firms.modaps.eosdis.nasa.gov/';

export const GIBS_TRUE_COLOR_LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
export const GIBS_TRUE_COLOR_TILE_MATRIX = 'GoogleMapsCompatible_Level9';
export const GIBS_TRUE_COLOR_MAX_ZOOM = 9;
export const GIBS_TRUE_COLOR_RESOLUTION_M = 250;

export const GIBS_FIRE_LAYERS = [
  'VIIRS_SNPP_Thermal_Anomalies_375m_All',
  'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
] as const;
export const GIBS_FIRE_RESOLUTION_M = 375;
export const WORLDVIEW_LABEL_LAYER = 'Reference_Labels_15m';

export type GibsRasterId =
  | 'true-color'
  | 'hls'
  | 'surface-water'
  | 'flood'
  | 'aerosol'
  | 'disturbance'
  | 'precipitation';

export type GibsRasterSpec = {
  id: GibsRasterId;
  layer: string;
  tileMatrix: string;
  maxZoom: number;
  format: 'jpg' | 'png';
  resolutionM: number;
};

export const GIBS_RASTER_LAYERS: Record<GibsRasterId, GibsRasterSpec> = {
  'true-color': {
    id: 'true-color',
    layer: GIBS_TRUE_COLOR_LAYER,
    tileMatrix: GIBS_TRUE_COLOR_TILE_MATRIX,
    maxZoom: GIBS_TRUE_COLOR_MAX_ZOOM,
    format: 'jpg',
    resolutionM: GIBS_TRUE_COLOR_RESOLUTION_M,
  },
  hls: {
    id: 'hls',
    layer: 'HLS_S30_Nadir_BRDF_Adjusted_Reflectance',
    tileMatrix: 'GoogleMapsCompatible_Level12',
    maxZoom: 12,
    format: 'png',
    resolutionM: 30,
  },
  'surface-water': {
    id: 'surface-water',
    layer: 'OPERA_L3_Dynamic_Surface_Water_Extent-HLS',
    tileMatrix: 'GoogleMapsCompatible_Level12',
    maxZoom: 12,
    format: 'png',
    resolutionM: 30,
  },
  flood: {
    id: 'flood',
    layer: 'VIIRS_Combined_Flood_3-Day',
    tileMatrix: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    format: 'png',
    resolutionM: 250,
  },
  aerosol: {
    id: 'aerosol',
    layer: 'OMPS_Aerosol_Index',
    tileMatrix: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    format: 'png',
    resolutionM: 50_000,
  },
  disturbance: {
    id: 'disturbance',
    layer: 'OPERA_L3_DIST-ALERT-HLS_Color_Index',
    tileMatrix: 'GoogleMapsCompatible_Level12',
    maxZoom: 12,
    format: 'png',
    resolutionM: 30,
  },
  precipitation: {
    id: 'precipitation',
    layer: 'IMERG_Precipitation_Rate',
    tileMatrix: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    format: 'png',
    resolutionM: 10_000,
  },
};

export const GIBS_SCIENCE_OVERLAY_IDS: GibsRasterId[] = [
  'hls',
  'surface-water',
  'flood',
  'aerosol',
  'disturbance',
  'precipitation',
];

export function gibsObservationDate(now = new Date()): string {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

export function normalizeGibsDate(value: string | null | undefined, now = new Date()): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : gibsObservationDate(now);
}

export function gibsRasterTileUrl(
  spec: Pick<GibsRasterSpec, 'layer' | 'tileMatrix' | 'maxZoom' | 'format'>,
  coordinate: { x: number; y: number },
  zoom: number,
  date: string,
): string {
  const tiles = 2 ** zoom;
  if (zoom < 0 || zoom > spec.maxZoom || coordinate.y < 0 || coordinate.y >= tiles) return '';
  const x = wrapTileX(coordinate.x, zoom);
  return `${GIBS_WMTS_URL}/${spec.layer}/default/${normalizeGibsDate(date)}/${spec.tileMatrix}/${zoom}/${coordinate.y}/${x}.${spec.format}`;
}

export function gibsTrueColorTileUrl(
  coordinate: { x: number; y: number },
  zoom: number,
  date: string,
): string {
  return gibsRasterTileUrl(GIBS_RASTER_LAYERS['true-color'], coordinate, zoom, date);
}

export function gibsRasterOverlay(spec: Pick<GibsRasterSpec, 'layer'>, site: SiteBoundary, date: string) {
  return gibsWmsOverlay([spec.layer], site, date);
}

export function gibsRasterOverlayAtMapZoom(
  spec: Pick<GibsRasterSpec, 'layer'>,
  site: SiteBoundary,
  date: string,
  mapZoom: number,
) {
  if (!Number.isFinite(mapZoom) || mapZoom < 0) {
    return { url: '', bounds: { north: 0, south: 0, east: 0, west: 0 } };
  }
  return gibsRasterOverlay(spec, site, date);
}

export function gibsFireOverlay(site: SiteBoundary, date: string) {
  return gibsWmsOverlay([...GIBS_FIRE_LAYERS], site, date);
}

export function gibsWmsOverlay(layers: readonly string[], site: SiteBoundary, date: string) {
  const extent = siteGeographicExtent(site);
  const url = new URL(GIBS_WMS_URL);
  url.search = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layers.join(','),
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    CRS: 'EPSG:4326',
    BBOX: `${extent.south},${extent.west},${extent.north},${extent.east}`,
    WIDTH: '1024',
    HEIGHT: '1024',
    TIME: normalizeGibsDate(date),
  }).toString();
  return {
    url: url.toString(),
    bounds: {
      north: extent.north,
      south: extent.south,
      east: extent.east,
      west: extent.west,
    },
  };
}

export function worldviewPermalinkLayers(): string[] {
  return [
    GIBS_RASTER_LAYERS['true-color'].layer,
    GIBS_RASTER_LAYERS.hls.layer,
    ...GIBS_FIRE_LAYERS,
    GIBS_RASTER_LAYERS['surface-water'].layer,
    GIBS_RASTER_LAYERS.flood.layer,
    GIBS_RASTER_LAYERS.aerosol.layer,
    GIBS_RASTER_LAYERS.disturbance.layer,
    GIBS_RASTER_LAYERS.precipitation.layer,
    WORLDVIEW_LABEL_LAYER,
  ];
}

export function worldviewPermalink(site: SiteBoundary, date: string): string {
  const extent = siteGeographicExtent(site);
  const v = `${extent.west.toFixed(4)},${extent.south.toFixed(4)},${extent.east.toFixed(4)},${extent.north.toFixed(4)}`;
  const marker = `${extent.center.lat.toFixed(4)},${extent.center.lng.toFixed(4)}`;
  return `${WORLDVIEW_ORIGIN}/?v=${v}&p=geographic&t=${normalizeGibsDate(date)}-T00:00:00Z&l=${worldviewPermalinkLayers().join(',')}&s=${marker}`;
}

export function siteGeographicExtent(site: SiteBoundary, minimumSpanDegrees = 0.35) {
  const coordinates = siteCoordinates(site);
  const latitudes = coordinates.map((point) => point.lat);
  const longitudes = coordinates.map((point) => point.lng);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const latPad = Math.max((minimumSpanDegrees - (north - south)) / 2, (north - south) * 0.35, 0.04);
  const lngPad = Math.max((minimumSpanDegrees - (east - west)) / 2, (east - west) * 0.35, 0.04);
  return {
    south: clamp(south - latPad, -85, 85),
    north: clamp(north + latPad, -85, 85),
    west: west - lngPad,
    east: east + lngPad,
    center: {
      lat: (south + north) / 2,
      lng: (west + east) / 2,
    } satisfies Coordinate,
  };
}

function siteCoordinates(site: SiteBoundary): Coordinate[] {
  return [site.polygon, ...site.additionalPolygons].flat();
}

function wrapTileX(x: number, zoom: number) {
  const tiles = 2 ** zoom;
  return ((x % tiles) + tiles) % tiles;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
