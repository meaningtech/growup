import { COST_SOURCES, ELECTRICITY_EUR_KWH, IRRIGATION_RATES, SICILY_COMMON_LABOR_EUR_HOUR, WATER_EUR_M3 } from '../data/costRates';
import type { DesignSpecies, IrrigationEstimate, LayoutVariant, SiteProfile } from '../types';
import { growthState } from './growth';
import { haversineM } from './geometry';

export function calculateIrrigation(
  variant: LayoutVariant,
  species: DesignSpecies[],
  site: SiteProfile,
  designYear = 5,
): IrrigationEstimate {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const monthly = site.climate.monthly.map((month) => {
    let netM3 = 0;
    for (const tree of variant.trees) {
      const item = speciesById.get(tree.speciesId);
      if (!item) continue;
      const state = growthState(item, tree, designYear);
      if (!state.active) continue;
      const stage = designYear <= 1 ? item.kcInitial : designYear < 8 ? item.kcMid : item.kcLate;
      const wettedAreaM2 = Math.max(1.2, Math.PI * (state.crownDiameterM * 0.34) ** 2);
      const effectiveRainMm = Math.min(month.precipitationMm * 0.82, month.et0Mm * stage * 0.72);
      const deficitMm = Math.max(0, month.et0Mm * stage - effectiveRainMm);
      netM3 += deficitMm * wettedAreaM2 / 1000;
    }
    const grossM3 = netM3 / 0.9;
    const pumpingKwh = pumpingEnergyKwh(grossM3);
    return {
      month: month.month,
      netM3: round(netM3),
      grossM3: round(grossM3),
      costEur: round(grossM3 * WATER_EUR_M3 + pumpingKwh * ELECTRICITY_EUR_KWH),
    };
  });
  const annualNetM3 = monthly.reduce((sum, item) => sum + item.netM3, 0);
  const annualGrossM3 = monthly.reduce((sum, item) => sum + item.grossM3, 0);
  const effectiveWettedAreaM2 = variant.trees.reduce((sum, tree) => {
    const item = speciesById.get(tree.speciesId);
    if (!item) return sum;
    const state = growthState(item, tree, designYear);
    return sum + Math.max(1.2, Math.PI * (state.crownDiameterM * 0.34) ** 2);
  }, 0);
  const annualNetMm = annualNetM3 * 1000 / Math.max(1, effectiveWettedAreaM2);
  const annualGrossMm = annualGrossM3 * 1000 / Math.max(1, effectiveWettedAreaM2);
  const peakMonth = Math.max(...monthly.map((item) => item.grossM3));
  const peakDayM3 = peakMonth / 30;
  const emitterCount = variant.trees.length * 2;
  const zones = Math.max(1, Math.ceil(emitterCount / 260));
  const lateralPipeM = estimateLateralLength(variant);
  const mainlinePipeM = Math.max(25, Math.sqrt(site.areaM2) * 1.15);
  const materialsEur =
    lateralPipeM * IRRIGATION_RATES.pressureCompensatingLateralEurM +
    mainlinePipeM * IRRIGATION_RATES.mainlineEurM +
    emitterCount * IRRIGATION_RATES.pressureCompensatingEmitterEur +
    variant.trees.length * IRRIGATION_RATES.fittingEur +
    zones * (IRRIGATION_RATES.zoneValveEur + IRRIGATION_RATES.endValveEur) +
    IRRIGATION_RATES.airReleaseValveEur +
    IRRIGATION_RATES.filterUpTo10M3HourEur +
    IRRIGATION_RATES.controllerEur +
    IRRIGATION_RATES.pumpAllowanceEur;
  const laborHours = (lateralPipeM + mainlinePipeM) / 100 * IRRIGATION_RATES.installationLaborHoursPer100M + zones * 0.5;
  const laborEur = laborHours * SICILY_COMMON_LABOR_EUR_HOUR;
  const installationTotal = materialsEur + laborEur;
  const pumpingKwh = pumpingEnergyKwh(annualGrossM3);
  const waterEur = annualGrossM3 * WATER_EUR_M3;
  const energyEur = pumpingKwh * ELECTRICITY_EUR_KWH;
  const maintenanceEur = installationTotal * IRRIGATION_RATES.annualMaintenanceRate;
  const waterSamples = site.satellite.optical.waterSamples;
  const sampleCounts = {
    high: waterSamples.filter((sample) => sample.irrigationPriority === 'high').length,
    medium: waterSamples.filter((sample) => sample.irrigationPriority === 'medium').length,
    low: waterSamples.filter((sample) => sample.irrigationPriority === 'low').length,
  };

  return {
    climatePeriod: site.climate.period,
    annualNetMm: round(annualNetMm),
    annualGrossMm: round(annualGrossMm),
    annualWaterM3: round(annualGrossM3),
    peakDayM3: round(peakDayM3),
    zones,
    emitterCount,
    lateralPipeM: round(lateralPipeM),
    mainlinePipeM: round(mainlinePipeM),
    installation: {
      materialsEur: round(materialsEur),
      laborHours: round(laborHours),
      laborEur: round(laborEur),
      totalEur: round(installationTotal),
    },
    annualOperation: {
      waterEur: round(waterEur),
      pumpingKwh: round(pumpingKwh),
      energyEur: round(energyEur),
      maintenanceEur: round(maintenanceEur),
      totalEur: round(waterEur + energyEur + maintenanceEur),
    },
    satelliteScheduling: {
      adjustmentPercent: site.satellite.irrigationScheduling.adjustmentPercent,
      recommendation: site.satellite.irrigationScheduling.recommendation,
      confidence: site.satellite.irrigationScheduling.confidence,
      sceneAt: site.satellite.optical.latest?.acquiredAt ?? site.satellite.radar.latest?.acquiredAt ?? null,
      highPrioritySamples: sampleCounts.high,
      mediumPrioritySamples: sampleCounts.medium,
      lowPrioritySamples: sampleCounts.low,
      annualVolumeAdjusted: false,
    },
    assumptions: [
      { label: 'Distribution efficiency', value: '90%', source: 'FAO-56 design assumption; editable', sourceUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
      { label: 'Irrigation water', value: `€${WATER_EUR_M3.toFixed(2)}/m³`, source: COST_SOURCES.waterDistrictPlan.label, sourceUrl: COST_SOURCES.waterDistrictPlan.url },
      { label: 'Common labour', value: `€${SICILY_COMMON_LABOR_EUR_HOUR.toFixed(2)}/h`, source: COST_SOURCES.laborPriceBook.label, sourceUrl: COST_SOURCES.laborPriceBook.url },
      { label: 'Dripline installed', value: `€${IRRIGATION_RATES.pressureCompensatingLateralEurM.toFixed(2)}/m`, source: COST_SOURCES.agriculturePriceBook.label, sourceUrl: COST_SOURCES.agriculturePriceBook.url },
      { label: 'Pump duty', value: `${IRRIGATION_RATES.hydraulicHeadM} m head at ${Math.round(IRRIGATION_RATES.pumpEfficiency * 100)}% efficiency`, source: 'Hydraulic energy calculation; editable after field survey', sourceUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
      { label: 'Satellite scheduling', value: `${site.satellite.irrigationScheduling.adjustmentPercent}% next-pulse guidance; annual demand unchanged`, source: 'Sentinel-2 NDMI and same-orbit Sentinel-1 RTC anomaly', sourceUrl: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a' },
    ],
    monthly,
  };
}

function estimateLateralLength(variant: LayoutVariant): number {
  const rows = new Map<number, typeof variant.trees>();
  for (const tree of variant.trees) rows.set(tree.rowIndex, [...(rows.get(tree.rowIndex) ?? []), tree]);
  let total = 0;
  for (const trees of rows.values()) {
    if (trees.length < 2) continue;
    const sorted = [...trees].sort((a, b) => a.positionIndex - b.positionIndex);
    total += haversineM(sorted[0].coordinate, sorted[sorted.length - 1].coordinate);
  }
  return total * 1.05;
}

function pumpingEnergyKwh(waterM3: number): number {
  return waterM3 * 9.81 * IRRIGATION_RATES.hydraulicHeadM / (3_600 * IRRIGATION_RATES.pumpEfficiency);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
