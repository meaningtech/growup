import { fromArrayBuffer, fromUrl } from 'geotiff';
import { bounds, createLocalProjection, haversineM, polygonAreaM2, polygonCentroid, polygonPerimeterM } from '../src/lib/geometry.js';
import { siteContainsCoordinate, sitePolygons } from '../src/lib/siteGeometry.js';
import { defaultFieldConditions } from '../src/lib/siteOverrides.js';
import type { Coordinate, DepthToBedrockSample, Evidence, GroundwaterProfile, LocationSearchResult, SatelliteProfile, SiteBoundary, SiteProfile, SoilDepthLayer, SoilPropertyEstimate, SoilPropertyEstimateKey, SolarClimateBin, SolarResourceProfile, WindClimatologyPeriod, WindDirectionSector } from '../src/types.js';
import { fetchSatelliteProfile, type SentinelProviderConfig, unavailableSatelliteProfile } from './sentinel.js';

const CLIMATE_START = '2021-01-01';
const CLIMATE_END = '2025-12-31';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const profileCache = new Map<string, { expiresAt: number; profile: SiteProfile }>();

export type SiteProviderConfig = SentinelProviderConfig & {
  fetchImpl?: typeof fetch;
  openMeteoArchiveUrl?: string;
  openMeteoForecastUrl?: string;
  soilGridsWcsUrl?: string;
  nominatimUrl?: string;
  overpassUrl?: string;
  googleElevationUrl?: string;
  googleGeocodingUrl?: string;
  googleMapsServerApiKey?: string;
  depthToBedrockUrl?: string;
  depthToBedrockSampler?: (coordinates: Coordinate[], sourceUrl: string) => Promise<DepthToBedrockSample[]>;
  groundwaterMapServerUrl?: string;
};

type ProviderResult<T> = { value: T | null; warning: string | null };

export async function searchLocations(query: string, config: SiteProviderConfig = {}): Promise<LocationSearchResult[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2 || cleanQuery.length > 200) throw new Error('Location search must contain 2–200 characters.');
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.nominatimUrl ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
  const url = new URL('/search', baseUrl);
  url.search = new URLSearchParams({ q: cleanQuery, format: 'jsonv2', addressdetails: '1', limit: '6' }).toString();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'Growup/0.1 site-planning application' } });
    if (!response.ok) throw new Error(`Nominatim search returned ${response.status}`);
    const payload = await response.json() as Array<{ place_id?: number; display_name?: string; lat?: string; lon?: string; boundingbox?: string[]; type?: string }>;
    const results = payload.flatMap((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !item.display_name) return [];
      const itemBounds = item.boundingbox?.map(Number);
      return [{
        id: String(item.place_id ?? `${lat}-${lng}`),
        displayName: item.display_name,
        coordinate: { lat, lng },
        boundingBox: itemBounds?.length === 4 && itemBounds.every(Number.isFinite) ? { south: itemBounds[0], north: itemBounds[1], west: itemBounds[2], east: itemBounds[3] } : null,
        type: item.type ?? 'place',
      }];
    });
    if (results.length) return results;
    throw new Error('Nominatim search returned no usable locations');
  } catch (error) {
    if (!googleMapsKey(config)) throw error;
    return searchGoogleLocations(cleanQuery, config);
  }
}

export async function buildSiteProfile(site: SiteBoundary, config: SiteProviderConfig = {}): Promise<SiteProfile> {
  validateBoundary(site);
  const polygons = sitePolygons(site);
  const cacheKey = JSON.stringify({ polygons: polygons.map((polygon) => polygon.map((point) => [round(point.lat, 6), round(point.lng, 6)])), holes: site.holes, exclusions: site.exclusions });
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const fetchImpl = config.fetchImpl ?? fetch;
  const centroid = weightedSiteCentroid(polygons);
  const sampleCoordinates = terrainSamplingPoints(site, centroid);
  const [location, elevations, climate, solar, soil, depthToBedrock, groundwater, landCover, satellite] = await Promise.all([
    safeProvider(() => reverseGeocodeLocation(centroid, { ...config, fetchImpl }), 'Reverse geocoding is unavailable.'),
    safeProvider(() => fetchElevations(sampleCoordinates, fetchImpl, config), 'Terrain elevation is unavailable.'),
    safeProvider(() => fetchClimate(centroid, fetchImpl, config), 'Historical climate is unavailable.'),
    safeProvider(() => fetchSolarWeather(centroid, fetchImpl, config), 'Historical hourly radiation and wind are unavailable.'),
    safeProvider(() => fetchSoil(polygons.flat(), fetchImpl, config), 'SoilGrids WCS is unavailable; obtain a field soil test.'),
    safeProvider(() => fetchDepthToBedrock(sampleCoordinates, config), 'Modelled depth to bedrock is unavailable; measure effective rooting depth in the field.'),
    safeProvider(() => fetchGroundwaterContext(centroid, fetchImpl, config), 'Global groundwater context is unavailable.'),
    safeProvider(() => fetchLandCover(centroid, fetchImpl, config), 'OSM land-cover context is unavailable.'),
    safeProvider(() => fetchSatelliteProfile(site, config), 'Sentinel-1/2 field-water context is unavailable.'),
  ]);
  const warnings = [location.warning, elevations.warning, climate.warning, solar.warning, soil.warning, depthToBedrock.warning, groundwater.warning, landCover.warning, satellite.warning].filter(
    (warning): warning is string => Boolean(warning),
  );

  if (!elevations.value) throw new Error('Site profiling requires terrain elevation data');
  if (!climate.value) throw new Error('Site profiling requires historical climate data');

  const generatedAt = (config.now?.() ?? new Date()).toISOString();
  const terrain = summarizeTerrain(elevations.value.samples, elevations.value.evidence, generatedAt);
  const satelliteProfile = satellite.value ?? unavailableSatelliteProfile(config.now?.() ?? new Date());
  if (satelliteProfile.existingVegetation.suitability === 'reject') {
    warnings.push(satelliteProfile.existingVegetation.conclusion);
  } else if (satelliteProfile.existingVegetation.status !== 'available') {
    warnings.push('Existing woody vegetation classification is incomplete; do not place plants until the parcel is field-verified.');
  }
  const profile: SiteProfile = {
    generatedAt,
    centroid,
    areaM2: round(polygons.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0) - site.holes.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0), 2),
    perimeterM: round([...polygons, ...site.holes].reduce((sum, polygon) => sum + polygonPerimeterM(polygon), 0), 2),
    location: location.value ?? {
      displayName: `${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)}`,
      municipality: null,
      province: null,
      region: null,
      countryCode: null,
      evidence: evidence('Nominatim', `${config.nominatimUrl ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org'}/reverse`, 'live', generatedAt, 'low'),
    },
    terrain,
    climate: climate.value,
    solar: solar.value ?? unavailableSolarProfile(generatedAt),
    soil: {
      ...(soil.value ?? unavailableSoil(config, generatedAt)),
      depthToBedrock: depthToBedrock.value ?? unavailableDepthToBedrock(config, generatedAt),
      satelliteScreening: satelliteSoilScreening(satelliteProfile),
    },
    fieldConditions: defaultFieldConditions(),
    overrides: [],
    landCover: landCover.value ?? {
      classification: 'Unknown',
      osmTags: {},
      evidence: evidence('OpenStreetMap Overpass', config.overpassUrl ?? process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter', 'live', generatedAt, 'low', 'mapped feature proximity'),
    },
    groundwater: groundwater.value ?? unavailableGroundwater(config, generatedAt),
    satellite: satelliteProfile,
    warnings,
  };

  profileCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, profile });
  return profile;
}

