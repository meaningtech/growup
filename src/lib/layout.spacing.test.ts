import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import {
  DEFAULT_DESIGN_CONFIGURATION,
  MAX_PLANTING_DISTANCE_M,
  MIN_PLANTING_DISTANCE_M,
  designSpacingDefaults,
  generateLayoutVariants,
  normalizeDesignConfiguration,
} from './layout';
import type { DesignConfiguration, DesignSpecies } from '../types';

const site = TEMPERATE_OPEN_FIELD_FIXTURE;
const profile = openFieldProfile(site);
const palette: DesignSpecies[] = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);
const olive = palette[0];

function monoculture(overrides: Partial<DesignConfiguration> = {}): DesignConfiguration {
  return {
    ...DEFAULT_DESIGN_CONFIGURATION,
    system: 'monoculture',
    monocultureSpeciesId: olive.id,
    ...overrides,
  };
}

describe('free planting distances', () => {
  it('generates exactly the requested grid for every design system', () => {
    for (const system of ['syntropic', 'monoculture', 'mixed-orchard', 'alley-cropping', 'windbreak', 'boundary-buffer'] as const) {
      const variant = generateLayoutVariants(site, profile, palette, {
        ...DEFAULT_DESIGN_CONFIGURATION,
        system,
        machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: false },
        rowSpacingM: 9,
        plantSpacingM: 4,
      })[0];
      expect(variant.rowSpacingM, system).toBe(9);
      expect(variant.treeSpacingM, system).toBe(4);
      expect(variant.design.rowSpacingM, system).toBe(9);
      expect(variant.design.plantSpacingM, system).toBe(4);
    }
  });

  it('plants the 6 x 3 metres a grower asks for instead of the derived monoculture square', () => {
    const derived = generateLayoutVariants(site, profile, [olive], monoculture())[0];
    const requested = generateLayoutVariants(site, profile, [olive], monoculture({ rowSpacingM: 6, plantSpacingM: 3 }))[0];

    expect(derived.rowSpacingM).toBe(derived.treeSpacingM);
    expect(requested.rowSpacingM).toBe(6);
    expect(requested.treeSpacingM).toBe(3);
    expect(requested.trees.length).toBeGreaterThan(derived.trees.length);
  });

  it('keeps the machinery corridor as an inderogable minimum on the row spacing', () => {
    const machinery = {
      ...DEFAULT_DESIGN_CONFIGURATION.machinery,
      enabled: true,
      presetId: 'new-holland-t4f' as const,
      widthM: 2.4,
      implementWidthM: 2.5,
      safetyClearanceM: 0.6,
      lengthM: 4.03,
      turningRadiusM: 4,
    };
    const tight = generateLayoutVariants(site, profile, palette, { ...monoculture({ rowSpacingM: 2, plantSpacingM: 3 }), machinery })[0];
    const wide = generateLayoutVariants(site, profile, palette, { ...monoculture({ rowSpacingM: 12, plantSpacingM: 3 }), machinery })[0];

    expect(tight.machinery.requiredCorridorWidthM).toBe(3.7);
    expect(tight.machinery.clearanceSatisfied).toBe(true);
    expect(tight.rowSpacingM).toBe(tight.machinery.requiredCorridorWidthM);
    expect(wide.rowSpacingM).toBe(12);
    expect(tight.treeSpacingM).toBe(3);
  });

  it('leaves the derived spacing untouched when no distance is set', () => {
    const variant = generateLayoutVariants(site, profile, palette, DEFAULT_DESIGN_CONFIGURATION)[0];
    expect(variant.rowSpacingM).toBe(designSpacingDefaults(palette, DEFAULT_DESIGN_CONFIGURATION)?.rowSpacingM);
    expect(variant.treeSpacingM).toBe(designSpacingDefaults(palette, DEFAULT_DESIGN_CONFIGURATION)?.treeSpacingM);
    expect(variant.design.rowSpacingM).toBeNull();
    expect(variant.design.plantSpacingM).toBeNull();
  });

  it('defaults to the monoculture crop spacing, not to the whole palette', () => {
    const defaults = designSpacingDefaults(palette, monoculture({ rowSpacingM: 6 }));
    const single = designSpacingDefaults([olive], monoculture());

    expect(defaults).toEqual(single);
  });

  it('normalizes out-of-range and unusable distances', () => {
    expect(normalizeDesignConfiguration({ ...monoculture(), rowSpacingM: 0.2 }).rowSpacingM).toBe(MIN_PLANTING_DISTANCE_M);
    expect(normalizeDesignConfiguration({ ...monoculture(), plantSpacingM: 90 }).plantSpacingM).toBe(MAX_PLANTING_DISTANCE_M);
    expect(normalizeDesignConfiguration({ ...monoculture(), rowSpacingM: Number.NaN }).rowSpacingM).toBeNull();
    expect(normalizeDesignConfiguration({ ...monoculture(), plantSpacingM: null }).plantSpacingM).toBeNull();
    expect(normalizeDesignConfiguration(monoculture()).rowSpacingM).toBeNull();
  });

  it('is deterministic for the same seed and distances', () => {
    const first = generateLayoutVariants(site, profile, palette, monoculture({ rowSpacingM: 6, plantSpacingM: 3 }))[0];
    const second = generateLayoutVariants(site, profile, palette, monoculture({ rowSpacingM: 6, plantSpacingM: 3 }))[0];

    expect(second.trees).toEqual(first.trees);
    expect(second.metrics).toEqual(first.metrics);
  });
});
