import { inflateSync } from 'node:zlib';
import { gibsObservationDate } from '../src/lib/gibs.js';
import type { Coordinate, Evidence, NasaLandscapeContext, NasaLandscapeSample } from '../src/types.js';

export const GIBS_COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3';
export const GIBS_WMS_ENDPOINT = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

export const GIBS_SCREENING_LAYERS = [
  { id: 'precipitation' as const, layer: 'IMERG_Precipitation_Rate', colormap: 'GPM_Precipitation_Rate', resolution: '10 km', source: 'NASA GPM IMERG via GIBS' },
  { id: 'aerosol' as const, layer: 'OMPS_Aerosol_Index', colormap: 'OMPS_Aerosol_Index', resolution: '50 km', source: 'NASA OMPS aerosol index via GIBS' },
  { id: 'surface-water' as const, layer: 'OPERA_L3_Dynamic_Surface_Water_Extent-HLS', colormap: 'OPERA_Dynamic_Surface_Water_Extent', resolution: '30 m', source: 'NASA OPERA DSWx via GIBS' },
  { id: 'flood' as const, layer: 'VIIRS_Combined_Flood_3-Day', colormap: 'MODIS_Flood', resolution: '250 m', source: 'NASA VIIRS flood via GIBS' },
  { id: 'disturbance' as const, layer: 'OPERA_L3_DIST-ALERT-HLS_Color_Index', colormap: 'OPERA_Vegetation_Disturbance_Status', resolution: '30 m', source: 'NASA OPERA DIST-ALERT via GIBS' },
];

export const NASA_LANDSCAPE_LIMITATION = 'NASA GIBS browse values are regional colormap screening. They do not replace Open-Meteo climate normals, SoilGrids chemistry or field-clipped Sentinel observations.';

type ColorEntry = {
  r: number;
  g: number;
  b: number;
  transparent: boolean;
  nodata: boolean;
  unit: string | null;
  label: string;
  value: number | null;
};

const colormapCache = new Map<string, ColorEntry[]>();

export function parseGibsColormap(xml: string): ColorEntry[] {
  const units = xml.match(/<ColorMap[^>]*units="([^"]+)"/)?.[1] ?? null;
  const entries: ColorEntry[] = [];
  const legendByRgb = new Map<string, string>();
  for (const match of xml.matchAll(/<LegendEntry\s+([^/]+)\/>/g)) {
    const rgb = attribute(match[1], 'rgb');
    const tooltip = attribute(match[1], 'tooltip') ?? attribute(match[1], 'label');
    if (rgb && tooltip) legendByRgb.set(rgb.replace(/\s/g, ''), tooltip);
  }
  for (const match of xml.matchAll(/<ColorMapEntry\s+([^/]+)\/>/g)) {
    const rgb = parseRgb(attribute(match[1], 'rgb'));
    if (!rgb) continue;
    const scaled = parseScaled(attribute(match[1], 'value') ?? attribute(match[1], 'sourceValue'));
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    entries.push({
      ...rgb,
      transparent: attribute(match[1], 'transparent') === 'true',
      nodata: attribute(match[1], 'nodata') === 'true',
      unit: units,
      label: legendByRgb.get(key) ?? scaled.label,
      value: scaled.mid,
    });
  }
  return entries;
}

