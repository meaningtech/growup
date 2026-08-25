import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import type { CatalogueSpecies, DesignSpecies, SpeciesSource } from '../types';
import { stableHash } from './geometry';

const SWITCHBOARD_VERSION = '4.0 / Zenodo 15628568';

export function hasSourcedClimateEnvelope(species: DesignSpecies): boolean {
  return species.envelopeConfidence !== 'unknown';
}

export function speciesLibrary(extras: DesignSpecies[] = []): Map<string, DesignSpecies> {
  const map = new Map(DESIGN_SPECIES_BY_ID);
  for (const species of extras) {
    if (species.id && !map.has(species.id)) map.set(species.id, species);
  }
  return map;
}

export function resolvePlanningSpecies(id: string, extras: DesignSpecies[] = []): DesignSpecies | undefined {
  return DESIGN_SPECIES_BY_ID.get(id) ?? extras.find((item) => item.id === id);
}

export function suggestedCatalogueSpacingM(item: Pick<CatalogueSpecies, 'treeLike' | 'stratum'>): number {
  if (item.stratum === 'climber' || item.stratum === 'ground') return 2;
  return item.treeLike ? 6 : 3;
}

export function planningSpeciesFromCatalogue(item: CatalogueSpecies, spacingM: number): DesignSpecies {
  const distance = clamp(spacingM, 1.6, 30);
  const name = item.scientificName.trim();
  return {
    id: item.id,
    scientificName: name,
    commonName: name,
    family: 'Unknown',
    treeLike: item.treeLike,
    invasiveStatus: 'none',
    invasiveNote: 'Jurisdiction-level invasive-species status is unverified for this catalogue taxon.',
    stratum: item.stratum ?? (item.treeLike ? 'medium' : 'climber'),
    succession: item.succession ?? 'secondary',
    roles: item.roles.length ? item.roles : ['user-selected'],
    crown: item.treeLike ? 'round' : 'irregular',
    evergreen: item.evergreen ?? false,
    nitrogenFixer: item.nitrogenFixer ?? false,
    minTemperatureC: 0,
    maxTemperatureC: 0,
    annualRainMinMm: 0,
    annualRainMaxMm: 0,
    phMin: 0,
    phMax: 0,
    droughtTolerance: 1,
    waterloggingTolerance: 1,
    matureHeightM: 0,
    matureCrownDiameterM: 0,
    initialHeightM: 0.5,
    growthRate: 0,
    growthShape: 2.15,
    spacingM: distance,
    productiveFromYear: null,
    lifespanYears: 0,
    kcInitial: 0,
    kcMid: 0,
    kcLate: 0,
    rootDepthM: 0,
    stockClass: 'forestry-seedling',
    referencePurchasePrice: 0,
    referencePurchasePriceRange: [0, 0],
    plantingLaborHours: 0,
    color: catalogColor(item.id),
    envelopeConfidence: 'unknown',
    sources: [
      switchboardSource(name),
      {
        label: 'User planting distance',
        url: switchboardSource(name).url,
        supports: ['planting spacing chosen in this project'],
        version: `${distance} m · user planning input`,
      },
      {
        label: 'Climate and growth envelopes unknown',
        url: 'https://gaez.fao.org/pages/ecocrop',
        supports: ['climate envelope absent', 'growth envelope absent'],
        version: 'no sourced envelope in the Growup design catalogue',
      },
    ],
  };
}

export function normalizeUserSpecies(value: unknown): DesignSpecies[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Partial<DesignSpecies>;
    const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 160 ? raw.id.trim() : '';
    const scientificName = typeof raw.scientificName === 'string' && raw.scientificName.trim() ? raw.scientificName.trim() : '';
    if (!id || !scientificName || raw.envelopeConfidence !== 'unknown') return [];
    return [planningSpeciesFromCatalogue({
      id,
      scientificName,
      sourceCount: 1,
      treeLike: Boolean(raw.treeLike),
      wfoId: null,
      wcvpId: null,
      globUnt: false,
      designReady: false,
      stratum: raw.stratum ?? null,
      succession: raw.succession ?? null,
      roles: Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === 'string') : [],
      evergreen: typeof raw.evergreen === 'boolean' ? raw.evergreen : null,
      nitrogenFixer: typeof raw.nitrogenFixer === 'boolean' ? raw.nitrogenFixer : null,
      droughtTolerance: null,
      evidenceCount: 1,
    }, Number(raw.spacingM))];
  });
}

function switchboardSource(name: string): SpeciesSource {
  return {
    label: 'Agroforestry Species Switchboard 4.0',
    url: `https://apps.worldagroforestry.org/products/switchboard/index.php/name_like/${encodeURIComponent(name)}`,
    supports: ['standardized name', 'linked evidence sources', 'tree-like status'],
    version: SWITCHBOARD_VERSION,
  };
}

function catalogColor(id: string): string {
  const hash = stableHash(id);
  const r = 48 + hash % 70;
  const g = 72 + (hash >> 5) % 70;
  const b = 40 + (hash >> 11) % 50;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
