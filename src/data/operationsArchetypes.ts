import type {
  DesignSpecies,
  MonthWindow,
  OperationsArchetypeId,
  OperationsFrostConstraint,
  OperationsPlantingMethod,
  SpeciesOperationsFields,
  SpeciesSource,
  StockClass,
} from '../types';
import { operationsSourceList } from './operationsSources';

const ARCHETYPE_SOURCES: SpeciesSource[] = operationsSourceList('embrapaManagement', 'euforgen', 'faoAgroforest', 'italyPlanningDefault');

function window(startMonth: number, endMonth: number, confidence: MonthWindow['confidence'] = 'medium'): MonthWindow {
  return { startMonth, endMonth, confidence, sources: ARCHETYPE_SOURCES };
}

const SHARED_PLANT_STEPS = ['plant.water-in', 'plant.firm-soil', 'plant.mulch-basin'] as const;
const SHARED_CARE = ['care.first-summer-water', 'care.weed-circle', 'care.inspect-guards'] as const;

export const OPERATIONS_ARCHETYPES: Record<OperationsArchetypeId, SpeciesOperationsFields> = {
  'grafted-deciduous-fruit': fields({
    window: window(1, 3),
    method: 'grafted',
    frost: 'plant-dormant',
    hole: [0.6, 0.6],
    water: 'critical',
    prune: ['training', 'dormant', window(12, 2), 'annual'],
    extraSteps: ['plant.orient-graft', 'plant.stake', 'prune.formative', 'prune.keep-leader'],
  }),
  'citrus-evergreen': fields({
    window: window(3, 5),
    method: 'grafted',
    frost: 'wait-after-frost',
    hole: [0.6, 0.6],
    water: 'critical',
    prune: ['production', 'after-harvest', window(2, 4), 'annual'],
    extraSteps: ['plant.orient-graft', 'plant.stake', 'prune.remove-dead'],
  }),
  'mediterranean-evergreen-crop': fields({
    window: window(11, 3),
    method: 'container',
    frost: 'autumn-evergreen-ok',
    hole: [0.6, 0.7],
    water: 'moderate',
    prune: ['production', 'after-harvest', window(2, 3), 'annual'],
    extraSteps: ['plant.stake', 'prune.remove-dead'],
  }),
  'forestry-evergreen-climax': fields({
    window: window(10, 3),
    method: 'container',
    frost: 'autumn-evergreen-ok',
    hole: [0.4, 0.4],
    water: 'moderate',
    prune: ['minimal', 'dormant', window(11, 2), 'as-needed'],
    extraSteps: ['prune.remove-dead'],
  }),
  'forestry-deciduous-climax': fields({
    window: window(11, 3),
    method: 'container',
    frost: 'plant-dormant',
    hole: [0.45, 0.45],
    water: 'moderate',
    prune: ['training', 'dormant', window(12, 2), 'annual'],
    extraSteps: ['prune.formative', 'prune.keep-leader'],
  }),
  'placenta-biomass': fields({
    window: window(11, 3),
    method: 'cutting',
    frost: 'plant-dormant',
    hole: [0.35, 0.4],
    water: 'moderate',
    prune: ['coppice', 'biomass-cycle', window(12, 2), 'every-3-years'],
    extraSteps: ['coppice.biomass-on-site'],
    years: 2,
  }),
  'mediterranean-shrub': fields({
    window: window(10, 3),
    method: 'container',
    frost: 'autumn-evergreen-ok',
    hole: [0.3, 0.3],
    water: 'minimal-once-established',
    prune: ['minimal', 'after-flowering', window(6, 8), 'as-needed'],
    extraSteps: ['prune.remove-dead'],
    years: 2,
  }),
  'climber-vine': fields({
    window: window(1, 3),
    method: 'cutting',
    frost: 'plant-dormant',
    hole: [0.4, 0.5],
    water: 'critical',
    prune: ['production', 'dormant', window(12, 2), 'annual'],
    extraSteps: ['plant.stake', 'prune.formative'],
  }),
  'succulent-cutting': fields({
    window: window(4, 6),
    method: 'pad',
    frost: 'wait-after-frost',
    hole: [0.3, 0.3],
    water: 'minimal-once-established',
    prune: ['sanitary-only', null, null, 'as-needed'],
    extraSteps: ['prune.remove-dead'],
    years: 1,
    mulch: false,
  }),
  'woody-default': fields({
    window: window(11, 3, 'low'),
    method: 'container',
    frost: 'unknown',
    hole: [0.4, 0.4],
    water: 'moderate',
    prune: ['minimal', null, null, 'as-needed'],
    extraSteps: ['prune.remove-dead'],
  }),
};

