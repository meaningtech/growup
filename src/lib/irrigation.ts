import { COST_SOURCES, normalizeEconomicConfiguration, REFERENCE_IRRIGATION_RATES } from '../data/economicProfiles';
import type { Coordinate, DesignSpecies, EconomicConfiguration, IrrigationConfiguration, IrrigationEstimate, IrrigationLine, LayoutVariant, SiteBoundary, SiteProfile } from '../types';
import { growthState } from './growth';
import { createLocalProjection, haversineM, pointInPolygon, polygonCentroid, type PointM } from './geometry';
import { calculateSystemMaintenance } from './maintenance';
import { siteContainsCoordinate } from './siteGeometry';
import { supplementalIrrigationFactor, systemEconomicsProfile } from './systemEconomics';

export const IRRIGATION_MODEL_VERSION = 'growup-irrigation-1.0.0';

export const DEFAULT_IRRIGATION_CONFIGURATION: IrrigationConfiguration = {
  sourceType: 'network',
  sourcePointId: null,
  availableFlowM3Hour: 5,
  inletPressureBar: 2.5,
  wellLiftM: 0,
  tankCapacityM3: 10,
  emitterFlowLHour: 4,
  emittersPerPlant: 2,
  distributionEfficiencyPercent: 90,
  targetVelocityMS: 1,
  maxZoneRuntimeHours: 8,
  lineOverrides: {},
};

export function normalizeIrrigationConfiguration(value?: Partial<IrrigationConfiguration> | null): IrrigationConfiguration {
  const sourceTypes: IrrigationConfiguration['sourceType'][] = ['network', 'well', 'tank', 'reservoir'];
  return {
    sourceType: sourceTypes.includes(value?.sourceType as IrrigationConfiguration['sourceType']) ? value!.sourceType! : DEFAULT_IRRIGATION_CONFIGURATION.sourceType,
    sourcePointId: typeof value?.sourcePointId === 'string' && value.sourcePointId ? value.sourcePointId : null,
    availableFlowM3Hour: clamp(Number(value?.availableFlowM3Hour ?? 5), 0.1, 500),
    inletPressureBar: clamp(Number(value?.inletPressureBar ?? 2.5), 0, 20),
    wellLiftM: clamp(Number(value?.wellLiftM ?? 0), 0, 500),
    tankCapacityM3: clamp(Number(value?.tankCapacityM3 ?? 10), 0.5, 10_000),
    emitterFlowLHour: clamp(Number(value?.emitterFlowLHour ?? 4), 0.5, 32),
    emittersPerPlant: Math.round(clamp(Number(value?.emittersPerPlant ?? 2), 1, 12)),
    distributionEfficiencyPercent: clamp(Number(value?.distributionEfficiencyPercent ?? 90), 50, 98),
    targetVelocityMS: clamp(Number(value?.targetVelocityMS ?? 1), 0.35, 1.8),
    maxZoneRuntimeHours: clamp(Number(value?.maxZoneRuntimeHours ?? 8), 1, 24),
    lineOverrides: Object.fromEntries(Object.entries(value?.lineOverrides ?? {}).filter((entry): entry is [string, Coordinate[]] => {
      const points = entry[1];
      return Array.isArray(points) && points.length >= 2 && points.every((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180);
    }).map(([id, points]) => [id, points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))])),
  };
}

