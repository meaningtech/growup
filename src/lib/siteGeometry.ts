import type { Coordinate, ExistingTreeObservation, SiteBoundary, SitePath, SitePoint } from '../types';
import { createLocalProjection, haversineM, pointInPolygon, polygonAreaM2, polygonCentroid, polygonPerimeterM } from './geometry';

type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

type GeoJsonFeature = {
  type: 'Feature';
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
};

type GeoJsonInput = GeoJsonGeometry | GeoJsonFeature | { type: 'FeatureCollection'; features: GeoJsonFeature[] };

export function normalizeSiteBoundary(value: Partial<SiteBoundary> & Pick<SiteBoundary, 'id' | 'name' | 'polygon'>): SiteBoundary {
  return {
    id: value.id,
    name: value.name,
    polygon: cleanRing(value.polygon),
    additionalPolygons: (value.additionalPolygons ?? []).map(cleanRing),
    holes: (value.holes ?? []).map(cleanRing),
    exclusions: (value.exclusions ?? []).map(cleanRing),
    paths: (value.paths ?? []).map((path) => ({ ...path, points: path.points.map(cleanCoordinate), widthM: clamp(Number(path.widthM), 0.5, 30) })),
    accessPoints: (value.accessPoints ?? []).map(cleanSitePoint),
    waterPoints: (value.waterPoints ?? []).map(cleanSitePoint),
    existingTrees: (value.existingTrees ?? []).map((tree) => ({
      ...cleanSitePoint(tree),
      speciesName: tree.speciesName?.trim() || null,
      crownDiameterM: clamp(Number(tree.crownDiameterM), 0.5, 40),
      protectionBufferM: clamp(Number(tree.protectionBufferM), 0, 20),
    })),
    setbackM: clamp(Number(value.setbackM ?? 1.3), 0, 30),
  };
}

export function sitePolygons(site: SiteBoundary): Coordinate[][] {
  return [site.polygon, ...site.additionalPolygons];
}

export function siteContainsCoordinate(site: SiteBoundary, coordinate: Coordinate): boolean {
  const projection = createLocalProjection(polygonCentroid(site.polygon));
  const point = projection.project(coordinate);
  const insideOuter = sitePolygons(site).some((polygon) => pointInPolygon(point, polygon.map(projection.project)));
  return insideOuter && !site.holes.some((hole) => pointInPolygon(point, hole.map(projection.project)));
}

export function distanceToSitePathM(coordinate: Coordinate, path: SitePath): number {
  if (path.points.length < 2) return Number.POSITIVE_INFINITY;
  const projection = createLocalProjection(coordinate);
  const point = projection.project(coordinate);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, projection.project(path.points[index]), projection.project(path.points[index + 1])));
  }
  return minimum;
}

export function distanceToSiteBoundaryM(site: SiteBoundary, coordinate: Coordinate): number {
  if (!siteContainsCoordinate(site, coordinate)) return 0;
  const projection = createLocalProjection(coordinate);
  const point = projection.project(coordinate);
  let minimum = Number.POSITIVE_INFINITY;
  for (const ring of [...sitePolygons(site), ...site.holes]) {
    for (let index = 0; index < ring.length; index += 1) {
      minimum = Math.min(minimum, distanceToSegment(point, projection.project(ring[index]), projection.project(ring[(index + 1) % ring.length])));
    }
  }
  return minimum;
}

export function localSiteValidation(site: SiteBoundary): { valid: boolean; reason: string } {
  const polygons = sitePolygons(site);
  if (!polygons.length || polygons.some((polygon) => polygon.length < 3)) return { valid: false, reason: 'Every planting polygon requires at least three vertices.' };
  if (polygons.flat().some((coordinate) => !validCoordinate(coordinate))) return { valid: false, reason: 'The site contains an invalid coordinate.' };
  if (polygons.some((polygon) => polygonAreaM2(polygon) < 25)) return { valid: false, reason: 'Every planting polygon must cover at least 25 m².' };
  if (polygons.some(hasSelfIntersection)) return { valid: false, reason: 'A planting polygon self-intersects.' };
  if (site.holes.some((hole) => hole.length < 3 || hasSelfIntersection(hole) || !siteContainsOuter(site, polygonCentroid(hole)))) return { valid: false, reason: 'Every hole must be a valid polygon contained by the site.' };
  if (site.exclusions.some((polygon) => polygon.length < 3 || hasSelfIntersection(polygon) || !siteContainsCoordinate(site, polygonCentroid(polygon)))) return { valid: false, reason: 'Every exclusion must be a valid polygon contained by the site.' };
  if (site.paths.some((path) => path.points.length < 2 || path.points.some((point) => !siteContainsCoordinate(site, point)))) return { valid: false, reason: 'Every management path must contain at least two points inside the site.' };
  if ([...site.accessPoints, ...site.waterPoints, ...site.existingTrees].some((point) => !siteContainsCoordinate(site, point.coordinate))) return { valid: false, reason: 'Access, water and existing-tree points must lie inside the site.' };
  return { valid: true, reason: 'Valid site geometry' };
}

