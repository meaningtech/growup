import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { managementLaborHours, supplementalIrrigationFactor, systemEconomicsProfile } from './systemEconomics';

describe('planting-system economics', () => {
  const support = DESIGN_SPECIES.find((species) => species.roles.includes('biomass') && species.nitrogenFixer)!;
  const productive = DESIGN_SPECIES.find((species) => species.productiveFromYear !== null)!;

  it('reduces supplemental irrigation for a mature syntropic system but not monoculture', () => {
    expect(supplementalIrrigationFactor('syntropic', productive, 1)).toBe(1);
    expect(supplementalIrrigationFactor('syntropic', productive, 30)).toBe(0.5);
    expect(supplementalIrrigationFactor('syntropic', support, 30)).toBeCloseTo(0.04);
    expect(supplementalIrrigationFactor('monoculture', productive, 1)).toBe(1);
    expect(supplementalIrrigationFactor('monoculture', productive, 30)).toBe(1);
  });

  it('keeps syntropic management labour visible while reducing it after establishment', () => {
    expect(managementLaborHours('syntropic', 100, 30)).toBeLessThan(managementLaborHours('syntropic', 100, 1));
    expect(managementLaborHours('syntropic', 100, 30)).toBeGreaterThan(managementLaborHours('monoculture', 100, 30));
    expect(systemEconomicsProfile('syntropic').basis).toBe('measured-system-reference');
  });
});
