const HYBRID_MARK = /[×✕✖]/g;

export function normalizeScientificName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(HYBRID_MARK, ' ')
    .replace(/\bx\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scientificNameTokens(value: string): string[] {
  return normalizeScientificName(value).split(/[\s-]+/).filter(Boolean);
}

/** Lower rank is a closer match. `null` means the name does not match. */
export function scientificNameMatchRank(name: string, query: string): number | null {
  const normalizedQuery = normalizeScientificName(query);
  if (!normalizedQuery) return null;
  const normalizedName = normalizeScientificName(name);
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(`${normalizedQuery} `)) return 1;
  const nameTokens = normalizedName.split(/[\s-]+/).filter(Boolean);
  const queryTokens = normalizedQuery.split(/[\s-]+/).filter(Boolean);
  if (!queryTokens.length || queryTokens.length > nameTokens.length) return null;
  for (let start = 0; start <= nameTokens.length - queryTokens.length; start += 1) {
    const matches = queryTokens.every((token, index) => nameTokens[start + index].startsWith(token));
    if (!matches) continue;
    return start === 0 ? 2 : 3;
  }
  return null;
}

export function scientificNameMatches(name: string, query: string): boolean {
  return scientificNameMatchRank(name, query) !== null;
}

function foldCommonName(value: string, locale: string): string {
  return value
    .trim()
    .toLocaleLowerCase(locale)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function commonNameMatches(name: string, query: string, locale = 'en'): boolean {
  const foldedQuery = foldCommonName(query, locale);
  if (!foldedQuery) return false;
  const foldedName = foldCommonName(name, locale);
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(foldedQuery)}(?![\\p{L}\\p{N}])`, 'u');
  return pattern.test(foldedName);
}
