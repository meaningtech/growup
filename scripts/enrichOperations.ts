import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { OperationsCuratedOverlay, OperationsPackFile } from '../src/types.js';
import {
  OPERATIONS_COVERAGE_PATH,
  OPERATIONS_CURATED_PATH,
  OPERATIONS_PACK_PATH,
  emptyOperationsPack,
  enrichUntilComplete,
} from '../src/lib/operationsDatabase.js';

const packPath = resolve(OPERATIONS_PACK_PATH);
const curatedPath = resolve(OPERATIONS_CURATED_PATH);
const coveragePath = resolve(OPERATIONS_COVERAGE_PATH);
const updatedAt = process.env.GROWUP_OPERATIONS_UPDATED_AT || new Date().toISOString();

const existing = readPack(packPath);
const curated = readCurated(curatedPath);
const { pack, coverage } = enrichUntilComplete(existing, curated, updatedAt);

mkdirSync(dirname(packPath), { recursive: true });
mkdirSync(dirname(coveragePath), { recursive: true });
writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

console.log(
  `Italy operations pack: ${coverage.recordCount} records, ${coverage.designReadyComplete}/${coverage.designReadyTotal} design-ready complete after ${coverage.passes} pass(es).`,
);

if (!coverage.complete) {
  for (const item of coverage.incomplete) {
    console.error(`incomplete ${item.scientificName}: ${item.missing.join(', ')}`);
  }
  process.exit(1);
}

function readPack(path: string): OperationsPackFile {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as OperationsPackFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyOperationsPack('IT', updatedAt);
    throw error;
  }
}

function readCurated(path: string): OperationsCuratedOverlay[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { records?: OperationsCuratedOverlay[] };
  if (!Array.isArray(parsed.records)) throw new Error(`Curated operations file is missing records: ${path}`);
  return parsed.records;
}
