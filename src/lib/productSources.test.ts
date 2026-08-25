import { describe, expect, it } from 'vitest';
import { INFO_DATA_SOURCE_GROUPS } from './productSources';

describe('product information sources', () => {
  it('lists every runtime source once with a public record', () => {
    const ids = INFO_DATA_SOURCE_GROUPS.flatMap((group) => group.sources.map((source) => source.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'openMeteoClimate',
      'soilGrids',
      'sentinel2',
      'gibs',
      'effis',
      'switchboard',
      'nominatim',
    ]));
    for (const source of INFO_DATA_SOURCE_GROUPS.flatMap((group) => group.sources)) {
      expect(source.name.length).toBeGreaterThan(3);
      expect(source.href).toMatch(/^https:\/\//);
    }
  });
});
