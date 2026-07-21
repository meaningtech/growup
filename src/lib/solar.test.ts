import { describe, expect, it } from 'vitest';
import type { DesignConfiguration, SiteProfile } from '../types';
import { DEFAULT_DESIGN_OBJECTIVES } from './objectives';
import { assessSolarOrientation, solarPositionNoaa } from './solar';

const design: DesignConfiguration = {
  system: 'alley-cropping', extent: 'full-field', perimeterBandM: 8, cropAlleyWidthM: 14,
  windbreakRows: 2, orientationObjective: 'solar-crop', customBearingDegrees: 0,
  analysisYear: 10, monocultureSpeciesId: null, seed: 41, objectives: DEFAULT_DESIGN_OBJECTIVES,
};

describe('solar geometry and orientation assessment', () => {
  it('places the July midday sun high and south of Ragusa', () => {
    const position = solarPositionNoaa(new Date('2024-07-15T11:00:00Z'), 36.921, 14.753);
    expect(position.elevationDegrees).toBeGreaterThan(65);
    expect(position.azimuthDegrees).toBeGreaterThan(150);
    expect(position.azimuthDegrees).toBeLessThan(210);
  });

  it('uses measured radiation climatology and reports bearing-sensitive crop access', () => {
    const profile = {
      centroid: { lat: 36.921, lng: 14.753 },
      terrain: { slopePercent: 8, aspectDegrees: 180, evidence: { confidence: 'medium' } },
      solar: {
        status: 'available', prevailingWindDirectionDegrees: 300,
        hourlyClimatology: Array.from({ length: 12 }, (_, month) => Array.from({ length: 24 }, (_, hour) => ({
          month: month + 1, hour, directNormalWm2: hour >= 7 && hour <= 17 ? 620 : 0,
          diffuseWm2: hour >= 7 && hour <= 17 ? 95 : 0, shortwaveWm2: hour >= 7 && hour <= 17 ? 520 : 0,
          windSpeedMs: 3.4, windDirectionDegrees: 300, sampleCount: 150,
        }))).flat(),
      },
    } as SiteProfile;
    const northSouth = assessSolarOrientation(profile, design, 0, { heightM: 8, crownDiameterM: 6 });
    const eastWest = assessSolarOrientation(profile, design, 90, { heightM: 8, crownDiameterM: 6 });
    expect(northSouth.status).toBe('available');
    expect(northSouth.terrainPlaneKwhM2Year).toBeGreaterThan(1000);
    expect(northSouth.cropSolarAccessPercent).not.toBe(eastWest.cropSolarAccessPercent);
    expect(northSouth.method).toContain('Open-Meteo');
  });
});
