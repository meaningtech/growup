import type { DesignSpecies, LayoutVariant, SuccessionPhase, TreeInstance } from '../types';
import { createLocalProjection } from './geometry';
import { growthState } from './growth';
import { plantingRowLabel, plantPositionCode } from './plantIdentity';
import { effectiveSuccession } from './speciesPlan';

export const SUCCESSION_PROFILE_YEARS = [1, 5, 10, 20, 30] as const;

export const STRATUM_BANDS: Array<{ id: DesignSpecies['stratum']; fromM: number; toM: number }> = [
  { id: 'ground', fromM: 0, toM: 1.5 },
  { id: 'low', fromM: 1.5, toM: 4 },
  { id: 'medium', fromM: 4, toM: 8 },
  { id: 'high', fromM: 8, toM: 16 },
  { id: 'emergent', fromM: 16, toM: 28 },
];

export type SuccessionProfilePlant = {
  treeId: string;
  plantCode: string;
  speciesId: string;
  scientificName: string;
  color: string;
  succession: SuccessionPhase;
  stratum: DesignSpecies['stratum'];
  crown: DesignSpecies['crown'];
  evergreen: boolean;
  seed: number;
  distanceM: number;
  heightM: number;
  crownDiameterM: number;
  crownScaleX: number;
  crownScaleY: number;
  active: boolean;
};

export type SuccessionRowProfile = {
  rowIndex: number;
  rowLabel: string;
  year: number;
  lengthM: number;
  heightM: number;
  plants: SuccessionProfilePlant[];
};

export function listProfileRows(trees: TreeInstance[]): number[] {
  return Array.from(new Set(trees.map((tree) => tree.rowIndex))).sort((a, b) => a - b);
}

export function chooseProfileRow(trees: TreeInstance[], selectedTreeId?: string | null): number {
  const selected = selectedTreeId ? trees.find((tree) => tree.id === selectedTreeId) : null;
  if (selected) return selected.rowIndex;
  const rows = listProfileRows(trees);
  if (!rows.length) return 0;
  return rows.reduce((best, rowIndex) => {
    const count = trees.filter((tree) => tree.rowIndex === rowIndex).length;
    const bestCount = trees.filter((tree) => tree.rowIndex === best).length;
    return count > bestCount ? rowIndex : best;
  }, rows[0]);
}

export function buildRowProfile(
  variant: LayoutVariant,
  species: DesignSpecies[],
  year: number,
  rowIndex: number,
): SuccessionRowProfile {
  const library = new Map(species.map((item) => [item.id, item]));
  const mix = variant.design.speciesMix;
  const row = variant.trees
    .filter((tree) => tree.rowIndex === rowIndex)
    .sort((a, b) => a.positionIndex - b.positionIndex || a.id.localeCompare(b.id));
  const distances = distancesAlongRow(row);
  const plants = row.flatMap((tree, index): SuccessionProfilePlant[] => {
    const item = library.get(tree.speciesId);
    if (!item) return [];
    const growth = growthState(item, tree, year);
    const lastLiveYear = tree.removedYear !== null ? Math.max(tree.plantedYear, tree.removedYear - 1) : year;
    const display = growth.active ? growth : growthState(item, { ...tree, removedYear: null }, lastLiveYear);
    if (display.heightM <= 0 && !growth.active) return [];
    const scale = crownScale(item.crown);
    return [{
      treeId: tree.id,
      plantCode: plantPositionCode(tree),
      speciesId: item.id,
      scientificName: item.scientificName,
      color: item.color,
      succession: effectiveSuccession(item, mix),
      stratum: item.stratum,
      crown: item.crown,
      evergreen: item.evergreen,
      seed: tree.seed,
      distanceM: distances[index] ?? 0,
      heightM: Math.max(0.2, display.heightM),
      crownDiameterM: Math.max(0.3, display.crownDiameterM),
      crownScaleX: scale.x,
      crownScaleY: scale.y,
      active: growth.active,
    }];
  });
  const lengthM = plants.reduce((maximum, plant) => Math.max(maximum, plant.distanceM + plant.crownDiameterM / 2), 0);
  const heightM = plants.reduce((maximum, plant) => Math.max(maximum, plant.heightM), 0);
  return {
    rowIndex,
    rowLabel: plantingRowLabel(rowIndex),
    year,
    lengthM: Math.max(8, lengthM),
    heightM: Math.max(6, heightM),
    plants,
  };
}

export type SuccessionViewBox = {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  scaleX: number;
  scaleY: number;
};

export function sharedProfileScale(profiles: SuccessionRowProfile[]): { heightM: number; lengthM: number } {
  return {
    heightM: Math.max(8, ...profiles.map((profile) => profile.heightM)),
    lengthM: Math.max(10, ...profiles.map((profile) => profile.lengthM)),
  };
}

export function withSharedScale(profile: SuccessionRowProfile, scale: { heightM: number; lengthM: number }): SuccessionRowProfile {
  return { ...profile, heightM: scale.heightM, lengthM: scale.lengthM };
}

export function profileViewBox(profile: SuccessionRowProfile, width = 720, height = 320): SuccessionViewBox {
  const padLeft = 44;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 36;
  const usableWidth = Math.max(1, width - padLeft - padRight);
  const usableHeight = Math.max(1, height - padTop - padBottom);
  return {
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    scaleX: usableWidth / profile.lengthM,
    scaleY: usableHeight / profile.heightM,
  };
}

