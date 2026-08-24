import type { SpeciesSource } from '../types';

export const HARVEST_MODEL_VERSION = 'growup-harvest-1.0.0';

export const HARVEST_SOURCES = {
  faoPaper66: {
    label: 'FAO Irrigation and Drainage Paper 66',
    url: 'https://www.fao.org/4/i2800e/i2800e00.pdf',
    supports: ['Rainfed versus irrigated fruit-tree yield envelopes', 'olive citrus almond pistachio water response'],
    version: '2012, checked 2026-08-24',
  },
  iocOilRatio: {
    label: 'International Olive Council',
    url: 'https://www.internationaloliveoil.org/wp-content/uploads/2019/11/INTERNATIONAL-OLIVE-OIL-PRODUCTION-COSTS-STUDY-.pdf',
    supports: ['Olive-to-oil mass ratio ~19.25%', 'not mixed-system hectare yield'],
    version: '2015 production-costs study, checked 2026-08-24',
  },
  faoOliveChapter: {
    label: 'FAO olive production systems',
    url: 'https://www.fao.org/4/i2800e/i2800e09.pdf',
    supports: ['Traditional grove fruit-yield context', 'limitation: t/ha is not mixed agroforestry'],
    version: 'FAO ID 66 olive chapter, checked 2026-08-24',
  },
  batlleCarob: {
    label: 'IPGRI / Batlle 1997 Carob tree',
    url: 'https://hdl.handle.net/10568/104277',
    supports: ['Ceratonia pod kg/tree', 'kernel share of pod mass'],
    version: 'Neglected and Underutilized Crops 17, 1997',
  },
  desertAdaptCarob: {
    label: 'LIFE Desert-Adapt carob note',
    url: 'https://www.desert-adapt.it/download/Commercial%20plan%20Carob_International%20(ENG).pdf',
    supports: ['Traditional 50–70 kg pods/tree', 'pod farm-gate price band 2022'],
    version: 'LIFE16 CCA/IT/000011, accessed 2026-08-24',
  },
  calabriaLcc: {
    label: 'Frontiers LCC Mediterranean crops 2022',
    url: 'https://www.frontiersin.org/articles/10.3389/fsufs.2022.1004065/full',
    supports: ['Calabria orchard t/ha at stated density converted to kg/tree'],
    version: 'Front. Sustain. Food Syst. 2022, checked 2026-08-24',
  },
  oivWine: {
    label: 'OIV grape-to-wine conversion',
    url: 'https://www.oiv.int/',
    supports: ['About 1.3–1.4 kg grapes per litre of wine', 'not a bottling or PDO yield'],
    version: 'OIV conversion practice, checked 2026-08-24',
  },
  ismeaOilPrice: {
    label: 'ISMEA olive-oil origin prices (snapshot)',
    url: 'https://www.ismeamercati.it/',
    supports: ['Italian EVO farm-gate planning band', 'user-editable', 'not a live feed'],
    version: 'campaign 2025–26 public reports, snapshot 2026-08-24',
  },
  faostatContext: {
    label: 'FAOSTAT fruit and nut yields',
    url: 'https://www.fao.org/faostat/',
    supports: ['National t/ha context only', 'never applied to Growup plant counts'],
    version: 'FAOSTAT, checked 2026-08-24',
  },
} as const satisfies Record<string, SpeciesSource>;

export function harvestSourceList(...ids: Array<keyof typeof HARVEST_SOURCES>): SpeciesSource[] {
  return ids.map((id) => HARVEST_SOURCES[id]);
}
