import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import {
  boundaryGeoJsonGeometry,
  distanceToSiteBoundaryM,
  distanceToSitePathM,
  importSiteGeoJson,
  localSiteValidation,
  siteContainsCoordinate,
} from './siteGeometry';

describe('site geometry', () => {
  it('imports a complete Polygon project with holes and infrastructure features', () => {
    const outer = closed(TEMPERATE_OPEN_FIELD_FIXTURE.polygon);
    const hole = closed([
      { lat: 36.92096, lng: 14.75319 },
      { lat: 36.92096, lng: 14.75325 },
      { lat: 36.92091, lng: 14.75325 },
      { lat: 36.92091, lng: 14.75319 },
    ]);
    const input = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'site', id: 'import-test', name: 'Imported field', setbackM: 1.7 }, geometry: { type: 'Polygon', coordinates: [outer, hole] } },
        { type: 'Feature', properties: { kind: 'manual_exclusion', id: 'ex-1' }, geometry: { type: 'Polygon', coordinates: [closed([
          { lat: 36.92104, lng: 14.75320 }, { lat: 36.92104, lng: 14.75325 }, { lat: 36.92100, lng: 14.75325 }, { lat: 36.92100, lng: 14.75320 },
        ])] } },
        { type: 'Feature', properties: { kind: 'management_path', id: 'path-1', name: 'Main access', widthM: 3.5 }, geometry: { type: 'LineString', coordinates: [[14.75302, 36.92086], [14.75355, 36.92105]] } },
        { type: 'Feature', properties: { kind: 'access_point', id: 'access-1', name: 'South gate' }, geometry: { type: 'Point', coordinates: [14.75303, 36.92086] } },
        { type: 'Feature', properties: { kind: 'water_point', id: 'water-1', name: 'Tank' }, geometry: { type: 'Point', coordinates: [14.75346, 36.92098] } },
        { type: 'Feature', properties: { kind: 'existing_tree', id: 'tree-1', name: 'Observed olive', speciesName: 'Olea europaea', crownDiameterM: 4.5, protectionBufferM: 2.5 }, geometry: { type: 'Point', coordinates: [14.75331, 36.92094] } },
      ],
    };

    const site = importSiteGeoJson(input);
    expect(site.id).toBe('import-test');
    expect(site.holes).toHaveLength(1);
    expect(site.exclusions).toHaveLength(1);
    expect(site.paths).toEqual([expect.objectContaining({ id: 'path-1', widthM: 3.5 })]);
    expect(site.accessPoints).toHaveLength(1);
    expect(site.waterPoints).toHaveLength(1);
    expect(site.existingTrees).toEqual([expect.objectContaining({ speciesName: 'Olea europaea', crownDiameterM: 4.5 })]);
    expect(localSiteValidation(site)).toEqual({ valid: true, reason: 'Valid site geometry' });
    expect(siteContainsCoordinate(site, { lat: 36.920935, lng: 14.75322 })).toBe(false);
    expect(distanceToSitePathM({ lat: 36.92095, lng: 14.75328 }, site.paths[0])).toBeLessThan(5);
    expect(distanceToSiteBoundaryM(site, { lat: 36.92094, lng: 14.75334 })).toBeGreaterThan(1);
  });

  it('preserves every region of an imported MultiPolygon', () => {
    const second = TEMPERATE_OPEN_FIELD_FIXTURE.polygon.map((point) => ({ lat: point.lat + 0.001, lng: point.lng + 0.001 }));
    const site = importSiteGeoJson({
      type: 'MultiPolygon',
      coordinates: [[closed(TEMPERATE_OPEN_FIELD_FIXTURE.polygon)], [closed(second)]],
    });
    expect(site.additionalPolygons).toHaveLength(1);
    expect(boundaryGeoJsonGeometry(site).type).toBe('MultiPolygon');
    expect(siteContainsCoordinate(site, {
      lat: second.reduce((sum, point) => sum + point.lat, 0) / second.length,
      lng: second.reduce((sum, point) => sum + point.lng, 0) / second.length,
    })).toBe(true);
  });

  it('rejects self-intersecting and out-of-bound constraints', () => {
    const selfIntersecting = {
      ...TEMPERATE_OPEN_FIELD_FIXTURE,
      polygon: [
        { lat: 36.9213, lng: 14.753 },
        { lat: 36.9208, lng: 14.7536 },
        { lat: 36.9213, lng: 14.7536 },
        { lat: 36.9208, lng: 14.753 },
      ],
    };
    expect(localSiteValidation(selfIntersecting).valid).toBe(false);

    const outsideAccess = {
      ...TEMPERATE_OPEN_FIELD_FIXTURE,
      accessPoints: [{ id: 'outside', name: 'Outside', coordinate: { lat: 36.925, lng: 14.76 } }],
    };
    expect(localSiteValidation(outsideAccess)).toEqual({ valid: false, reason: 'Access, water and existing-tree points must lie inside the site.' });
  });
});

function closed(points: Array<{ lat: number; lng: number }>) {
  return [...points.map((point) => [point.lng, point.lat]), [points[0].lng, points[0].lat]];
}