function validateBoundary(site: SiteBoundary) {
  const polygons = sitePolygons(site);
  if (polygons.some((polygon) => polygon.length < 3)) throw new Error('Every site polygon requires at least three vertices');
  for (const point of polygons.flat()) {
    if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) throw new Error('Invalid site latitude');
    if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) throw new Error('Invalid site longitude');
  }
  if (polygons.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0) < 100) throw new Error('Site polygons must cover at least 100 m²');
}

export async function reverseGeocodeLocation(centroid: Coordinate, config: SiteProviderConfig = {}) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = config.nominatimUrl ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
  const url = new URL('/reverse', baseUrl);
  url.search = new URLSearchParams({ format: 'jsonv2', lat: String(centroid.lat), lon: String(centroid.lng), zoom: '14', addressdetails: '1' }).toString();
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'Growup/0.1 site-planning application' } });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const data = await response.json() as { display_name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    if (!data.display_name && !Object.keys(address).length) throw new Error('Nominatim returned no usable reverse-geocoding result');
    return {
      displayName: data.display_name ?? `${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)}`,
      municipality: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
      province: address.province ?? address.county ?? null,
      region: address.state ?? address.region ?? null,
      countryCode: address.country_code?.toUpperCase() ?? null,
      evidence: evidence('Nominatim / OpenStreetMap', url.toString(), 'live', providerNow(config), 'high', 'reverse-geocoded centroid'),
    };
  } catch (error) {
    if (!googleMapsKey(config)) throw error;
    return reverseGeocodeGoogle(centroid, config);
  }
}

type GoogleGeocodingResult = {
  place_id?: string;
  formatted_address?: string;
  types?: string[];
  geometry?: {
    location?: { lat?: number; lng?: number };
    viewport?: { southwest?: { lat?: number; lng?: number }; northeast?: { lat?: number; lng?: number } };
  };
  address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
};

async function searchGoogleLocations(query: string, config: SiteProviderConfig): Promise<LocationSearchResult[]> {
  const url = googleGeocodingUrl(config);
  url.search = new URLSearchParams({ address: query, key: googleMapsKey(config) }).toString();
  const payload = await fetchGoogleGeocoding(url, config);
  return payload.slice(0, 6).flatMap((item) => {
    const lat = Number(item.geometry?.location?.lat);
    const lng = Number(item.geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !item.formatted_address) return [];
    const southwest = item.geometry?.viewport?.southwest;
    const northeast = item.geometry?.viewport?.northeast;
    const boundingBox = [southwest?.lat, northeast?.lat, southwest?.lng, northeast?.lng].every(Number.isFinite)
      ? { south: Number(southwest!.lat), north: Number(northeast!.lat), west: Number(southwest!.lng), east: Number(northeast!.lng) }
      : null;
    return [{ id: item.place_id ?? `${lat}-${lng}`, displayName: item.formatted_address, coordinate: { lat, lng }, boundingBox, type: item.types?.[0] ?? 'place' }];
  });
}

async function reverseGeocodeGoogle(centroid: Coordinate, config: SiteProviderConfig) {
  const url = googleGeocodingUrl(config);
  url.search = new URLSearchParams({ latlng: `${centroid.lat},${centroid.lng}`, key: googleMapsKey(config) }).toString();
  const [result] = await fetchGoogleGeocoding(url, config);
  if (!result) throw new Error('Google Geocoding returned no reverse-geocoding result');
  const components = result.address_components ?? [];
  return {
    displayName: result.formatted_address ?? `${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)}`,
    municipality: googleAddressPart(components, ['locality', 'postal_town', 'administrative_area_level_3']),
    province: googleAddressPart(components, ['administrative_area_level_2']),
    region: googleAddressPart(components, ['administrative_area_level_1']),
    countryCode: googleAddressPart(components, ['country'], true),
    evidence: evidence('Google Maps Geocoding API', `${url.origin}${url.pathname}`, 'live fallback', providerNow(config), 'high', 'reverse-geocoded field centroid'),
  };
}

async function fetchGoogleGeocoding(url: URL, config: SiteProviderConfig): Promise<GoogleGeocodingResult[]> {
  const response = await fetchWithTimeout(config.fetchImpl ?? fetch, url);
  if (!response.ok) throw new Error(`Google Geocoding returned ${response.status}`);
  const payload = await response.json() as { status?: string; error_message?: string; results?: GoogleGeocodingResult[] };
  if (payload.status !== 'OK' || !payload.results?.length) throw new Error(payload.error_message || `Google Geocoding returned ${payload.status ?? 'an invalid response'}`);
  return payload.results;
}

function googleAddressPart(components: GoogleGeocodingResult['address_components'], types: string[], short = false): string | null {
  const component = components?.find((item) => item.types?.some((type) => types.includes(type)));
  const value = short ? component?.short_name : component?.long_name;
  return value?.trim() || null;
}

function googleGeocodingUrl(config: SiteProviderConfig): URL {
  return new URL(config.googleGeocodingUrl ?? process.env.GOOGLE_GEOCODING_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json');
}

function googleMapsKey(config: SiteProviderConfig): string {
  return config.googleMapsServerApiKey ?? process.env.GOOGLE_MAPS_SERVER_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '';
}

function providerNow(config: SiteProviderConfig): string {
  return (config.now?.() ?? new Date()).toISOString();
}

async function fetchElevations(points: Coordinate[], fetchImpl: typeof fetch, config: SiteProviderConfig) {
  const googleKey = config.googleMapsServerApiKey ?? process.env.GOOGLE_MAPS_SERVER_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const baseUrl = config.googleElevationUrl ?? 'https://maps.googleapis.com/maps/api/elevation/json';
    const url = new URL(baseUrl);
    url.search = new URLSearchParams({
      locations: points.map((point) => `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`).join('|'),
      key: googleKey,
    }).toString();
    const response = await fetchWithTimeout(fetchImpl, url);
    if (response.ok) {
      const payload = await response.json() as { status?: string; results?: Array<{ elevation?: number; resolution?: number }> };
      const results = payload.results ?? [];
      if (payload.status === 'OK' && results.length === points.length && results.every((item) => Number.isFinite(item.elevation))) {
        const resolution = average(results.map((item) => Number(item.resolution ?? 0)).filter((value) => value > 0));
        return {
          samples: points.map((point, index) => ({ ...point, elevationM: Number(results[index].elevation) })),
          evidence: evidence('Google Maps Elevation API', baseUrl, 'live', providerNow(config), resolution <= 30 ? 'high' : 'medium', `${resolution ? `${round(resolution, 1)} m mean source resolution; ` : ''}${points.length} field-clipped terrain samples`),
        };
      }
    }
  }
  const baseUrl = config.openMeteoForecastUrl ?? process.env.OPEN_METEO_FORECAST_URL ?? 'https://api.open-meteo.com/v1/forecast';
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({
    latitude: points.map((point) => point.lat.toFixed(6)).join(','),
    longitude: points.map((point) => point.lng.toFixed(6)).join(','),
    current: 'temperature_2m',
    forecast_days: '1',
    timezone: 'auto',
  }).toString();
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response.ok) throw new Error(`Open-Meteo terrain request returned ${response.status}`);
  const payload = await response.json() as Array<{ elevation?: number }> | { elevation?: number };
  const records = Array.isArray(payload) ? payload : [payload];
  if (records.length !== points.length || records.some((record) => !Number.isFinite(record.elevation))) throw new Error('Open-Meteo returned incomplete elevation samples');
  return {
    samples: points.map((point, index) => ({ ...point, elevationM: Number(records[index].elevation) })),
    evidence: evidence('Open-Meteo elevation API', baseUrl, '90 m DEM', providerNow(config), 'medium', `${points.length} field-clipped terrain samples`),
  };
}

