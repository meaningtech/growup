import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';

const species = ['olea-europaea', 'prunus-dulcis', 'tamarix-gallica'].map((id) => DESIGN_SPECIES_BY_ID.get(id)!);

describe('layout species targets and succession overrides', () => {
  it('uses target percentages for placement and the manual phase for timing and composition', () => {
    const variant = generateLayoutVariants(
      TEMPERATE_OPEN_FIELD_FIXTURE,
      openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE),
      species,
      {
        ...DEFAULT_DESIGN_CONFIGURATION,
        speciesMix: {
          'olea-europaea': { targetPercent: 50, successionOverride: 'placenta' },
          'prunus-dulcis': { targetPercent: 30, successionOverride: null },
          'tamarix-gallica': { targetPercent: 20, successionOverride: null },
        },
      },
    )[0];

    const counts = Object.fromEntries(species.map((item) => [
      item.id,
      variant.trees.filter((tree) => tree.speciesId === item.id).length,
    ]));
    const percentages = Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / variant.trees.length * 100]));
    expect(percentages['olea-europaea']).toBeCloseTo(50, -1);
    expect(percentages['prunus-dulcis']).toBeCloseTo(30, -1);
    expect(percentages['tamarix-gallica']).toBeCloseTo(20, -1);

    const oliveTrees = variant.trees.filter((tree) => tree.speciesId === 'olea-europaea');
    expect(oliveTrees.length).toBeGreaterThan(0);
    expect(oliveTrees.every((tree) => tree.plantedYear === 0)).toBe(true);
    expect(variant.composition.bySuccession.placenta).toBe(counts['olea-europaea'] + counts['tamarix-gallica']);
    expect(variant.generation.assumptions).toContainEqual(expect.objectContaining({
      label: 'Species targets',
      value: expect.stringContaining('olea-europaea 50.0% (placenta)'),
    }));
  });
});
