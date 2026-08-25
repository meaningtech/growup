import { growthState } from '../src/lib/growth.js';
import { plantPositionCode } from '../src/lib/plantIdentity.js';
import { resolvePlanningSpecies } from '../src/lib/userCatalogue.js';
import type { Coordinate, DesignSpecies, LayoutVariant, ProjectState } from '../src/types.js';

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type GeoJsonFeature = {
  type: 'Feature';
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown>;
};

export function exportProjectGeoJson(project: ProjectState) {
  const variant = selectedVariant(project);
  const year = project.timelineYear;
  const features: GeoJsonFeature[] = [siteFeature(project)];

  project.site.exclusions.forEach((polygon, index) => features.push(polygonFeature(polygon, {
    kind: 'manual_exclusion',
    index: index + 1,
  })));
  [...project.site.paths].sort(byId).forEach((path) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: path.points.map(coordinatePair) },
    properties: { kind: 'management_path', id: path.id, name: path.name, widthM: path.widthM },
  }));
  [...(project.designConfiguration.plantingLines ?? [])].sort(byId).forEach((line, index) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: line.points.map(coordinatePair) },
    properties: { kind: 'planting_line', id: line.id, index: index + 1 },
  }));
  [...project.site.accessPoints].sort(byId).forEach((point) => features.push(pointFeature(point.coordinate, {
    kind: 'access_point', id: point.id, name: point.name,
  })));
  [...project.site.waterPoints].sort(byId).forEach((point) => features.push(pointFeature(point.coordinate, {
    kind: 'water_point', id: point.id, name: point.name,
  })));
  [...project.site.existingTrees].sort(byId).forEach((tree) => features.push(pointFeature(tree.coordinate, {
    kind: 'observed_tree',
    id: tree.id,
    name: tree.name,
    speciesName: tree.speciesName,
    crownDiameterM: tree.crownDiameterM,
    protectionBufferM: tree.protectionBufferM,
  })));
  [...(project.siteProfile?.satellite.existingVegetation.patches ?? [])].sort(byId).forEach((patch) => features.push(polygonFeature(patch.polygon, {
    kind: 'existing_woody_vegetation',
    id: patch.id,
    confidence: patch.confidence,
    currentNdvi: patch.currentNdvi,
    medianNdvi: patch.medianNdvi,
    protectedAreaM2: patch.protectedAreaM2,
  })));

  if (variant) appendVariantFeatures(features, variant, year, project.userSpecies);
  if (project.irrigation) {
    features.push(pointFeature(project.irrigation.network.source.coordinate, {
      kind: 'irrigation_source',
      sourceType: project.irrigation.network.source.type,
      elevationM: project.irrigation.network.source.elevationM,
      placement: project.irrigation.network.source.placement,
    }));
    [...project.irrigation.network.lines].sort(byId).forEach((line) => features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.points.map(coordinatePair) },
      properties: {
        kind: 'irrigation_line',
        id: line.id,
        lineKind: line.kind,
        routingStatus: line.routingStatus,
        zoneId: line.zoneId,
        lengthM: line.lengthM,
        diameterMm: line.diameterMm,
        designFlowM3Hour: line.designFlowM3Hour,
        headLossM: line.headLossM,
      },
    }));
  }
  [...project.collaboration.comments].sort(byId).filter((comment) => comment.coordinate).forEach((comment) => features.push(pointFeature(comment.coordinate!, {
    kind: 'review_comment',
    id: comment.id,
    authorName: comment.authorName,
    message: comment.message,
    target: comment.target,
    targetId: comment.targetId,
    revision: comment.revision,
    createdAt: comment.createdAt,
    resolvedAt: comment.resolvedAt,
  })));

  return {
    type: 'FeatureCollection',
    name: project.name,
    projectId: project.id,
    variantId: variant?.id ?? null,
    timelineYear: year,
    generatedAt: project.updatedAt,
    generation: variant?.generation ?? null,
    maintenance: project.irrigation?.systemMaintenance ?? null,
    operations: project.operations ?? null,
    fireOperations: project.fireOperations,
    review: project.collaboration.review,
    commentCount: project.collaboration.comments.length,
    features,
  };
}

