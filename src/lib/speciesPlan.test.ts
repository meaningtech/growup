import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import { DEFAULT_DESIGN_OBJECTIVES } from './objectives';
import { normalizeSpeciesMix, rebalanceSpeciesMix, resolvedSpeciesMix, speciesMixFromObjectives, synchronizeSpeciesMix } from './speciesPlan';

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
    expect(rebalanced['olea-europaea']).toEqual({ targetPercent: 60, successionOverride: 'placenta', spacingOverrideM: null });
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
      'olea-europaea': { targetPercent: 100, successionOverride: 'climax', spacingOverrideM: null },
      'prunus-dulcis': { targetPercent: 0, successionOverride: null, spacingOverrideM: null },
    });
    expect(total(resolvedSpeciesMix(species, normalized))).toBe(100);
  });

  it('raises productive shares when production is the declared priority', () => {
    const production = speciesMixFromObjectives(species, { production: 100, biodiversity: 10, nativeHabitat: 0, waterResilience: 20, lowMaintenance: 10 });
    const habitat = speciesMixFromObjectives(species, { production: 10, biodiversity: 100, nativeHabitat: 100, waterResilience: 20, lowMaintenance: 10 });
    expect(total(production)).toBe(100);
    expect(total(habitat)).toBe(100);
    expect(production['prunus-dulcis'].targetPercent).toBeGreaterThan(habitat['prunus-dulcis'].targetPercent);
    expect(habitat['spartium-junceum'].targetPercent).toBeGreaterThan(production['spartium-junceum'].targetPercent);
    expect(production).not.toEqual(speciesMixFromObjectives(species, DEFAULT_DESIGN_OBJECTIVES));
  });

  it('keeps a manual planting distance when rebalancing shares', () => {
    const withSpacing = synchronizeSpeciesMix([], species.map((item) => item.id), {
      'olea-europaea': { targetPercent: 40, successionOverride: null, spacingOverrideM: 8 },
    });
    expect(withSpacing['olea-europaea'].spacingOverrideM).toBe(8);
    const rebalanced = rebalanceSpeciesMix(species, withSpacing, 'prunus-dulcis', 50);
    expect(rebalanced['olea-europaea'].spacingOverrideM).toBe(8);
  });
});

function total(mix: ReturnType<typeof resolvedSpeciesMix>) {
  return Number(Object.values(mix).reduce((sum, item) => sum + item.targetPercent, 0).toFixed(1));
}
