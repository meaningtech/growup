import type { Coordinate } from '../types';

const EARTH_RADIUS_M = 6_371_008.8;

export type PointM = { x: number; y: number };

export type LocalProjection = {
  origin: Coordinate;
  project: (coordinate: Coordinate) => PointM;
  unproject: (point: PointM) => Coordinate;
};

export function createLocalProjection(origin: Coordinate): LocalProjection {
  const originLatRad = toRadians(origin.lat);

  return {
    origin,
    project: (coordinate) => ({
      x: toRadians(coordinate.lng - origin.lng) * EARTH_RADIUS_M * Math.cos(originLatRad),
      y: toRadians(coordinate.lat - origin.lat) * EARTH_RADIUS_M,
    }),
    unproject: (point) => ({
      lat: origin.lat + toDegrees(point.y / EARTH_RADIUS_M),
      lng: origin.lng + toDegrees(point.x / (EARTH_RADIUS_M * Math.cos(originLatRad))),
    }),
  };
}

export function polygonCentroid(points: Coordinate[]): Coordinate {
  if (points.length === 0) throw new Error('A polygon requires at least one coordinate');

  const reference = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
  const projection = createLocalProjection(reference);
  const projected = points.map(projection.project);
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) < 0.001) return reference;
  return projection.unproject({ x: x / (3 * twiceArea), y: y / (3 * twiceArea) });
}

export function polygonAreaM2(points: Coordinate[]): number {
  if (points.length < 3) return 0;
  const projection = createLocalProjection(polygonCentroid(points));
  const projected = points.map(projection.project);
  return Math.abs(signedArea(projected));
}

export function polygonPerimeterM(points: Coordinate[]): number {
  return points.reduce((sum, point, index) => sum + haversineM(point, points[(index + 1) % points.length]), 0);
}

export function haversineM(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function pointInPolygon(point: PointM, polygon: PointM[]): boolean {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x;
    if (intersects) inside = !inside;
  }

  return inside;
}

export function distanceToPolygonEdge(point: PointM, polygon: PointM[]): number {
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }

  return minimum;
}

export function rotate(point: PointM, degrees: number): PointM {
  const angle = toRadians(degrees);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

export function bounds(points: PointM[]) {
  return points.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
}

export function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function longestEdgeDirection(points: Coordinate[]): number {
  let longest = { distance: 0, direction: 0 };

  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const distance = haversineM(a, b);
    if (distance > longest.distance) {
      const projection = createLocalProjection(a);
      const vector = projection.project(b);
      longest = { distance, direction: (toDegrees(Math.atan2(vector.x, vector.y)) + 360) % 180 };
    }
  }

  return longest.direction;
}

function signedArea(points: PointM[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function distanceToSegment(point: PointM, start: PointM, end: PointM): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