export async function fetchSolarWeather(centroid: Coordinate, fetchImpl: typeof fetch, config: SiteProviderConfig): Promise<SolarResourceProfile> {
  const baseUrl = config.openMeteoArchiveUrl ?? process.env.OPEN_METEO_ARCHIVE_URL ?? 'https://archive-api.open-meteo.com/v1/archive';
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({
    latitude: String(centroid.lat), longitude: String(centroid.lng), start_date: CLIMATE_START, end_date: CLIMATE_END,
    hourly: 'direct_normal_irradiance,diffuse_radiation,shortwave_radiation,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms', timezone: 'GMT',
  }).toString();
  const response = await fetchWithTimeout(fetchImpl, url, {}, 45_000);
  if (!response.ok) throw new Error(`Open-Meteo solar request returned ${response.status}`);
  const payload = await response.json() as {
    hourly?: {
      time?: string[];
      direct_normal_irradiance?: number[];
      diffuse_radiation?: number[];
      shortwave_radiation?: number[];
      wind_speed_10m?: number[];
      wind_direction_10m?: number[];
    };
  };
  const hourly = payload.hourly;
  const time = hourly?.time ?? [];
  const direct = hourly?.direct_normal_irradiance ?? [];
  const diffuse = hourly?.diffuse_radiation ?? [];
  const shortwave = hourly?.shortwave_radiation ?? [];
  const windSpeed = hourly?.wind_speed_10m ?? [];
  const windDirection = hourly?.wind_direction_10m ?? [];
  if (!time.length || [direct, diffuse, shortwave, windSpeed, windDirection].some((values) => values.length !== time.length)) {
    throw new Error('Open-Meteo hourly solar payload is incomplete');
  }
  const bins = new Map<string, SolarClimateBin & { windSin: number; windCos: number }>();
  let globalWh = 0;
  let directWh = 0;
  let windSin = 0;
  let windCos = 0;
  let windSpeedTotal = 0;
  let validWind = 0;
  const windSamples: Array<{ month: number; speedMs: number; directionDegrees: number }> = [];
  for (let index = 0; index < time.length; index += 1) {
    const month = Number(time[index].slice(5, 7));
    const hour = Number(time[index].slice(11, 13));
    if (!Number.isFinite(month) || !Number.isFinite(hour)) continue;
    const directionDegrees = modulo(Number(windDirection[index] ?? 0), 360);
    const directionRadians = toRadians(directionDegrees);
    const speed = Math.max(0, Number(windSpeed[index] ?? 0));
    if (!Number.isFinite(speed) || !Number.isFinite(directionDegrees)) continue;
    const key = `${month}-${hour}`;
    const bin = bins.get(key) ?? {
      month, hour, directNormalWm2: 0, diffuseWm2: 0, shortwaveWm2: 0, windSpeedMs: 0,
      windDirectionDegrees: 0, sampleCount: 0, windSin: 0, windCos: 0,
    };
    bin.directNormalWm2 += Math.max(0, Number(direct[index] ?? 0));
    bin.diffuseWm2 += Math.max(0, Number(diffuse[index] ?? 0));
    bin.shortwaveWm2 += Math.max(0, Number(shortwave[index] ?? 0));
    bin.windSpeedMs += speed;
    bin.windSin += Math.sin(directionRadians) * speed;
    bin.windCos += Math.cos(directionRadians) * speed;
    bin.sampleCount += 1;
    bins.set(key, bin);
    globalWh += Math.max(0, Number(shortwave[index] ?? 0));
    directWh += Math.max(0, Number(direct[index] ?? 0));
    if (speed > 0) {
      windSin += Math.sin(directionRadians) * speed;
      windCos += Math.cos(directionRadians) * speed;
      windSpeedTotal += speed;
      validWind += 1;
    }
    windSamples.push({ month, speedMs: speed, directionDegrees });
  }
  const hourlyClimatology = [...bins.values()].map((bin) => ({
    month: bin.month,
    hour: bin.hour,
    directNormalWm2: round(bin.directNormalWm2 / bin.sampleCount, 1),
    diffuseWm2: round(bin.diffuseWm2 / bin.sampleCount, 1),
    shortwaveWm2: round(bin.shortwaveWm2 / bin.sampleCount, 1),
    windSpeedMs: round(bin.windSpeedMs / bin.sampleCount, 2),
    windDirectionDegrees: round((toDegrees(Math.atan2(bin.windSin, bin.windCos)) + 360) % 360, 0),
    sampleCount: bin.sampleCount,
  })).sort((a, b) => a.month - b.month || a.hour - b.hour);
  const prevailingWindDirectionDegrees = validWind ? round((toDegrees(Math.atan2(windSin, windCos)) + 360) % 360, 0) : null;
  const windClimatology = summarizeWindClimatology(windSamples);
  const annualWind = windClimatology.find((item) => item.period === 'annual');
  return {
    status: 'available', period: '2021–2025',
    annualGlobalHorizontalKwhM2: round(globalWh / 1000 / 5, 0),
    annualDirectNormalKwhM2: round(directWh / 1000 / 5, 0),
    prevailingWindDirectionDegrees,
    prevailingWindDirectionLabel: prevailingWindDirectionDegrees === null ? null : compass(prevailingWindDirectionDegrees),
    meanWindSpeedMs: validWind ? round(windSpeedTotal / validWind, 2) : null,
    windSpeedP90Ms: annualWind?.speedP90Ms ?? null,
    calmWindFrequencyPercent: annualWind?.calmFrequencyPercent ?? null,
    windClimatology,
    hourlyClimatology,
    evidence: evidence(
      'Open-Meteo Historical Weather API',
      url.toString(),
      'ERA5-family reanalysis, 2021–2025 hourly aggregate',
      providerNow(config),
      'high',
      'hourly radiation and 10 m wind grid',
      { coverageStart: CLIMATE_START, coverageEnd: CLIMATE_END },
    ),
    limitations: ['Reanalysis does not resolve local obstacles, hedges or gust corridors; verify damaging winds on site.'],
  };
}

function unavailableSolarProfile(observedAt: string): SolarResourceProfile {
  return {
    status: 'unavailable', period: 'unavailable', annualGlobalHorizontalKwhM2: 0, annualDirectNormalKwhM2: 0,
    prevailingWindDirectionDegrees: null, prevailingWindDirectionLabel: null, meanWindSpeedMs: null,
    windSpeedP90Ms: null, calmWindFrequencyPercent: null, windClimatology: [], hourlyClimatology: [],
    evidence: evidence('Open-Meteo Historical Weather API', 'https://archive-api.open-meteo.com/v1/archive', 'unavailable', observedAt, 'low'),
    limitations: ['Historical hourly radiation and wind could not be retrieved.'],
  };
}

