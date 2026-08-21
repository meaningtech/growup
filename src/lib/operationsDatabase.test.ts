import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { OPERATIONS_MODEL_VERSION } from '../data/operationsSources';
import type { OperationsCuratedOverlay, OperationsPackFile } from '../types';
import {
  emptyOperationsPack,
  enrichUntilComplete,
  missingOperationsFields,
  operationsCoverage,
} from './operationsDatabase';

const curated = JSON.parse(readFileSync(new URL('../../data/operations/curated-IT.json', import.meta.url), 'utf8')).records as OperationsCuratedOverlay[];

describe('operations database enrichment', () => {
  it('reaches a complete Italy pack for every design-ready species', () => {
    const { pack, coverage } = enrichUntilComplete(emptyOperationsPack(), curated, '2026-08-21T00:00:00.000Z');
    expect(coverage.complete).toBe(true);
    expect(coverage.designReadyComplete).toBe(coverage.designReadyTotal);
    expect(coverage.designReadyTotal).toBe(50);
    expect(pack.modelVersion).toBe(OPERATIONS_MODEL_VERSION);
    expect(pack.records.some((record) => record.scientificName === 'Acacia saligna')).toBe(false);

    for (const species of DESIGN_SPECIES.filter((item) => item.invasiveStatus !== 'blocked')) {
      const record = pack.records.find((item) => item.speciesId === species.id);
      expect(record, species.scientificName).toBeDefined();
      expect(missingOperationsFields(record!)).toEqual([]);
    }
  });

  it('is idempotent once complete', () => {
    const first = enrichUntilComplete(emptyOperationsPack(), curated, '2026-08-21T00:00:00.000Z');
    const second = enrichUntilComplete(first.pack, curated, '2026-08-21T00:00:00.000Z');
    expect(second.coverage.passes).toBe(1);
    expect(second.pack.records).toEqual(first.pack.records);
    expect(operationsCoverage(second.pack).complete).toBe(true);
  });
});

describe('committed Italy operations pack', () => {
  it('matches the enricher output', () => {
    const committed = JSON.parse(readFileSync(new URL('../../data/operations/IT.json', import.meta.url), 'utf8')) as OperationsPackFile;
    const { pack } = enrichUntilComplete(emptyOperationsPack(), curated, committed.updatedAt);
    expect(committed.records).toEqual(pack.records);
    expect(operationsCoverage(committed).complete).toBe(true);
  });
});
