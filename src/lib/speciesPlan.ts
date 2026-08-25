import type { DesignObjectives, DesignSpecies, SpeciesMixEntry, SuccessionPhase } from '../types';
import { speciesObjectiveScore } from './objectives';

const SUCCESSION_PHASES: SuccessionPhase[] = ['placenta', 'secondary', 'climax'];

export function normalizeSpeciesMix(value: unknown): Record<string, SpeciesMixEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([speciesId]) => speciesId.length > 0 && speciesId.length <= 160)
    .slice(0, 200)
    .flatMap(([speciesId, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const entry = raw as Partial<SpeciesMixEntry>;
      const targetPercent = clamp(Number(entry.targetPercent), 0, 100);
      const successionOverride = SUCCESSION_PHASES.includes(entry.successionOverride as SuccessionPhase)
        ? entry.successionOverride as SuccessionPhase
        : null;
      const spacing = Number(entry.spacingOverrideM);
      const spacingOverrideM = entry.spacingOverrideM == null || !Number.isFinite(spacing) ? null : clamp(spacing, 1.6, 30);
      return [[speciesId, { targetPercent, successionOverride, spacingOverrideM }] as const];
    });
  return Object.fromEntries(entries);
}

export function resolvedSpeciesMix(
  species: DesignSpecies[],
  mix: Record<string, SpeciesMixEntry>,
): Record<string, SpeciesMixEntry> {
  if (!species.length) return {};
  const normalized = normalizeSpeciesMix(mix);
  const fallbackWeight = 100 / species.length;
  const weights = species.map((item) => ({
    speciesId: item.id,
    weight: normalized[item.id]?.targetPercent ?? fallbackWeight,
    successionOverride: normalized[item.id]?.successionOverride ?? null,
    spacingOverrideM: normalized[item.id]?.spacingOverrideM ?? null,
  }));
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const basis = total > 0 ? weights.map((item) => item.weight / total * 100) : weights.map(() => fallbackWeight);
  const rounded = roundPercentages(basis);
  return Object.fromEntries(weights.map((item, index) => [item.speciesId, {
    targetPercent: rounded[index],
    successionOverride: item.successionOverride,
    spacingOverrideM: item.spacingOverrideM,
  }]));
}

export function speciesMixFromObjectives(
  species: DesignSpecies[],
  objectives: DesignObjectives,
): Record<string, SpeciesMixEntry> {
  if (!species.length) return {};
  const scores = species.map((item) => Math.max(0.5, speciesObjectiveScore(item, objectives)));
  const total = scores.reduce((sum, score) => sum + score, 0);
  const percents = roundPercentages(scores.map((score) => score / total * 100));
  return Object.fromEntries(species.map((item, index) => [item.id, {
    targetPercent: percents[index],
    successionOverride: null,
    spacingOverrideM: null,
  }]));
}

export function synchronizeSpeciesMix(
  previousSpeciesIds: string[],
  nextSpeciesIds: string[],
  mix: Record<string, SpeciesMixEntry>,
): Record<string, SpeciesMixEntry> {
  if (!nextSpeciesIds.length) return {};
  const previousSpecies = previousSpeciesIds.map((id) => speciesStub(id));
  const previous = resolvedSpeciesMix(previousSpecies, mix);
  const additions = nextSpeciesIds.filter((id) => !previousSpeciesIds.includes(id));
  const additionShare = additions.length ? 100 / nextSpeciesIds.length : 0;
  const remainingShare = 100 - additionShare * additions.length;
  const retained = nextSpeciesIds.filter((id) => !additions.includes(id));
  const retainedTotal = retained.reduce((sum, id) => sum + (previous[id]?.targetPercent ?? 0), 0);
  const weights = nextSpeciesIds.map((id) => {
    if (additions.includes(id)) return additionShare;
    if (retainedTotal <= 0) return remainingShare / Math.max(1, retained.length);
    return (previous[id]?.targetPercent ?? 0) / retainedTotal * remainingShare;
  });
  const rounded = roundPercentages(weights);
  return Object.fromEntries(nextSpeciesIds.map((id, index) => [id, {
    targetPercent: rounded[index],
    successionOverride: mix[id]?.successionOverride ?? null,
    spacingOverrideM: mix[id]?.spacingOverrideM ?? null,
  }]));
}

export function rebalanceSpeciesMix(
  species: DesignSpecies[],
  mix: Record<string, SpeciesMixEntry>,
  changedSpeciesId: string,
  requestedPercent: number,
): Record<string, SpeciesMixEntry> {
  const current = resolvedSpeciesMix(species, mix);
  if (!current[changedSpeciesId]) return current;
  const targetPercent = clamp(requestedPercent, 0, 100);
  const otherSpecies = species.filter((item) => item.id !== changedSpeciesId);
  const availablePercent = 100 - targetPercent;
  const otherTotal = otherSpecies.reduce((sum, item) => sum + current[item.id].targetPercent, 0);
  const weights = species.map((item) => {
    if (item.id === changedSpeciesId) return targetPercent;
    if (otherTotal <= 0) return availablePercent / Math.max(1, otherSpecies.length);
    return current[item.id].targetPercent / otherTotal * availablePercent;
  });
  const rounded = roundPercentages(weights, species.findIndex((item) => item.id === changedSpeciesId));
  return Object.fromEntries(species.map((item, index) => [item.id, {
    targetPercent: rounded[index],
    successionOverride: current[item.id].successionOverride,
    spacingOverrideM: current[item.id].spacingOverrideM,
  }]));
}

export function effectiveSuccession(species: DesignSpecies, mix: Record<string, SpeciesMixEntry>): SuccessionPhase {
  return mix[species.id]?.successionOverride ?? species.succession;
}

export function effectiveSpacingM(species: DesignSpecies, mix: Record<string, SpeciesMixEntry>): number {
  return mix[species.id]?.spacingOverrideM ?? species.spacingM;
}

function roundPercentages(values: number[], fixedIndex = -1) {
  if (!values.length) return [];
  const rounded = values.map((value) => Number(value.toFixed(1)));
  const difference = Number((100 - rounded.reduce((sum, value) => sum + value, 0)).toFixed(1));
  const flexibleIndex = rounded.findIndex((_value, index) => index !== fixedIndex && rounded[index] + difference >= 0);
  const correctionIndex = flexibleIndex >= 0 ? flexibleIndex : fixedIndex >= 0 ? fixedIndex : rounded.length - 1;
  rounded[correctionIndex] = Number((rounded[correctionIndex] + difference).toFixed(1));
  return rounded;
}

function speciesStub(id: string): DesignSpecies {
  return { id } as DesignSpecies;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
