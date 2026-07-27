import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { firebreakConfigurationFromFuelModel } from '../data/firebreak';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { assessFireScreening } from './fireRisk';

describe('fire planning screening', () => {
  it('combines traceable climate, wind, terrain, fuel and protection indicators', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const design = {
      ...DEFAULT_DESIGN_CONFIGURATION,
      firebreak: { ...firebreakConfigurationFromFuelModel('shrub-edge'), enabled: true },
    };
    const variant = generateLayoutVariants(
      TEMPERATE_OPEN_FIELD_FIXTURE,
      profile,
      DESIGN_SPECIES.slice(0, 6),
      design,
    )[0];
    const assessment = assessFireScreening(profile, variant);

    expect(assessment).toEqual(expect.objectContaining({
      status: 'available',
      confidence: 'medium',
      coveragePercent: 100,
      annualWaterDeficitMm: 380,
      dryMonthCount: 5,
      score: expect.any(Number),
      level: expect.stringMatching(/low|moderate|high|very-high/),
    }));
    expect(assessment.components.map((component) => component.id)).toEqual([
      'dryness',
      'wind',
      'terrain',
      'fuels',
      'protection',
    ]);
    expect(assessment.components.find((component) => component.id === 'wind')?.evidence[0]?.source).toBe('Open-Meteo Historical Weather API');
    expect(assessment.components.find((component) => component.id === 'protection')?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'planned-width', value: 7.5 }),
      expect.objectContaining({ id: 'minimum-width', value: 7.5 }),
    ]));
  });

  it('raises design attention when the perimeter firebreak is missing', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const variant = generateLayoutVariants(
      TEMPERATE_OPEN_FIELD_FIXTURE,
      profile,
      DESIGN_SPECIES.slice(0, 6),
      DEFAULT_DESIGN_CONFIGURATION,
    )[0];

    const assessment = assessFireScreening(profile, variant);
    expect(assessment.components.find((component) => component.id === 'protection')).toEqual(expect.objectContaining({
      score: 92,
      level: 'very-high',
    }));
  });

  it('does not fabricate a score without a site profile', () => {
    expect(assessFireScreening(null, null)).toEqual(expect.objectContaining({
      status: 'unavailable',
      score: null,
      coveragePercent: 0,
      dominantDrivers: [],
    }));
  });
});
