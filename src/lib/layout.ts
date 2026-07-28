import type { Coordinate, DesignConfiguration, DesignSpecies, LayoutVariant, MachineryPlan, MachineryRoute, SiteBoundary, SiteProfile, TreeInstance } from '../types';
import { DEFAULT_FIREBREAK_CONFIGURATION, normalizeFirebreakConfiguration } from '../data/firebreak';
import { DEFAULT_MACHINERY_CONFIGURATION, machineryEnvelope, normalizeMachineryConfiguration } from '../data/machinery';
import { buildFirebreakPlan, plantingBoundaryClearanceM } from './firebreak';
import { growthState } from './growth';
import { compositionTargets, DEFAULT_DESIGN_OBJECTIVES, normalizeDesignObjectives, speciesObjectiveScore } from './objectives';
import { distanceToSiteBoundaryM, distanceToSitePathM, estimatedPlantableAreaM2, siteContainsCoordinate, sitePolygons } from './siteGeometry';
import { assessSolarOrientation, orientationScore } from './solar';
import { effectiveSuccession, normalizeSpeciesMix, resolvedSpeciesMix } from './speciesPlan';
import {
  bounds,
  createLocalProjection,
  distanceToPolygonEdge,
  haversineM,
  longestEdgeDirection,
  pointInPolygon,
  polygonAreaM2,
  polygonCentroid,
  polygonPerimeterM,
  rotate,
  stableHash,
  type PointM,
} from './geometry';

type VariantDefinition = {
  id: string;
  name: string;
  description: string;
  directionDegrees: number;
  rowSpacingM: number;
  treeSpacingM: number;
};

type GenerationOptions = {
  mode: 'full' | 'partial';
  lockedTrees: TreeInstance[];
};

type LockedPlacement = {
  tree: TreeInstance;
  point: PointM;
  species: DesignSpecies;
};

export const LAYOUT_ENGINE_VERSION = 'growup-layout-1.4.0';

export const DEFAULT_DESIGN_CONFIGURATION: DesignConfiguration = {
  system: 'syntropic',
  extent: 'full-field',
  perimeterBandM: 8,
  cropAlleyWidthM: 14,
  windbreakRows: 2,
  orientationObjective: 'solar-crop',
  customBearingDegrees: 0,
  analysisYear: 10,
  monocultureSpeciesId: null,
  seed: 41,
  objectives: DEFAULT_DESIGN_OBJECTIVES,
  speciesMix: {},
  machinery: DEFAULT_MACHINERY_CONFIGURATION,
  firebreak: DEFAULT_FIREBREAK_CONFIGURATION,
};

export function normalizeDesignConfiguration(value?: Partial<DesignConfiguration> | null): DesignConfiguration {
  const systems: DesignConfiguration['system'][] = ['syntropic', 'alley-cropping', 'mixed-orchard', 'monoculture', 'windbreak', 'boundary-buffer'];
  const extents: DesignConfiguration['extent'][] = ['full-field', 'perimeter-band', 'selected-edges'];
  const objectives: DesignConfiguration['orientationObjective'][] = ['solar-crop', 'contour', 'operations', 'wind-protection', 'custom'];
  const system = systems.includes(value?.system as DesignConfiguration['system']) ? value!.system! : DEFAULT_DESIGN_CONFIGURATION.system;
  const requestedExtent = extents.includes(value?.extent as DesignConfiguration['extent']) ? value!.extent! : DEFAULT_DESIGN_CONFIGURATION.extent;
  return {
    system,
    extent: system === 'windbreak' ? 'selected-edges' : system === 'boundary-buffer' ? 'perimeter-band' : requestedExtent,
    perimeterBandM: clamp(Number(value?.perimeterBandM ?? 8), 3, 30),
    cropAlleyWidthM: clamp(Number(value?.cropAlleyWidthM ?? 14), 6, 40),
    windbreakRows: Math.round(clamp(Number(value?.windbreakRows ?? 2), 1, 5)),
    orientationObjective: objectives.includes(value?.orientationObjective as DesignConfiguration['orientationObjective']) ? value!.orientationObjective! : DEFAULT_DESIGN_CONFIGURATION.orientationObjective,
    customBearingDegrees: normalizeDirection(Number(value?.customBearingDegrees ?? 0)),
    analysisYear: Math.round(clamp(Number(value?.analysisYear ?? 10), 1, 30)),
    monocultureSpeciesId: typeof value?.monocultureSpeciesId === 'string' ? value.monocultureSpeciesId : null,
    seed: Math.round(clamp(Number(value?.seed ?? 41), 1, 2_147_483_647)),
    objectives: normalizeDesignObjectives(value?.objectives),
    speciesMix: normalizeSpeciesMix(value?.speciesMix),
    machinery: normalizeMachineryConfiguration(value?.machinery),
    firebreak: normalizeFirebreakConfiguration(value?.firebreak),
  };
}

export function generateLayoutVariants(
  site: SiteBoundary,
  siteProfile: SiteProfile,
  selectedSpecies: DesignSpecies[],
  configuration: DesignConfiguration = DEFAULT_DESIGN_CONFIGURATION,
): LayoutVariant[] {
  const design = normalizeDesignConfiguration(configuration);
  assertLayoutInputs(site, siteProfile, selectedSpecies, design);
  const permitted = systemSpecies(selectedSpecies, design);
  if (!permitted.length) throw new Error('The selected palette has no species compatible with this design system');

  const definitions = variantDefinitions(site, siteProfile, permitted, design);
  return definitions.map((definition) => generateVariant(site, siteProfile, permitted, definition, design, { mode: 'full', lockedTrees: [] }));
}

export function regenerateLayoutVariant(
  site: SiteBoundary,
  siteProfile: SiteProfile,
  selectedSpecies: DesignSpecies[],
  previousVariant: LayoutVariant,
  configuration: DesignConfiguration = previousVariant.design,
): LayoutVariant {
  const design = normalizeDesignConfiguration(configuration);
  assertLayoutInputs(site, siteProfile, selectedSpecies, design);
  const permitted = systemSpecies(selectedSpecies, design);
  if (!permitted.length) throw new Error('The selected palette has no species compatible with this design system');
  const permittedIds = new Set(permitted.map((species) => species.id));
  const lockedTrees = previousVariant.trees.filter((tree) => tree.locked).map((tree) => ({ ...tree, coordinate: { ...tree.coordinate } }));
  const missingLockedSpecies = lockedTrees.find((tree) => !permittedIds.has(tree.speciesId));
  if (missingLockedSpecies) throw new Error(`Locked tree ${missingLockedSpecies.id} uses a species unavailable to the selected design system.`);
  const geometry = systemGeometry(permitted, design);
  const definition: VariantDefinition = {
    id: `${design.system}-${design.extent}-${Math.round(previousVariant.directionDegrees)}-${design.seed}`,
    name: previousVariant.name,
    description: variantDescription(design, previousVariant.directionDegrees, siteProfile),
    directionDegrees: previousVariant.directionDegrees,
    rowSpacingM: geometry.rowSpacingM,
    treeSpacingM: geometry.treeSpacingM,
  };
  return generateVariant(site, siteProfile, permitted, definition, design, { mode: 'partial', lockedTrees });
}