export function exportProjectCsv(project: ProjectState): string {
  const variant = selectedVariant(project);
  const headers = [
    'project_id', 'project_name', 'variant_id', 'generation_mode', 'generation_seed', 'growth_year',
    'tree_id', 'plant_code', 'species_id', 'scientific_name', 'common_name', 'latitude', 'longitude', 'row_index',
    'position_index', 'planted_year', 'removed_year', 'locked', 'active', 'height_low_m', 'height_base_m',
    'height_high_m', 'crown_low_m', 'crown_base_m', 'crown_high_m', 'growth_model', 'growth_confidence',
    'currency_code', 'unit_purchase_cost', 'planting_labor_hours', 'planting_labor_cost',
    'maintenance_year', 'maintenance_model', 'maintenance_phase', 'maintenance_hours', 'maintenance_labor_cost',
    'vegetation_control_hours', 'training_pruning_hours', 'biomass_succession_hours', 'inspection_replanting_hours',
    'fire_controls_complete', 'fire_controls_due', 'review_status', 'review_comment_count',
    'operations_model', 'planting_start_month', 'planting_end_month', 'pruning_start_month', 'pruning_end_month', 'operations_match',
  ];
  if (!variant) return `${headers.join(',')}\n`;
  const year = project.timelineYear;
  const economics = project.economicConfiguration;
  const maintenance = project.irrigation?.systemMaintenance ?? null;
  const maintenanceHours = new Map(maintenance?.tasks.map((task) => [task.id, task.hours]) ?? []);
  const speciesCosts = new Map((project.costs?.bySpecies ?? []).map((item) => [item.speciesId, item]));
  const operationsBySpecies = new Map((project.operations?.species ?? []).map((entry) => [entry.speciesId, entry]));
  const rows = [...variant.trees]
    .sort((a, b) => a.rowIndex - b.rowIndex || a.positionIndex - b.positionIndex || a.id.localeCompare(b.id))
    .map((tree) => {
      const species = resolvePlanningSpecies(tree.speciesId, project.userSpecies);
      const growth = species ? growthState(species, tree, year) : null;
      const cost = speciesCosts.get(tree.speciesId);
      const unitPurchaseCost = cost?.unitPlantCost ?? (species ? species.referencePurchasePrice * economics.plantReferenceMultiplier * economics.exchangeRateToLocal : 0);
      const laborHours = cost?.unitLaborHours ?? species?.plantingLaborHours ?? 0;
      const operations = operationsBySpecies.get(tree.speciesId);
      return [
        project.id,
        project.name,
        variant.id,
        variant.generation.mode,
        variant.generation.seed,
        year,
        tree.id,
        plantPositionCode(tree),
        tree.speciesId,
        species?.scientificName ?? '',
        species?.commonName ?? '',
        fixed(tree.coordinate.lat, 7),
        fixed(tree.coordinate.lng, 7),
        tree.rowIndex,
        tree.positionIndex,
        tree.plantedYear,
        tree.removedYear ?? '',
        tree.locked,
        growth?.active ?? false,
        fixed(growth?.uncertainty.heightLowM ?? 0, 2),
        fixed(growth?.heightM ?? 0, 2),
        fixed(growth?.uncertainty.heightHighM ?? 0, 2),
        fixed(growth?.uncertainty.crownDiameterLowM ?? 0, 2),
        fixed(growth?.crownDiameterM ?? 0, 2),
        fixed(growth?.uncertainty.crownDiameterHighM ?? 0, 2),
        growth?.model.version ?? '',
        growth?.model.confidence ?? '',
        economics.currencyCode,
        fixed(unitPurchaseCost, 2),
        fixed(laborHours, 2),
        fixed(laborHours * economics.laborCostPerHour, 2),
        maintenance?.year ?? '',
        maintenance?.modelVersion ?? '',
        maintenance?.phase ?? '',
        fixed(maintenance?.totalHours ?? 0, 2),
        fixed(maintenance?.totalCost ?? 0, 2),
        fixed(maintenanceHours.get('vegetation-control') ?? 0, 2),
        fixed(maintenanceHours.get('training-pruning') ?? 0, 2),
        fixed(maintenanceHours.get('biomass-succession') ?? 0, 2),
        fixed(maintenanceHours.get('inspection-replanting') ?? 0, 2),
        project.fireOperations.tasks.filter((task) => task.status === 'complete').length,
        project.fireOperations.tasks.filter((task) => task.status === 'due').length,
        project.collaboration.review?.status ?? 'pending',
        project.collaboration.comments.length,
        project.operations?.modelVersion ?? '',
        operations?.resolvedPlantingWindow?.startMonth ?? '',
        operations?.resolvedPlantingWindow?.endMonth ?? '',
        operations?.resolvedPruningWindow?.startMonth ?? '',
        operations?.resolvedPruningWindow?.endMonth ?? '',
        operations?.profile.matchLevel ?? '',
      ].map(csvCell).join(',');
    });
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

function appendVariantFeatures(features: GeoJsonFeature[], variant: LayoutVariant, year: number, extras: DesignSpecies[] = []) {
  [...variant.trees]
    .sort((a, b) => a.rowIndex - b.rowIndex || a.positionIndex - b.positionIndex || a.id.localeCompare(b.id))
    .forEach((tree) => {
      const species = resolvePlanningSpecies(tree.speciesId, extras);
      const growth = species ? growthState(species, tree, year) : null;
      features.push(pointFeature(tree.coordinate, {
        kind: 'tree',
        id: tree.id,
        plantCode: plantPositionCode(tree),
        speciesId: tree.speciesId,
        scientificName: species?.scientificName ?? null,
        commonName: species?.commonName ?? null,
        rowIndex: tree.rowIndex,
        positionIndex: tree.positionIndex,
        plantedYear: tree.plantedYear,
        removedYear: tree.removedYear,
        locked: tree.locked,
        active: growth?.active ?? false,
        heightM: growth?.heightM ?? 0,
        heightLowM: growth?.uncertainty.heightLowM ?? 0,
        heightHighM: growth?.uncertainty.heightHighM ?? 0,
        crownDiameterM: growth?.crownDiameterM ?? 0,
        crownDiameterLowM: growth?.uncertainty.crownDiameterLowM ?? 0,
        crownDiameterHighM: growth?.uncertainty.crownDiameterHighM ?? 0,
        growthModel: growth?.model.version ?? null,
        growthConfidence: growth?.model.confidence ?? null,
        timelineYear: year,
      }));
    });
  [...variant.machinery.corridors].sort(byId).forEach((corridor) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: corridor.points.map(coordinatePair) },
    properties: { kind: 'machinery_corridor', id: corridor.id, widthM: corridor.widthM },
  }));
  [...variant.machinery.turningAreas].sort(byId).forEach((area) => features.push(pointFeature(area.center, {
    kind: 'machinery_turning_area', id: area.id, radiusM: area.radiusM, rowIndexes: area.rowIndexes,
  })));
  [...(variant.machinery.perimeterLoops ?? [])].sort(byId).forEach((route) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: route.points.map(coordinatePair) },
    properties: {
      kind: 'machinery_perimeter_loop',
      id: route.id,
      widthM: route.widthM,
      lengthM: route.lengthM,
      closed: route.closed,
      clearanceSatisfied: route.clearanceSatisfied,
    },
  }));
  [...(variant.machinery.manoeuvreRoutes ?? [])].sort(byId).forEach((route) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: route.points.map(coordinatePair) },
    properties: {
      kind: 'machinery_manoeuvre_route',
      id: route.id,
      widthM: route.widthM,
      lengthM: route.lengthM,
      connectedCorridorIds: route.connectedCorridorIds,
      clearanceSatisfied: route.clearanceSatisfied,
    },
  }));
  [...(variant.firebreak?.lines ?? [])].sort(byId).forEach((line) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: line.points.map(coordinatePair) },
    properties: {
      kind: 'firebreak',
      id: line.id,
      widthM: line.widthM,
      lengthM: line.lengthM,
      priority: line.priority,
      treatment: variant.firebreak.treatment,
      planningWidthSatisfied: variant.firebreak.planningWidthSatisfied,
      localReviewRequired: variant.firebreak.localReviewRequired,
    },
  }));
}

