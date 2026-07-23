import { createHash } from 'node:crypto';
import { DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies.js';
import { GROWTH_MODEL_VERSION } from '../src/lib/growth.js';
import { IRRIGATION_MODEL_VERSION } from '../src/lib/irrigation.js';
import { MAINTENANCE_MODEL_VERSION } from '../src/lib/maintenance.js';
import type { CalculationSnapshot, Evidence, ProjectRevisionSummary, ProjectState } from '../src/types.js';

export const APPLICATION_MODEL_VERSION = 'growup-0.2.0';

export type RevisionArtifacts = {
  state: ProjectState;
  summary: ProjectRevisionSummary;
  calculation: CalculationSnapshot | null;
};

export function projectContentHash(project: ProjectState): string {
  const { revision: _revision, revisionId: _revisionId, calculationRunId: _calculationRunId, updatedAt: _updatedAt, ...content } = project;
  return digest(stableSerialize(content));
}

export function buildRevisionArtifacts(ownerUserId: string, project: ProjectState, revision: number): RevisionArtifacts {
  const contentHash = projectContentHash(project);
  const ownerPrefix = digest(ownerUserId).slice(0, 14);
  const revisionId = `${ownerPrefix}:${project.id}:r${String(revision).padStart(8, '0')}`;
  const variant = project.variants.find((item) => item.id === project.selectedVariantId) ?? project.variants[0] ?? null;
  const calculationRunId = variant ? `${revisionId}:calculation` : null;
  const state: ProjectState = { ...project, revision, revisionId, calculationRunId };
  const summary: ProjectRevisionSummary = {
    revision,
    revisionId,
    calculationRunId,
    createdAt: project.updatedAt,
    contentHash,
    name: project.name,
    selectedVariantId: variant?.id ?? null,
    treeCount: variant?.trees.length ?? 0,
  };
  const calculation = variant && calculationRunId ? calculationSnapshot(state, revision, calculationRunId, contentHash, variant.generation.engineVersion) : null;
  return { state, summary, calculation };
}

function calculationSnapshot(project: ProjectState, revision: number, id: string, inputHash: string, layoutVersion: string): CalculationSnapshot {
  const evidence = evidenceRecords(project);
  const variant = project.variants.find((item) => item.id === project.selectedVariantId) ?? project.variants[0];
  if (!variant) throw new Error('A calculation snapshot requires a selected layout variant.');
  return {
    id,
    projectId: project.id,
    revision,
    createdAt: project.updatedAt,
    inputHash,
    geometryHash: digest(stableSerialize(project.site)),
    selectedVariantId: variant.id,
    selectedSpeciesIds: [...project.selectedSpeciesIds],
    modelVersions: {
      application: APPLICATION_MODEL_VERSION,
      layout: layoutVersion,
      growth: GROWTH_MODEL_VERSION,
      irrigation: IRRIGATION_MODEL_VERSION,
      maintenance: MAINTENANCE_MODEL_VERSION,
      economics: project.economicConfiguration.sourceVersion,
    },
    evidenceVersions: evidence.map(({ source, version, observedAt }) => ({ source, version, observedAt })),
    outputSummary: {
      treeCount: variant.trees.length,
      annualWaterM3: project.irrigation?.annualWaterM3 ?? null,
      maintenanceLaborHours: project.irrigation?.systemMaintenance?.totalHours ?? null,
      maintenanceLaborCost: project.irrigation?.systemMaintenance?.totalCost ?? null,
      establishmentCost: project.costs?.totalCost ?? null,
      currencyCode: project.economicConfiguration.currencyCode,
    },
  };
}

function evidenceRecords(project: ProjectState): Evidence[] {
  const profile = project.siteProfile;
  const speciesEvidence = project.selectedSpeciesIds.flatMap((id) => (
    DESIGN_SPECIES_BY_ID.get(id)?.sources.map((source): Evidence => ({
      source: source.label,
      sourceUrl: source.url,
      version: source.version,
      observedAt: project.updatedAt,
      confidence: 'medium',
    })) ?? []
  ));
  const maintenanceEvidence = project.irrigation?.systemMaintenance?.sources.map((source): Evidence => ({
    source: `${source.organization}: ${source.title}`,
    sourceUrl: source.url,
    version: source.version,
    observedAt: project.updatedAt,
    confidence: project.irrigation!.systemMaintenance.confidence,
  })) ?? [];
  if (!profile) return uniqueEvidence([...maintenanceEvidence, ...speciesEvidence]);
  return uniqueEvidence([
    profile.location.evidence,
    profile.terrain.evidence,
    profile.climate.evidence,
    profile.solar.evidence,
    profile.soil.evidence,
    profile.landCover.evidence,
    ...profile.satellite.evidence,
    ...profile.satellite.existingVegetation.evidence,
    ...maintenanceEvidence,
    ...speciesEvidence,
  ]);
}

function uniqueEvidence(records: Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  for (const record of records) unique.set(`${record.source}|${record.version}|${record.observedAt}`, record);
  return [...unique.values()].sort((a, b) => a.source.localeCompare(b.source) || a.version.localeCompare(b.version) || a.observedAt.localeCompare(b.observedAt));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
