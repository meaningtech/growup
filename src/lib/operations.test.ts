import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { ITALY_OPERATIONS_PACK } from '../data/operationsItaly';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { defaultEconomicConfiguration } from '../data/economicProfiles';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { calculateIrrigation } from './irrigation';
import { mappedOperationsCountries } from '../data/operationsCountries';
import {
  OPERATIONS_MODEL_VERSION,
  buildOperationsMonthGrid,
  buildOperationsPlan,
  groupOperationsByYear,
  monthsInWindow,
  normalizePlantingDate,
  resolveOperationsProfile,
  shiftWindow,
} from './operations';

const designReady = DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked');

describe('operations matching', () => {
  it('matches every design-ready species through the Italy pack', () => {
    expect(designReady.length).toBe(50);
    for (const species of designReady) {
      const profile = resolveOperationsProfile({
        scientificName: species.scientificName,
        speciesId: species.id,
        treeLike: species.treeLike,
        countryCode: 'IT',
        designSpecies: species,
      });
      expect(profile.matchLevel).toBe('country-pack');
      expect(profile.packId).toBe('IT');
      expect(profile.planting.window).not.toBeNull();
      expect(profile.modelVersion).toBe(OPERATIONS_MODEL_VERSION);
    }
  });

  it('keeps blocked taxa out of the Italy pack', () => {
    expect(ITALY_OPERATIONS_PACK.has('acacia saligna')).toBe(false);
  });

  it('matches catalogue-scale names by genus when no species record exists', () => {
    const beech = resolveOperationsProfile({ scientificName: 'Fagus sylvatica', treeLike: true, countryCode: 'IT' });
    expect(beech.matchLevel).toBe('country-pack');
    expect(beech.archetypeId).toBe('forestry-deciduous-climax');

    const unknownPrunus = resolveOperationsProfile({ scientificName: 'Prunus padus', treeLike: true, countryCode: 'DE' });
    expect(unknownPrunus.matchLevel).toBe('genus');
    expect(unknownPrunus.archetypeId).toBe('grafted-deciduous-fruit');
    expect(unknownPrunus.confidence).toBe('low');
  });

  it('applies climate groups so the same species is covered in many countries', () => {
    const countries = mappedOperationsCountries();
    expect(countries.length).toBeGreaterThanOrEqual(150);
    expect(countries.filter((item) => item.group === 'mediterranean').map((item) => item.countryCode)).toEqual(expect.arrayContaining(['IT', 'ES', 'GR', 'MA', 'CL']));
    expect(countries.filter((item) => item.group === 'temperate').map((item) => item.countryCode)).toEqual(expect.arrayContaining(['DE', 'GB', 'US', 'NZ']));
    expect(countries.filter((item) => item.group === 'tropical').map((item) => item.countryCode)).toEqual(expect.arrayContaining(['BR', 'IN', 'KE', 'MX']));

    const spain = resolveOperationsProfile({ scientificName: 'Olea europaea', countryCode: 'ES' });
    expect(spain.matchLevel).toBe('climate-group');
    expect(spain.packId).toBe('ES');
    expect(spain.climateGroup).toBe('mediterranean');
    expect(monthsInWindow(spain.planting.window!)).toEqual([11, 12, 1, 2, 3]);

    const germany = resolveOperationsProfile({ scientificName: 'Olea europaea', countryCode: 'DE' });
    expect(germany.matchLevel).toBe('climate-group');
    expect(germany.climateGroup).toBe('temperate');
    expect(monthsInWindow(germany.planting.window!)).toEqual([3, 4, 5]);

    const brazil = resolveOperationsProfile({ scientificName: 'Olea europaea', countryCode: 'BR' });
    expect(brazil.climateGroup).toBe('tropical');
    expect(brazil.confidence).toBe('low');
    expect(monthsInWindow(brazil.planting.window!)).toEqual([4, 5, 6]);
  });

  it('leaves unmatched non-tree names unknown instead of inventing care', () => {
    const profile = resolveOperationsProfile({ scientificName: 'Unknownia fictionalis', treeLike: false });
    expect(profile.matchLevel).toBe('unknown');
    expect(profile.planting.window).toBeNull();
    expect(profile.unknownFields).toContain('planting.window');
  });
});

