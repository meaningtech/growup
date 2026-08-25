import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES, DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import type { DesignObjectives, SiteProfile } from '../types';
import { DEFAULT_DESIGN_OBJECTIVES } from './objectives';
import { rankSpecies } from './recommendations';
import { eligibleSpeciesForSystem, recommendedPalette } from './systemPalette';

function fieldProfile(ph: number | null = 7.2): SiteProfile {
  return {
    location: { countryCode: 'XZ', displayName: 'Test field jurisdiction' },
    climate: {
      absoluteMinTemperatureC: -2.2,
      absoluteMaxTemperatureC: 43.8,
      annualPrecipitationMm: 589,
      annualEt0Mm: 1307,
    },
    soil: { ph },
  } as SiteProfile;
}

describe('system-aware automatic palettes', () => {
  const ranked = rankSpecies(DESIGN_SPECIES, fieldProfile(), DEFAULT_DESIGN_OBJECTIVES);

  it('keeps a stratified syntropic mix as the default nine', () => {
    const palette = recommendedPalette(ranked, 'syntropic');
    expect(palette).toHaveLength(9);
    expect(new Set(palette.map((item) => item.species.stratum)).size).toBeGreaterThanOrEqual(3);
    expect(palette.every((item) => item.status === 'recommended' || item.status === 'conditional')).toBe(true);
    expect(palette.some((item) => item.components.some((component) => (
      (component.key === 'climate' || component.key === 'water') && component.status === 'poor'
    )))).toBe(false);
  });

  it('proposes productive trees for mixed orchard and a single crop for monoculture', () => {
    const orchard = recommendedPalette(ranked, 'mixed-orchard');
    const monoculture = recommendedPalette(ranked, 'monoculture');
    expect(orchard.length).toBeGreaterThanOrEqual(2);
    expect(orchard.length).toBeLessThanOrEqual(5);
    expect(orchard.every((item) => item.species.treeLike && item.species.productiveFromYear !== null)).toBe(true);
    expect(monoculture).toHaveLength(1);
    expect(monoculture[0].species.treeLike).toBe(true);
    expect(monoculture[0].species.productiveFromYear).not.toBeNull();
  });

  it('changes the proposed plants when the planting system changes', () => {
    const syntropic = recommendedPalette(ranked, 'syntropic').map((item) => item.species.id);
    const orchard = recommendedPalette(ranked, 'mixed-orchard').map((item) => item.species.id);
    const windbreak = recommendedPalette(ranked, 'windbreak').map((item) => item.species.id);
    const alley = recommendedPalette(ranked, 'alley-cropping').map((item) => item.species.id);
    expect(orchard).not.toEqual(syntropic);
    expect(orchard).toHaveLength(5);
    expect(windbreak.length).toBeGreaterThanOrEqual(2);
    expect(windbreak.length).toBeLessThanOrEqual(4);
    expect(windbreak.every((id) => DESIGN_SPECIES_BY_ID.get(id)?.treeLike)).toBe(true);
    expect(alley.every((id) => {
      const species = DESIGN_SPECIES_BY_ID.get(id);
      return Boolean(species && (species.treeLike || species.stratum === 'low'));
    })).toBe(true);
    expect(recommendedPalette(ranked).map((item) => item.species.id)).toEqual(syntropic);
  });

  it('rebuilds syntropic membership when production dominates biodiversity', () => {
    const production: DesignObjectives = { production: 100, biodiversity: 0, nativeHabitat: 0, waterResilience: 20, lowMaintenance: 10 };
    const habitat: DesignObjectives = { production: 0, biodiversity: 100, nativeHabitat: 100, waterResilience: 20, lowMaintenance: 10 };
    const productionIds = recommendedPalette(rankSpecies(DESIGN_SPECIES, fieldProfile(), production), 'syntropic', undefined, production).map((item) => item.species.id);
    const habitatIds = recommendedPalette(rankSpecies(DESIGN_SPECIES, fieldProfile(), habitat), 'syntropic', undefined, habitat).map((item) => item.species.id);
    expect(productionIds).toHaveLength(9);
    expect(habitatIds).toHaveLength(9);
    expect(productionIds).not.toEqual(habitatIds);
    const productiveCount = (ids: string[]) => ids.filter((id) => DESIGN_SPECIES_BY_ID.get(id)?.productiveFromYear !== null).length;
    expect(productiveCount(productionIds)).toBeGreaterThan(productiveCount(habitatIds));
  });

  it('keeps an explicit grape monoculture even though it is not tree-like', () => {
    const grape = DESIGN_SPECIES_BY_ID.get('vitis-vinifera')!;
    expect(grape.treeLike).toBe(false);
    expect(eligibleSpeciesForSystem([grape], 'monoculture').map((item) => item.id)).toEqual(['vitis-vinifera']);
  });
});
