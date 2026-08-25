import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n';

describe('Growup translations', () => {
  it('keeps the English and Italian dictionaries in exact key parity', () => {
    expect(Object.keys(dictionaries.it).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('teaches planting rows and independent NASA layers in the guided tour', () => {
    expect(dictionaries.en['onboarding.speciesBody']).toMatch(/Draw a planting row/);
    expect(dictionaries.it['onboarding.speciesBody']).toMatch(/Disegna una fila di piantumazione/);
    expect(dictionaries.en['onboarding.designBody']).toMatch(/Draw a planting row/);
    expect(dictionaries.it['onboarding.designBody']).toMatch(/Disegna una fila di piantumazione/);
    expect(dictionaries.en['onboarding.analysisBody']).toMatch(/Map layers/);
    expect(dictionaries.it['onboarding.analysisBody']).toMatch(/Layer della mappa/);
    expect(dictionaries.en['onboarding.analysisBody']).toMatch(/do not replace Sentinel/);
    expect(dictionaries.it['onboarding.analysisBody']).toMatch(/non sostituiscono Sentinel/);
    expect(dictionaries.en['onboarding.fireBody']).toMatch(/NASA FIRMS/);
    expect(dictionaries.it['onboarding.fireBody']).toMatch(/NASA FIRMS/);
  });

  it('defines every literal translation key used by the application', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const keys = [...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);
    const missing = [...new Set(keys)].filter((key) => !dictionaries.en[key] || !dictionaries.it[key]);
    expect(missing).toEqual([]);
  });
});