export function calculateIrrigation(
  variant: LayoutVariant,
  species: DesignSpecies[],
  boundary: SiteBoundary,
  site: SiteProfile,
  designYear = 5,
  requestedConfiguration: Partial<IrrigationConfiguration> | null = null,
  requestedEconomics: Partial<EconomicConfiguration> | null = null,
): IrrigationEstimate {
  const configuration = normalizeIrrigationConfiguration(requestedConfiguration);
  const economics = normalizeEconomicConfiguration(requestedEconomics, site.location.countryCode ?? '');
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const activeTrees = variant.trees.filter((tree) => {
    const item = speciesById.get(tree.speciesId);
    return item ? growthState(item, tree, designYear).active : false;
  });
  const systemProfile = systemEconomicsProfile(variant.design.system);
  const irrigatedTrees = activeTrees.filter((tree) => {
    const item = speciesById.get(tree.speciesId);
    return item ? supplementalIrrigationFactor(variant.design.system, item, designYear) >= 0.15 : false;
  });
  const activeVariant = { ...variant, trees: irrigatedTrees };
  const distributionEfficiency = configuration.distributionEfficiencyPercent / 100;
  const monthly = site.climate.monthly.map((month) => {
    let netM3 = 0;
    let potentialNetM3 = 0;
    for (const tree of activeTrees) {
      const item = speciesById.get(tree.speciesId);
      if (!item) continue;
      const state = growthState(item, tree, designYear);
      const stage = designYear <= 1 ? item.kcInitial : designYear < 8 ? item.kcMid : item.kcLate;
      const rootZoneAreaM2 = Math.PI * (state.crownDiameterM * 0.34) ** 2;
      const maximumLocalizedWettedAreaM2 = configuration.emittersPerPlant * 2.5;
      const wettedAreaM2 = Math.max(1.2, Math.min(rootZoneAreaM2, maximumLocalizedWettedAreaM2));
      const effectiveRainMm = Math.min(month.precipitationMm * 0.82, month.et0Mm * stage * 0.72);
      const deficitMm = Math.max(0, month.et0Mm * stage - effectiveRainMm);
      const potentialTreeM3 = millimetresToCubicMetres(deficitMm, wettedAreaM2);
      potentialNetM3 += potentialTreeM3;
      netM3 += potentialTreeM3 * supplementalIrrigationFactor(variant.design.system, item, designYear);
    }
    const grossM3 = netM3 / distributionEfficiency;
    const potentialGrossM3 = potentialNetM3 / distributionEfficiency;
    return {
      month: month.month,
      netM3: round(netM3),
      grossM3: round(grossM3),
      potentialGrossM3: round(potentialGrossM3),
      cost: 0,
    };
  });
  const annualNetM3 = monthly.reduce((sum, item) => sum + item.netM3, 0);
  const annualGrossM3 = monthly.reduce((sum, item) => sum + item.grossM3, 0);
  const potentialAnnualGrossM3 = monthly.reduce((sum, item) => sum + item.potentialGrossM3, 0);
  const effectiveWettedAreaM2 = activeTrees.reduce((sum, tree) => {
    const item = speciesById.get(tree.speciesId);
    if (!item) return sum;
    const state = growthState(item, tree, designYear);
    const rootZoneAreaM2 = Math.PI * (state.crownDiameterM * 0.34) ** 2;
    return sum + Math.max(1.2, Math.min(rootZoneAreaM2, configuration.emittersPerPlant * 2.5));
  }, 0);
  const annualNetMm = annualNetM3 * 1000 / Math.max(1, effectiveWettedAreaM2);
  const annualGrossMm = annualGrossM3 * 1000 / Math.max(1, effectiveWettedAreaM2);
  const peakMonth = Math.max(...monthly.map((item) => item.grossM3));
  const peakDayM3 = peakMonth / 30;
  const emitterCount = irrigatedTrees.length * configuration.emittersPerPlant;
  const network = designIrrigationNetwork(boundary, site, activeVariant, configuration, economics, emitterCount, peakDayM3);
  const zones = Math.max(1, new Set(network.lines.map((line) => line.zoneId).filter(Boolean)).size);
  const lateralPipeM = network.lines.filter((line) => line.kind === 'lateral').reduce((sum, line) => sum + line.lengthM, 0);
  const mainlinePipeM = network.lines.filter((line) => line.kind === 'mainline' || line.kind === 'submain').reduce((sum, line) => sum + line.lengthM, 0);
  const materialsCost = network.components.reduce((sum, component) => sum + component.totalCost, 0);
  const laborHours = network.totalMeasuredPipeM / 100 * REFERENCE_IRRIGATION_RATES.installationLaborHoursPer100M + zones * 0.5 + network.protectedCrossingCount * 0.35;
  const laborCost = laborHours * economics.laborCostPerHour;
  const installationTotal = materialsCost + laborCost;
  const pumpingKwh = network.pumpRequired ? pumpingEnergyKwh(annualGrossM3, network.requiredDynamicHeadM) : 0;
  const waterCost = annualGrossM3 * economics.waterCostPerM3;
  const energyCost = pumpingKwh * economics.electricityCostPerKwh;
  const maintenanceCost = installationTotal * REFERENCE_IRRIGATION_RATES.annualMaintenanceRate;
  const systemMaintenance = calculateSystemMaintenance(variant.design.system, designYear, site.areaM2, activeTrees.length, economics);
  const monthlyWithCosts = monthly.map((month) => {
    const monthlyPumpingKwh = network.pumpRequired ? pumpingEnergyKwh(month.grossM3, network.requiredDynamicHeadM) : 0;
    return { ...month, cost: round(month.grossM3 * economics.waterCostPerM3 + monthlyPumpingKwh * economics.electricityCostPerKwh) };
  });
  const waterSamples = site.satellite.optical.waterSamples;
  const sampleCounts = {
    high: waterSamples.filter((sample) => sample.irrigationPriority === 'high').length,
    medium: waterSamples.filter((sample) => sample.irrigationPriority === 'medium').length,
    low: waterSamples.filter((sample) => sample.irrigationPriority === 'low').length,
  };

  return {
    designYear,
    activePlantCount: activeTrees.length,
    irrigatedPlantCount: irrigatedTrees.length,
    inactivePlantCount: variant.trees.length - activeTrees.length,
    configuration,
    economics,
    network,
    climatePeriod: site.climate.period,
    annualNetMm: round(annualNetMm),
    annualGrossMm: round(annualGrossMm),
    annualWaterM3: round(annualGrossM3),
    potentialAnnualWaterM3: round(potentialAnnualGrossM3),
    waterModel: {
      system: variant.design.system,
      supplementalIrrigationPercent: round(annualGrossM3 / Math.max(0.01, potentialAnnualGrossM3) * 100),
      matureSupplementalTargetPercent: round(systemProfile.matureSupplementalFraction * 100),
      transitionYears: systemProfile.transitionYears,
      basis: systemProfile.basis,
    },
    peakDayM3: round(peakDayM3),
    zones,
    emitterCount,
    lateralPipeM: round(lateralPipeM),
    mainlinePipeM: round(mainlinePipeM),
    installation: {
      materialsCost: round(materialsCost),
      laborHours: round(laborHours),
      laborCost: round(laborCost),
      totalCost: round(installationTotal),
    },
    annualOperation: {
      waterCost: round(waterCost),
      pumpingKwh: round(pumpingKwh),
      energyCost: round(energyCost),
      maintenanceCost: round(maintenanceCost),
      managementLaborHours: systemMaintenance.totalHours,
      managementLaborCost: systemMaintenance.totalCost,
      totalCost: round(waterCost + energyCost + maintenanceCost + systemMaintenance.totalCost),
    },
    systemMaintenance,
    satelliteScheduling: {
      adjustmentPercent: site.satellite.irrigationScheduling.adjustmentPercent,
      recommendation: site.satellite.irrigationScheduling.recommendation,
      confidence: site.satellite.irrigationScheduling.confidence,
      sceneAt: site.satellite.optical.latest?.acquiredAt ?? site.satellite.radar.latest?.acquiredAt ?? null,
      highPrioritySamples: sampleCounts.high,
      mediumPrioritySamples: sampleCounts.medium,
      lowPrioritySamples: sampleCounts.low,
      annualVolumeAdjusted: false,
    },
    assumptions: [
      { label: 'Distribution efficiency', value: `${configuration.distributionEfficiencyPercent}%`, source: 'FAO-56 design assumption; editable', sourceUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
      { label: 'Irrigation water', value: `${economics.waterCostPerM3} ${economics.currencyCode}/m³`, source: economics.sourceSummary, sourceUrl: COST_SOURCES.exchangeRates.url },
      { label: 'Common labour', value: `${economics.laborCostPerHour} ${economics.currencyCode}/h`, source: economics.sourceSummary, sourceUrl: COST_SOURCES.exchangeRates.url },
      { label: 'Routine system maintenance', value: `${systemMaintenance.totalHours} person-hours at year ${designYear}`, source: `${systemMaintenance.modelVersion}; ${systemMaintenance.basis}; ${systemMaintenance.confidence} confidence`, sourceUrl: systemMaintenance.sources[0]?.url ?? 'https://www.fao.org/climate-smart-agriculture-sourcebook/' },
      { label: 'Irrigation materials', value: `USD reference × ${economics.irrigationReferenceMultiplier}`, source: economics.sourceSummary, sourceUrl: COST_SOURCES.agricultureReference.url },
      { label: 'Pump duty', value: `${network.requiredDynamicHeadM} m dynamic head at ${Math.round(REFERENCE_IRRIGATION_RATES.pumpEfficiency * 100)}% efficiency`, source: 'Hazen-Williams line loss, terrain elevation and emitter pressure calculation', sourceUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
      { label: 'Satellite scheduling', value: `${site.satellite.irrigationScheduling.adjustmentPercent}% next-pulse guidance; annual demand unchanged`, source: 'Sentinel-2 NDMI and same-orbit Sentinel-1 RTC anomaly', sourceUrl: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a' },
      { label: 'Planting-system autonomy', value: `${round(annualGrossM3 / Math.max(0.01, potentialAnnualGrossM3) * 100)}% of potential supplemental demand at year ${designYear}`, source: systemProfile.basis === 'measured-system-reference' ? 'Embrapa agroforestry reference: economic rows irrigated, adapted biomass rows not regularly irrigated' : 'Conservative Growup planning default; replace with field records', sourceUrl: systemProfile.basis === 'measured-system-reference' ? 'https://www.embrapa.br/web/meio-ambiente/vitrine/sistema-agroflorestal-para-o-uso-mais-eficiente-de-manejo-da-agua-de-irrigacao' : 'https://www.fao.org/climate-smart-agriculture-sourcebook/production-resources/module-b5-integrated-production-systems/b5-overview/en/?type=111' },
      { label: 'Localized wetted area', value: `maximum 2.5 m² per emitter; ${configuration.emittersPerPlant} emitters per irrigated plant`, source: 'Planning cap prevents canopy area being treated as fully wetted soil; calibrate from a field wetting-pattern test', sourceUrl: 'https://www.fao.org/4/x0490e/x0490e00.htm' },
    ],
    monthly: monthlyWithCosts.map(({ potentialGrossM3: _potentialGrossM3, ...month }) => month),
  };
}

export function millimetresToCubicMetres(depthMm: number, areaM2: number): number {
  return depthMm * areaM2 / 1000;
}

function designIrrigationNetwork(
  boundary: SiteBoundary,
  profile: SiteProfile,
  variant: LayoutVariant,
  configuration: IrrigationConfiguration,
  economics: EconomicConfiguration,
  emitterCount: number,
  peakDayM3: number,
): IrrigationEstimate['network'] {
  const warnings: string[] = [];
  const sourcePoint = boundary.waterPoints.find((point) => point.id === configuration.sourcePointId) ?? boundary.waterPoints[0] ?? null;
  const centroid = polygonCentroid(boundary.polygon);
  const highest = [...profile.terrain.samples].sort((a, b) => {
    const elevationDifference = b.elevationM - a.elevationM;
    if (elevationDifference !== 0) return elevationDifference;
    return haversineM(b, centroid) - haversineM(a, centroid);
  })[0];
  const sourceCoordinate = sourcePoint?.coordinate ?? (highest ? { lat: highest.lat, lng: highest.lng } : centroid);
  const sourceElevationM = sourcePoint ? elevationAt(sourcePoint.coordinate, profile) : highest ? highest.elevationM : elevationAt(sourceCoordinate, profile);
  const placement = sourcePoint ? 'user-water-point' as const : highest ? 'highest-terrain-sample' as const : 'field-centroid' as const;
  if (configuration.sourceType === 'well' && !sourcePoint) warnings.push('Well position is provisional at the highest sampled terrain point; hydrogeological survey and permitting are required before drilling.');
  if (configuration.sourceType === 'tank' && !sourcePoint) warnings.push('The tank is provisionally placed at the highest sampled terrain point for gravity assistance; confirm access, bearing capacity and surveyed elevation.');
  if (configuration.sourceType === 'reservoir' && !sourcePoint) warnings.push('Reservoir position requires a user-defined water point and geotechnical review.');

  const rows = groupedRows(variant).map(({ rowIndex, trees }) => {
    const endpoints = [trees[0].coordinate, trees[trees.length - 1].coordinate];
    const start = haversineM(sourceCoordinate, endpoints[0]) <= haversineM(sourceCoordinate, endpoints[1]) ? endpoints[0] : endpoints[1];
    const end = start === endpoints[0] ? endpoints[1] : endpoints[0];
    const flowM3Hour = trees.length * configuration.emittersPerPlant * configuration.emitterFlowLHour / 1000;
    return { rowIndex, trees, start, end, flowM3Hour };
  }).filter((row) => row.trees.length > 0);
  const zoneRows: typeof rows[] = [];
  for (const row of rows) {
    const active = zoneRows[zoneRows.length - 1];
    const activeFlow = active?.reduce((sum, item) => sum + item.flowM3Hour, 0) ?? 0;
    if (!active || activeFlow + row.flowM3Hour > configuration.availableFlowM3Hour) zoneRows.push([row]);
    else active.push(row);
    if (row.flowM3Hour > configuration.availableFlowM3Hour) warnings.push(`Row ${row.rowIndex + 1} alone requires ${round(row.flowM3Hour)} m³/h, above the configured source flow.`);
  }

  const generatedLines: IrrigationLine[] = [];
  zoneRows.forEach((zone, zoneIndex) => {
    const zoneId = `zone-${zoneIndex + 1}`;
    const zoneFlow = zone.reduce((sum, row) => sum + row.flowM3Hour, 0);
    const orderedStarts = nearestNeighbourPath(sourceCoordinate, zone.map((row) => row.start));
    if (orderedStarts.length) generatedLines.push(makeLine(`main-${zoneId}`, 'mainline', zoneId, [sourceCoordinate, orderedStarts[0]], zoneFlow, profile, configuration));
    if (orderedStarts.length > 1) generatedLines.push(makeLine(`submain-${zoneId}`, 'submain', zoneId, orderedStarts, zoneFlow, profile, configuration));
    for (const row of zone) generatedLines.push(makeLine(`lateral-row-${row.rowIndex}`, 'lateral', zoneId, [row.start, row.end], row.flowM3Hour, profile, configuration, 16));
  });

  const obstacles = irrigationObstaclePolygons(boundary, profile);
  let routedObstacleCount = 0;
  let manualOverrideCount = 0;
  const lines = generatedLines.map((line) => {
    const override = configuration.lineOverrides[line.id];
    if (override) manualOverrideCount += 1;
    const routed = routePolyline(override ?? line.points, obstacles, boundary);
    if (routed.routed) routedObstacleCount += 1;
    return makeLine(line.id, line.kind, line.zoneId, routed.points, line.designFlowM3Hour, profile, configuration, line.diameterMm, routed.clear ? 'clear' : 'blocked');
  });
  const unroutableLineIds = lines.filter((line) => line.routingStatus === 'blocked').map((line) => line.id);
  const routingValid = unroutableLineIds.length === 0;
  if (!routingValid) warnings.push('One or more irrigation lines could not be routed safely around protected obstacles. Edit the blocked lines before procurement.');
  const protectedCrossings = configurationCrossings(boundary, variant, lines);
  lines.push(...protectedCrossings);
  const zoneLosses = zoneRows.map((_, zoneIndex) => {
    const zoneLines = lines.filter((line) => line.zoneId === `zone-${zoneIndex + 1}` && line.kind !== 'protected-crossing');
    const trunks = zoneLines.filter((line) => line.kind === 'mainline' || line.kind === 'submain').reduce((sum, line) => sum + line.headLossM, 0);
    const lateral = Math.max(0, ...zoneLines.filter((line) => line.kind === 'lateral').map((line) => line.headLossM));
    return trunks + lateral;
  });
  const maximumOutletElevationM = Math.max(sourceElevationM, ...lines.filter((line) => line.kind === 'lateral').map((line) => Math.max(line.startElevationM, line.endElevationM)));
  const staticLiftM = Math.max(0, maximumOutletElevationM - sourceElevationM) + (configuration.sourceType === 'well' ? configuration.wellLiftM : 0);
  const requiredDynamicHeadM = round(10 + 5 + staticLiftM + Math.max(0, ...zoneLosses));
  const availablePressureHeadM = round(configuration.inletPressureBar * 10.197 + (configuration.sourceType === 'tank' ? Math.max(0, sourceElevationM - maximumOutletElevationM) : 0));
  const pumpRequired = configuration.sourceType === 'well' || requiredDynamicHeadM > availablePressureHeadM;
  const requiredFlowM3Hour = round(Math.max(0, ...zoneRows.map((zone) => zone.reduce((sum, row) => sum + row.flowM3Hour, 0))));
  const pumpPowerKw = pumpRequired ? round(9.81 * (requiredFlowM3Hour / 3600) * requiredDynamicHeadM / REFERENCE_IRRIGATION_RATES.pumpEfficiency) : 0;
  const peakZoneRuntimeHours = round(peakDayM3 / Math.max(0.1, requiredFlowM3Hour));
  if (peakZoneRuntimeHours > configuration.maxZoneRuntimeHours) warnings.push(`Peak-day runtime ${peakZoneRuntimeHours} h exceeds the configured ${configuration.maxZoneRuntimeHours} h operating window.`);
  const components = networkComponents(lines, emitterCount, zoneRows.length, pumpRequired, configuration, economics);
  const totalMeasuredPipeM = round(lines.reduce((sum, line) => sum + line.lengthM, 0));
  const totalPurchasePipeM = round(components.filter((component) => component.category === 'pipe' || component.category === 'protection').reduce((sum, component) => sum + (component.unit === 'm' ? component.purchaseQuantity : 0), 0));
  return {
    source: {
      type: configuration.sourceType,
      coordinate: sourceCoordinate,
      elevationM: round(sourceElevationM),
      placement,
      requiresHydrogeologicalSurvey: configuration.sourceType === 'well',
    },
    lines,
    components,
    requiredFlowM3Hour,
    availableFlowM3Hour: configuration.availableFlowM3Hour,
    requiredDynamicHeadM,
    availablePressureHeadM,
    pumpRequired,
    pumpPowerKw,
    peakZoneRuntimeHours,
    protectedCrossingCount: protectedCrossings.length,
    routedObstacleCount,
    routingValid,
    unroutableLineIds,
    manualOverrideCount,
    totalMeasuredPipeM,
    totalPurchasePipeM,
    warnings,
  };
}

function groupedRows(variant: LayoutVariant) {
  const rows = new Map<number, typeof variant.trees>();
  for (const tree of variant.trees) rows.set(tree.rowIndex, [...(rows.get(tree.rowIndex) ?? []), tree]);
  return [...rows.entries()].map(([rowIndex, trees]) => ({
    rowIndex,
    trees: [...trees].sort((a, b) => a.positionIndex - b.positionIndex),
  })).sort((a, b) => a.rowIndex - b.rowIndex);
}

function nearestNeighbourPath(origin: Coordinate, coordinates: Coordinate[]) {
  const remaining = [...coordinates];
  const ordered: Coordinate[] = [];
  let cursor = origin;
  while (remaining.length) {
    remaining.sort((a, b) => haversineM(cursor, a) - haversineM(cursor, b));
    cursor = remaining.shift()!;
    ordered.push(cursor);
  }
  return ordered;
}

function makeLine(
  id: string,
  kind: IrrigationLine['kind'],
  zoneId: string | null,
  points: Coordinate[],
  flowM3Hour: number,
  profile: SiteProfile,
  configuration: IrrigationConfiguration,
  minimumDiameterMm = 20,
  routingStatus: IrrigationLine['routingStatus'] = 'clear',
): IrrigationLine {
  const lengthM = polylineLength(points) * 1.05;
  const diameterMm = selectPipeDiameter(flowM3Hour, configuration.targetVelocityMS, minimumDiameterMm);
  const velocityMS = pipeVelocity(flowM3Hour, diameterMm);
  return {
    id,
    kind,
    routingStatus,
    zoneId,
    points,
    lengthM: round(lengthM),
    diameterMm,
    designFlowM3Hour: round(flowM3Hour),
    velocityMS: round(velocityMS),
    headLossM: round(hazenWilliamsHeadLoss(lengthM, flowM3Hour, diameterMm)),
    startElevationM: round(elevationAt(points[0], profile)),
    endElevationM: round(elevationAt(points[points.length - 1], profile)),
  };
}

function irrigationObstaclePolygons(boundary: SiteBoundary, profile: SiteProfile): Coordinate[][] {
  const polygons = [
    ...boundary.holes,
    ...boundary.exclusions,
    ...profile.satellite.existingVegetation.patches.map((patch) => patch.polygon),
  ].filter((polygon) => polygon.length >= 3);
  for (const tree of boundary.existingTrees) {
    const projection = createLocalProjection(tree.coordinate);
    const radiusM = tree.crownDiameterM / 2 + tree.protectionBufferM;
    polygons.push(Array.from({ length: 20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2;
      return projection.unproject({ x: Math.cos(angle) * radiusM, y: Math.sin(angle) * radiusM });
    }));
  }
  return polygons;
}

export function routePolyline(points: Coordinate[], obstaclePolygons: Coordinate[][], boundary: SiteBoundary): { points: Coordinate[]; routed: boolean; clear: boolean } {
  if (points.length < 2) return { points, routed: false, clear: false };
  const routedPoints: Coordinate[] = [points[0]];
  let routed = false;
  let clear = true;
  for (let index = 1; index < points.length; index += 1) {
    const segment = shortestVisibleRoute(points[index - 1], points[index], obstaclePolygons, boundary);
    if (!segment) {
      clear = false;
      routedPoints.push(points[index]);
      continue;
    }
    if (segment.length > 2) routed = true;
    routedPoints.push(...segment.slice(1));
  }
  return { points: routedPoints, routed, clear };
}

function shortestVisibleRoute(start: Coordinate, end: Coordinate, obstacleCoordinates: Coordinate[][], boundary: SiteBoundary): Coordinate[] | null {
  const projection = createLocalProjection(polygonCentroid(boundary.polygon));
  const startM = projection.project(start);
  const endM = projection.project(end);
  const corridor = {
    minX: Math.min(startM.x, endM.x) - 25,
    minY: Math.min(startM.y, endM.y) - 25,
    maxX: Math.max(startM.x, endM.x) + 25,
    maxY: Math.max(startM.y, endM.y) + 25,
  };
  const obstacles = obstacleCoordinates.map((polygon) => polygon.map(projection.project)).filter((polygon) => {
    const minX = Math.min(...polygon.map((point) => point.x));
    const maxX = Math.max(...polygon.map((point) => point.x));
    const minY = Math.min(...polygon.map((point) => point.y));
    const maxY = Math.max(...polygon.map((point) => point.y));
    return minX <= corridor.maxX && maxX >= corridor.minX && minY <= corridor.maxY && maxY >= corridor.minY;
  });
  if (segmentIsClear(startM, endM, obstacles, boundary, projection)) return [start, end];

  const nodes: PointM[] = [startM, endM];
  for (const polygon of obstacles) {
    const center = {
      x: average(polygon.map((point) => point.x)),
      y: average(polygon.map((point) => point.y)),
    };
    const step = Math.max(1, Math.ceil(polygon.length / 10));
    for (let index = 0; index < polygon.length; index += step) {
      const point = polygon[index];
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const expanded = { x: point.x + dx / distance * 1.2, y: point.y + dy / distance * 1.2 };
      if (siteContainsCoordinate(boundary, projection.unproject(expanded))) nodes.push(expanded);
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
      if (neighbour === current || visited.has(neighbour) || !segmentIsClear(nodes[current], nodes[neighbour], obstacles, boundary, projection)) continue;
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

function segmentIsClear(start: PointM, end: PointM, obstacles: PointM[][], boundary: SiteBoundary, projection: ReturnType<typeof createLocalProjection>) {
  for (const ratio of [0.2, 0.4, 0.6, 0.8]) {
    const sample = projection.unproject({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
    if (!siteContainsCoordinate(boundary, sample)) return false;
  }
  for (const polygon of obstacles) {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon) || pointInPolygon(midpoint, polygon)) return false;
    for (let index = 0; index < polygon.length; index += 1) {
      if (segmentIntersection(start, end, polygon[index], polygon[(index + 1) % polygon.length])) return false;
    }
  }
  return true;
}

function configurationCrossings(boundary: SiteBoundary, variant: LayoutVariant, lines: IrrigationLine[]): IrrigationLine[] {
  const corridors: Array<{ id: string; points: Coordinate[]; widthM: number }> = [];
  if (variant.design.machinery.protectPipeCrossings && variant.machinery.enabled) {
    corridors.push(...variant.machinery.corridors);
    for (const route of [...(variant.machinery.perimeterLoops ?? []), ...(variant.machinery.manoeuvreRoutes ?? [])]) {
      for (let index = 0; index < route.points.length - 1; index += 1) {
        corridors.push({ id: `${route.id}-${index}`, points: [route.points[index], route.points[index + 1]], widthM: route.widthM });
      }
    }
  }
  if (variant.firebreak?.enabled && variant.firebreak.protectPipeCrossings) corridors.push(...variant.firebreak.lines);
  if (!corridors.length) return [];
  const projection = createLocalProjection(polygonCentroid(boundary.polygon));
  const crossings: IrrigationLine[] = [];
  for (const line of lines) {
    if (line.kind === 'protected-crossing') continue;
    for (const corridor of corridors) {
      const crossing = segmentIntersection(
        projection.project(line.points[0]), projection.project(line.points[line.points.length - 1]),
        projection.project(corridor.points[0]), projection.project(corridor.points[corridor.points.length - 1]),
      );
      if (!crossing) continue;
      if (crossings.some((item) => item.id.startsWith(`sleeve-${line.id}-`) && haversineM(item.points[0], projection.unproject(crossing)) < 1)) continue;
      const half = Math.max(1.5, corridor.widthM / 2 + 0.5);
      const lineStart = projection.project(line.points[0]);
      const lineEnd = projection.project(line.points[line.points.length - 1]);
      const length = Math.max(0.01, Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y));
      const unit = { x: (lineEnd.x - lineStart.x) / length, y: (lineEnd.y - lineStart.y) / length };
      const points = [
        projection.unproject({ x: crossing.x - unit.x * half, y: crossing.y - unit.y * half }),
        projection.unproject({ x: crossing.x + unit.x * half, y: crossing.y + unit.y * half }),
      ];
      crossings.push({ ...line, id: `sleeve-${line.id}-${corridor.id}`, kind: 'protected-crossing', points, lengthM: round(half * 2), headLossM: 0 });
    }
  }
  return crossings;
}

function networkComponents(lines: IrrigationLine[], emitterCount: number, zones: number, pumpRequired: boolean, configuration: IrrigationConfiguration, economics: EconomicConfiguration): IrrigationEstimate['network']['components'] {
  const components: IrrigationEstimate['network']['components'] = [];
  const pipeGroups = new Map<string, { kind: IrrigationLine['kind']; diameterMm: number; measured: number }>();
  for (const line of lines) {
    const key = `${line.kind}-${line.diameterMm}`;
    const current = pipeGroups.get(key) ?? { kind: line.kind, diameterMm: line.diameterMm, measured: 0 };
    current.measured += line.lengthM;
    pipeGroups.set(key, current);
  }
  for (const [key, group] of pipeGroups) {
    const lateral = group.kind === 'lateral';
    const protection = group.kind === 'protected-crossing';
    const coilM = lateral ? 100 : 50;
    const purchase = Math.ceil(group.measured / coilM) * coilM;
    const referenceUnitCost = protection ? REFERENCE_IRRIGATION_RATES.mainlinePerM * 1.5 : lateral ? REFERENCE_IRRIGATION_RATES.pressureCompensatingLateralPerM : REFERENCE_IRRIGATION_RATES.mainlinePerM;
    const unitCost = referenceUnitCost * economics.irrigationReferenceMultiplier;
    components.push(component(`pipe-${key}`, protection ? 'protection' : 'pipe', protection ? 'Operational crossing sleeve' : `${group.kind} pipe`, `PE ${group.diameterMm} mm · ${coilM} m coils`, 'm', group.measured, purchase, unitCost));
  }
  components.push(
    component('emitters', 'emitter', 'Pressure-compensating emitters', `${configuration.emitterFlowLHour} L/h`, 'each', emitterCount, Math.ceil(emitterCount * 1.05), REFERENCE_IRRIGATION_RATES.pressureCompensatingEmitterEach * economics.irrigationReferenceMultiplier),
    component('lateral-connectors', 'fitting', 'Lateral take-off connectors', 'with grommet', 'each', groupedLineCount(lines, 'lateral'), groupedLineCount(lines, 'lateral') + 2, REFERENCE_IRRIGATION_RATES.fittingEach * economics.irrigationReferenceMultiplier),
    component('flush-valves', 'valve', 'Lateral flush/end valves', 'one per lateral', 'each', groupedLineCount(lines, 'lateral'), groupedLineCount(lines, 'lateral'), REFERENCE_IRRIGATION_RATES.endValveEach * economics.irrigationReferenceMultiplier),
    component('zone-valves', 'valve', 'Zone isolation valves', 'sized to submain', 'each', zones, zones, REFERENCE_IRRIGATION_RATES.zoneValveEach * economics.irrigationReferenceMultiplier),
    component('pressure-regulators', 'valve', 'Zone pressure regulators', '1 bar downstream', 'each', zones, zones, REFERENCE_IRRIGATION_RATES.zoneValveEach * economics.irrigationReferenceMultiplier),
    component('filter', 'filter', 'Main filtration unit', 'flow-rated disc filter', 'each', 1, 1, REFERENCE_IRRIGATION_RATES.filterEach * economics.irrigationReferenceMultiplier),
    component('air-release', 'valve', 'Air release valve', 'network high point', 'each', 1, 1, REFERENCE_IRRIGATION_RATES.airReleaseValveEach * economics.irrigationReferenceMultiplier),
    component('controller', 'control', 'Irrigation controller', `${zones} zones`, 'each', 1, 1, REFERENCE_IRRIGATION_RATES.controllerEach * economics.irrigationReferenceMultiplier),
  );
  if (pumpRequired) components.push(component('pump', 'pump', 'Duty pump allowance', 'verify curve against calculated duty point', 'each', 1, 1, REFERENCE_IRRIGATION_RATES.pumpAllowanceEach * economics.irrigationReferenceMultiplier));
  if (configuration.sourceType === 'tank') components.push(component('tank', 'storage', 'Header tank', `${configuration.tankCapacityM3} m³`, 'each', 1, 1, 0));
  if (configuration.sourceType === 'well') components.push(component('well-head', 'control', 'Well head and abstraction controls', 'quote after hydrogeological survey', 'each', 1, 1, 0));
  return components;
}

function component(id: string, category: IrrigationEstimate['network']['components'][number]['category'], label: string, specification: string, unit: 'm' | 'each', measuredQuantity: number, purchaseQuantity: number, unitCost: number) {
  return { id, category, label, specification, unit, measuredQuantity: round(measuredQuantity), purchaseQuantity: round(purchaseQuantity), unitCost, totalCost: round(purchaseQuantity * unitCost) };
}

function groupedLineCount(lines: IrrigationLine[], kind: IrrigationLine['kind']) { return lines.filter((line) => line.kind === kind).length; }
function polylineLength(points: Coordinate[]) { return points.slice(1).reduce((sum, point, index) => sum + haversineM(points[index], point), 0); }
function elevationAt(coordinate: Coordinate, profile: SiteProfile) { return [...profile.terrain.samples].sort((a, b) => haversineM(coordinate, a) - haversineM(coordinate, b))[0]?.elevationM ?? profile.terrain.elevationMeanM; }
function selectPipeDiameter(flowM3Hour: number, targetVelocityMS: number, minimumDiameterMm: number) {
  const requiredM = Math.sqrt(4 * (flowM3Hour / 3600) / (Math.PI * targetVelocityMS));
  return [16, 20, 25, 32, 40, 50, 63, 75, 90, 110].find((diameter) => diameter >= minimumDiameterMm && diameter / 1000 >= requiredM) ?? 110;
}
function pipeVelocity(flowM3Hour: number, diameterMm: number) { return (flowM3Hour / 3600) / (Math.PI * (diameterMm / 1000) ** 2 / 4); }
function hazenWilliamsHeadLoss(lengthM: number, flowM3Hour: number, diameterMm: number) { return 10.67 * lengthM * (flowM3Hour / 3600) ** 1.852 / (140 ** 1.852 * (diameterMm / 1000) ** 4.87); }
function segmentIntersection(a: PointM, b: PointM, c: PointM, d: PointM): PointM | null {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const determinantAB = a.x * b.y - a.y * b.x;
  const determinantCD = c.x * d.y - c.y * d.x;
  const point = {
    x: (determinantAB * (c.x - d.x) - (a.x - b.x) * determinantCD) / denominator,
    y: (determinantAB * (c.y - d.y) - (a.y - b.y) * determinantCD) / denominator,
  };
  const within = (value: number, first: number, second: number) => value >= Math.min(first, second) - 1e-6 && value <= Math.max(first, second) + 1e-6;
  return within(point.x, a.x, b.x) && within(point.y, a.y, b.y) && within(point.x, c.x, d.x) && within(point.y, c.y, d.y) ? point : null;
}

function pumpingEnergyKwh(waterM3: number, hydraulicHeadM: number): number {
  return waterM3 * 9.81 * hydraulicHeadM / (3_600 * REFERENCE_IRRIGATION_RATES.pumpEfficiency);
}

function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }

function round(value: number): number {
  return Number(value.toFixed(2));
}
