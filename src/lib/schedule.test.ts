import { describe, expect, it } from 'vitest';
import { defaultEconomicConfiguration } from '../data/economicProfiles';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { calculateEstablishmentCost } from './costs';
import { calculateIrrigation } from './irrigation';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { buildOperationalSchedule } from './schedule';

describe('operational schedule', () => {
  it('carries exact generated quantities into a procurement and work schedule', () => {
    const profile = openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE);
    const species = DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked').slice(0, 9);
    const variant = generateLayoutVariants(TEMPERATE_OPEN_FIELD_FIXTURE, profile, species, DEFAULT_DESIGN_CONFIGURATION)[0];
    const economics = defaultEconomicConfiguration('XZ');
    const irrigation = calculateIrrigation(variant, species, TEMPERATE_OPEN_FIELD_FIXTURE, profile, 5, null, economics);
    const costs = calculateEstablishmentCost(variant, species, irrigation, economics);
    const schedule = buildOperationalSchedule(profile, variant, species, irrigation, costs);

    expect(schedule.planting.reduce((sum, row) => sum + row.count, 0)).toBe(variant.trees.length);
    expect(schedule.planting.reduce((sum, row) => sum + row.laborHours, 0)).toBeCloseTo(costs.plantingLaborHours, 1);
    expect(schedule.infrastructure).toEqual(irrigation.network.components);
    expect(schedule.summary.purchasePipeM).toBe(irrigation.network.totalPurchasePipeM);
    expect(schedule.irrigationMonths.reduce((sum, month) => sum + month.grossM3, 0)).toBeCloseTo(irrigation.annualWaterM3, 1);
    expect(schedule.summary.maintenanceLaborHours).toBe(irrigation.systemMaintenance.totalHours);
    expect(schedule.summary.maintenanceLaborCost).toBe(irrigation.systemMaintenance.totalCost);
    expect(schedule.maintenance.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'vegetation-control' })]));
    expect(schedule.evidence.some((item) => item.source.includes('Embrapa'))).toBe(true);
    expect(schedule.evidence.length).toBeGreaterThan(8);
  });
});
