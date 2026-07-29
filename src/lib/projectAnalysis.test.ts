import { describe, expect, it } from 'vitest';
import { defaultEconomicConfiguration } from '../data/economicProfiles';
import { defaultFireOperationsPlan } from './fireOperations';
import { DEFAULT_IRRIGATION_CONFIGURATION } from './irrigation';
import { DEFAULT_DESIGN_CONFIGURATION } from './layout';
import { projectAnalysisFingerprint, setProjectAnalysisFindingResolution } from './projectAnalysis';
import type { ProjectAnalysisReport } from '../types';

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

  it('persists explicit finding resolutions without changing the formal report identity', () => {
    const report: ProjectAnalysisReport = {
      id: 'review-1',
      model: 'test',
      generatedAt: '2026-07-29T00:00:00.000Z',
      contextFingerprint: projectAnalysisFingerprint(context),
      verdict: 'revise',
      overallScore: 70,
      executiveSummary: 'Review required.',
      dimensions: [],
      findings: [{
        id: 'water-routing',
        severity: 'major',
        area: 'water',
        title: 'Routing blocked',
        explanation: 'The main line is blocked.',
        evidence: [],
        recommendation: 'Reroute the line.',
      }],
      assumptions: [],
      limitations: [],
    };

    const resolved = setProjectAnalysisFindingResolution(report, 'water-routing', 'resolved', '2026-07-29T10:00:00.000Z');
    expect(resolved.id).toBe(report.id);
    expect(resolved.findings[0].resolution).toEqual({ status: 'resolved', updatedAt: '2026-07-29T10:00:00.000Z' });
    expect(setProjectAnalysisFindingResolution(resolved, 'water-routing', null).findings[0].resolution).toBeUndefined();
  });
});
