import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import {
  GIBS_FIRE_LAYERS,
  GIBS_RASTER_LAYERS,
  GIBS_SCIENCE_OVERLAY_IDS,
  GIBS_TRUE_COLOR_LAYER,
  GIBS_WMS_URL,
  GIBS_WMTS_URL,
  WORLDVIEW_LABEL_LAYER,
  WORLDVIEW_ORIGIN,
  gibsFireOverlay,
  gibsObservationDate,
  gibsRasterOverlayAtMapZoom,
  gibsRasterTileUrl,
  gibsTrueColorTileUrl,
  normalizeGibsDate,
  siteGeographicExtent,
  worldviewPermalink,
  worldviewPermalinkLayers,
} from './gibs';

describe('NASA GIBS helpers', () => {
  it('defaults the observation date to yesterday UTC without inventing a current-day tile', () => {
    expect(gibsObservationDate(new Date('2026-08-24T03:11:00.000Z'))).toBe('2026-08-23');
    expect(normalizeGibsDate('2026-07-26')).toBe('2026-07-26');
    expect(normalizeGibsDate('not-a-date', new Date('2026-08-24T12:00:00.000Z'))).toBe('2026-08-23');
  });

  it('builds a Google-Maps-compatible VIIRS true-color WMTS tile', () => {
    expect(gibsTrueColorTileUrl({ x: 138, y: 99 }, 8, '2026-08-23')).toBe(
      `${GIBS_WMTS_URL}/${GIBS_TRUE_COLOR_LAYER}/default/2026-08-23/GoogleMapsCompatible_Level9/8/99/138.jpg`,
    );
    expect(gibsTrueColorTileUrl({ x: 0, y: -1 }, 8, '2026-08-23')).toBe('');
    expect(gibsTrueColorTileUrl({ x: 0, y: 0 }, 10, '2026-08-23')).toBe('');
  });

  it('builds dated WMTS tiles for every additional GIBS landscape measurement', () => {
    const date = '2026-08-01';
    expect(GIBS_SCIENCE_OVERLAY_IDS).toEqual([
      'hls',
      'surface-water',
      'flood',
      'aerosol',
      'disturbance',
      'precipitation',
    ]);
    for (const id of GIBS_SCIENCE_OVERLAY_IDS) {
      const spec = GIBS_RASTER_LAYERS[id];
      const zoom = Math.min(6, spec.maxZoom);
      const url = gibsRasterTileUrl(spec, { x: 1, y: 1 }, zoom, date);
      expect(url.startsWith(`${GIBS_WMTS_URL}/${spec.layer}/default/${date}/`)).toBe(true);
      expect(url).toContain(`/${spec.tileMatrix}/${zoom}/`);
      expect(url.endsWith(`.${spec.format}`)).toBe(true);
      expect(url).toContain(date);
      expect(url).not.toContain('ecmwf.fwi');
      expect(url).not.toContain('sentinel-2');
    }
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS.hls, { x: 2215, y: 1595 }, 12, date)).toBe(
      `${GIBS_WMTS_URL}/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-08-01/GoogleMapsCompatible_Level12/12/1595/2215.png`,
    );
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS['surface-water'], { x: 2215, y: 1595 }, 12, date)).toContain(
      'OPERA_L3_Dynamic_Surface_Water_Extent-HLS',
    );
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS.flood, { x: 138, y: 99 }, 8, date)).toContain('VIIRS_Combined_Flood_3-Day');
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS.aerosol, { x: 34, y: 24 }, 6, date)).toContain('OMPS_Aerosol_Index');
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS.disturbance, { x: 2215, y: 1595 }, 12, date)).toContain(
      'OPERA_L3_DIST-ALERT-HLS_Color_Index',
    );
    expect(gibsRasterTileUrl(GIBS_RASTER_LAYERS.precipitation, { x: 34, y: 24 }, 6, date)).toContain('IMERG_Precipitation_Rate');
  });

  it('keeps a non-empty WMS GroundOverlay at parcel zoom 17 for every GIBS raster', () => {
    const date = '2026-08-01';
    const rasters = [GIBS_RASTER_LAYERS['true-color'], ...GIBS_SCIENCE_OVERLAY_IDS.map((id) => GIBS_RASTER_LAYERS[id])];
    expect(rasters).toHaveLength(7);
    for (const spec of rasters) {
      expect(gibsRasterTileUrl(spec, { x: 1, y: 1 }, 17, date)).toBe('');
      const overlay = gibsRasterOverlayAtMapZoom(spec, TEMPERATE_OPEN_FIELD_FIXTURE, date, 17);
      const url = new URL(overlay.url);
      expect(`${url.origin}${url.pathname}`).toBe(GIBS_WMS_URL);
      expect(url.searchParams.get('LAYERS')).toBe(spec.layer);
      expect(url.searchParams.get('TIME')).toBe(date);
      expect(url.searchParams.get('WIDTH')).toBe('1024');
      expect(overlay.url.length).toBeGreaterThan(80);
      expect(TEMPERATE_OPEN_FIELD_FIXTURE.polygon.every((coordinate) =>
        coordinate.lat <= overlay.bounds.north
        && coordinate.lat >= overlay.bounds.south
        && coordinate.lng <= overlay.bounds.east
        && coordinate.lng >= overlay.bounds.west,
      )).toBe(true);
    }
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('gibsRasterOverlay(');
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('new maps.GroundOverlay(overlay.url, overlay.bounds');
    expect(readFileSync('src/App.tsx', 'utf8')).not.toContain('gibsRasterTileUrl(');
  });

  it('requests a dated FIRMS WMS overlay around the parcel without replacing EFFIS', () => {
    const overlay = gibsFireOverlay(TEMPERATE_OPEN_FIELD_FIXTURE, '2026-08-23');
    const url = new URL(overlay.url);
    expect(`${url.origin}${url.pathname}`).toBe(GIBS_WMS_URL);
    expect(url.searchParams.get('LAYERS')).toBe(GIBS_FIRE_LAYERS.join(','));
    expect(url.searchParams.get('TIME')).toBe('2026-08-23');
    expect(url.searchParams.get('CRS')).toBe('EPSG:4326');
    expect(url.searchParams.get('TRANSPARENT')).toBe('TRUE');
    const [south, west, north, east] = (url.searchParams.get('BBOX') ?? '').split(',').map(Number);
    expect(south).toBe(overlay.bounds.south);
    expect(west).toBe(overlay.bounds.west);
    expect(north).toBe(overlay.bounds.north);
    expect(east).toBe(overlay.bounds.east);
    expect(TEMPERATE_OPEN_FIELD_FIXTURE.polygon.every((coordinate) =>
      coordinate.lat <= overlay.bounds.north
      && coordinate.lat >= overlay.bounds.south
      && coordinate.lng <= overlay.bounds.east
      && coordinate.lng >= overlay.bounds.west,
    )).toBe(true);
  });

  it('opens NASA Worldview on the same field with true colour, fires, science overlays and labels', () => {
    const href = worldviewPermalink(TEMPERATE_OPEN_FIELD_FIXTURE, '2026-08-23');
    const extent = siteGeographicExtent(TEMPERATE_OPEN_FIELD_FIXTURE);
    const layers = worldviewPermalinkLayers();
    expect(href.startsWith(`${WORLDVIEW_ORIGIN}/?`)).toBe(true);
    expect(href).toContain(`v=${extent.west.toFixed(4)},${extent.south.toFixed(4)},${extent.east.toFixed(4)},${extent.north.toFixed(4)}`);
    expect(href).toContain(`l=${layers.join(',')}`);
    expect(layers[0]).toBe(GIBS_TRUE_COLOR_LAYER);
    expect(layers).toEqual(expect.arrayContaining([
      GIBS_TRUE_COLOR_LAYER,
      ...GIBS_FIRE_LAYERS,
      WORLDVIEW_LABEL_LAYER,
      GIBS_RASTER_LAYERS.hls.layer,
      GIBS_RASTER_LAYERS['surface-water'].layer,
      GIBS_RASTER_LAYERS.flood.layer,
      GIBS_RASTER_LAYERS.aerosol.layer,
      GIBS_RASTER_LAYERS.disturbance.layer,
      GIBS_RASTER_LAYERS.precipitation.layer,
    ]));
    expect(href).toContain('t=2026-08-23-T00:00:00Z');
    expect(href).toContain(`s=${extent.center.lat.toFixed(4)},${extent.center.lng.toFixed(4)}`);
    expect(href).not.toContain('ecmwf.fwi');
    expect(href).not.toContain('sentinel-2');
  });

  it('keeps Sentinel and EFFIS labels while exposing independent NASA overlay names', () => {
    const en = dictionaries.en;
    expect(en['map.layerRecentImagery']).toContain('Sentinel');
    expect(en['map.layerFireWeatherHint']).toContain('EFFIS');
    expect(en['map.toggleHls']).not.toBe(en['map.toggleRecentImagery']);
    expect(en['map.toggleFlood']).not.toBe(en['map.toggleFireWeather']);
    for (const key of [
      'map.toggleHls',
      'map.toggleSurfaceWater',
      'map.toggleFlood',
      'map.toggleAerosol',
      'map.toggleDisturbance',
      'map.togglePrecipitation',
      'map.toggleLandscapeImagery',
      'map.toggleObservedFires',
    ]) {
      expect(en[key].length).toBeGreaterThan(8);
      expect(dictionaries.it[key].length).toBeGreaterThan(8);
    }
  });

  it('does not import GIBS into parcel calculations or the persisted EFFIS snapshot', () => {
    for (const file of ['src/lib/layout.ts', 'server/site.ts', 'src/lib/irrigation.ts', 'src/lib/fireOperations.ts', 'src/lib/costs.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"].*\/gibs['"]/);
    }
    expect(readFileSync('src/lib/fireOperations.ts', 'utf8')).toContain("provider: 'EFFIS'");
    expect(readFileSync('src/lib/fireOperations.ts', 'utf8')).toContain('ecmwf.fwi');
  });
});
