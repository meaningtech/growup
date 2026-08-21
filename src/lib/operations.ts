import { GENUS_ARCHETYPES, OPERATIONS_ARCHETYPES, archetypeForDesignSpecies } from '../data/operationsArchetypes';
import { applyClimateGroup, climateGroupForCountry, normalizeOperationsCountry } from '../data/operationsCountries';
import { ITALY_OPERATIONS_PACK } from '../data/operationsItaly';
import { OPERATIONS_MODEL_VERSION, operationsSourceList } from '../data/operationsSources';
import { daysInUtcMonth, isWaningMoon, moonPhase, utcIsoDate, utcNoon, type MoonPhase } from './lunar';
import type {
  DesignSpecies,
  IrrigationEstimate,
  LayoutVariant,
  MonthWindow,
  OperationsArchetypeId,
  OperationsCalendarEventId,
  OperationsFieldBasis,
  OperationsMatchLevel,
  OperationsStepId,
  OperationsYearPlan,
  OperationsYearTask,
  ProjectOperationsCalendarEvent,
  ProjectOperationsPlan,
  ProjectOperationsSpeciesEntry,
  ResolvedOperationsProfile,
  SiteProfile,
  SpeciesOperationsFields,
  SpeciesOperationsRecord,
  SpeciesSource,
} from '../types';

export { OPERATIONS_MODEL_VERSION } from '../data/operationsSources';

const WOODY_SOURCES = operationsSourceList('italyPlanningDefault', 'embrapaManagement');

export type OperationsIdentity = {
  scientificName: string;
  wfoId?: string | null;
  speciesId?: string | null;
  treeLike?: boolean | null;
  countryCode?: string | null;
  designSpecies?: DesignSpecies | null;
};

export function normalizeTaxonName(value: string): string {
  return value.trim().toLocaleLowerCase('en').replace(/×/g, 'x').replace(/\s+/g, ' ');
}

export function taxonGenus(scientificName: string): string {
  return normalizeTaxonName(scientificName).split(' ')[0] ?? '';
}

export function monthsInWindow(window: MonthWindow): number[] {
  const months: number[] = [];
  let month = window.startMonth;
  for (let step = 0; step < 12; step += 1) {
    months.push(month);
    if (month === window.endMonth) break;
    month = month === 12 ? 1 : month + 1;
  }
  return months;
}

export function shiftMonth(month: number, offset: number): number {
  return ((month - 1 + offset) % 12 + 12) % 12 + 1;
}

export function shiftWindow(window: MonthWindow, offset: number): MonthWindow {
  if (offset % 12 === 0) return { ...window, sources: [...window.sources] };
  return {
    ...window,
    startMonth: shiftMonth(window.startMonth, offset),
    endMonth: shiftMonth(window.endMonth, offset),
    sources: [...window.sources],
  };
}

export function resolveOperationsProfile(identity: OperationsIdentity): ResolvedOperationsProfile {
  const scientificName = identity.scientificName.trim();
  const normalized = normalizeTaxonName(scientificName);
  const italy = ITALY_OPERATIONS_PACK.get(normalized);
  if (italy) {
    const adjusted = applyClimateGroup(italy, identity.countryCode);
    return resolvedFromRecord(adjusted.record, adjusted.matchLevel, identity, adjusted.group);
  }

  const genus = taxonGenus(scientificName);
  const genusArchetype = GENUS_ARCHETYPES[genus];
  if (genusArchetype) {
    return resolvedFromArchetype(scientificName, genusArchetype, 'genus', identity, 'low');
  }

  if (identity.designSpecies) {
    return resolvedFromArchetype(scientificName, archetypeForDesignSpecies(identity.designSpecies), 'archetype', identity, 'low');
  }

  if (identity.treeLike) {
    return resolvedFromArchetype(scientificName, 'woody-default', 'woody-default', identity, 'low');
  }

  return {
    ...emptyFields(),
    modelVersion: OPERATIONS_MODEL_VERSION,
    scientificName,
    wfoId: identity.wfoId ?? null,
    speciesId: identity.speciesId ?? null,
    packId: normalizeOperationsCountry(identity.countryCode),
    climateGroup: climateGroupForCountry(identity.countryCode),
    archetypeId: 'woody-default',
    matchLevel: 'unknown',
    sources: WOODY_SOURCES,
    confidence: 'low',
    unknownFields: ['planting.window', 'pruning.window', 'care.firstYearWater', 'phenology'],
    limitations: [
      'No licensed operations record matched this taxon.',
      'Unknown values stay unknown until a country pack or genus fallback is curated.',
    ],
  };
}

