import { describe, expect, it } from 'vitest';
import { DEFAULT_FIREBREAK_CONFIGURATION, firebreakConfigurationFromFuelModel, firebreakEnvelope } from '../data/firebreak';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { buildFirebreakPlan } from './firebreak';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { distanceToSiteBoundaryM } from './siteGeometry';

const palette = DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked').slice(0, 9);

describe('firebreak planning', () => {
  it('derives planning widths from the selected fuel model and expected flame length', () => {
    expect(firebreakConfigurationFromFuelModel('crop-residue')).toEqual(expect.objectContaining({
      enabled: true,
      expectedFlameLengthM: 2,
      widthM: 5,
    }));
    expect(firebreakEnvelope({
      ...DEFAULT_FIREBREAK_CONFIGURATION,
      enabled: true,
      expectedFlameLengthM: 3,
      widthM: 7,
    })).toEqual({
      minimumPlanningWidthM: 7.5,
      plannedWidthM: 7,
      planningWidthSatisfied: false,
    });
  });

  it('maps a continuous perimeter reserve and excludes planting from its width', () => {
    const site = TEMPERATE_OPEN_FIELD_FIXTURE;
    const profile = openFieldProfile(site);
    const firebreak = {
      ...DEFAULT_FIREBREAK_CONFIGURATION,
      enabled: true,
      expectedFlameLengthM: 2,
      widthM: 5,
    };
    const plan = buildFirebreakPlan(site, profile, firebreak);
    const variants = generateLayoutVariants(site, profile, palette, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      firebreak,
    });

    expect(plan).toEqual(expect.objectContaining({
      enabled: true,
      plannedWidthM: 5,
      minimumPlanningWidthM: 5,
      planningWidthSatisfied: true,
      localReviewRequired: true,
      totalLengthM: expect.any(Number),
      reservedAreaM2: expect.any(Number),
    }));
    expect(plan.lines).toHaveLength(site.polygon.length);
    expect(plan.lines.some((line) => line.priority === 'windward')).toBe(true);
    expect(plan.lines.some((line) => line.priority === 'standard')).toBe(true);
    expect(plan.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'Italian Civil Protection Department' }),
      expect.objectContaining({ source: 'USDA Natural Resources Conservation Service' }),
    ]));
    expect(variants).toEqual(generateLayoutVariants(site, profile, palette, {
      ...DEFAULT_DESIGN_CONFIGURATION,
      firebreak,
    }));
    for (const variant of variants) {
      expect(variant.firebreak).toEqual(plan);
      expect(variant.trees.every((tree) => (
        distanceToSiteBoundaryM(site, tree.coordinate) >= firebreak.widthM - 0.05
      ))).toBe(true);
    }
  });
});