function assertLayoutInputs(site: SiteBoundary, siteProfile: SiteProfile, selectedSpecies: DesignSpecies[], design: DesignConfiguration) {
  if (site.polygon.length < 3) throw new Error('A valid site polygon is required');
  if (design.system === 'syntropic' && selectedSpecies.length < 3) throw new Error('Select at least three species to generate a syntropic layout');
  if (design.system !== 'monoculture' && design.system !== 'syntropic' && selectedSpecies.length < 2) throw new Error('Select at least two species for this design system');
  if (selectedSpecies.every((species) => species.invasiveStatus === 'blocked')) throw new Error('The selected palette contains no permitted species');
  if (siteProfile.satellite.existingVegetation.suitability === 'reject') {
    throw new Error('This parcel has too much existing woody vegetation for a blank-slate layout. Refine or replace the boundary first.');
  }
}

function variantDefinitions(site: SiteBoundary, siteProfile: SiteProfile, permitted: DesignSpecies[], design: DesignConfiguration): VariantDefinition[] {
  const dimensions = averageCanopy(permitted, design.analysisYear);
  const contourDirection = normalizeDirection(siteProfile.terrain.aspectDegrees + 90);
  const operationsDirection = normalizeDirection(longestEdgeDirection(site.polygon));
  const windDirection = siteProfile.solar?.prevailingWindDirectionDegrees === null || siteProfile.solar?.prevailingWindDirectionDegrees === undefined
    ? contourDirection
    : normalizeDirection(siteProfile.solar.prevailingWindDirectionDegrees + 90);
  const solarRanked = Array.from({ length: 36 }, (_, index) => index * 5)
    .map((bearing) => ({ bearing, assessment: assessSolarOrientation(siteProfile, design, bearing, dimensions) }))
    .sort((a, b) => orientationScore(b.assessment, design) - orientationScore(a.assessment, design));
  const preferred = design.orientationObjective === 'contour' ? contourDirection
    : design.orientationObjective === 'operations' ? operationsDirection
      : design.orientationObjective === 'wind-protection' ? windDirection
        : design.orientationObjective === 'custom' ? design.customBearingDegrees
          : solarRanked[0]?.bearing ?? 0;
  const bearings = uniqueBearings([preferred, solarRanked[0]?.bearing ?? 0, contourDirection, operationsDirection, windDirection]);
  const geometry = systemGeometry(permitted, design);
  const names = ['Preferred', 'Solar alternative', 'Field alternative'];
  return bearings.slice(0, 3).map((directionDegrees, index) => ({
    id: `${design.system}-${design.extent}-${Math.round(directionDegrees)}-${design.seed}`,
    name: `${names[index]} · ${systemLabel(design.system)}`,
    description: variantDescription(design, directionDegrees, siteProfile),
    directionDegrees,
    rowSpacingM: geometry.rowSpacingM,
    treeSpacingM: geometry.treeSpacingM,
  }));
}

