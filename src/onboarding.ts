export type OnboardingStep = 'welcome' | 'location' | 'boundary' | 'analysis' | 'species' | 'design' | 'complete';

export type OnboardingPreference = {
  status: 'active' | 'skipped' | 'completed';
  step: OnboardingStep;
  updatedAt: string;
  projectName?: string;
};

export const ONBOARDING_STORAGE_KEY = 'growup:onboarding:v1';
export const MIN_ONBOARDING_LOCATION_ZOOM = 12;

export function isOnboardingLocationReady(locationSelected: boolean, mapZoom: number | null): boolean {
  return locationSelected && mapZoom !== null && Number.isFinite(mapZoom) && mapZoom >= MIN_ONBOARDING_LOCATION_ZOOM;
}

export function newOnboardingPreference(now = new Date()): OnboardingPreference {
  return { status: 'active', step: 'welcome', updatedAt: now.toISOString() };
}

export function readOnboardingPreference(storage: Pick<Storage, 'getItem' | 'removeItem'>): OnboardingPreference | null {
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const preference = normalizeOnboardingPreference(parsed);
    if (!preference) storage.removeItem(ONBOARDING_STORAGE_KEY);
    return preference;
  } catch {
    storage.removeItem(ONBOARDING_STORAGE_KEY);
    return null;
  }
}

export function writeOnboardingPreference(storage: Pick<Storage, 'setItem'>, preference: OnboardingPreference) {
  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(preference));
}

export function latestOnboardingPreference(local: OnboardingPreference | null, remote: OnboardingPreference | null): OnboardingPreference | null {
  if (!local) return remote;
  if (!remote) return local;
  return Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt) ? local : remote;
}

export function normalizeOnboardingPreference(value: unknown): OnboardingPreference | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<OnboardingPreference>;
  const statuses: OnboardingPreference['status'][] = ['active', 'skipped', 'completed'];
  const steps: OnboardingStep[] = ['welcome', 'location', 'boundary', 'analysis', 'species', 'design', 'complete'];
  if (!statuses.includes(candidate.status as OnboardingPreference['status']) || !steps.includes(candidate.step as OnboardingStep) || Number.isNaN(Date.parse(String(candidate.updatedAt)))) return null;
  if (candidate.projectName !== undefined && (typeof candidate.projectName !== 'string' || candidate.projectName.length > 120)) return null;
  return { status: candidate.status!, step: candidate.step!, updatedAt: candidate.updatedAt!, ...(candidate.projectName ? { projectName: candidate.projectName } : {}) };
}
