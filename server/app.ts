import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DESIGN_SPECIES, DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies.js';
import { calculateEstablishmentCost } from '../src/lib/costs.js';
import { generateLayoutVariants, normalizeDesignConfiguration, regenerateLayoutVariant } from '../src/lib/layout.js';
import { calculateIrrigation } from '../src/lib/irrigation.js';
import { normalizeDesignObjectives } from '../src/lib/objectives.js';
import { rankSpecies, recommendedPalette } from '../src/lib/recommendations.js';
import { applySiteProfileOverride } from '../src/lib/siteOverrides.js';
import { localSiteValidation, normalizeSiteBoundary } from '../src/lib/siteGeometry.js';
import { createProjectComment, MAX_PROJECT_COMMENTS, requireProjectReview, rotateShareVersion } from '../src/lib/collaboration.js';
import type { LayoutVariant, ProjectState, SiteBoundary, SiteProfile, SiteProfileOverrideField } from '../src/types.js';
import type { AssistantProjectContext } from '../src/types.js';
import { assistantStatus, planAssistantAction, type AssistantProviderConfig } from './assistant.js';
import {
  authenticatedUser,
  authStatus,
  clearSessionCookie,
  requireAuthenticatedUser,
  setSessionResponseCookie,
  signInWithGoogle,
  type AuthConfig,
} from './auth.js';
import { catalogueStats, searchCatalogue } from './catalog.js';
import { databaseHealth, geometryMetrics, migrateDatabase } from './db.js';
import { resolveEconomicConfiguration, type EconomicProviderConfig } from './economics.js';
import { exportProjectCsv, exportProjectGeoJson } from './export.js';
import {
  assertMongoIndexesReady,
  getProject,
  getSharedProject,
  getProjectRevision,
  getCalculationRun,
  getUser,
  listProjectRevisions,
  listProjects,
  mongoHealth,
  saveProject,
  updateUserOnboarding,
  upsertUser,
  type OnboardingPreference,
  type GrowupDatabase,
} from './mongo.js';
import { buildSiteProfile, searchLocations, type SiteProviderConfig } from './site.js';
import { allowedOrigins, rateLimit, securityHeaders, type SecurityConfig } from './security.js';
import { createProjectShareToken, publicProject, sharingStatus, verifyProjectShareToken } from './sharing.js';

export type GrowupAppConfig = SiteProviderConfig & AssistantProviderConfig & AuthConfig & EconomicProviderConfig & SecurityConfig & {
  skipDatabaseMigration?: boolean;
  database?: GrowupDatabase;
  staticRoot?: string | null;
};