describe('operations calendar', () => {
  it('builds a deterministic site-adjusted plan from the selected layout', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE, 'IT');
    const species = designReady.slice(0, 8);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, DEFAULT_DESIGN_CONFIGURATION)[0];
    const irrigation = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, null, defaultEconomicConfiguration('IT'));
    const plan = buildOperationsPlan(profile, variant, species, irrigation);
    const again = buildOperationsPlan(profile, variant, species, irrigation);

    expect(plan.modelVersion).toBe(OPERATIONS_MODEL_VERSION);
    expect(plan.species).toHaveLength([...new Set(variant.trees.map((tree) => tree.speciesId))].length);
    expect(plan.calendar.some((event) => event.event === 'plant')).toBe(true);
    expect(plan.calendar.some((event) => event.event === 'prune' || event.event === 'train' || event.event === 'coppice')).toBe(true);
    expect(JSON.stringify(plan.calendar)).toBe(JSON.stringify(again.calendar));
    expect(plan.species.reduce((sum, entry) => sum + entry.count, 0)).toBe(variant.trees.length);

    expect(plan.plantingDate).toBeNull();
    expect(plan.calendar.some((event) => event.event === 'inspect')).toBe(false);
    const years = groupOperationsByYear(plan.calendar, plan.species);
    expect(years[0]?.year).toBe(1);
    expect(years.some((item) => item.year > 1)).toBe(true);
    const yearOne = years[0];
    expect(yearOne.tasks.some((task) => task.event === 'plant')).toBe(true);
    const plant = yearOne.tasks.find((task) => task.event === 'plant');
    const water = yearOne.tasks.find((task) => task.event === 'water-check');
    expect(plant?.companionEvents).toEqual(expect.arrayContaining(['mulch', 'guard-check']));
    expect(water).toBeDefined();
    expect(years.some((item) => item.tasks.some((task) => task.lunarCue === 'waning'))).toBe(true);
  });

  it('anchors every dated event to the user planting date', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE, 'IT');
    const species = designReady.slice(0, 8);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, DEFAULT_DESIGN_CONFIGURATION)[0];
    const irrigation = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, null, defaultEconomicConfiguration('IT'));
    const plantingDate = '2026-11-15';
    const plan = buildOperationsPlan(profile, variant, species, irrigation, profile.generatedAt, plantingDate);
    expect(plan.plantingDate).toBe(plantingDate);
    expect(plan.calendar.some((event) => event.event === 'inspect')).toBe(false);
    const plants = plan.calendar.filter((event) => event.event === 'plant');
    expect(plants.length).toBeGreaterThan(0);
    expect(plants.every((event) => event.startDate === plantingDate && event.endDate === plantingDate)).toBe(true);
    expect(plan.calendar.filter((event) => event.event === 'water-check').every((event) => (event.startDate ?? '') >= plantingDate)).toBe(true);
    const grid = buildOperationsMonthGrid(2026, 11, plan.calendar);
    expect(grid).toHaveLength(42);
    const planted = grid.find((cell) => cell.isoDate === plantingDate);
    expect(planted?.inMonth).toBe(true);
    expect(planted?.events).toEqual(expect.arrayContaining(['plant']));
    expect(grid.some((cell) => cell.waning && cell.moon.startsWith('waning'))).toBe(true);
  });

  it('rejects malformed planting dates', () => {
    expect(normalizePlantingDate('2026-11-15')).toBe('2026-11-15');
    expect(normalizePlantingDate('2026-11-31')).toBeNull();
    expect(normalizePlantingDate('15/11/2026')).toBeNull();
  });

  it('shifts Mediterranean planting windows by six months in the southern hemisphere', () => {
    const olive = resolveOperationsProfile({ scientificName: 'Olea europaea', countryCode: 'IT' });
    const northern = olive.planting.window!;
    const southern = shiftWindow(northern, 6);
    expect(monthsInWindow(northern)).toEqual([11, 12, 1, 2, 3]);
    expect(monthsInWindow(southern)).toEqual([5, 6, 7, 8, 9]);
  });
});