export function importSiteGeoJson(input: unknown, options: { id?: string; name?: string } = {}): SiteBoundary {
  if (!input || typeof input !== 'object') throw new Error('GeoJSON must be a JSON object.');
  const root = input as GeoJsonInput;
  const features: GeoJsonFeature[] = 'features' in root
    ? root.features
    : 'geometry' in root
      ? [root]
      : [{ type: 'Feature', geometry: root as GeoJsonGeometry, properties: {} }];
  const siteFeature = features.find((feature) => feature.properties?.kind === 'site')
    ?? features.find((feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon');
  if (!siteFeature?.geometry) throw new Error('GeoJSON must contain a Polygon or MultiPolygon site geometry.');
  const parsed = parseBoundaryGeometry(siteFeature.geometry);
  const site: SiteBoundary = normalizeSiteBoundary({
    id: options.id ?? stringProperty(siteFeature.properties, 'id') ?? `imported-${stableId(JSON.stringify(input))}`,
    name: options.name ?? stringProperty(siteFeature.properties, 'name') ?? 'Imported Growaf site',
    polygon: parsed.polygons[0],
    additionalPolygons: parsed.polygons.slice(1),
    holes: parsed.holes,
    exclusions: [],
    paths: [],
    accessPoints: [],
    waterPoints: [],
    existingTrees: [],
    setbackM: numberProperty(siteFeature.properties, 'setbackM') ?? 1.3,
  });

  for (const feature of features) {
    if (!feature.geometry || feature === siteFeature) continue;
    const kind = stringProperty(feature.properties, 'kind');
    if ((kind === 'manual_exclusion' || kind === 'exclusion') && feature.geometry.type === 'Polygon') {
      site.exclusions.push(parsePolygonCoordinates(feature.geometry.coordinates).outer);
    }
    if (kind === 'management_path' && feature.geometry.type === 'LineString') {
      site.paths.push({ id: featureId(feature, 'path'), name: stringProperty(feature.properties, 'name') ?? 'Management path', points: parseLine(feature.geometry.coordinates), widthM: numberProperty(feature.properties, 'widthM') ?? 3 });
    }
    if ((kind === 'access_point' || kind === 'water_point' || kind === 'existing_tree') && feature.geometry.type === 'Point') {
      const point = { id: featureId(feature, kind), name: stringProperty(feature.properties, 'name') ?? humanize(kind), coordinate: parsePosition(feature.geometry.coordinates) };
      if (kind === 'access_point') site.accessPoints.push(point);
      if (kind === 'water_point') site.waterPoints.push(point);
      if (kind === 'existing_tree') site.existingTrees.push({ ...point, speciesName: stringProperty(feature.properties, 'speciesName'), crownDiameterM: numberProperty(feature.properties, 'crownDiameterM') ?? 5, protectionBufferM: numberProperty(feature.properties, 'protectionBufferM') ?? 2.5 });
    }
  }
  const validation = localSiteValidation(site);
  if (!validation.valid) throw new Error(validation.reason);
  return site;
}

export function boundaryGeoJsonGeometry(site: SiteBoundary) {
  const polygons = sitePolygons(site).map((outer) => {
    const containedHoles = site.holes.filter((hole) => polygonContainsCoordinate(outer, polygonCentroid(hole)));
    return [closedPositions(outer), ...containedHoles.map(closedPositions)];
  });
  return polygons.length === 1
    ? { type: 'Polygon' as const, coordinates: polygons[0] }
    : { type: 'MultiPolygon' as const, coordinates: polygons };
}

export function estimatedPlantableAreaM2(site: SiteBoundary): number {
  const gross = sitePolygons(site).reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
  const setback = sitePolygons(site).reduce((sum, polygon) => sum + polygonPerimeterM(polygon) * site.setbackM, 0);
  const holes = site.holes.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
  const exclusions = site.exclusions.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
  const paths = site.paths.reduce((sum, path) => sum + polylineLengthM(path.points) * path.widthM, 0);
  const trees = site.existingTrees.reduce((sum, tree) => sum + Math.PI * ((tree.crownDiameterM / 2) + tree.protectionBufferM) ** 2, 0);
  return Math.max(0, gross - setback - holes - exclusions - paths - trees);
}

function parseBoundaryGeometry(geometry: GeoJsonGeometry) {
  if (geometry.type === 'Polygon') {
    const polygon = parsePolygonCoordinates(geometry.coordinates);
    return { polygons: [polygon.outer], holes: polygon.holes };
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) throw new Error('Invalid MultiPolygon coordinates.');
    const parsed = geometry.coordinates.map(parsePolygonCoordinates);
    return { polygons: parsed.map((polygon) => polygon.outer), holes: parsed.flatMap((polygon) => polygon.holes) };
  }
  throw new Error(`Unsupported site geometry ${geometry.type}.`);
}

function parsePolygonCoordinates(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new Error('Polygon coordinates are empty.');
  const rings = value.map(parseLine).map(cleanRing);
  if (rings[0].length < 3) throw new Error('Polygon outer ring requires at least three distinct coordinates.');
  return { outer: rings[0], holes: rings.slice(1) };
}

function parseLine(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) throw new Error('GeoJSON coordinate array is invalid.');
  return value.map(parsePosition);
}

