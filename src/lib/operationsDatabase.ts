import { DESIGN_SPECIES } from '../data/designSpecies';
import { OPERATIONS_ARCHETYPES, archetypeForDesignSpecies, plantingMethodForStock } from '../data/operationsArchetypes';
import { OPERATIONS_MODEL_VERSION, operationsSourceList } from '../data/operationsSources';
import type {
  DesignSpecies,
  MonthWindow,
  OperationsCoverageReport,
  OperationsCuratedOverlay,
  OperationsPackFile,
  OperationsPackId,
  SpeciesOperationsRecord,
} from '../types';

export const OPERATIONS_PACK_PATH = 'data/operations/IT.json';
export const OPERATIONS_CURATED_PATH = 'data/operations/curated-IT.json';
export const OPERATIONS_COVERAGE_PATH = 'data/generated/operations-coverage.json';
export const OPERATIONS_ENRICH_MAX_PASSES = 8;

const PACK_SOURCES = operationsSourceList('italyPlanningDefault', 'ecocrop', 'euforgen', 'mediterraneanFlora');
const REQUIRED_FIELDS = ['planting.window', 'planting.method', 'pruning.style', 'care.firstYearWater'] as const;

function normalizeTaxonName(value: string): string {
  return value.trim().toLocaleLowerCase('en').replace(/×/g, 'x').replace(/\s+/g, ' ');
}

export function emptyOperationsPack(packId: OperationsPackId = 'IT', updatedAt = new Date(0).toISOString()): OperationsPackFile {
  return { packId, modelVersion: OPERATIONS_MODEL_VERSION, updatedAt, records: [] };
}

export function recordsToMap(records: SpeciesOperationsRecord[]): Map<string, SpeciesOperationsRecord> {
  return new Map(records.map((record) => [normalizeTaxonName(record.scientificName), cloneRecord(record)]));
}

export function mapToPack(packId: OperationsPackId, records: Map<string, SpeciesOperationsRecord>, updatedAt: string): OperationsPackFile {
  return {
    packId,
    modelVersion: OPERATIONS_MODEL_VERSION,
    updatedAt,
    records: [...records.values()]
      .sort((left, right) => normalizeTaxonName(left.scientificName).localeCompare(normalizeTaxonName(right.scientificName)))
      .map(cloneRecord),
  };
}

export function missingOperationsFields(record: SpeciesOperationsRecord): string[] {
  const missing: string[] = [];
  if (!record.planting.window) missing.push('planting.window');
  if (!record.planting.method) missing.push('planting.method');
  if (!record.pruning.style) missing.push('pruning.style');
  if (!record.pruning.window && record.pruning.style !== 'sanitary-only') missing.push('pruning.window');
  if (!record.care.firstYearWater) missing.push('care.firstYearWater');
  return missing;
}

export function operationsCoverage(pack: OperationsPackFile, generatedAt = pack.updatedAt, passes = 0): OperationsCoverageReport {
  const designReady = DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked');
  const byName = recordsToMap(pack.records);
  const incomplete = designReady.flatMap((species) => {
    const record = byName.get(normalizeTaxonName(species.scientificName));
    const missing = record ? missingOperationsFields(record) : [...REQUIRED_FIELDS];
    return missing.length > 0 ? [{ scientificName: species.scientificName, missing }] : [];
  });
  return {
    modelVersion: OPERATIONS_MODEL_VERSION,
    generatedAt,
    packId: pack.packId,
    passes,
    recordCount: pack.records.length,
    designReadyComplete: designReady.length - incomplete.length,
    designReadyTotal: designReady.length,
    incomplete,
    complete: incomplete.length === 0 && pack.records.length >= designReady.length,
  };
}

export function enrichOperationsPack(
  pack: OperationsPackFile,
  curated: OperationsCuratedOverlay[],
  updatedAt = pack.updatedAt,
): { pack: OperationsPackFile; changed: number } {
  const records = recordsToMap(pack.records);
  let changed = 0;

  for (const species of DESIGN_SPECIES) {
    if (species.invasiveStatus === 'blocked') continue;
    changed += upsertDesignSpecies(records, species);
  }

  for (const overlay of curated) {
    changed += applyCuratedOverlay(records, overlay);
  }

  for (const [key, record] of records) {
    const filled = fillFromArchetype(record);
    if (filled) {
      records.set(key, filled);
      changed += 1;
    }
  }

  return { pack: mapToPack(pack.packId, records, updatedAt), changed };
}

export function enrichUntilComplete(
  pack: OperationsPackFile,
  curated: OperationsCuratedOverlay[],
  updatedAt = new Date().toISOString(),
): { pack: OperationsPackFile; coverage: OperationsCoverageReport } {
  let current = pack;
  let passes = 0;
  for (; passes < OPERATIONS_ENRICH_MAX_PASSES; passes += 1) {
    const next = enrichOperationsPack(current, curated, updatedAt);
    current = next.pack;
    if (next.changed === 0) break;
  }
  return { pack: current, coverage: operationsCoverage(current, updatedAt, passes + 1) };
}

function upsertDesignSpecies(records: Map<string, SpeciesOperationsRecord>, species: DesignSpecies): number {
  const key = normalizeTaxonName(species.scientificName);
  if (records.has(key)) {
    const existing = records.get(key)!;
    if (existing.speciesId === species.id && existing.planting.method) return 0;
    records.set(key, {
      ...existing,
      speciesId: existing.speciesId ?? species.id,
      planting: {
        ...existing.planting,
        method: existing.planting.method ?? plantingMethodForStock(species.stockClass),
      },
    });
    return 1;
  }
  records.set(key, recordFromArchetype(species.scientificName, archetypeForDesignSpecies(species), species.id, plantingMethodForStock(species.stockClass)));
  return 1;
}

