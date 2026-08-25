import type { DesignObjectives, DesignSpecies, DesignSystemId, SpeciesRecommendation } from '../types';
import { speciesObjectiveScore } from './objectives';

const SYSTEMS: DesignSystemId[] = ['syntropic', 'alley-cropping', 'mixed-orchard', 'monoculture', 'windbreak', 'boundary-buffer'];
const STRATA = ['emergent', 'high', 'medium', 'low', 'ground', 'climber'] as const;
const PHASES = ['placenta', 'secondary', 'climax'] as const;
const WIND_ROLES = ['wind protection', 'evergreen shelter', 'shelter', 'hedge'];
const PALETTE_SIZE: Record<DesignSystemId, number> = {
  syntropic: 9,
  'alley-cropping': 5,
  'mixed-orchard': 5,
  monoculture: 1,
  windbreak: 4,
  'boundary-buffer': 5,
};

export function normalizeDesignSystem(value: unknown): DesignSystemId {
  return SYSTEMS.includes(value as DesignSystemId) ? value as DesignSystemId : 'syntropic';
}

export function eligibleSpeciesForSystem(species: DesignSpecies[], system: DesignSystemId): DesignSpecies[] {
  const permitted = species.filter((item) => item.invasiveStatus !== 'blocked');
  if (system === 'monoculture' || system === 'mixed-orchard') {
    const productive = permitted.filter((item) => item.productiveFromYear !== null || item.envelopeConfidence === 'unknown');
    const woody = productive.filter((item) => item.treeLike);
    if (system === 'monoculture') return woody.length ? woody : (productive.length ? productive : permitted);
    return woody.length >= 2 ? woody : (productive.length >= 2 ? productive : permitted.filter((item) => item.treeLike));
  }
  if (system === 'windbreak') {
    const wind = permitted.filter((item) => item.treeLike && item.roles.some((role) => WIND_ROLES.includes(role)));
    return wind.length >= 2 ? wind : permitted.filter((item) => item.treeLike);
  }
  if (system === 'alley-cropping') return permitted.filter((item) => item.treeLike || item.stratum === 'low');
  return permitted;
}

export function recommendedPalette(
  recommendations: SpeciesRecommendation[],
  system: DesignSystemId = 'syntropic',
  size?: number,
  objectives?: DesignObjectives,
): SpeciesRecommendation[] {
  const limit = size ?? PALETTE_SIZE[system];
  const climateReady = recommendations.filter((item) => (
    (item.status === 'recommended' || item.status === 'conditional')
    && item.species.envelopeConfidence !== 'unknown'
    && !item.components.some((component) => (
      (component.key === 'climate' || component.key === 'water')
      && component.status === 'poor'
    ))
  ));
  const eligibleIds = new Set(eligibleSpeciesForSystem(climateReady.map((item) => item.species), system).map((item) => item.id));
  const eligible = orderForObjectives(climateReady.filter((item) => eligibleIds.has(item.species.id)), objectives);
  if (system === 'syntropic') return fillSyntropicPalette(eligible, limit);
  if (system === 'boundary-buffer') {
    const woody = eligible.filter((item) => item.species.treeLike);
    return [...woody, ...eligible.filter((item) => !woody.includes(item))].slice(0, limit);
  }
  return eligible.slice(0, limit);
}

function orderForObjectives(recommendations: SpeciesRecommendation[], objectives?: DesignObjectives) {
  if (!objectives) return recommendations;
  return [...recommendations].sort((a, b) => {
    const aScore = speciesObjectiveScore(a.species, objectives) * 0.7 + a.score * 0.3;
    const bScore = speciesObjectiveScore(b.species, objectives) * 0.7 + b.score * 0.3;
    return bScore - aScore || a.species.scientificName.localeCompare(b.species.scientificName);
  });
}

function fillSyntropicPalette(eligible: SpeciesRecommendation[], size: number): SpeciesRecommendation[] {
  const selected: SpeciesRecommendation[] = [];
  for (const stratum of STRATA) {
    const candidate = eligible.find((item) => item.species.stratum === stratum && !selected.includes(item));
    if (candidate) selected.push(candidate);
  }
  for (const phase of PHASES) {
    const candidate = eligible.find((item) => item.species.succession === phase && !selected.includes(item));
    if (candidate) selected.push(candidate);
  }
  for (const candidate of eligible) {
    if (selected.length >= size) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected.slice(0, size);
}