export const GENUS_ARCHETYPES: Record<string, OperationsArchetypeId> = {
  malus: 'grafted-deciduous-fruit',
  pyrus: 'grafted-deciduous-fruit',
  prunus: 'grafted-deciduous-fruit',
  juglans: 'grafted-deciduous-fruit',
  corylus: 'grafted-deciduous-fruit',
  castanea: 'grafted-deciduous-fruit',
  ficus: 'grafted-deciduous-fruit',
  punica: 'grafted-deciduous-fruit',
  diospyros: 'grafted-deciduous-fruit',
  ziziphus: 'grafted-deciduous-fruit',
  morus: 'grafted-deciduous-fruit',
  citrus: 'citrus-evergreen',
  olea: 'mediterranean-evergreen-crop',
  ceratonia: 'mediterranean-evergreen-crop',
  pistacia: 'mediterranean-evergreen-crop',
  eriobotrya: 'mediterranean-evergreen-crop',
  laurus: 'mediterranean-evergreen-crop',
  arbutus: 'mediterranean-evergreen-crop',
  quercus: 'forestry-evergreen-climax',
  pinus: 'forestry-evergreen-climax',
  cupressus: 'forestry-evergreen-climax',
  juniperus: 'forestry-evergreen-climax',
  fraxinus: 'forestry-deciduous-climax',
  celtis: 'forestry-deciduous-climax',
  fagus: 'forestry-deciduous-climax',
  acer: 'forestry-deciduous-climax',
  carpinus: 'forestry-deciduous-climax',
  tilia: 'forestry-deciduous-climax',
  populus: 'placenta-biomass',
  salix: 'placenta-biomass',
  alnus: 'placenta-biomass',
  robinia: 'placenta-biomass',
  spartium: 'placenta-biomass',
  medicago: 'placenta-biomass',
  vitis: 'climber-vine',
  myrtus: 'mediterranean-shrub',
  rhamnus: 'mediterranean-shrub',
  cistus: 'mediterranean-shrub',
  lavandula: 'mediterranean-shrub',
  salvia: 'mediterranean-shrub',
  phillyrea: 'mediterranean-shrub',
  rosmarinus: 'mediterranean-shrub',
  capparis: 'mediterranean-shrub',
  chamaerops: 'mediterranean-shrub',
  opuntia: 'succulent-cutting',
  tamarix: 'placenta-biomass',
  sambucus: 'grafted-deciduous-fruit',
  crataegus: 'forestry-deciduous-climax',
  cercis: 'forestry-deciduous-climax',
};

export function plantingMethodForStock(stockClass: StockClass): OperationsPlantingMethod {
  if (stockClass === 'fruit-grafted' || stockClass === 'citrus-grafted') return 'grafted';
  if (stockClass === 'cutting') return 'cutting';
  return 'container';
}

export function archetypeForDesignSpecies(species: DesignSpecies): OperationsArchetypeId {
  const genus = species.scientificName.trim().split(/\s+/)[0]?.toLocaleLowerCase('en');
  if (genus && GENUS_ARCHETYPES[genus]) return GENUS_ARCHETYPES[genus];
  if (species.stockClass === 'citrus-grafted') return 'citrus-evergreen';
  if (species.stratum === 'climber') return 'climber-vine';
  if (species.succession === 'placenta') return 'placenta-biomass';
  if (species.stockClass === 'fruit-grafted') return 'grafted-deciduous-fruit';
  if (species.stockClass === 'cutting' && species.droughtTolerance >= 4) return 'succulent-cutting';
  if ((species.stratum === 'low' || species.stratum === 'ground') && species.evergreen) return 'mediterranean-shrub';
  if (species.evergreen && species.productiveFromYear) return 'mediterranean-evergreen-crop';
  if (species.evergreen) return 'forestry-evergreen-climax';
  if (species.stockClass === 'forestry-seedling') return 'forestry-deciduous-climax';
  return 'woody-default';
}

function fields(input: {
  window: MonthWindow;
  method: OperationsPlantingMethod;
  frost: OperationsFrostConstraint;
  hole: [number, number];
  water: SpeciesOperationsFields['care']['firstYearWater'];
  prune: [SpeciesOperationsFields['pruning']['style'], SpeciesOperationsFields['pruning']['phenologyAnchor'], MonthWindow | null, SpeciesOperationsFields['pruning']['frequency']];
  extraSteps: SpeciesOperationsFields['planting']['steps'][number][];
  years?: number;
  mulch?: boolean;
}): SpeciesOperationsFields {
  return {
    planting: {
      window: input.window,
      method: input.method,
      holeWidthM: input.hole[0],
      holeDepthM: input.hole[1],
      establishmentYears: input.years ?? 3,
      frostConstraint: input.frost,
      steps: [...SHARED_PLANT_STEPS, ...input.extraSteps.filter((step) => step.startsWith('plant.'))],
    },
    pruning: {
      style: input.prune[0],
      phenologyAnchor: input.prune[1],
      window: input.prune[2],
      frequency: input.prune[3],
      productivePruningExcluded: true,
    },
    care: {
      firstYearWater: input.water,
      mulch: input.mulch ?? true,
      guards: true,
      notes: [...SHARED_CARE, ...input.extraSteps.filter((step) => !step.startsWith('plant.'))],
    },
    phenology: {
      leafOut: null,
      flowering: null,
      harvest: null,
      leafFall: null,
    },
    limitations: [],
  };
}
