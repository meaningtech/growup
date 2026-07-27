import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import { defaultEconomicConfiguration, normalizeEconomicConfiguration } from '../data/economicProfiles';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { calculateEstablishmentCost } from './costs';
import { calculateIrrigation } from './irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';

const species = ['olea-europaea', 'prunus-dulcis', 'tamarix-gallica'].map((id) => DESIGN_SPECIES_BY_ID.get(id)!);

describe('plant unit price overrides', () => {
  it('uses the exact project price for the selected species and sanitizes persisted values', () => {
    const site = TEMPERATE_OPEN_FIELD_FIXTURE;
    const profile = openFieldProfile(site);
    const variant = generateLayoutVariants(site, profile, species, DEFAULT_DESIGN_CONFIGURATION)[0];
    const economics = defaultEconomicConfiguration(profile.location.countryCode ?? '');
    economics.plantUnitCostOverrides = {
      'olea-europaea': 42.35,
      invalid: Number.NaN,
    };
    const normalized = normalizeEconomicConfiguration(economics, profile.location.countryCode ?? '');
    const irrigation = calculateIrrigation(variant, species, site, profile, 5, undefined, normalized);
    const costs = calculateEstablishmentCost(variant, species, irrigation, normalized);
    const olive = costs.bySpecies.find((item) => item.speciesId === 'olea-europaea');

    expect(normalized.plantUnitCostOverrides).toEqual({ 'olea-europaea': 42.35 });
    expect(olive).toBeDefined();
    expect(olive?.unitPlantCost).toBe(42.35);
    expect(costs.plantPurchaseCost).toBe(
      Number(costs.bySpecies.reduce((sum, item) => sum + item.count * item.unitPlantCost, 0).toFixed(2)),
    );
  });
});
