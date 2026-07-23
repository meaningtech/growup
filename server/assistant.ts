import { randomUUID } from 'node:crypto';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { rankSpecies } from '../src/lib/recommendations.js';
import type { AssistantAction, AssistantProjectContext, AssistantProposal, DesignSpecies } from '../src/types.js';

const DEFAULT_PROVIDER_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_PROVIDER_MODEL = 'deepseek-v4-pro';
const SECTIONS = new Set(['site', 'profile', 'species', 'layout', 'water', 'costs']);

export type AssistantProviderConfig = {
  aiProviderApiKey?: string;
  aiProviderBaseUrl?: string;
  aiProviderModel?: string;
  aiProviderTimeoutMs?: number;
  aiProviderMaxAttempts?: number;
  aiProviderRetryDelayMs?: number;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  fetchImpl?: typeof fetch;
};

type OpenAiCompatibleResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; reasoning_content?: string | null };
  }>;
};

export function assistantStatus(config: AssistantProviderConfig = {}) {
  return {
    configured: Boolean(apiKey(config)),
    interface: 'openai-compatible' as const,
  };
}

export async function planAssistantAction(
  message: string,
  context: AssistantProjectContext,
  config: AssistantProviderConfig = {},
): Promise<AssistantProposal> {
  const key = apiKey(config);
  if (!key) throw assistantError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'Set AI_PROVIDER_API_KEY on the Growup server to enable the internal assistant.');
  const cleanMessage = message.trim();
  if (!cleanMessage || cleanMessage.length > 2_000) throw assistantError(400, 'INVALID_ASSISTANT_MESSAGE', 'The assistant message must contain 1–2,000 characters.');
  const model = providerModel(config);
  const baseUrl = providerBaseUrl(config).replace(/\/$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = integerSetting(config.aiProviderTimeoutMs, process.env.AI_PROVIDER_TIMEOUT_MS, 25_000, 1_000, 60_000);
  const maxAttempts = integerSetting(config.aiProviderMaxAttempts, process.env.AI_PROVIDER_MAX_ATTEMPTS, 2, 1, 3);
  const retryDelayMs = integerSetting(config.aiProviderRetryDelayMs, process.env.AI_PROVIDER_RETRY_DELAY_MS, 250, 0, 5_000);
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: JSON.stringify({ request: cleanMessage, project: compactContext(context), availableSpecies: availableSpecies(context) }) },
    ],
    response_format: { type: 'json_object' },
    ...structuredOutputProviderOptions(baseUrl, model),
    temperature: 0.2,
    max_tokens: 2_500,
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null) as OpenAiCompatibleResponse | { error?: { message?: string } } | null;
      if (!response.ok) {
        const providerMessage = payload && 'error' in payload ? payload.error?.message : null;
        const retryable = response.status === 429 || response.status >= 500;
        throw assistantError(502, 'AI_PROVIDER_ERROR', boundedProviderMessage(providerMessage) || `The configured AI provider returned ${response.status}.`, retryable);
      }
      const content = payload && 'choices' in payload ? payload.choices?.[0]?.message?.content?.trim() : '';
      if (!content) throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider returned an empty JSON response.', true);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider returned invalid JSON.', true);
      }
      try {
        return validateProposal(parsed, context, model);
      } catch (error) {
        if (isAssistantError(error)) throw error;
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', error instanceof Error ? error.message : 'The configured AI provider returned an invalid response.');
      }
    } catch (error) {
      const normalized = isTimeoutError(error)
        ? assistantError(504, 'AI_PROVIDER_TIMEOUT', `The configured AI provider did not respond within ${timeoutMs} ms.`, true)
        : isAssistantError(error)
          ? error
          : assistantError(502, 'AI_PROVIDER_UNAVAILABLE', 'The configured AI provider could not be reached.', true);
      if (!normalized.retryable) throw normalized;
      lastError = normalized;
      if (attempt + 1 < maxAttempts && retryDelayMs > 0) await delay(retryDelayMs * (attempt + 1));
    }
  }
  if (isAssistantError(lastError)) throw lastError;
  throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', lastError instanceof Error ? lastError.message : 'The configured AI provider returned an invalid response.');
}