export function buildOperationsPlan(
  profile: SiteProfile,
  variant: LayoutVariant,
  species: DesignSpecies[],
  irrigation: IrrigationEstimate | null,
  generatedAt = profile.generatedAt,
  plantingDate: string | null = null,
): ProjectOperationsPlan {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  for (const tree of variant.trees) counts.set(tree.speciesId, (counts.get(tree.speciesId) ?? 0) + 1);

  const hemisphereOffset = profile.centroid.lat < 0 ? 6 : 0;
  const countryCode = profile.location.countryCode;
  const plantedOn = normalizePlantingDate(plantingDate);
  const warnings: string[] = [];
  const sourceMap = new Map<string, SpeciesSource>();
  const calendar: ProjectOperationsCalendarEvent[] = [];
  const entries = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([speciesId, count]) => {
      const item = speciesById.get(speciesId);
      if (!item) {
        warnings.push(`Operations plan skipped unknown species ${speciesId}.`);
        return null;
      }
      const resolved = resolveOperationsProfile({
        scientificName: item.scientificName,
        speciesId: item.id,
        treeLike: item.treeLike,
        countryCode,
        designSpecies: item,
      });
      const basis: OperationsFieldBasis[] = matchBasis(resolved.matchLevel);
      const planting = adjustPlantingWindow(resolved.planting.window, resolved.planting.frostConstraint, profile, hemisphereOffset, warnings, item.scientificName);
      const pruning = resolved.pruning.window ? shiftWindow(resolved.pruning.window, hemisphereOffset) : null;
      if (planting) basis.push('site-climate');
      if (resolved.matchLevel === 'climate-group' && resolved.climateGroup && resolved.climateGroup !== 'mediterranean') {
        warnings.push(`${resolved.climateGroup[0]!.toUpperCase()}${resolved.climateGroup.slice(1)} climate group applied for ${resolved.packId ?? countryCode}; planting windows follow that group, then site climate.`);
      }
      for (const source of resolved.sources) sourceMap.set(`${source.label}:${source.version}`, source);

      if (plantedOn && planting && !monthsInWindow(planting).includes(Number(plantedOn.slice(5, 7)))) {
        warnings.push(`${item.scientificName} planting window does not include ${plantedOn}.`);
      }
      pushSpeciesCalendar(calendar, item.id, item.scientificName, planting, pruning, resolved, irrigation, plantedOn);
      if (resolved.pruning.style) {
        for (const source of operationsSourceList('lunarPruningTradition')) sourceMap.set(`${source.label}:${source.version}`, source);
      }
      return {
        speciesId: item.id,
        scientificName: item.scientificName,
        count,
        profile: resolved,
        resolvedPlantingWindow: planting,
        resolvedPruningWindow: pruning,
        basis: [...new Set(basis)],
        confidence: resolved.confidence,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  calendar.sort((left, right) => {
    const leftDate = left.startDate ?? '';
    const rightDate = right.startDate ?? '';
    return leftDate.localeCompare(rightDate) || left.yearOffset - right.yearOffset || left.month - right.month || (left.speciesId ?? '').localeCompare(right.speciesId ?? '') || left.event.localeCompare(right.event);
  });

  return {
    modelVersion: OPERATIONS_MODEL_VERSION,
    generatedAt,
    plantingDate: plantedOn,
    packId: normalizeOperationsCountry(countryCode) ?? entries[0]?.profile.packId ?? null,
    siteCountryCode: countryCode,
    species: entries,
    calendar,
    warnings: [...new Set(warnings)],
    sources: [...sourceMap.values()],
  };
}

export function normalizeOperationsPlan(value: ProjectOperationsPlan | null | undefined): ProjectOperationsPlan | null {
  if (!value || value.modelVersion !== OPERATIONS_MODEL_VERSION) return value ?? null;
  return {
    ...value,
    plantingDate: normalizePlantingDate(value.plantingDate),
    species: value.species.map((entry) => ({ ...entry, profile: { ...entry.profile, sources: [...entry.profile.sources] } })),
    calendar: value.calendar.map((event) => ({
      ...event,
      startDate: normalizePlantingDate(event.startDate) ?? event.startDate ?? null,
      endDate: normalizePlantingDate(event.endDate) ?? event.endDate ?? null,
    })),
    warnings: [...value.warnings],
    sources: [...value.sources],
  };
}

export function normalizePlantingDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const iso = utcIsoDate(year, month, day);
  return iso === value ? iso : null;
}

function resolvedFromRecord(record: SpeciesOperationsRecord, matchLevel: OperationsMatchLevel, identity: OperationsIdentity, climateGroup = climateGroupForCountry(identity.countryCode)): ResolvedOperationsProfile {
  return {
    ...cloneFields(record),
    modelVersion: OPERATIONS_MODEL_VERSION,
    scientificName: record.scientificName,
    wfoId: record.wfoId ?? identity.wfoId ?? null,
    speciesId: record.speciesId ?? identity.speciesId ?? identity.designSpecies?.id ?? null,
    packId: record.packId,
    climateGroup,
    archetypeId: record.archetypeId,
    matchLevel,
    sources: [...record.sources],
    confidence: record.confidence,
    unknownFields: unknownFieldsOf(record),
  };
}

function resolvedFromArchetype(
  scientificName: string,
  archetypeId: OperationsArchetypeId,
  matchLevel: OperationsMatchLevel,
  identity: OperationsIdentity,
  confidence: ResolvedOperationsProfile['confidence'],
): ResolvedOperationsProfile {
  const fields = OPERATIONS_ARCHETYPES[archetypeId];
  return {
    ...cloneFields(fields),
    modelVersion: OPERATIONS_MODEL_VERSION,
    scientificName,
    wfoId: identity.wfoId ?? null,
    speciesId: identity.speciesId ?? identity.designSpecies?.id ?? null,
    packId: normalizeOperationsCountry(identity.countryCode),
    climateGroup: climateGroupForCountry(identity.countryCode),
    archetypeId,
    matchLevel,
    sources: WOODY_SOURCES,
    confidence,
    unknownFields: unknownFieldsOf(fields),
    limitations: [
      ...fields.limitations,
      matchLevel === 'genus'
        ? `Genus ${taxonGenus(scientificName)} fallback. Species-specific care remains unverified.`
        : 'Archetype planning default. Species-specific care remains unverified.',
    ],
  };
}

function cloneFields(fields: SpeciesOperationsFields): SpeciesOperationsFields {
  return {
    planting: { ...fields.planting, steps: [...fields.planting.steps], window: cloneWindow(fields.planting.window) },
    pruning: { ...fields.pruning, window: cloneWindow(fields.pruning.window) },
    care: { ...fields.care, notes: [...fields.care.notes] },
    phenology: {
      leafOut: cloneWindow(fields.phenology.leafOut),
      flowering: cloneWindow(fields.phenology.flowering),
      harvest: cloneWindow(fields.phenology.harvest),
      leafFall: cloneWindow(fields.phenology.leafFall),
    },
    limitations: [...fields.limitations],
  };
}

function cloneWindow(window: MonthWindow | null): MonthWindow | null {
  return window ? { ...window, sources: [...window.sources] } : null;
}

function emptyFields(): SpeciesOperationsFields {
  return {
    planting: { window: null, method: null, holeWidthM: null, holeDepthM: null, establishmentYears: 3, frostConstraint: 'unknown', steps: [] },
    pruning: { style: null, phenologyAnchor: null, window: null, frequency: null, productivePruningExcluded: true },
    care: { firstYearWater: null, mulch: null, guards: null, notes: [] },
    phenology: { leafOut: null, flowering: null, harvest: null, leafFall: null },
    limitations: [],
  };
}

function unknownFieldsOf(fields: SpeciesOperationsFields): string[] {
  const unknown: string[] = [];
  if (!fields.planting.window) unknown.push('planting.window');
  if (!fields.pruning.window) unknown.push('pruning.window');
  if (!fields.pruning.style) unknown.push('pruning.style');
  if (!fields.care.firstYearWater) unknown.push('care.firstYearWater');
  if (!fields.phenology.flowering && !fields.phenology.harvest) unknown.push('phenology');
  return unknown;
}

function matchBasis(level: OperationsMatchLevel): OperationsFieldBasis[] {
  if (level === 'country-pack') return ['species-record'];
  if (level === 'genus') return ['genus'];
  return ['archetype'];
}

function adjustPlantingWindow(
  window: MonthWindow | null,
  frostConstraint: ResolvedOperationsProfile['planting']['frostConstraint'],
  profile: SiteProfile,
  hemisphereOffset: number,
  warnings: string[],
  scientificName: string,
): MonthWindow | null {
  if (!window) return null;
  let adjusted = shiftWindow(window, hemisphereOffset);
  const monthly = profile.climate.monthly;
  if (monthly.length !== 12) return adjusted;
  let months = monthsInWindow(adjusted);
  if (frostConstraint === 'wait-after-frost' || profile.fieldConditions?.frostRisk === 'high') {
    const coldest = monthly.reduce((min, row) => row.temperatureC < min.temperatureC ? row : min);
    months = months.filter((month) => {
      const row = monthly[month - 1];
      return row && row.temperatureC > coldest.temperatureC + 2;
    });
  }
  if (frostConstraint === 'autumn-evergreen-ok') {
    const wet = months.filter((month) => {
      const row = monthly[month - 1];
      return row && row.precipitationMm >= row.et0Mm * 0.45;
    });
    if (wet.length > 0) months = wet;
  }
  if (months.length === 0) {
    warnings.push(`Site climate left no safe planting month inside the ${scientificName} window; the source window is retained.`);
    return adjusted;
  }
  return {
    ...adjusted,
    startMonth: months[0],
    endMonth: months[months.length - 1],
    confidence: months.length === monthsInWindow(adjusted).length ? adjusted.confidence : 'low',
  };
}

function pushSpeciesCalendar(
  calendar: ProjectOperationsCalendarEvent[],
  speciesId: string,
  scientificName: string,
  planting: MonthWindow | null,
  pruning: MonthWindow | null,
  profile: ResolvedOperationsProfile,
  irrigation: IrrigationEstimate | null,
  plantingDate: string | null,
) {
  const plantMonths = planting ? monthsInWindow(planting) : [];
  if (plantingDate) {
    const planted = civilParts(plantingDate);
    pushDated(calendar, plantingDate, plantingDate, 'plant', speciesId, scientificName, 'care.event.plant', profile.matchLevel === 'country-pack' ? 'species-record' : 'archetype', profile.confidence, plantingDate);
    if (profile.care.mulch) pushDated(calendar, plantingDate, plantingDate, 'mulch', speciesId, scientificName, 'care.event.mulch', 'archetype', profile.confidence, plantingDate);
    if (profile.care.guards) pushDated(calendar, plantingDate, plantingDate, 'guard-check', speciesId, scientificName, 'care.event.guard-check', 'archetype', profile.confidence, plantingDate);
  } else {
    for (const month of plantMonths) {
      pushEvent(calendar, 0, month, 'plant', speciesId, scientificName, 'care.event.plant', profile.matchLevel === 'country-pack' ? 'species-record' : 'archetype', profile.confidence);
      if (profile.care.mulch) pushEvent(calendar, 0, month, 'mulch', speciesId, scientificName, 'care.event.mulch', 'archetype', profile.confidence);
      if (profile.care.guards) pushEvent(calendar, 0, month, 'guard-check', speciesId, scientificName, 'care.event.guard-check', 'archetype', profile.confidence);
    }
  }

  const dryMonths = irrigation
    ? irrigation.monthly.filter((row) => row.grossM3 > 0).map((row) => row.month)
    : [];
  if (profile.care.firstYearWater === 'critical' || profile.care.firstYearWater === 'moderate') {
    for (const month of dryMonths) {
      for (let year = 0; year < profile.planting.establishmentYears; year += 1) {
        if (plantingDate) {
          const civil = addYearsToMonth(firstMonthOnOrAfter(plantingDate, month), year);
          const start = clipAfter(utcIsoDate(civil.year, civil.month, 1), plantingDate);
          const end = utcIsoDate(civil.year, civil.month, daysInUtcMonth(civil.year, civil.month));
          if (end < plantingDate) continue;
          if (start >= addUtcYears(plantingDate, profile.planting.establishmentYears)) continue;
          pushDated(calendar, start, end, 'water-check', speciesId, scientificName, 'care.event.water-check', 'irrigation-model', irrigation?.satelliteScheduling.confidence ?? 'medium', plantingDate);
        } else {
          pushEvent(calendar, year, month, 'water-check', speciesId, scientificName, 'care.event.water-check', 'irrigation-model', irrigation?.satelliteScheduling.confidence ?? 'medium');
        }
      }
    }
  }

  const pruneMonths = pruning ? monthsInWindow(pruning) : [];
  const pruneYears = pruneYearOffsets(profile.pruning.frequency, profile.archetypeId);
  for (const year of pruneYears) {
    for (const month of pruneMonths) {
      const event = profile.pruning.style === 'coppice' || profile.pruning.style === 'pollard' ? 'coppice' : year === 0 ? 'train' : 'prune';
      const basis = profile.pruning.window ? 'species-record' : 'archetype';
      if (plantingDate) {
        const civil = addYearsToMonth(firstMonthOnOrAfter(plantingDate, month), year);
        const start = clipAfter(utcIsoDate(civil.year, civil.month, 1), plantingDate);
        const end = utcIsoDate(civil.year, civil.month, daysInUtcMonth(civil.year, civil.month));
        if (end < plantingDate) continue;
        pushDated(calendar, start, end, event, speciesId, scientificName, `care.event.${event}`, basis, profile.confidence, plantingDate);
      } else {
        pushEvent(calendar, year, month, event, speciesId, scientificName, `care.event.${event}`, basis, profile.confidence);
      }
    }
  }
}

export const OPERATIONS_YEAR_TASK_ORDER: OperationsCalendarEventId[] = ['plant', 'water-check', 'train', 'prune', 'coppice'];
const PLANT_COMPANIONS: OperationsCalendarEventId[] = ['mulch', 'guard-check'];
const LUNAR_WANING_EVENTS = new Set<OperationsCalendarEventId>(['train', 'prune', 'coppice']);
const GENERIC_LIMITATION = /planning estimate|cultivar-specific prescription|local agronomist|italy operations pack|site climate still shifts/i;

export function groupOperationsByYear(
  events: ProjectOperationsCalendarEvent[],
  species: ProjectOperationsSpeciesEntry[],
): OperationsYearPlan[] {
  const counts = new Map(species.map((entry) => [entry.speciesId, { scientificName: entry.scientificName, count: entry.count }]));
  const offsets = [...new Set(events.map((event) => event.yearOffset))].sort((left, right) => left - right);
  return offsets.map((yearOffset) => {
    const ofYear = events.filter((event) => event.yearOffset === yearOffset);
    const plantMonths = uniqueMonths(ofYear.filter((event) => event.event === 'plant'));
    const tasks = OPERATIONS_YEAR_TASK_ORDER.flatMap((event): OperationsYearTask[] => {
      const rows = ofYear.filter((item) => item.event === event);
      if (rows.length === 0) return [];
      const months = uniqueMonths(rows);
      const overlappingPlantMonths = event === 'water-check' ? months.filter((month) => plantMonths.includes(month)) : [];
      const companionEvents = event === 'plant'
        ? [
          ...PLANT_COMPANIONS.filter((companion) => ofYear.some((item) => item.event === companion)),
          ...(ofYear.some((item) => item.event === 'water-check' && plantMonths.includes(item.month)) ? ['water-check' as const] : []),
        ]
        : [];
      return [{
        event,
        months,
        species: uniqueSpecies(rows, counts),
        lunarCue: LUNAR_WANING_EVENTS.has(event) ? 'waning' : null,
        companionEvents,
        overlappingPlantMonths,
      }];
    });
    return { year: yearOffset + 1, yearOffset, tasks };
  });
}

function uniqueMonths(events: ProjectOperationsCalendarEvent[]): number[] {
  return [...new Set(events.map((event) => event.month))].sort((left, right) => left - right);
}

function uniqueSpecies(
  events: ProjectOperationsCalendarEvent[],
  counts: Map<string, { scientificName: string; count: number }>,
): OperationsYearTask['species'] {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    if (!event.speciesId || seen.has(event.speciesId)) return [];
    seen.add(event.speciesId);
    const known = counts.get(event.speciesId);
    return [{ speciesId: event.speciesId, scientificName: event.scientificName ?? known?.scientificName ?? event.speciesId, count: known?.count ?? 0 }];
  });
}

