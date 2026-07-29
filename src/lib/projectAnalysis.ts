import type {
  AssistantProjectContext,
  ProjectAnalysisFindingResolutionStatus,
  ProjectAnalysisReport,
} from '../types';

export function projectAnalysisFingerprint(context: AssistantProjectContext) {
  const payload = JSON.stringify({
    site: context.site,
    profileGeneratedAt: context.siteProfile?.generatedAt ?? null,
    profileOverrides: context.siteProfile?.overrides ?? [],
    selectedSpeciesIds: context.selectedSpeciesIds,
    designConfiguration: context.designConfiguration,
    irrigationConfiguration: context.irrigationConfiguration,
    economicConfiguration: context.economicConfiguration,
    variants: context.variants,
    selectedVariantId: context.selectedVariantId,
    timelineYear: context.timelineYear,
    irrigation: context.irrigation,
    costs: context.costs,
    fireOperations: context.fireOperations,
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `review-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function setProjectAnalysisFindingResolution(
  report: ProjectAnalysisReport,
  findingId: string,
  status: ProjectAnalysisFindingResolutionStatus | null,
  updatedAt = new Date().toISOString(),
): ProjectAnalysisReport {
  return {
    ...report,
    findings: report.findings.map((finding) => {
      if (finding.id !== findingId) return finding;
      if (status === null) {
        const { resolution: _resolution, ...openFinding } = finding;
        return openFinding;
      }
      return { ...finding, resolution: { status, updatedAt } };
    }),
  };
}
