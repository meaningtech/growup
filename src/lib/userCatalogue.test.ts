import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES_BY_ID } from '../data/designSpecies';
import type { CatalogueSpecies } from '../types';
import {
  hasSourcedClimateEnvelope,
  normalizeUserSpecies,
  planningSpeciesFromCatalogue,
  resolvePlanningSpecies,
  speciesLibrary,
  suggestedCatalogueSpacingM,
} from './userCatalogue';

export function catalogueTaxon(overrides: Partial<CatalogueSpecies> = {}): CatalogueSpecies {
  return {
    id: 'switchboard-theobroma-cacao',
    scientificName: 'Theobroma cacao',
    sourceCount: 4,
    treeLike: true,
    wfoId: null,
    wcvpId: null,
    globUnt: false,
    designReady: false,
    stratum: 'medium',
    succession: 'secondary',
    roles: ['food'],
    evergreen: false,
    nitrogenFixer: false,
    droughtTolerance: null,
    evidenceCount: 1,
    ...overrides,
  };
}

describe('user catalogue planting records', () => {
  it('builds a planning species without inventing climate envelopes', () => {
    const species = planningSpeciesFromCatalogue(catalogueTaxon(), 5);
    expect(species.id).toBe('switchboard-theobroma-cacao');
    expect(species.envelopeConfidence).toBe('unknown');
    expect(hasSourcedClimateEnvelope(species)).toBe(false);
    expect(species.spacingM).toBe(5);
    expect(species.minTemperatureC).toBe(0);
    expect(species.sources.some((source) => source.supports.includes('climate envelope'))).toBe(false);
    expect(species.sources.some((source) => source.supports.includes('planting spacing chosen in this project'))).toBe(true);
  });

  it('clamps user spacing and keeps Switchboard identity', () => {
    expect(planningSpeciesFromCatalogue(catalogueTaxon(), 0.2).spacingM).toBe(1.6);
    expect(planningSpeciesFromCatalogue(catalogueTaxon(), 80).spacingM).toBe(30);
    expect(suggestedCatalogueSpacingM(catalogueTaxon({ treeLike: false, stratum: 'climber' }))).toBe(2);
  });

  it('normalizes persisted user species and never overwrites curated envelopes', () => {
    const stored = planningSpeciesFromCatalogue(catalogueTaxon(), 7);
    const olive = DESIGN_SPECIES_BY_ID.get('olea-europaea')!;
    expect(normalizeUserSpecies([stored, { ...olive, envelopeConfidence: 'sourced' }])).toEqual([
      expect.objectContaining({ id: stored.id, spacingM: 7, envelopeConfidence: 'unknown' }),
    ]);
    const library = speciesLibrary(normalizeUserSpecies([stored]));
    expect(library.get('olea-europaea')).toBe(olive);
    expect(resolvePlanningSpecies(stored.id, [stored])?.scientificName).toBe('Theobroma cacao');
  });
});
