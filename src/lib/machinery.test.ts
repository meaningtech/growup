import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { createLocalProjection, haversineM, polygonCentroid } from './geometry';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { distanceToSiteBoundaryM, siteContainsCoordinate } from './siteGeometry';

const palette = DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked').slice(0, 9);

describe('machinery route planning', () => {
  it('reserves a drivable perimeter and connects every row pass through one manoeuvre route', () => {
    const site = TEMPERATE_OPEN_FIELD_FIXTURE;
    const variant = generateLayoutVariants(site, openFieldProfile(site), palette, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      machinery: {
        ...DEFAULT_DESIGN_CONFIGURATION.machinery,
        enabled: true,
        presetId: 'new-holland-t4f',
        widthM: 2.4,
        implementWidthM: 2.5,
        safetyClearanceM: 0.6,
        lengthM: 4.03,
        turningRadiusM: 4,
      },
    })[0];

    expect(variant.machinery.requiredCorridorWidthM).toBe(3.7);
    expect(variant.machinery.perimeterLoops).toHaveLength(1);
    expect(variant.machinery.manoeuvreRoutes).toHaveLength(1);
    expect(variant.machinery.clearanceSatisfied).toBe(true);

    const loop = variant.machinery.perimeterLoops[0];
    expect(loop.closed).toBe(true);
    expect(loop.lengthM).toBeGreaterThan(100);
    expect(haversineM(loop.points[0], loop.points[loop.points.length - 1])).toBeLessThan(0.01);
    for (const point of loop.points.slice(0, -1)) {
      expect(siteContainsCoordinate(site, point)).toBe(true);
      expect(distanceToSiteBoundaryM(site, point)).toBeGreaterThanOrEqual(loop.widthM / 2 - 0.3);
    }

    const route = variant.machinery.manoeuvreRoutes[0];
    expect(route.closed).toBe(false);
    expect(route.lengthM).toBeGreaterThan(loop.widthM);
    expect(route.connectedCorridorIds).toEqual(variant.machinery.corridors.map((corridor) => corridor.id));
    expect(route.clearanceSatisfied).toBe(true);
    expect(distanceToRouteM(route.points[0], loop.points)).toBeLessThan(0.05);
    expect(distanceToRouteM(route.points[route.points.length - 1], loop.points)).toBeLessThan(0.05);

    for (const tree of variant.trees) {
      expect(distanceToSiteBoundaryM(site, tree.coordinate)).toBeGreaterThanOrEqual(variant.machinery.requiredCorridorWidthM - 0.05);
    }
  });
});

function distanceToRouteM(point: { lat: number; lng: number }, route: Array<{ lat: number; lng: number }>) {
  const projection = createLocalProjection(polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon));
  const target = projection.project(point);
  return Math.min(...route.slice(0, -1).map((candidate, index) => {
    const start = projection.project(candidate);
    const end = projection.project(route[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared));
    return Math.hypot(target.x - (start.x + dx * ratio), target.y - (start.y + dy * ratio));
  }));
}
