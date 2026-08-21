import type {
  OperationsArchetypeId,
  OperationsClimateGroup,
  OperationsFrostConstraint,
  SpeciesOperationsRecord,
} from '../types';
import { operationsSourceList } from './operationsSources';

type GroupWindowPolicy = {
  plantStart: number;
  plantEnd: number;
  pruneStart: number | null;
  pruneEnd: number | null;
  frost: OperationsFrostConstraint;
};

const MEDITERRANEAN = [
  'AD', 'AL', 'AU', 'BA', 'CL', 'CY', 'DZ', 'EG', 'EH', 'ES', 'FR', 'GI', 'GR', 'HR', 'IL', 'IT', 'JO', 'LB', 'LY',
  'MA', 'MC', 'ME', 'MK', 'MT', 'PS', 'PT', 'SI', 'SM', 'SY', 'TN', 'TR', 'VA', 'ZA',
] as const;

const TEMPERATE = [
  'AM', 'AR', 'AT', 'AZ', 'BE', 'BG', 'BY', 'CA', 'CH', 'CN', 'CZ', 'DE', 'DK', 'EE', 'FI', 'FO', 'GB', 'GE', 'GG',
  'GL', 'HU', 'IE', 'IM', 'IS', 'JE', 'JP', 'KG', 'KP', 'KR', 'KZ', 'LI', 'LT', 'LU', 'LV', 'MD', 'MN', 'NL', 'NO',
  'NZ', 'PL', 'RO', 'RS', 'RU', 'SE', 'SK', 'TJ', 'TM', 'TW', 'UA', 'US', 'UY', 'UZ', 'XK',
] as const;

const TROPICAL = [
  'AO', 'BD', 'BJ', 'BO', 'BR', 'BN', 'BT', 'BZ', 'CD', 'CF', 'CG', 'CI', 'CM', 'CO', 'CR', 'CU', 'DJ', 'DO', 'EC',
  'ER', 'ET', 'FJ', 'GA', 'GF', 'GH', 'GM', 'GN', 'GP', 'GQ', 'GT', 'GW', 'GY', 'HN', 'HT', 'ID', 'IN', 'JM', 'KE',
  'KH', 'KM', 'LA', 'LK', 'LR', 'MG', 'ML', 'MM', 'MO', 'MQ', 'MR', 'MU', 'MV', 'MX', 'MY', 'MZ', 'NC', 'NE', 'NG',
  'NI', 'NP', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PR', 'PY', 'RE', 'RW', 'SB', 'SC', 'SD', 'SG', 'SL', 'SN', 'SO',
  'SR', 'SS', 'ST', 'SV', 'TD', 'TG', 'TH', 'TL', 'TO', 'TT', 'TZ', 'UG', 'VE', 'VN', 'VU', 'WS', 'YE', 'YT', 'ZM',
] as const;

const ARID_WINTER_RAIN = ['AE', 'AF', 'BH', 'IQ', 'IR', 'KW', 'OM', 'QA', 'SA'] as const;
const HIGHLAND_TEMPERATE = ['BW', 'LS', 'NA', 'SZ', 'ZW'] as const;

const TEMPERATE_WINDOWS: Record<OperationsArchetypeId, GroupWindowPolicy> = {
  'grafted-deciduous-fruit': { plantStart: 2, plantEnd: 4, pruneStart: 12, pruneEnd: 2, frost: 'plant-dormant' },
  'citrus-evergreen': { plantStart: 5, plantEnd: 6, pruneStart: 3, pruneEnd: 4, frost: 'wait-after-frost' },
  'mediterranean-evergreen-crop': { plantStart: 3, plantEnd: 5, pruneStart: 3, pruneEnd: 4, frost: 'wait-after-frost' },
  'forestry-evergreen-climax': { plantStart: 3, plantEnd: 4, pruneStart: 11, pruneEnd: 2, frost: 'plant-dormant' },
  'forestry-deciduous-climax': { plantStart: 3, plantEnd: 4, pruneStart: 12, pruneEnd: 2, frost: 'plant-dormant' },
  'placenta-biomass': { plantStart: 2, plantEnd: 4, pruneStart: 12, pruneEnd: 2, frost: 'plant-dormant' },
  'mediterranean-shrub': { plantStart: 3, plantEnd: 5, pruneStart: 7, pruneEnd: 8, frost: 'wait-after-frost' },
  'climber-vine': { plantStart: 2, plantEnd: 4, pruneStart: 12, pruneEnd: 2, frost: 'plant-dormant' },
  'succulent-cutting': { plantStart: 5, plantEnd: 6, pruneStart: 4, pruneEnd: 5, frost: 'wait-after-frost' },
  'woody-default': { plantStart: 3, plantEnd: 4, pruneStart: 12, pruneEnd: 2, frost: 'plant-dormant' },
};

