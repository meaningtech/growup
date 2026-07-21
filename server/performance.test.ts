import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../src/data/designSpecies';
import { growthState } from '../src/lib/growth';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from '../src/lib/layout';
import type { TreeInstance } from '../src/types';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { openFieldProfile } from '../test/fixtures/siteProfile';
import { catalogueStats, searchCatalogue } from './catalog';

describe('production performance gates', () => {
  it('resolves 100k tree-year states within the interactive calculation budget', () => {
    const species = DESIGN_SPECIES.find((item) => item.invasiveStatus !== 'blocked')!;
    const tree: TreeInstance = {
      id: 'performance-tree', speciesId: species.id, coordinate: { lat: 0, lng: 0 }, rowIndex: 0,
      positionIndex: 0, plantedYear: 0, removedYear: null, locked: false, seed: 41,
    };
    const startedAt = performance.now();
    let checksum = 0;
    for (let index = 0; index < 100_000; index += 1) checksum += growthState(species, tree, index % 31).crownDiameterM;
    const elapsedMs = performance.now() - startedAt;
    expect(checksum).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(2_500);
  });

  it('loads the global catalogue and generates three field variants within server budgets', () => {
    const catalogueStartedAt = performance.now();
    const stats = catalogueStats();
    for (const query of ['olea', 'quercus', 'acacia', 'ficus', 'moringa']) {
      expect(searchCatalogue({ query, treeOnly: true, limit: 30 }).results.length).toBeGreaterThan(0);
    }
    const catalogueElapsedMs = performance.now() - catalogueStartedAt;
    expect(stats.total).toBeGreaterThan(100_000);
    expect(catalogueElapsedMs).toBeLessThan(3_500);

    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const palette = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);
    const layoutStartedAt = performance.now();
    const variants = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, palette, DEFAULT_DESIGN_CONFIGURATION);
    const layoutElapsedMs = performance.now() - layoutStartedAt;
    expect(variants).toHaveLength(3);
    expect(layoutElapsedMs).toBeLessThan(3_500);
  });
});
