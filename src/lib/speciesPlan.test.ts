import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import { normalizeSpeciesMix, rebalanceSpeciesMix, resolvedSpeciesMix, synchronizeSpeciesMix } from './speciesPlan';

const species = ['olea-europaea', 'prunus-dulcis', 'spartium-junceum'].map((id) => DESIGN_SPECIES_BY_ID.get(id)!);

describe('species planning configuration', () => {
  it('keeps selected species percentages at exactly 100% while preserving manual succession', () => {
    const initial = synchronizeSpeciesMix([], species.map((item) => item.id), {});
    expect(total(initial)).toBe(100);

    const withOverride = {
      ...initial,
      'olea-europaea': { ...initial['olea-europaea'], successionOverride: 'placenta' as const },
    };
    const rebalanced = rebalanceSpeciesMix(species, withOverride, 'olea-europaea', 60);
    expect(rebalanced['olea-europaea']).toEqual({ targetPercent: 60, successionOverride: 'placenta' });
    expect(rebalanced['prunus-dulcis'].targetPercent).toBe(20);
    expect(rebalanced['spartium-junceum'].targetPercent).toBe(20);
    expect(total(rebalanced)).toBe(100);

    const reduced = synchronizeSpeciesMix(
      species.map((item) => item.id),
      ['olea-europaea', 'spartium-junceum'],
      rebalanced,
    );
    expect(reduced['olea-europaea'].successionOverride).toBe('placenta');
    expect(total(reduced)).toBe(100);
  });

  it('normalizes legacy, incomplete and invalid persisted values safely', () => {
    const normalized = normalizeSpeciesMix({
      'olea-europaea': { targetPercent: 130, successionOverride: 'climax' },
      'prunus-dulcis': { targetPercent: -20, successionOverride: 'invalid' },
      broken: 'value',
    });
    expect(normalized).toEqual({
      'olea-europaea': { targetPercent: 100, successionOverride: 'climax' },
      'prunus-dulcis': { targetPercent: 0, successionOverride: null },
    });
    expect(total(resolvedSpeciesMix(species, normalized))).toBe(100);
  });
});

function total(mix: ReturnType<typeof resolvedSpeciesMix>) {
  return Number(Object.values(mix).reduce((sum, item) => sum + item.targetPercent, 0).toFixed(1));
}
