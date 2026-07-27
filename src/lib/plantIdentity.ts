import type { TreeInstance } from '../types';

export function plantingRowLabel(rowIndex: number): string {
  let value = Math.max(0, Math.floor(rowIndex)) + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function plantPositionCode(tree: Pick<TreeInstance, 'rowIndex' | 'positionIndex'>): string {
  return `${plantingRowLabel(tree.rowIndex)}${Math.max(0, Math.floor(tree.positionIndex)) + 1}`;
}

export function plantSpeciesInitials(displayName: string, locale = 'en'): string {
  return (displayName.match(/\p{L}/gu) ?? []).slice(0, 2).join('').toLocaleUpperCase(locale);
}

export function plantMarkerLabelColor(color: string): '#ffffff' | '#17351f' {
  const match = color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return '#17351f';
  const luminance = Number.parseInt(match[1], 16) * 0.299
    + Number.parseInt(match[2], 16) * 0.587
    + Number.parseInt(match[3], 16) * 0.114;
  return luminance < 142 ? '#ffffff' : '#17351f';
}
