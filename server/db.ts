import pg from 'pg';
import type { SiteBoundary, SiteValidation } from '../src/types.js';
import { boundaryGeoJsonGeometry, localSiteValidation, normalizeSiteBoundary } from '../src/lib/siteGeometry.js';

const { Pool } = pg;
let pool: pg.Pool | null = null;

export function databasePool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://growaf:growaf@127.0.0.1:55432/growaf',
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function migrateDatabase() {
  const db = databasePool();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
}

export async function databaseHealth(): Promise<boolean> {
  try { await databasePool().query('SELECT 1'); return true; } catch { return false; }
}

export async function geometryMetrics(site: SiteBoundary): Promise<SiteValidation> {
  const normalized = normalizeSiteBoundary(site);
  const local = localSiteValidation(normalized);
  if (!local.valid) return validationResult(normalized, false, local.reason, 0, 0, 0);
  const boundary = boundaryGeoJsonGeometry(normalized);
  const exclusions = normalized.exclusions.map((polygon) => polygonGeoJson(polygon));
  const paths = normalized.paths.map((path) => ({ geometry: lineGeoJson(path.points), widthM: path.widthM }));
  const trees = normalized.existingTrees.map((tree) => ({ geometry: pointGeoJson(tree.coordinate), radiusM: tree.crownDiameterM / 2 + tree.protectionBufferM }));
  const result = await databasePool().query<{ valid: boolean; reason: string; area_m2: string; perimeter_m: string; plantable_area_m2: string; blockers_covered: boolean }>(`
    WITH boundary_raw AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS value
    ),
    boundary AS (
      SELECT value, ST_IsValid(value) AS valid FROM boundary_raw
    ),
    exclusions AS (
      SELECT COALESCE(ST_UnaryUnion(ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(item::text), 4326))), ST_GeomFromText('GEOMETRYCOLLECTION EMPTY', 4326)) AS value
      FROM jsonb_array_elements($2::jsonb) AS item
    ),
    path_buffers AS (
      SELECT COALESCE(ST_UnaryUnion(ST_Collect(ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON(item->'geometry'), 4326)::geography, ((item->>'widthM')::double precision) / 2)::geometry)), ST_GeomFromText('GEOMETRYCOLLECTION EMPTY', 4326)) AS value
      FROM jsonb_array_elements($3::jsonb) AS item
    ),
    tree_buffers AS (
      SELECT COALESCE(ST_UnaryUnion(ST_Collect(ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON(item->'geometry'), 4326)::geography, (item->>'radiusM')::double precision)::geometry)), ST_GeomFromText('GEOMETRYCOLLECTION EMPTY', 4326)) AS value
      FROM jsonb_array_elements($4::jsonb) AS item
    ),
    plantable_base AS (
      SELECT CASE WHEN $5::double precision > 0 THEN ST_Buffer(value::geography, -$5::double precision)::geometry ELSE value END AS value
      FROM boundary
    ),
    blockers AS (
      SELECT ST_UnaryUnion(ST_Collect(ARRAY[exclusions.value, path_buffers.value, tree_buffers.value])) AS value,
        (ST_IsEmpty(exclusions.value) OR ST_CoveredBy(exclusions.value, boundary.value))
        AND (ST_IsEmpty(tree_buffers.value) OR ST_CoveredBy(tree_buffers.value, boundary.value)) AS covered
      FROM exclusions, path_buffers, tree_buffers, boundary
    ),
    plantable AS (
      SELECT ST_Difference(plantable_base.value, blockers.value) AS value FROM plantable_base, blockers
    )
    SELECT boundary.valid,
      ST_IsValidReason(boundary.value) AS reason,
      CASE WHEN boundary.valid THEN ST_Area(boundary.value::geography) ELSE 0 END AS area_m2,
      CASE WHEN boundary.valid THEN ST_Perimeter(boundary.value::geography) ELSE 0 END AS perimeter_m,
      CASE WHEN boundary.valid THEN COALESCE(ST_Area(plantable.value::geography), 0) ELSE 0 END AS plantable_area_m2,
      blockers.covered AS blockers_covered
    FROM boundary, plantable, blockers
  `, [JSON.stringify(boundary), JSON.stringify(exclusions), JSON.stringify(paths), JSON.stringify(trees), normalized.setbackM]);
  const row = result.rows[0];
  const plantableAreaM2 = Number(row.plantable_area_m2);
  const valid = row.valid && row.blockers_covered && plantableAreaM2 >= 10;
  const reason = !row.valid ? row.reason : !row.blockers_covered ? 'All exclusions and protected-tree buffers must be contained by the site.' : plantableAreaM2 < 10 ? 'Setbacks and exclusions leave less than 10 m² of plantable area.' : 'Valid site geometry';
  return validationResult(normalized, valid, reason, Number(row.area_m2), Number(row.perimeter_m), plantableAreaM2);
}

function polygonGeoJson(polygon: Array<{ lat: number; lng: number }>) {
  const ring = polygon.map((point) => [point.lng, point.lat]);
  const first = ring[0]; const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return { type: 'Polygon', coordinates: [ring] };
}

function lineGeoJson(points: Array<{ lat: number; lng: number }>) {
  return { type: 'LineString', coordinates: points.map((point) => [point.lng, point.lat]) };
}

function pointGeoJson(point: { lat: number; lng: number }) {
  return { type: 'Point', coordinates: [point.lng, point.lat] };
}

function validationResult(site: SiteBoundary, valid: boolean, reason: string, areaM2: number, perimeterM: number, plantableAreaM2: number): SiteValidation {
  return {
    valid,
    reason,
    areaM2,
    perimeterM,
    plantableAreaM2,
    geometryType: site.additionalPolygons.length ? 'MultiPolygon' : 'Polygon',
    counts: {
      polygons: 1 + site.additionalPolygons.length,
      holes: site.holes.length,
      exclusions: site.exclusions.length,
      paths: site.paths.length,
      accessPoints: site.accessPoints.length,
      waterPoints: site.waterPoints.length,
      existingTrees: site.existingTrees.length,
    },
  };
}
