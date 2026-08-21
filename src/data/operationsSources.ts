import type { SpeciesSource } from '../types';

export const OPERATIONS_MODEL_VERSION = 'growup-operations-1.1.0';

export const OPERATIONS_SOURCES = {
  ecocrop: {
    label: 'FAO ECOCROP',
    url: 'https://gaez.fao.org/pages/ecocrop',
    supports: ['climate envelope', 'life form'],
    version: 'FAO GAEZ access, checked 2026-07-21',
  },
  euforgen: {
    label: 'European Forest Genetic Resources Programme',
    url: 'https://www.euforgen.org/species',
    supports: ['European silviculture', 'planting season for forest trees'],
    version: 'online species resources, checked 2026-07-21',
  },
  mediterraneanFlora: {
    label: 'Plants of the World Online',
    url: 'https://powo.science.kew.org/',
    supports: ['growth form', 'evergreen habit'],
    version: 'online backbone, checked 2026-07-21',
  },
  embrapaManagement: {
    label: 'Embrapa',
    url: 'https://www.atermaisdigital.cnptia.embrapa.br/web/saf/principais-manejos',
    supports: ['agroforestry weeding, pruning and biomass placement'],
    version: 'accessed 2026-07-23',
  },
  faoAgroforest: {
    label: 'FAO',
    url: 'https://www.fao.org/4/w3735e/w3735e.pdf',
    supports: ['mature agroforest management endpoint'],
    version: '1996',
  },
  ucceAlmond: {
    label: 'University of California Cooperative Extension',
    url: 'https://ucanr.edu/sites/Tehama/files/23080.pdf',
    supports: ['orchard training and pruning workload'],
    version: '2006',
  },
  nrcsWindbreak: {
    label: 'USDA Natural Resources Conservation Service',
    url: 'https://www.nrcs.usda.gov/resources/guides-and-instructions/windbreakshelterbelt-establishment-and-renovation-ft-380',
    supports: ['establishment protection and periodic pruning'],
    version: '2021',
  },
  italyPlanningDefault: {
    label: 'Growup Italy operations pack',
    url: 'https://growup.earth/',
    supports: ['Mediterranean woody planting and pruning windows used as planning defaults'],
    version: OPERATIONS_MODEL_VERSION,
  },
  climateGroup: {
    label: 'Growup climate-group operations windows',
    url: 'https://growup.earth/',
    supports: ['Country-to-climate-group planting and pruning windows'],
    version: OPERATIONS_MODEL_VERSION,
  },
  lunarPruningTradition: {
    label: 'Orto da Coltivare / Mayoral et al. 2020',
    url: 'https://www.mdpi.com/2073-4395/10/7/955',
    supports: ['Traditional waning-moon pruning cue', 'no verified sap-flow effect'],
    version: 'Agronomy 10:955, checked 2026-08-21',
  },
} as const satisfies Record<string, SpeciesSource>;

export function operationsSourceList(...ids: Array<keyof typeof OPERATIONS_SOURCES>): SpeciesSource[] {
  return ids.map((id) => OPERATIONS_SOURCES[id]);
}
