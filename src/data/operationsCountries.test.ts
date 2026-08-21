import { describe, expect, it } from 'vitest';
import { climateGroupForCountry, mappedOperationsCountries } from './operationsCountries';

describe('operations country groups', () => {
  it('maps each country to exactly one climate group', () => {
    const countries = mappedOperationsCountries();
    const codes = countries.map((item) => item.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(countries.length).toBeGreaterThanOrEqual(150);
  });

  it('uses Mediterranean defaults for Italy and unmapped codes', () => {
    expect(climateGroupForCountry('IT')).toBe('mediterranean');
    expect(climateGroupForCountry('it')).toBe('mediterranean');
    expect(climateGroupForCountry('XX')).toBe('mediterranean');
    expect(climateGroupForCountry(null)).toBe('mediterranean');
  });
});
