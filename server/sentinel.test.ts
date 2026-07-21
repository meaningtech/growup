import { describe, expect, it } from 'vitest';
import { protectedUnionCoverPercent, vegetationPatches, type VegetationCandidate } from './sentinel';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { createLocalProjection, polygonCentroid } from '../src/lib/geometry';

const raster = {
  bounds: [15, 37, 15.001, 37.001] as [number, number, number, number],
  width: 10,
  height: 10,
};

function candidate(index: number): VegetationCandidate {
  const x = index % raster.width;
  const y = Math.floor(index / raster.width);
  return {
    coordinate: {
      lng: raster.bounds[0] + (x + 0.5) / raster.width * (raster.bounds[2] - raster.bounds[0]),
      lat: raster.bounds[1] + (y + 0.5) / raster.height * (raster.bounds[3] - raster.bounds[1]),
    },
    currentNdvi: 0.72,
    medianNdvi: 0.68,
    persistentGreenFraction: 0.9,
    annualTreeVotes: 1,
    worldCoverTree: true,
    copernicusWoody: true,
    confidence: 'high',
    signals: ['persistent NDVI'],
  };
}

describe('Sentinel woody vegetation geometry', () => {
  it('splits large raster components into local canopy ellipses', () => {
    const indexes = [22, 23, 24, 25, 26, 27, 28];
    const patches = vegetationPatches(new Map(indexes.map((index) => [index, candidate(index)])), raster);

    expect(patches.length).toBeGreaterThan(1);
    expect(patches.every((patch) => patch.polygon.length === 24)).toBe(true);
    expect(patches.reduce((sum, patch) => sum + patch.pixelCount, 0)).toBe(indexes.length);
    expect(new Set(patches.map((patch) => patch.id)).size).toBe(patches.length);
  });

  it('does not merge diagonally touching pixels into one oversized mask', () => {
    const indexes = [22, 33, 44];
    const patches = vegetationPatches(new Map(indexes.map((index) => [index, candidate(index)])), raster);

    expect(patches).toHaveLength(3);
    expect(patches.every((patch) => patch.pixelCount === 1)).toBe(true);
  });

  it('counts overlapping protected ellipses as a spatial union', () => {
    const projection = createLocalProjection(polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon));
    const polygon = Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2;
      return projection.unproject({ x: Math.cos(angle) * 14, y: Math.sin(angle) * 10 });
    });
    const patch = { ...vegetationPatches(new Map([[22, candidate(22)]]), raster)[0], polygon };
    const single = protectedUnionCoverPercent(TEMPERATE_OPEN_FIELD_FIXTURE, [patch]);
    const overlapping = protectedUnionCoverPercent(TEMPERATE_OPEN_FIELD_FIXTURE, [patch, { ...patch, id: 'duplicate' }]);

    expect(single).toBeGreaterThan(0);
    expect(overlapping).toBe(single);
  });
});
