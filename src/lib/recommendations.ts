import type { DesignObjectives, DesignSpecies, SiteProfile, SpeciesRecommendation, SuitabilityComponent } from '../types';
import { siteNativeness } from './biogeography';
import { DEFAULT_DESIGN_OBJECTIVES, normalizeDesignObjectives } from './objectives';

export { recommendedPalette } from './systemPalette';

type SuitabilityKey = 'climate' | 'soil' | 'water' | 'native' | 'purpose' | 'syntropic' | 'maintenance' | 'evidence';

export function rankSpecies(
  species: DesignSpecies[],
  site: SiteProfile,
  objectives: DesignObjectives = DEFAULT_DESIGN_OBJECTIVES,
): SpeciesRecommendation[] {
  const normalized = normalizeDesignObjectives(objectives);
  return species
    .map((item) => recommendSpecies(item, site, normalized))
    .sort((a, b) => b.score - a.score || a.species.scientificName.localeCompare(b.species.scientificName));
}

export function suitabilityWeights(objectives: DesignObjectives): Record<SuitabilityKey, number> {
  const value = normalizeDesignObjectives(objectives);
  const raw: Record<SuitabilityKey, number> = {
    climate: 24 + value.waterResilience * 0.05,
    soil: 17,
    water: 10 + value.waterResilience * 0.18,
    native: 4 + value.nativeHabitat * 0.2 + value.biodiversity * 0.04,
    purpose: 4 + value.production * 0.21,
    syntropic: 4 + value.biodiversity * 0.17,
    maintenance: 3 + value.lowMaintenance * 0.15,
    evidence: 8,
  };
  const total = Object.values(raw).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.entries(raw).map(([key, weight]) => [key, weight / total])) as Record<SuitabilityKey, number>;
}

