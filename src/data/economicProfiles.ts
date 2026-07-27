import type { EconomicConfiguration, StockClass } from '../types';

export const COST_SOURCES = {
  agricultureReference: {
    label: 'Published agricultural installation price reference',
    url: 'https://www.regione.sicilia.it/sites/default/files/2023-08/PREZZARIO%20REGIONALE%20AGRICOLTURA%202023.pdf',
    version: '2023 published reference, normalized to the Growup USD planning basket',
  },
  nurseryRetail: {
    label: 'Published nursery retail comparison',
    url: 'https://www.vivaipiantebaldifranco.it/wp-content/uploads/2025/09/listino-09-09-25.pdf',
    version: '2025-09 published comparison, normalized to USD',
  },
  graftedStockRetail: {
    label: 'Published grafted stock retail comparison',
    url: 'https://www.savinivivai.it/it/shop/piante-da-frutto/piante-di-mandorlo/',
    version: 'accessed 2026-07-21, normalized to USD',
  },
  currencyMap: {
    label: 'ISO country-to-currency dataset',
    url: 'https://country.io/currency.json',
    version: 'live country.io mapping',
  },
  exchangeRates: {
    label: 'USD exchange-rate table',
    url: 'https://open.er-api.com/v6/latest/USD',
    version: 'live ExchangeRate-API open endpoint',
  },
} as const;

export const REFERENCE_STOCK_PRICES: Record<StockClass, { purchasePrice: number; purchasePriceRange: [number, number]; plantingLaborHours: number }> = {
  'forestry-seedling': { purchasePrice: 2.15, purchasePriceRange: [1.4, 2.9], plantingLaborHours: 0.09 },
  'shrub-pot': { purchasePrice: 2.1, purchasePriceRange: [2.1, 6], plantingLaborHours: 0.22 },
  'fruit-grafted': { purchasePrice: 10, purchasePriceRange: [10, 22.9], plantingLaborHours: 0.12 },
  'citrus-grafted': { purchasePrice: 15, purchasePriceRange: [10, 25], plantingLaborHours: 0.12 },
  'large-pot': { purchasePrice: 25, purchasePriceRange: [20, 35], plantingLaborHours: 0.32 },
  cutting: { purchasePrice: 0.52, purchasePriceRange: [0.52, 1.8], plantingLaborHours: 0.09 },
};

export const REFERENCE_IRRIGATION_RATES = {
  pressureCompensatingLateralPerM: 0.69,
  pressureCompensatingEmitterEach: 0.56,
  fittingEach: 0.26,
  endValveEach: 0.94,
  zoneValveEach: 1,
  airReleaseValveEach: 33.35,
  filterEach: 26.1,
  mainlinePerM: 2.22,
  controllerEach: 1932,
  pumpAllowanceEach: 816.49,
  installationLaborHoursPer100M: 3.5,
  annualMaintenanceRate: 0.025,
  pumpEfficiency: 0.62,
} as const;

export const USD_PLANNING_RATES = {
  laborCostPerHour: 18,
  waterCostPerM3: 0.55,
  electricityCostPerKwh: 0.22,
  smallProtectionUnitCost: 2,
  largeProtectionUnitCost: 4,
} as const;

export function defaultEconomicConfiguration(countryCode: string): EconomicConfiguration {
  return convertedEconomicConfiguration(countryCode, 'USD', 1, {
    pricingStatus: 'usd-estimate',
    sourceSummary: 'Global USD planning estimate. A current exchange rate is applied after field analysis; replace rates with local quotes before procurement.',
    sourceVersion: 'Growup USD planning basket v1',
    sourceObservedAt: '2026-07-21T00:00:00.000Z',
    confidence: 'low',
  });
}