function applyCuratedOverlay(records: Map<string, SpeciesOperationsRecord>, overlay: OperationsCuratedOverlay): number {
  const key = normalizeTaxonName(overlay.scientificName);
  const existing = records.get(key);
  const archetypeId = overlay.archetypeId ?? existing?.archetypeId ?? 'woody-default';
  const method = existing?.planting.method ?? null;
  const base = existing ?? recordFromArchetype(overlay.scientificName, archetypeId, overlay.speciesId ?? null, method);
  const next = {
    ...base,
    archetypeId,
    speciesId: overlay.speciesId ?? base.speciesId,
    wfoId: overlay.wfoId ?? base.wfoId,
    planting: {
      ...base.planting,
      window: overlay.plantStart && overlay.plantEnd ? monthWindow(overlay.plantStart, overlay.plantEnd) : base.planting.window,
    },
    pruning: {
      ...base.pruning,
      phenologyAnchor: overlay.pruneAnchor ?? base.pruning.phenologyAnchor,
      window: overlay.pruneStart && overlay.pruneEnd ? monthWindow(overlay.pruneStart, overlay.pruneEnd) : base.pruning.window,
    },
    phenology: {
      leafOut: base.phenology.leafOut,
      flowering: overlay.flowerStart && overlay.flowerEnd ? monthWindow(overlay.flowerStart, overlay.flowerEnd, 'low') : base.phenology.flowering,
      harvest: overlay.harvestStart && overlay.harvestEnd ? monthWindow(overlay.harvestStart, overlay.harvestEnd, 'medium') : base.phenology.harvest,
      leafFall: base.phenology.leafFall,
    },
    sources: PACK_SOURCES,
    confidence: overlay.flowerStart || overlay.harvestStart || overlay.plantStart ? 'medium' : base.confidence,
  };
  if (JSON.stringify(existing) === JSON.stringify(next)) return 0;
  records.set(key, next);
  return 1;
}

function fillFromArchetype(record: SpeciesOperationsRecord): SpeciesOperationsRecord | null {
  const fallback = OPERATIONS_ARCHETYPES[record.archetypeId];
  const next: SpeciesOperationsRecord = {
    ...record,
    planting: {
      ...record.planting,
      window: record.planting.window ?? cloneWindow(fallback.planting.window),
      method: record.planting.method ?? fallback.planting.method,
      holeWidthM: record.planting.holeWidthM ?? fallback.planting.holeWidthM,
      holeDepthM: record.planting.holeDepthM ?? fallback.planting.holeDepthM,
      steps: record.planting.steps.length > 0 ? record.planting.steps : [...fallback.planting.steps],
    },
    pruning: {
      ...record.pruning,
      style: record.pruning.style ?? fallback.pruning.style,
      phenologyAnchor: record.pruning.phenologyAnchor ?? fallback.pruning.phenologyAnchor,
      window: record.pruning.window ?? cloneWindow(fallback.pruning.window),
      frequency: record.pruning.frequency ?? fallback.pruning.frequency,
    },
    care: {
      ...record.care,
      firstYearWater: record.care.firstYearWater ?? fallback.care.firstYearWater,
      mulch: record.care.mulch ?? fallback.care.mulch,
      guards: record.care.guards ?? fallback.care.guards,
      notes: record.care.notes.length > 0 ? record.care.notes : [...fallback.care.notes],
    },
  };
  return JSON.stringify(next) === JSON.stringify(record) ? null : next;
}

function recordFromArchetype(
  scientificName: string,
  archetypeId: SpeciesOperationsRecord['archetypeId'],
  speciesId: string | null,
  method: SpeciesOperationsRecord['planting']['method'] = null,
): SpeciesOperationsRecord {
  const fields = OPERATIONS_ARCHETYPES[archetypeId];
  return {
    scientificName,
    wfoId: null,
    speciesId,
    packId: 'IT',
    archetypeId,
    ...cloneFields(fields),
    planting: {
      ...cloneFields(fields).planting,
      method: method ?? fields.planting.method,
    },
    sources: PACK_SOURCES,
    confidence: speciesId ? 'medium' : 'low',
    limitations: [
      ...fields.limitations,
      `Italy operations pack ${OPERATIONS_MODEL_VERSION}. Site climate still shifts the calendar.`,
    ],
  };
}

function monthWindow(startMonth: number, endMonth: number, confidence: MonthWindow['confidence'] = 'medium'): MonthWindow {
  return { startMonth, endMonth, confidence, sources: PACK_SOURCES };
}

function cloneWindow(window: MonthWindow | null): MonthWindow | null {
  return window ? { ...window, sources: [...window.sources] } : null;
}

function cloneFields(fields: SpeciesOperationsRecord | typeof OPERATIONS_ARCHETYPES[SpeciesOperationsRecord['archetypeId']]) {
  return {
    planting: { ...fields.planting, steps: [...fields.planting.steps], window: cloneWindow(fields.planting.window) },
    pruning: { ...fields.pruning, window: cloneWindow(fields.pruning.window) },
    care: { ...fields.care, notes: [...fields.care.notes] },
    phenology: {
      leafOut: cloneWindow(fields.phenology.leafOut),
      flowering: cloneWindow(fields.phenology.flowering),
      harvest: cloneWindow(fields.phenology.harvest),
      leafFall: cloneWindow(fields.phenology.leafFall),
    },
    limitations: [...fields.limitations],
  };
}

function cloneRecord(record: SpeciesOperationsRecord): SpeciesOperationsRecord {
  return {
    ...record,
    ...cloneFields(record),
    sources: [...record.sources],
  };
}
