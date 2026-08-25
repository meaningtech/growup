import { randomUUID } from 'node:crypto';
import { DESIGN_SPECIES } from '../src/data/designSpecies.js';
import { projectAnalysisFingerprint } from '../src/lib/projectAnalysis.js';
import { rankSpecies } from '../src/lib/recommendations.js';
import type {
  AssistantAction,
  AssistantProjectContext,
  AssistantProposal,
  DesignSpecies,
  ProjectAnalysisDimension,
  ProjectAnalysisDimensionId,
  ProjectAnalysisFinding,
  ProjectAnalysisReport,
} from '../src/types.js';

const DEFAULT_PROVIDER_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_PROVIDER_MODEL = 'deepseek-v4-pro';
const SECTIONS = new Set(['site', 'profile', 'species', 'layout', 'water', 'fire', 'costs', 'analysis', 'care']);
const REVIEW_DIMENSIONS: ProjectAnalysisDimensionId[] = ['evidence', 'species', 'design', 'water', 'fire', 'operations', 'economics', 'coherence'];

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
  let repairStructuredOutput = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(providerRequestBody(requestBody, baseUrl, model, repairStructuredOutput)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null) as OpenAiCompatibleResponse | { error?: { message?: string } } | null;
      if (!response.ok) {
        const providerMessage = payload && 'error' in payload ? payload.error?.message : null;
        const retryable = response.status === 429 || response.status >= 500;
        throw assistantError(502, 'AI_PROVIDER_ERROR', boundedProviderMessage(providerMessage) || `The configured AI provider returned ${response.status}.`, retryable);
      }
      const content = payload && 'choices' in payload ? payload.choices?.[0]?.message?.content?.trim() : '';
      if (!content) {
        repairStructuredOutput = true;
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider returned an empty JSON response.', true);
      }
      let parsed: unknown;
      try {
        parsed = parseJsonResponse(content);
      } catch {
        repairStructuredOutput = true;
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

export async function reviewAssistantProject(
  context: AssistantProjectContext,
  locale: 'en' | 'it',
  config: AssistantProviderConfig = {},
): Promise<ProjectAnalysisReport> {
  const key = apiKey(config);
  if (!key) throw assistantError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'Set AI_PROVIDER_API_KEY on the Growup server to enable the internal assistant.');
  const model = providerModel(config);
  const baseUrl = providerBaseUrl(config).replace(/\/$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = integerSetting(config.aiProviderTimeoutMs, process.env.AI_PROVIDER_TIMEOUT_MS, 60_000, 1_000, 120_000);
  const maxAttempts = integerSetting(config.aiProviderMaxAttempts, process.env.AI_PROVIDER_MAX_ATTEMPTS, 2, 1, 3);
  const retryDelayMs = integerSetting(config.aiProviderRetryDelayMs, process.env.AI_PROVIDER_RETRY_DELAY_MS, 250, 0, 5_000);
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: formalReviewSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Perform the formal final review of this Growup project.',
          responseLanguage: locale === 'it' ? 'Italian' : 'English',
          project: compactContext(context),
          selectedSpecies: selectedSpeciesForReview(context),
        }),
      },
    ],
    response_format: { type: 'json_object' },
    ...structuredOutputProviderOptions(baseUrl, model),
    temperature: 0.1,
    max_tokens: 5_000,
  };

  let lastError: unknown = null;
  let repairStructuredOutput = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(providerRequestBody(requestBody, baseUrl, model, repairStructuredOutput)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null) as OpenAiCompatibleResponse | { error?: { message?: string } } | null;
      if (!response.ok) {
        const providerMessage = payload && 'error' in payload ? payload.error?.message : null;
        const retryable = response.status === 429 || response.status >= 500;
        throw assistantError(502, 'AI_PROVIDER_ERROR', boundedProviderMessage(providerMessage) || `The configured AI provider returned ${response.status}.`, retryable);
      }
      const content = payload && 'choices' in payload ? payload.choices?.[0]?.message?.content?.trim() : '';
      if (!content) {
        repairStructuredOutput = true;
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider returned an empty JSON response.', true);
      }
      let parsed: unknown;
      try {
        parsed = parseJsonResponse(content);
      } catch {
        repairStructuredOutput = true;
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider returned invalid JSON.', true);
      }
      try {
        return validateFormalReview(parsed, context, model);
      } catch (error) {
        throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', error instanceof Error ? error.message : 'The configured AI provider returned an invalid formal review.');
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
  throw assistantError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'The configured AI provider did not return a formal review.');
}

