import { describe, expect, it } from 'vitest';
import { calculateSystemMaintenance, MAINTENANCE_MODEL_VERSION } from './maintenance';

describe('multi-year system maintenance', () => {
  const economics = { laborCostPerHour: 20 };

  it('tapers syntropic routine workload to zero at forest autonomy', () => {
    const establishment = calculateSystemMaintenance('syntropic', 1, 10_000, 800, economics);
    const transition = calculateSystemMaintenance('syntropic', 15, 10_000, 800, economics);
    const mature = calculateSystemMaintenance('syntropic', 30, 10_000, 800, economics);

    expect(establishment.modelVersion).toBe(MAINTENANCE_MODEL_VERSION);
    expect(establishment.totalHours).toBeGreaterThan(transition.totalHours);
    expect(establishment.totalHours).toBeGreaterThan(mature.totalHours);
    expect(transition.totalHours).toBeGreaterThan(0);
    expect(mature.totalHours).toBe(0);
    expect(mature.tasks).toEqual([]);
    expect(mature.totalCost).toBeCloseTo(mature.totalHours * economics.laborCostPerHour, 2);
    expect(establishment.basis).toBe('measured-agroforestry-reference');
    expect(establishment.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps monoculture maintenance near a mature plateau as pruning increases', () => {
    const establishment = calculateSystemMaintenance('monoculture', 1, 10_000, 350, economics);
    const mature = calculateSystemMaintenance('monoculture', 30, 10_000, 350, economics);

    expect(mature.totalHours).toBeGreaterThan(establishment.totalHours * 0.8);
    expect(mature.tasks.find((task) => task.id === 'training-pruning')!.hours)
      .toBeGreaterThan(establishment.tasks.find((task) => task.id === 'training-pruning')!.hours);
    expect(mature.tasks.some((task) => task.id === 'biomass-succession')).toBe(false);
    expect(mature.basis).toBe('enterprise-budget-reference');
  });

  it('limits perimeter maintenance to the effective managed footprint', () => {
    const windbreak = calculateSystemMaintenance('windbreak', 3, 50_000, 120, economics);

    expect(windbreak.managedAreaHectares).toBeLessThan(windbreak.siteAreaHectares);
    expect(windbreak.managedAreaHectares).toBeGreaterThanOrEqual(0.36);
    expect(windbreak.tasks.find((task) => task.id === 'inspection-replanting')?.hours).toBeGreaterThan(0);
    expect(windbreak.basis).toBe('practice-standard-reference');
  });

  it('excludes annual alley crops from the woody-system workload contract', () => {
    const alley = calculateSystemMaintenance('alley-cropping', 5, 20_000, 220, economics);

    expect(alley.exclusions).toContain('annual-crops');
    expect(alley.confidence).toBe('low');
    expect(alley.totalHours).toBeGreaterThan(0);
  });
});
