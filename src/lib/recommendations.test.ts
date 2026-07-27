import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES, DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import type { DesignObjectives, SiteProfile } from '../types';
import { DEFAULT_DESIGN_OBJECTIVES } from './objectives';
import { rankSpecies, recommendedPalette, suitabilityWeights } from './recommendations';

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

describe('objective-driven species suitability', () => {
  it('hard-blocks jurisdictionally excluded species regardless of objectives', () => {
    const blockedSpecies = DESIGN_SPECIES_BY_ID.get('acacia-saligna')!;
    const [recommendation] = rankSpecies([blockedSpecies], fieldProfile(), {
      production: 100, biodiversity: 100, nativeHabitat: 0, waterResilience: 100, lowMaintenance: 100,
    });

    expect(recommendation.status).toBe('blocked');
    expect(recommendation.score).toBe(0);
    expect(recommendation.components).toEqual([expect.objectContaining({ key: 'safety', status: 'blocked' })]);
  });

  it('never reports recommended when the critical field pH is unknown', () => {
    const olive = DESIGN_SPECIES_BY_ID.get('olea-europaea')!;
    const [recommendation] = rankSpecies([olive], fieldProfile(null), DEFAULT_DESIGN_OBJECTIVES);

    expect(recommendation.score).toBeGreaterThanOrEqual(70);
    expect(recommendation.status).toBe('conditional');
    expect(recommendation.components).toContainEqual(expect.objectContaining({ key: 'soil', status: 'unknown' }));
    expect(recommendation.mitigations.join(' ')).toContain('field test');
  });

  it('changes normalized component weights with declared priorities and stays deterministic', () => {
    const production: DesignObjectives = { production: 100, biodiversity: 10, nativeHabitat: 0, waterResilience: 30, lowMaintenance: 20 };
    const habitat: DesignObjectives = { production: 0, biodiversity: 95, nativeHabitat: 100, waterResilience: 30, lowMaintenance: 20 };
    const productionWeights = suitabilityWeights(production);
    const habitatWeights = suitabilityWeights(habitat);

    expect(productionWeights.purpose).toBeGreaterThan(habitatWeights.purpose);
    expect(habitatWeights.native).toBeGreaterThan(productionWeights.native);
    expect(Object.values(habitatWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);

    const first = rankSpecies(DESIGN_SPECIES, fieldProfile(), habitat).map((item) => `${item.species.id}:${item.score}:${item.status}`);
    const second = rankSpecies(DESIGN_SPECIES, fieldProfile(), habitat).map((item) => `${item.species.id}:${item.score}:${item.status}`);
    expect(second).toEqual(first);
  });

  it('caps monitored introduced species at conditional and exposes the containment note', () => {
    const mulberry = DESIGN_SPECIES_BY_ID.get('morus-alba')!;
    const [recommendation] = rankSpecies([mulberry], fieldProfile(), { production: 100, biodiversity: 20, nativeHabitat: 0, waterResilience: 100, lowMaintenance: 50 });

    expect(recommendation.status).not.toBe('recommended');
    expect(recommendation.mitigations[0]).toContain('monitor spread');
  });

  it('does not let drought tolerance mask rainfall below the supported envelope', () => {
    const holmOak = DESIGN_SPECIES_BY_ID.get('quercus-ilex')!;
    const desertProfile = {
      ...fieldProfile(7.5),
      location: { countryCode: 'DZ', displayName: 'Sahara test field' },
      climate: {
        ...fieldProfile().climate,
        absoluteMinTemperatureC: 5,
        absoluteMaxTemperatureC: 46,
        annualPrecipitationMm: 50,
        annualEt0Mm: 2200,
      },
    } as SiteProfile;
    const [recommendation] = rankSpecies([holmOak], desertProfile, DEFAULT_DESIGN_OBJECTIVES);

    expect(recommendation.components).toContainEqual(expect.objectContaining({
      key: 'water',
      score: 33,
      status: 'poor',
    }));
    expect(recommendation.status).toBe('poor');
    expect(recommendedPalette([recommendation])).toEqual([]);
  });
});