export function createApp(config: GrowupAppConfig = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const database = config.database ?? {
    health: async () => (await databaseHealth()) && (await mongoHealth()),
    geometryMetrics,
    getUser,
    upsertUser,
    updateUserOnboarding,
    getProject,
    getSharedProject,
    listProjects,
    listProjectRevisions,
    getProjectRevision,
    getCalculationRun,
    saveProject,
  };

  const origins = allowedOrigins(config);
  app.use(cors({ credentials: true, origin: (origin, callback) => callback(null, !origin || origins.has(origin)) }));
  app.use(securityHeaders);
  app.use(express.json({ limit: '8mb' }));
  const assistantLimiter = rateLimit('assistant', config.assistantRateLimit ?? 10, config);
  const computeLimiter = rateLimit('compute', config.computeRateLimit ?? 80, config);
  const authLimiter = rateLimit('auth', config.authRateLimit ?? 20, { ...config, rateLimitWindowMs: 15 * 60_000 });
  const reviewLimiter = rateLimit('review', 30, { ...config, rateLimitWindowMs: 15 * 60_000 });

  app.get('/api/health', async (_req: Request, res: Response) => {
    const db = await database.health();
    res.status(db ? 200 : 503).json({ ok: db, database: db ? 'ready' : 'unavailable' });
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      googleMapsApiKey: process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? '',
      initialMapViewport: {
        center: { lat: 0, lng: 0 },
        zoom: 2,
      },
      climatePeriod: '2021–2025',
      modelVersion: 'growup-0.1.0',
      assistant: assistantStatus(config),
      auth: authStatus(config),
      sharing: sharingStatus(config),
    });
  });

  app.get('/api/auth/session', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await authenticatedUser(req, database, config);
      return { authenticated: Boolean(user), user, configured: authStatus(config).configured };
    });
  });

  app.post('/api/auth/google', authLimiter, async (req: Request, res: Response) => {
    try {
      const result = await signInWithGoogle(typeof req.body?.credential === 'string' ? req.body.credential : '', database, config);
      setSessionResponseCookie(res, result.cookie);
      res.json({ authenticated: true, user: result.user });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    setSessionResponseCookie(res, clearSessionCookie());
    res.json({ authenticated: false, user: null });
  });

  app.put('/api/user/preferences/onboarding', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      return database.updateUserOnboarding(user.id, requireOnboardingPreference(req.body));
    });
  });

  app.get('/api/assistant/status', (_req: Request, res: Response) => res.json(assistantStatus(config)));

  app.post('/api/assistant/plan', assistantLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => planAssistantAction(
      typeof req.body?.message === 'string' ? req.body.message : '',
      requireAssistantContext(req.body?.context),
      config,
    ));
  });

  app.get('/api/catalog/stats', (_req: Request, res: Response) => res.json(catalogueStats()));

  app.get('/api/catalog/search', (req: Request, res: Response) => {
    res.json(searchCatalogue({
      query: stringQuery(req.query.q),
      treeOnly: booleanQuery(req.query.tree),
      globUntOnly: booleanQuery(req.query.globunt),
      designReadyOnly: booleanQuery(req.query.designReady),
      stratum: stringQuery(req.query.stratum),
      succession: stringQuery(req.query.succession),
      role: stringQuery(req.query.role),
      evergreen: optionalBooleanQuery(req.query.evergreen),
      nitrogenFixer: optionalBooleanQuery(req.query.nitrogenFixer),
      droughtMinimum: numberQuery(req.query.droughtMin),
      evidenceMinimum: numberQuery(req.query.evidenceMin),
      limit: numberQuery(req.query.limit),
      offset: numberQuery(req.query.offset),
    }));
  });

  app.get('/api/design-species', (_req: Request, res: Response) => res.json({ total: DESIGN_SPECIES.length, results: DESIGN_SPECIES }));

  app.get('/api/locations/search', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, () => {
      const query = stringQuery(req.query.q)?.trim() ?? '';
      if (query.length < 2 || query.length > 200) throw httpError(400, 'INVALID_LOCATION_QUERY', 'Location search must contain 2–200 characters.');
      return searchLocations(query, config);
    });
  });

  app.post('/api/geometry/metrics', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => database.geometryMetrics(requireBoundary(req.body)));
  });

  app.post('/api/site/validate', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => database.geometryMetrics(requireBoundary(req.body)));
  });

  app.post('/api/site/profile', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const site = requireBoundary(req.body);
      const validation = await database.geometryMetrics(site);
      if (!validation.valid) throw httpError(422, 'INVALID_SITE_GEOMETRY', validation.reason);
      const profile = await buildSiteProfile(site, config);
      return { ...profile, areaM2: validation.areaM2, perimeterM: validation.perimeterM };
    });
  });

  app.post('/api/economics/profile', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      return resolveEconomicConfiguration(siteProfile.location.countryCode, config);
    });
  });

  app.post('/api/site/profile/override', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => applySiteProfileOverride(requireSiteProfile(req.body?.siteProfile), {
      field: String(req.body?.override?.field ?? '') as SiteProfileOverrideField,
      value: req.body?.override?.value,
      reason: String(req.body?.override?.reason ?? ''),
      sourceLabel: String(req.body?.override?.sourceLabel ?? ''),
      observedAt: String(req.body?.override?.observedAt ?? ''),
      appliedAt: (config.now?.() ?? new Date()).toISOString(),
    }));
  });

  app.post('/api/recommendations', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      const recommendations = rankSpecies(DESIGN_SPECIES, siteProfile, normalizeDesignObjectives(req.body?.objectives));
      return { recommendations, palette: recommendedPalette(recommendations, 9).map((item) => item.species) };
    });
  });

  app.post('/api/layout/generate', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const site = requireBoundary(req.body?.site);
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      if (siteProfile.satellite.existingVegetation.suitability === 'reject') {
        throw httpError(422, 'SITE_WOODY_COVER_TOO_HIGH', siteProfile.satellite.existingVegetation.conclusion);
      }
      const selectedSpecies = requireSpecies(req.body?.selectedSpeciesIds);
      const designConfiguration = normalizeDesignConfiguration(req.body?.designConfiguration);
      return { variants: generateLayoutVariants(site, siteProfile, selectedSpecies, designConfiguration) };
    });
  });

  app.post('/api/layout/regenerate', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const site = requireBoundary(req.body?.site);
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      const selectedSpecies = requireSpecies(req.body?.selectedSpeciesIds);
      const previousVariant = requireVariant(req.body?.previousVariant);
      const designConfiguration = normalizeDesignConfiguration(req.body?.designConfiguration ?? previousVariant.design);
      return { variant: regenerateLayoutVariant(site, siteProfile, selectedSpecies, previousVariant, designConfiguration) };
    });
  });

  app.post('/api/irrigation/calculate', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const variant = requireVariant(req.body?.variant);
      const site = requireBoundary(req.body?.site);
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      const selectedSpecies = requireSpecies(req.body?.selectedSpeciesIds);
      return calculateIrrigation(variant, selectedSpecies, site, siteProfile, Number(req.body?.designYear ?? 5), req.body?.irrigationConfiguration, req.body?.economicConfiguration);
    });
  });

  app.post('/api/costs/calculate', computeLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const variant = requireVariant(req.body?.variant);
      const site = requireBoundary(req.body?.site);
      const selectedSpecies = requireSpecies(req.body?.selectedSpeciesIds);
      const siteProfile = requireSiteProfile(req.body?.siteProfile);
      const designYear = Number(req.body?.designYear ?? 5);
      const irrigation = calculateIrrigation(variant, selectedSpecies, site, siteProfile, designYear, req.body?.irrigationConfiguration, req.body?.economicConfiguration);
      const baselineIrrigation = designYear === 5
        ? irrigation
        : calculateIrrigation(variant, selectedSpecies, site, siteProfile, 5, req.body?.irrigationConfiguration, req.body?.economicConfiguration);
      let cumulativeOperatingCost = 0;
      const finalProjectionYear = Math.max(30, designYear);
      const timeline = Array.from({ length: finalProjectionYear }, (_, index) => index + 1).map((year) => {
        const yearlyIrrigation = year === designYear
          ? irrigation
          : year === 5
            ? baselineIrrigation
            : calculateIrrigation(variant, selectedSpecies, site, siteProfile, year, req.body?.irrigationConfiguration, req.body?.economicConfiguration);
        const yearlyCosts = calculateEstablishmentCost(variant, selectedSpecies, baselineIrrigation, irrigation.economics, year, yearlyIrrigation);
        cumulativeOperatingCost += yearlyIrrigation.annualOperation.totalCost;
        return {
          year,
          activePlantCount: yearlyIrrigation.activePlantCount,
          annualWaterM3: yearlyIrrigation.annualWaterM3,
          waterAndEnergyCost: Number((yearlyIrrigation.annualOperation.waterCost + yearlyIrrigation.annualOperation.energyCost).toFixed(2)),
          maintenanceLaborHours: yearlyIrrigation.systemMaintenance.totalHours,
          managementLaborCost: yearlyIrrigation.annualOperation.managementLaborCost,
          maintenanceTasks: yearlyIrrigation.systemMaintenance.tasks,
          maintenanceCost: yearlyIrrigation.annualOperation.maintenanceCost,
          annualOperatingCost: yearlyIrrigation.annualOperation.totalCost,
          activeReplacementCost: yearlyCosts.activeSystem.totalReplacementCost,
          cumulativeOperatingCost: Number(cumulativeOperatingCost.toFixed(2)),
        };
      });
      return { irrigation, establishment: calculateEstablishmentCost(variant, selectedSpecies, baselineIrrigation, irrigation.economics, designYear, irrigation, timeline) };
    });
  });

  app.get('/api/projects', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      return database.listProjects(user.id);
    });
  });

  app.get('/api/projects/:id', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      return project;
    });
  });

  app.put('/api/projects/:id', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = requireProject(req.body);
      if (project.id !== paramValue(req.params.id)) throw httpError(400, 'PROJECT_ID_MISMATCH', 'URL and payload project IDs differ');
      return database.saveProject(user.id, project);
    });
  });

  app.get('/api/projects/:id/revisions', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const projectId = paramValue(req.params.id);
      const project = await database.getProject(user.id, projectId);
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      return database.listProjectRevisions(user.id, projectId);
    });
  });

  app.get('/api/projects/:id/revisions/:revision', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const projectId = paramValue(req.params.id);
      const revision = integerParam(req.params.revision, 'INVALID_PROJECT_REVISION');
      const project = await database.getProjectRevision(user.id, projectId, revision);
      if (!project) throw httpError(404, 'PROJECT_REVISION_NOT_FOUND', 'Project revision not found');
      return project;
    });
  });

  app.post('/api/projects/:id/revisions/:revision/restore', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const projectId = paramValue(req.params.id);
      const revision = integerParam(req.params.revision, 'INVALID_PROJECT_REVISION');
      const [current, historical] = await Promise.all([
        database.getProject(user.id, projectId),
        database.getProjectRevision(user.id, projectId, revision),
      ]);
      if (!current) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      if (!historical) throw httpError(404, 'PROJECT_REVISION_NOT_FOUND', 'Project revision not found');
      return database.saveProject(user.id, {
        ...historical,
        revision: current.revision ?? 0,
        revisionId: current.revisionId ?? null,
        calculationRunId: current.calculationRunId ?? null,
        updatedAt: (config.now?.() ?? new Date()).toISOString(),
      });
    });
  });

  app.get('/api/projects/:id/calculations/:calculationRunId', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const projectId = paramValue(req.params.id);
      const calculation = await database.getCalculationRun(user.id, projectId, paramValue(req.params.calculationRunId));
      if (!calculation) throw httpError(404, 'CALCULATION_RUN_NOT_FOUND', 'Calculation run not found');
      return calculation;
    });
  });

  app.get('/api/projects/:id/share', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      if (!project.collaboration.share.enabled) return { enabled: false, project };
      return {
        enabled: true,
        mode: project.collaboration.share.mode,
        expiresAt: project.collaboration.share.expiresAt,
        path: `/shared/${createProjectShareToken(project.id, project.collaboration.share.tokenVersion, project.collaboration.share.expiresAt, config)}`,
        project,
      };
    });
  });

  app.post('/api/projects/:id/share', async (req: Request, res: Response) => {
    await handle(res, async () => {
      if (!sharingStatus(config).configured) throw httpError(503, 'PROJECT_SHARING_NOT_CONFIGURED', 'Project sharing is not configured.');
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      const now = (config.now?.() ?? new Date()).toISOString();
      const mode = req.body?.mode === 'review' ? 'review' : 'view';
      const expiresAt = shareExpiry(req.body?.expiresAt, now);
      const tokenVersion = !project.collaboration.share.enabled || req.body?.rotate === true
        ? rotateShareVersion()
        : project.collaboration.share.tokenVersion;
      const saved = await database.saveProject(user.id, {
        ...project,
        collaboration: {
          ...project.collaboration,
          share: {
            enabled: true,
            mode,
            tokenVersion,
            createdAt: project.collaboration.share.createdAt ?? now,
            expiresAt,
          },
        },
        updatedAt: now,
      });
      return {
        enabled: true,
        mode,
        expiresAt,
        path: `/shared/${createProjectShareToken(saved.id, tokenVersion, expiresAt, config)}`,
        project: saved,
      };
    });
  });

  app.delete('/api/projects/:id/share', async (req: Request, res: Response) => {
    await handle(res, async () => {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      const now = (config.now?.() ?? new Date()).toISOString();
      const saved = await database.saveProject(user.id, {
        ...project,
        collaboration: {
          ...project.collaboration,
          share: {
            ...project.collaboration.share,
            enabled: false,
            tokenVersion: rotateShareVersion(),
            expiresAt: null,
          },
        },
        updatedAt: now,
      });
      return { enabled: false, project: saved };
    });
  });

  app.get('/api/shared/projects/:token', reviewLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => publicProject((await requireSharedProject(database, paramValue(req.params.token), config)).project));
  });

  app.post('/api/shared/projects/:token/comments', reviewLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const shared = await requireSharedProject(database, paramValue(req.params.token), config, true);
      const project = shared.project;
      const now = (config.now?.() ?? new Date()).toISOString();
      const comment = createProjectComment({
        authorName: req.body?.authorName,
        message: req.body?.message,
        coordinate: req.body?.coordinate,
        target: req.body?.target,
        targetId: req.body?.targetId,
        revision: project.revision ?? 0,
        now,
      });
      const saved = await database.saveProject(shared.ownerUserId, {
        ...project,
        collaboration: {
          ...project.collaboration,
          comments: [...project.collaboration.comments, comment].slice(-MAX_PROJECT_COMMENTS),
        },
        updatedAt: now,
      });
      return publicProject(saved);
    });
  });

  app.post('/api/shared/projects/:token/review', reviewLimiter, async (req: Request, res: Response) => {
    await handle(res, async () => {
      const shared = await requireSharedProject(database, paramValue(req.params.token), config, true);
      const project = shared.project;
      const now = (config.now?.() ?? new Date()).toISOString();
      const review = requireProjectReview({
        status: req.body?.status,
        reviewerName: req.body?.reviewerName,
        note: req.body?.note,
        revision: project.revision ?? 0,
        now,
      });
      const saved = await database.saveProject(shared.ownerUserId, {
        ...project,
        collaboration: { ...project.collaboration, review },
        updatedAt: now,
      });
      return publicProject(saved);
    });
  });

  app.get('/api/projects/:id/export.geojson', async (req: Request, res: Response) => {
    try {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', `attachment; filename="${project.id}.geojson"`);
      res.json(exportProjectGeoJson(project));
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/projects/:id/export.csv', async (req: Request, res: Response) => {
    try {
      const user = await requireAuthenticatedUser(req, database, config);
      const project = await database.getProject(user.id, paramValue(req.params.id));
      if (!project) throw httpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${project.id}.csv"`);
      res.send(exportProjectCsv(project));
    } catch (error) { sendError(res, error); }
  });

  const staticRoot = config.staticRoot === undefined
    ? process.env.NODE_ENV === 'production' ? resolve(process.cwd(), 'dist') : null
    : config.staticRoot;
  if (staticRoot && existsSync(resolve(staticRoot, 'index.html'))) {
    app.use(express.static(staticRoot, { index: false }));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      return res.sendFile(resolve(staticRoot, 'index.html'));
    });
  }

  return app;
}