const TROPICAL_WINDOWS: Record<OperationsArchetypeId, GroupWindowPolicy> = {
  'grafted-deciduous-fruit': { plantStart: 5, plantEnd: 7, pruneStart: 6, pruneEnd: 8, frost: 'unknown' },
  'citrus-evergreen': { plantStart: 4, plantEnd: 6, pruneStart: 2, pruneEnd: 4, frost: 'unknown' },
  'mediterranean-evergreen-crop': { plantStart: 4, plantEnd: 6, pruneStart: 3, pruneEnd: 4, frost: 'unknown' },
  'forestry-evergreen-climax': { plantStart: 4, plantEnd: 6, pruneStart: 11, pruneEnd: 2, frost: 'unknown' },
  'forestry-deciduous-climax': { plantStart: 5, plantEnd: 7, pruneStart: 12, pruneEnd: 2, frost: 'unknown' },
  'placenta-biomass': { plantStart: 4, plantEnd: 6, pruneStart: 12, pruneEnd: 2, frost: 'unknown' },
  'mediterranean-shrub': { plantStart: 4, plantEnd: 6, pruneStart: 7, pruneEnd: 8, frost: 'unknown' },
  'climber-vine': { plantStart: 5, plantEnd: 7, pruneStart: 12, pruneEnd: 2, frost: 'unknown' },
  'succulent-cutting': { plantStart: 4, plantEnd: 6, pruneStart: 3, pruneEnd: 4, frost: 'unknown' },
  'woody-default': { plantStart: 4, plantEnd: 6, pruneStart: 12, pruneEnd: 2, frost: 'unknown' },
};

const GROUP_SOURCE = operationsSourceList('climateGroup');

export const OPERATIONS_COUNTRY_GROUPS: Record<string, OperationsClimateGroup> = buildCountryGroups();

export function normalizeOperationsCountry(countryCode: string | null | undefined): string | null {
  const value = countryCode?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(value) || value === 'XX') return null;
  return value;
}

export function climateGroupForCountry(countryCode: string | null | undefined): OperationsClimateGroup {
  const country = normalizeOperationsCountry(countryCode);
  if (!country) return 'mediterranean';
  return OPERATIONS_COUNTRY_GROUPS[country] ?? 'mediterranean';
}

export function mappedOperationsCountries(): Array<{ countryCode: string; group: OperationsClimateGroup }> {
  return Object.entries(OPERATIONS_COUNTRY_GROUPS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([countryCode, group]) => ({ countryCode, group }));
}

export function applyClimateGroup(
  record: SpeciesOperationsRecord,
  countryCode: string | null | undefined,
): { record: SpeciesOperationsRecord; group: OperationsClimateGroup; matchLevel: 'country-pack' | 'climate-group' } {
  const country = normalizeOperationsCountry(countryCode);
  const group = climateGroupForCountry(country);
  const packId = country ?? record.packId;
  if (group === 'mediterranean') {
    return {
      record: {
        ...record,
        packId,
        limitations: withLimitation(record.limitations, mediterraneanLimitation(country)),
      },
      group,
      matchLevel: country === 'IT' || !country ? 'country-pack' : 'climate-group',
    };
  }
  const policy = (group === 'temperate' ? TEMPERATE_WINDOWS : TROPICAL_WINDOWS)[record.archetypeId];
  return {
    record: {
      ...record,
      packId,
      confidence: group === 'tropical' ? 'low' : record.confidence,
      planting: {
        ...record.planting,
        frostConstraint: policy.frost,
        window: policy.plantStart && policy.plantEnd
          ? {
            startMonth: policy.plantStart,
            endMonth: policy.plantEnd,
            confidence: group === 'tropical' ? 'low' : 'medium',
            sources: GROUP_SOURCE,
          }
          : record.planting.window,
      },
      pruning: {
        ...record.pruning,
        window: policy.pruneStart && policy.pruneEnd
          ? {
            startMonth: policy.pruneStart,
            endMonth: policy.pruneEnd,
            confidence: group === 'tropical' ? 'low' : 'medium',
            sources: GROUP_SOURCE,
          }
          : record.pruning.window,
      },
      sources: uniqueSources([...record.sources, ...GROUP_SOURCE]),
      limitations: withLimitation(record.limitations, groupLimitation(group, packId)),
    },
    group,
    matchLevel: 'climate-group',
  };
}

function buildCountryGroups(): Record<string, OperationsClimateGroup> {
  const groups: Record<string, OperationsClimateGroup> = {};
  const assign = (codes: readonly string[], group: OperationsClimateGroup) => {
    for (const code of codes) {
      if (groups[code]) throw new Error(`Operations country ${code} is assigned to both ${groups[code]} and ${group}.`);
      groups[code] = group;
    }
  };
  assign(MEDITERRANEAN, 'mediterranean');
  assign(TEMPERATE, 'temperate');
  assign(TROPICAL, 'tropical');
  assign(ARID_WINTER_RAIN, 'mediterranean');
  assign(HIGHLAND_TEMPERATE, 'temperate');
  return groups;
}

function mediterraneanLimitation(country: string | null): string | null {
  if (!country || country === 'IT') return null;
  return `Mediterranean climate group applied for ${country}. Winter-planting windows follow the Italy species pack; site climate still shifts the calendar.`;
}

function groupLimitation(group: OperationsClimateGroup, packId: string): string {
  if (group === 'temperate') {
    return `Temperate climate group applied for ${packId}. Planting is shifted to spring after frost risk; this is a planning default, not a national extension calendar.`;
  }
  return `Tropical climate group applied for ${packId}. Windows follow a warm/wet-season planning default with low confidence; local rainy-season timing must be verified.`;
}

function withLimitation(limitations: string[], extra: string | null): string[] {
  if (!extra || limitations.includes(extra)) return [...limitations];
  return [...limitations, extra];
}

function uniqueSources(sources: SpeciesOperationsRecord['sources']): SpeciesOperationsRecord['sources'] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.label}:${source.version}:${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
