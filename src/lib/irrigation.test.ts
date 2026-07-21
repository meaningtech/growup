import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { createLocalProjection, pointInPolygon, polygonCentroid } from './geometry';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { calculateIrrigation, millimetresToCubicMetres, normalizeIrrigationConfiguration, routePolyline } from './irrigation';

describe('irrigation geometry', () => {
  it('routes a pipe around a protected polygon', () => {
    const projection = createLocalProjection(polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon));
    const obstacle = [
      projection.unproject({ x: -6, y: -9 }),
      projection.unproject({ x: 6, y: -9 }),
      projection.unproject({ x: 6, y: 9 }),
      projection.unproject({ x: -6, y: 9 }),
    ];
    const boundary = { ...TEMPERATE_OPEN_FIELD_FIXTURE, exclusions: [obstacle] };
    const routed = routePolyline([
      projection.unproject({ x: -32, y: 0 }),
      projection.unproject({ x: 32, y: 0 }),
    ], [obstacle], boundary);

    expect(routed.routed).toBe(true);
    expect(routed.points.length).toBeGreaterThan(2);
    const localObstacle = obstacle.map(projection.project);
    for (let index = 1; index < routed.points.length; index += 1) {
      const start = projection.project(routed.points[index - 1]);
      const end = projection.project(routed.points[index]);
      expect(pointInPolygon({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, localObstacle)).toBe(false);
    }
  });

  it('keeps valid editable line vertices and rejects malformed overrides', () => {
    const configuration = normalizeIrrigationConfiguration({
      lineOverrides: {
        'main-zone-1': [{ lat: 37, lng: 15 }, { lat: 37.0001, lng: 15.0001 }, { lat: 37.0002, lng: 15.0002 }],
        malformed: [{ lat: Number.NaN, lng: 15 }, { lat: 37, lng: 15 }],
      },
    });

    expect(configuration.lineOverrides['main-zone-1']).toHaveLength(3);
    expect(configuration.lineOverrides.malformed).toBeUndefined();
  });

  it('keeps unit conversion exact and never increases gross demand when efficiency improves', () => {
    expect(millimetresToCubicMetres(1, 1)).toBe(0.001);
    const species = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: false },
    })[0];
    const lowerEfficiency = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, { distributionEfficiencyPercent: 70 });
    const higherEfficiency = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, { distributionEfficiencyPercent: 95 });
    expect(higherEfficiency.annualNetMm).toBe(lowerEfficiency.annualNetMm);
    expect(higherEfficiency.annualWaterM3).toBeLessThan(lowerEfficiency.annualWaterM3);
    expect(higherEfficiency.annualGrossMm).toBeLessThan(lowerEfficiency.annualGrossMm);
  });

  it('places the automatic water source at the exact highest sample even when elevations are nearly tied', () => {
    const species = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const highestCoordinate = polygonCentroid(TEMPERATE_OPEN_FIELD_FIXTURE.polygon);
    profile.terrain.samples = [
      { ...highestCoordinate, elevationM: 126.05 },
      { ...TEMPERATE_OPEN_FIELD_FIXTURE.polygon[0], elevationM: 126.04 },
      ...TEMPERATE_OPEN_FIELD_FIXTURE.polygon.slice(1).map((coordinate, index) => ({ ...coordinate, elevationM: 125 - index })),
    ];
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: false },
    })[0];
    const irrigation = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5);

    expect(irrigation.network.source.placement).toBe('highest-terrain-sample');
    expect(irrigation.network.source.coordinate).toEqual(highestCoordinate);
    expect(irrigation.network.source.elevationM).toBe(126.05);
  });
});