function pruneYearOffsets(frequency: ResolvedOperationsProfile['pruning']['frequency'], archetypeId: OperationsArchetypeId): number[] {
  if (archetypeId === 'placenta-biomass' || frequency === 'every-3-years') return [3, 6, 9];
  if (frequency === 'biennial') return [1, 3, 5];
  if (frequency === 'as-needed') return [1, 5];
  return [0, 1, 2, 5];
}

function pushEvent(
  calendar: ProjectOperationsCalendarEvent[],
  yearOffset: number,
  month: number,
  event: ProjectOperationsCalendarEvent['event'],
  speciesId: string | null,
  scientificName: string | null,
  titleKey: string,
  basis: OperationsFieldBasis,
  confidence: ProjectOperationsCalendarEvent['confidence'],
  startDate: string | null = null,
  endDate: string | null = null,
) {
  calendar.push({ yearOffset, month, startDate, endDate, event, speciesId, scientificName, titleKey, basis, confidence });
}

function pushDated(
  calendar: ProjectOperationsCalendarEvent[],
  startDate: string,
  endDate: string,
  event: ProjectOperationsCalendarEvent['event'],
  speciesId: string | null,
  scientificName: string | null,
  titleKey: string,
  basis: OperationsFieldBasis,
  confidence: ProjectOperationsCalendarEvent['confidence'],
  plantingDate: string,
) {
  const parts = civilParts(startDate);
  pushEvent(calendar, yearOffsetFrom(plantingDate, startDate), parts.month, event, speciesId, scientificName, titleKey, basis, confidence, startDate, endDate);
}