function generateVariant(site: SiteBoundary, siteProfile: SiteProfile, species: DesignSpecies[], definition: VariantDefinition, design: DesignConfiguration, options: GenerationOptions): LayoutVariant {
  const permitted = species.filter((item) => item.invasiveStatus !== 'blocked');
  const origin = polygonCentroid(site.polygon);
  const projection = createLocalProjection(origin);
  const polygons = sitePolygons(site).map((item) => item.map(projection.project));
  const protectedVegetation = siteProfile.satellite.existingVegetation.patches.map((patch) => patch.polygon);
  const allExclusions = [...site.exclusions, ...protectedVegetation];
  const exclusions = allExclusions.map((exclusion) => exclusion.map(projection.project));
  const boundaryClearanceM = designBoundaryClearanceM(site, design);
  const obstacleClearanceM = machineryEnvelope(design.machinery).corridorWidthM;
  const candidates = design.extent === 'full-field'
    ? fullFieldCandidates(site, polygons, projection, exclusions, definition, design)
    : perimeterCandidates(site, polygons, projection, exclusions, definition, design);

  const speciesById = new Map(permitted.map((item) => [item.id, item]));
  const lockedPlacements: LockedPlacement[] = options.lockedTrees.map((tree) => ({ tree, point: projection.project(tree.coordinate), species: speciesById.get(tree.speciesId)! }));
  for (const locked of lockedPlacements) {
    if (!isPlantableCandidate(locked.tree.coordinate, locked.point, site, exclusions, boundaryClearanceM, obstacleClearanceM)) {
      throw new Error(`Locked tree ${locked.tree.id} violates a current site, exclusion, path or protected-tree constraint.`);
    }
  }
  const placedBySpecies = new Map<string, PointM[]>();
  for (const locked of lockedPlacements) placedBySpecies.set(locked.tree.speciesId, [...(placedBySpecies.get(locked.tree.speciesId) ?? []), locked.point]);
  const trees: TreeInstance[] = options.lockedTrees.map((tree) => ({ ...tree, coordinate: { ...tree.coordinate } }));
  const speciesMix = resolvedSpeciesMix(permitted, design.speciesMix);
  let lockedCandidateSkips = 0;

  for (const candidate of candidates) {
    const missing = permitted.filter((item) => speciesMix[item.id].targetPercent > 0 && !placedBySpecies.has(item.id));
    const ordered = speciesOrder(missing.length ? missing : permitted, candidate.rowIndex, candidate.positionIndex, design, placedBySpecies, speciesMix);
    const selected = ordered.find((item) => canPlaceSpecies(item, candidate, placedBySpecies)) ?? ordered[0];
    if (!selected) continue;
    if (lockedPlacements.some((locked) => lockedTreeConflict(candidate, selected, locked, definition))) {
      lockedCandidateSkips += 1;
      continue;
    }
    const id = `${definition.id}-r${candidate.rowIndex}-p${candidate.positionIndex}-${selected.id}-${design.seed}`;
    const succession = effectiveSuccession(selected, speciesMix);
    const plantedYear = succession === 'placenta' ? 0 : succession === 'secondary' ? 1 : 2;
    const removedYear = succession === 'placenta' && selected.roles.includes('biomass') ? 10 : null;

    trees.push({
      id,
      speciesId: selected.id,
      coordinate: projection.unproject(candidate),
      rowIndex: candidate.rowIndex,
      positionIndex: candidate.positionIndex,
      plantedYear,
      removedYear,
      locked: false,
      seed: stableHash(id),
    });
    placedBySpecies.set(selected.id, [...(placedBySpecies.get(selected.id) ?? []), candidate]);
  }

  const firebreak = buildFirebreakPlan(site, siteProfile, design.firebreak);
  const additionalFirebreakReserveM2 = firebreak.enabled
    ? firebreak.totalLengthM * Math.max(0, firebreak.plannedWidthM - site.setbackM)
    : 0;
  const areaM2 = Math.max(1, estimatedPlantableAreaM2(site) - additionalFirebreakReserveM2 - protectedVegetation.reduce((sum, exclusion) => sum + polygonAreaM2(exclusion), 0));
  const canopy10 = canopyCoverage(trees, permitted, 10, areaM2);
  const canopy20 = canopyCoverage(trees, permitted, 20, areaM2);
  const representedSpecies = new Set(trees.map((tree) => tree.speciesId));
  const representedStrata = new Set(permitted.filter((item) => representedSpecies.has(item.id)).map((item) => item.stratum));
  const warnings: string[] = [];
  for (const item of permitted) {
    const targetPercent = speciesMix[item.id].targetPercent;
    const actualPercent = trees.length ? trees.filter((tree) => tree.speciesId === item.id).length / trees.length * 100 : 0;
    if (Math.abs(actualPercent - targetPercent) <= 5) continue;
    warnings.push(`${item.scientificName} represents ${actualPercent.toFixed(1)}% of placed plants versus the ${targetPercent.toFixed(1)}% target; spacing and hard site constraints take precedence.`);
  }

  if (design.system === 'syntropic' && representedStrata.size < 4) warnings.push('Fewer than four vertical strata could be represented in this geometry.');
  if (design.system === 'syntropic' && !permitted.some((item) => effectiveSuccession(item, speciesMix) === 'placenta')) warnings.push('The palette has no placenta-phase support species.');
  if (design.system === 'syntropic' && !permitted.some((item) => effectiveSuccession(item, speciesMix) === 'climax')) warnings.push('The palette has no long-lived climax species.');
  if (design.system === 'monoculture') warnings.push('Monoculture is a production baseline with lower planned diversity and resilience.');
  if (design.extent === 'perimeter-band') warnings.push(`Planting is restricted to an inward ${design.perimeterBandM} m boundary band; the central crop area remains unplanted.`);
  if (design.system === 'windbreak') warnings.push('Wind direction is based on reanalysis; confirm damaging seasonal winds and barrier porosity in the field.');
  if (canopy20 > 88) warnings.push('Year-20 projected crown cover is dense; scheduled pruning or thinning is required.');
  if (protectedVegetation.length) warnings.push(`${protectedVegetation.length} existing woody ${protectedVegetation.length === 1 ? 'patch is' : 'patches are'} protected from new planting.`);
  if (site.existingTrees.length) warnings.push(`${site.existingTrees.length} field-observed existing ${site.existingTrees.length === 1 ? 'tree is' : 'trees are'} protected from new planting.`);
  if (site.paths.length) warnings.push(`${site.paths.length} management ${site.paths.length === 1 ? 'path is' : 'paths are'} reserved before placement.`);
  if (firebreak.enabled) warnings.push(`${firebreak.plannedWidthM.toFixed(1)} m perimeter firebreak reserve excludes ${firebreak.reservedAreaM2} m² from planting and requires local AIB review.`);
  if (firebreak.enabled && !firebreak.planningWidthSatisfied) warnings.push(`The firebreak width is below the ${firebreak.minimumPlanningWidthM.toFixed(1)} m flame-length planning basis.`);
  const dimensions = averageCanopy(permitted, design.analysisYear);
  const solar = assessSolarOrientation(siteProfile, design, definition.directionDegrees, dimensions);
  const cropInteriorAreaM2 = estimateCropInteriorArea(site, areaM2, design, definition);
  const composition = layoutComposition(trees, permitted, design, siteProfile);
  const machinery = buildMachineryPlan(site, siteProfile, trees, projection, definition, design);

  if (design.system !== 'monoculture' && composition.nativePercent !== null && composition.nativePercent < composition.targets.nativePercent) warnings.push(`Native composition ${composition.nativePercent}% is below the ${composition.targets.nativePercent}% objective target.`);
  if (design.system === 'syntropic' && composition.nitrogenFixerPercent < composition.targets.nitrogenFixerPercent) warnings.push(`Nitrogen-fixer composition ${composition.nitrogenFixerPercent}% is below the ${composition.targets.nitrogenFixerPercent}% target.`);
  if (design.system === 'syntropic' && representedStrata.size < composition.targets.minimumStrata) warnings.push(`${representedStrata.size} strata are represented; the biodiversity objective targets ${composition.targets.minimumStrata}.`);
  const score = Math.max(0, Math.min(100, Math.round(45 + orientationScore(solar, design) * 0.35 + representedSpecies.size * 1.2 + representedStrata.size * 2 - warnings.length * 4)));
  const conflicts = lockedSpacingConflicts(lockedPlacements, definition);
  if (lockedCandidateSkips > 0) conflicts.push({
    code: 'LOCKED_TREE_SKIPPED_CANDIDATE',
    severity: 'warning',
    message: `${lockedCandidateSkips} generated candidate ${lockedCandidateSkips === 1 ? 'was' : 'were'} skipped to preserve locked-tree clearance.`,
    treeIds: options.lockedTrees.map((tree) => tree.id),
  });
  if (options.mode === 'partial') warnings.push(`Partial regeneration preserved ${options.lockedTrees.length} locked ${options.lockedTrees.length === 1 ? 'plant' : 'plants'} unchanged and reflowed ${trees.length - options.lockedTrees.length} unlocked positions.`);

  return {
    ...definition,
    design,
    solar,
    score,
    trees,
    warnings,
    generation: {
      engineVersion: LAYOUT_ENGINE_VERSION,
      mode: options.mode,
      seed: design.seed,
      lockedTreeCount: options.lockedTrees.length,
      generatedTreeCount: trees.length - options.lockedTrees.length,
      assumptions: generationAssumptions(site, definition, design, speciesMix),
      conflicts,
    },
    machinery,
    firebreak,
    composition,
    metrics: {
      totalTrees: trees.length,
      speciesCount: representedSpecies.size,
      treesPerHectare: Math.round(trees.length / (areaM2 / 10_000)),
      densityBasisAreaM2: Math.round(areaM2),
      projectedCanopyYear10Percent: canopy10,
      projectedCanopyYear20Percent: canopy20,
      cropInteriorAreaM2,
    },
  };
}

export function recalculateLayoutMetrics(
  site: SiteBoundary,
  siteProfile: SiteProfile,
  species: DesignSpecies[],
  variant: Pick<LayoutVariant, 'design' | 'rowSpacingM' | 'trees' | 'firebreak'>,
  trees: TreeInstance[] = variant.trees,
): LayoutVariant['metrics'] {
  const protectedAreaM2 = siteProfile.satellite.existingVegetation.patches
    .reduce((sum, exclusion) => sum + polygonAreaM2(exclusion.polygon), 0);
  const additionalFirebreakReserveM2 = variant.firebreak.enabled
    ? variant.firebreak.totalLengthM * Math.max(0, variant.firebreak.plannedWidthM - site.setbackM)
    : 0;
  const densityBasisAreaM2 = Math.max(1, estimatedPlantableAreaM2(site) - additionalFirebreakReserveM2 - protectedAreaM2);
  return {
    totalTrees: trees.length,
    speciesCount: new Set(trees.map((tree) => tree.speciesId)).size,
    treesPerHectare: Math.round(trees.length / (densityBasisAreaM2 / 10_000)),
    densityBasisAreaM2: Math.round(densityBasisAreaM2),
    projectedCanopyYear10Percent: canopyCoverage(trees, species, 10, densityBasisAreaM2),
    projectedCanopyYear20Percent: canopyCoverage(trees, species, 20, densityBasisAreaM2),
    cropInteriorAreaM2: estimateCropInteriorArea(site, densityBasisAreaM2, variant.design, {
      id: '',
      name: '',
      description: '',
      directionDegrees: 0,
      rowSpacingM: variant.rowSpacingM,
      treeSpacingM: 0,
    }),
  };
}

