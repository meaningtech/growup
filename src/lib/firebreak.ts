import type { Coordinate, Evidence, FirebreakConfiguration, FirebreakPlan, SiteBoundary, SiteProfile } from '../types';
import { firebreakEnvelope, normalizeFirebreakConfiguration } from '../data/firebreak';
import { createLocalProjection, pointInPolygon, polygonAreaM2, polygonCentroid, polygonPerimeterM, type PointM } from './geometry';
import { sitePolygons } from './siteGeometry';

const FIREBREAK_EVIDENCE: Evidence[] = [
  {
    source: 'Natural England and Defra',
    sourceUrl: 'https://www.gov.uk/government/publications/heather-and-grass-management-code/heather-and-grass-management-code-2025',
    version: 'Heather and Grass Management Code 2025',
    observedAt: '2025-09-30T00:00:00.000Z',
    confidence: 'high',
    resolution: 'firebreak width at least 2.5× expected flame length',
  },
  {
    source: 'USDA Natural Resources Conservation Service',
    sourceUrl: 'https://www.nrcs.usda.gov/resources/guides-and-instructions/firebreak-ft-394-conservation-practice-standard',
    version: 'Conservation Practice Standard 394, 2022',
    observedAt: '2022-03-01T00:00:00.000Z',
    confidence: 'high',
    resolution: 'site-specific firebreak planning and annual maintenance',
  },
  {
    source: 'Italian Civil Protection Department',
    sourceUrl: 'https://www.protezionecivile.gov.it/it/approfondimento/piani-regionali-di-previsione--prevenzione-e-lotta-attiva-agli-incendi-boschivi/',
    version: 'Regional AIB planning framework',
    observedAt: '2026-07-25T00:00:00.000Z',
    confidence: 'high',
    resolution: 'regional plans are updated annually',
  },
];

export function buildFirebreakPlan(
  site: SiteBoundary,
  profile: SiteProfile,
  input: FirebreakConfiguration,
): FirebreakPlan {
  const configuration = normalizeFirebreakConfiguration(input);
  const envelope = firebreakEnvelope(configuration);
  if (!configuration.enabled) return disabledFirebreakPlan(configuration);

  const origin = polygonCentroid(site.polygon);
  const projection = createLocalProjection(origin);
  const lines = sitePolygons(site).flatMap((polygon, polygonIndex) => {
    const localPolygon = polygon.map(projection.project);
    return localPolygon.map((start, edgeIndex) => {
      const end = localPolygon[(edgeIndex + 1) % localPolygon.length];
      const inward = inwardNormal(start, end, localPolygon);
      const offsetM = configuration.widthM / 2;
      const points = [
        projection.unproject({ x: start.x + inward.x * offsetM, y: start.y + inward.y * offsetM }),
        projection.unproject({ x: end.x + inward.x * offsetM, y: end.y + inward.y * offsetM }),
      ];
      const outwardBearing = vectorBearingDegrees({ x: -inward.x, y: -inward.y });
      const windDirection = profile.solar.prevailingWindDirectionDegrees;
      return {
        id: `firebreak-${polygonIndex}-${edgeIndex}`,
        points,
        widthM: configuration.widthM,
        lengthM: round(Math.hypot(end.x - start.x, end.y - start.y), 1),
        priority: windDirection !== null && windDirection !== undefined && axisDifference(outwardBearing, windDirection) <= 45
          ? 'windward' as const
          : 'standard' as const,
      };
    });
  });
  const totalLengthM = sitePolygons(site).reduce((sum, polygon) => sum + polygonPerimeterM(polygon), 0);
  const grossAreaM2 = sitePolygons(site).reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
  const reservedAreaM2 = Math.round(Math.min(grossAreaM2, totalLengthM * configuration.widthM));
  const notes = [
    `${configuration.widthM.toFixed(1)} m is reserved inward from every outer parcel boundary and excluded from planting.`,
    `The planning basis is ${envelope.minimumPlanningWidthM.toFixed(1)} m for an expected ${configuration.expectedFlameLengthM.toFixed(1)} m flame length.`,
    'Keep the break continuous, connect it to usable access or natural anchor points, and inspect it at least annually.',
    'This is a planning reserve, not a fire-safety certification; confirm width, treatment, permits and maintenance with the competent local authority.',
  ];
  if (profile.terrain.slopePercent >= 20) notes.push(`The mapped mean slope is ${profile.terrain.slopePercent.toFixed(1)}%; steep or midslope sections require specialist review and erosion controls.`);
  if (configuration.treatment === 'bare-ground') notes.push('Bare ground can increase erosion and must include site-specific stabilization and runoff controls.');
  if (!envelope.planningWidthSatisfied) notes.push('The planned width is below the selected flame-length planning basis.');

  return {
    enabled: true,
    fuelModel: configuration.fuelModel,
    treatment: configuration.treatment,
    expectedFlameLengthM: configuration.expectedFlameLengthM,
    minimumPlanningWidthM: envelope.minimumPlanningWidthM,
    plannedWidthM: configuration.widthM,
    totalLengthM: round(totalLengthM, 1),
    reservedAreaM2,
    supportVehicleAccess: configuration.supportVehicleAccess,
    protectPipeCrossings: configuration.protectPipeCrossings,
    planningWidthSatisfied: envelope.planningWidthSatisfied,
    localReviewRequired: true,
    lines,
    notes,
    evidence: FIREBREAK_EVIDENCE.map((item) => ({ ...item })),
  };
}

export function disabledFirebreakPlan(input?: Partial<FirebreakConfiguration> | null): FirebreakPlan {
  const configuration = normalizeFirebreakConfiguration(input);
  const envelope = firebreakEnvelope(configuration);
  return {
    enabled: false,
    fuelModel: configuration.fuelModel,
    treatment: configuration.treatment,
    expectedFlameLengthM: configuration.expectedFlameLengthM,
    minimumPlanningWidthM: envelope.minimumPlanningWidthM,
    plannedWidthM: configuration.widthM,
    totalLengthM: 0,
    reservedAreaM2: 0,
    supportVehicleAccess: configuration.supportVehicleAccess,
    protectPipeCrossings: configuration.protectPipeCrossings,
    planningWidthSatisfied: true,
    localReviewRequired: true,
    lines: [],
    notes: ['Perimeter firebreak planning is disabled for this design.'],
    evidence: FIREBREAK_EVIDENCE.map((item) => ({ ...item })),
  };
}

export function plantingBoundaryClearanceM(site: SiteBoundary, configuration: FirebreakConfiguration) {
  const firebreak = normalizeFirebreakConfiguration(configuration);
  return Math.max(site.setbackM, firebreak.enabled ? firebreak.widthM : 0);
}

function inwardNormal(start: PointM, end: PointM, polygon: PointM[]) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const candidates = [
    { x: -dy / length, y: dx / length },
    { x: dy / length, y: -dx / length },
  ];
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return candidates.find((normal) => pointInPolygon({
    x: midpoint.x + normal.x * 0.25,
    y: midpoint.y + normal.y * 0.25,
  }, polygon)) ?? candidates[0];
}

function vectorBearingDegrees(vector: PointM) {
  return normalizeDegrees(Math.atan2(vector.x, vector.y) * 180 / Math.PI);
}

function axisDifference(first: number, second: number) {
  const difference = Math.abs(normalizeDegrees(first) - normalizeDegrees(second));
  return Math.min(difference, 360 - difference);
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
