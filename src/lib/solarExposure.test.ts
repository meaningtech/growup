import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { createLocalProjection } from './geometry';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { simulateDailyPlantExposure } from './solarExposure';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';

describe('daily plant solar exposure', () => {
  it('uses solar geometry, growth-state crowns, and hourly measured radiation', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const species = DESIGN_SPECIES.slice(0, 4);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      analysisYear: 10,
    })[0];
    const exposure = simulateDailyPlantExposure(profile, variant, species, 7, 10);
    const morning = exposure.hours.find((hour) => hour.localSolarHour === 8);
    const noon = exposure.hours.find((hour) => hour.localSolarHour === 12);

    expect(exposure.status).toBe('available');
    expect(exposure.source).toContain('Open-Meteo');
    expect(exposure.sourcePeriod).toBe('2021–2025');
    expect(noon?.elevationDegrees).toBeGreaterThan(morning?.elevationDegrees ?? 90);
    expect(morning?.plants[0].shadowLengthM).toBeGreaterThan(noon?.plants[0].shadowLengthM ?? 120);
    expect(noon?.activePlantCount).toBe(variant.trees.length);
    expect((noon?.sunlitCount ?? 0) + (noon?.shadedCount ?? 0)).toBe(noon?.activePlantCount);
    expect(noon?.plants.every((plant) => plant.shadowPolygon.length === 4)).toBe(true);
  });

  it('reports nighttime without inventing exposure', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const species = DESIGN_SPECIES.slice(0, 4);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species)[0];
    const exposure = simulateDailyPlantExposure(profile, variant, species, 1, 10);
    const early = exposure.hours.find((hour) => hour.localSolarHour === 5);

    expect(early?.estimatedHorizontalWm2).toBe(0);
    expect(early?.plants.every((plant) => plant.status === 'night' && plant.exposurePercent === 0)).toBe(true);
    expect(early?.sunlitCount).toBe(0);
    expect(early?.shadedCount).toBe(0);
  });

  it('identifies a plant intercepted by another mapped crown shadow', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const species = [DESIGN_SPECIES[0]];
    const generated = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      system: 'monoculture',
      monocultureSpeciesId: species[0].id,
    })[0];
    const projection = createLocalProjection(profile.centroid);
    const variant = {
      ...generated,
      trees: [
        { id: 'caster', speciesId: species[0].id, coordinate: profile.centroid, rowIndex: 0, positionIndex: 0, plantedYear: 0, removedYear: null, locked: false, seed: 1 },
        { id: 'target', speciesId: species[0].id, coordinate: projection.unproject({ x: 0, y: 4 }), rowIndex: 0, positionIndex: 1, plantedYear: 0, removedYear: null, locked: false, seed: 2 },
      ],
    };
    const noon = simulateDailyPlantExposure(profile, variant, species, 7, 20).hours.find((hour) => hour.localSolarHour === 12);
    const target = noon?.plants.find((plant) => plant.treeId === 'target');

    expect(target?.status).toBe('shaded');
    expect(target?.shadedByTreeIds).toContain('caster');
    expect(target?.exposurePercent).toBeGreaterThan(0);
    expect(target?.exposurePercent).toBeLessThan(100);
  });

  it('remains explicitly unavailable when the provider climatology is missing', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    profile.solar.status = 'unavailable';
    profile.solar.hourlyClimatology = [];
    const species = DESIGN_SPECIES.slice(0, 4);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE), species)[0];

    expect(simulateDailyPlantExposure(profile, variant, species, 7, 10)).toMatchObject({
      status: 'unavailable',
      hours: [],
      confidence: 'medium',
    });
  });
});