export function summarizeWindClimatology(
  samples: Array<{ month: number; speedMs: number; directionDegrees: number }>,
): WindClimatologyPeriod[] {
  const definitions: Array<{ period: WindClimatologyPeriod['period']; months: number[] }> = [
    { period: 'annual', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    { period: 'winter', months: [12, 1, 2] },
    { period: 'spring', months: [3, 4, 5] },
    { period: 'summer', months: [6, 7, 8] },
    { period: 'autumn', months: [9, 10, 11] },
  ];
  return definitions.map(({ period, months }) => summarizeWindPeriod(
    period,
    samples.filter((sample) => months.includes(sample.month)),
  ));
}

function summarizeWindPeriod(
  period: WindClimatologyPeriod['period'],
  samples: Array<{ speedMs: number; directionDegrees: number }>,
): WindClimatologyPeriod {
  const valid = samples.filter((sample) => (
    Number.isFinite(sample.speedMs)
    && sample.speedMs >= 0
    && Number.isFinite(sample.directionDegrees)
  ));
  const sectorLabels: WindDirectionSector['directionLabel'][] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const sectorBins = sectorLabels.map((directionLabel, index) => ({
    directionLabel,
    centerDegrees: index * 45,
    speedTotal: 0,
    sampleCount: 0,
  }));
  let speedTotal = 0;
  let windSin = 0;
  let windCos = 0;
  let calmCount = 0;
  for (const sample of valid) {
    const speedMs = Math.max(0, sample.speedMs);
    const directionDegrees = modulo(sample.directionDegrees, 360);
    speedTotal += speedMs;
    if (speedMs < 0.5) calmCount += 1;
    if (speedMs > 0) {
      const radians = toRadians(directionDegrees);
      windSin += Math.sin(radians) * speedMs;
      windCos += Math.cos(radians) * speedMs;
    }
    if (speedMs < 0.5) continue;
    const sector = sectorBins[Math.round(directionDegrees / 45) % 8];
    sector.speedTotal += speedMs;
    sector.sampleCount += 1;
  }
  const sampleCount = valid.length;
  const prevailingDirectionDegrees = sampleCount && Math.hypot(windSin, windCos) > 1e-9
    ? round(modulo(toDegrees(Math.atan2(windSin, windCos)), 360), 0)
    : null;
  const sortedSpeeds = valid.map((sample) => sample.speedMs).sort((a, b) => a - b);
  return {
    period,
    prevailingDirectionDegrees,
    prevailingDirectionLabel: prevailingDirectionDegrees === null ? null : compass(prevailingDirectionDegrees) as WindDirectionSector['directionLabel'],
    meanSpeedMs: sampleCount ? round(speedTotal / sampleCount, 2) : null,
    speedP90Ms: sampleCount ? round(percentile(sortedSpeeds, 0.9), 2) : null,
    calmFrequencyPercent: sampleCount ? round(calmCount / sampleCount * 100, 1) : null,
    sampleCount,
    sectors: sectorBins.map((sector) => ({
      directionLabel: sector.directionLabel,
      centerDegrees: sector.centerDegrees,
      frequencyPercent: sampleCount ? round(sector.sampleCount / sampleCount * 100, 1) : 0,
      meanSpeedMs: sector.sampleCount ? round(sector.speedTotal / sector.sampleCount, 2) : 0,
      sampleCount: sector.sampleCount,
    })),
  };
}

async function fetchClimate(centroid: Coordinate, fetchImpl: typeof fetch, config: SiteProviderConfig) {
  const baseUrl = config.openMeteoArchiveUrl ?? process.env.OPEN_METEO_ARCHIVE_URL ?? 'https://archive-api.open-meteo.com/v1/archive';
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({
    latitude: String(centroid.lat), longitude: String(centroid.lng), start_date: CLIMATE_START, end_date: CLIMATE_END,
    daily: 'temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration', timezone: 'auto',
  }).toString();
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response.ok) throw new Error(`Open-Meteo climate request returned ${response.status}`);
  const data = await response.json() as {
    daily?: { time?: string[]; temperature_2m_mean?: number[]; temperature_2m_min?: number[]; temperature_2m_max?: number[]; precipitation_sum?: number[]; et0_fao_evapotranspiration?: number[] };
  };
  const daily = data.daily;
  if (!daily?.time?.length || !daily.temperature_2m_mean || !daily.temperature_2m_min || !daily.temperature_2m_max || !daily.precipitation_sum || !daily.et0_fao_evapotranspiration) throw new Error('Open-Meteo climate payload is incomplete');
  const years = 5;
  const monthly = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, temperature: [] as number[], precipitation: 0, et0: 0 }));
  daily.time.forEach((date, index) => {
    const month = Number(date.slice(5, 7)) - 1;
    monthly[month].temperature.push(daily.temperature_2m_mean![index]);
    monthly[month].precipitation += daily.precipitation_sum![index];
    monthly[month].et0 += daily.et0_fao_evapotranspiration![index];
  });
  const annualPrecipitationMm = sum(daily.precipitation_sum) / years;
  const annualEt0Mm = sum(daily.et0_fao_evapotranspiration) / years;
  const now = providerNow(config);
  return {
    period: `${CLIMATE_START} to ${CLIMATE_END}`,
    meanTemperatureC: round(average(daily.temperature_2m_mean), 1),
    absoluteMinTemperatureC: round(Math.min(...daily.temperature_2m_min), 1),
    absoluteMaxTemperatureC: round(Math.max(...daily.temperature_2m_max), 1),
    annualPrecipitationMm: round(annualPrecipitationMm, 0),
    annualEt0Mm: round(annualEt0Mm, 0),
    aridityIndex: round(annualPrecipitationMm / annualEt0Mm, 2),
    monthly: monthly.map((item) => ({
      month: item.month,
      temperatureC: round(average(item.temperature), 1),
      precipitationMm: round(item.precipitation / years, 1),
      et0Mm: round(item.et0 / years, 1),
    })),
    evidence: evidence(
      'Open-Meteo Historical Weather API',
      url.toString(),
      'ERA5-family reanalysis, 2021–2025 aggregate',
      now,
      'high',
      'weather grid with 90 m elevation downscaling',
      { coverageStart: CLIMATE_START, coverageEnd: CLIMATE_END },
    ),
  };
}

type SoilCoverageDescriptor = {
  property: string;
  key: SoilPropertyEstimateKey;
  category: SoilPropertyEstimate['category'];
  depth: '0-5cm' | '0-30cm';
  unit: string;
  transform: (raw: number) => number;
  uncertainty: boolean;
};