export function plantScreenPosition(profile: SuccessionRowProfile, plant: SuccessionProfilePlant, view: SuccessionViewBox) {
  const groundY = view.height - view.padBottom;
  const cx = view.padLeft + (plant.distanceM + plant.crownDiameterM * 0.08) * view.scaleX;
  const crownRx = Math.max(4, (plant.crownDiameterM / 2) * view.scaleX * plant.crownScaleX);
  const crownRy = Math.max(6, (plant.heightM * 0.48) * view.scaleY * plant.crownScaleY);
  const topY = groundY - plant.heightM * view.scaleY;
  const trunkWidth = Math.max(1.4, Math.min(9, plant.heightM * 0.045 * view.scaleX + 1.1));
  return {
    cx,
    groundY,
    topY,
    trunkY: Math.min(groundY - 4, topY + crownRy * 1.72),
    trunkWidth,
    crownRx,
    crownRy,
    crownCy: topY + crownRy * 0.92,
  };
}

export function trunkPath(plant: SuccessionProfilePlant, screen: ReturnType<typeof plantScreenPosition>): string {
  const lean = (seededUnit(plant.seed + 3) - 0.5) * screen.trunkWidth * 0.45;
  const top = screen.trunkWidth * 0.34;
  const base = screen.trunkWidth * 0.52;
  return `M ${screen.cx - base} ${screen.groundY} L ${screen.cx - top + lean} ${screen.trunkY} L ${screen.cx + top + lean} ${screen.trunkY} L ${screen.cx + base} ${screen.groundY} Z`;
}

export function canopyPath(plant: SuccessionProfilePlant, screen: ReturnType<typeof plantScreenPosition>): string {
  const points = canopyPoints(plant, screen);
  if (points.length < 3) return '';
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  return `${path} Z`;
}

export function heightTicks(heightM: number): number[] {
  const step = heightM > 20 ? 5 : heightM > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let value = 0; value <= heightM + 0.01; value += step) ticks.push(value);
  return ticks;
}

function canopyPoints(plant: SuccessionProfilePlant, screen: ReturnType<typeof plantScreenPosition>) {
  const count = plant.crown === 'columnar' ? 13 : 16;
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    let radiusX = screen.crownRx;
    let radiusY = screen.crownRy;
    if (plant.crown === 'columnar') {
      radiusX *= 0.62;
      radiusY *= 1.12;
      const lift = (Math.sin(angle) + 1) / 2;
      radiusX *= 0.55 + lift * 0.7;
    } else if (plant.crown === 'umbrella') {
      radiusX *= 1.18;
      radiusY *= 0.72;
      if (Math.sin(angle) < -0.15) radiusY *= 0.55;
    } else if (plant.crown === 'weeping') {
      radiusX *= 0.95;
      radiusY *= 1.12;
      if (Math.sin(angle) > 0.2) radiusY *= 1.18;
    } else if (plant.crown === 'shrub') {
      radiusX *= 1.12;
      radiusY *= 0.78;
    } else if (plant.crown === 'oval') {
      radiusX *= 0.82;
      radiusY *= 1.08;
    }
    const lobe = plant.crown === 'irregular' ? 1 + Math.sin(angle * 3 + plant.seed) * 0.08 : 1;
    const wobble = 0.86 + seededUnit(plant.seed * 13 + index * 19) * 0.28;
    points.push({
      x: screen.cx + Math.cos(angle) * radiusX * wobble * lobe,
      y: screen.crownCy + Math.sin(angle) * radiusY * wobble * lobe,
    });
  }
  return points;
}

function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}

export function buildSuccessionFrames(
  variant: LayoutVariant,
  species: DesignSpecies[],
  rowIndex: number,
  years: readonly number[] = SUCCESSION_PROFILE_YEARS,
): SuccessionRowProfile[] {
  const mature = buildRowProfile(variant, species, Math.max(...years), rowIndex);
  const frames = years.map((year) => buildRowProfile(variant, species, year, rowIndex));
  const scale = sharedProfileScale([...frames, mature]);
  return frames.map((frame) => withSharedScale(frame, scale));
}

function distancesAlongRow(trees: TreeInstance[]): number[] {
  if (!trees.length) return [];
  const origin = trees[0].coordinate;
  const projection = createLocalProjection(origin);
  const start = projection.project(origin);
  const last = projection.project(trees[trees.length - 1].coordinate);
  const axisX = last.x - start.x;
  const axisY = last.y - start.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength < 0.2) {
    return trees.map((tree, index) => index === 0 ? 0 : Math.hypot(
      projection.project(tree.coordinate).x - start.x,
      projection.project(tree.coordinate).y - start.y,
    ));
  }
  const ux = axisX / axisLength;
  const uy = axisY / axisLength;
  const raw = trees.map((tree) => {
    const point = projection.project(tree.coordinate);
    return (point.x - start.x) * ux + (point.y - start.y) * uy;
  });
  const minimum = Math.min(...raw);
  return raw.map((value) => value - minimum);
}

function crownScale(archetype: DesignSpecies['crown']) {
  if (archetype === 'columnar') return { x: 0.48, y: 1 };
  if (archetype === 'oval') return { x: 0.78, y: 1 };
  if (archetype === 'umbrella') return { x: 1, y: 0.68 };
  if (archetype === 'weeping') return { x: 0.9, y: 1.08 };
  if (archetype === 'shrub') return { x: 1, y: 0.82 };
  if (archetype === 'irregular') return { x: 1.04, y: 0.88 };
  return { x: 1, y: 1 };
}
