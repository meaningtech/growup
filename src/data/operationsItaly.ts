import packFile from '../../data/operations/IT.json';
import { recordsToMap } from '../lib/operationsDatabase';
import type { OperationsPackFile, SpeciesOperationsRecord } from '../types';

const pack = packFile as OperationsPackFile;

export const ITALY_OPERATIONS_PACK = recordsToMap(pack.records);

export function italyOperationsRecord(scientificName: string): SpeciesOperationsRecord | null {
  return ITALY_OPERATIONS_PACK.get(scientificName.trim().toLocaleLowerCase('en').replace(/×/g, 'x').replace(/\s+/g, ' ')) ?? null;
}