const SOIL_COVERAGES: SoilCoverageDescriptor[] = [
  { property: 'phh2o', key: 'ph', category: 'chemical', depth: '0-5cm', unit: 'pH', transform: (raw) => raw / 10, uncertainty: true },
  { property: 'sand', key: 'sand', category: 'physical', depth: '0-5cm', unit: '%', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'silt', key: 'silt', category: 'physical', depth: '0-5cm', unit: '%', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'clay', key: 'clay', category: 'physical', depth: '0-5cm', unit: '%', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'soc', key: 'organic-carbon', category: 'chemical', depth: '0-5cm', unit: 'g/kg', transform: (raw) => raw / 10, uncertainty: true },
  { property: 'nitrogen', key: 'total-nitrogen', category: 'chemical', depth: '0-5cm', unit: 'g/kg', transform: (raw) => raw / 100, uncertainty: true },
  { property: 'cec', key: 'cation-exchange-capacity', category: 'chemical', depth: '0-5cm', unit: 'cmol(c)/kg', transform: (raw) => raw / 10, uncertainty: true },
  { property: 'bdod', key: 'bulk-density', category: 'physical', depth: '0-5cm', unit: 'kg/dm³', transform: (raw) => raw / 100, uncertainty: false },
  { property: 'cfvo', key: 'coarse-fragments', category: 'physical', depth: '0-5cm', unit: 'vol%', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'ocs', key: 'organic-carbon-stock', category: 'chemical', depth: '0-30cm', unit: 'kg/m²', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'wv0033', key: 'water-field-capacity', category: 'physical', depth: '0-5cm', unit: 'vol%', transform: (raw) => raw / 10, uncertainty: false },
  { property: 'wv1500', key: 'water-wilting-point', category: 'physical', depth: '0-5cm', unit: 'vol%', transform: (raw) => raw / 10, uncertainty: false },
];

const SOIL_PROFILE_DEPTHS = [
  { id: '0-5cm', top: 0, bottom: 5 },
  { id: '5-15cm', top: 5, bottom: 15 },
  { id: '15-30cm', top: 15, bottom: 30 },
  { id: '30-60cm', top: 30, bottom: 60 },
  { id: '60-100cm', top: 60, bottom: 100 },
  { id: '100-200cm', top: 100, bottom: 200 },
] as const;

const SOIL_PROFILE_PROPERTIES = [
  { property: 'phh2o', key: 'ph', transform: (raw: number) => raw / 10 },
  { property: 'soc', key: 'organic-carbon', transform: (raw: number) => raw / 10 },
  { property: 'clay', key: 'clay', transform: (raw: number) => raw / 10 },
  { property: 'cfvo', key: 'coarse-fragments', transform: (raw: number) => raw / 10 },
  { property: 'bdod', key: 'bulk-density', transform: (raw: number) => raw / 100 },
] as const;

export async function fetchSoil(polygon: Coordinate[], fetchImpl: typeof fetch, config: SiteProviderConfig = {}) {
  const baseUrl = config.soilGridsWcsUrl ?? process.env.SOILGRIDS_WCS_URL ?? 'https://maps.isric.org/mapserv';
  const origin = polygonCentroid(polygon);
  const projection = createLocalProjection(origin);
  const localBounds = bounds(polygon.map(projection.project));
  const padding = 160;
  const southwest = projection.unproject({ x: localBounds.minX - padding, y: localBounds.minY - padding });
  const northeast = projection.unproject({ x: localBounds.maxX + padding, y: localBounds.maxY + padding });
  const observedAt = providerNow(config);
  const primaryEvidence = evidence(
    'ISRIC SoilGrids WCS',
    baseUrl,
    'SoilGrids 2.0 modelled means and 90% prediction intervals',
    observedAt,
    'medium',
    '250 m; topsoil values are 0–5 cm unless labelled 0–30 cm',
    { publishedAt: '2021-06-14' },
  );
  const requests: Array<Promise<readonly [string, number | null]>> = SOIL_COVERAGES.flatMap((descriptor) => {
    const mean = soilCoverage(
      descriptor.property,
      `${descriptor.property}_${descriptor.depth}_mean`,
      baseUrl,
      southwest,
      northeast,
      fetchImpl,
      descriptor.transform,
    ).then(([, value]) => [`${descriptor.key}:mean`, value] as const);
    if (!descriptor.uncertainty) return [mean];
    return [
      mean,
      soilCoverage(descriptor.property, `${descriptor.property}_${descriptor.depth}_Q0.05`, baseUrl, southwest, northeast, fetchImpl, descriptor.transform)
        .then(([, value]) => [`${descriptor.key}:low`, value] as const),
      soilCoverage(descriptor.property, `${descriptor.property}_${descriptor.depth}_Q0.95`, baseUrl, southwest, northeast, fetchImpl, descriptor.transform)
        .then(([, value]) => [`${descriptor.key}:high`, value] as const),
    ];
  });
  for (const depth of SOIL_PROFILE_DEPTHS.slice(1)) {
    for (const descriptor of SOIL_PROFILE_PROPERTIES) {
      requests.push(soilCoverage(
        descriptor.property,
        `${descriptor.property}_${depth.id}_mean`,
        baseUrl,
        southwest,
        northeast,
        fetchImpl,
        descriptor.transform,
      ).then(([, value]) => [`profile:${depth.id}:${descriptor.key}`, value] as const));
    }
  }
  const values = Object.fromEntries(await Promise.all(requests)) as Record<string, number | null>;
  const value = (key: SoilPropertyEstimateKey) => values[`${key}:mean`] ?? null;
  const interval = (key: SoilPropertyEstimateKey) => {
    const low = values[`${key}:low`];
    const high = values[`${key}:high`];
    return low !== null && low !== undefined && high !== null && high !== undefined
      ? { low: nullableRound(Math.min(low, high), 2)!, high: nullableRound(Math.max(low, high), 2)! }
      : null;
  };
  const properties: SoilPropertyEstimate[] = SOIL_COVERAGES.map((descriptor) => ({
    key: descriptor.key,
    category: descriptor.category,
    value: nullableRound(value(descriptor.key), descriptor.unit === 'pH' || descriptor.unit === 'kg/dm³' ? 2 : 1),
    unit: descriptor.unit,
    depthTopCm: 0,
    depthBottomCm: descriptor.depth === '0-30cm' ? 30 : 5,
    predictionInterval90: descriptor.uncertainty ? interval(descriptor.key) : null,
    estimateType: 'modelled-mean',
    evidence: { ...primaryEvidence },
  }));
  const carbonNitrogenRatio = value('organic-carbon') !== null && value('total-nitrogen') !== null && value('total-nitrogen')! > 0
    ? round(value('organic-carbon')! / value('total-nitrogen')!, 1)
    : null;
  const availableWater = value('water-field-capacity') !== null && value('water-wilting-point') !== null
    ? round(Math.max(0, value('water-field-capacity')! - value('water-wilting-point')!), 1)
    : null;
  properties.push(
    derivedSoilProperty('carbon-nitrogen-ratio', 'chemical', carbonNitrogenRatio, 'ratio', primaryEvidence),
    derivedSoilProperty('plant-available-water', 'derived', availableWater, 'vol%', primaryEvidence),
  );
  const sand = value('sand');
  const silt = value('silt');
  const clay = value('clay');
  const textureClass = soilTexture(sand, silt, clay);
  const available = SOIL_COVERAGES.filter((descriptor) => value(descriptor.key) !== null).length;
  const coreAvailable = ['ph', 'sand', 'silt', 'clay', 'organic-carbon'].every((key) => value(key as SoilPropertyEstimateKey) !== null);
  primaryEvidence.confidence = coreAvailable && available >= 9 ? 'medium' : 'low';
  for (const property of properties) property.evidence.confidence = primaryEvidence.confidence;
  const verticalProfile: SoilDepthLayer[] = SOIL_PROFILE_DEPTHS.map((depth) => {
    const profileValue = (key: string) => depth.top === 0
      ? value(key as SoilPropertyEstimateKey)
      : values[`profile:${depth.id}:${key}`] ?? null;
    return {
      depthTopCm: depth.top,
      depthBottomCm: depth.bottom,
      ph: nullableRound(profileValue('ph'), 2),
      organicCarbonGKg: nullableRound(profileValue('organic-carbon'), 1),
      clayPercent: nullableRound(profileValue('clay'), 1),
      coarseFragmentsPercent: nullableRound(profileValue('coarse-fragments'), 1),
      bulkDensityKgDm3: nullableRound(profileValue('bulk-density'), 2),
      plantAvailableWaterPercent: depth.top === 0 ? availableWater : null,
      evidence: {
        ...primaryEvidence,
        resolution: `250 m; modelled ${depth.top}–${depth.bottom} cm layer`,
      },
    };
  });
  return {
    ph: nullableRound(value('ph'), 1),
    sandPercent: nullableRound(sand, 1),
    siltPercent: nullableRound(silt, 1),
    clayPercent: nullableRound(clay, 1),
    organicCarbonGKg: nullableRound(value('organic-carbon'), 1),
    textureClass,
    status: coreAvailable && available >= 9 ? 'available' as const : available > 0 ? 'partial' as const : 'unavailable' as const,
    evidence: primaryEvidence,
    properties,
    verticalProfile,
    reactionClass: soilReaction(value('ph')),
    carbonNitrogenRatio,
    limitations: [
      'Values are global model predictions, not laboratory measurements from this parcel.',
      'SoilGrids explains approximately 30–70% of observed variation depending on property and location.',
      'Total nitrogen is not plant-available nitrogen; phosphorus, potassium, micronutrients, salinity and contaminants are not estimated here.',
      'Use georeferenced laboratory samples before fertilisation, amendment or contamination decisions.',
    ],
  };
}

