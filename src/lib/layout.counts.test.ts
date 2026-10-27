import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import type { DesignConfiguration } from '../types';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants, normalizeDesignConfiguration, regenerateLayoutVariant } from './layout';
import { normalizeSpeciesCounts } from './speciesPlan';
import { siteContainsCoordinate } from './siteGeometry';
import { haversineM } from './geometry';

const site = TEMPERATE_OPEN_FIELD_FIXTURE;
const profile = openFieldProfile(site);
const species = ['morus-nigra', 'prunus-persica', 'prunus-dulcis'].map((id) => DESIGN_SPECIES_BY_ID.get(id)!);
const counts = { 'morus-nigra': 10, 'prunus-persica': 5, 'prunus-dulcis': 20 };
const design: DesignConfiguration = {
  ...DEFAULT_DESIGN_CONFIGURATION,
  system: 'mixed-orchard',
  speciesQuantityMode: 'count',
  speciesCounts: counts,
  orientationObjective: 'custom',
  customBearingDegrees: 35,
};

function actualCounts(trees: { speciesId: string }[]) {
  return Object.fromEntries(species.map((item) => [item.id, trees.filter((tree) => tree.speciesId === item.id).length]));
}

describe('explicit species plant quantities', () => {
  it('places exactly 10 mulberries, 5 peaches and 20 almonds deterministically', () => {
    const variants = generateLayoutVariants(site, profile, species, design);
    expect(variants).toEqual(generateLayoutVariants(site, profile, species, design));
    expect(variants[0].directionDegrees).toBe(35);
    for (const variant of variants) {
      expect(actualCounts(variant.trees)).toEqual(counts);
      expect(variant.metrics.totalTrees).toBe(35);
      expect(variant.trees.every((tree) => siteContainsCoordinate(site, tree.coordinate))).toBe(true);
      expect(variant.generation.assumptions).toContainEqual(expect.objectContaining({
        label: 'Species targets', value: expect.stringContaining('morus-nigra 10 plants'),
      }));
    }
  });

  it('excludes zero and missing quantities, and reports shortfalls without adding substitutes', () => {
    const requested = { 'morus-nigra': 100_000, 'prunus-persica': 0 };
    const variants = generateLayoutVariants(site, profile, species, { ...design, speciesCounts: requested });
    for (const variant of variants) {
      expect(variant.trees.length).toBeGreaterThan(0);
      expect(variant.trees.length).toBeLessThan(100_000);
      expect(new Set(variant.trees.map((tree) => tree.speciesId))).toEqual(new Set(['morus-nigra']));
      expect(variant.warnings).toContain(`Morus nigra: placed ${variant.trees.length} of 100000 requested plants; spacing and hard site constraints take precedence.`);
    }
    expect(() => generateLayoutVariants(site, profile, species, { ...design, speciesCounts: {} })).toThrow(/count above zero/);
  });

  it('follows drawn rows and counts while preserving locked plants during regeneration', () => {
    const drawn = { ...design, plantingLines: [{ id: 'drawn', points: [site.polygon[0], site.polygon[2]] }] };
    const initial = generateLayoutVariants(site, profile, species, drawn)[0];
    expect(initial.trees.length).toBeGreaterThan(1);
    expect(initial.trees.every((tree) => tree.rowIndex === 0)).toBe(true);
    expect(initial.trees.length).toBeLessThan(35);
    const lockedSpecies = initial.trees[0].speciesId;
    const locked = initial.trees.filter((tree) => tree.speciesId === lockedSpecies).slice(0, 2).map((tree) => ({ ...tree, locked: true }));
    const regenerated = regenerateLayoutVariant(site, profile, species, { ...initial, trees: locked }, {
      ...drawn, speciesCounts: { [lockedSpecies]: 0, 'prunus-dulcis': lockedSpecies === 'prunus-dulcis' ? 0 : 1 },
    });
    expect(regenerated.trees.filter((tree) => tree.locked)).toEqual(locked);
    expect(regenerated.trees.filter((tree) => tree.speciesId === lockedSpecies)).toHaveLength(locked.length);
    expect(regenerated.warnings.join(' ')).toContain('locked plants exceed the requested count');
  });

  it('bounds untrusted quantities and preserves percentage defaults for legacy projects', () => {
    expect(normalizeSpeciesCounts({ a: 10.9, b: -2, c: 1_000_000, d: null, e: '20', f: NaN, g: Infinity })).toEqual({ a: 10, b: 0, c: 100_000 });
    expect(normalizeSpeciesCounts([])).toEqual({});
    expect(normalizeDesignConfiguration({})).toMatchObject({ speciesQuantityMode: 'percentage', speciesCounts: {} });
    const normalized = normalizeDesignConfiguration({ ...design, speciesCounts: { 'morus-nigra': 10.8 } });
    expect(normalized.speciesCounts).toEqual({ 'morus-nigra': 10 });
  });

  it('honours an explicit planting distance on a drawn row', () => {
    const variant = generateLayoutVariants(site, profile, species, {
      ...design, plantSpacingM: 3, speciesCounts: { 'morus-nigra': 100_000 },
      plantingLines: [{ id: 'drawn-distance', points: [site.polygon[0], site.polygon[2]] }],
    })[0];
    expect(variant.trees.length).toBeGreaterThan(3);
    const minimum = Math.min(...variant.trees.slice(1).map((tree, index) => haversineM(tree.coordinate, variant.trees[index].coordinate)));
    expect(minimum).toBeCloseTo(3, 1);
  });
});
