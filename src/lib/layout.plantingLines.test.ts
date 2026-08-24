import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { createLocalProjection } from './geometry';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';

const species = ['olea-europaea', 'prunus-dulcis', 'tamarix-gallica'].map((id) => DESIGN_SPECIES_BY_ID.get(id)!);

describe('user-drawn planting rows', () => {
  it('places trees along drawn rows instead of the automatic field grid', () => {
    const line = [
      { lat: 36.92112, lng: 14.75318 },
      { lat: 36.92095, lng: 14.75338 },
      { lat: 36.92088, lng: 14.75328 },
    ];
    const variants = generateLayoutVariants(
      TEMPERATE_OPEN_FIELD_FIXTURE,
      openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE),
      species,
      {
        ...DEFAULT_DESIGN_CONFIGURATION,
        plantingLines: [{ id: 'row-1', points: line }],
      },
    );
    expect(variants[0].trees.length).toBeGreaterThan(0);
    expect(variants[0].warnings.some((warning) => warning.includes('user-drawn planting'))).toBe(true);
    const projection = createLocalProjection(line[0]);
    const segments = [projection.project(line[0]), projection.project(line[1]), projection.project(line[2])];
    const distances = variants[0].trees.map((tree) => {
      const point = projection.project(tree.coordinate);
      let minimum = Number.POSITIVE_INFINITY;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const start = segments[index];
        const end = segments[index + 1];
        const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared));
        const nearest = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
        minimum = Math.min(minimum, Math.hypot(point.x - nearest.x, point.y - nearest.y));
      }
      return minimum;
    });
    expect(Math.max(...distances)).toBeLessThan(8);
  });
});