function systemPrompt() {
  return `You are the internal Growup agroforestry planning assistant. Reply in the user's language. Return JSON only.
Never invent species IDs, project values, field observations or costs. Use only availableSpecies and project.
Explain uncertainty briefly. Proposed changes are not executed automatically and must be confirmed.
Never claim that a field check, permit, missing evidence or physical operation is resolved by a software action.
If adding or removing species when a layout exists, also propose regenerate_layout and recalculate_water_and_costs.
If changing species mix, design spacing, machinery or firebreak parameters, also propose regenerate_layout and recalculate_water_and_costs.
If changing irrigation parameters, also propose recalculate_water_and_costs.
Do not invent field measurements, supplier prices, inspection dates or regulatory approvals to make a finding disappear.
Do not propose blocked or invasive species. Respect the minimum palette size for the selected design system.
Allowed action JSON shapes:
{"type":"add_species","speciesIds":["id"]}
{"type":"remove_species","speciesIds":["id"]}
{"type":"set_species_mix","entries":[{"speciesId":"id","targetPercent":25,"successionOverride":"placenta|secondary|climax|null"}]}
{"type":"set_design_spacing","cropAlleyWidthM":14,"perimeterBandM":8,"analysisYear":10,"customBearingDegrees":0}
{"type":"set_machinery_parameters","enabled":true,"presetId":"bcs-740","widthM":0.79,"lengthM":2,"turningRadiusM":1.2,"implementWidthM":0.8,"safetyClearanceM":0.35}
{"type":"set_firebreak_parameters","enabled":true,"fuelModel":"crop-residue","treatment":"mown","expectedFlameLengthM":2,"widthM":5,"supportVehicleAccess":true}
{"type":"set_irrigation_parameters","availableFlowM3Hour":5,"inletPressureBar":2.5,"emitterFlowLHour":4,"emittersPerPlant":2,"distributionEfficiencyPercent":90,"maxZoneRuntimeHours":8}
{"type":"select_variant","variantId":"id"}
{"type":"set_timeline_year","year":0}
{"type":"regenerate_layout"}
{"type":"recalculate_water_and_costs"}
{"type":"navigate","section":"site|profile|species|layout|water|fire|costs|analysis|care"}
Required response JSON shape:
{"summary":"short answer","rationale":"grounded explanation","warnings":["warning"],"actions":[]}`;
}

function formalReviewSystemPrompt() {
  return `You are Growup's independent senior agroforestry project reviewer. Return JSON only, in the requested response language.
Audit the supplied project as a formal planning-quality review. Do not redesign it silently and do not invent observations, measurements, sources, legal requirements or missing values.

Review these eight dimensions independently:
1. evidence: provenance, dates, spatial resolution, confidence, modelled versus field-measured data and explicit gaps;
2. species: climate, soil, water and biogeographic fit of the selected palette, invasive constraints and functional/strata balance;
3. design: geometry, spacing, exclusions, succession, machinery clearance, warnings and reproducibility;
4. water: demand, source assumptions, network coherence, drought signal, satellite scheduling limits and maintenance;
5. fire: climate and wind indicators, fuels, terrain, firebreak width basis, windward treatment, access and local-review requirements;
6. operations: build sequence, maintenance capacity, access, crossings and unresolved tasks;
7. economics: completeness, units, currency, cost assumptions, harvest kg/value if present, and consistency with design quantities;
8. coherence: contradictions and stale/missing dependent calculations across all project sections.

Rules:
- Use only the supplied project and selectedSpecies data. Every finding must name the concrete project fields or source records that support it.
- Distinguish field observations, user overrides, modelled estimates, deterministic calculations and AI interpretation.
- Missing evidence is unknown, never automatically safe.
- EFFIS FWI is a regional weather-danger forecast, not parcel ignition probability or a parcel flame-spread model.
- A mapped firebreak or irrigation network is a planning output, not proof of field implementation.
- Mark a finding blocking only when a missing input or contradiction prevents responsible use of the plan; use major for material risk, minor for improvement, info for clarification.
- Verdict "ready" means ready for documented planning use with stated local/field checks, never legal certification. Use "revise" for material correctable issues and "incomplete" when core project outputs are absent.
- Score dimensions and overall from 0 to 100. Keep scores consistent with findings: blocking findings cap overall at 49, major unresolved findings cap it at 74.
- Prefer concise, testable recommendations.
- Begin the response immediately with the JSON object. Keep each dimension summary under 35 words and each finding explanation under 60 words.

Required JSON shape:
{
  "verdict":"ready|revise|incomplete",
  "overallScore":0,
  "executiveSummary":"concise formal conclusion",
  "dimensions":[{"id":"evidence|species|design|water|fire|operations|economics|coherence","score":0,"status":"pass|attention|fail|unknown","summary":"grounded conclusion"}],
  "findings":[{"id":"stable-short-id","severity":"blocking|major|minor|info","area":"dimension id","title":"short title","explanation":"what is inconsistent or supported","evidence":["exact field/source reference"],"recommendation":"specific next action"}],
  "assumptions":["assumption explicitly present in the project or required for interpretation"],
  "limitations":["what this AI review cannot establish"]
}`;
}

