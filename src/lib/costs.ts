import { SICILY_COMMON_LABOR_EUR_HOUR } from '../data/costRates';
import type { DesignSpecies, EstablishmentCost, IrrigationEstimate, LayoutVariant } from '../types';

export function calculateEstablishmentCost(
  variant: LayoutVariant,
  species: DesignSpecies[],
  irrigation: IrrigationEstimate,
): EstablishmentCost {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  for (const tree of variant.trees) counts.set(tree.speciesId, (counts.get(tree.speciesId) ?? 0) + 1);
  const bySpecies = [...counts.entries()].map(([speciesId, count]) => {
    const item = speciesById.get(speciesId);
    if (!item) throw new Error(`Unknown species ${speciesId}`);
    const subtotalEur = count * (item.purchasePriceEur + item.plantingLaborHours * SICILY_COMMON_LABOR_EUR_HOUR);
    return {
      speciesId,
      count,
      unitPlantEur: item.purchasePriceEur,
      unitLaborHours: item.plantingLaborHours,
      subtotalEur: round(subtotalEur),
    };
  }).sort((a, b) => b.count - a.count);
  const plantPurchaseEur = bySpecies.reduce((sum, row) => sum + row.count * row.unitPlantEur, 0);
  const plantingLaborHours = bySpecies.reduce((sum, row) => sum + row.count * row.unitLaborHours, 0);
  const plantingLaborEur = plantingLaborHours * SICILY_COMMON_LABOR_EUR_HOUR;
  const protectionAndStakesEur = variant.trees.reduce((sum, tree) => {
    const item = speciesById.get(tree.speciesId);
    if (!item) return sum;
    return sum + (item.stockClass === 'shrub-pot' || item.stockClass === 'cutting' ? 1.9 : 3.4);
  }, 0);
  const totalEur = plantPurchaseEur + plantingLaborEur + protectionAndStakesEur + irrigation.installation.totalEur;

  return {
    plantPurchaseEur: round(plantPurchaseEur),
    plantingLaborHours: round(plantingLaborHours),
    plantingLaborEur: round(plantingLaborEur),
    protectionAndStakesEur: round(protectionAndStakesEur),
    irrigationInstallationEur: irrigation.installation.totalEur,
    totalEur: round(totalEur),
    bySpecies,
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
