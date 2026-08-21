import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { OperationsCuratedOverlay } from '../src/types.js';
import { mappedOperationsCountries } from '../src/data/operationsCountries.js';
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

const curated = readCurated(curatedPath);
const { pack, coverage } = enrichUntilComplete(emptyOperationsPack('IT', updatedAt), curated, updatedAt);

mkdirSync(dirname(packPath), { recursive: true });
mkdirSync(dirname(coveragePath), { recursive: true });
writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

const countries = mappedOperationsCountries();
const groupCount = (group: 'mediterranean' | 'temperate' | 'tropical') => countries.filter((item) => item.group === group).length;
console.log(
  `Italy operations pack: ${coverage.recordCount} records, ${coverage.designReadyComplete}/${coverage.designReadyTotal} design-ready complete after ${coverage.passes} pass(es).`,
);
console.log(
  `Country coverage: ${countries.length} ISO codes (${groupCount('mediterranean')} Mediterranean, ${groupCount('temperate')} temperate, ${groupCount('tropical')} tropical).`,
);

if (!coverage.complete) {
  for (const item of coverage.incomplete) {
    console.error(`incomplete ${item.scientificName}: ${item.missing.join(', ')}`);
  }
  process.exit(1);
}

function readCurated(path: string): OperationsCuratedOverlay[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { records?: OperationsCuratedOverlay[] };
  if (!Array.isArray(parsed.records)) throw new Error(`Curated operations file is missing records: ${path}`);
  return parsed.records;
}