function parsePosition(value: unknown): Coordinate {
  if (!Array.isArray(value) || value.length < 2) throw new Error('GeoJSON position is invalid.');
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('GeoJSON position must contain finite longitude and latitude.');
  return { lat, lng };
}

function cleanRing(points: Coordinate[]) {
  const cleaned = points.map(cleanCoordinate);
  if (cleaned.length > 1 && sameCoordinate(cleaned[0], cleaned[cleaned.length - 1])) cleaned.pop();
  return cleaned.filter((point, index) => index === 0 || !sameCoordinate(point, cleaned[index - 1]));
}

function cleanCoordinate(point: Coordinate): Coordinate {
  return { lat: Number(point.lat), lng: Number(point.lng) };
}

function cleanSitePoint(point: SitePoint): SitePoint {
  return { id: point.id, name: point.name.trim(), coordinate: cleanCoordinate(point.coordinate) };
}

function validCoordinate(point: Coordinate) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

function hasSelfIntersection(polygon: Coordinate[]) {
  const projection = createLocalProjection(polygonCentroid(polygon));
  const points = polygon.map(projection.project);
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  const orientation = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

function siteContainsOuter(site: SiteBoundary, coordinate: Coordinate) {
  return sitePolygons(site).some((polygon) => polygonContainsCoordinate(polygon, coordinate));
}

function polygonContainsCoordinate(polygon: Coordinate[], coordinate: Coordinate) {
  const projection = createLocalProjection(polygonCentroid(polygon));
  return pointInPolygon(projection.project(coordinate), polygon.map(projection.project));
}

function closedPositions(points: Coordinate[]) {
  const positions = points.map((point) => [point.lng, point.lat]);
  if (positions.length && !samePosition(positions[0], positions[positions.length - 1])) positions.push([...positions[0]]);
  return positions;
}

function polylineLengthM(points: Coordinate[]) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) total += haversineM(points[index], points[index + 1]);
  return total;
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function featureId(feature: GeoJsonFeature, prefix: string) {
  return stringProperty(feature.properties, 'id') ?? `${prefix}-${stableId(JSON.stringify(feature.geometry))}`;
}

function stringProperty(properties: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = properties?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberProperty(properties: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = Number(properties?.[key]);
  return Number.isFinite(value) ? value : null;
}

function stableId(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(36);
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ');
}

function sameCoordinate(a: Coordinate, b: Coordinate) {
  return Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lng - b.lng) < 1e-10;
}

function samePosition(a: number[], b: number[]) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
