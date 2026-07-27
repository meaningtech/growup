import { describe, expect, it } from 'vitest';
import { defaultEconomicConfiguration } from '../data/economicProfiles';
import { defaultFireOperationsPlan } from './fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from './irrigation';
import { DEFAULT_DESIGN_CONFIGURATION } from './layout';
import { projectAnalysisFingerprint } from './projectAnalysis';

const context = {
  site: null,
  siteProfile: null,
  selectedSpeciesIds: ['olea-europaea'],
  designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
  irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
  economicConfiguration: defaultEconomicConfiguration('IT'),
  variants: [],
  selectedVariantId: null,
  timelineYear: 5,
  irrigation: null,
  costs: null,
  fireOperations: defaultFireOperationsPlan('2026-07-27T00:00:00.000Z'),
  section: 'analysis' as const,
};

describe('project analysis fingerprint', () => {
  it('is stable for unchanged review inputs and changes with the project', () => {
    expect(projectAnalysisFingerprint(context)).toBe(projectAnalysisFingerprint({ ...context }));
    expect(projectAnalysisFingerprint({ ...context, timelineYear: 6 })).not.toBe(projectAnalysisFingerprint(context));
  });
});