function systemPrompt() {
  return `You are the internal Growup agroforestry planning assistant. Reply in the user's language. Return JSON only.
Never invent species IDs, project values, field observations or costs. Use only availableSpecies and project.
Explain uncertainty briefly. Proposed changes are not executed automatically and must be confirmed.
If adding or removing species when a layout exists, also propose regenerate_layout and recalculate_water_and_costs.
Do not propose blocked or invasive species. Respect the minimum palette size for the selected design system.
Allowed action JSON shapes:
{"type":"add_species","speciesIds":["id"]}
{"type":"remove_species","speciesIds":["id"]}
{"type":"select_variant","variantId":"id"}
{"type":"set_timeline_year","year":0}
{"type":"regenerate_layout"}
{"type":"recalculate_water_and_costs"}
{"type":"navigate","section":"site|profile|species|layout|water|costs"}
Required response JSON shape:
{"summary":"short answer","rationale":"grounded explanation","warnings":["warning"],"actions":[]}`;
}

function compactContext(context: AssistantProjectContext) {
  const profile = context.siteProfile;
  return {
    section: context.section,
    site: context.site ? { id: context.site.id, name: context.site.name } : null,
    location: profile?.location.displayName ?? null,
    areaM2: profile?.areaM2 ?? null,
    terrain: profile ? { elevationM: profile.terrain.elevationMeanM, slopePercent: profile.terrain.slopePercent, aspect: profile.terrain.aspectLabel } : null,
    climate: profile ? { rainMm: profile.climate.annualPrecipitationMm, et0Mm: profile.climate.annualEt0Mm, minC: profile.climate.absoluteMinTemperatureC, maxC: profile.climate.absoluteMaxTemperatureC } : null,
    soil: profile?.soil ?? null,
    existingVegetation: profile?.satellite.existingVegetation ?? null,
    selectedSpeciesIds: context.selectedSpeciesIds,
    designConfiguration: context.designConfiguration,
    variants: context.variants,
    selectedVariantId: context.selectedVariantId,
    timelineYear: context.timelineYear,
    irrigation: context.irrigation ? {
      annualWaterM3: context.irrigation.annualWaterM3,
      annualOperationCost: context.irrigation.annualOperation.totalCost,
      currencyCode: context.irrigation.economics.currencyCode,
      adjustmentPercent: context.irrigation.satelliteScheduling.adjustmentPercent,
      maintenance: context.irrigation.systemMaintenance ? {
        year: context.irrigation.systemMaintenance.year,
        phase: context.irrigation.systemMaintenance.phase,
        personHours: context.irrigation.systemMaintenance.totalHours,
        laborCost: context.irrigation.systemMaintenance.totalCost,
        tasks: context.irrigation.systemMaintenance.tasks.map((task) => ({ id: task.id, personHours: task.hours, cost: task.cost })),
        exclusions: context.irrigation.systemMaintenance.exclusions,
      } : null,
    } : null,
    costs: context.costs ? { totalCost: context.costs.totalCost, plantCost: context.costs.plantPurchaseCost, currencyCode: context.costs.economics.currencyCode, laborHours: context.costs.plantingLaborHours } : null,
  };
}

function availableSpecies(context: AssistantProjectContext) {
  const ranking = context.siteProfile ? new Map(rankSpecies(DESIGN_SPECIES, context.siteProfile, context.designConfiguration.objectives).map((item) => [item.species.id, item])) : new Map();
  return DESIGN_SPECIES.filter((species) => species.invasiveStatus !== 'blocked').map((species) => {
    const recommendation = ranking.get(species.id);
    return {
      id: species.id,
      scientificName: species.scientificName,
      commonName: species.commonName,
      stratum: species.stratum,
      succession: species.succession,
      roles: species.roles,
      droughtTolerance: species.droughtTolerance,
      selected: context.selectedSpeciesIds.includes(species.id),
      siteScore: recommendation?.score ?? null,
      siteStatus: recommendation?.status ?? 'not-profiled',
      reasons: recommendation?.reasons.slice(0, 3) ?? [],
    };
  });
}

