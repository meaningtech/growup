import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n';

describe('Growup translations', () => {
  it('keeps the English and Italian dictionaries in exact key parity', () => {
    expect(Object.keys(dictionaries.it).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('defines every literal translation key used by the application', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const keys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);
    const missing = [...new Set(keys)].filter((key) => !dictionaries.en[key] || !dictionaries.it[key]);
    expect(missing).toEqual([]);
  });
});