function compactContext(context: AssistantProjectContext) {
  const profile = context.siteProfile;
  return {
    section: context.section,
    site: context.site ? {
      id: context.site.id,
      name: context.site.name,
      boundaryVertexCount: context.site.polygon.length,
      additionalPolygonCount: context.site.additionalPolygons.length,
      holeCount: context.site.holes.length,
      exclusionCount: context.site.exclusions.length,
      pathCount: context.site.paths.length,
      accessPointCount: context.site.accessPoints.length,
      waterPointCount: context.site.waterPoints.length,
      observedTreeCount: context.site.existingTrees.length,
      setbackM: context.site.setbackM,
    } : null,
    location: profile?.location ?? null,
    areaM2: profile?.areaM2 ?? null,
    profileGeneratedAt: profile?.generatedAt ?? null,
    profileOverrides: profile?.overrides ?? [],
    terrain: profile ? {
      elevationM: profile.terrain.elevationMeanM,
      elevationRangeM: profile.terrain.elevationMaxM - profile.terrain.elevationMinM,
      slopePercent: profile.terrain.slopePercent,
      aspect: profile.terrain.aspectLabel,
      evidence: profile.terrain.evidence,
    } : null,
    climate: profile ? {
      period: profile.climate.period,
      rainMm: profile.climate.annualPrecipitationMm,
      et0Mm: profile.climate.annualEt0Mm,
      aridityIndex: profile.climate.aridityIndex,
      minC: profile.climate.absoluteMinTemperatureC,
      maxC: profile.climate.absoluteMaxTemperatureC,
      evidence: profile.climate.evidence,
    } : null,
    wind: profile?.solar.status === 'available' ? {
      period: profile.solar.period,
      prevailingDirectionDegrees: profile.solar.prevailingWindDirectionDegrees,
      prevailingDirectionLabel: profile.solar.prevailingWindDirectionLabel,
      meanSpeedMs: profile.solar.meanWindSpeedMs,
      speedP90Ms: profile.solar.windSpeedP90Ms ?? null,
      calmFrequencyPercent: profile.solar.calmWindFrequencyPercent ?? null,
      seasonalClimatology: profile.solar.windClimatology ?? [],
      evidence: profile.solar.evidence,
      limitations: profile.solar.limitations,
    } : null,
    soil: profile?.soil ?? null,
    fieldConditions: profile?.fieldConditions ?? null,
    landCover: profile?.landCover ?? null,
    existingVegetation: profile?.satellite.existingVegetation ?? null,
    satelliteWater: profile ? {
      status: profile.satellite.status,
      latestOptical: profile.satellite.optical.latest,
      latestRadarSignal: profile.satellite.radar.surfaceMoistureSignal,
      irrigationScheduling: profile.satellite.irrigationScheduling,
      evidence: profile.satellite.evidence,
      limitations: profile.satellite.limitations,
    } : null,
    nasaLandscape: profile?.nasaLandscape ? {
      status: profile.nasaLandscape.status,
      observedAt: profile.nasaLandscape.observedAt,
      samples: profile.nasaLandscape.samples.map((sample) => ({
        id: sample.id,
        layer: sample.layer,
        status: sample.status,
        label: sample.label,
        value: sample.value,
        unit: sample.unit,
        resolution: sample.evidence.resolution,
      })),
      limitations: profile.nasaLandscape.limitations,
    } : null,
    selectedSpeciesIds: context.selectedSpeciesIds,
    designConfiguration: context.designConfiguration,
    irrigationConfiguration: context.irrigationConfiguration,
    economicConfiguration: context.economicConfiguration,
    variants: context.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      description: variant.description,
      score: variant.score,
      metrics: variant.metrics,
      solar: variant.solar,
      composition: variant.composition,
      warnings: variant.warnings,
      generation: variant.generation,
      machinery: {
        enabled: variant.machinery.enabled,
        presetId: variant.machinery.presetId,
        requiredCorridorWidthM: variant.machinery.requiredCorridorWidthM,
        headlandDepthM: variant.machinery.headlandDepthM,
        reservedAreaM2: variant.machinery.reservedAreaM2,
        perimeterLoops: (variant.machinery.perimeterLoops ?? []).map((route) => ({
          id: route.id,
          widthM: route.widthM,
          lengthM: route.lengthM,
          clearanceSatisfied: route.clearanceSatisfied,
        })),
        manoeuvreRoutes: (variant.machinery.manoeuvreRoutes ?? []).map((route) => ({
          id: route.id,
          lengthM: route.lengthM,
          connectedCorridorIds: route.connectedCorridorIds,
          clearanceSatisfied: route.clearanceSatisfied,
        })),
        clearanceSatisfied: variant.machinery.clearanceSatisfied,
        notes: variant.machinery.notes,
      },
      firebreak: {
        enabled: variant.firebreak.enabled,
        fuelModel: variant.firebreak.fuelModel,
        treatment: variant.firebreak.treatment,
        expectedFlameLengthM: variant.firebreak.expectedFlameLengthM,
        minimumPlanningWidthM: variant.firebreak.minimumPlanningWidthM,
        plannedWidthM: variant.firebreak.plannedWidthM,
        totalLengthM: variant.firebreak.totalLengthM,
        reservedAreaM2: variant.firebreak.reservedAreaM2,
        supportVehicleAccess: variant.firebreak.supportVehicleAccess,
        protectPipeCrossings: variant.firebreak.protectPipeCrossings,
        planningWidthSatisfied: variant.firebreak.planningWidthSatisfied,
        localReviewRequired: variant.firebreak.localReviewRequired,
        lineCount: variant.firebreak.lines.length,
        windwardLineCount: variant.firebreak.lines.filter((line) => line.priority === 'windward').length,
        notes: variant.firebreak.notes,
        evidence: variant.firebreak.evidence,
      },
    })),
    selectedVariantId: context.selectedVariantId,
    timelineYear: context.timelineYear,
    irrigation: context.irrigation ? {
      annualWaterM3: context.irrigation.annualWaterM3,
      annualOperationCost: context.irrigation.annualOperation.totalCost,
      currencyCode: context.irrigation.economics.currencyCode,
      adjustmentPercent: context.irrigation.satelliteScheduling.adjustmentPercent,
      network: {
        source: context.irrigation.network.source,
        routingValid: context.irrigation.network.routingValid,
        warnings: context.irrigation.network.warnings,
        lineCount: context.irrigation.network.lines.length,
        blockedLineIds: context.irrigation.network.unroutableLineIds,
        protectedCrossingCount: context.irrigation.network.protectedCrossingCount,
        requiredFlowM3Hour: context.irrigation.network.requiredFlowM3Hour,
        availableFlowM3Hour: context.irrigation.network.availableFlowM3Hour,
        requiredDynamicHeadM: context.irrigation.network.requiredDynamicHeadM,
        availablePressureHeadM: context.irrigation.network.availablePressureHeadM,
        pumpRequired: context.irrigation.network.pumpRequired,
        measuredPipeM: context.irrigation.network.totalMeasuredPipeM,
        purchasePipeM: context.irrigation.network.totalPurchasePipeM,
        manualOverrideCount: context.irrigation.network.manualOverrideCount,
      },
      maintenance: context.irrigation.systemMaintenance ? {
        year: context.irrigation.systemMaintenance.year,
        phase: context.irrigation.systemMaintenance.phase,
        personHours: context.irrigation.systemMaintenance.totalHours,
        laborCost: context.irrigation.systemMaintenance.totalCost,
        tasks: context.irrigation.systemMaintenance.tasks.map((task) => ({ id: task.id, personHours: task.hours, cost: task.cost })),
        exclusions: context.irrigation.systemMaintenance.exclusions,
      } : null,
    } : null,
    costs: context.costs ? {
      totalCost: context.costs.totalCost,
      plantCost: context.costs.plantPurchaseCost,
      plantingLaborHours: context.costs.plantingLaborHours,
      plantingLaborCost: context.costs.plantingLaborCost,
      protectionAndStakesCost: context.costs.protectionAndStakesCost,
      irrigationInstallationCost: context.costs.irrigationInstallationCost,
      economics: context.costs.economics,
      bySpecies: context.costs.bySpecies,
      activeSystem: context.costs.activeSystem,
      selectedYearOperatingCost: context.costs.timeline.find((item) => item.year === context.timelineYear) ?? null,
    } : null,
    fireOperations: context.fireOperations,
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

