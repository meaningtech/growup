import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  isOnboardingLocationReady,
  latestOnboardingPreference,
  newOnboardingPreference,
  normalizeOnboardingPreference,
  readOnboardingPreference,
  writeOnboardingPreference,
} from './onboarding';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => key === ONBOARDING_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === ONBOARDING_STORAGE_KEY) value = next; },
    removeItem: (key: string) => { if (key === ONBOARDING_STORAGE_KEY) value = null; },
  };
}

describe('onboarding persistence', () => {
  it('creates, stores and restores a resumable project setup', () => {
    const storage = memoryStorage();
    const preference = { ...newOnboardingPreference(new Date('2026-07-22T09:00:00.000Z')), step: 'location' as const, projectName: 'Food forest north field' };
    writeOnboardingPreference(storage, preference);
    expect(readOnboardingPreference(storage)).toEqual(preference);
  });

  it('requires an explicit local place and parcel-scale zoom before boundary drawing', () => {
    expect(isOnboardingLocationReady(false, 18)).toBe(false);
    expect(isOnboardingLocationReady(true, null)).toBe(false);
    expect(isOnboardingLocationReady(true, 11.9)).toBe(false);
    expect(isOnboardingLocationReady(true, 12)).toBe(true);
  });

  it('uses the newest authenticated or browser checkpoint', () => {
    const local = { status: 'active' as const, step: 'boundary' as const, updatedAt: '2026-07-22T10:00:00.000Z' };
    const remote = { status: 'completed' as const, step: 'complete' as const, updatedAt: '2026-07-22T11:00:00.000Z' };
    expect(latestOnboardingPreference(local, remote)).toEqual(remote);
    expect(latestOnboardingPreference({ ...local, updatedAt: '2026-07-22T12:00:00.000Z' }, remote)?.step).toBe('boundary');
  });

  it('rejects malformed persisted state', () => {
    const storage = memoryStorage('{"status":"active","step":"unknown"}');
    expect(readOnboardingPreference(storage)).toBeNull();
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(normalizeOnboardingPreference({ status: 'active', step: 'location', updatedAt: 'invalid' })).toBeNull();
  });
});