export type OperationsMonthCell = {
  isoDate: string;
  day: number;
  inMonth: boolean;
  moon: MoonPhase;
  waning: boolean;
  events: OperationsCalendarEventId[];
};

export function eventOverlapsDay(event: ProjectOperationsCalendarEvent, isoDate: string): boolean {
  if (!event.startDate || !event.endDate) return false;
  return event.startDate <= isoDate && isoDate <= event.endDate;
}

export function eventOverlapsMonth(event: ProjectOperationsCalendarEvent, year: number, month: number): boolean {
  if (!event.startDate || !event.endDate) return false;
  const start = utcIsoDate(year, month, 1);
  const end = utcIsoDate(year, month, daysInUtcMonth(year, month));
  return event.startDate <= end && event.endDate >= start;
}

export function buildOperationsMonthGrid(
  year: number,
  month: number,
  events: ProjectOperationsCalendarEvent[],
): OperationsMonthCell[] {
  const first = utcNoon(utcIsoDate(year, month, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const days = daysInUtcMonth(year, month);
  const cells: OperationsMonthCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(year, month - 1, 1 - leading + index, 12));
    const isoDate = date.toISOString().slice(0, 10);
    const inMonth = date.getUTCMonth() === month - 1;
    const ofDay = events.filter((event) => eventOverlapsDay(event, isoDate)).map((event) => event.event);
    cells.push({
      isoDate,
      day: date.getUTCDate(),
      inMonth,
      moon: moonPhase(date),
      waning: isWaningMoon(date),
      events: [...new Set(ofDay)],
    });
  }
  return cells;
}

