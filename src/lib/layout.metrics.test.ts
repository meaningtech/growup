import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants, recalculateLayoutMetrics } from './layout';

const species = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);

describe('layout density metrics', () => {
  it('reports the net calculation area and keeps density synchronized after manual tree edits', () => {
    const site = TEMPERATE_OPEN_FIELD_FIXTURE;
    const profile = openFieldProfile(site);
    const variant = generateLayoutVariants(site, profile, species, DEFAULT_DESIGN_CONFIGURATION)[0];

    expect(variant.metrics.densityBasisAreaM2).toBeGreaterThan(0);
    expect(variant.metrics.treesPerHectare).toBe(Math.round(
      variant.metrics.totalTrees / (variant.metrics.densityBasisAreaM2 / 10_000),
    ));

    const retainedTrees = variant.trees.slice(0, Math.ceil(variant.trees.length / 2));
    const updated = recalculateLayoutMetrics(site, profile, species, variant, retainedTrees);

    expect(updated.totalTrees).toBe(retainedTrees.length);
    expect(updated.speciesCount).toBe(new Set(retainedTrees.map((tree) => tree.speciesId)).size);
    expect(updated.densityBasisAreaM2).toBe(variant.metrics.densityBasisAreaM2);
    expect(updated.treesPerHectare).toBe(Math.round(
      retainedTrees.length / (updated.densityBasisAreaM2 / 10_000),
    ));
    expect(updated.treesPerHectare).toBeLessThan(variant.metrics.treesPerHectare);
  });
});
