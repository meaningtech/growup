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
let normalizedNamesCache: string[] | null = null;
let catalogueCountsCache: { total: number; treeLike: number; globUnt: number } | null = null;

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
  const designReady = new Map(DESIGN_SPECIES.map((species) => [normalizeName(species.scientificName), species]));
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

  const normalizedNames: string[] = [];
  let treeLikeCount = 0;
  let globUntCount = 0;
  catalogueCache = lines.filter(Boolean).map((line) => {
    const fields = line.split('|');
    const scientificName = fields[species] ?? '';
    const normalized = normalizeName(scientificName);
    const designSpecies = designReady.get(normalized);
    const treeLike = fields[tree] === 'YES';
    const isGlobUnt = globUnt.has(normalized);
    normalizedNames.push(normalized);
    if (treeLike) treeLikeCount += 1;
    if (isGlobUnt) globUntCount += 1;

    return {
      id: `switchboard-${fields[seq]}`,
      scientificName,
      sourceCount: Number(fields[sources] || 0),
      treeLike,
      wfoId: fields[sid] || null,
      wcvpId: fields[wcvp] || null,
      globUnt: isGlobUnt,
      designReady: Boolean(designSpecies),
      stratum: designSpecies?.stratum ?? null,
      succession: designSpecies?.succession ?? null,
      roles: designSpecies?.roles ?? [],
      evergreen: designSpecies?.evergreen ?? null,
      nitrogenFixer: designSpecies?.nitrogenFixer ?? null,
      droughtTolerance: designSpecies?.droughtTolerance ?? null,
      evidenceCount: designSpecies?.sources.length ?? Number(fields[sources] || 0) + Number(isGlobUnt),
    };
  });
  normalizedNamesCache = normalizedNames;
  catalogueCountsCache = { total: catalogueCache.length, treeLike: treeLikeCount, globUnt: globUntCount };

  return catalogueCache;
}

export function catalogueStats() {
  loadCatalogue();
  if (!catalogueCountsCache) throw new Error('Catalogue counts were not initialized');

  return {
    ...catalogueCountsCache,
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
  stratum?: string;
  succession?: string;
  role?: string;
  evergreen?: boolean;
  nitrogenFixer?: boolean;
  droughtMinimum?: number;
  evidenceMinimum?: number;
  limit?: number;
  offset?: number;
}) {
  const query = normalizeName(options.query ?? '');
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  const catalogue = loadCatalogue();
  if (!normalizedNamesCache) throw new Error('Catalogue search index was not initialized');
  const results: CatalogueSpecies[] = [];
  let total = 0;
  for (let index = 0; index < catalogue.length; index += 1) {
    const species = catalogue[index];
    if (options.treeOnly && !species.treeLike) continue;
    if (options.globUntOnly && !species.globUnt) continue;
    if (options.designReadyOnly && !species.designReady) continue;
    if (options.stratum && species.stratum !== options.stratum) continue;
    if (options.succession && species.succession !== options.succession) continue;
    if (options.role && !species.roles.some((role) => normalizeName(role) === normalizeName(options.role ?? ''))) continue;
    if (options.evergreen !== undefined && species.evergreen !== options.evergreen) continue;
    if (options.nitrogenFixer !== undefined && species.nitrogenFixer !== options.nitrogenFixer) continue;
    if (options.droughtMinimum !== undefined && (species.droughtTolerance === null || species.droughtTolerance < options.droughtMinimum)) continue;
    if (options.evidenceMinimum !== undefined && species.evidenceCount < options.evidenceMinimum) continue;
    if (query && !normalizedNamesCache[index].includes(query)) continue;
    if (total >= offset && results.length < limit) results.push(species);
    total += 1;
  }

  return {
    total,
    offset,
    limit,
    results,
  };
}
