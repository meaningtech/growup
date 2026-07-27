import { describe, expect, it } from 'vitest';
import { plantMarkerLabelColor, plantingRowLabel, plantPositionCode, plantSpeciesInitials } from './plantIdentity';

describe('plant map identity', () => {
  it('assigns lettered rows and one-based positions', () => {
    expect(plantingRowLabel(0)).toBe('A');
    expect(plantingRowLabel(25)).toBe('Z');
    expect(plantingRowLabel(26)).toBe('AA');
    expect(plantPositionCode({ rowIndex: 2, positionIndex: 7 })).toBe('C8');
  });

  it('uses the first two letters of the localized species name inside the marker', () => {
    expect(plantSpeciesInitials('Leccio', 'it')).toBe('LE');
    expect(plantSpeciesInitials('Érable champêtre', 'fr')).toBe('ÉR');
    expect(plantSpeciesInitials('Olive', 'en')).toBe('OL');
    expect(plantMarkerLabelColor('#1f5139')).toBe('#ffffff');
    expect(plantMarkerLabelColor('#d7ff83')).toBe('#17351f');
  });
});
