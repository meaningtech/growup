import { fromArrayBuffer } from 'geotiff';
import { bounds, createLocalProjection, haversineM, polygonAreaM2, polygonCentroid, polygonPerimeterM } from '../src/lib/geometry.js';
import { siteContainsCoordinate, sitePolygons } from '../src/lib/siteGeometry.js';
import { defaultFieldConditions } from '../src/lib/siteOverrides.js';
import type { Coordinate, Evidence, LocationSearchResult, SiteBoundary, SiteProfile, SolarClimateBin, SolarResourceProfile } from '../src/types.js';
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
  const [location, elevations, climate, solar, soil, landCover, satellite] = await Promise.all([
    safeProvider(() => reverseGeocodeLocation(centroid, { ...config, fetchImpl }), 'Reverse geocoding is unavailable.'),
    safeProvider(() => fetchElevations(sampleCoordinates, fetchImpl, config), 'Terrain elevation is unavailable.'),
    safeProvider(() => fetchClimate(centroid, fetchImpl, config), 'Historical climate is unavailable.'),
    safeProvider(() => fetchSolarWeather(centroid, fetchImpl, config), 'Historical hourly radiation and wind are unavailable.'),
    safeProvider(() => fetchSoil(polygons.flat(), fetchImpl, config), 'SoilGrids WCS is unavailable; obtain a field soil test.'),
    safeProvider(() => fetchLandCover(centroid, fetchImpl, config), 'OSM land-cover context is unavailable.'),
    safeProvider(() => fetchSatelliteProfile(site, config), 'Sentinel-1/2 field-water context is unavailable.'),
  ]);
  const warnings = [location.warning, elevations.warning, climate.warning, solar.warning, soil.warning, landCover.warning, satellite.warning].filter(
    (warning): warning is string => Boolean(warning),
  );

  if (!elevations.value) throw new Error('Site profiling requires terrain elevation data');
  if (!climate.value) throw new Error('Site profiling requires historical climate data');

  const terrain = summarizeTerrain(elevations.value.samples, elevations.value.evidence);
  const generatedAt = (config.now?.() ?? new Date()).toISOString();
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
    soil: soil.value ?? {
      ph: null,
      sandPercent: null,
      siltPercent: null,
      clayPercent: null,
      organicCarbonGKg: null,
      textureClass: null,
      status: 'unavailable',
      evidence: evidence('SoilGrids WCS', config.soilGridsWcsUrl ?? process.env.SOILGRIDS_WCS_URL ?? 'https://maps.isric.org/mapserv', '2.0', generatedAt, 'low', '250 m'),
    },
    fieldConditions: defaultFieldConditions(),
    overrides: [],
    landCover: landCover.value ?? {
      classification: 'Unknown',
      osmTags: {},
      evidence: evidence('OpenStreetMap Overpass', config.overpassUrl ?? process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter', 'live', generatedAt, 'low', 'mapped feature proximity'),
    },
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
          evidence: evidence('Google Maps Elevation API', baseUrl, 'live', new Date().toISOString(), resolution <= 30 ? 'high' : 'medium', `${resolution ? `${round(resolution, 1)} m mean source resolution; ` : ''}${points.length} field-clipped terrain samples`),
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
    evidence: evidence('Open-Meteo elevation API', baseUrl, '90 m DEM', new Date().toISOString(), 'medium', `${points.length} field-clipped terrain samples`),
  };
}