function fullFieldCandidates(
  site: SiteBoundary,
  polygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
  exclusions: PointM[][],
  definition: VariantDefinition,
  design: DesignConfiguration,
) {
  const candidates: Array<PointM & { rowIndex: number; positionIndex: number }> = [];
  const { headlandDepthM } = machineryEnvelope(design.machinery);
  const obstacleClearanceM = machineryEnvelope(design.machinery).corridorWidthM;
  const boundaryClearanceM = designBoundaryClearanceM(site, design);
  let rowIndex = 0;
  for (const polygon of polygons) {
    const rotatedPolygon = polygon.map((point) => rotate(point, -definition.directionDegrees));
    const fieldBounds = bounds(rotatedPolygon);
    for (let y = fieldBounds.minY + definition.rowSpacingM / 2; y <= fieldBounds.maxY; y += definition.rowSpacingM) {
      const stagger = rowIndex % 2 === 0 ? 0 : definition.treeSpacingM / 2;
      let positionIndex = 0;
      const rowStart = fieldBounds.minX + headlandDepthM + definition.treeSpacingM / 2 + stagger;
      const rowEnd = fieldBounds.maxX - headlandDepthM;
      for (let x = rowStart; x <= rowEnd; x += definition.treeSpacingM) {
        const currentPositionIndex = positionIndex;
        positionIndex += 1;
        const local = rotate({ x, y }, definition.directionDegrees);
        if (!pointInPolygon(local, polygon) || distanceToPolygonEdge(local, polygon) < boundaryClearanceM) continue;
        const coordinate = projection.unproject(local);
        if (!isPlantableCandidate(coordinate, local, site, exclusions, boundaryClearanceM, obstacleClearanceM)) continue;
        candidates.push({ ...local, rowIndex, positionIndex: currentPositionIndex });
      }
      rowIndex += 1;
    }
  }
  return candidates;
}

function perimeterCandidates(
  site: SiteBoundary,
  polygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
  exclusions: PointM[][],
  definition: VariantDefinition,
  design: DesignConfiguration,
) {
  const candidates: Array<PointM & { rowIndex: number; positionIndex: number }> = [];
  const bandM = design.perimeterBandM;
  const { headlandDepthM } = machineryEnvelope(design.machinery);
  const obstacleClearanceM = machineryEnvelope(design.machinery).corridorWidthM;
  const boundaryClearanceM = designBoundaryClearanceM(site, design);
  let rowIndex = 0;
  for (const polygon of polygons) {
    const center = polygon.reduce((result, point) => ({ x: result.x + point.x / polygon.length, y: result.y + point.y / polygon.length }), { x: 0, y: 0 });
    const edges = polygon.map((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const edgeBearing = normalizeDirection(toDegrees(Math.atan2(dx, dy)));
      return { start, end, dx, dy, length, edgeBearing, index };
    });
    const selectedEdges = design.extent === 'selected-edges'
      ? [...edges].sort((a, b) => axisDifference(a.edgeBearing, definition.directionDegrees) - axisDifference(b.edgeBearing, definition.directionDegrees)).slice(0, Math.max(1, Math.ceil(edges.length / 3)))
      : edges;
    for (const edge of selectedEdges) {
      if (edge.length < definition.treeSpacingM) continue;
      const tangent = { x: edge.dx / edge.length, y: edge.dy / edge.length };
      const normals = [{ x: -tangent.y, y: tangent.x }, { x: tangent.y, y: -tangent.x }];
      const midpoint = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 };
      const inward = normals.sort((a, b) => distanceToCenter(midpoint, a, center) - distanceToCenter(midpoint, b, center))[0];
      const rowCount = design.system === 'windbreak'
        ? design.windbreakRows
        : Math.max(1, Math.floor((bandM - boundaryClearanceM) / definition.rowSpacingM) + 1);
      for (let row = 0; row < rowCount; row += 1) {
        const offset = boundaryClearanceM + definition.treeSpacingM * 0.45 + row * definition.rowSpacingM;
        if (offset > bandM) continue;
        let positionIndex = 0;
        for (let along = headlandDepthM + definition.treeSpacingM / 2; along < edge.length - headlandDepthM; along += definition.treeSpacingM) {
          const currentPositionIndex = positionIndex;
          positionIndex += 1;
          const local = {
            x: edge.start.x + tangent.x * along + inward.x * offset,
            y: edge.start.y + tangent.y * along + inward.y * offset,
          };
          const coordinate = projection.unproject(local);
          if (!pointInPolygon(local, polygon) || !isPlantableCandidate(coordinate, local, site, exclusions, boundaryClearanceM, obstacleClearanceM)) continue;
          if (distanceToSiteBoundaryM(site, coordinate) > bandM) continue;
          if (candidates.some((candidate) => Math.hypot(candidate.x - local.x, candidate.y - local.y) < definition.treeSpacingM * 0.65)) continue;
          candidates.push({ ...local, rowIndex, positionIndex: currentPositionIndex });
        }
        rowIndex += 1;
      }
    }
  }
  return candidates;
}

function isPlantableCandidate(
  coordinate: Coordinate,
  local: PointM,
  site: SiteBoundary,
  exclusions: PointM[][],
  boundaryClearanceM: number,
  obstacleClearanceM: number,
) {
  if (!siteContainsCoordinate(site, coordinate)) return false;
  if (distanceToSiteBoundaryM(site, coordinate) < boundaryClearanceM) return false;
  if (exclusions.some((exclusion) => (
    pointInPolygon(local, exclusion)
    || (obstacleClearanceM > 0 && distanceToPolygonEdge(local, exclusion) < obstacleClearanceM)
  ))) return false;
  if (site.paths.some((path) => distanceToSitePathM(coordinate, path) < path.widthM / 2)) return false;
  if (site.existingTrees.some((tree) => {
    const radiusM = tree.crownDiameterM / 2 + tree.protectionBufferM + obstacleClearanceM;
    const projection = createLocalProjection(tree.coordinate);
    const point = projection.project(coordinate);
    return Math.hypot(point.x, point.y) < radiusM;
  })) return false;
  return true;
}

function speciesOrder(
  species: DesignSpecies[],
  row: number,
  position: number,
  design: DesignConfiguration,
  placedBySpecies: Map<string, PointM[]>,
  mix: ReturnType<typeof resolvedSpeciesMix>,
): DesignSpecies[] {
  const slot = (row * 7 + position) % 12;
  const target = slot === 0 ? 'emergent' : slot % 4 === 0 ? 'high' : slot % 2 === 0 ? 'medium' : slot % 3 === 0 ? 'low' : 'ground';
  const totalPlaced = [...placedBySpecies.values()].reduce((sum, points) => sum + points.length, 0);
  return [...species].sort((a, b) => {
    const aDeficit = mix[a.id].targetPercent / 100 * (totalPlaced + 1) - (placedBySpecies.get(a.id)?.length ?? 0);
    const bDeficit = mix[b.id].targetPercent / 100 * (totalPlaced + 1) - (placedBySpecies.get(b.id)?.length ?? 0);
    const aTarget = a.stratum === target ? 0 : 1;
    const bTarget = b.stratum === target ? 0 : 1;
    const phaseOrder = { placenta: 0, secondary: 1, climax: 2 } as const;
    const objectiveDifference = speciesObjectiveScore(b, design.objectives) - speciesObjectiveScore(a, design.objectives);
    return bDeficit - aDeficit
      || aTarget - bTarget
      || objectiveDifference
      || ((phaseOrder[effectiveSuccession(a, mix)] + row + position) % 3) - ((phaseOrder[effectiveSuccession(b, mix)] + row + position) % 3)
      || a.id.localeCompare(b.id);
  });
}

