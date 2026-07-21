import { convertedEconomicConfiguration, COST_SOURCES, defaultEconomicConfiguration } from '../src/data/economicProfiles.js';
import type { EconomicConfiguration } from '../src/types.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: EconomicConfiguration }>();

export type EconomicProviderConfig = {
  fetchImpl?: typeof fetch;
  currencyMapUrl?: string;
  exchangeRateUrl?: string;
  now?: () => Date;
};

export async function resolveEconomicConfiguration(countryCode: string | null, config: EconomicProviderConfig = {}): Promise<EconomicConfiguration> {
  const normalizedCountry = countryCode?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(normalizedCountry)) return defaultEconomicConfiguration('');
  const cached = cache.get(normalizedCountry);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, missingLocalRates: [...cached.value.missingLocalRates] };

  const fetchImpl = config.fetchImpl ?? fetch;
  const currencyMapUrl = config.currencyMapUrl ?? process.env.CURRENCY_MAP_URL ?? COST_SOURCES.currencyMap.url;
  const exchangeRateUrl = config.exchangeRateUrl ?? process.env.EXCHANGE_RATE_URL ?? COST_SOURCES.exchangeRates.url;
  try {
    const [currencyResponse, exchangeResponse] = await Promise.all([
      fetchWithTimeout(fetchImpl, currencyMapUrl),
      fetchWithTimeout(fetchImpl, exchangeRateUrl),
    ]);
    if (!currencyResponse.ok || !exchangeResponse.ok) return defaultEconomicConfiguration(normalizedCountry);
    const currencyMap = await currencyResponse.json() as Record<string, unknown>;
    const exchange = await exchangeResponse.json() as { result?: string; time_last_update_utc?: string; rates?: Record<string, unknown> };
    const mappedCurrency = typeof currencyMap[normalizedCountry] === 'string' ? String(currencyMap[normalizedCountry]).toUpperCase() : 'USD';
    const candidateRate = Number(exchange.rates?.[mappedCurrency]);
    const currencyCode = /^[A-Z]{3}$/.test(mappedCurrency) && Number.isFinite(candidateRate) && candidateRate > 0 ? mappedCurrency : 'USD';
    const exchangeRate = currencyCode === 'USD' ? 1 : candidateRate;
    const observedAt = validDate(exchange.time_last_update_utc) ? new Date(String(exchange.time_last_update_utc)).toISOString() : (config.now?.() ?? new Date()).toISOString();
    const value = convertedEconomicConfiguration(normalizedCountry, currencyCode, exchangeRate, {
      pricingStatus: currencyCode === 'USD' ? 'usd-estimate' : 'currency-converted-estimate',
      sourceSummary: 'Global USD planning estimate converted with the current field currency rate. Replace labour, utility and supplier rates with local quotes before procurement.',
      sourceVersion: `${COST_SOURCES.currencyMap.version}; ${COST_SOURCES.exchangeRates.version}`,
      sourceObservedAt: observedAt,
      confidence: currencyCode === 'USD' ? 'low' : 'medium',
    });
    cache.set(normalizedCountry, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return { ...value, missingLocalRates: [...value.missingLocalRates] };
  } catch {
    return defaultEconomicConfiguration(normalizedCountry);
  }
}

function fetchWithTimeout(fetchImpl: typeof fetch, input: string) {
  return fetchImpl(input, { signal: AbortSignal.timeout(15_000) });
}

function validDate(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