export function matchColorEntry(entries: ColorEntry[], r: number, g: number, b: number, a: number): ColorEntry | null {
  if (a < 16) return entries.find((entry) => entry.transparent || entry.nodata) ?? null;
  let best: ColorEntry | null = null;
  let bestDistance = 48;
  for (const entry of entries) {
    const distance = Math.abs(entry.r - r) + Math.abs(entry.g - g) + Math.abs(entry.b - b);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

export function decodePngRgba(buffer: Uint8Array): { r: number; g: number; b: number; a: number } {
  if (buffer.length < 33 || String.fromCharCode(...buffer.slice(1, 4)) !== 'PNG') {
    throw new Error('GIBS sample is not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= buffer.length) {
    const length = readUint32(buffer, offset);
    const type = String.fromCharCode(...buffer.slice(offset + 4, offset + 8));
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('Unsupported GIBS PNG sample');
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(height * stride);
  let rawOffset = 0;
  let previous = new Uint8Array(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const current = raw.slice(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const reconstructed = reconstructPngRow(filter, current, previous, bytesPerPixel);
    pixels.set(reconstructed, row * stride);
    previous = reconstructed;
  }
  const center = Math.floor(height / 2) * stride + Math.floor(width / 2) * bytesPerPixel;
  return {
    r: pixels[center],
    g: pixels[center + 1],
    b: pixels[center + 2],
    a: colorType === 6 ? pixels[center + 3] : 255,
  };
}

export async function fetchNasaLandscapeContext(
  centroid: Coordinate,
  fetchImpl: typeof fetch,
  options: { now?: () => Date; wmsUrl?: string; colormapUrl?: string } = {},
): Promise<NasaLandscapeContext> {
  const observedAt = gibsObservationDate(options.now?.() ?? new Date());
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  const samples = await Promise.all(GIBS_SCREENING_LAYERS.map((spec) => sampleLayer(spec, centroid, observedAt, retrievedAt, fetchImpl, options)));
  const available = samples.filter((sample) => sample.status === 'available');
  return {
    status: available.length === samples.length ? 'available' : available.length ? 'partial' : 'unavailable',
    observedAt,
    samples,
    limitations: [NASA_LANDSCAPE_LIMITATION],
  };
}

export function unavailableNasaLandscapeContext(now = new Date()): NasaLandscapeContext {
  return {
    status: 'unavailable',
    observedAt: gibsObservationDate(now),
    samples: [],
    limitations: [NASA_LANDSCAPE_LIMITATION, 'NASA GIBS screening could not be retrieved for this field.'],
  };
}

async function sampleLayer(
  spec: typeof GIBS_SCREENING_LAYERS[number],
  centroid: Coordinate,
  observedAt: string,
  retrievedAt: string,
  fetchImpl: typeof fetch,
  options: { wmsUrl?: string; colormapUrl?: string },
): Promise<NasaLandscapeSample> {
  const evidence = (version: string, confidence: Evidence['confidence'], extra: Partial<Evidence> = {}): Evidence => ({
    source: spec.source,
    sourceUrl: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
    version,
    observedAt: `${observedAt}T00:00:00.000Z`,
    dataObservedAt: `${observedAt}T00:00:00.000Z`,
    retrievedAt,
    computedAt: retrievedAt,
    confidence,
    resolution: spec.resolution,
    ...extra,
  });
  try {
    const entries = await loadColormap(spec.colormap, fetchImpl, options.colormapUrl);
    const png = await fetchImpl(wmsSampleUrl(spec.layer, centroid, observedAt, options.wmsUrl));
    if (!png.ok) throw new Error(`GIBS WMS returned ${png.status}`);
    const pixel = decodePngRgba(new Uint8Array(await png.arrayBuffer()));
    const entry = matchColorEntry(entries, pixel.r, pixel.g, pixel.b, pixel.a);
    if (!entry || entry.nodata || entry.transparent) {
      return {
        id: spec.id,
        layer: spec.layer,
        status: 'nodata',
        label: entry?.label ?? 'No data',
        value: null,
        unit: entry?.unit ?? null,
        evidence: evidence(`${spec.layer} · ${observedAt}`, 'low'),
      };
    }
    return {
      id: spec.id,
      layer: spec.layer,
      status: 'available',
      label: entry.label,
      value: entry.value,
      unit: entry.unit,
      evidence: evidence(`${spec.layer} · ${observedAt}`, spec.resolution.includes('km') ? 'low' : 'medium'),
    };
  } catch {
    return {
      id: spec.id,
      layer: spec.layer,
      status: 'unavailable',
      label: null,
      value: null,
      unit: null,
      evidence: evidence(`${spec.layer} unavailable`, 'low'),
    };
  }
}

async function loadColormap(name: string, fetchImpl: typeof fetch, baseUrl?: string): Promise<ColorEntry[]> {
  const cached = colormapCache.get(name);
  if (cached) return cached;
  const url = `${baseUrl ?? GIBS_COLORMAP_URL}/${name}.xml`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`GIBS colormap returned ${response.status}`);
  const entries = parseGibsColormap(await response.text());
  if (!entries.length) throw new Error('GIBS colormap is empty');
  colormapCache.set(name, entries);
  return entries;
}

function wmsSampleUrl(layer: string, centroid: Coordinate, date: string, endpoint = GIBS_WMS_ENDPOINT) {
  const pad = 0.05;
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    CRS: 'EPSG:4326',
    BBOX: `${centroid.lat - pad},${centroid.lng - pad},${centroid.lat + pad},${centroid.lng + pad}`,
    WIDTH: '1',
    HEIGHT: '1',
    TIME: date,
  }).toString();
  return url;
}

function parseRgb(value: string | undefined) {
  const parts = value?.split(',').map((part) => Number(part.trim()));
  if (!parts || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function parseScaled(raw: string | undefined) {
  if (!raw) return { mid: null as number | null, label: 'Unspecified' };
  const cleaned = raw.replace(/[[\]()]/g, '');
  const [left, right] = cleaned.split(',').map((part) => part.trim());
  const low = parseBound(left);
  const high = parseBound(right ?? left);
  if (low === null && high === null) return { mid: null, label: raw };
  if (low !== null && high !== null) return { mid: Number(((low + high) / 2).toPrecision(6)), label: `${low}–${high}` };
  return { mid: low ?? high, label: raw };
}

function parseBound(value: string | undefined) {
  if (!value || value === 'INF' || value === '-INF' || value === '+INF') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function attribute(source: string, name: string) {
  return source.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function readUint32(buffer: Uint8Array, offset: number) {
  return (buffer[offset] << 24 | buffer[offset + 1] << 16 | buffer[offset + 2] << 8 | buffer[offset + 3]) >>> 0;
}

function reconstructPngRow(filter: number, current: Uint8Array, previous: Uint8Array, bytesPerPixel: number) {
  const output = new Uint8Array(current.length);
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const up = previous[index];
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    let value = current[index];
    if (filter === 1) value += left;
    else if (filter === 2) value += up;
    else if (filter === 3) value += Math.floor((left + up) / 2);
    else if (filter === 4) value += paeth(left, up, upLeft);
    output[index] = value & 255;
  }
  return output;
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}