async function fetchSolarWeather(centroid: Coordinate, fetchImpl: typeof fetch, config: SiteProviderConfig): Promise<SolarResourceProfile> {
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
  for (let index = 0; index < time.length; index += 1) {
    const month = Number(time[index].slice(5, 7));
    const hour = Number(time[index].slice(11, 13));
    if (!Number.isFinite(month) || !Number.isFinite(hour)) continue;
    const directionRadians = toRadians(Number(windDirection[index] ?? 0));
    const speed = Math.max(0, Number(windSpeed[index] ?? 0));
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
  return {
    status: 'available', period: '2021–2025',
    annualGlobalHorizontalKwhM2: round(globalWh / 1000 / 5, 0),
    annualDirectNormalKwhM2: round(directWh / 1000 / 5, 0),
    prevailingWindDirectionDegrees,
    prevailingWindDirectionLabel: prevailingWindDirectionDegrees === null ? null : compass(prevailingWindDirectionDegrees),
    meanWindSpeedMs: validWind ? round(windSpeedTotal / validWind, 2) : null,
    hourlyClimatology,
    evidence: evidence('Open-Meteo Historical Weather API', url.toString(), 'ERA5-family reanalysis, 2021–2025 hourly aggregate', new Date().toISOString(), 'high', 'hourly radiation and 10 m wind grid'),
    limitations: ['Reanalysis does not resolve local obstacles, hedges or gust corridors; verify damaging winds on site.'],
  };
}

function unavailableSolarProfile(observedAt: string): SolarResourceProfile {
  return {
    status: 'unavailable', period: 'unavailable', annualGlobalHorizontalKwhM2: 0, annualDirectNormalKwhM2: 0,
    prevailingWindDirectionDegrees: null, prevailingWindDirectionLabel: null, meanWindSpeedMs: null, hourlyClimatology: [],
    evidence: evidence('Open-Meteo Historical Weather API', 'https://archive-api.open-meteo.com/v1/archive', 'unavailable', observedAt, 'low'),
    limitations: ['Historical hourly radiation and wind could not be retrieved.'],
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
  const now = new Date().toISOString();
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
    evidence: evidence('Open-Meteo Historical Weather API', url.toString(), 'ERA5-family reanalysis, 2021–2025 aggregate', now, 'high', 'weather grid with 90 m elevation downscaling'),
  };
}

async function fetchSoil(polygon: Coordinate[], fetchImpl: typeof fetch, config: SiteProviderConfig) {
  const baseUrl = config.soilGridsWcsUrl ?? process.env.SOILGRIDS_WCS_URL ?? 'https://maps.isric.org/mapserv';
  const origin = polygonCentroid(polygon);
  const projection = createLocalProjection(origin);
  const localBounds = bounds(polygon.map(projection.project));
  const padding = 160;
  const southwest = projection.unproject({ x: localBounds.minX - padding, y: localBounds.minY - padding });
  const northeast = projection.unproject({ x: localBounds.maxX + padding, y: localBounds.maxY + padding });
  const properties = await Promise.all([
    soilCoverage('phh2o', 'phh2o_0-5cm_mean', baseUrl, southwest, northeast, fetchImpl, (raw) => raw / 10),
    soilCoverage('sand', 'sand_0-5cm_mean', baseUrl, southwest, northeast, fetchImpl, (raw) => raw / 10),
    soilCoverage('silt', 'silt_0-5cm_mean', baseUrl, southwest, northeast, fetchImpl, (raw) => raw / 10),
    soilCoverage('clay', 'clay_0-5cm_mean', baseUrl, southwest, northeast, fetchImpl, (raw) => raw / 10),
    soilCoverage('soc', 'soc_0-5cm_mean', baseUrl, southwest, northeast, fetchImpl, (raw) => raw / 10),
  ]);
  const values = Object.fromEntries(properties) as Record<string, number | null>;
  const textureClass = soilTexture(values.sand, values.silt, values.clay);
  const available = Object.values(values).filter((value) => value !== null).length;
  return {
    ph: nullableRound(values.phh2o, 1), sandPercent: nullableRound(values.sand, 1), siltPercent: nullableRound(values.silt, 1),
    clayPercent: nullableRound(values.clay, 1), organicCarbonGKg: nullableRound(values.soc, 1), textureClass,
    status: available === 5 ? 'available' as const : available > 0 ? 'partial' as const : 'unavailable' as const,
    evidence: evidence('SoilGrids WCS', baseUrl, 'SoilGrids 2.0 mean, 0–5 cm', new Date().toISOString(), available === 5 ? 'medium' : 'low', '250 m; field sampling required for execution'),
  };
}

async function soilCoverage(
  property: string, coverageId: string, baseUrl: string, southwest: Coordinate, northeast: Coordinate,
  fetchImpl: typeof fetch, transform: (raw: number) => number,
): Promise<[string, number | null]> {
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
  const raster = await image.readRasters();
  const values = Array.from(raster[0] as ArrayLike<number>).filter((value) => Number.isFinite(value) && value >= 0);
  return [property, values.length ? transform(average(values)) : null];
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
    evidence: evidence('OpenStreetMap Overpass', baseUrl, 'live OSM data', new Date().toISOString(), tags.landuse ? 'medium' : 'low', 'nearest mapped landuse within 180 m'),
  };
}

function summarizeTerrain(samples: Array<Coordinate & { elevationM: number }>, terrainEvidence: Evidence): SiteProfile['terrain'] {
  const sorted = [...samples].sort((a, b) => a.elevationM - b.elevationM);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const plane = fitTerrainPlane(samples);
  const distance = Math.max(1, haversineM(high, low));
  const fallbackSlope = (high.elevationM - low.elevationM) / distance * 100;
  const slopePercent = plane ? Math.hypot(plane.a, plane.b) * 100 : fallbackSlope;
  const aspectDegrees = plane ? (toDegrees(Math.atan2(-plane.a, -plane.b)) + 360) % 360 : bearing(high, low);
  const now = new Date().toISOString();
  return {
    elevationMeanM: round(average(samples.map((sample) => sample.elevationM)), 1),
    elevationMinM: round(low.elevationM, 1), elevationMaxM: round(high.elevationM, 1), slopePercent: round(slopePercent, 1),
    aspectDegrees: round(aspectDegrees, 0), aspectLabel: compass(aspectDegrees), samples,
    evidence: { ...terrainEvidence, observedAt: now, resolution: `${terrainEvidence.resolution ?? 'sampled points'}; least-squares terrain plane` },
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

async function safeProvider<T>(operation: () => Promise<T>, warning: string): Promise<ProviderResult<T>> {
  try { return { value: await operation(), warning: null }; } catch { return { value: null, warning }; }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string | URL, init: RequestInit = {}, timeoutMs = 25_000) {
  return fetchImpl(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

function evidence(source: string, sourceUrl: string, version: string, observedAt: string, confidence: Evidence['confidence'], resolution?: string): Evidence {
  return { source, sourceUrl, version, observedAt, confidence, resolution };
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
function sum(values: number[]): number { return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0); }
function round(value: number, digits: number): number { return Number(value.toFixed(digits)); }
function nullableRound(value: number | null, digits: number): number | null { return value === null ? null : round(value, digits); }
function toRadians(value: number): number { return value * Math.PI / 180; }
function toDegrees(value: number): number { return value * 180 / Math.PI; }