export function monthTasks(
  events: ProjectOperationsCalendarEvent[],
  species: ProjectOperationsSpeciesEntry[],
  year: number,
  month: number,
): OperationsYearTask[] {
  const ofMonth = events.filter((event) => eventOverlapsMonth(event, year, month));
  const counts = new Map(species.map((entry) => [entry.speciesId, { scientificName: entry.scientificName, count: entry.count }]));
  const plantMonths = uniqueMonths(ofMonth.filter((event) => event.event === 'plant'));
  return OPERATIONS_YEAR_TASK_ORDER.flatMap((event): OperationsYearTask[] => {
    const rows = ofMonth.filter((item) => item.event === event);
    if (rows.length === 0) return [];
    return [{
      event,
      months: uniqueMonths(rows),
      species: uniqueSpecies(rows, counts),
      lunarCue: LUNAR_WANING_EVENTS.has(event) ? 'waning' : null,
      companionEvents: event === 'plant'
        ? PLANT_COMPANIONS.filter((companion) => ofMonth.some((item) => item.event === companion))
        : [],
      overlappingPlantMonths: event === 'water-check' ? uniqueMonths(rows).filter((item) => plantMonths.includes(item)) : [],
    }];
  });
}

export function speciesSpecificLimitations(limitations: string[]): string[] {
  return limitations.filter((item) => !GENERIC_LIMITATION.test(item));
}

