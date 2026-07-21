import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { EQUATORIAL_OPEN_FIELD_FIXTURE, TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import type { SiteBoundary } from '../types';
import { createLocalProjection, pointInPolygon } from './geometry';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants, regenerateLayoutVariant } from './layout';
import { distanceToSiteBoundaryM, distanceToSitePathM, siteContainsCoordinate } from './siteGeometry';

const palette = DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked').slice(0, 9);

describe('layout generation properties', () => {
  it('is reproducible and keeps every generated tree plantable across fields and seeds', () => {
    const cases = [TEMPERATE_OPEN_FIELD_FIXTURE, EQUATORIAL_OPEN_FIELD_FIXTURE, ...[13, 29, 71].map(randomField)];
    for (const [caseIndex, site] of cases.entries()) {
      const profile = openFieldProfile(site);
      const seed = [7, 41, 2_026, 99_991, 8_675_309][caseIndex];
      const configuration = {
        ...DEFAULT_DESIGN_CONFIGURATION,
        seed,
        machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: false },
      };
      const first = generateLayoutVariants(site, profile, palette, configuration);
      const second = generateLayoutVariants(site, profile, palette, configuration);
      expect(second).toEqual(first);
      const projection = createLocalProjection(profile.centroid);
      const exclusions = site.exclusions.map((polygon) => polygon.map(projection.project));
      for (const variant of first) {
        expect(new Set(variant.trees.map((tree) => tree.id)).size).toBe(variant.trees.length);
        expect(variant.generation).toEqual(expect.objectContaining({ mode: 'full', seed }));
        for (const tree of variant.trees) {
          expect(siteContainsCoordinate(site, tree.coordinate)).toBe(true);
          expect(distanceToSiteBoundaryM(site, tree.coordinate)).toBeGreaterThanOrEqual(site.setbackM - 0.05);
          expect(exclusions.some((polygon) => pointInPolygon(projection.project(tree.coordinate), polygon))).toBe(false);
          expect(site.paths.every((path) => distanceToSitePathM(tree.coordinate, path) >= path.widthM / 2 - 0.05)).toBe(true);
        }
      }
    }
  });

  it('preserves any valid locked subset during deterministic partial regeneration', () => {
    const site = TEMPERATE_OPEN_FIELD_FIXTURE;
    const profile = openFieldProfile(site);
    const full = generateLayoutVariants(site, profile, palette, DEFAULT_DESIGN_CONFIGURATION)[0];
    const lockedIds = new Set(full.trees.filter((_, index) => index % 11 === 0).slice(0, 5).map((tree) => tree.id));
    const previous = {
      ...full,
      trees: full.trees.map((tree) => ({ ...tree, locked: lockedIds.has(tree.id) })),
    };
    const regenerated = regenerateLayoutVariant(site, profile, palette, previous, previous.design);
    const repeated = regenerateLayoutVariant(site, profile, palette, previous, previous.design);
    expect(repeated).toEqual(regenerated);
    expect(regenerated.generation).toEqual(expect.objectContaining({ mode: 'partial', lockedTreeCount: lockedIds.size }));
    for (const locked of previous.trees.filter((tree) => tree.locked)) {
      expect(regenerated.trees.find((tree) => tree.id === locked.id)).toEqual(locked);
    }
  });
});

function randomField(seed: number): SiteBoundary {
  const centre = { lat: 8 + seed / 100, lng: 22 + seed / 200 };
  const projection = createLocalProjection(centre);
  const halfWidth = 31 + seed % 8;
  const halfHeight = 22 + seed % 6;
  const jitter = (salt: number) => ((Math.sin(seed * salt) + 1) / 2 - 0.5) * 5;
  const polygon = [
    projection.unproject({ x: -halfWidth + jitter(1), y: -halfHeight + jitter(2) }),
    projection.unproject({ x: halfWidth + jitter(3), y: -halfHeight + jitter(4) }),
    projection.unproject({ x: halfWidth + jitter(5), y: halfHeight + jitter(6) }),
    projection.unproject({ x: -halfWidth + jitter(7), y: halfHeight + jitter(8) }),
  ];
  const exclusion = [
    projection.unproject({ x: -4, y: -4 }),
    projection.unproject({ x: 5, y: -4 }),
    projection.unproject({ x: 5, y: 5 }),
    projection.unproject({ x: -4, y: 5 }),
  ];
  return {
    id: `property-field-${seed}`,
    name: `Property field ${seed}`,
    polygon,
    additionalPolygons: [],
    holes: [],
    exclusions: [exclusion],
    paths: [{
      id: `property-path-${seed}`,
      name: 'Property path',
      points: [projection.unproject({ x: -halfWidth, y: 12 }), projection.unproject({ x: halfWidth, y: 12 })],
      widthM: 3,
    }],
    accessPoints: [],
    waterPoints: [],
    existingTrees: [],
    setbackM: 1.5,
  };
}