function selectedSpeciesForReview(context: AssistantProjectContext) {
  const ranking = context.siteProfile ? new Map(rankSpecies(DESIGN_SPECIES, context.siteProfile, context.designConfiguration.objectives).map((item) => [item.species.id, item])) : new Map();
  return context.selectedSpeciesIds.map((id) => DESIGN_SPECIES.find((species) => species.id === id)).filter((species): species is DesignSpecies => Boolean(species)).map((species) => {
    const recommendation = ranking.get(species.id);
    return {
      id: species.id,
      scientificName: species.scientificName,
      commonName: species.commonName,
      stratum: species.stratum,
      succession: species.succession,
      roles: species.roles,
      evergreen: species.evergreen,
      nitrogenFixer: species.nitrogenFixer,
      climateRange: {
        minimumTemperatureC: species.minTemperatureC,
        maximumTemperatureC: species.maxTemperatureC,
        annualRainMinMm: species.annualRainMinMm,
        annualRainMaxMm: species.annualRainMaxMm,
      },
      soilPhRange: { minimum: species.phMin, maximum: species.phMax },
      droughtTolerance: species.droughtTolerance,
      waterloggingTolerance: species.waterloggingTolerance,
      invasiveStatus: species.invasiveStatus,
      siteScore: recommendation?.score ?? null,
      siteStatus: recommendation?.status ?? 'not-profiled',
      siteReasons: recommendation?.reasons ?? [],
      siteMitigations: recommendation?.mitigations ?? [],
      sources: species.sources,
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

function validateFormalReview(value: unknown, context: AssistantProjectContext, model: string): ProjectAnalysisReport {
  if (!value || typeof value !== 'object') throw new Error('Formal review response is not a JSON object.');
  const raw = value as Record<string, unknown>;
  const verdicts = ['ready', 'revise', 'incomplete'] as const;
  const verdict = verdicts.includes(raw.verdict as typeof verdicts[number]) ? raw.verdict as typeof verdicts[number] : 'incomplete';
  const rawDimensions = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimensions = REVIEW_DIMENSIONS.map((id): ProjectAnalysisDimension => {
    const candidate = rawDimensions.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).id === id) as Record<string, unknown> | undefined;
    const statuses = ['pass', 'attention', 'fail', 'unknown'] as const;
    const status = candidate && statuses.includes(candidate.status as typeof statuses[number]) ? candidate.status as typeof statuses[number] : 'unknown';
    return {
      id,
      score: boundedScore(candidate?.score),
      status,
      summary: textValue(candidate?.summary, 'This dimension was not assessed with sufficient evidence.'),
    };
  });
  const findings = (Array.isArray(raw.findings) ? raw.findings : [])
    .slice(0, 20)
    .map((item, index) => validateFinding(item, index))
    .filter((item): item is ProjectAnalysisFinding => item !== null);
  let overallScore = boundedScore(raw.overallScore);
  if (findings.some((finding) => finding.severity === 'blocking')) overallScore = Math.min(overallScore, 49);
  else if (findings.some((finding) => finding.severity === 'major')) overallScore = Math.min(overallScore, 74);
  return {
    id: randomUUID(),
    model,
    generatedAt: new Date().toISOString(),
    contextFingerprint: projectAnalysisFingerprint(context),
    verdict,
    overallScore,
    executiveSummary: textValue(raw.executiveSummary, 'The formal review could not establish a complete project conclusion.'),
    dimensions,
    findings,
    assumptions: textArray(raw.assumptions, 12),
    limitations: textArray(raw.limitations, 12),
  };
}

function validateFinding(value: unknown, index: number): ProjectAnalysisFinding | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const severities = ['blocking', 'major', 'minor', 'info'] as const;
  const severity = severities.includes(raw.severity as typeof severities[number]) ? raw.severity as typeof severities[number] : 'info';
  const area = REVIEW_DIMENSIONS.includes(raw.area as ProjectAnalysisDimensionId) ? raw.area as ProjectAnalysisDimensionId : 'coherence';
  return {
    id: safeId(raw.id, index),
    severity,
    area,
    title: textValue(raw.title, 'Review finding'),
    explanation: textValue(raw.explanation, 'No explanation was provided.'),
    evidence: textArray(raw.evidence, 8),
    recommendation: textValue(raw.recommendation, 'Verify this item before using the plan operationally.'),
  };
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
  if (raw.type === 'set_species_mix') {
    const successionPhases = ['placenta', 'secondary', 'climax'] as const;
    const requested = Array.isArray(raw.entries) ? raw.entries : [];
    const entries = requested.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Assistant proposed an invalid species mix entry.');
      const candidate = entry as Record<string, unknown>;
      const speciesId = resolveSpeciesId(String(candidate.speciesId ?? ''));
      if (!speciesId || !context.selectedSpeciesIds.includes(speciesId)) throw new Error('Assistant species mix must use currently selected species.');
      const targetPercent = boundedActionNumber(candidate.targetPercent, 0, 100, 'Species target percentage');
      const successionOverride = candidate.successionOverride === null || candidate.successionOverride === undefined
        ? null
        : successionPhases.includes(candidate.successionOverride as typeof successionPhases[number])
          ? candidate.successionOverride as typeof successionPhases[number]
          : null;
      return { speciesId, targetPercent, successionOverride };
    });
    const ids = new Set(entries.map((entry) => entry.speciesId));
    const total = entries.reduce((sum, entry) => sum + entry.targetPercent, 0);
    if (entries.length !== context.selectedSpeciesIds.length || ids.size !== context.selectedSpeciesIds.length || Math.abs(total - 100) > 0.1) {
      throw new Error('Assistant species mix must include every selected species exactly once and total 100%.');
    }
    return { type: 'set_species_mix', entries };
  }
  if (raw.type === 'set_design_spacing') {
    const action: Extract<AssistantAction, { type: 'set_design_spacing' }> = { type: 'set_design_spacing' };
    if (raw.cropAlleyWidthM !== undefined) action.cropAlleyWidthM = boundedActionNumber(raw.cropAlleyWidthM, 6, 40, 'Crop alley width');
    if (raw.perimeterBandM !== undefined) action.perimeterBandM = boundedActionNumber(raw.perimeterBandM, 3, 30, 'Perimeter band');
    if (raw.analysisYear !== undefined) action.analysisYear = boundedActionNumber(raw.analysisYear, 1, 30, 'Analysis year', true);
    if (raw.customBearingDegrees !== undefined) action.customBearingDegrees = boundedActionNumber(raw.customBearingDegrees, 0, 359.999, 'Custom bearing');
    if (Object.keys(action).length === 1) throw new Error('Assistant proposed design spacing without parameters.');
    return action;
  }
  if (raw.type === 'set_machinery_parameters') {
    const action: Extract<AssistantAction, { type: 'set_machinery_parameters' }> = { type: 'set_machinery_parameters' };
    const presetIds = ['bcs-740', 'john-deere-1025r', 'john-deere-3033r', 'new-holland-t4f'] as const;
    if (typeof raw.enabled === 'boolean') action.enabled = raw.enabled;
    if (presetIds.includes(raw.presetId as typeof presetIds[number])) action.presetId = raw.presetId as typeof presetIds[number];
    if (raw.widthM !== undefined) action.widthM = boundedActionNumber(raw.widthM, 0.35, 4, 'Machine width');
    if (raw.lengthM !== undefined) action.lengthM = boundedActionNumber(raw.lengthM, 0.8, 8, 'Machine length');
    if (raw.turningRadiusM !== undefined) action.turningRadiusM = boundedActionNumber(raw.turningRadiusM, 0.4, 12, 'Machine turning radius');
    if (raw.implementWidthM !== undefined) action.implementWidthM = boundedActionNumber(raw.implementWidthM, 0.35, 8, 'Implement width');
    if (raw.safetyClearanceM !== undefined) action.safetyClearanceM = boundedActionNumber(raw.safetyClearanceM, 0.1, 3, 'Machine safety clearance');
    if (Object.keys(action).length === 1) throw new Error('Assistant proposed machinery parameters without values.');
    return action;
  }
  if (raw.type === 'set_firebreak_parameters') {
    const action: Extract<AssistantAction, { type: 'set_firebreak_parameters' }> = { type: 'set_firebreak_parameters' };
    const fuelModels = ['managed-herbaceous', 'crop-residue', 'shrub-edge', 'woodland-edge', 'custom'] as const;
    const treatments = ['mown', 'bare-ground', 'low-fuel-vegetation'] as const;
    if (typeof raw.enabled === 'boolean') action.enabled = raw.enabled;
    if (fuelModels.includes(raw.fuelModel as typeof fuelModels[number])) action.fuelModel = raw.fuelModel as typeof fuelModels[number];
    if (treatments.includes(raw.treatment as typeof treatments[number])) action.treatment = raw.treatment as typeof treatments[number];
    if (typeof raw.supportVehicleAccess === 'boolean') action.supportVehicleAccess = raw.supportVehicleAccess;
    if (raw.expectedFlameLengthM !== undefined) action.expectedFlameLengthM = boundedActionNumber(raw.expectedFlameLengthM, 0.2, 20, 'Expected flame length');
    if (raw.widthM !== undefined) action.widthM = boundedActionNumber(raw.widthM, 1, 60, 'Firebreak width');
    if (Object.keys(action).length === 1) throw new Error('Assistant proposed firebreak parameters without values.');
    return action;
  }
  if (raw.type === 'set_irrigation_parameters') {
    const action: Extract<AssistantAction, { type: 'set_irrigation_parameters' }> = { type: 'set_irrigation_parameters' };
    if (raw.availableFlowM3Hour !== undefined) action.availableFlowM3Hour = boundedActionNumber(raw.availableFlowM3Hour, 0.1, 500, 'Available flow');
    if (raw.inletPressureBar !== undefined) action.inletPressureBar = boundedActionNumber(raw.inletPressureBar, 0, 20, 'Inlet pressure');
    if (raw.emitterFlowLHour !== undefined) action.emitterFlowLHour = boundedActionNumber(raw.emitterFlowLHour, 0.5, 32, 'Emitter flow');
    if (raw.emittersPerPlant !== undefined) action.emittersPerPlant = boundedActionNumber(raw.emittersPerPlant, 1, 12, 'Emitters per plant', true);
    if (raw.distributionEfficiencyPercent !== undefined) action.distributionEfficiencyPercent = boundedActionNumber(raw.distributionEfficiencyPercent, 50, 98, 'Distribution efficiency');
    if (raw.maxZoneRuntimeHours !== undefined) action.maxZoneRuntimeHours = boundedActionNumber(raw.maxZoneRuntimeHours, 1, 24, 'Maximum zone runtime');
    if (Object.keys(action).length === 1) throw new Error('Assistant proposed irrigation parameters without values.');
    return action;
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

function boundedActionNumber(value: unknown, minimum: number, maximum: number, label: string, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  return integer ? Math.round(number) : number;
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

function textArray(value: unknown, maximum: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, maximum).map((item) => item.trim().slice(0, 500))
    : [];
}

function boundedScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function safeId(value: unknown, index: number) {
  const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase('en').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') : '';
  return (normalized || `finding-${index + 1}`).slice(0, 80);
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
  if (isDeepSeekProvider(baseUrl, model)) return { thinking: { type: 'disabled' as const } };
  return {};
}

function providerRequestBody<T extends { messages: Array<{ role: string; content: string }>; response_format: { type: string } }>(
  requestBody: T,
  baseUrl: string,
  model: string,
  repairStructuredOutput: boolean,
) {
  if (!repairStructuredOutput || !isDeepSeekProvider(baseUrl, model)) return requestBody;
  const { response_format: _responseFormat, ...fallback } = requestBody;
  return {
    ...fallback,
    messages: [
      ...requestBody.messages,
      {
        role: 'user',
        content: 'The previous JSON-mode response was empty. Return exactly one compact valid JSON object now, beginning with { and ending with }. Do not use Markdown fences or any text outside the object.',
      },
    ],
  };
}

function isDeepSeekProvider(baseUrl: string, model: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLocaleLowerCase('en');
    return hostname === 'api.deepseek.com' || model.toLocaleLowerCase('en').startsWith('deepseek-v4');
  } catch {
    return model.toLocaleLowerCase('en').startsWith('deepseek-v4');
  }
}

function parseJsonResponse(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error('No JSON object found.');
  }
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
