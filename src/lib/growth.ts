import type { DesignSpecies, GrowthState, TreeInstance } from '../types';
import { stableHash } from './geometry';

export function growthState(species: DesignSpecies, tree: TreeInstance, year: number): GrowthState {
  const age = Math.max(0, year - tree.plantedYear);
  const active = year >= tree.plantedYear && (tree.removedYear === null || year < tree.removedYear);

  if (!active) return { year, heightM: 0, crownDiameterM: 0, active: false };

  const height = richards(species.initialHeightM, species.matureHeightM, species.growthRate, species.growthShape, age);
  const crownInitial = Math.min(1.1, Math.max(0.45, species.initialHeightM * 0.62));
  let crown = richards(crownInitial, species.matureCrownDiameterM, species.growthRate * 0.92, species.growthShape, age);

  if (species.succession === 'placenta' && age > 0 && age % 3 === 0) crown *= 0.58;

  return {
    year,
    heightM: Number(height.toFixed(2)),
    crownDiameterM: Number(crown.toFixed(2)),
    active: true,
  };
}

export function crownPath(species: DesignSpecies, tree: TreeInstance, year: number, scalePxPerM: number): string {
  const state = growthState(species, tree, year);
  if (!state.active) return '';
  const radius = Math.max(3, (state.crownDiameterM / 2) * scalePxPerM);
  const vertices = 18 + (tree.seed % 9);
  const points: string[] = [];
  const archetypeScale = crownScale(species.crown);

  for (let index = 0; index < vertices; index += 1) {
    const angle = (Math.PI * 2 * index) / vertices;
    const noise = seededUnit(tree.seed + index * 97) * 0.26 + 0.87;
    const x = Math.cos(angle) * radius * noise * archetypeScale.x;
    const y = Math.sin(angle) * radius * noise * archetypeScale.y;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return `M ${points.join(' L ')} Z`;
}

export function crownSvgDataUrl(species: DesignSpecies, tree: TreeInstance, year: number, pixels = 52): string {
  const state = growthState(species, tree, year);
  const scale = state.crownDiameterM > 0 ? (pixels * 0.42) / (state.crownDiameterM / 2) : 1;
  const path = crownPath(species, tree, year, scale);
  const opacity = species.evergreen ? 0.82 : 0.76;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="${-pixels / 2} ${-pixels / 2} ${pixels} ${pixels}"><path d="${path}" fill="${species.color}" fill-opacity="${opacity}" stroke="#f1efd9" stroke-opacity=".72" stroke-width="1"/><circle r="1.5" fill="#443824"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function deterministicTreeSeed(id: string): number {
  return stableHash(id);
}

function richards(initial: number, mature: number, rate: number, shape: number, age: number): number {
  if (mature <= initial) return mature;
  const initialRatio = Math.min(0.999, Math.max(0.0001, initial / mature));
  const offset = -Math.log(1 - initialRatio ** (1 / shape)) / rate;
  return mature * (1 - Math.exp(-rate * (age + offset))) ** shape;
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

function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}
