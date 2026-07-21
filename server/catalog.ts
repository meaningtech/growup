import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import type { CatalogueSpecies } from '../src/types.js';

const SWITCHBOARD_PATH = fileURLToPath(
  new URL('../data/sources/switchboard-4/Switchboard_species.txt', import.meta.url),
);
const GLOBUNT_PATH = fileURLToPath(
  new URL('../data/sources/globunt-2023/GlobUNT_Species_2023.txt', import.meta.url),
);

let catalogueCache: CatalogueSpecies[] | null = null;
let globUntCache: Set<string> | null = null;

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
}

function parseGlobUnt(): Set<string> {
  if (globUntCache) return globUntCache;

  const lines = readFileSync(GLOBUNT_PATH, 'utf8').split(/\r?\n/);
  const header = lines.shift()?.split('|') ?? [];
  const speciesIndex = header.indexOf('Species');

  if (speciesIndex < 0) throw new Error('GlobUNT source is missing the Species column');

  globUntCache = new Set(
    lines
      .filter(Boolean)
      .map((line) => normalizeName(line.split('|')[speciesIndex] ?? ''))
      .filter(Boolean),
  );

  return globUntCache;
}

export function loadCatalogue(): CatalogueSpecies[] {
  if (catalogueCache) return catalogueCache;

  const globUnt = parseGlobUnt();
  const designReady = new Set(DESIGN_SPECIES.map((species) => normalizeName(species.scientificName)));
  const lines = readFileSync(SWITCHBOARD_PATH, 'utf8').split(/\r?\n/);
  const header = lines.shift()?.split('|') ?? [];
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Switchboard source is missing the ${name} column`);
    return index;
  };
  const seq = column('SEQ');
  const species = column('Species');
  const sources = column('Sources');
  const tree = column('Tree');
  const sid = column('SID');
  const wcvp = column('WCVP');

  catalogueCache = lines.filter(Boolean).map((line) => {
    const fields = line.split('|');
    const scientificName = fields[species] ?? '';
    const normalized = normalizeName(scientificName);

    return {
      id: `switchboard-${fields[seq]}`,
      scientificName,
      sourceCount: Number(fields[sources] || 0),
      treeLike: fields[tree] === 'YES',
      wfoId: fields[sid] || null,
      wcvpId: fields[wcvp] || null,
      globUnt: globUnt.has(normalized),
      designReady: designReady.has(normalized),
    };
  });

  return catalogueCache;
}

export function catalogueStats() {
  const catalogue = loadCatalogue();

  return {
    total: catalogue.length,
    treeLike: catalogue.filter((species) => species.treeLike).length,
    globUnt: catalogue.filter((species) => species.globUnt).length,
    designReady: DESIGN_SPECIES.length,
    sources: [
      { id: 'switchboard-4', name: 'Agroforestry Species Switchboard 4.0', license: 'CC BY 4.0' },
      { id: 'globunt-2023', name: 'GlobalUsefulNativeTrees 2023.01', license: 'CC BY 4.0' },
    ],
  };
}

export function searchCatalogue(options: {
  query?: string;
  treeOnly?: boolean;
  globUntOnly?: boolean;
  designReadyOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const query = normalizeName(options.query ?? '');
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  const filtered = loadCatalogue().filter((species) => {
    if (options.treeOnly && !species.treeLike) return false;
    if (options.globUntOnly && !species.globUnt) return false;
    if (options.designReadyOnly && !species.designReady) return false;
    if (query && !normalizeName(species.scientificName).includes(query)) return false;
    return true;
  });

  return {
    total: filtered.length,
    offset,
    limit,
    results: filtered.slice(offset, offset + limit),
  };
}
