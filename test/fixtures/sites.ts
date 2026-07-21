import type { SiteBoundary } from '../../src/types';

export const TEMPERATE_OPEN_FIELD_FIXTURE: SiteBoundary = {
  id: 'temperate-open-field-fixture',
  name: 'Open field runtime fixture',
  polygon: [
    { lat: 36.92130, lng: 14.75300 },
    { lat: 36.92105, lng: 14.75365 },
    { lat: 36.92085, lng: 14.75368 },
    { lat: 36.92073, lng: 14.75320 },
    { lat: 36.92085, lng: 14.75292 },
  ],
  additionalPolygons: [],
  holes: [],
  exclusions: [],
  paths: [],
  accessPoints: [],
  waterPoints: [],
  existingTrees: [],
  setbackM: 1.3,
};

export const WOODY_FIELD_FIXTURE: SiteBoundary = {
  id: 'woody-field-fixture',
  name: 'Woody field runtime fixture',
  polygon: [
    { lat: 36.92043, lng: 14.75198 },
    { lat: 36.92049, lng: 14.75288 },
    { lat: 36.92028, lng: 14.75315 },
    { lat: 36.92004, lng: 14.75302 },
    { lat: 36.91997, lng: 14.75248 },
    { lat: 36.92008, lng: 14.75192 },
  ],
  additionalPolygons: [],
  holes: [],
  exclusions: [],
  paths: [],
  accessPoints: [],
  waterPoints: [],
  existingTrees: [],
  setbackM: 1.3,
};

export const EQUATORIAL_OPEN_FIELD_FIXTURE: SiteBoundary = {
  id: 'equatorial-open-field-fixture',
  name: 'Equatorial field runtime fixture',
  polygon: [
    { lat: 1.08188, lng: 34.18110 },
    { lat: 1.08186, lng: 34.18203 },
    { lat: 1.08128, lng: 34.18209 },
    { lat: 1.08116, lng: 34.18154 },
    { lat: 1.08137, lng: 34.18106 },
  ],
  additionalPolygons: [],
  holes: [],
  exclusions: [],
  paths: [],
  accessPoints: [
    { id: 'equatorial-south-gate', name: 'South gate', coordinate: { lat: 1.08120, lng: 34.18152 } },
  ],
  waterPoints: [],
  existingTrees: [],
  setbackM: 1.5,
};
