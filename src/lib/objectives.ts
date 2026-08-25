import type { DesignObjectives, DesignSpecies } from '../types';

export const DEFAULT_DESIGN_OBJECTIVES: DesignObjectives = {
  production: 60,
  biodiversity: 75,
  nativeHabitat: 70,
  waterResilience: 85,
  lowMaintenance: 55,
};

export function normalizeDesignObjectives(value?: Partial<DesignObjectives> | null): DesignObjectives {
  return {
    production: score(value?.production ?? DEFAULT_DESIGN_OBJECTIVES.production),
    biodiversity: score(value?.biodiversity ?? DEFAULT_DESIGN_OBJECTIVES.biodiversity),
    nativeHabitat: score(value?.nativeHabitat ?? DEFAULT_DESIGN_OBJECTIVES.nativeHabitat),
    waterResilience: score(value?.waterResilience ?? DEFAULT_DESIGN_OBJECTIVES.waterResilience),
    lowMaintenance: score(value?.lowMaintenance ?? DEFAULT_DESIGN_OBJECTIVES.lowMaintenance),
  };
}

export function compositionTargets(objectives: DesignObjectives) {
  const normalized = normalizeDesignObjectives(objectives);
  return {
    productivePercent: Math.round(20 + normalized.production * 0.55),
    nativePercent: Math.round(25 + normalized.nativeHabitat * 0.55),
    nitrogenFixerPercent: Math.round(8 + normalized.biodiversity * 0.24),
    minimumStrata: normalized.biodiversity >= 70 ? 5 : normalized.biodiversity >= 35 ? 4 : 3,
  };
}

export function speciesObjectiveScore(species: DesignSpecies, objectives: DesignObjectives) {
  const normalized = normalizeDesignObjectives(objectives);
  const productive = species.productiveFromYear !== null || species.roles.some((role) => /fruit|nut|food|crop|culinary|aromatic|resin|fodder/i.test(role));
  const production = productive ? 100 : species.roles.includes('timber') ? 70 : 35;
  const biodiversity = Math.min(100, 45 + species.roles.length * 7 + (species.nitrogenFixer ? 15 : 0));
  const nativeHabitat = species.roles.some((role) => /habitat|wildlife|native/.test(role)) ? 90 : 35;
  const waterResilience = species.droughtTolerance * 20;
  const lowMaintenance = Math.max(20, Math.min(100, 75 + species.droughtTolerance * 6 - species.growthRate * 55));
  const totalWeight = Object.values(normalized).reduce((sum, value) => sum + value, 0) || 1;
  return (
    production * normalized.production +
    biodiversity * normalized.biodiversity +
    nativeHabitat * normalized.nativeHabitat +
    waterResilience * normalized.waterResilience +
    lowMaintenance * normalized.lowMaintenance
  ) / totalWeight;
}

function score(value: number) {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0)));
}
