import type { Coordinate, DesignConfiguration, DesignSpecies, LayoutVariant, MachineryPlan, SiteBoundary, SiteProfile, TreeInstance } from '../types';
import { DEFAULT_MACHINERY_CONFIGURATION, machineryEnvelope, normalizeMachineryConfiguration } from '../data/machinery';
import { growthState } from './growth';
import { compositionTargets, DEFAULT_DESIGN_OBJECTIVES, normalizeDesignObjectives, speciesObjectiveScore } from './objectives';
import { distanceToSiteBoundaryM, distanceToSitePathM, estimatedPlantableAreaM2, siteContainsCoordinate, sitePolygons } from './siteGeometry';
import { assessSolarOrientation, orientationScore } from './solar';
import {
  bounds,
  createLocalProjection,
  distanceToPolygonEdge,
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

export const LAYOUT_ENGINE_VERSION = 'growaf-layout-1.1.0';

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
  machinery: DEFAULT_MACHINERY_CONFIGURATION,
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
    machinery: normalizeMachineryConfiguration(value?.machinery),
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
  const candidates = design.extent === 'full-field'
    ? fullFieldCandidates(site, polygons, projection, exclusions, definition, design)
    : perimeterCandidates(site, polygons, projection, exclusions, definition, design);

  const speciesById = new Map(permitted.map((item) => [item.id, item]));
  const lockedPlacements: LockedPlacement[] = options.lockedTrees.map((tree) => ({ tree, point: projection.project(tree.coordinate), species: speciesById.get(tree.speciesId)! }));
  for (const locked of lockedPlacements) {
    if (!isPlantableCandidate(locked.tree.coordinate, locked.point, site, exclusions)) {
      throw new Error(`Locked tree ${locked.tree.id} violates a current site, exclusion, path or protected-tree constraint.`);
    }
  }
  const placedBySpecies = new Map<string, PointM[]>();
  for (const locked of lockedPlacements) placedBySpecies.set(locked.tree.speciesId, [...(placedBySpecies.get(locked.tree.speciesId) ?? []), locked.point]);
  const trees: TreeInstance[] = options.lockedTrees.map((tree) => ({ ...tree, coordinate: { ...tree.coordinate } }));
  let lockedCandidateSkips = 0;

  for (const candidate of candidates) {
    const missing = permitted.filter((item) => !placedBySpecies.has(item.id));
    const ordered = speciesOrder(missing.length ? missing : permitted, candidate.rowIndex, candidate.positionIndex, design);
    const selected = ordered.find((item) => canPlaceSpecies(item, candidate, placedBySpecies)) ?? ordered[0];
    if (!selected) continue;
    if (lockedPlacements.some((locked) => lockedTreeConflict(candidate, selected, locked, definition))) {
      lockedCandidateSkips += 1;
      continue;
    }
    const id = `${definition.id}-r${candidate.rowIndex}-p${candidate.positionIndex}-${selected.id}-${design.seed}`;
    const plantedYear = selected.succession === 'placenta' ? 0 : selected.succession === 'secondary' ? 1 : 2;
    const removedYear = selected.succession === 'placenta' && selected.roles.includes('biomass') ? 10 : null;

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

  const areaM2 = Math.max(1, estimatedPlantableAreaM2(site) - protectedVegetation.reduce((sum, exclusion) => sum + polygonAreaM2(exclusion), 0));
  const canopy10 = canopyCoverage(trees, permitted, 10, areaM2);
  const canopy20 = canopyCoverage(trees, permitted, 20, areaM2);
  const representedSpecies = new Set(trees.map((tree) => tree.speciesId));
  const representedStrata = new Set(permitted.filter((item) => representedSpecies.has(item.id)).map((item) => item.stratum));
  const warnings: string[] = [];

  if (design.system === 'syntropic' && representedStrata.size < 4) warnings.push('Fewer than four vertical strata could be represented in this geometry.');
  if (design.system === 'syntropic' && !permitted.some((item) => item.succession === 'placenta')) warnings.push('The palette has no placenta-phase support species.');
  if (design.system === 'syntropic' && !permitted.some((item) => item.succession === 'climax')) warnings.push('The palette has no long-lived climax species.');
  if (design.system === 'monoculture') warnings.push('Monoculture is a production baseline with lower planned diversity and resilience.');
  if (design.extent === 'perimeter-band') warnings.push(`Planting is restricted to an inward ${design.perimeterBandM} m boundary band; the central crop area remains unplanted.`);
  if (design.system === 'windbreak') warnings.push('Wind direction is based on reanalysis; confirm damaging seasonal winds and barrier porosity in the field.');
  if (canopy20 > 88) warnings.push('Year-20 projected crown cover is dense; scheduled pruning or thinning is required.');
  if (protectedVegetation.length) warnings.push(`${protectedVegetation.length} existing woody ${protectedVegetation.length === 1 ? 'patch is' : 'patches are'} protected from new planting.`);
  if (site.existingTrees.length) warnings.push(`${site.existingTrees.length} field-observed existing ${site.existingTrees.length === 1 ? 'tree is' : 'trees are'} protected from new planting.`);
  if (site.paths.length) warnings.push(`${site.paths.length} management ${site.paths.length === 1 ? 'path is' : 'paths are'} reserved before placement.`);
  const dimensions = averageCanopy(permitted, design.analysisYear);
  const solar = assessSolarOrientation(siteProfile, design, definition.directionDegrees, dimensions);
  const cropInteriorAreaM2 = estimateCropInteriorArea(site, areaM2, design, definition);
  const composition = layoutComposition(trees, permitted, design, siteProfile);
  const machinery = buildMachineryPlan(site, trees, projection, definition, design);

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
      assumptions: generationAssumptions(site, definition, design),
      conflicts,
    },
    machinery,
    composition,
    metrics: {
      totalTrees: trees.length,
      speciesCount: representedSpecies.size,
      treesPerHectare: Math.round(trees.length / (areaM2 / 10_000)),
      projectedCanopyYear10Percent: canopy10,
      projectedCanopyYear20Percent: canopy20,
      cropInteriorAreaM2,
    },
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
        if (!pointInPolygon(local, polygon) || distanceToPolygonEdge(local, polygon) < site.setbackM) continue;
        const coordinate = projection.unproject(local);
        if (!isPlantableCandidate(coordinate, local, site, exclusions)) continue;
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
        : Math.max(1, Math.floor((bandM - site.setbackM) / definition.rowSpacingM) + 1);
      for (let row = 0; row < rowCount; row += 1) {
        const offset = site.setbackM + definition.treeSpacingM * 0.45 + row * definition.rowSpacingM;
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
          if (!pointInPolygon(local, polygon) || !isPlantableCandidate(coordinate, local, site, exclusions)) continue;
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

function isPlantableCandidate(coordinate: Coordinate, local: PointM, site: SiteBoundary, exclusions: PointM[][]) {
  if (!siteContainsCoordinate(site, coordinate)) return false;
  if (distanceToSiteBoundaryM(site, coordinate) < site.setbackM) return false;
  if (exclusions.some((exclusion) => pointInPolygon(local, exclusion))) return false;
  if (site.paths.some((path) => distanceToSitePathM(coordinate, path) < path.widthM / 2)) return false;
  if (site.existingTrees.some((tree) => {
    const radiusM = tree.crownDiameterM / 2 + tree.protectionBufferM;
    const projection = createLocalProjection(tree.coordinate);
    const point = projection.project(coordinate);
    return Math.hypot(point.x, point.y) < radiusM;
  })) return false;
  return true;
}

function speciesOrder(species: DesignSpecies[], row: number, position: number, design: DesignConfiguration): DesignSpecies[] {
  const slot = (row * 7 + position) % 12;
  const target = slot === 0 ? 'emergent' : slot % 4 === 0 ? 'high' : slot % 2 === 0 ? 'medium' : slot % 3 === 0 ? 'low' : 'ground';
  return [...species].sort((a, b) => {
    const aTarget = a.stratum === target ? 0 : 1;
    const bTarget = b.stratum === target ? 0 : 1;
    const phaseOrder = { placenta: 0, secondary: 1, climax: 2 } as const;
    const objectiveDifference = speciesObjectiveScore(b, design.objectives) - speciesObjectiveScore(a, design.objectives);
    return aTarget - bTarget || objectiveDifference || ((phaseOrder[a.succession] + row + position) % 3) - ((phaseOrder[b.succession] + row + position) % 3) || a.id.localeCompare(b.id);
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
    bySuccession[item.succession] = (bySuccession[item.succession] ?? 0) + 1;
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
): LayoutVariant['generation']['assumptions'] {
  const polygons = sitePolygons(site).length;
  const extent = design.extent === 'full-field'
    ? 'full plantable field'
    : design.extent === 'perimeter-band'
      ? `${design.perimeterBandM.toFixed(1)} m inward perimeter band`
      : 'selected boundary edges';
  return [
    { label: 'Placement seed', value: String(design.seed) },
    { label: 'Boundary rule', value: `${polygons} planting ${polygons === 1 ? 'polygon' : 'polygons'}; ${site.setbackM.toFixed(1)} m setback` },
    { label: 'Grid geometry', value: `${definition.rowSpacingM.toFixed(1)} m rows × ${definition.treeSpacingM.toFixed(1)} m plants at ${Math.round(definition.directionDegrees)}°` },
    { label: 'Planting extent', value: extent },
    { label: 'Hard constraints', value: 'holes, exclusions, paths, observed trees and detected woody vegetation' },
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

function buildMachineryPlan(
  site: SiteBoundary,
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
  const corridorAreaM2 = corridors.reduce((sum, corridor) => {
    const start = projection.project(corridor.points[0]);
    const end = projection.project(corridor.points[1]);
    return sum + Math.hypot(end.x - start.x, end.y - start.y) * corridor.widthM;
  }, 0);
  const turningAreaM2 = turningAreas.length * Math.PI * envelope.turningAreaRadiusM ** 2;
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
    reservedAreaM2: Math.round(Math.min(estimatedPlantableAreaM2(site), corridorAreaM2 + turningAreaM2)),
    corridors,
    turningAreas,
    clearanceSatisfied: definition.rowSpacingM + 1e-6 >= envelope.corridorWidthM,
    notes: [
      `${envelope.corridorWidthM.toFixed(2)} m operating corridors include machine, implement and lateral safety clearance.`,
      `${envelope.headlandDepthM.toFixed(2)} m headlands are reserved at row ends for turning.`,
    ],
  };
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
