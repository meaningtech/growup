import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import type { TreeInstance } from '../types';
import { GROWTH_MODEL_VERSION, growthState } from './growth';

const species = DESIGN_SPECIES.find((item) => item.invasiveStatus !== 'blocked')!;
const tree: TreeInstance = {
  id: 'growth-test-tree',
  speciesId: species.id,
  coordinate: { lat: 0, lng: 0 },
  rowIndex: 0,
  positionIndex: 0,
  plantedYear: 2,
  removedYear: 18,
  locked: false,
  seed: 41,
};

describe('growth model', () => {
  it('returns deterministic species-parameterized low, base and high estimates', () => {
    const state = growthState(species, tree, 10);
    expect(state).toEqual(growthState(species, tree, 10));
    expect(state.active).toBe(true);
    expect(state.uncertainty.heightLowM).toBeLessThan(state.heightM);
    expect(state.uncertainty.heightHighM).toBeGreaterThan(state.heightM);
    expect(state.uncertainty.crownDiameterLowM).toBeLessThan(state.crownDiameterM);
    expect(state.uncertainty.crownDiameterHighM).toBeGreaterThan(state.crownDiameterM);
    expect(state.model).toEqual(expect.objectContaining({
      version: GROWTH_MODEL_VERSION,
      level: 'species-parameterized',
      confidence: 'medium',
    }));
    expect(new Set(state.model.sourceLabels).size).toBe(state.model.sourceLabels.length);
  });

  it('reports zero growth outside the individual active interval', () => {
    for (const year of [0, 1, 18, 25]) {
      const state = growthState(species, tree, year);
      expect(state.active).toBe(false);
      expect(state.heightM).toBe(0);
      expect(state.crownDiameterM).toBe(0);
      expect(state.uncertainty).toEqual({
        heightLowM: 0,
        heightHighM: 0,
        crownDiameterLowM: 0,
        crownDiameterHighM: 0,
      });
    }
  });

  it('applies the deterministic three-year biomass pruning event to placenta species', () => {
    const biomassSpecies = DESIGN_SPECIES.find((item) => item.succession === 'placenta' && item.roles.includes('biomass'))!;
    const biomassTree = { ...tree, speciesId: biomassSpecies.id, plantedYear: 0, removedYear: null };
    const beforeEvent = growthState(biomassSpecies, biomassTree, 5);
    const eventYear = growthState(biomassSpecies, biomassTree, 6);
    expect(eventYear.heightM).toBeGreaterThan(beforeEvent.heightM);
    expect(eventYear.crownDiameterM).toBeLessThan(beforeEvent.crownDiameterM);
  });
});
