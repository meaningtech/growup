import type { HarvestProductId, HarvestSpeciesRecord } from '../types';
import { harvestSourceList } from './harvestSources';

function kg(low: number, base: number, high: number) {
  return { low, base, high };
}

export const HARVEST_CATALOGUE: HarvestSpeciesRecord[] = [
  {
    scientificName: 'Olea europaea',
    speciesId: 'olea-europaea',
    plateauYear: 12,
    bearing: 'alternate',
    irrigatedFactor: 1.28,
    limitations: [
      'Per-tree mixed-system estimate, not a dedicated grove t/ha.',
      'Cultivar, mill extraction and alternate bearing remain field unknowns.',
    ],
    products: [
      {
        id: 'olives',
        kgPerTreeMature: kg(12, 25, 45),
        sources: harvestSourceList('faoPaper66', 'faoOliveChapter', 'calabriaLcc'),
        confidence: 'medium',
      },
      {
        id: 'olive-oil',
        conversionFrom: { productId: 'olives', ratio: 0.1925 },
        kgPerTreeMature: kg(2.3, 4.8, 8.7),
        sources: harvestSourceList('iocOilRatio'),
        confidence: 'medium',
      },
    ],
  },
  {
    scientificName: 'Ceratonia siliqua',
    speciesId: 'ceratonia-siliqua',
    plateauYear: 15,
    bearing: 'alternate',
    irrigatedFactor: 1.35,
    limitations: [
      'Traditional rainfed pod yields; isolated large trees can exceed this range.',
    ],
    products: [
      {
        id: 'carob-pods',
        kgPerTreeMature: kg(20, 50, 70),
        sources: harvestSourceList('batlleCarob', 'desertAdaptCarob'),
        confidence: 'medium',
      },
      {
        id: 'carob-kernel',
        conversionFrom: { productId: 'carob-pods', ratio: 0.12 },
        kgPerTreeMature: kg(2.4, 6, 8.4),
        sources: harvestSourceList('batlleCarob'),
        confidence: 'low',
      },
    ],
  },
  {
    scientificName: 'Prunus dulcis',
    speciesId: 'prunus-dulcis',
    plateauYear: 10,
    bearing: 'annual',
    irrigatedFactor: 1.4,
    limitations: ['In-shell almonds. Kernel recovery is not estimated.'],
    products: [{
      id: 'almonds-inshell',
      kgPerTreeMature: kg(2, 5, 10),
      sources: harvestSourceList('faoPaper66', 'calabriaLcc', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Vitis vinifera',
    speciesId: 'vitis-vinifera',
    plateauYear: 8,
    bearing: 'annual',
    irrigatedFactor: 1.22,
    limitations: [
      'Mixed-system kg/vine, not a vineyard t/ha.',
      'Wine uses 1.35 kg grapes per litre; not a bottling, PDO or winery yield.',
    ],
    products: [
      {
        id: 'grapes',
        kgPerTreeMature: kg(2, 5, 10),
        sources: harvestSourceList('faoPaper66', 'faostatContext'),
        confidence: 'medium',
      },
      {
        id: 'wine',
        conversionFrom: { productId: 'grapes', ratio: 0.733 },
        kgPerTreeMature: kg(1.5, 3.7, 7.3),
        sources: harvestSourceList('oivWine'),
        confidence: 'low',
      },
    ],
  },
  {
    scientificName: 'Ficus carica',
    speciesId: 'ficus-carica',
    plateauYear: 7,
    bearing: 'annual',
    irrigatedFactor: 1.3,
    limitations: ['Fresh figs. Cultivar spread is wide; dried mass is not estimated.'],
    products: [{
      id: 'figs',
      kgPerTreeMature: kg(8, 20, 40),
      sources: harvestSourceList('calabriaLcc', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Citrus × sinensis',
    speciesId: 'citrus-sinensis',
    plateauYear: 10,
    bearing: 'annual',
    irrigatedFactor: 1.45,
    limitations: ['Fresh fruit. Juice extraction is not estimated.'],
    products: [{
      id: 'citrus-fruit',
      kgPerTreeMature: kg(15, 35, 60),
      sources: harvestSourceList('faoPaper66', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Citrus × limon',
    speciesId: 'citrus-limon',
    plateauYear: 10,
    bearing: 'annual',
    irrigatedFactor: 1.45,
    limitations: ['Fresh fruit. Juice extraction is not estimated.'],
    products: [{
      id: 'citrus-fruit',
      kgPerTreeMature: kg(12, 30, 55),
      sources: harvestSourceList('faoPaper66', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Citrus reticulata',
    speciesId: 'citrus-reticulata',
    plateauYear: 10,
    bearing: 'annual',
    irrigatedFactor: 1.4,
    limitations: ['Fresh fruit. Juice extraction is not estimated.'],
    products: [{
      id: 'citrus-fruit',
      kgPerTreeMature: kg(12, 28, 50),
      sources: harvestSourceList('faoPaper66', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Pistacia vera',
    speciesId: 'pistacia-vera',
    plateauYear: 15,
    bearing: 'alternate',
    irrigatedFactor: 1.5,
    limitations: ['Strong alternate bearing. In-shell mass only.'],
    products: [{
      id: 'pistachios-inshell',
      kgPerTreeMature: kg(1, 4, 8),
      sources: harvestSourceList('faoPaper66', 'faostatContext'),
      confidence: 'low',
    }],
  },
  {
    scientificName: 'Opuntia ficus-indica',
    speciesId: 'opuntia-ficus-indica',
    plateauYear: 6,
    bearing: 'annual',
    irrigatedFactor: 1.2,
    limitations: ['Cladode fruit. Monitor species: keep clonal spread contained.'],
    products: [{
      id: 'prickly-pear',
      kgPerTreeMature: kg(5, 15, 25),
      sources: harvestSourceList('faostatContext'),
      confidence: 'low',
    }],
  },
];

export const HARVEST_BY_SPECIES_ID = new Map(HARVEST_CATALOGUE.map((record) => [record.speciesId, record]));

export const HARVEST_USD_PER_KG: Record<HarvestProductId, number> = {
  olives: 0.65,
  'olive-oil': 8.2,
  'carob-pods': 2.7,
  'carob-kernel': 8,
  'almonds-inshell': 5.2,
  grapes: 0.55,
  wine: 1.9,
  figs: 1.7,
  'citrus-fruit': 0.58,
  'pistachios-inshell': 9.4,
  'prickly-pear': 0.95,
};

export const HARVEST_PRICE_SOURCES = harvestSourceList('ismeaOilPrice', 'desertAdaptCarob', 'faostatContext');
