import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites.js';
import { haversineM } from '../src/lib/geometry.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import { distanceToSiteBoundaryM, siteContainsCoordinate } from '../src/lib/siteGeometry.js';
import type {
  DesignSpecies,
  EconomicConfiguration,
  EstablishmentCost,
  IrrigationEstimate,
  LayoutVariant,
  SiteProfile,
  SiteValidation,
  SpeciesRecommendation,
} from '../src/types.js';

const baseUrl = (process.argv[2] ?? process.env.GROWUP_BASE_URL ?? '').replace(/\/$/, '');
if (!baseUrl) throw new Error('Pass the deployed Growup base URL as the first argument or GROWUP_BASE_URL.');

const site = { ...TEMPERATE_OPEN_FIELD_FIXTURE, name: 'Acceptance field near Ragusa Ibla' };
const health = await get<{ ok: boolean; database: string }>('/api/health');
assert(health.ok && health.database === 'ready', 'Cloud databases are not ready.');

const validation = await post<SiteValidation>('/api/site/validate', site);
assert(validation.valid && validation.plantableAreaM2 > 1_000, 'The selected field did not pass authoritative geometry validation.');

const profile = await post<SiteProfile>('/api/site/profile', site);
assert(profile.location.displayName.length > 3, 'Reverse geocoding did not identify the field.');
assert(profile.terrain.samples.length >= site.polygon.length, 'Terrain sampling did not cover the field.');
assert(profile.climate.monthly.length === 12, 'The climate baseline is incomplete.');
assert(profile.satellite.status === 'available', 'Sentinel field analysis is unavailable.');
assert(profile.satellite.existingVegetation.suitability !== 'reject', 'Existing woody cover rejects this acceptance field.');
assert(profile.satellite.evidence.length > 0, 'Sentinel evidence provenance is missing.');

const economics = await post<EconomicConfiguration>('/api/economics/profile', { siteProfile: profile });
assert(economics.baseCurrencyCode === 'USD' && economics.exchangeRateToLocal > 0, 'USD planning rates were not converted to the field currency.');

const recommendationResult = await post<{ recommendations: SpeciesRecommendation[]; palette: DesignSpecies[] }>('/api/recommendations', {
  siteProfile: profile,
  objectives: DEFAULT_DESIGN_CONFIGURATION.objectives,
});
const selectedSpeciesIds = recommendationResult.palette.map((item) => item.id);
assert(selectedSpeciesIds.length >= 3, 'The evidence-ranked palette is too small for a syntropic design.');
assert(recommendationResult.recommendations.every((item) => item.species.invasiveStatus !== 'blocked' || item.status === 'blocked'), 'A blocked invasive species passed the safety gate.');

const defaultLayoutResult = await post<{ variants: LayoutVariant[] }>('/api/layout/generate', {
  site,
  siteProfile: profile,
  selectedSpeciesIds,
  designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
});
assert(defaultLayoutResult.variants.every((item) => !item.machinery.enabled && item.machinery.corridors.length === 0), 'Machinery space was reserved without explicit activation.');

const layoutResult = await post<{ variants: LayoutVariant[] }>('/api/layout/generate', {
  site,
  siteProfile: profile,
  selectedSpeciesIds,
  designConfiguration: {
    ...DEFAULT_DESIGN_CONFIGURATION,
    machinery: { ...DEFAULT_DESIGN_CONFIGURATION.machinery, enabled: true },
  },
});
assert(layoutResult.variants.length === 3, 'The layout engine did not produce three reproducible alternatives.');
const variant = layoutResult.variants[0];
assert(variant.trees.length > 10, 'The preferred layout contains too few trees for this field.');
assert(variant.trees.every((tree) => siteContainsCoordinate(site, tree.coordinate)), 'A planned tree lies outside the authoritative field.');
assert(variant.trees.every((tree) => distanceToSiteBoundaryM(site, tree.coordinate) >= site.setbackM - 0.05), 'A planned tree violates the field setback.');
assert(variant.machinery.clearanceSatisfied && variant.machinery.corridors.length > 0, 'Machinery corridors were not reserved.');