function validateProposal(value: unknown, context: AssistantProjectContext, model: string): AssistantProposal {
  if (!value || typeof value !== 'object') throw new Error('Assistant response is not a JSON object.');
  const raw = value as Record<string, unknown>;
  const rawActions = Array.isArray(raw.actions) ? raw.actions.slice(0, 12) : [];
  const actions = rawActions.map((action) => validateAction(action, context));
  const projected = new Set(context.selectedSpeciesIds);
  for (const action of actions) {
    if (action.type === 'add_species') action.speciesIds.forEach((id) => projected.add(id));
    if (action.type === 'remove_species') action.speciesIds.forEach((id) => projected.delete(id));
  }
  const minimumSpecies = context.designConfiguration?.system === 'syntropic' ? 3 : context.designConfiguration?.system === 'monoculture' ? 1 : 2;
  if (projected.size < minimumSpecies) throw assistantError(422, 'ASSISTANT_UNSAFE_ACTION', `The proposed changes would leave fewer than ${minimumSpecies} selected species.`);
  const summary = textValue(raw.summary, 'I reviewed the current Growup project.');
  const rationale = textValue(raw.rationale, 'The proposal uses the current site profile and design-ready species catalogue.');
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  return { id: randomUUID(), model, summary, rationale, warnings, actions, requiresConfirmation: actions.length > 0 };
}

function validateAction(value: unknown, context: AssistantProjectContext): AssistantAction {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('Assistant proposed an invalid action.');
  const raw = value as Record<string, unknown>;
  if (raw.type === 'add_species' || raw.type === 'remove_species') {
    const requested = Array.isArray(raw.speciesIds) ? raw.speciesIds : [];
    const speciesIds = Array.from(new Set(requested.map((item) => resolveSpeciesId(String(item))))).filter((item): item is string => Boolean(item));
    if (!speciesIds.length) throw new Error(`Assistant proposed ${raw.type} without valid species.`);
    return { type: raw.type, speciesIds };
  }
  if (raw.type === 'select_variant') {
    const variantId = String(raw.variantId ?? '');
    if (!context.variants.some((variant) => variant.id === variantId)) throw new Error(`Unknown layout variant ${variantId}.`);
    return { type: 'select_variant', variantId };
  }
  if (raw.type === 'set_timeline_year') {
    const year = Math.round(Number(raw.year));
    if (!Number.isFinite(year) || year < 0 || year > 30) throw new Error('Timeline year must be between 0 and 30.');
    return { type: 'set_timeline_year', year };
  }
  if (raw.type === 'regenerate_layout' || raw.type === 'recalculate_water_and_costs') return { type: raw.type };
  if (raw.type === 'navigate') {
    const section = String(raw.section ?? '');
    if (!SECTIONS.has(section)) throw new Error(`Unknown workspace section ${section}.`);
    return { type: 'navigate', section: section as AssistantProjectContext['section'] };
  }
  throw new Error(`Unsupported assistant action ${raw.type}.`);
}

function resolveSpeciesId(value: string) {
  const normalized = normalize(value);
  const species = DESIGN_SPECIES.find((candidate) => (
    normalize(candidate.id) === normalized || normalize(candidate.scientificName) === normalized || normalize(candidate.commonName) === normalized
  ));
  return species && species.invasiveStatus !== 'blocked' ? species.id : null;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('en').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function textValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1_500) : fallback;
}

function apiKey(config: AssistantProviderConfig) {
  return config.aiProviderApiKey ?? process.env.AI_PROVIDER_API_KEY ?? config.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
}

function providerBaseUrl(config: AssistantProviderConfig) {
  return config.aiProviderBaseUrl ?? process.env.AI_PROVIDER_BASE_URL ?? config.deepseekBaseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_PROVIDER_BASE_URL;
}

function providerModel(config: AssistantProviderConfig) {
  return config.aiProviderModel ?? process.env.AI_PROVIDER_MODEL ?? config.deepseekModel ?? process.env.DEEPSEEK_MODEL ?? DEFAULT_PROVIDER_MODEL;
}

function structuredOutputProviderOptions(baseUrl: string, model: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLocaleLowerCase('en');
    if (hostname === 'api.deepseek.com' || model.toLocaleLowerCase('en').startsWith('deepseek-v4')) {
      return { thinking: { type: 'disabled' as const } };
    }
  } catch {
    return {};
  }
  return {};
}

function integerSetting(configured: number | undefined, environmental: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = configured ?? Number(environmental);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(Number(value)))) : fallback;
}

function boundedProviderMessage(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : '';
}

function isTimeoutError(value: unknown) {
  return value instanceof Error && (value.name === 'TimeoutError' || value.name === 'AbortError');
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function assistantError(code: number, status: string, message: string, retryable = false) {
  return { code, status, message, retryable };
}

function isAssistantError(value: unknown): value is { code: number; status: string; message: string; retryable?: boolean } {
  return Boolean(value && typeof value === 'object' && 'code' in value && typeof value.code === 'number' && 'status' in value && typeof value.status === 'string' && 'message' in value && typeof value.message === 'string');
}