export function stepsForCalendarEvent(entry: ProjectOperationsSpeciesEntry, event: OperationsCalendarEventId): OperationsStepId[] {
  const planting = entry.profile.planting.steps;
  const notes = entry.profile.care.notes;
  if (event === 'plant') return planting;
  if (event === 'mulch') {
    const mulch = [...notes, ...planting].filter((step) => step.includes('mulch'));
    return [...new Set(mulch)];
  }
  if (event === 'guard-check') return notes.filter((step) => step.includes('guard'));
  if (event === 'water-check') return notes.filter((step) => step.includes('water'));
  if (event === 'coppice') return notes.filter((step) => step.startsWith('coppice.') || step.startsWith('prune.'));
  if (event === 'train' || event === 'prune') return notes.filter((step) => step.startsWith('prune.'));
  return [];
}

export function addUtcYears(isoDate: string, years: number): string {
  const parts = civilParts(isoDate);
  const day = Math.min(parts.day, daysInUtcMonth(parts.year + years, parts.month));
  return utcIsoDate(parts.year + years, parts.month, day);
}

function firstMonthOnOrAfter(isoDate: string, month: number): { year: number; month: number } {
  const parts = civilParts(isoDate);
  if (month >= parts.month) return { year: parts.year, month };
  return { year: parts.year + 1, month };
}

function addYearsToMonth(value: { year: number; month: number }, years: number): { year: number; month: number } {
  return { year: value.year + years, month: value.month };
}

function yearOffsetFrom(plantingDate: string, isoDate: string): number {
  const planted = civilParts(plantingDate);
  const event = civilParts(isoDate);
  let years = event.year - planted.year;
  if (event.month < planted.month || (event.month === planted.month && event.day < planted.day)) years -= 1;
  return Math.max(0, years);
}

function civilParts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function clipAfter(isoDate: string, earliest: string): string {
  return isoDate < earliest ? earliest : isoDate;
}
