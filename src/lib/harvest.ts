import { HARVEST_BY_SPECIES_ID, HARVEST_CATALOGUE, HARVEST_PRICE_SOURCES, HARVEST_USD_PER_KG } from '../data/harvestCatalogue';
import { HARVEST_MODEL_VERSION, harvestSourceList } from '../data/harvestSources';
import type {
  DesignSpecies,
  EconomicConfiguration,
  HarvestProductId,
  HarvestYearPlan,
  HarvestYearRow,
  IrrigationEstimate,
  LayoutVariant,
  ProjectHarvestPlan,
  SpeciesSource,
} from '../types';
import { growthState } from './growth';

export { HARVEST_MODEL_VERSION } from '../data/harvestSources';

export const HARVEST_HORIZON_YEARS = 30;

export function normalizeHarvestPriceOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0 && entry[1] <= 1_000_000)
    .map(([id, price]) => [id, roundMoney(price)]));
}

export function normalizeHarvestPlan(value: ProjectHarvestPlan | null | undefined): ProjectHarvestPlan | null {
  if (!value || value.modelVersion !== HARVEST_MODEL_VERSION) return value ?? null;
  return {
    ...value,
    priceOverrides: normalizeHarvestPriceOverrides(value.priceOverrides),
    years: value.years.map((year) => ({ ...year, rows: year.rows.map((row) => ({ ...row })) })),
    current: { ...value.current, rows: value.current.rows.map((row) => ({ ...row })) },
    sources: [...value.sources],
    warnings: [...value.warnings],
  };
}

export function unitPriceLocal(
  productId: HarvestProductId,
  economics: EconomicConfiguration,
  overrides: Record<string, number>,
): number {
  if (overrides[productId] != null) return roundMoney(overrides[productId]);
  return roundMoney(HARVEST_USD_PER_KG[productId] * economics.exchangeRateToLocal);
}

export function buildHarvestPlan(
  variant: LayoutVariant,
  species: DesignSpecies[],
  economics: EconomicConfiguration,
  irrigation: IrrigationEstimate | null,
  year = 10,
  overrides: Record<string, number> = {},
  generatedAt = new Date().toISOString(),
): ProjectHarvestPlan {
  const prices = normalizeHarvestPriceOverrides(overrides);
  const irrigated = Boolean(irrigation && irrigation.annualWaterM3 > 0);
  const sourceMap = new Map<string, SpeciesSource>();
  for (const source of HARVEST_PRICE_SOURCES) sourceMap.set(`${source.label}:${source.version}`, source);
  const warnings: string[] = [];
  const years = Array.from({ length: HARVEST_HORIZON_YEARS }, (_, index) => {
    const planYear = index + 1;
    return harvestYear(variant, species, economics, prices, irrigated, planYear, sourceMap, warnings);
  });
  const current = years.find((item) => item.year === year) ?? years[Math.min(years.length, Math.max(1, year)) - 1]!;
  if ([...new Set(variant.trees.map((tree) => tree.speciesId))].some((id) => !HARVEST_BY_SPECIES_ID.has(id))) {
    warnings.push('Some planted species have no curated harvest record and stay unknown.');
  }
  warnings.push('Per-tree mixed-system planning estimate, not a dedicated grove, mill or winery yield.');
  return {
    modelVersion: HARVEST_MODEL_VERSION,
    generatedAt,
    year: current.year,
    irrigated,
    priceOverrides: prices,
    years,
    current,
    sources: [...sourceMap.values()],
    warnings: [...new Set(warnings)],
  };
}

function harvestYear(
  variant: LayoutVariant,
  species: DesignSpecies[],
  economics: EconomicConfiguration,
  overrides: Record<string, number>,
  irrigated: boolean,
  year: number,
  sourceMap: Map<string, SpeciesSource>,
  warnings: string[],
): HarvestYearPlan {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  for (const tree of variant.trees) {
    const item = speciesById.get(tree.speciesId);
    if (!item) continue;
    if (!HARVEST_BY_SPECIES_ID.has(item.id)) {
      unknown.add(item.id);
      continue;
    }
    if (!growthState(item, tree, year).active) continue;
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  }

  const rows: HarvestYearRow[] = [];
  for (const [speciesId, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const item = speciesById.get(speciesId)!;
    const record = HARVEST_BY_SPECIES_ID.get(speciesId)!;
    const age = year;
    const fraction = bearingFraction(age, item.productiveFromYear, record.plateauYear);
    const water = irrigated ? record.irrigatedFactor : 1;
    if (record.bearing === 'alternate' && fraction > 0) {
      warnings.push(`${item.scientificName} is alternate-bearing; the low–high band covers on-year and off-year crops.`);
    }
    const primary = new Map<HarvestProductId, { low: number; base: number; high: number }>();
    for (const product of record.products) {
      for (const source of product.sources) sourceMap.set(`${source.label}:${source.version}`, source);
      let low: number;
      let base: number;
      let high: number;
      if (product.conversionFrom) {
        const parent = primary.get(product.conversionFrom.productId);
        if (!parent) continue;
        low = parent.low * product.conversionFrom.ratio;
        base = parent.base * product.conversionFrom.ratio;
        high = parent.high * product.conversionFrom.ratio;
      } else {
        low = product.kgPerTreeMature.low * fraction * count;
        base = product.kgPerTreeMature.base * fraction * water * count;
        high = product.kgPerTreeMature.high * fraction * water * count;
        primary.set(product.id, { low, base, high });
      }
      const price = unitPriceLocal(product.id, economics, overrides);
      const kgLow = roundKg(low);
      const kgBase = roundKg(base);
      const kgHigh = roundKg(high);
      rows.push({
        speciesId,
        scientificName: item.scientificName,
        count,
        productId: product.id,
        derived: Boolean(product.conversionFrom),
        kgLow,
        kgBase,
        kgHigh,
        valueLow: roundMoney(kgLow * price),
        valueBase: roundMoney(kgBase * price),
        valueHigh: roundMoney(kgHigh * price),
        unitPriceLocal: price,
        confidence: product.confidence,
      });
    }
  }

  const primaries = rows.filter((row) => !row.derived);
  return {
    year,
    rows,
    kgBase: roundKg(primaries.reduce((sum, row) => sum + row.kgBase, 0)),
    valueBase: roundMoney(rows.reduce((sum, row) => sum + row.valueBase, 0)),
    unknownSpecies: unknown.size,
  };
}

function bearingFraction(year: number, productiveFromYear: number | null, plateauYear: number): number {
  if (productiveFromYear == null || year < productiveFromYear) return 0;
  if (year >= plateauYear) return 1;
  const span = Math.max(1, plateauYear - productiveFromYear);
  return (year - productiveFromYear + 1) / (span + 1);
}

function roundKg(value: number) { return Number(value.toFixed(1)); }
function roundMoney(value: number) { return Number(value.toFixed(2)); }

export function harvestSourceCatalog() {
  return harvestSourceList('faoPaper66', 'iocOilRatio', 'faoOliveChapter', 'batlleCarob', 'desertAdaptCarob', 'calabriaLcc', 'oivWine', 'ismeaOilPrice', 'faostatContext');
}

export { HARVEST_CATALOGUE };