export async function initializeApp(config: GrowupAppConfig = {}) {
  if (!config.skipDatabaseMigration) {
    await migrateDatabase();
    await assertMongoIndexesReady();
  }
  return createApp(config);
}

async function requireSharedProject(database: GrowupDatabase, token: string, config: AuthConfig, reviewRequired = false) {
  const payload = verifyProjectShareToken(token, config);
  if (!payload) throw httpError(404, 'SHARED_PROJECT_NOT_FOUND', 'This shared project link is invalid or expired.');
  const shared = await database.getSharedProject(payload.projectId);
  if (!shared) throw httpError(404, 'SHARED_PROJECT_NOT_FOUND', 'This shared project link is no longer available.');
  const share = shared.project.collaboration.share;
  if (!share.enabled || share.tokenVersion !== payload.tokenVersion || (share.expiresAt && Date.parse(share.expiresAt) <= (config.now?.() ?? new Date()).getTime())) {
    throw httpError(404, 'SHARED_PROJECT_NOT_FOUND', 'This shared project link is no longer available.');
  }
  if (reviewRequired && share.mode !== 'review') throw httpError(403, 'SHARED_PROJECT_READ_ONLY', 'This project is shared as read-only.');
  return shared;
}

function shareExpiry(value: unknown, now: string) {
  const fallback = new Date(Date.parse(now) + 30 * 24 * 60 * 60_000).toISOString();
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fallback;
  const timestamp = Date.parse(value);
  const minimum = Date.parse(now) + 60_000;
  const maximum = Date.parse(now) + 366 * 24 * 60 * 60_000;
  if (timestamp < minimum || timestamp > maximum) throw httpError(400, 'INVALID_SHARE_EXPIRY', 'Share expiry must be between one minute and one year from now.');
  return new Date(timestamp).toISOString();
}