function selectedVariant(project: ProjectState): LayoutVariant | null {
  return project.variants.find((item) => item.id === project.selectedVariantId) ?? project.variants[0] ?? null;
}

function siteFeature(project: ProjectState): GeoJsonFeature {
  const primary = [closedRing(project.site.polygon), ...project.site.holes.map(closedRing)];
  const additional = project.site.additionalPolygons.map((polygon) => [closedRing(polygon)]);
  return {
    type: 'Feature',
    geometry: additional.length
      ? { type: 'MultiPolygon', coordinates: [primary, ...additional] }
      : { type: 'Polygon', coordinates: primary },
    properties: { kind: 'site', id: project.site.id, name: project.site.name, setbackM: project.site.setbackM },
  };
}

function polygonFeature(polygon: Coordinate[], properties: Record<string, unknown>): GeoJsonFeature {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closedRing(polygon)] }, properties };
}

function pointFeature(coordinate: Coordinate, properties: Record<string, unknown>): GeoJsonFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: coordinatePair(coordinate) }, properties };
}

function closedRing(points: Coordinate[]): number[][] {
  const coordinates = points.map(coordinatePair);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push([...first]);
  return coordinates;
}

function coordinatePair(point: Coordinate): number[] {
  return [point.lng, point.lat];
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0';
}

function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