function layoutComposition(trees: TreeInstance[], species: DesignSpecies[], design: DesignConfiguration, profile: SiteProfile): LayoutVariant['composition'] {
  const byId = new Map(species.map((item) => [item.id, item]));
  const byStratum: LayoutVariant['composition']['byStratum'] = {};
  const bySuccession: LayoutVariant['composition']['bySuccession'] = {};
  let productive = 0;
  let nitrogenFixer = 0;
  for (const tree of trees) {
    const item = byId.get(tree.speciesId);
    if (!item) continue;
    byStratum[item.stratum] = (byStratum[item.stratum] ?? 0) + 1;
    const succession = effectiveSuccession(item, design.speciesMix);
    bySuccession[succession] = (bySuccession[succession] ?? 0) + 1;
    if (item.productiveFromYear !== null || item.roles.some((role) => /fruit|nut|food|crop|culinary|aromatic|resin|fodder/i.test(role))) productive += 1;
    if (item.nitrogenFixer) nitrogenFixer += 1;
  }
  const count = Math.max(1, trees.length);
  return {
    byStratum,
    bySuccession,
    productivePercent: Math.round(productive / count * 100),
    nativePercent: null,
    nativeDataAvailable: false,
    nitrogenFixerPercent: Math.round(nitrogenFixer / count * 100),
    targets: compositionTargets(design.objectives),
  };
}

function canPlaceSpecies(species: DesignSpecies, candidate: PointM, placedBySpecies: Map<string, PointM[]>): boolean {
  const minimum = Math.max(1.6, species.spacingM * 0.72);
  return (placedBySpecies.get(species.id) ?? []).every((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) >= minimum);
}

function lockedTreeConflict(
  candidate: PointM,
  species: DesignSpecies,
  locked: LockedPlacement,
  definition: VariantDefinition,
): boolean {
  const biologicalClearanceM = (species.spacingM + locked.species.spacingM) * 0.36;
  const gridClearanceM = definition.treeSpacingM * 0.65;
  const minimumClearanceM = Math.max(1.6, biologicalClearanceM, gridClearanceM);
  return Math.hypot(candidate.x - locked.point.x, candidate.y - locked.point.y) < minimumClearanceM;
}

function lockedSpacingConflicts(
  lockedPlacements: LockedPlacement[],
  definition: VariantDefinition,
): LayoutVariant['generation']['conflicts'] {
  const conflicts: LayoutVariant['generation']['conflicts'] = [];
  for (let index = 0; index < lockedPlacements.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < lockedPlacements.length; nextIndex += 1) {
      const current = lockedPlacements[index];
      const next = lockedPlacements[nextIndex];
      const distanceM = Math.hypot(current.point.x - next.point.x, current.point.y - next.point.y);
      const requiredM = Math.max(
        1.6,
        (current.species.spacingM + next.species.spacingM) * 0.36,
        definition.treeSpacingM * 0.65,
      );
      if (distanceM >= requiredM) continue;
      conflicts.push({
        code: 'LOCKED_TREE_SPACING',
        severity: 'warning',
        message: `Locked plants ${current.tree.id} and ${next.tree.id} are ${distanceM.toFixed(1)} m apart; ${requiredM.toFixed(1)} m is required by the current spacing rule.`,
        treeIds: [current.tree.id, next.tree.id],
      });
    }
  }
  return conflicts;
}

function generationAssumptions(
  site: SiteBoundary,
  definition: VariantDefinition,
  design: DesignConfiguration,
  speciesMix: ReturnType<typeof resolvedSpeciesMix>,
): LayoutVariant['generation']['assumptions'] {
  const polygons = sitePolygons(site).length;
  const extent = design.extent === 'full-field'
    ? 'full plantable field'
    : design.extent === 'perimeter-band'
      ? `${design.perimeterBandM.toFixed(1)} m inward perimeter band`
      : 'selected boundary edges';
  const boundaryRule = design.firebreak.enabled
    ? `${polygons} planting ${polygons === 1 ? 'polygon' : 'polygons'}; ${design.firebreak.widthM.toFixed(1)} m firebreak reserve`
    : `${polygons} planting ${polygons === 1 ? 'polygon' : 'polygons'}; ${site.setbackM.toFixed(1)} m setback`;
  return [
    { label: 'Placement seed', value: String(design.seed) },
    { label: 'Boundary rule', value: boundaryRule },
    { label: 'Grid geometry', value: `${definition.rowSpacingM.toFixed(1)} m rows × ${definition.treeSpacingM.toFixed(1)} m plants at ${Math.round(definition.directionDegrees)}°` },
    { label: 'Planting extent', value: extent },
    { label: 'Species targets', value: Object.entries(speciesMix).map(([speciesId, entry]) => `${speciesId} ${entry.targetPercent.toFixed(1)}%${entry.successionOverride ? ` (${entry.successionOverride})` : ''}`).join(' · ') },
    { label: 'Hard constraints', value: `holes, exclusions, paths, observed trees, detected woody vegetation${design.firebreak.enabled ? ' and perimeter firebreak' : ''}` },
  ];
}

function canopyCoverage(trees: TreeInstance[], species: DesignSpecies[], year: number, areaM2: number): number {
  const byId = new Map(species.map((item) => [item.id, item]));
  const crownArea = trees.reduce((sum, tree) => {
    const item = byId.get(tree.speciesId);
    if (!item) return sum;
    const state = growthState(item, tree, year);
    return sum + Math.PI * (state.crownDiameterM / 2) ** 2;
  }, 0);
  return Number(Math.min(100, crownArea / Math.max(1, areaM2) * 100 * 0.76).toFixed(1));
}

function systemSpecies(species: DesignSpecies[], design: DesignConfiguration) {
  const permitted = species.filter((item) => item.invasiveStatus !== 'blocked');
  if (design.system === 'monoculture') {
    const requested = permitted.find((item) => item.id === design.monocultureSpeciesId);
    const productive = permitted.find((item) => item.treeLike && item.productiveFromYear !== null);
    return [requested ?? productive ?? permitted[0]].filter((item): item is DesignSpecies => Boolean(item));
  }
  if (design.system === 'mixed-orchard') {
    const productive = permitted.filter((item) => item.treeLike && item.productiveFromYear !== null);
    return productive.length >= 2 ? productive : permitted.filter((item) => item.treeLike);
  }
  if (design.system === 'windbreak') {
    const wind = permitted.filter((item) => item.treeLike && item.roles.some((role) => ['wind protection', 'evergreen shelter', 'shelter', 'hedge'].includes(role)));
    return wind.length >= 2 ? wind : permitted.filter((item) => item.treeLike);
  }
  if (design.system === 'alley-cropping') return permitted.filter((item) => item.treeLike || item.stratum === 'low');
  return permitted;
}

function systemGeometry(species: DesignSpecies[], design: DesignConfiguration) {
  const averageSpacing = species.reduce((sum, item) => sum + item.spacingM, 0) / Math.max(1, species.length);
  const machineCorridorM = machineryEnvelope(design.machinery).corridorWidthM;
  const result = design.system === 'alley-cropping' ? { rowSpacingM: design.cropAlleyWidthM, treeSpacingM: clamp(averageSpacing * 0.8, 3.5, 8) }
    : design.system === 'mixed-orchard' ? { rowSpacingM: clamp(averageSpacing * 1.08, 5, 11), treeSpacingM: clamp(averageSpacing, 4, 10) }
      : design.system === 'monoculture' ? { rowSpacingM: clamp(averageSpacing, 3, 12), treeSpacingM: clamp(averageSpacing, 3, 12) }
        : design.system === 'windbreak' ? { rowSpacingM: 3.5, treeSpacingM: clamp(averageSpacing * 0.55, 2.8, 5) }
          : design.system === 'boundary-buffer' ? { rowSpacingM: 4.5, treeSpacingM: clamp(averageSpacing * 0.65, 2.8, 6) }
            : { rowSpacingM: 6.5, treeSpacingM: 3.8 };
  return { ...result, rowSpacingM: Math.max(result.rowSpacingM, machineCorridorM) };
}

