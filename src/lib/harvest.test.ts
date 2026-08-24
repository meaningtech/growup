import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { defaultEconomicConfiguration } from '../data/economicProfiles';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { HARVEST_MODEL_VERSION, buildHarvestPlan } from './harvest';

const olive = DESIGN_SPECIES.find((item) => item.id === 'olea-europaea')!;
const vine = DESIGN_SPECIES.find((item) => item.id === 'vitis-vinifera')!;
const carob = DESIGN_SPECIES.find((item) => item.id === 'ceratonia-siliqua')!;
const palette = [olive, vine, carob];

describe('harvest estimates', () => {
  it('keeps olive oil as a cited fraction of olive fruit', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE, 'IT');
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, palette, DEFAULT_DESIGN_CONFIGURATION)[0];
    const plan = buildHarvestPlan(variant, palette, defaultEconomicConfiguration('IT'), null, 20);
    expect(plan.modelVersion).toBe(HARVEST_MODEL_VERSION);
    const fruit = plan.current.rows.find((row) => row.productId === 'olives');
    const oil = plan.current.rows.find((row) => row.productId === 'olive-oil');
    expect(fruit).toBeDefined();
    expect(oil?.derived).toBe(true);
    expect(oil!.kgBase).toBe(Number((fruit!.kgBase * 0.1925).toFixed(1)));
    expect(plan.years).toHaveLength(30);
    expect(plan.years[0]!.kgBase).toBe(0);
    expect(plan.years[19]!.kgBase).toBeGreaterThan(plan.years[3]!.kgBase);
  });

  it('converts grapes to wine with the OIV ratio and leaves unknown taxa out of totals', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE, 'IT');
    const oak = DESIGN_SPECIES.find((item) => item.id === 'quercus-ilex')!;
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, [vine, oak, carob], DEFAULT_DESIGN_CONFIGURATION)[0];
    const plan = buildHarvestPlan(variant, [vine, oak, carob], defaultEconomicConfiguration('IT'), null, 20);
    const grapes = plan.current.rows.find((row) => row.productId === 'grapes');
    const wine = plan.current.rows.find((row) => row.productId === 'wine');
    expect(grapes).toBeDefined();
    expect(wine!.kgBase).toBe(Number((grapes!.kgBase * 0.733).toFixed(1)));
    expect(plan.current.rows.some((row) => row.speciesId === 'quercus-ilex')).toBe(false);
    expect(plan.current.unknownSpecies).toBeGreaterThan(0);
    expect(plan.warnings.some((warning) => warning.includes('mixed-system'))).toBe(true);
  });

  it('is deterministic and applies a local price override', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE, 'IT');
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, palette, DEFAULT_DESIGN_CONFIGURATION)[0];
    const economics = defaultEconomicConfiguration('IT');
    const first = buildHarvestPlan(variant, palette, economics, null, 12);
    const second = buildHarvestPlan(variant, palette, economics, null, 12);
    expect(JSON.stringify(first.current.rows)).toBe(JSON.stringify(second.current.rows));
    const priced = buildHarvestPlan(variant, palette, economics, null, 12, { 'olive-oil': 10 });
    const oil = priced.current.rows.find((row) => row.productId === 'olive-oil')!;
    expect(oil.unitPriceLocal).toBe(10);
    expect(oil.valueBase).toBe(Number((oil.kgBase * 10).toFixed(2)));
  });
});
