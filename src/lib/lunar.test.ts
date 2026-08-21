import { describe, expect, it } from 'vitest';
import { isWaningMoon, moonAgeDays, moonPhase, waningMoonRanges } from './lunar';

describe('lunar phase helper', () => {
  it('places 6 January 2000 near a new moon', () => {
    expect(moonAgeDays(new Date(Date.UTC(2000, 0, 6, 18, 14)))).toBeLessThan(0.05);
    expect(moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)))).toBe('new');
  });

  it('treats the days after full moon as waning', () => {
    expect(isWaningMoon(new Date(Date.UTC(2000, 0, 22, 12)))).toBe(true);
    expect(isWaningMoon(new Date(Date.UTC(2000, 0, 8, 12)))).toBe(false);
    expect(moonPhase(new Date(Date.UTC(2000, 0, 12, 12)))).toBe('waxing');
    expect(moonPhase(new Date(Date.UTC(2000, 0, 26, 12)))).toBe('waning');
  });

  it('returns compact waning ranges inside a month', () => {
    const ranges = waningMoonRanges(2000, 1);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((range) => range.startDay >= 1 && range.endDay <= 31 && range.startDay <= range.endDay)).toBe(true);
  });
});
