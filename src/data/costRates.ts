import type { StockClass } from '../types';

export const COST_MODEL_VERSION = 'sicily-2026.07';
export const SICILY_COMMON_LABOR_EUR_HOUR = 24.91;
export const WATER_EUR_M3 = 0.42;
export const ELECTRICITY_EUR_KWH = 0.26;

export const COST_SOURCES = {
  agriculturePriceBook: {
    label: 'Sicilian Regional Agriculture Price Book 2023',
    url: 'https://www.regione.sicilia.it/sites/default/files/2023-08/PREZZARIO%20REGIONALE%20AGRICOLTURA%202023.pdf',
    version: '2023, official regional reference',
  },
  laborPriceBook: {
    label: 'Sicilian Regional Public Works labour table',
    url: 'https://www.regione.sicilia.it/sites/default/files/2024-01/Tabella%20manodopera%20e%20noli%202024.pdf',
    version: '2024, validity extended through 2026',
  },
  waterDistrictPlan: {
    label: 'Sicily River Basin Management Plan economic analysis',
    url: 'https://www.regione.sicilia.it/sites/default/files/2022-06/Allegato_5_Analisi%20Economica.pdf',
    version: 'published regional average irrigation service cost',
  },
  oliveRetail: {
    label: 'Vivai Piante Baldi Franco price list',
    url: 'https://www.vivaipiantebaldifranco.it/wp-content/uploads/2025/09/listino-09-09-25.pdf',
    version: '2025-09',
  },
  almondRetail: {
    label: 'Savini Vivai almond catalogue',
    url: 'https://www.savinivivai.it/it/shop/piante-da-frutto/piante-di-mandorlo/',
    version: 'accessed 2026-07-21',
  },
} as const;

type StockEconomics = {
  purchasePriceEur: number;
  purchasePriceRangeEur: [number, number];
  plantingServiceEur: number;
  plantingLaborHours: number;
};

function laborEquivalent(serviceEur: number): number {
  return Number((serviceEur / SICILY_COMMON_LABOR_EUR_HOUR).toFixed(2));
}

export const STOCK_ECONOMICS: Record<StockClass, StockEconomics> = {
  'forestry-seedling': {
    purchasePriceEur: 2.15,
    purchasePriceRangeEur: [1.4, 2.9],
    plantingServiceEur: 2.3,
    plantingLaborHours: laborEquivalent(2.3),
  },
  'shrub-pot': {
    purchasePriceEur: 2.1,
    purchasePriceRangeEur: [2.1, 6],
    plantingServiceEur: 5.4,
    plantingLaborHours: laborEquivalent(5.4),
  },
  'fruit-grafted': {
    purchasePriceEur: 10,
    purchasePriceRangeEur: [10, 22.9],
    plantingServiceEur: 3,
    plantingLaborHours: laborEquivalent(3),
  },
  'citrus-grafted': {
    purchasePriceEur: 15,
    purchasePriceRangeEur: [10, 25],
    plantingServiceEur: 3,
    plantingLaborHours: laborEquivalent(3),
  },
  'large-pot': {
    purchasePriceEur: 25,
    purchasePriceRangeEur: [20, 35],
    plantingServiceEur: 8,
    plantingLaborHours: laborEquivalent(8),
  },
  cutting: {
    purchasePriceEur: 0.52,
    purchasePriceRangeEur: [0.52, 1.8],
    plantingServiceEur: 2.3,
    plantingLaborHours: laborEquivalent(2.3),
  },
};

export const IRRIGATION_RATES = {
  pressureCompensatingLateralEurM: 0.69,
  nonCompensatingLateralEurM: 0.52,
  pressureCompensatingEmitterEur: 0.56,
  fittingEur: 0.26,
  endValveEur: 0.94,
  zoneValveEur: 1,
  airReleaseValveEur: 33.35,
  filterUpTo10M3HourEur: 26.1,
  mainlineEurM: 2.22,
  controllerEur: 1932,
  pumpAllowanceEur: 816.49,
  installationLaborHoursPer100M: 3.5,
  annualMaintenanceRate: 0.025,
  hydraulicHeadM: 30,
  pumpEfficiency: 0.62,
} as const;
