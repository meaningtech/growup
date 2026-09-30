import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { normalizeScientificName, scientificNameTokens } from '../src/lib/scientificName.js';
import type { CatalogueSpecies } from '../src/types.js';

const SWITCHBOARD_PATH = fileURLToPath(
  new URL('../data/sources/switchboard-4/Switchboard_species.txt', import.meta.url),
);
const GLOBUNT_PATH = fileURLToPath(
  new URL('../data/sources/globunt-2023/GlobUNT_Species_2023.txt', import.meta.url),
);

let catalogueCache: CatalogueSpecies[] | null = null;
let globUntCache: Set<string> | null = null;
let nameIndexCache: Array<{ normalized: string; tokens: string[] }> | null = null;
let catalogueCountsCache: { total: number; treeLike: number; globUnt: number } | null = null;

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
}

function indexedNameRank(entry: { normalized: string; tokens: string[] }, query: string, queryTokens: string[]): number | null {
  if (entry.normalized === query) return 0;
  if (entry.normalized.startsWith(`${query} `)) return 1;
  if (!queryTokens.length || queryTokens.length > entry.tokens.length) return null;
  for (let start = 0; start <= entry.tokens.length - queryTokens.length; start += 1) {
    const matches = queryTokens.every((token, index) => entry.tokens[start + index].startsWith(token));
    if (!matches) continue;
    return start === 0 ? 2 : 3;
  }
  return null;
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
      .map((line) => normalizeScientificName(line.split('|')[speciesIndex] ?? ''))
      .filter(Boolean),
  );

  return globUntCache;
}

export function loadCatalogue(): CatalogueSpecies[] {
  if (catalogueCache) return catalogueCache;

  const globUnt = parseGlobUnt();
  const designReady = new Map(DESIGN_SPECIES.map((species) => [normalizeScientificName(species.scientificName), species]));
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

  const nameIndex: Array<{ normalized: string; tokens: string[] }> = [];
  let treeLikeCount = 0;
  let globUntCount = 0;
  catalogueCache = lines.filter(Boolean).map((line) => {
    const fields = line.split('|');
    const scientificName = fields[species] ?? '';
    const normalized = normalizeScientificName(scientificName);
    const designSpecies = designReady.get(normalized);
    const treeLike = fields[tree] === 'YES';
    const isGlobUnt = globUnt.has(normalized);
    nameIndex.push({ normalized, tokens: scientificNameTokens(scientificName) });
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
  nameIndexCache = nameIndex;
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
  const query = normalizeScientificName(options.query ?? '');
  const queryTokens = query ? query.split(/[\s-]+/).filter(Boolean) : [];
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  const catalogue = loadCatalogue();
  if (!nameIndexCache) throw new Error('Catalogue search index was not initialized');
  const matches: Array<{ species: CatalogueSpecies; rank: number; name: string }> = [];
  for (let index = 0; index < catalogue.length; index += 1) {
    const species = catalogue[index];
    if (options.treeOnly && !species.treeLike) continue;
    if (options.globUntOnly && !species.globUnt) continue;
    if (options.designReadyOnly && !species.designReady) continue;
    if (options.stratum && species.stratum !== options.stratum) continue;
    if (options.succession && species.succession !== options.succession) continue;
    if (options.role && !species.roles.some((role) => normalizeLabel(role) === normalizeLabel(options.role ?? ''))) continue;
    if (options.evergreen !== undefined && species.evergreen !== options.evergreen) continue;
    if (options.nitrogenFixer !== undefined && species.nitrogenFixer !== options.nitrogenFixer) continue;
    if (options.droughtMinimum !== undefined && (species.droughtTolerance === null || species.droughtTolerance < options.droughtMinimum)) continue;
    if (options.evidenceMinimum !== undefined && species.evidenceCount < options.evidenceMinimum) continue;
    const entry = nameIndexCache[index];
    const rank = query ? indexedNameRank(entry, query, queryTokens) : 1;
    if (rank === null) continue;
    matches.push({ species, rank, name: entry.normalized });
  }
  if (query) matches.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name, 'en'));
  const results = matches.slice(offset, offset + limit).map((match) => match.species);
  const total = matches.length;

  return {
    total,
    offset,
    limit,
    results,
  };
}
