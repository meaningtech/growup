import { describe, expect, it } from 'vitest';
import { commonNameMatches, normalizeScientificName, scientificNameMatches } from './scientificName';

describe('scientific name matching', () => {
  it('treats hybrid markers as the same binomial', () => {
    expect(normalizeScientificName('Citrus × sinensis')).toBe('citrus sinensis');
    expect(normalizeScientificName('Citrus x limon')).toBe('citrus limon');
    expect(scientificNameMatches('Citrus × sinensis', 'Citrus sinensis')).toBe(true);
    expect(scientificNameMatches('Citrus × limon', 'citrus limon')).toBe(true);
  });

  it('matches a genus or epithet token and rejects letters buried inside another name', () => {
    expect(scientificNameMatches('Pinus pinea', 'pinus')).toBe(true);
    expect(scientificNameMatches('Pinus pinea', 'pino')).toBe(false);
    expect(scientificNameMatches('Carpinus betulus', 'pinus')).toBe(false);
    expect(scientificNameMatches('Ancistrocarpus densispinosus', 'pino')).toBe(false);
    expect(scientificNameMatches('Olea europaea', 'olea')).toBe(true);
    expect(scientificNameMatches('Acacia caroleae', 'olea')).toBe(false);
    expect(scientificNameMatches('Colea alata', 'olea')).toBe(false);
    expect(scientificNameMatches('Malus domestica', 'malus')).toBe(true);
    expect(scientificNameMatches('Calamus anomalus', 'malus')).toBe(false);
    expect(scientificNameMatches('Ficus carica', 'ficus')).toBe(true);
    expect(scientificNameMatches('Decalobanthus pacificus', 'ficus')).toBe(false);
    expect(scientificNameMatches('Olea europaea', 'europaea')).toBe(true);
  });
});

describe('common name matching', () => {
  it('matches whole words so Italian names do not collide', () => {
    expect(commonNameMatches('Pino domestico', 'pino', 'it')).toBe(true);
    expect(commonNameMatches('Biancospino', 'pino', 'it')).toBe(false);
    expect(commonNameMatches('Melo', 'melo', 'it')).toBe(true);
    expect(commonNameMatches('Melograno', 'melo', 'it')).toBe(false);
    expect(commonNameMatches('Pero', 'pero', 'it')).toBe(true);
    expect(commonNameMatches('Cappero', 'pero', 'it')).toBe(false);
    expect(commonNameMatches('Ginestra odorosa', 'rosa', 'it')).toBe(false);
    expect(commonNameMatches('Fico', 'fico', 'it')).toBe(true);
    expect(commonNameMatches('Fico d’India', 'fico', 'it')).toBe(true);
    expect(commonNameMatches('Gelso bianco', 'gelso', 'it')).toBe(true);
    expect(commonNameMatches('Arancio dolce', 'arancio', 'it')).toBe(true);
    expect(commonNameMatches('Nespolo del Giappone', 'nespolo', 'it')).toBe(true);
  });

  it('matches English words without cutting through a longer word', () => {
    expect(commonNameMatches('Holm oak', 'oak')).toBe(true);
    expect(commonNameMatches('Prickly pear', 'pear')).toBe(true);
    expect(commonNameMatches('Pink rock-rose', 'rose')).toBe(true);
    expect(commonNameMatches('Rosemary', 'rose')).toBe(false);
    expect(commonNameMatches('Walnut', 'nut')).toBe(false);
    expect(commonNameMatches('Sweet chestnut', 'nut')).toBe(false);
    expect(commonNameMatches('Stone pine', 'pine')).toBe(true);
  });
});
