import { defaultEconomicConfiguration } from '../src/data/economicProfiles.js';
import { defaultFireOperationsPlan } from '../src/lib/fireOperations.js';
import { DEFAULT_IRRIGATION_CONFIGURATION } from '../src/lib/irrigation.js';
import { DEFAULT_DESIGN_CONFIGURATION } from '../src/lib/layout.js';
import type { AssistantProjectContext } from '../src/types.js';
import { reviewAssistantProject } from '../server/assistant.js';

const context: AssistantProjectContext = {
  site: null,
  siteProfile: null,
  selectedSpeciesIds: [],
  designConfiguration: DEFAULT_DESIGN_CONFIGURATION,
  irrigationConfiguration: DEFAULT_IRRIGATION_CONFIGURATION,
  economicConfiguration: defaultEconomicConfiguration(''),
  variants: [],
  selectedVariantId: null,
  timelineYear: 5,
  irrigation: null,
  costs: null,
  fireOperations: defaultFireOperationsPlan(),
  section: 'analysis',
};

const startedAt = Date.now();

try {
  const baseUrl = process.env.GROWUP_BASE_URL?.trim().replace(/\/+$/, '');
  const report = baseUrl
    ? await reviewLiveAssistant(baseUrl)
    : await reviewAssistantProject(context, 'it');
  console.log(JSON.stringify({
    ok: true,
    verdict: report.verdict,
    score: report.overallScore,
    model: report.model,
    dimensions: report.dimensions.length,
    findings: report.findings.length,
    durationMs: Date.now() - startedAt,
  }));
} catch (error) {
  const failure = error as Error & { code?: string; status?: number };
  console.log(JSON.stringify({
    ok: false,
    name: failure.name,
    code: failure.code,
    status: failure.status,
    message: failure.message,
  }));
  process.exitCode = 1;
}

async function reviewLiveAssistant(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/assistant/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, locale: 'it' }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Assistant review returned HTTP ${response.status}`) as Error & { code?: string; status?: number };
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}