function recommendSpecies(species: DesignSpecies, site: SiteProfile, objectives: DesignObjectives): SpeciesRecommendation {
  const countryCode = site.location?.countryCode ?? null;
  const jurisdictionName = countryCode ?? site.location?.displayName ?? 'the selected country';
  if (species.invasiveStatus === 'blocked') {
    const jurisdiction = species.invasiveNote
      ?? `Jurisdiction-specific invasive-species clearance is unavailable for ${jurisdictionName}; this species is excluded from automatic designs pending local verification.`;
    const blocked: SuitabilityComponent = {
      key: 'safety', label: 'Jurisdictional safety', score: 0, weight: 1, status: 'blocked',
      explanation: jurisdiction ?? 'This species is blocked for the project jurisdiction.',
    };
    return { species, score: 0, status: 'blocked', components: [blocked], reasons: [], mitigations: [blocked.explanation] };
  }

  const weights = suitabilityWeights(objectives);
  const sourcedEnvelope = species.envelopeConfidence !== 'unknown';
  const climateScore = sourcedEnvelope ? intervalScore(
    [site.climate.absoluteMinTemperatureC, site.climate.absoluteMaxTemperatureC],
    [species.minTemperatureC, species.maxTemperatureC],
  ) : null;
  const rainScore = sourcedEnvelope ? rangeScore(site.climate.annualPrecipitationMm, species.annualRainMinMm, species.annualRainMaxMm) : null;
  const soilScore = !sourcedEnvelope || site.soil.ph === null ? null : rangeScore(site.soil.ph, species.phMin, species.phMax);
  const aridityDemand = site.climate.annualEt0Mm > 0 ? site.climate.annualPrecipitationMm / site.climate.annualEt0Mm : null;
  const droughtScore = species.droughtTolerance * 20;
  const rawWaterScore = rainScore === null ? null : Math.round(rainScore * 0.48 + droughtScore * 0.42 + (aridityDemand === null ? 50 : aridityDemand < 0.55 ? droughtScore : 85) * 0.1);
  const rainBelowEnvelope = sourcedEnvelope && site.climate.annualPrecipitationMm < species.annualRainMinMm;
  const severeRainDeficit = sourcedEnvelope && site.climate.annualPrecipitationMm < species.annualRainMinMm * 0.75;
  const waterScore = rawWaterScore === null ? null : rainBelowEnvelope ? Math.min(rawWaterScore, severeRainDeficit ? 33 : 51) : rawWaterScore;
  const nativeness = siteNativeness(species, site);
  const productive = species.productiveFromYear !== null || species.roles.some((role) => /fruit|nut|food|crop|culinary|aromatic|resin|fodder/i.test(role));
  const productionScore = productive ? Math.max(68, 100 - Math.max(0, (species.productiveFromYear ?? 5) - 1) * 5) : species.roles.includes('timber') ? 62 : 30;
  const biodiversityScore = Math.min(100, 42 + species.roles.length * 8 + (species.nitrogenFixer ? 15 : 0) + (nativeness.verified && nativeness.score === 100 ? 10 : 0));
  const purposeScore = Math.round((productionScore * objectives.production + biodiversityScore * objectives.biodiversity) / Math.max(1, objectives.production + objectives.biodiversity));
  const syntropicScore = Math.min(100, 48 + (species.nitrogenFixer ? 24 : 0) + (species.roles.includes('biomass') ? 16 : 0) + (species.succession === 'placenta' ? 10 : 0));
  const maintenanceScore = sourcedEnvelope ? Math.round(clamp(86 + droughtScore * 0.16 - species.growthRate * 65 - (species.roles.includes('biomass') ? 8 : 0), 15, 100)) : null;
  const evidenceScore = sourcedEnvelope ? (species.sources.length >= 3 ? 92 : species.sources.length === 2 ? 76 : 58) : 44;

  const components: SuitabilityComponent[] = [
    component('climate', 'Climate fit', climateScore, weights.climate, sourcedEnvelope ? `Observed ${site.climate.absoluteMinTemperatureC}–${site.climate.absoluteMaxTemperatureC} °C; supported envelope ${species.minTemperatureC}–${species.maxTemperatureC} °C.` : 'Climate envelope is unknown for this catalogue taxon; field verification is required.'),
    component('soil', 'Soil reaction', soilScore, weights.soil, !sourcedEnvelope ? 'Soil envelope is unknown for this catalogue taxon; a field test is required.' : site.soil.ph === null ? 'Soil pH is unavailable; a representative field test is required before recommendation.' : `SoilGrids pH ${site.soil.ph}; supported range ${species.phMin}–${species.phMax}.`),
    component('water', 'Water resilience', waterScore, weights.water, sourcedEnvelope ? `${site.climate.annualPrecipitationMm} mm annual rain versus supported ${species.annualRainMinMm}–${species.annualRainMaxMm} mm; ${site.climate.annualEt0Mm} mm ET₀; drought tolerance ${species.droughtTolerance}/5.` : 'Water envelope is unknown for this catalogue taxon; do not infer drought tolerance.'),
    component('native', 'Native habitat value', nativeness.score, weights.native, nativeness.explanation),
    component('purpose', 'Objective value', purposeScore, weights.purpose, `${productive ? 'Productive' : 'Support'} species; functions: ${species.roles.join(', ')}.`),
    component('syntropic', 'Successional function', syntropicScore, weights.syntropic, `${species.stratum} stratum, ${species.succession} succession${species.nitrogenFixer ? ', nitrogen fixer' : ''}.`),
    component('maintenance', 'Maintenance demand', maintenanceScore, weights.maintenance, sourcedEnvelope ? `Growth coefficient ${species.growthRate.toFixed(2)}, drought tolerance ${species.droughtTolerance}/5${species.roles.includes('biomass') ? ', planned biomass management' : ''}.` : 'Growth and maintenance envelopes are unknown for this catalogue taxon.'),
    component('evidence', 'Evidence readiness', evidenceScore, weights.evidence, sourcedEnvelope ? `${species.sources.length} linked evidence groups cover taxonomy, ecology and establishment economics.` : 'Switchboard provides taxonomy only; climate, growth and economics remain unknown.'),
  ];
  const weighted = components.reduce((sum, item) => sum + item.score * item.weight, 0);
  const monitorPenalty = species.invasiveStatus === 'monitor' ? 14 : 0;
  const score = Math.max(0, Math.round(weighted - monitorPenalty));
  const criticalUnknown = components.some((item) => item.key === 'soil' && item.status === 'unknown');
  const criticalMismatch = sourcedEnvelope && ((climateScore ?? 0) < 38 || (waterScore ?? 0) < 34);
  let status: SpeciesRecommendation['status'] = score >= 75 ? 'recommended' : score >= 58 ? 'conditional' : 'poor';
  if (criticalMismatch) status = 'poor';
  if ((criticalUnknown || species.invasiveStatus === 'monitor' || !sourcedEnvelope) && status === 'recommended') status = 'conditional';
  const reasons = components.filter((item) => item.status === 'good').sort((a, b) => b.weight - a.weight).map((item) => item.explanation).slice(0, 3);
  const mitigations = components.filter((item) => item.status === 'poor' || item.status === 'unknown').map((item) => item.explanation);
  if (species.invasiveStatus === 'monitor') {
    mitigations.unshift(species.invasiveNote
      ?? `Verify invasive-species status and permitted use with authorities in ${jurisdictionName}.`);
  }
  if (criticalMismatch) mitigations.unshift('A critical climate or water mismatch prevents recommendation for this site.');

  return { species, score, status, components, reasons, mitigations };
}

function component(key: SuitabilityKey, label: string, score: number | null, weight: number, explanation: string): SuitabilityComponent {
  if (score === null) return { key, label, score: 50, weight, status: 'unknown', explanation };
  return { key, label, score, weight, status: score >= 72 ? 'good' : score >= 52 ? 'conditional' : 'poor', explanation };
}

function intervalScore(observed: [number, number], supported: [number, number]): number {
  const low = rangeScore(observed[0], supported[0], supported[1]);
  const high = rangeScore(observed[1], supported[0], supported[1]);
  return Math.round((low + high) / 2);
}

function rangeScore(value: number, minimum: number, maximum: number): number {
  if (value >= minimum && value <= maximum) {
    const midpoint = (minimum + maximum) / 2;
    const halfRange = Math.max(1, (maximum - minimum) / 2);
    return Math.round(100 - Math.abs(value - midpoint) / halfRange * 15);
  }
  const distance = value < minimum ? minimum - value : value - maximum;
  const range = Math.max(1, maximum - minimum);
  return Math.max(0, Math.round(70 - distance / range * 180));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