async function handle(res: Response, operation: () => Promise<unknown> | unknown) {
  try { res.json(await operation()); } catch (error) { sendError(res, error); }
}

function sendError(res: Response, error: unknown) {
  const normalized = normalizeError(error);
  res.status(normalized.code).json({ error: normalized });
}

function normalizeError(error: unknown): { code: number; status: string; message: string } {
  if (
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' &&
    'status' in error && typeof error.status === 'string' && 'message' in error && typeof error.message === 'string'
  ) return { code: error.code, status: error.status, message: error.message };
  return { code: 500, status: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unexpected server error' };
}

function httpError(code: number, status: string, message: string) { return { code, status, message }; }

function requireBoundary(value: unknown): SiteBoundary {
  if (!value || typeof value !== 'object' || !('polygon' in value) || !Array.isArray(value.polygon)) throw httpError(400, 'INVALID_SITE', 'A site polygon is required');
  const site = normalizeSiteBoundary(value as SiteBoundary);
  const validation = localSiteValidation(site);
  if (!validation.valid) throw httpError(422, 'INVALID_SITE_GEOMETRY', validation.reason);
  return site;
}

function requireSiteProfile(value: unknown): SiteProfile {
  if (!value || typeof value !== 'object' || !('climate' in value) || !('terrain' in value)) throw httpError(400, 'INVALID_SITE_PROFILE', 'A completed site profile is required');
  return value as SiteProfile;
}

function requireVariant(value: unknown): LayoutVariant {
  if (!value || typeof value !== 'object' || !('trees' in value) || !Array.isArray(value.trees)) throw httpError(400, 'INVALID_VARIANT', 'A generated layout variant is required');
  return value as LayoutVariant;
}

function requireSpecies(value: unknown) {
  if (!Array.isArray(value) || value.length < 3) throw httpError(400, 'INVALID_PALETTE', 'At least three species are required');
  const species = value.map((id) => DESIGN_SPECIES_BY_ID.get(String(id))).filter((item) => item !== undefined);
  if (species.length !== value.length) throw httpError(400, 'UNKNOWN_SPECIES', 'The palette contains an unknown species ID');
  return species;
}

function requireProject(value: unknown): ProjectState {
  if (!value || typeof value !== 'object' || !('id' in value) || !('site' in value)) throw httpError(400, 'INVALID_PROJECT', 'A complete project is required');
  return value as ProjectState;
}

function requireOnboardingPreference(value: unknown): OnboardingPreference {
  if (!value || typeof value !== 'object') throw httpError(400, 'INVALID_ONBOARDING_PREFERENCE', 'An onboarding preference is required.');
  const preference = value as Partial<OnboardingPreference>;
  const statuses = ['active', 'skipped', 'completed'];
  const steps = ['welcome', 'location', 'boundary', 'analysis', 'species', 'design', 'complete'];
  if (!statuses.includes(String(preference.status)) || !steps.includes(String(preference.step)) || Number.isNaN(Date.parse(String(preference.updatedAt)))) {
    throw httpError(400, 'INVALID_ONBOARDING_PREFERENCE', 'The onboarding preference is invalid.');
  }
  if (preference.projectName !== undefined && (typeof preference.projectName !== 'string' || preference.projectName.length > 120)) {
    throw httpError(400, 'INVALID_ONBOARDING_PREFERENCE', 'The onboarding project name is invalid.');
  }
  return { status: preference.status!, step: preference.step!, updatedAt: preference.updatedAt!, ...(preference.projectName ? { projectName: preference.projectName } : {}) };
}

function requireAssistantContext(value: unknown): AssistantProjectContext {
  if (!value || typeof value !== 'object' || !('selectedSpeciesIds' in value) || !Array.isArray(value.selectedSpeciesIds)) {
    throw httpError(400, 'INVALID_ASSISTANT_CONTEXT', 'The current Growup project context is required.');
  }
  return value as AssistantProjectContext;
}

function stringQuery(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function booleanQuery(value: unknown): boolean { return value === 'true' || value === '1'; }
function optionalBooleanQuery(value: unknown): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
function numberQuery(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function paramValue(value: string | string[]): string { return Array.isArray(value) ? value[0] : value; }
function integerParam(value: string | string[], status: string): number {
  const parsed = Number(paramValue(value));
  if (!Number.isInteger(parsed) || parsed < 1) throw httpError(400, status, 'A positive integer revision is required');
  return parsed;
}