async function soilCoverage(
  property: string, coverageId: string, baseUrl: string, southwest: Coordinate, northeast: Coordinate,
  fetchImpl: typeof fetch, transform: (raw: number) => number,
): Promise<[string, number | null]> {
  try {
    const url = new URL(baseUrl);
    url.search = new URLSearchParams({
      map: `/map/${property}.map`, SERVICE: 'WCS', VERSION: '2.0.1', REQUEST: 'GetCoverage', COVERAGEID: coverageId,
      FORMAT: 'GEOTIFF_INT16',
    }).toString();
    url.searchParams.append('SUBSET', `Long(${southwest.lng},${northeast.lng})`);
    url.searchParams.append('SUBSET', `Lat(${southwest.lat},${northeast.lat})`);
    url.searchParams.set('SUBSETTINGCRS', 'http://www.opengis.net/def/crs/EPSG/0/4326');
    url.searchParams.set('OUTPUTCRS', 'http://www.opengis.net/def/crs/EPSG/0/4326');
    const response = await fetchWithTimeout(fetchImpl, url, {}, 35_000);
    if (!response.ok) return [property, null];
    const tiff = await fromArrayBuffer(await response.arrayBuffer());
    const image = await tiff.getImage();
    const noData = image.getGDALNoData();
    const raster = await image.readRasters();
    const values = Array.from(raster[0] as ArrayLike<number>).filter((value) => (
      Number.isFinite(value) && value >= 0 && (noData === null || value !== noData)
    ));
    return [property, values.length ? transform(average(values)) : null];
  } catch {
    return [property, null];
  }
}

export async function fetchDepthToBedrock(
  coordinates: Coordinate[],
  config: SiteProviderConfig = {},
): Promise<NonNullable<SiteProfile['soil']['depthToBedrock']>> {
  const sourceUrl = config.depthToBedrockUrl
    ?? process.env.DEPTH_TO_BEDROCK_URL
    ?? 'https://files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif';
  const selectedCoordinates = evenlySpacedCoordinates(coordinates, 16);
  const sampler = config.depthToBedrockSampler ?? sampleDepthToBedrock;
  const samples = await withProviderTimeout(sampler(selectedCoordinates, sourceUrl), 30_000);
  const depths = samples.map((sample) => sample.depthM).sort((a, b) => a - b);
  const observedAt = providerNow(config);
  return {
    status: samples.length ? 'available' : 'unavailable',
    modelledDepthM: depths.length ? round(median(depths), 2) : null,
    minimumDepthM: depths.length ? round(depths[0], 2) : null,
    maximumDepthM: depths.length ? round(depths[depths.length - 1], 2) : null,
    samples,
    evidence: evidence(
      'ISRIC / Shangguan et al. global depth-to-bedrock model',
      sourceUrl,
      'Global depth to bedrock, March 2017',
      observedAt,
      'low',
      '250 m model grid; field-clipped cell samples',
      { publishedAt: '2017-03-10' },
    ),
    limitations: [
      'This is modelled depth to bedrock, not measured effective rooting depth.',
      'A 250 m cell can miss shallow rock, fill, hardpans and local excavation conditions inside the parcel.',
      'Confirm with soil pits, augering or geotechnical investigation before planting or earthworks.',
    ],
  };
}

async function sampleDepthToBedrock(
  coordinates: Coordinate[],
  sourceUrl: string,
): Promise<DepthToBedrockSample[]> {
  const tiff = await fromUrl(sourceUrl);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const cellWidth = (east - west) / width;
  const cellHeight = (north - south) / height;
  const noData = image.getGDALNoData();
  const cells = new Map<string, { coordinate: Coordinate; x: number; y: number }>();
  for (const coordinate of coordinates) {
    const x = Math.floor((coordinate.lng - west) / cellWidth);
    const y = Math.floor((north - coordinate.lat) / cellHeight);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    cells.set(`${x}:${y}`, { coordinate, x, y });
  }
  const samples: DepthToBedrockSample[] = [];
  for (const { coordinate, x, y } of cells.values()) {
    const raster = await image.readRasters({ window: [x, y, x + 1, y + 1] });
    const raw = Number((raster[0] as ArrayLike<number>)[0]);
    if (!Number.isFinite(raw) || raw < 0 || (noData !== null && raw === noData)) continue;
    samples.push({
      coordinate,
      depthM: round(raw / 100, 2),
      cellBounds: {
        west: west + x * cellWidth,
        east: west + (x + 1) * cellWidth,
        north: north - y * cellHeight,
        south: north - (y + 1) * cellHeight,
      },
    });
  }
  return samples;
}

function evenlySpacedCoordinates(coordinates: Coordinate[], maximum: number): Coordinate[] {
  if (coordinates.length <= maximum) return coordinates;
  return Array.from({ length: maximum }, (_, index) => (
    coordinates[Math.round(index * (coordinates.length - 1) / (maximum - 1))]
  ));
}

