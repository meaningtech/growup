import type { DesignSpecies, EconomicConfiguration, EstablishmentCost, IrrigationEstimate, LayoutVariant } from '../types';
import { growthState } from './growth';

export function calculateEstablishmentCost(
  variant: LayoutVariant,
  species: DesignSpecies[],
  irrigation: IrrigationEstimate,
  economics: EconomicConfiguration,
  designYear = irrigation.designYear,
  activeIrrigation = irrigation,
  timeline: EstablishmentCost['timeline'] = [],
): EstablishmentCost {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const initial = calculatePlantScope(variant.trees, speciesById, economics, irrigation.installation.totalCost);
  const activeTrees = variant.trees.filter((tree) => {
    const item = speciesById.get(tree.speciesId);
    return item ? growthState(item, tree, designYear).active : false;
  });
  const active = calculatePlantScope(activeTrees, speciesById, economics, activeIrrigation.installation.totalCost);

  return {
    economics,
    ...initial,
    activeSystem: {
      designYear,
      activePlantCount: activeTrees.length,
      inactivePlantCount: variant.trees.length - activeTrees.length,
      plantPurchaseCost: active.plantPurchaseCost,
      plantingLaborHours: active.plantingLaborHours,
      plantingLaborCost: active.plantingLaborCost,
      protectionAndStakesCost: active.protectionAndStakesCost,
      irrigationInstallationCost: active.irrigationInstallationCost,
      totalReplacementCost: active.totalCost,
      bySpecies: active.bySpecies,
    },
    timeline,
  };
}

function calculatePlantScope(
  trees: LayoutVariant['trees'],
  speciesById: Map<string, DesignSpecies>,
  economics: EconomicConfiguration,
  irrigationInstallationCost: number,
) {
  const counts = new Map<string, number>();
  for (const tree of trees) counts.set(tree.speciesId, (counts.get(tree.speciesId) ?? 0) + 1);
  const bySpecies = [...counts.entries()].map(([speciesId, count]) => {
    const item = speciesById.get(speciesId);
    if (!item) throw new Error(`Unknown species ${speciesId}`);
    const unitPlantCost = item.referencePurchasePrice * economics.plantReferenceMultiplier;
    const subtotalCost = count * (unitPlantCost + item.plantingLaborHours * economics.laborCostPerHour);
    return {
      speciesId,
      count,
      unitPlantCost: round(unitPlantCost),
      unitLaborHours: item.plantingLaborHours,
      subtotalCost: round(subtotalCost),
    };
  }).sort((a, b) => b.count - a.count);
  const plantPurchaseCost = bySpecies.reduce((sum, row) => sum + row.count * row.unitPlantCost, 0);
  const plantingLaborHours = bySpecies.reduce((sum, row) => sum + row.count * row.unitLaborHours, 0);
  const plantingLaborCost = plantingLaborHours * economics.laborCostPerHour;
  const protectionAndStakesCost = trees.reduce((sum, tree) => {
    const item = speciesById.get(tree.speciesId);
    if (!item) return sum;
    return sum + (item.stockClass === 'shrub-pot' || item.stockClass === 'cutting' ? economics.smallProtectionUnitCost : economics.largeProtectionUnitCost);
  }, 0);
  const totalCost = plantPurchaseCost + plantingLaborCost + protectionAndStakesCost + irrigationInstallationCost;

  return {
    plantPurchaseCost: round(plantPurchaseCost),
    plantingLaborHours: round(plantingLaborHours),
    plantingLaborCost: round(plantingLaborCost),
    protectionAndStakesCost: round(protectionAndStakesCost),
    irrigationInstallationCost,
    totalCost: round(totalCost),
    bySpecies,
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