export function convertedEconomicConfiguration(
  countryCode: string,
  currencyCode: string,
  exchangeRateToLocal: number,
  source: Pick<EconomicConfiguration, 'pricingStatus' | 'sourceSummary' | 'sourceVersion' | 'sourceObservedAt' | 'confidence'>,
): EconomicConfiguration {
  const normalizedCountry = /^[A-Z]{2}$/.test(countryCode.trim().toUpperCase()) ? countryCode.trim().toUpperCase() : 'XX';
  const normalizedCurrency = /^[A-Z]{3}$/.test(currencyCode.trim().toUpperCase()) ? currencyCode.trim().toUpperCase() : 'USD';
  const rate = Number.isFinite(exchangeRateToLocal) && exchangeRateToLocal > 0 ? exchangeRateToLocal : 1;
  return {
    countryCode: normalizedCountry,
    currencyCode: normalizedCurrency,
    currencyLocale: localeFor(normalizedCountry),
    baseCurrencyCode: 'USD',
    exchangeRateToLocal: round(rate),
    laborCostPerHour: round(USD_PLANNING_RATES.laborCostPerHour * rate),
    waterCostPerM3: round(USD_PLANNING_RATES.waterCostPerM3 * rate),
    electricityCostPerKwh: round(USD_PLANNING_RATES.electricityCostPerKwh * rate),
    plantReferenceMultiplier: round(rate),
    plantUnitCostOverrides: {},
    irrigationReferenceMultiplier: round(rate),
    smallProtectionUnitCost: round(USD_PLANNING_RATES.smallProtectionUnitCost * rate),
    largeProtectionUnitCost: round(USD_PLANNING_RATES.largeProtectionUnitCost * rate),
    missingLocalRates: [],
    ...source,
  };
}

export function normalizeEconomicConfiguration(value: Partial<EconomicConfiguration> | null | undefined, countryCode: string): EconomicConfiguration {
  const defaults = defaultEconomicConfiguration(countryCode);
  if (!value || value.countryCode?.toUpperCase() !== defaults.countryCode) return defaults;
  const numeric = (candidate: unknown, fallback: number) => Number.isFinite(Number(candidate)) && Number(candidate) >= 0 ? Number(candidate) : fallback;
  const plantUnitCostOverrides = Object.fromEntries(
    Object.entries(value.plantUnitCostOverrides && typeof value.plantUnitCostOverrides === 'object' ? value.plantUnitCostOverrides : {})
      .filter(([speciesId, unitCost]) => speciesId.length > 0 && speciesId.length <= 160 && Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0 && Number(unitCost) <= 1_000_000)
      .slice(0, 200)
      .map(([speciesId, unitCost]) => [speciesId, Number(unitCost)]),
  );
  const result: EconomicConfiguration = {
    ...defaults,
    currencyCode: /^[A-Z]{3}$/.test(String(value.currencyCode ?? '').toUpperCase()) ? String(value.currencyCode).toUpperCase() : defaults.currencyCode,
    currencyLocale: typeof value.currencyLocale === 'string' && value.currencyLocale ? value.currencyLocale : defaults.currencyLocale,
    baseCurrencyCode: 'USD',
    exchangeRateToLocal: numeric(value.exchangeRateToLocal, defaults.exchangeRateToLocal),
    laborCostPerHour: numeric(value.laborCostPerHour, defaults.laborCostPerHour),
    waterCostPerM3: numeric(value.waterCostPerM3, defaults.waterCostPerM3),
    electricityCostPerKwh: numeric(value.electricityCostPerKwh, defaults.electricityCostPerKwh),
    plantReferenceMultiplier: numeric(value.plantReferenceMultiplier, defaults.plantReferenceMultiplier),
    plantUnitCostOverrides,
    irrigationReferenceMultiplier: numeric(value.irrigationReferenceMultiplier, defaults.irrigationReferenceMultiplier),
    smallProtectionUnitCost: numeric(value.smallProtectionUnitCost, defaults.smallProtectionUnitCost),
    largeProtectionUnitCost: numeric(value.largeProtectionUnitCost, defaults.largeProtectionUnitCost),
    pricingStatus: value.pricingStatus === 'currency-converted-estimate' || value.pricingStatus === 'usd-estimate' ? value.pricingStatus : 'user-supplied',
    missingLocalRates: [],
    sourceSummary: typeof value.sourceSummary === 'string' && value.sourceSummary ? value.sourceSummary : defaults.sourceSummary,
    sourceVersion: typeof value.sourceVersion === 'string' && value.sourceVersion ? value.sourceVersion : defaults.sourceVersion,
    sourceObservedAt: validDate(value.sourceObservedAt) ? String(value.sourceObservedAt) : defaults.sourceObservedAt,
    confidence: value.confidence === 'medium' || value.confidence === 'high' ? value.confidence : 'low',
  };
  return result;
}

function localeFor(countryCode: string) {
  const candidate = countryCode === 'XX' ? 'en-US' : `en-${countryCode}`;
  try {
    new Intl.NumberFormat(candidate).format(1);
    return candidate;
  } catch {
    return 'en-US';
  }
}

function validDate(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}
