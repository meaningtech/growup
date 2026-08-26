import { describe, expect, it } from 'vitest';
import { DESIGN_SPECIES } from '../data/designSpecies';
import { openFieldProfile } from '../../test/fixtures/siteProfile';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../../test/fixtures/sites';
import { DEFAULT_DESIGN_CONFIGURATION, generateLayoutVariants } from './layout';
import { buildRowProfile, buildSuccessionFrames, canopyPath, chooseProfileRow, plantScreenPosition, profileViewBox, trunkPath } from './successionProfile';

const species = DESIGN_SPECIES.filter((item) => ['populus-alba', 'olea-europaea', 'quercus-ilex', 'spartium-junceum'].includes(item.id));

describe('syntropic side-view succession profile', () => {
  const variant = generateLayoutVariants(
    TEMPERATE_OPEN_FIELD_FIXTURE,
    openFieldProfile(TEMPERATE_OPEN_FIELD_FIXTURE),
    species,
    DEFAULT_DESIGN_CONFIGURATION,
  )[0];

  it('places a row in metres and grows climax above placenta by year 20', () => {
    const rowIndex = chooseProfileRow(variant.trees);
    const yearOne = buildRowProfile(variant, species, 1, rowIndex);
    const yearTwenty = buildRowProfile(variant, species, 20, rowIndex);
    expect(yearOne.plants.length).toBeGreaterThan(2);
    expect(yearOne.plants.some((plant) => plant.succession === 'placenta' && plant.active)).toBe(true);
    const placenta = yearTwenty.plants.filter((plant) => plant.succession === 'placenta');
    const climax = yearTwenty.plants.filter((plant) => plant.succession === 'climax' && plant.active);
    expect(climax.length).toBeGreaterThan(0);
    expect(Math.max(...climax.map((plant) => plant.heightM))).toBeGreaterThan(Math.max(0, ...placenta.map((plant) => plant.active ? plant.heightM : 0)));
    expect(buildRowProfile(variant, species, 20, rowIndex)).toEqual(yearTwenty);
  });

  it('shows placenta early and taller climax later in the same row', () => {
    const rowIndex = chooseProfileRow(variant.trees);
    const frames = buildSuccessionFrames(variant, species, rowIndex, [1, 10, 20]);
    expect(frames.map((frame) => frame.year)).toEqual([1, 10, 20]);
    expect(frames[0].plants.some((plant) => plant.succession === 'placenta' && plant.active)).toBe(true);
    const climaxLater = frames[2].plants.filter((plant) => plant.succession === 'climax' && plant.active);
    expect(climaxLater.length).toBeGreaterThan(0);
    const tallest = (frame: typeof frames[number], id: string) => frame.plants.find((plant) => plant.speciesId === id && plant.active)?.heightM ?? 0;
    const oakId = climaxLater[0]?.speciesId;
    if (oakId && frames[0].plants.some((plant) => plant.speciesId === oakId && plant.active)) {
      expect(tallest(frames[2], oakId)).toBeGreaterThan(tallest(frames[0], oakId));
    }
    const view = profileViewBox(frames[2]);
    const plant = frames[2].plants[0];
    const screen = plantScreenPosition(frames[2], plant, view);
    expect(canopyPath(plant, screen).startsWith('M ')).toBe(true);
    expect(trunkPath(plant, screen).startsWith('M ')).toBe(true);
    expect(frames[0].heightM).toBe(frames[2].heightM);
  });
});