export async function fetchGroundwaterContext(
  centroid: Coordinate,
  fetchImpl: typeof fetch,
  config: SiteProviderConfig = {},
): Promise<GroundwaterProfile> {
  const serviceUrl = (
    config.groundwaterMapServerUrl
    ?? process.env.GROUNDWATER_MAP_SERVER_URL
    ?? 'https://services.bgr.de/arcgis/rest/services/grundwasser/whymap_gwr/MapServer'
  ).replace(/\/$/, '');
  const layerId = 11;
  const url = new URL(`${serviceUrl}/${layerId}/query`);
  url.search = new URLSearchParams({
    geometry: `${centroid.lng},${centroid.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'aquif_type,recharge,HYGEO2',
    returnGeometry: 'false',
    f: 'json',
  }).toString();
  const response = await fetchWithTimeout(fetchImpl, url, {}, 20_000);
  if (!response.ok) throw new Error(`WHYMAP groundwater query returned ${response.status}`);
  const payload = await response.json() as {
    features?: Array<{ attributes?: { aquif_type?: string; recharge?: string; HYGEO2?: number } }>;
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message ?? 'WHYMAP groundwater query failed');
  const attributes = payload.features?.[0]?.attributes;
  const code = Number(attributes?.HYGEO2);
  const observedAt = providerNow(config);
  return {
    status: attributes ? 'available' : 'unavailable',
    aquiferType: attributes?.aquif_type ?? null,
    rechargeClass: attributes?.recharge ?? null,
    resourceClass: Number.isFinite(code) ? groundwaterResourceClass(code) : null,
    mapLayerId: layerId,
    evidence: evidence(
      'BGR / UNESCO WHYMAP',
      `${serviceUrl}/${layerId}`,
      'Groundwater resources and recharge global synthesis',
      observedAt,
      'low',
      'Global hydrogeological synthesis; not a parcel-scale water-table survey',
    ),
    limitations: [
      'The layer describes regional aquifer context and recharge classes, not water-table depth beneath the parcel.',
      'It cannot confirm a productive well, legal abstraction rights, water quality or seasonal availability.',
      'Use local hydrogeological records, well logs and a qualified field survey before drilling or irrigation decisions.',
    ],
  };
}

function groundwaterResourceClass(code: number): string | null {
  if (code >= 11 && code <= 16) return 'major groundwater basin';
  if (code >= 22 && code <= 26) return 'complex hydrogeological structure';
  if (code >= 33 && code <= 35) return 'local or shallow aquifers';
  return null;
}

async function fetchLandCover(centroid: Coordinate, fetchImpl: typeof fetch, config: SiteProviderConfig) {
  const baseUrl = config.overpassUrl ?? process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
  const query = `[out:json][timeout:20];nwr(around:180,${centroid.lat},${centroid.lng})[landuse];out tags center 10;`;
  const response = await fetchWithTimeout(fetchImpl, baseUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Growup/0.1 site-planning application' },
    body: new URLSearchParams({ data: query }),
  }, 30_000);
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
  const data = await response.json() as { elements?: Array<{ tags?: Record<string, string> }> };
  const tags = data.elements?.find((element) => element.tags?.landuse)?.tags ?? {};
  const landuse = tags.landuse ?? 'unmapped';
  return {
    classification: landuse.replaceAll('_', ' '),
    osmTags: tags,
    evidence: evidence('OpenStreetMap Overpass', baseUrl, 'live OSM data', providerNow(config), tags.landuse ? 'medium' : 'low', 'nearest mapped landuse within 180 m'),
  };
}

function summarizeTerrain(samples: Array<Coordinate & { elevationM: number }>, terrainEvidence: Evidence, computedAt = new Date().toISOString()): SiteProfile['terrain'] {
  const sorted = [...samples].sort((a, b) => a.elevationM - b.elevationM);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const plane = fitTerrainPlane(samples);
  const distance = Math.max(1, haversineM(high, low));
  const fallbackSlope = (high.elevationM - low.elevationM) / distance * 100;
  const slopePercent = plane ? Math.hypot(plane.a, plane.b) * 100 : fallbackSlope;
  const aspectDegrees = plane ? (toDegrees(Math.atan2(-plane.a, -plane.b)) + 360) % 360 : bearing(high, low);
  return {
    elevationMeanM: round(average(samples.map((sample) => sample.elevationM)), 1),
    elevationMinM: round(low.elevationM, 1), elevationMaxM: round(high.elevationM, 1), slopePercent: round(slopePercent, 1),
    aspectDegrees: round(aspectDegrees, 0), aspectLabel: compass(aspectDegrees), samples,
    evidence: { ...terrainEvidence, observedAt: computedAt, computedAt, resolution: `${terrainEvidence.resolution ?? 'sampled points'}; least-squares terrain plane` },
  };
}

export function terrainSamplingPoints(site: SiteBoundary, centroid = weightedSiteCentroid(sitePolygons(site))): Coordinate[] {
  const projection = createLocalProjection(centroid);
  const projectedPolygons = sitePolygons(site).map((polygon) => polygon.map(projection.project));
  const fieldBounds = bounds(projectedPolygons.flat());
  const divisions = 9;
  const candidates: Coordinate[] = [centroid];

  for (const polygon of sitePolygons(site)) {
    const polygonCentre = polygonCentroid(polygon);
    for (const vertex of polygon) {
      candidates.push({
        lat: vertex.lat * 0.94 + polygonCentre.lat * 0.06,
        lng: vertex.lng * 0.94 + polygonCentre.lng * 0.06,
      });
    }
  }

  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      const point = projection.unproject({
        x: fieldBounds.minX + (fieldBounds.maxX - fieldBounds.minX) * (column + 0.5) / divisions,
        y: fieldBounds.minY + (fieldBounds.maxY - fieldBounds.minY) * (row + 0.5) / divisions,
      });
      if (siteContainsCoordinate(site, point)) candidates.push(point);
    }
  }

  const unique = new Map<string, Coordinate>();
  for (const point of candidates) {
    if (!siteContainsCoordinate(site, point)) continue;
    unique.set(`${point.lat.toFixed(7)},${point.lng.toFixed(7)}`, point);
  }
  return [...unique.values()].slice(0, 100);
}

function fitTerrainPlane(samples: Array<Coordinate & { elevationM: number }>): { a: number; b: number; c: number } | null {
  if (samples.length < 3) return null;
  const projection = createLocalProjection({
    lat: average(samples.map((sample) => sample.lat)),
    lng: average(samples.map((sample) => sample.lng)),
  });
  const rows = samples.map((sample) => ({ ...projection.project(sample), z: sample.elevationM }));
  const sx = sum(rows.map((row) => row.x));
  const sy = sum(rows.map((row) => row.y));
  const sz = sum(rows.map((row) => row.z));
  const matrix = [
    [sum(rows.map((row) => row.x * row.x)), sum(rows.map((row) => row.x * row.y)), sx, sum(rows.map((row) => row.x * row.z))],
    [sum(rows.map((row) => row.x * row.y)), sum(rows.map((row) => row.y * row.y)), sy, sum(rows.map((row) => row.y * row.z))],
    [sx, sy, rows.length, sz],
  ];
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    if (Math.abs(matrix[column][column]) < 1e-9) return null;
    const scale = matrix[column][column];
    for (let item = column; item < 4; item += 1) matrix[column][item] /= scale;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let item = column; item < 4; item += 1) matrix[row][item] -= factor * matrix[column][item];
    }
  }
  return { a: matrix[0][3], b: matrix[1][3], c: matrix[2][3] };
}

function weightedSiteCentroid(polygons: Coordinate[][]): Coordinate {
  const weighted = polygons.map((polygon) => ({ centroid: polygonCentroid(polygon), area: polygonAreaM2(polygon) }));
  const total = weighted.reduce((sum, item) => sum + item.area, 0);
  return {
    lat: weighted.reduce((sum, item) => sum + item.centroid.lat * item.area, 0) / Math.max(1, total),
    lng: weighted.reduce((sum, item) => sum + item.centroid.lng * item.area, 0) / Math.max(1, total),
  };
}

function soilTexture(sand: number | null, silt: number | null, clay: number | null): string | null {
  if (sand === null || silt === null || clay === null) return null;
  if (clay >= 40) return 'clay';
  if (sand >= 70 && clay < 15) return 'sandy loam';
  if (silt >= 50 && clay < 27) return 'silt loam';
  if (clay >= 27) return 'clay loam';
  if (sand >= 52) return 'sandy loam';
  return 'loam';
}

function soilReaction(ph: number | null): NonNullable<SiteProfile['soil']['reactionClass']> {
  if (ph === null) return 'unknown';
  if (ph < 4.5) return 'strongly-acidic';
  if (ph < 5.5) return 'acidic';
  if (ph < 6.5) return 'slightly-acidic';
  if (ph <= 7.5) return 'neutral';
  if (ph <= 8.5) return 'alkaline';
  return 'strongly-alkaline';
}

function derivedSoilProperty(
  key: SoilPropertyEstimateKey,
  category: SoilPropertyEstimate['category'],
  value: number | null,
  unit: string,
  source: Evidence,
): SoilPropertyEstimate {
  return {
    key,
    category,
    value,
    unit,
    depthTopCm: 0,
    depthBottomCm: 5,
    predictionInterval90: null,
    estimateType: 'derived-from-modelled',
    evidence: {
      ...source,
      version: `${source.version}; derived by Growup from modelled inputs`,
      confidence: value === null ? 'low' : source.confidence,
    },
  };
}

function unavailableSoil(config: SiteProviderConfig, generatedAt: string): SiteProfile['soil'] {
  return {
    ph: null,
    sandPercent: null,
    siltPercent: null,
    clayPercent: null,
    organicCarbonGKg: null,
    textureClass: null,
    status: 'unavailable',
    evidence: evidence(
      'ISRIC SoilGrids WCS',
      config.soilGridsWcsUrl ?? process.env.SOILGRIDS_WCS_URL ?? 'https://maps.isric.org/mapserv',
      'SoilGrids 2.0',
      generatedAt,
      'low',
      '250 m',
    ),
    properties: [],
    reactionClass: 'unknown',
    carbonNitrogenRatio: null,
    limitations: ['SoilGrids was unavailable; obtain a georeferenced laboratory soil analysis.'],
  };
}

function unavailableDepthToBedrock(
  config: SiteProviderConfig,
  generatedAt: string,
): NonNullable<SiteProfile['soil']['depthToBedrock']> {
  const sourceUrl = config.depthToBedrockUrl
    ?? process.env.DEPTH_TO_BEDROCK_URL
    ?? 'https://files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif';
  return {
    status: 'unavailable',
    modelledDepthM: null,
    minimumDepthM: null,
    maximumDepthM: null,
    samples: [],
    evidence: evidence(
      'ISRIC / Shangguan et al. global depth-to-bedrock model',
      sourceUrl,
      'Global depth to bedrock, March 2017',
      generatedAt,
      'low',
      '250 m',
      { publishedAt: '2017-03-10' },
    ),
    limitations: ['Modelled depth to bedrock is unavailable; measure effective rooting depth in the field.'],
  };
}

function unavailableGroundwater(config: SiteProviderConfig, generatedAt: string): GroundwaterProfile {
  const serviceUrl = (
    config.groundwaterMapServerUrl
    ?? process.env.GROUNDWATER_MAP_SERVER_URL
    ?? 'https://services.bgr.de/arcgis/rest/services/grundwasser/whymap_gwr/MapServer'
  ).replace(/\/$/, '');
  return {
    status: 'unavailable',
    aquiferType: null,
    rechargeClass: null,
    resourceClass: null,
    mapLayerId: 11,
    evidence: evidence(
      'BGR / UNESCO WHYMAP',
      `${serviceUrl}/11`,
      'Groundwater resources and recharge global synthesis',
      generatedAt,
      'low',
      'global hydrogeological context',
    ),
    limitations: ['Global groundwater context is unavailable; consult local hydrogeological records.'],
  };
}

function satelliteSoilScreening(profile: SatelliteProfile): NonNullable<SiteProfile['soil']['satelliteScreening']> {
  const candidates = profile.optical.history.filter((observation) => (
    observation.ndvi.mean <= 0.3
    && observation.bareSoilIndex.validPixels > 0
  ));
  const opticalEvidence = profile.evidence.find((item) => /sentinel-2|planetary computer/i.test(`${item.source} ${item.version}`)) ?? null;
  return {
    status: candidates.length >= 2 ? 'usable' : candidates.length === 1 ? 'limited' : 'unavailable',
    bareSoilObservationCount: candidates.length,
    totalObservationCount: profile.optical.history.length,
    latestBareSoilIndex: candidates[0]?.bareSoilIndex.mean ?? null,
    use: 'variability-screening-only',
    evidence: opticalEvidence ? { ...opticalEvidence } : null,
    limitations: [
      'Sentinel-2 bare-soil reflectance can screen relative within-field variability but does not directly measure chemical concentrations.',
      'Crop cover, residues, moisture and roughness can dominate the spectral signal.',
      'Locally calibrated laboratory samples are required before converting spectral zones into chemical estimates.',
    ],
  };
}

async function safeProvider<T>(operation: () => Promise<T>, warning: string): Promise<ProviderResult<T>> {
  try { return { value: await operation(), warning: null }; } catch { return { value: null, warning }; }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string | URL, init: RequestInit = {}, timeoutMs = 25_000) {
  return fetchImpl(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

async function withProviderTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Provider timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type EvidenceTemporalFields = Pick<Evidence, 'dataObservedAt' | 'coverageStart' | 'coverageEnd' | 'publishedAt' | 'retrievedAt' | 'computedAt'>;

function evidence(
  source: string,
  sourceUrl: string,
  version: string,
  observedAt: string,
  confidence: Evidence['confidence'],
  resolution?: string,
  temporal: Partial<EvidenceTemporalFields> = {},
): Evidence {
  return { source, sourceUrl, version, observedAt, retrievedAt: observedAt, confidence, resolution, ...temporal };
}

function bearing(from: Coordinate, to: Coordinate): number {
  const lat1 = from.lat * Math.PI / 180; const lat2 = to.lat * Math.PI / 180; const deltaLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function compass(degrees: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

function average(values: number[]): number { return values.length ? sum(values) / values.length : 0; }
function median(sortedValues: number[]): number {
  if (!sortedValues.length) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}
function sum(values: number[]): number { return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0); }
function percentile(sortedValues: number[], fraction: number): number {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index];
}
function modulo(value: number, divisor: number): number { return ((value % divisor) + divisor) % divisor; }
function round(value: number, digits: number): number { return Number(value.toFixed(digits)); }
function nullableRound(value: number | null, digits: number): number | null { return value === null ? null : round(value, digits); }
function toRadians(value: number): number { return value * Math.PI / 180; }
function toDegrees(value: number): number { return value * 180 / Math.PI; }