const costResult = await post<{ irrigation: IrrigationEstimate; establishment: EstablishmentCost }>('/api/costs/calculate', {
  variant,
  site,
  siteProfile: profile,
  selectedSpeciesIds,
  designYear: 5,
  economicConfiguration: economics,
});
const irrigation = costResult.irrigation;
assert(irrigation.network.source.placement === 'highest-terrain-sample', 'The automatic water source is not the highest sampled point.');
const highestTerrainSample = [...profile.terrain.samples].sort((left, right) => right.elevationM - left.elevationM)[0];
assert(haversineM(irrigation.network.source.coordinate, highestTerrainSample) < 0.1, 'The water-source coordinate does not match the highest terrain sample.');
assert(Math.abs(irrigation.network.source.elevationM - highestTerrainSample.elevationM) < 0.011, 'The rounded water-source elevation does not match the highest terrain sample.');
assert(irrigation.network.lines.length > 0 && irrigation.network.totalPurchasePipeM >= irrigation.network.totalMeasuredPipeM, 'The irrigation line schedule or procurement allowance is invalid.');
assert(irrigation.network.components.some((item) => item.category === 'filter') && irrigation.emitterCount > 0, 'The irrigation bill of materials is incomplete.');
assert(irrigation.network.requiredFlowM3Hour > 0 && irrigation.network.requiredDynamicHeadM > 0, 'The hydraulic duty point was not calculated.');
assert(costResult.establishment.timeline.length >= 30, 'The economic timeline is shorter than 30 years.');
assert(costResult.establishment.timeline[29].annualOperatingCost < costResult.establishment.timeline[4].annualOperatingCost, 'Syntropic annual operating cost does not decline after establishment.');

const perimeterResult = await post<{ variants: LayoutVariant[] }>('/api/layout/generate', {
  site,
  siteProfile: profile,
  selectedSpeciesIds,
  designConfiguration: {
    ...DEFAULT_DESIGN_CONFIGURATION,
    system: 'boundary-buffer',
    extent: 'perimeter-band',
    perimeterBandM: 8,
  },
});
const perimeter = perimeterResult.variants[0];
assert(perimeter.trees.length > 0 && perimeter.metrics.cropInteriorAreaM2 > 500, 'Perimeter mode did not preserve a usable crop interior.');
assert(perimeter.trees.every((tree) => distanceToSiteBoundaryM(site, tree.coordinate) <= 8.05), 'Perimeter mode placed a tree beyond the requested band.');

console.log(JSON.stringify({
  baseUrl,
  field: { id: site.id, areaM2: validation.areaM2, plantableAreaM2: validation.plantableAreaM2, location: profile.location.displayName },
  evidence: {
    terrainSamples: profile.terrain.samples.length,
    climatePeriod: profile.climate.period,
    satelliteStatus: profile.satellite.status,
    protectedWoodyAreas: profile.satellite.existingVegetation.patches.length,
  },
  preferredDesign: {
    id: variant.id,
    engineVersion: variant.generation.engineVersion,
    trees: variant.trees.length,
    species: variant.metrics.speciesCount,
    machineryCorridors: variant.machinery.corridors.length,
  },
  irrigation: {
    sourcePlacement: irrigation.network.source.placement,
    sourceElevationM: irrigation.network.source.elevationM,
    measuredPipeM: irrigation.network.totalMeasuredPipeM,
    purchasePipeM: irrigation.network.totalPurchasePipeM,
    zones: irrigation.zones,
    flowM3Hour: irrigation.network.requiredFlowM3Hour,
    dynamicHeadM: irrigation.network.requiredDynamicHeadM,
    pumpRequired: irrigation.network.pumpRequired,
    annualWaterM3: irrigation.annualWaterM3,
  },
  economics: {
    currency: economics.currencyCode,
    establishment: costResult.establishment.totalCost,
    year5Opex: costResult.establishment.timeline[4].annualOperatingCost,
    year30Opex: costResult.establishment.timeline[29].annualOperatingCost,
  },
  perimeterDesign: { trees: perimeter.trees.length, cropInteriorAreaM2: perimeter.metrics.cropInteriorAreaM2 },
}, null, 2));

async function get<T>(path: string): Promise<T> {
  return response<T>(await fetch(`${baseUrl}${path}`));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return response<T>(await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function response<T>(result: Response): Promise<T> {
  const body = await result.json().catch(() => null);
  if (!result.ok) throw new Error(`${result.status} ${result.url}: ${body?.error?.status ?? 'HTTP_ERROR'} · ${body?.error?.message ?? 'No JSON error message'}`);
  return body as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
