import { describe, expect, it } from 'vitest';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { defaultFireOperationsPlan, effisFireWeatherTile, normalizeFireOperationsPlan } from './fireOperations';

describe('fire operations', () => {
  it('creates a complete persisted checklist and normalizes bounded updates', () => {
    const plan = defaultFireOperationsPlan('2026-07-26T08:00:00.000Z');
    const normalized = normalizeFireOperationsPlan({
      ...plan,
      tasks: [{ ...plan.tasks[0], status: 'complete', completedAt: '2026-07-26T09:00:00.000Z' }],
    }, '2026-07-26T08:00:00.000Z');
    expect(normalized.tasks).toHaveLength(5);
    expect(normalized.tasks[0]).toEqual(expect.objectContaining({ id: 'surface-fuels', status: 'complete' }));
    expect(normalized.sourceSnapshot).toEqual(expect.objectContaining({ provider: 'EFFIS', layer: 'ecmwf.fwi', resolutionKm: 8 }));
  });

  it('builds the current dated EFFIS WMTS tile covering the selected field', () => {
    const tile = effisFireWeatherTile(TEMPERATE_OPEN_FIELD_FIXTURE, '2026-07-26');
    expect(tile.url).toBe('https://maps.effis.emergency.copernicus.eu/effist/wmts/1.0.0/ecmwf.fwi/default/2026-07-26/ECMWF3857/6/24/34.png');
    expect(TEMPERATE_OPEN_FIELD_FIXTURE.polygon.every((coordinate) =>
      coordinate.lat <= tile.bounds.north
      && coordinate.lat >= tile.bounds.south
      && coordinate.lng <= tile.bounds.east
      && coordinate.lng >= tile.bounds.west,
    )).toBe(true);
  });
});