function designBoundaryClearanceM(site: SiteBoundary, design: DesignConfiguration) {
  const firebreakClearanceM = plantingBoundaryClearanceM(site, design.firebreak);
  const machineryClearanceM = machineryEnvelope(design.machinery).corridorWidthM;
  return Math.max(firebreakClearanceM, machineryClearanceM);
}

function buildMachineryPlan(
  site: SiteBoundary,
  profile: SiteProfile,
  trees: TreeInstance[],
  projection: ReturnType<typeof createLocalProjection>,
  definition: VariantDefinition,
  design: DesignConfiguration,
): MachineryPlan {
  const configuration = design.machinery;
  const envelope = machineryEnvelope(configuration);
  if (!configuration.enabled) {
    return {
      enabled: false,
      presetId: configuration.presetId,
      machineWidthM: configuration.widthM,
      machineLengthM: configuration.lengthM,
      implementWidthM: configuration.implementWidthM,
      safetyClearanceM: configuration.safetyClearanceM,
      requiredCorridorWidthM: 0,
      headlandDepthM: 0,
      effectiveRowSpacingM: definition.rowSpacingM,
      reservedAreaM2: 0,
      corridors: [],
      turningAreas: [],
      perimeterLoops: [],
      manoeuvreRoutes: [],
      clearanceSatisfied: true,
      notes: ['Machinery clearance is disabled for this design.'],
    };
  }
  const rows = [...groupTreesByRow(trees, projection, definition.directionDegrees).entries()]
    .filter(([, points]) => points.length > 0)
    .sort((a, b) => rowMeanY(a[1]) - rowMeanY(b[1]));
  const corridors: MachineryPlan['corridors'] = [];
  const turningAreas: MachineryPlan['turningAreas'] = [];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const [firstRowIndex, first] = rows[index];
    const [secondRowIndex, second] = rows[index + 1];
    const startX = Math.max(Math.min(...first.map((point) => point.x)), Math.min(...second.map((point) => point.x))) - definition.treeSpacingM / 2;
    const endX = Math.min(Math.max(...first.map((point) => point.x)), Math.max(...second.map((point) => point.x))) + definition.treeSpacingM / 2;
    if (endX <= startX) continue;
    const y = (rowMeanY(first) + rowMeanY(second)) / 2;
    const start = projection.unproject(rotate({ x: startX, y }, definition.directionDegrees));
    const end = projection.unproject(rotate({ x: endX, y }, definition.directionDegrees));
    const id = `machine-corridor-${firstRowIndex}-${secondRowIndex}`;
    corridors.push({ id, points: [start, end], widthM: envelope.corridorWidthM });
    turningAreas.push(
      { id: `${id}-start`, center: start, radiusM: envelope.turningAreaRadiusM, rowIndexes: [firstRowIndex, secondRowIndex] },
      { id: `${id}-end`, center: end, radiusM: envelope.turningAreaRadiusM, rowIndexes: [firstRowIndex, secondRowIndex] },
    );
  }
  const obstaclePolygons = [
    ...site.holes,
    ...site.exclusions,
    ...profile.satellite.existingVegetation.patches.map((patch) => patch.polygon),
  ].map((polygon) => polygon.map(projection.project));
  for (const tree of site.existingTrees) {
    const centre = projection.project(tree.coordinate);
    const radiusM = tree.crownDiameterM / 2 + tree.protectionBufferM;
    obstaclePolygons.push(Array.from({ length: 20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2;
      return { x: centre.x + Math.cos(angle) * radiusM, y: centre.y + Math.sin(angle) * radiusM };
    }));
  }
  const perimeterEntries = sitePolygons(site).map((polygon, polygonIndex) => ({
    polygonIndex,
    route: buildPerimeterRoute(
      site,
      polygon,
      polygonIndex,
      envelope.corridorWidthM,
      obstaclePolygons,
      projection,
    ),
  })).filter((entry): entry is { polygonIndex: number; route: MachineryRoute } => entry.route !== null);
  const perimeterLoops = perimeterEntries.map((entry) => entry.route);
  const manoeuvreRoutes = perimeterEntries.map(({ route: loop, polygonIndex }) => {
    const polygon = sitePolygons(site)[polygonIndex]?.map(projection.project) ?? [];
    const componentCorridors = corridors.filter((corridor) => {
      const start = projection.project(corridor.points[0]);
      const end = projection.project(corridor.points[corridor.points.length - 1]);
      return pointInPolygon({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, polygon);
    });
    return buildManoeuvreRoute(
      site,
      loop,
      componentCorridors,
      polygonIndex,
      envelope.corridorWidthM,
      obstaclePolygons,
      projection,
      definition.directionDegrees,
    );
  }).filter((route): route is MachineryRoute => route !== null);
  const corridorAreaM2 = corridors.reduce((sum, corridor) => {
    const start = projection.project(corridor.points[0]);
    const end = projection.project(corridor.points[1]);
    return sum + Math.hypot(end.x - start.x, end.y - start.y) * corridor.widthM;
  }, 0);
  const turningAreaM2 = turningAreas.length * Math.PI * envelope.turningAreaRadiusM ** 2;
  const perimeterAreaM2 = perimeterLoops.reduce((sum, route) => sum + route.lengthM * route.widthM, 0);
  const corridorComponentCount = perimeterEntries.filter(({ polygonIndex }) => {
    const polygon = sitePolygons(site)[polygonIndex]?.map(projection.project) ?? [];
    return corridors.some((corridor) => {
      const start = projection.project(corridor.points[0]);
      const end = projection.project(corridor.points[corridor.points.length - 1]);
      return pointInPolygon({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, polygon);
    });
  }).length;
  const routeClearanceSatisfied = perimeterLoops.length === sitePolygons(site).length
    && perimeterLoops.every((route) => route.clearanceSatisfied)
    && (corridors.length === 0 || (
      manoeuvreRoutes.length === corridorComponentCount
      && manoeuvreRoutes.every((route) => route.clearanceSatisfied)
    ));
  return {
    enabled: true,
    presetId: configuration.presetId,
    machineWidthM: configuration.widthM,
    machineLengthM: configuration.lengthM,
    implementWidthM: configuration.implementWidthM,
    safetyClearanceM: configuration.safetyClearanceM,
    requiredCorridorWidthM: envelope.corridorWidthM,
    headlandDepthM: envelope.headlandDepthM,
    effectiveRowSpacingM: definition.rowSpacingM,
    reservedAreaM2: Math.round(Math.min(estimatedPlantableAreaM2(site), corridorAreaM2 + turningAreaM2 + perimeterAreaM2)),
    corridors,
    turningAreas,
    perimeterLoops,
    manoeuvreRoutes,
    clearanceSatisfied: definition.rowSpacingM + 1e-6 >= envelope.corridorWidthM && routeClearanceSatisfied,
    notes: [
      `${envelope.corridorWidthM.toFixed(2)} m operating corridors include machine, implement and lateral safety clearance.`,
      `${envelope.headlandDepthM.toFixed(2)} m headlands are reserved at row ends for turning.`,
      `${perimeterLoops.reduce((sum, route) => sum + route.lengthM, 0).toFixed(1)} m of continuous perimeter driving loop is reserved inside the parcel boundary.`,
      `${manoeuvreRoutes.reduce((sum, route) => sum + route.lengthM, 0).toFixed(1)} m of connected manoeuvre route links the row passes to the perimeter loop.`,
      ...(routeClearanceSatisfied ? [] : ['At least one route segment cannot guarantee the selected operating clearance because of parcel geometry or a mapped obstacle; field review is required.']),
    ],
  };
}

function buildPerimeterRoute(
  site: SiteBoundary,
  polygon: Coordinate[],
  polygonIndex: number,
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
): MachineryRoute | null {
  if (polygon.length < 3 || widthM <= 0) return null;
  const localPolygon = polygon.map(projection.project);
  const halfWidthM = widthM / 2;
  const offsets = [halfWidthM + 0.2, widthM, widthM * 1.5];
  let selected: Coordinate[] | null = null;
  let clearanceSatisfied = false;

  for (const offsetM of offsets) {
    const inset = insetPolygon(localPolygon, offsetM);
    if (!inset.length) continue;
    const points = [...inset, inset[0]].map(projection.unproject);
    const clear = machineryRouteClearanceSatisfied(site, points, widthM, obstaclePolygons, projection);
    if (!selected || clear) selected = points;
    if (clear) {
      clearanceSatisfied = true;
      break;
    }
  }
  if (!selected) return null;
  return {
    id: `machine-perimeter-${polygonIndex}`,
    points: selected,
    widthM,
    lengthM: roundTo(polylineLengthM(selected), 1),
    closed: true,
    connectedCorridorIds: [],
    clearanceSatisfied,
  };
}

function buildManoeuvreRoute(
  site: SiteBoundary,
  loop: MachineryRoute,
  corridors: MachineryPlan['corridors'],
  polygonIndex: number,
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
  bearingDegrees: number,
): MachineryRoute | null {
  if (!corridors.length) return null;
  const ordered = [...corridors];
  const passPoints: Coordinate[] = [];
  for (const [index, corridor] of ordered.entries()) {
    const localStart = rotate(projection.project(corridor.points[0]), -bearingDegrees);
    const localEnd = rotate(projection.project(corridor.points[corridor.points.length - 1]), -bearingDegrees);
    const leftToRight = localStart.x <= localEnd.x
      ? [corridor.points[0], corridor.points[corridor.points.length - 1]]
      : [corridor.points[corridor.points.length - 1], corridor.points[0]];
    const directed = index % 2 === 0 ? leftToRight : [leftToRight[1], leftToRight[0]];
    if (!passPoints.length || haversineM(passPoints[passPoints.length - 1], directed[0]) > 0.05) passPoints.push(directed[0]);
    passPoints.push(directed[1]);
  }
  const firstConnection = nearestPointOnRoute(loop.points, passPoints[0], projection);
  const lastConnection = nearestPointOnRoute(loop.points, passPoints[passPoints.length - 1], projection);
  const routed = routeMachineryPolyline(
    [firstConnection, ...passPoints, lastConnection],
    site,
    widthM,
    obstaclePolygons,
    projection,
  );
  const points = routed.points;
  return {
    id: `machine-manoeuvre-${polygonIndex}`,
    points,
    widthM,
    lengthM: roundTo(polylineLengthM(points), 1),
    closed: false,
    connectedCorridorIds: ordered.map((corridor) => corridor.id),
    clearanceSatisfied: routed.clear && machineryRouteClearanceSatisfied(site, points, widthM, obstaclePolygons, projection),
  };
}

function routeMachineryPolyline(
  requestedPoints: Coordinate[],
  site: SiteBoundary,
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
) {
  const points: Coordinate[] = [requestedPoints[0]];
  let clear = true;
  for (let index = 1; index < requestedPoints.length; index += 1) {
    const segment = shortestMachineryRoute(
      requestedPoints[index - 1],
      requestedPoints[index],
      site,
      widthM,
      obstaclePolygons,
      projection,
    );
    if (!segment) {
      clear = false;
      points.push(requestedPoints[index]);
    } else {
      points.push(...segment.slice(1));
    }
  }
  return { points, clear };
}

function shortestMachineryRoute(
  start: Coordinate,
  end: Coordinate,
  site: SiteBoundary,
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
): Coordinate[] | null {
  const startM = projection.project(start);
  const endM = projection.project(end);
  if (machinerySegmentIsClear(startM, endM, site, widthM, obstaclePolygons, projection)) return [start, end];
  const halfWidthM = widthM / 2;
  const nodes: PointM[] = [startM, endM];
  for (const polygon of obstaclePolygons) {
    const centre = polygon.reduce((result, point) => ({
      x: result.x + point.x / polygon.length,
      y: result.y + point.y / polygon.length,
    }), { x: 0, y: 0 });
    for (const point of polygon) {
      const dx = point.x - centre.x;
      const dy = point.y - centre.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const expansionM = (halfWidthM + 0.6) * 2.5;
      const expanded = {
        x: point.x + dx / distance * expansionM,
        y: point.y + dy / distance * expansionM,
      };
      const coordinate = projection.unproject(expanded);
      if (
        siteContainsCoordinate(site, coordinate)
        && distanceToSiteBoundaryM(site, coordinate) + 0.25 >= halfWidthM
        && obstaclePolygons.every((obstacle) => !pointInPolygon(expanded, obstacle) && distanceToPolygonEdge(expanded, obstacle) + 0.25 >= halfWidthM)
      ) nodes.push(expanded);
    }
  }

  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  distances[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited.has(index) && (current === -1 || distances[index] < distances[current])) current = index;
    }
    if (current === -1 || !Number.isFinite(distances[current]) || current === 1) break;
    visited.add(current);
    for (let neighbour = 0; neighbour < nodes.length; neighbour += 1) {
      if (
        neighbour === current
        || visited.has(neighbour)
        || !machinerySegmentIsClear(nodes[current], nodes[neighbour], site, widthM, obstaclePolygons, projection)
      ) continue;
      const candidate = distances[current] + Math.hypot(nodes[current].x - nodes[neighbour].x, nodes[current].y - nodes[neighbour].y);
      if (candidate < distances[neighbour]) {
        distances[neighbour] = candidate;
        previous[neighbour] = current;
      }
    }
  }
  if (!Number.isFinite(distances[1])) return null;
  const route: PointM[] = [];
  for (let cursor = 1; cursor !== -1; cursor = previous[cursor]) route.push(nodes[cursor]);
  return route.reverse().map(projection.unproject);
}

