import type { DesignSpecies, SiteProfile } from '../types';

export type SiteNativeness = {
  score: number | null;
  verified: boolean;
  explanation: string;
};

export function siteNativeness(species: DesignSpecies, site: Pick<SiteProfile, 'location'>): SiteNativeness {
  const countryCode = site.location?.countryCode ?? null;
  const jurisdiction = countryCode ?? site.location?.displayName ?? 'the selected country';
  return {
    score: null,
    verified: false,
    explanation: `Jurisdiction-level native-range evidence is not available in the current catalogue for ${jurisdiction}; verify against local flora and invasive-species authorities before procurement.`,
  };
}