function machinerySegmentIsClear(
  start: PointM,
  end: PointM,
  site: SiteBoundary,
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
) {
  const halfWidthM = widthM / 2;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(length / Math.max(0.5, widthM / 4)));
  for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
    const ratio = sampleIndex / samples;
    const local = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    };
    const coordinate = projection.unproject(local);
    if (!siteContainsCoordinate(site, coordinate) || distanceToSiteBoundaryM(site, coordinate) + 0.25 < halfWidthM) return false;
    if (obstaclePolygons.some((polygon) => pointInPolygon(local, polygon) || distanceToPolygonEdge(local, polygon) + 0.25 < halfWidthM)) return false;
  }
  return true;
}

function insetPolygon(polygon: PointM[], offsetM: number): PointM[] {
  const orientation = polygonSignedArea(polygon) >= 0 ? 1 : -1;
  const edges = polygon.map((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const normal = orientation > 0
      ? { x: -dy / length, y: dx / length }
      : { x: dy / length, y: -dx / length };
    return {
      start: { x: start.x + normal.x * offsetM, y: start.y + normal.y * offsetM },
      end: { x: end.x + normal.x * offsetM, y: end.y + normal.y * offsetM },
      normal,
    };
  });
  const centre = polygon.reduce((result, point) => ({
    x: result.x + point.x / polygon.length,
    y: result.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
  return polygon.map((vertex, index) => {
    const previous = edges[(index - 1 + edges.length) % edges.length];
    const current = edges[index];
    const intersection = lineIntersection(previous.start, previous.end, current.start, current.end);
    const averageNormal = {
      x: previous.normal.x + current.normal.x,
      y: previous.normal.y + current.normal.y,
    };
    const averageLength = Math.max(0.001, Math.hypot(averageNormal.x, averageNormal.y));
    const candidates = [
      intersection,
      { x: vertex.x + averageNormal.x / averageLength * offsetM, y: vertex.y + averageNormal.y / averageLength * offsetM },
      ...[1, 1.5, 2, 3].map((factor) => {
        const dx = centre.x - vertex.x;
        const dy = centre.y - vertex.y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        return { x: vertex.x + dx / distance * offsetM * factor, y: vertex.y + dy / distance * offsetM * factor };
      }),
    ].filter((point): point is PointM => point !== null);
    return candidates.find((point) => (
      pointInPolygon(point, polygon)
      && distanceToPolygonEdge(point, polygon) >= offsetM * 0.82
      && Math.hypot(point.x - vertex.x, point.y - vertex.y) <= offsetM * 5
    )) ?? candidates[candidates.length - 1];
  });
}

function machineryRouteClearanceSatisfied(
  site: SiteBoundary,
  points: Coordinate[],
  widthM: number,
  obstaclePolygons: PointM[][],
  projection: ReturnType<typeof createLocalProjection>,
) {
  const halfWidthM = widthM / 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = projection.project(points[index]);
    const end = projection.project(points[index + 1]);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const samples = Math.max(1, Math.ceil(length / Math.max(0.75, widthM / 3)));
    for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
      const ratio = sampleIndex / samples;
      const local = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      const coordinate = projection.unproject(local);
      if (!siteContainsCoordinate(site, coordinate) || distanceToSiteBoundaryM(site, coordinate) + 0.25 < halfWidthM) return false;
      if (obstaclePolygons.some((polygon) => pointInPolygon(local, polygon) || distanceToPolygonEdge(local, polygon) + 0.25 < halfWidthM)) return false;
      if (site.existingTrees.some((tree) => haversineM(coordinate, tree.coordinate) + 0.25 < halfWidthM + tree.crownDiameterM / 2 + tree.protectionBufferM)) return false;
    }
  }
  return true;
}

function nearestPointOnRoute(
  route: Coordinate[],
  target: Coordinate,
  projection: ReturnType<typeof createLocalProjection>,
) {
  const point = projection.project(target);
  let nearest = projection.project(route[0]);
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = projection.project(route[index]);
    const end = projection.project(route[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    const candidate = { x: start.x + dx * ratio, y: start.y + dy * ratio };
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return projection.unproject(nearest);
}

function lineIntersection(firstStart: PointM, firstEnd: PointM, secondStart: PointM, secondEnd: PointM): PointM | null {
  const firstDx = firstEnd.x - firstStart.x;
  const firstDy = firstEnd.y - firstStart.y;
  const secondDx = secondEnd.x - secondStart.x;
  const secondDy = secondEnd.y - secondStart.y;
  const denominator = firstDx * secondDy - firstDy * secondDx;
  if (Math.abs(denominator) < 1e-8) return null;
  const ratio = ((secondStart.x - firstStart.x) * secondDy - (secondStart.y - firstStart.y) * secondDx) / denominator;
  return { x: firstStart.x + firstDx * ratio, y: firstStart.y + firstDy * ratio };
}

function polygonSignedArea(points: PointM[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function polylineLengthM(points: Coordinate[]) {
  return points.slice(0, -1).reduce((sum, point, index) => sum + haversineM(point, points[index + 1]), 0);
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupTreesByRow(trees: TreeInstance[], projection: ReturnType<typeof createLocalProjection>, bearingDegrees: number) {
  const rows = new Map<number, PointM[]>();
  for (const tree of trees) {
    const local = rotate(projection.project(tree.coordinate), -bearingDegrees);
    rows.set(tree.rowIndex, [...(rows.get(tree.rowIndex) ?? []), local]);
  }
  return rows;
}

function rowMeanY(points: PointM[]) {
  return points.reduce((sum, point) => sum + point.y, 0) / points.length;
}

function averageCanopy(species: DesignSpecies[], year: number) {
  const states = species.map((item, index) => growthState(item, {
    id: `assessment-${item.id}`, speciesId: item.id, coordinate: { lat: 0, lng: 0 }, rowIndex: 0,
    positionIndex: index, plantedYear: 0, removedYear: null, locked: false, seed: index + 1,
  }, year));
  return {
    heightM: states.reduce((sum, item) => sum + item.heightM, 0) / Math.max(1, states.length),
    crownDiameterM: states.reduce((sum, item) => sum + item.crownDiameterM, 0) / Math.max(1, states.length),
  };
}

function uniqueBearings(candidates: number[]) {
  const values: number[] = [];
  for (const candidate of [...candidates, 0, 45, 90, 135]) {
    const normalized = normalizeDirection(candidate);
    if (values.every((value) => axisDifference(value, normalized) >= 10)) values.push(normalized);
  }
  return values;
}

function systemLabel(system: DesignConfiguration['system']) {
  return {
    syntropic: 'Syntropic succession',
    'alley-cropping': 'Alley cropping',
    'mixed-orchard': 'Mixed orchard',
    monoculture: 'Monoculture orchard',
    windbreak: 'Field windbreak',
    'boundary-buffer': 'Boundary buffer',
  }[system];
}

function variantDescription(design: DesignConfiguration, bearing: number, profile: SiteProfile) {
  const extent = design.extent === 'full-field' ? 'the full plantable field'
    : design.extent === 'perimeter-band' ? `an inward ${design.perimeterBandM} m perimeter band with an open crop interior`
      : 'the boundary edges best aligned with the design objective';
  const wind = profile.solar?.prevailingWindDirectionLabel ? ` Historical wind is predominantly from ${profile.solar.prevailingWindDirectionLabel}.` : '';
  return `${systemLabel(design.system)} across ${extent}, evaluated at ${Math.round(bearing)}° for ${design.orientationObjective.replaceAll('-', ' ')}.${wind}`;
}

function estimateCropInteriorArea(site: SiteBoundary, plantableAreaM2: number, design: DesignConfiguration, definition: VariantDefinition) {
  if (design.extent === 'perimeter-band') {
    const perimeter = sitePolygons(site).reduce((sum, polygon) => sum + polygonPerimeterM(polygon), 0);
    const bandArea = Math.max(0, perimeter * design.perimeterBandM - Math.PI * design.perimeterBandM ** 2);
    return Math.round(Math.max(0, plantableAreaM2 - bandArea));
  }
  if (design.extent === 'selected-edges') {
    const perimeter = sitePolygons(site).reduce((sum, polygon) => sum + polygonPerimeterM(polygon), 0);
    return Math.round(Math.max(0, plantableAreaM2 - perimeter * 0.35 * design.perimeterBandM));
  }
  if (design.system === 'alley-cropping') return Math.round(plantableAreaM2 * Math.max(0, 1 - 2.5 / definition.rowSpacingM));
  return 0;
}

function distanceToCenter(midpoint: PointM, normal: PointM, center: PointM) {
  return Math.hypot(midpoint.x + normal.x - center.x, midpoint.y + normal.y - center.y);
}

function axisDifference(a: number, b: number) {
  const difference = Math.abs(normalizeDirection(a) - normalizeDirection(b));
  return Math.min(difference, 180 - difference);
}

function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function toDegrees(value: number) { return value * 180 / Math.PI; }

function normalizeDirection(value: number): number {
  return ((value % 180) + 180) % 180;
}
