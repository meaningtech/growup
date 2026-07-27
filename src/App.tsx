import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Clock3,
  CircleDollarSign,
  CircleOff,
  CloudSun,
  Database,
  Download,
  Droplets,
  Flame,
  FlaskConical,
  FolderOpen,
  Info,
  Layers3,
  Leaf,
  LoaderCircle,
  LogIn,
  LogOut,
  LocateFixed,
  Map as MapIcon,
  Menu,
  MousePointer2,
  PencilRuler,
  Plus,
  Printer,
  Redo2,
  Route,
  Satellite,
  Save,
  ScanLine,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Sprout,
  Tractor,
  Trash2,
  TreePine,
  Undo2,
  Upload,
  Waves,
  Waypoints,
  Wind as WindIcon,
  X,
} from 'lucide-react';
import { DESIGN_SPECIES_BY_ID } from './data/designSpecies';
import { defaultEconomicConfiguration, normalizeEconomicConfiguration } from './data/economicProfiles';
import { FIREBREAK_FUEL_PRESETS, firebreakConfigurationFromFuelModel, firebreakEnvelope } from './data/firebreak';
import { MACHINERY_PRESETS, machineryConfigurationFromPreset, machineryEnvelope } from './data/machinery';
import { disabledFirebreakPlan } from './lib/firebreak';
import { defaultFireOperationsPlan, effisFireWeatherTile, normalizeFireOperationsPlan } from './lib/fireOperations';
import { assessFireScreening, type FireScreeningComponentId } from './lib/fireRisk';
import { defaultProjectCollaboration, normalizeProjectCollaboration } from './lib/collaboration';
import { growthState } from './lib/growth';
import { DEFAULT_IRRIGATION_CONFIGURATION, normalizeIrrigationConfiguration } from './lib/irrigation';
import { SITE_PROFILE_OVERRIDE_DEFINITIONS, overrideValue } from './lib/siteOverrides';
import { createLocalProjection, haversineM, pointInPolygon, polygonCentroid } from './lib/geometry';
import { DEFAULT_DESIGN_CONFIGURATION, normalizeDesignConfiguration } from './lib/layout';
import { buildOperationalSchedule, type OperationalSchedule } from './lib/schedule';
import { projectAnalysisFingerprint } from './lib/projectAnalysis';
import {
  distanceToSiteBoundaryM,
  distanceToSitePathM,
  importSiteGeoJson,
  localSiteValidation,
  normalizeSiteBoundary,
  siteContainsCoordinate,
  sitePolygons,
} from './lib/siteGeometry';
import { coordinateFromLatLng, coordinatesFromPath, loadGoogleMaps, sitePreviewBounds } from './googleMaps';
import { renderGoogleSignIn } from './googleIdentity';
import { SUPPORTED_LOCALES, useI18n, type Locale } from './i18n';
import {
  isOnboardingLocationReady,
  latestOnboardingPreference,
  newOnboardingPreference,
  normalizeOnboardingPreference,
  readOnboardingPreference,
  writeOnboardingPreference,
  type OnboardingPreference,
  type OnboardingStep,
} from './onboarding';
import type {
  AssistantAction,
  AssistantProjectContext,
  AssistantProposal,
  CatalogueSpecies,
  Coordinate,
  DesignConfiguration,
  DesignSpecies,
  EconomicConfiguration,
  Evidence,
  EstablishmentCost,
  IrrigationEstimate,
  IrrigationConfiguration,
  LayoutVariant,
  LocationSearchResult,
  ProjectState,
  ProjectAnalysisReport,
  ProjectCollaboration,
  FireOperationsPlan,
  FireMaintenanceTask,
  ProjectRevisionSummary,
  SiteBoundary,
  SiteProfile,
  SiteProfileOverrideField,
  SiteValidation,
  SoilPropertyEstimate,
  SoilPropertyEstimateKey,
  SpeciesRecommendation,
  SuitabilityComponent,
  TreeInstance,
  WindClimatologyPeriod,
} from './types';

type WorkspaceSection = 'site' | 'profile' | 'species' | 'layout' | 'water' | 'fire' | 'costs' | 'analysis';
type DrawMode = 'idle' | 'site' | 'hole' | 'exclusion' | 'path' | 'access-point' | 'water-point' | 'existing-tree' | 'edit-site' | 'edit-constraints' | 'add-tree' | 'move-tree';

type AppConfig = {
  googleMapsApiKey: string;
  initialMapViewport: {
    center: Coordinate;
    zoom: number;
  };
  climatePeriod: string;
  modelVersion: string;
  assistant: { configured: boolean; interface: 'openai-compatible' };
  auth: { configured: boolean; googleClientId: string };
  sharing: { configured: boolean };
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
  locale: string | null;
  preferences: { onboarding?: OnboardingPreference };
};

type AuthSession = { authenticated: boolean; configured: boolean; user: AuthUser | null };
type ProjectSummary = Pick<ProjectState, 'id' | 'name' | 'updatedAt'>;
type ShareResponse = {
  enabled: boolean;
  mode?: 'view' | 'review';
  expiresAt?: string | null;
  path?: string;
  project: ProjectState;
};
type SaveStatus = 'idle' | 'local' | 'unsaved' | 'saving' | 'saved' | 'conflict';

type CatalogueStats = {
  total: number;
  treeLike: number;
  globUnt: number;
  designReady: number;
};

type CatalogueFilters = {
  treeOnly: boolean;
  globUntOnly: boolean;
  designReadyOnly: boolean;
  stratum: string;
  succession: string;
  role: string;
  evergreen: '' | 'true' | 'false';
  nitrogenFixer: '' | 'true' | 'false';
  droughtMinimum: number;
  evidenceMinimum: number;
};

const STEPS: Array<{ id: WorkspaceSection; label: string; icon: typeof MapIcon }> = [
  { id: 'site', label: 'Site', icon: MapIcon },
  { id: 'profile', label: 'Evidence', icon: FlaskConical },
  { id: 'species', label: 'Species', icon: Leaf },
  { id: 'layout', label: 'Design', icon: TreePine },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'fire', label: 'Fire', icon: Flame },
  { id: 'costs', label: 'Costs', icon: CircleDollarSign },
  { id: 'analysis', label: 'Analysis', icon: ClipboardCheck },
];

export default function App() {
  const sharedToken = window.location.pathname.match(/^\/shared\/([^/]+)$/)?.[1] ?? null;
  return sharedToken ? <SharedProjectPage token={sharedToken} /> : <WorkspaceApp />;
}

function SharedProjectPage({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const [project, setProject] = useState<ProjectState | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [message, setMessage] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [commentCoordinate, setCommentCoordinate] = useState<Coordinate | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  useEffect(() => {
    Promise.all([api<AppConfig>('/api/config'), api<ProjectState>(`/api/shared/projects/${token}`)])
      .then(([appConfig, sharedProject]) => {
        setConfig(appConfig);
        setProject(sharedProject);
      })
      .catch((loadError) => setError(messageOf(loadError)));
  }, [token]);

  useEffect(() => {
    if (!config || !project || !mapElementRef.current) return;
    let cancelled = false;
    loadGoogleMaps(config.googleMapsApiKey).then((maps) => {
      if (cancelled || !mapElementRef.current) return;
      const map = new maps.Map(mapElementRef.current, {
        mapTypeId: 'satellite',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
      });
      mapRef.current = map;
      overlaysRef.current.push(new maps.Polygon({
        map,
        paths: project.site.polygon,
        strokeColor: '#f7f2df',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#96aa49',
        fillOpacity: 0.16,
      }));
      const variant = project.variants.find((item) => item.id === project.selectedVariantId) ?? project.variants[0];
      for (const tree of variant?.trees ?? []) {
        const species = DESIGN_SPECIES_BY_ID.get(tree.speciesId);
        if (!species) continue;
        overlaysRef.current.push(new maps.Circle({
          map,
          center: tree.coordinate,
          radius: 1.2,
          strokeColor: '#ffffff',
          strokeOpacity: 0.8,
          strokeWeight: 1,
          fillColor: species.color,
          fillOpacity: 0.82,
          clickable: false,
        }));
      }
      for (const line of variant?.firebreak?.lines ?? []) {
        overlaysRef.current.push(new maps.Polygon({
          map,
          paths: corridorSegmentPolygon(line.points[0], line.points[line.points.length - 1], line.widthM),
          strokeColor: '#ffb15c',
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: '#ef6a3b',
          fillOpacity: 0.42,
          clickable: false,
        }));
      }
      for (const comment of project.collaboration.comments.filter((item) => item.coordinate)) {
        overlaysRef.current.push(new maps.Marker({
          map,
          position: comment.coordinate,
          title: `${comment.authorName}: ${comment.message}`,
          label: { text: '●', color: '#ffffff', fontSize: '11px' },
        }));
      }
      map.fitBounds(sitePreviewBounds(project.site.polygon));
      if (project.collaboration.share.mode === 'review') {
        map.addListener('click', (event: any) => event.latLng && setCommentCoordinate(coordinateFromLatLng(event.latLng)));
      }
    }).catch((mapError) => setError(messageOf(mapError)));
    return () => {
      cancelled = true;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [config, project]);

  async function submitComment() {
    if (!reviewerName.trim() || !message.trim()) return;
    setBusy(true);
    try {
      const updated = await api<ProjectState>(`/api/shared/projects/${token}/comments`, post({
        authorName: reviewerName,
        message,
        coordinate: commentCoordinate,
        target: commentCoordinate ? 'general' : 'general',
      }));
      setProject(updated);
      setMessage('');
      setCommentCoordinate(null);
    } catch (submitError) {
      setError(messageOf(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(status: 'approved' | 'changes-requested') {
    if (!reviewerName.trim()) return;
    setBusy(true);
    try {
      setProject(await api<ProjectState>(`/api/shared/projects/${token}/review`, post({ status, reviewerName, note: reviewNote })));
    } catch (submitError) {
      setError(messageOf(submitError));
    } finally {
      setBusy(false);
    }
  }

  if (error && !project) return <main className="shared-error"><Sprout size={28} /><h1>{t('shared.unavailable')}</h1><p>{error}</p></main>;
  if (!project) return <main className="shared-loading"><LoaderCircle className="spin" size={26} /><span>{t('busy.loading')}</span></main>;
  const variant = project.variants.find((item) => item.id === project.selectedVariantId) ?? project.variants[0] ?? null;
  const canReview = project.collaboration.share.mode === 'review';
  return <main className="shared-project">
    <header><span className="brand-mark"><Sprout size={21} /></span><span><small>{t('shared.eyebrow')}</small><strong>{project.name}</strong></span><i>r{project.revision ?? 0}</i></header>
    <section className="shared-map"><div ref={mapElementRef} /><span><MousePointer2 size={14} />{canReview ? t('shared.mapHint') : t('shared.readOnly')}</span></section>
    <aside>
      <div className="shared-summary"><small>{t('shared.summary')}</small><h1>{project.site.name}</h1><p>{project.siteProfile?.location.displayName ?? t('shared.locationUnavailable')}</p><div><span><strong>{variant?.trees.length ?? 0}</strong><small>{t('shared.plants')}</small></span><span><strong>{variant?.firebreak?.enabled ? `${formatNumber(variant.firebreak.plannedWidthM, 1)} m` : '—'}</strong><small>{t('shared.firebreak')}</small></span><span><strong>{project.timelineYear}</strong><small>{t('timeline.year')}</small></span></div></div>
      {project.collaboration.review && <div className={`shared-decision ${project.collaboration.review.status}`}><ClipboardCheck size={18} /><span><small>{t('sharing.reviewStatus')}</small><strong>{t(`sharing.status.${project.collaboration.review.status}`)}</strong><p>{project.collaboration.review.reviewerName} · {shortDate(project.collaboration.review.updatedAt, locale)}</p></span></div>}
      <div className="shared-comments"><header><strong>{t('sharing.comments')}</strong><small>{project.collaboration.comments.length}</small></header>{project.collaboration.comments.map((comment) => <article key={comment.id}><span><strong>{comment.authorName}</strong><small>r{comment.revision} · {shortDate(comment.createdAt, locale)}</small></span><p>{comment.message}</p>{comment.coordinate && <i><MapIcon size={12} />{t('shared.pinned')}</i>}</article>)}</div>
      {canReview && <div className="shared-review-form">
        <label><span>{t('shared.yourName')}</span><input maxLength={100} value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} /></label>
        <label><span>{t('shared.comment')}</span><textarea maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        {commentCoordinate && <small className="shared-pin"><LocateFixed size={13} />{t('shared.pinReady')}</small>}
        <button disabled={busy || !reviewerName.trim() || !message.trim()} onClick={() => void submitComment()}><Send size={14} />{t('shared.addComment')}</button>
        <label><span>{t('shared.reviewNote')}</span><textarea maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>
        <div><button className="request" disabled={busy || !reviewerName.trim()} onClick={() => void submitReview('changes-requested')}>{t('sharing.requestChanges')}</button><button className="approve" disabled={busy || !reviewerName.trim()} onClick={() => void submitReview('approved')}><Check size={14} />{t('sharing.approve')}</button></div>
      </div>}
    </aside>
  </main>;
}

function WorkspaceApp() {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [catalogueStats, setCatalogueStats] = useState<CatalogueStats | null>(null);
  const [site, setSite] = useState<SiteBoundary | null>(null);
  const [siteValidation, setSiteValidation] = useState<SiteValidation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([]);
  const [locationSelected, setLocationSelected] = useState(false);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null);
  const [recommendations, setRecommendations] = useState<SpeciesRecommendation[]>([]);
  const [selectedSpeciesIds, setSelectedSpeciesIds] = useState<string[]>([]);
  const [designConfiguration, setDesignConfiguration] = useState<DesignConfiguration>(DEFAULT_DESIGN_CONFIGURATION);
  const [variants, setVariants] = useState<LayoutVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [timelineYear, setTimelineYear] = useState(5);
  const [irrigation, setIrrigation] = useState<IrrigationEstimate | null>(null);
  const [irrigationConfiguration, setIrrigationConfiguration] = useState<IrrigationConfiguration>(DEFAULT_IRRIGATION_CONFIGURATION);
  const [economicConfiguration, setEconomicConfiguration] = useState<EconomicConfiguration>(() => defaultEconomicConfiguration(''));
  const [costs, setCosts] = useState<EstablishmentCost | null>(null);
  const [fireOperations, setFireOperations] = useState<FireOperationsPlan>(() => defaultFireOperationsPlan());
  const [projectAnalysis, setProjectAnalysis] = useState<ProjectAnalysisReport | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<ProjectCollaboration>(() => defaultProjectCollaboration());
  const [section, setSection] = useState<WorkspaceSection>('site');
  const [drawMode, setDrawMode] = useState<DrawMode>('idle');
  const [draftPoints, setDraftPoints] = useState<Coordinate[]>([]);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [selectedTreeIds, setSelectedTreeIds] = useState<string[]>([]);
  const [treeSpeciesId, setTreeSpeciesId] = useState<string>('');
  const [showNdmi, setShowNdmi] = useState(false);
  const [showWaterSamples, setShowWaterSamples] = useState(false);
  const [showExistingVegetation, setShowExistingVegetation] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showNoPlantAreas, setShowNoPlantAreas] = useState(true);
  const [showManagementPaths, setShowManagementPaths] = useState(true);
  const [showInfrastructure, setShowInfrastructure] = useState(true);
  const [showObservedTrees, setShowObservedTrees] = useState(true);
  const [showPlannedTrees, setShowPlannedTrees] = useState(true);
  const [showMachinery, setShowMachinery] = useState(true);
  const [showFirebreaks, setShowFirebreaks] = useState(true);
  const [showFireWeather, setShowFireWeather] = useState(false);
  const [showWind, setShowWind] = useState(true);
  const [showIrrigation, setShowIrrigation] = useState(true);
  const [editingIrrigation, setEditingIrrigation] = useState(false);
  const [busy, setBusy] = useState<string | null>(() => t('busy.loading'));
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueResults, setCatalogueResults] = useState<CatalogueSpecies[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantProposal, setAssistantProposal] = useState<AssistantProposal | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clearSiteOpen, setClearSiteOpen] = useState(false);
  const [projectName, setProjectName] = useState(() => readOnboardingPreference(window.localStorage)?.projectName ?? t('project.newTitle'));
  const [projectId, setProjectId] = useState(() => `growup-${crypto.randomUUID().slice(0, 8)}`);
  const [projectRevision, setProjectRevision] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevisionSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<ProjectState | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingPreference | null>(() => readOnboardingPreference(window.localStorage) ?? newOnboardingPreference());
  const createdAtRef = useRef(new Date().toISOString());
  const projectRevisionRef = useRef(0);
  const dirtySerialRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const suppressDirtyRef = useRef(false);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const fittedSiteRef = useRef<string | null>(null);
  const boundaryRef = useRef<any[]>([]);
  const exclusionsRef = useRef<any[]>([]);
  const existingVegetationRef = useRef<any[]>([]);
  const draftOverlayRef = useRef<any>(null);
  const draftPointOverlaysRef = useRef<any[]>([]);
  const treeOverlaysRef = useRef<any[]>([]);
  const machineryOverlaysRef = useRef<any[]>([]);
  const firebreakOverlaysRef = useRef<any[]>([]);
  const fireWeatherOverlayRef = useRef<any>(null);
  const windOverlaysRef = useRef<any[]>([]);
  const waterOverlaysRef = useRef<any[]>([]);
  const irrigationNetworkOverlaysRef = useRef<any[]>([]);
  const ndmiOverlayRef = useRef<any>(null);
  const mapClickRef = useRef<(coordinate: Coordinate) => void>(() => undefined);
  const undoRef = useRef<TreeInstance[][]>([]);
  const redoRef = useRef<TreeInstance[][]>([]);
  const siteUndoRef = useRef<Array<SiteBoundary | null>>([]);
  const siteRedoRef = useRef<Array<SiteBoundary | null>>([]);
  const recommendationObjectiveRef = useRef(JSON.stringify(DEFAULT_DESIGN_CONFIGURATION.objectives));
  const projectNameEditedRef = useRef(Boolean(readOnboardingPreference(window.localStorage)?.projectName));

  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null,
    [selectedVariantId, variants],
  );
  const selectedSpecies = useMemo(
    () => selectedSpeciesIds.map((id) => DESIGN_SPECIES_BY_ID.get(id)).filter((item): item is DesignSpecies => Boolean(item)),
    [selectedSpeciesIds],
  );
  const selectedTree = selectedVariant?.trees.find((tree) => tree.id === selectedTreeId) ?? null;

  useEffect(() => {
    Promise.all([api<AppConfig>('/api/config'), api<CatalogueStats>('/api/catalog/stats'), api<AuthSession>('/api/auth/session')])
      .then(([appConfig, stats, session]) => {
        setConfig(appConfig);
        setCatalogueStats(stats);
        const localOnboarding = readOnboardingPreference(window.localStorage);
        const remoteOnboarding = normalizeOnboardingPreference(session.user?.preferences?.onboarding);
        const resolvedOnboarding = latestOnboardingPreference(localOnboarding, remoteOnboarding) ?? newOnboardingPreference();
        setAuthUser(session.user);
        setOnboarding(resolvedOnboarding);
        if (resolvedOnboarding.projectName) {
          projectNameEditedRef.current = true;
          setProjectName(resolvedOnboarding.projectName);
        }
        writeOnboardingPreference(window.localStorage, resolvedOnboarding);
        if (session.user && resolvedOnboarding.updatedAt !== remoteOnboarding?.updatedAt) {
          void api<AuthUser>('/api/user/preferences/onboarding', put(resolvedOnboarding))
            .then(setAuthUser)
            .catch((syncError) => setError(messageOf(syncError)));
        }
        if (session.user) void refreshProjects();
        setBusy(null);
      })
      .catch((loadError) => {
        setError(messageOf(loadError));
        setBusy(null);
      });
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('growup:draft:v2');
      if (!stored) return;
      const parsed = JSON.parse(stored) as ProjectState;
      if (parsed?.site?.polygon?.length >= 3) setRecoveryDraft(parsed);
    } catch {
      window.localStorage.removeItem('growup:draft:v2');
    }
  }, []);

  useEffect(() => {
    if (!onboarding) return;
    try {
      writeOnboardingPreference(window.localStorage, onboarding);
    } catch {
      setError(t('onboarding.storageError'));
    }
  }, [onboarding, t]);

  useEffect(() => {
    if (!site) return;
    if (suppressDirtyRef.current) {
      suppressDirtyRef.current = false;
      return;
    }
    const serial = ++dirtySerialRef.current;
    setSaveStatus(authUser ? 'unsaved' : 'local');
    const timer = window.setTimeout(() => {
      const snapshot = currentProjectState(new Date().toISOString());
      if (!snapshot) return;
      try {
        window.localStorage.setItem('growup:draft:v2', JSON.stringify(snapshot));
      } catch {
        setError(t('errors.localDraftStorage'));
      }
      if (authUser) queueProjectSave(snapshot, serial);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [projectName, site, siteProfile, selectedSpeciesIds, designConfiguration, irrigationConfiguration, economicConfiguration, variants, selectedVariantId, timelineYear, irrigation, costs, fireOperations, projectAnalysis, collaboration, authUser]);

  useEffect(() => {
    if (!projectNameEditedRef.current) setProjectName(t('project.newTitle'));
  }, [locale, t]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      document.documentElement.style.setProperty('--growup-viewport-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
    };
    updateViewportHeight();
    viewport?.addEventListener('resize', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);
    return () => {
      viewport?.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
      document.documentElement.style.removeProperty('--growup-viewport-height');
    };
  }, []);

  useEffect(() => {
    if (!notice || busy || error) return;
    const timeout = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [notice, busy, error]);

  useEffect(() => {
    if (!guidance || busy || error || notice) return;
    const timeout = window.setTimeout(() => setGuidance(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [guidance, busy, error, notice]);

  useEffect(() => {
    if (guidance && (busy || error || notice)) setGuidance(null);
  }, [guidance, busy, error, notice]);

  useEffect(() => {
    if (onboarding?.status !== 'active') return;
    if (onboarding.step === 'boundary' && site) {
      updateOnboarding('active', 'analysis');
      setSection('site');
    } else if (onboarding.step === 'analysis' && siteProfile) {
      updateOnboarding('active', 'species');
      setSection('species');
    } else if (onboarding.step === 'species' && selectedVariant) {
      updateOnboarding('active', 'design');
      setSection('layout');
    } else if (onboarding.step === 'design' && irrigation && costs) {
      updateOnboarding('active', 'complete');
      setSection('costs');
    }
  }, [onboarding?.status, onboarding?.step, site, siteProfile, selectedVariant, irrigation, costs]);

  useEffect(() => {
    if (onboarding?.status !== 'active' || onboarding.step !== 'location') return;
    setSection('site');
    const timer = window.setTimeout(() => {
      document.querySelector('.location-search')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [onboarding?.status, onboarding?.step]);

  useEffect(() => {
    if (!irrigation || irrigation.designYear === timelineYear || !site || !siteProfile || !selectedVariant) return;
    const timer = window.setTimeout(() => {
      void recalculateWaterAndCosts(site, irrigationConfiguration, timelineYear, t('notices.timelineRecalculated', { year: timelineYear }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [timelineYear, irrigation?.designYear]);

  useEffect(() => {
    const objectiveKey = JSON.stringify(designConfiguration.objectives);
    if (!siteProfile || objectiveKey === recommendationObjectiveRef.current) return;
    recommendationObjectiveRef.current = objectiveKey;
    const timeout = window.setTimeout(() => {
      api<{ recommendations: SpeciesRecommendation[] }>('/api/recommendations', post({ siteProfile, objectives: designConfiguration.objectives }))
        .then((result) => setRecommendations(result.recommendations))
        .catch((rankingError) => setError(messageOf(rankingError)));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [designConfiguration.objectives, siteProfile]);

  useEffect(() => {
    if (!config || !mapElementRef.current || mapRef.current) return;
    loadGoogleMaps(config.googleMapsApiKey)
      .then((maps) => {
        const map = new maps.Map(mapElementRef.current, {
          center: config.initialMapViewport.center,
          zoom: config.initialMapViewport.zoom,
          mapTypeId: 'satellite',
          tilt: 0,
          heading: 0,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
          scaleControl: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.addListener('click', (event: any) => {
          if (event.latLng) mapClickRef.current(coordinateFromLatLng(event.latLng));
        });
        map.addListener('idle', () => {
          const zoom = map.getZoom();
          if (mapElementRef.current) mapElementRef.current.dataset.zoom = String(zoom ?? '');
          setMapZoom(typeof zoom === 'number' ? zoom : null);
        });
        mapRef.current = map;
        setMapReady(true);
        setMapError(null);
      })
      .catch((mapsError) => setMapError(messageOf(mapsError)));
  }, [config, site]);

  useEffect(() => {
    if (!site) {
      setSiteValidation(null);
      return;
    }
    const local = localSiteValidation(site);
    if (!local.valid) {
      setSiteValidation(null);
      setError(localizedDomainMessage(local.reason, t));
      return;
    }
    const timer = window.setTimeout(() => {
      api<SiteValidation>('/api/site/validate', post(site))
        .then((validation) => {
          setSiteValidation(validation);
          if (!validation.valid) setError(localizedDomainMessage(validation.reason, t));
        })
        .catch((validationError) => setError(messageOf(validationError)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [site]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !site) return;
    boundaryRef.current.forEach((overlay) => overlay.setMap(null));
    boundaryRef.current = showBoundary ? sitePolygons(site).map((polygon, index) => new maps.Polygon({
      map,
      paths: polygon,
      strokeColor: '#f0c36b',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#b8d96f',
      fillOpacity: 0.13,
      editable: drawMode === 'edit-site' && index === 0,
      zIndex: 10,
    })) : [];
    if (showBoundary && drawMode === 'edit-site') {
      const path = boundaryRef.current[0].getPath();
      const sync = () => {
        const polygon = coordinatesFromPath(path);
        if (polygon.length >= 3) invalidateSite({ ...site, polygon });
      };
      path.addListener('set_at', sync);
      path.addListener('insert_at', sync);
      path.addListener('remove_at', sync);
    }
    const bounds = new maps.LatLngBounds();
    sitePolygons(site).flat().forEach((point) => bounds.extend(point));
    if (!bounds.isEmpty() && fittedSiteRef.current !== site.id) {
      map.fitBounds(bounds, 72);
      fittedSiteRef.current = site.id;
    }
    return () => boundaryRef.current.forEach((overlay) => overlay.setMap(null));
  }, [site?.polygon, site?.additionalPolygons, drawMode, mapReady, showBoundary]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !site) return;
    exclusionsRef.current.forEach((overlay) => overlay.setMap(null));
    const constraintPolygons = showNoPlantAreas
      ? [...site.holes.map((polygon, index) => ({ polygon, kind: 'hole' as const, index })), ...site.exclusions.map((polygon, index) => ({ polygon, kind: 'exclusion' as const, index }))]
      : [];
    const polygonOverlays = constraintPolygons.map(({ polygon, kind, index }) => {
      const overlay = new maps.Polygon({
        map,
        paths: polygon,
        strokeColor: kind === 'hole' ? '#e7a84d' : '#ef775d',
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: kind === 'hole' ? '#6e4d1f' : '#b94031',
        fillOpacity: 0.3,
        editable: drawMode === 'edit-constraints',
        zIndex: 12,
      });
      if (drawMode === 'edit-constraints') {
        const path = overlay.getPath();
        const sync = () => {
          const nextPolygon = coordinatesFromPath(path);
          if (nextPolygon.length < 3) return;
          if (kind === 'hole') invalidateSite({ ...site, holes: site.holes.map((item, itemIndex) => itemIndex === index ? nextPolygon : item) });
          if (kind === 'exclusion') invalidateSite({ ...site, exclusions: site.exclusions.map((item, itemIndex) => itemIndex === index ? nextPolygon : item) });
        };
        path.addListener('set_at', sync);
        path.addListener('insert_at', sync);
        path.addListener('remove_at', sync);
      }
      return overlay;
    });
    const pathOverlays = (showManagementPaths ? site.paths : []).map((path, index) => {
      const overlay = new maps.Polyline({ map, path: path.points, strokeColor: '#f7e6a5', strokeOpacity: 0.95, strokeWeight: Math.max(3, Math.min(12, path.widthM * 1.7)), editable: drawMode === 'edit-constraints', zIndex: 13 });
      if (drawMode === 'edit-constraints') {
        const overlayPath = overlay.getPath();
        const sync = () => {
          const points = coordinatesFromPath(overlayPath);
          if (points.length >= 2) invalidateSite({ ...site, paths: site.paths.map((item, itemIndex) => itemIndex === index ? { ...item, points } : item) });
        };
        overlayPath.addListener('set_at', sync);
        overlayPath.addListener('insert_at', sync);
        overlayPath.addListener('remove_at', sync);
      }
      return overlay;
    });
    const pointOverlays = [
      ...(showInfrastructure ? site.accessPoints.map((point) => ({ point, kind: 'access' as const, label: 'A', color: '#f0c36b' })) : []),
      ...(showInfrastructure ? site.waterPoints.map((point) => ({ point, kind: 'water' as const, label: 'W', color: '#62c8bd' })) : []),
      ...(showObservedTrees ? site.existingTrees.map((point) => ({ point, kind: 'tree' as const, label: 'T', color: '#d7ff83' })) : []),
    ].map(({ point, kind, label, color }) => {
      const marker = new maps.Marker({
        map,
        position: point.coordinate,
        clickable: kind === 'water',
        draggable: kind === 'water',
        cursor: kind === 'water' ? 'grab' : undefined,
        title: kind === 'water' ? t('map.dragWaterSource') : undefined,
        label: { text: label, color: '#17351f', fontSize: '9px', fontWeight: '700' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: color, fillOpacity: 1, strokeColor: '#17351f', strokeWeight: 2 },
        zIndex: 15,
      });
      if (kind === 'water') marker.addListener('dragend', (event: any) => {
        if (!event.latLng) return;
        const coordinate = coordinateFromLatLng(event.latLng);
        if (!siteContainsCoordinate(site, coordinate)) {
          marker.setPosition(point.coordinate);
          showBoundaryGuidance();
          return;
        }
        void relocateWaterSource(coordinate, point.id);
      });
      return marker;
    });
    exclusionsRef.current = [...polygonOverlays, ...pathOverlays, ...pointOverlays];
    return () => exclusionsRef.current.forEach((overlay) => overlay.setMap(null));
  }, [site?.holes, site?.exclusions, site?.paths, site?.accessPoints, site?.waterPoints, site?.existingTrees, drawMode, showNoPlantAreas, showManagementPaths, showInfrastructure, showObservedTrees]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    existingVegetationRef.current.forEach((overlay) => overlay.setMap(null));
    existingVegetationRef.current = [];
    const patches = showExistingVegetation ? siteProfile?.satellite.existingVegetation.patches ?? [] : [];
    patches.forEach((patch, index) => {
      const overlay = new maps.Polygon({
        map,
        paths: patch.polygon,
        strokeColor: patch.confidence === 'high' ? '#d7ff83' : '#f0c36b',
        strokeOpacity: 1,
        strokeWeight: 4,
        fillColor: '#153f2c',
        fillOpacity: 0.62,
        clickable: false,
        zIndex: 16,
      });
      const marker = new maps.Marker({
        map,
        position: patch.centroid,
        clickable: false,
        zIndex: 18,
        label: { text: `E${index + 1}`, color: '#17351f', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: '700' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#d7ff83', fillOpacity: 1, strokeColor: '#17351f', strokeWeight: 2 },
      });
      existingVegetationRef.current.push(overlay, marker);
    });
    return () => existingVegetationRef.current.forEach((overlay) => overlay.setMap(null));
  }, [showExistingVegetation, siteProfile?.satellite.existingVegetation.patches]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    draftOverlayRef.current?.setMap(null);
    draftPointOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    draftPointOverlaysRef.current = [];
    if (draftPoints.length) {
      draftOverlayRef.current = drawMode !== 'path' && draftPoints.length >= 3
        ? new maps.Polygon({ map, paths: draftPoints, strokeColor: '#ffffff', strokeWeight: 2, fillColor: '#ffffff', fillOpacity: 0.12, zIndex: 50 })
        : new maps.Polyline({ map, path: draftPoints, strokeColor: '#ffffff', strokeWeight: 3, zIndex: 50 });
      draftPointOverlaysRef.current = draftPoints.map((point, index) => new maps.Marker({
        map,
        position: point,
        clickable: false,
        zIndex: 60 + index,
        label: { text: String(index + 1), color: '#10281e', fontFamily: 'DM Mono, monospace', fontSize: '9px', fontWeight: '700' },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: index === draftPoints.length - 1 ? 11 : 9,
          fillColor: index === 0 ? '#c7e36f' : index === draftPoints.length - 1 ? '#ffffff' : '#f0c36b',
          fillOpacity: 1,
          strokeColor: '#10281e',
          strokeWeight: index === draftPoints.length - 1 ? 3 : 2,
        },
      }));
    }
    return () => {
      draftOverlayRef.current?.setMap(null);
      draftPointOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    };
  }, [draftPoints, drawMode]);

  useEffect(() => {
    const drawing = isGeometryDrawMode(drawMode);
    mapRef.current?.setOptions({ draggableCursor: drawing ? 'crosshair' : null, draggingCursor: drawing ? 'crosshair' : null });
  }, [drawMode]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    machineryOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    machineryOverlaysRef.current = [];
    if (!selectedVariant?.machinery.enabled || !showMachinery) return;
    for (const corridor of selectedVariant.machinery.corridors) {
      for (let index = 0; index < corridor.points.length - 1; index += 1) {
        machineryOverlaysRef.current.push(new maps.Polygon({
          map,
          paths: corridorSegmentPolygon(corridor.points[index], corridor.points[index + 1], corridor.widthM),
          strokeColor: '#10281e',
          strokeOpacity: 0.92,
          strokeWeight: 2,
          fillColor: '#ff6b3d',
          fillOpacity: 0.55,
          clickable: false,
          zIndex: 18,
        }));
      }
      machineryOverlaysRef.current.push(new maps.Polyline({
        map,
        path: corridor.points,
        strokeColor: '#fff2c2',
        strokeOpacity: 0,
        strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: '#fff2c2', strokeOpacity: 1, strokeWeight: 2, scale: 2 }, offset: '0', repeat: '14px' }],
        clickable: false,
        zIndex: 19,
      }));
    }
    for (const area of selectedVariant.machinery.turningAreas) {
      machineryOverlaysRef.current.push(new maps.Circle({
        map,
        center: area.center,
        radius: area.radiusM,
        strokeColor: '#10281e',
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: '#ff6b3d',
        fillOpacity: 0.48,
        clickable: false,
        zIndex: 18,
      }));
    }
    return () => machineryOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [selectedVariant?.machinery, showMachinery]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    firebreakOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    firebreakOverlaysRef.current = [];
    if (!selectedVariant?.firebreak?.enabled || !showFirebreaks) return;
    for (const line of selectedVariant.firebreak.lines) {
      const priority = line.priority === 'windward';
      firebreakOverlaysRef.current.push(new maps.Polygon({
        map,
        paths: corridorSegmentPolygon(line.points[0], line.points[line.points.length - 1], line.widthM),
        strokeColor: priority ? '#7d2917' : '#613b12',
        strokeOpacity: 0.92,
        strokeWeight: priority ? 2.5 : 1.5,
        fillColor: priority ? '#f06f3c' : '#e9b44c',
        fillOpacity: priority ? 0.54 : 0.42,
        clickable: false,
        zIndex: 17,
      }));
      firebreakOverlaysRef.current.push(new maps.Polyline({
        map,
        path: line.points,
        strokeColor: priority ? '#fff3d3' : '#fff8e8',
        strokeOpacity: 0,
        strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: priority ? '#fff3d3' : '#fff8e8', strokeOpacity: 0.95, strokeWeight: 1.5, scale: 2 }, offset: '0', repeat: '12px' }],
        clickable: false,
        zIndex: 18,
      }));
    }
    return () => firebreakOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [selectedVariant?.firebreak, showFirebreaks]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    fireWeatherOverlayRef.current?.setMap(null);
    fireWeatherOverlayRef.current = null;
    if (!map || !maps || !site || !showFireWeather) return;
    const tile = effisFireWeatherTile(site, fireOperations.sourceSnapshot.forecastDate);
    fireWeatherOverlayRef.current = new maps.GroundOverlay(
      tile.url,
      tile.bounds,
      { opacity: 0.58, clickable: false },
    );
    fireWeatherOverlayRef.current.setMap(map);
    return () => fireWeatherOverlayRef.current?.setMap(null);
  }, [site, showFireWeather, fireOperations.sourceSnapshot.forecastDate]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    windOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    windOverlaysRef.current = [];
    const direction = siteProfile?.solar.prevailingWindDirectionDegrees;
    if (!showWind || siteProfile?.solar.status !== 'available' || direction === null || direction === undefined) return;
    const [source, destination] = windVectorCoordinates(
      siteProfile.centroid,
      direction,
      Math.max(35, Math.sqrt(siteProfile.areaM2) * 0.75),
    );
    windOverlaysRef.current.push(new maps.Polyline({
      map,
      path: [source, destination],
      strokeColor: '#1f7f89',
      strokeOpacity: 0.9,
      strokeWeight: 5,
      icons: [{
        icon: {
          path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: '#d7ff83',
          fillOpacity: 1,
          strokeColor: '#113c39',
          strokeOpacity: 1,
          strokeWeight: 1.5,
          scale: 5,
        },
        offset: '100%',
      }],
      clickable: false,
      zIndex: 20,
    }));
    windOverlaysRef.current.push(new maps.Circle({
      map,
      center: source,
      radius: Math.max(2, Math.sqrt(siteProfile.areaM2) * 0.035),
      strokeColor: '#ffffff',
      strokeOpacity: 0.95,
      strokeWeight: 2,
      fillColor: '#1f7f89',
      fillOpacity: 0.9,
      clickable: false,
      zIndex: 21,
    }));
    return () => windOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [showWind, siteProfile]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    treeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    treeOverlaysRef.current = [];
    if (!selectedVariant || !showPlannedTrees) return;
    for (const tree of selectedVariant.trees) {
      const species = DESIGN_SPECIES_BY_ID.get(tree.speciesId);
      if (!species) continue;
      const state = growthState(species, tree, timelineYear);
      if (!state.active) continue;
      const selected = tree.id === selectedTreeId || selectedTreeIds.includes(tree.id);
      const crown = new maps.Circle({
        map,
        center: tree.coordinate,
        radius: Math.max(0.35, state.crownDiameterM / 2),
        strokeColor: selected ? '#ffffff' : species.color,
        strokeOpacity: selected ? 1 : 0.82,
        strokeWeight: selected ? 3 : tree.locked ? 2 : 1,
        fillColor: species.color,
        fillOpacity: selected ? 0.78 : 0.5,
        clickable: true,
        zIndex: selected ? 45 : 20 + stratumOrder(species.stratum),
      });
      crown.addListener('click', (event: any) => {
        setSelectedTreeId(tree.id);
        setSelectedTreeIds((ids) => event?.domEvent?.shiftKey
          ? ids.includes(tree.id) ? ids.filter((id) => id !== tree.id) : [...ids, tree.id]
          : [tree.id]);
        setTreeSpeciesId(tree.speciesId);
      });
      treeOverlaysRef.current.push(crown);
    }
    return () => treeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [selectedVariant, timelineYear, selectedTreeId, selectedTreeIds, showPlannedTrees]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    irrigationNetworkOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    irrigationNetworkOverlaysRef.current = [];
    if (!irrigation || !showIrrigation) return;
    for (const line of irrigation.network.lines) {
      const blocked = line.routingStatus === 'blocked';
      const color = blocked ? '#d24f3d' : line.kind === 'mainline' ? '#1c5f88' : line.kind === 'submain' ? '#278c9e' : line.kind === 'protected-crossing' ? '#f0a536' : '#61b9c7';
      const editable = editingIrrigation && line.kind !== 'protected-crossing';
      const overlay = new maps.Polyline({
        map,
        path: line.points,
        strokeColor: color,
        strokeOpacity: blocked ? 0 : line.kind === 'protected-crossing' ? 1 : 0.9,
        strokeWeight: blocked ? 4 : line.kind === 'mainline' ? 5 : line.kind === 'submain' ? 4 : line.kind === 'protected-crossing' ? 7 : 2,
        icons: blocked ? [{ icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 1, strokeWeight: 4, scale: 3 }, offset: '0', repeat: '12px' }] : undefined,
        clickable: editable,
        editable,
        zIndex: blocked ? 35 : line.kind === 'protected-crossing' ? 33 : 30,
      });
      if (editable) overlay.addListener('mouseup', (event: any) => {
        if (typeof event.vertex !== 'number') return;
        const points = coordinatesFromPath(overlay.getPath());
        void relocateIrrigationVertex(line.id, event.vertex, points);
      });
      irrigationNetworkOverlaysRef.current.push(overlay);
    }
    const sourceMarker = new maps.Marker({
      map,
      position: irrigation.network.source.coordinate,
      draggable: true,
      clickable: true,
      cursor: 'grab',
      title: t('map.dragWaterSource'),
      label: { text: 'S', color: '#ffffff', fontFamily: 'DM Mono, monospace', fontSize: '10px', fontWeight: '700' },
      icon: { path: maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#15557a', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
      zIndex: 38,
    });
    sourceMarker.addListener('dragend', (event: any) => {
      if (!event.latLng || !site) return;
      const coordinate = coordinateFromLatLng(event.latLng);
      if (!siteContainsCoordinate(site, coordinate)) {
        sourceMarker.setPosition(irrigation.network.source.coordinate);
        showBoundaryGuidance();
        return;
      }
      void relocateWaterSource(coordinate);
    });
    irrigationNetworkOverlaysRef.current.push(sourceMarker);
    return () => irrigationNetworkOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [editingIrrigation, irrigation, showIrrigation, site, t]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    waterOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    waterOverlaysRef.current = [];
    const samples = showWaterSamples ? siteProfile?.satellite.optical.waterSamples ?? [] : [];
    for (const sample of samples) {
      const color = sample.irrigationPriority === 'high' ? '#ed7047' : sample.irrigationPriority === 'medium' ? '#f1c75b' : '#62c8bd';
      waterOverlaysRef.current.push(new maps.Circle({
        map,
        center: sample.coordinate,
        radius: 4.8,
        strokeColor: '#10251c',
        strokeOpacity: 0.75,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.8,
        clickable: false,
        zIndex: 35,
      }));
    }
    return () => waterOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [showWaterSamples, siteProfile?.satellite.optical.waterSamples]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    ndmiOverlayRef.current?.setMap(null);
    ndmiOverlayRef.current = null;
    const url = siteProfile?.satellite.optical.ndmiPreviewUrl;
    if (!map || !maps || !site || !showNdmi || !url) return;
    ndmiOverlayRef.current = new maps.GroundOverlay(url, sitePreviewBounds(site.polygon), { opacity: 0.68, clickable: false });
    ndmiOverlayRef.current.setMap(map);
    return () => ndmiOverlayRef.current?.setMap(null);
  }, [showNdmi, siteProfile?.satellite.optical.ndmiPreviewUrl, site?.polygon]);

  mapClickRef.current = (coordinate) => {
    if (drawMode === 'site' || drawMode === 'hole' || drawMode === 'exclusion' || drawMode === 'path') {
      setDraftPoints((points) => [...points, coordinate]);
      return;
    }
    if (site && (drawMode === 'access-point' || drawMode === 'water-point' || drawMode === 'existing-tree')) {
      if (!siteContainsCoordinate(site, coordinate)) {
        showBoundaryGuidance();
        return;
      }
      const id = crypto.randomUUID();
      if (drawMode === 'access-point') invalidateSite({ ...site, accessPoints: [...site.accessPoints, { id: `access-${id}`, name: t('site.newAccess', { count: site.accessPoints.length + 1 }), coordinate }] });
      if (drawMode === 'water-point') invalidateSite({ ...site, waterPoints: [...site.waterPoints, { id: `water-${id}`, name: t('site.newWaterSource', { count: site.waterPoints.length + 1 }), coordinate }] });
      if (drawMode === 'existing-tree') invalidateSite({ ...site, existingTrees: [...site.existingTrees, { id: `existing-${id}`, name: t('site.newObservedTree', { count: site.existingTrees.length + 1 }), coordinate, speciesName: null, crownDiameterM: 5, protectionBufferM: 2.5 }] });
      setDrawMode('idle');
      return;
    }
    if (drawMode === 'add-tree' && selectedVariant && treeSpeciesId) {
      const restriction = plantingRestriction(coordinate, site, siteProfile, selectedVariant.firebreak, t);
      if (restriction) {
        setError(restriction);
        setDrawMode('idle');
        return;
      }
      const species = DESIGN_SPECIES_BY_ID.get(treeSpeciesId);
      if (!species) return;
      const next: TreeInstance = {
        id: `manual-${crypto.randomUUID()}`,
        speciesId: species.id,
        coordinate,
        rowIndex: Math.max(0, ...selectedVariant.trees.map((tree) => tree.rowIndex)) + 1,
        positionIndex: 0,
        plantedYear: 0,
        removedYear: null,
        locked: true,
        seed: Math.floor(Math.random() * 1_000_000),
      };
      commitTrees([...selectedVariant.trees, next]);
      setSelectedTreeId(next.id);
      setDrawMode('idle');
      return;
    }
    if (drawMode === 'move-tree' && selectedTree && !selectedTree.locked) {
      const restriction = plantingRestriction(coordinate, site, siteProfile, selectedVariant.firebreak, t);
      if (restriction) {
        setError(restriction);
        setDrawMode('idle');
        return;
      }
      commitTrees(selectedVariant!.trees.map((tree) => tree.id === selectedTree.id ? { ...tree, coordinate } : tree));
      setDrawMode('idle');
    }
  };

  function invalidateSite(nextSite: SiteBoundary) {
    const normalized = normalizeSiteBoundary(nextSite);
    const validation = localSiteValidation(normalized);
    if (!validation.valid) {
      if (validation.reason === 'Access, water and existing-tree points must lie inside the site.') {
        if (site && drawMode === 'edit-site') setSite(cloneSite(site));
        showBoundaryGuidance();
        return;
      }
      setError(localizedDomainMessage(validation.reason, t));
      return;
    }
    if (site) siteUndoRef.current.push(cloneSite(site));
    siteRedoRef.current = [];
    setSite(normalized);
    setSiteProfile(null);
    setRecommendations([]);
    setVariants([]);
    setSelectedVariantId(null);
    setIrrigation(null);
    setCosts(null);
    setNotice(t('notices.boundaryChanged'));
  }

  function finishDraft() {
    const minimumPoints = drawMode === 'path' ? 2 : 3;
    if (draftPoints.length < minimumPoints) {
      setError(t('errors.minimumPoints', { count: minimumPoints }));
      return;
    }
    if (drawMode === 'site') {
      const nextSite = site
        ? { ...site, polygon: draftPoints }
        : normalizeSiteBoundary({ id: `site-${crypto.randomUUID()}`, name: t('site.untitledName'), polygon: draftPoints });
      fittedSiteRef.current = null;
      invalidateSite(nextSite);
      setDraftPoints([]);
      setDrawMode('idle');
      return;
    }
    if (!site) {
      setError(t('site.drawFirst'));
      return;
    }
    if (drawMode === 'hole') invalidateSite({ ...site, holes: [...site.holes, draftPoints] });
    if (drawMode === 'exclusion') invalidateSite({ ...site, exclusions: [...site.exclusions, draftPoints] });
    if (drawMode === 'path') invalidateSite({ ...site, paths: [...site.paths, { id: `path-${crypto.randomUUID()}`, name: t('site.newPath', { count: site.paths.length + 1 }), points: draftPoints, widthM: 3 }] });
    setDraftPoints([]);
    setDrawMode('idle');
  }

  async function importGeoJsonFile(file: File) {
    await runBusy(t('busy.validatingGeoJson'), async () => {
      const imported = importSiteGeoJson(JSON.parse(await file.text()), { id: site?.id, name: site?.name });
      const validation = await api<SiteValidation>('/api/site/validate', post(imported));
      if (!validation.valid) throw new Error(validation.reason);
      fittedSiteRef.current = null;
      invalidateSite(imported);
      setSiteValidation(validation);
      setNotice(t('notices.geoJsonImported', { geometry: validation.geometryType, area: validation.plantableAreaM2.toFixed(0) }));
    });
  }

  function undoSite() {
    if (!siteUndoRef.current.length) return;
    const previous = siteUndoRef.current.pop()!;
    siteRedoRef.current.push(site ? cloneSite(site) : null);
    setSite(previous ? cloneSite(previous) : null);
    clearDerivedSiteState();
  }

  function redoSite() {
    if (!siteRedoRef.current.length) return;
    const next = siteRedoRef.current.pop()!;
    siteUndoRef.current.push(site ? cloneSite(site) : null);
    setSite(next ? cloneSite(next) : null);
    clearDerivedSiteState();
  }

  function clearSite() {
    if (!site) return;
    siteUndoRef.current.push(cloneSite(site));
    siteRedoRef.current = [];
    setSite(null);
    fittedSiteRef.current = null;
    setSiteValidation(null);
    clearDerivedSiteState();
    setSelectedSpeciesIds([]);
    setTreeSpeciesId('');
    setSelectedTreeId(null);
    setSelectedTreeIds([]);
    setDrawMode('idle');
    setDraftPoints([]);
    setShowNdmi(false);
    setShowWaterSamples(false);
    setProjectId(`growup-${crypto.randomUUID().slice(0, 8)}`);
    setProjectRevision(0);
    projectRevisionRef.current = 0;
    setRevisions([]);
    setFireOperations(defaultFireOperationsPlan());
    setProjectAnalysis(null);
    setAnalysisError(null);
    setCollaboration(defaultProjectCollaboration());
    setSharePath(null);
    setSaveStatus('idle');
    window.localStorage.removeItem('growup:draft:v2');
    projectNameEditedRef.current = false;
    setProjectName(t('project.newTitle'));
    createdAtRef.current = new Date().toISOString();
    setClearSiteOpen(false);
    setSection('site');
    setNotice(t('site.clearedNotice'));
  }

  function clearDerivedSiteState() {
    setSiteProfile(null);
    setEconomicConfiguration(defaultEconomicConfiguration(''));
    setRecommendations([]);
    setVariants([]);
    setSelectedVariantId(null);
    setIrrigation(null);
    setCosts(null);
    setProjectAnalysis(null);
    setAnalysisError(null);
  }

  function activateDrawMode(mode: DrawMode) {
    setDrawMode(mode);
    setDraftPoints([]);
    if (mode === 'site' || mode === 'edit-site') setShowBoundary(true);
    if (mode === 'hole' || mode === 'exclusion') setShowNoPlantAreas(true);
    if (mode === 'path') setShowManagementPaths(true);
    if (mode === 'access-point' || mode === 'water-point') setShowInfrastructure(true);
    if (mode === 'existing-tree') setShowObservedTrees(true);
    if (mode === 'add-tree' || mode === 'move-tree') setShowPlannedTrees(true);
    if (mode === 'edit-constraints') {
      setShowNoPlantAreas(true);
      setShowManagementPaths(true);
      setShowInfrastructure(true);
      setShowObservedTrees(true);
    }
  }

  async function analyzeSite() {
    if (!site) return;
    setSection('profile');
    await runBusy(t('busy.readingEvidence'), async () => {
      const profile = await api<SiteProfile>('/api/site/profile', post(site));
      const [result, economics] = await Promise.all([
        api<{ recommendations: SpeciesRecommendation[]; palette: DesignSpecies[] }>('/api/recommendations', post({ siteProfile: profile, objectives: designConfiguration.objectives })),
        api<EconomicConfiguration>('/api/economics/profile', post({ siteProfile: profile })),
      ]);
      recommendationObjectiveRef.current = JSON.stringify(designConfiguration.objectives);
      setSiteProfile(profile);
      setEconomicConfiguration(economics);
      setRecommendations(result.recommendations);
      const palette = result.palette.map((species) => species.id);
      setSelectedSpeciesIds(palette);
      setTreeSpeciesId(palette[0] ?? '');
      setShowWaterSamples(false);
      setShowExistingVegetation(true);
      const woody = profile.satellite.existingVegetation;
      setNotice(t('notices.evidenceReady', { count: woody.patches.length }));
    });
  }

  async function overrideSiteProfile(input: {
    field: SiteProfileOverrideField;
    value: string;
    reason: string;
    sourceLabel: string;
    observedAt: string;
  }) {
    if (!siteProfile) return;
    await runBusy(t('busy.applyingOverride'), async () => {
      const profile = await api<SiteProfile>('/api/site/profile/override', post({ siteProfile, override: input }));
      const result = await api<{ recommendations: SpeciesRecommendation[] }>('/api/recommendations', post({ siteProfile: profile, objectives: designConfiguration.objectives }));
      setSiteProfile(profile);
      setRecommendations(result.recommendations);
      setVariants([]);
      setSelectedVariantId(null);
      setIrrigation(null);
      setCosts(null);
      setNotice(t('notices.overrideApplied'));
    });
  }

  async function generateDesign() {
    if (!site || !siteProfile) return setError(t('errors.completeEvidenceFirst'));
    const minimumSpecies = designConfiguration.system === 'syntropic' ? 3 : designConfiguration.system === 'monoculture' ? 1 : 2;
    if (selectedSpeciesIds.length < minimumSpecies) return setError(t('errors.minimumSpecies', { count: minimumSpecies }));
    await runBusy(t('busy.generatingDesigns'), async () => {
      const result = await api<{ variants: LayoutVariant[] }>('/api/layout/generate', post({ site, siteProfile, selectedSpeciesIds, designConfiguration }));
      setVariants(result.variants);
      setSelectedVariantId(result.variants[0]?.id ?? null);
      setSection('layout');
      setTimelineYear(5);
      setShowWaterSamples(false);
      setShowNdmi(false);
      setIrrigation(null);
      setCosts(null);
      setEditingIrrigation(false);
      setIrrigationConfiguration((configuration) => ({ ...configuration, lineOverrides: {} }));
      undoRef.current = [];
      redoRef.current = [];
      setNotice(t('notices.layoutsGenerated', { count: result.variants.length }));
    });
  }

  async function regenerateUnlockedDesign() {
    if (!site || !siteProfile || !selectedVariant) return setError(t('errors.generateLayoutFirst'));
    await runBusy(t('busy.regeneratingUnlocked'), async () => {
      const result = await api<{ variant: LayoutVariant }>('/api/layout/regenerate', post({
        site,
        siteProfile,
        selectedSpeciesIds,
        previousVariant: selectedVariant,
        designConfiguration,
      }));
      setVariants((items) => items.map((item) => item.id === selectedVariant.id ? result.variant : item));
      if (selectedTreeId && !result.variant.trees.some((tree) => tree.id === selectedTreeId)) setSelectedTreeId(null);
      setIrrigation(null);
      setCosts(null);
      setEditingIrrigation(false);
      setIrrigationConfiguration((configuration) => ({ ...configuration, lineOverrides: {} }));
      undoRef.current = [];
      redoRef.current = [];
      setNotice(t('notices.unlockedRegenerated', { count: result.variant.generation.lockedTreeCount }));
    });
  }

  async function requestWaterAndCosts(activeSite: SiteBoundary, activeConfiguration: IrrigationConfiguration, designYear: number) {
    if (!selectedVariant || !siteProfile) throw new Error(t('errors.generateLayoutFirst'));
    return api<{ irrigation: IrrigationEstimate; establishment: EstablishmentCost }>('/api/costs/calculate', post({
      variant: selectedVariant,
      site: activeSite,
      siteProfile,
      selectedSpeciesIds,
      designYear,
      irrigationConfiguration: activeConfiguration,
      economicConfiguration,
    }));
  }

  async function recalculateWaterAndCosts(activeSite: SiteBoundary, activeConfiguration: IrrigationConfiguration, designYear: number, successNotice: string) {
    await runBusy(t('busy.sizingWaterCosts'), async () => {
      const result = await requestWaterAndCosts(activeSite, activeConfiguration, designYear);
      setIrrigation(result.irrigation);
      setCosts(result.establishment);
      setNotice(successNotice);
    });
  }

  async function calculateWaterAndCosts() {
    if (!selectedVariant || !site || !siteProfile) return setError(t('errors.generateLayoutFirst'));
    await recalculateWaterAndCosts(site, irrigationConfiguration, timelineYear, t('notices.waterCostsReady'));
    setSection('water');
  }

  async function relocateWaterSource(coordinate: Coordinate, requestedPointId?: string) {
    if (!site) return;
    if (!siteContainsCoordinate(site, coordinate)) return showBoundaryGuidance();
    const existingPoint = site.waterPoints.find((point) => point.id === requestedPointId)
      ?? site.waterPoints.find((point) => point.id === irrigationConfiguration.sourcePointId)
      ?? site.waterPoints[0]
      ?? null;
    const pointId = existingPoint?.id ?? `water-${crypto.randomUUID()}`;
    const nextPoint = existingPoint
      ? { ...existingPoint, coordinate }
      : { id: pointId, name: t('site.newWaterSource', { count: site.waterPoints.length + 1 }), coordinate };
    const nextSite = {
      ...site,
      waterPoints: existingPoint
        ? site.waterPoints.map((point) => point.id === pointId ? nextPoint : point)
        : [...site.waterPoints, nextPoint],
    };
    const nextConfiguration = { ...irrigationConfiguration, sourcePointId: pointId, lineOverrides: {} };
    siteUndoRef.current.push(cloneSite(site));
    siteRedoRef.current = [];
    setSite(nextSite);
    setIrrigationConfiguration(nextConfiguration);
    if (selectedVariant && siteProfile) {
      await recalculateWaterAndCosts(nextSite, nextConfiguration, timelineYear, t('notices.waterSourceMoved'));
    } else {
      setNotice(t('notices.waterSourceMoved'));
    }
  }

  async function relocateIrrigationVertex(lineId: string, vertexIndex: number, points: Coordinate[]) {
    if (!site || !irrigation || points.length < 2) return;
    if (points.some((point) => !siteContainsCoordinate(site, point))) {
      showBoundaryGuidance();
      setIrrigation({ ...irrigation });
      return;
    }
    const target = irrigation.network.lines.find((line) => line.id === lineId);
    if (!target) return;
    const previousPoint = target.points[vertexIndex];
    const nextPoint = points[vertexIndex];
    if (previousPoint && nextPoint && haversineM(previousPoint, irrigation.network.source.coordinate) < 0.5) {
      await relocateWaterSource(nextPoint);
      return;
    }
    const replacements = previousPoint && nextPoint && target.points.length === points.length && haversineM(previousPoint, nextPoint) > 0.02
      ? [{ previous: previousPoint, next: nextPoint }]
      : [];
    const lineOverrides = { ...irrigationConfiguration.lineOverrides, [lineId]: points };
    for (const line of irrigation.network.lines) {
      if (line.kind === 'protected-crossing' || line.id === lineId) continue;
      const adjusted = line.points.map((point) => replacements.reduce((value, replacement) => haversineM(value, replacement.previous) < 0.5 ? replacement.next : value, point));
      if (adjusted.some((point, index) => haversineM(point, line.points[index]) > 0.02)) lineOverrides[line.id] = adjusted;
    }
    const nextConfiguration = { ...irrigationConfiguration, lineOverrides };
    setIrrigationConfiguration(nextConfiguration);
    await recalculateWaterAndCosts(site, nextConfiguration, timelineYear, t('notices.irrigationGeometryMoved'));
  }

  function currentAssistantContext(): AssistantProjectContext {
    return {
      site,
      siteProfile,
      selectedSpeciesIds,
      designConfiguration,
      irrigationConfiguration,
      economicConfiguration,
      variants: variants.map(({ id, name, description, score, metrics, solar, composition, machinery, firebreak, warnings, generation }) => ({
        id,
        name,
        description,
        score,
        metrics,
        solar,
        composition,
        machinery,
        firebreak,
        warnings,
        generation,
      })),
      selectedVariantId,
      timelineYear,
      irrigation,
      costs,
      fireOperations,
      section,
    };
  }

  async function askAssistant(prompt = assistantInput) {
    const message = prompt.trim();
    if (!message) return;
    setAssistantBusy(true);
    setAssistantError(null);
    setAssistantProposal(null);
    try {
      const proposal = await api<AssistantProposal>('/api/assistant/plan', post({ message, context: currentAssistantContext() }));
      setAssistantProposal(proposal);
      setAssistantInput(message);
    } catch (assistantRequestError) {
      setAssistantError(messageOf(assistantRequestError));
    } finally {
      setAssistantBusy(false);
    }
  }

  async function runProjectAnalysis() {
    if (!site || !siteProfile || !selectedVariant) return;
    setAnalysisBusy(true);
    setAnalysisError(null);
    try {
      const report = await api<ProjectAnalysisReport>('/api/assistant/review', post({
        locale,
        context: currentAssistantContext(),
      }));
      setProjectAnalysis(report);
    } catch (reviewError) {
      setAnalysisError(messageOf(reviewError));
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function applyAssistantProposal() {
    if (!assistantProposal) return;
    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const actions = assistantProposal.actions;
      let nextSpeciesIds = [...selectedSpeciesIds];
      let nextVariants = variants;
      let nextVariantId = selectedVariantId;
      let nextTimelineYear = timelineYear;
      let nextIrrigation = irrigation;
      let nextCosts = costs;
      let nextSection = section;
      for (const action of actions) {
        if (action.type === 'add_species') nextSpeciesIds = Array.from(new Set([...nextSpeciesIds, ...action.speciesIds]));
        if (action.type === 'remove_species') nextSpeciesIds = nextSpeciesIds.filter((id) => !action.speciesIds.includes(id));
        if (action.type === 'set_timeline_year') nextTimelineYear = action.year;
        if (action.type === 'select_variant') nextVariantId = action.variantId;
        if (action.type === 'navigate') nextSection = action.section;
      }
      const minimumSpecies = designConfiguration.system === 'syntropic' ? 3 : designConfiguration.system === 'monoculture' ? 1 : 2;
      if (nextSpeciesIds.length < minimumSpecies) throw new Error(t('errors.systemMinimumSpecies', { count: minimumSpecies }));
      const speciesChanged = nextSpeciesIds.join('|') !== selectedSpeciesIds.join('|');
      const regenerate = actions.some((action) => action.type === 'regenerate_layout');
      const recalculate = actions.some((action) => action.type === 'recalculate_water_and_costs');
      if (speciesChanged && !regenerate) {
        nextVariants = [];
        nextVariantId = null;
        nextIrrigation = null;
        nextCosts = null;
      }
      if (regenerate) {
        if (!site || !siteProfile) throw new Error(t('errors.evidenceBeforeRegenerate'));
        const layoutResult = await api<{ variants: LayoutVariant[] }>('/api/layout/generate', post({ site, siteProfile, selectedSpeciesIds: nextSpeciesIds, designConfiguration }));
        nextVariants = layoutResult.variants;
        nextVariantId = nextVariants.some((variant) => variant.id === nextVariantId) ? nextVariantId : nextVariants[0]?.id ?? null;
        nextIrrigation = null;
        nextCosts = null;
      }
      if (recalculate) {
        if (!site || !siteProfile) throw new Error(t('errors.evidenceBeforeCosts'));
        const chosenVariant = nextVariants.find((variant) => variant.id === nextVariantId) ?? nextVariants[0];
        if (!chosenVariant) throw new Error(t('errors.layoutBeforeCosts'));
        const costResult = await api<{ irrigation: IrrigationEstimate; establishment: EstablishmentCost }>('/api/costs/calculate', post({
          variant: chosenVariant,
          site,
          siteProfile,
          selectedSpeciesIds: nextSpeciesIds,
          designYear: nextTimelineYear,
          irrigationConfiguration,
          economicConfiguration,
        }));
        nextIrrigation = costResult.irrigation;
        nextCosts = costResult.establishment;
      }
      setSelectedSpeciesIds(nextSpeciesIds);
      setTreeSpeciesId(nextSpeciesIds[0] ?? '');
      setVariants(nextVariants);
      setSelectedVariantId(nextVariantId);
      setTimelineYear(nextTimelineYear);
      setIrrigation(nextIrrigation);
      setCosts(nextCosts);
      setSection(nextSection);
      setAssistantProposal(null);
      setAssistantInput('');
      setNotice(t('notices.aiApplied'));
    } catch (assistantApplyError) {
      setAssistantError(messageOf(assistantApplyError));
    } finally {
      setAssistantBusy(false);
    }
  }

  function updateOnboarding(status: OnboardingPreference['status'], step: OnboardingStep, syncUser = authUser, projectNameOverride = projectName) {
    const preference: OnboardingPreference = { status, step, updatedAt: new Date().toISOString(), ...(projectNameOverride.trim() ? { projectName: projectNameOverride.trim() } : {}) };
    setOnboarding(preference);
    try {
      writeOnboardingPreference(window.localStorage, preference);
    } catch {
      setError(t('onboarding.storageError'));
    }
    if (syncUser) {
      void api<AuthUser>('/api/user/preferences/onboarding', put(preference))
        .then((user) => setAuthUser((current) => current?.id === user.id ? user : current))
        .catch((syncError) => setError(messageOf(syncError)));
    }
  }

  function startOnboarding(name: string) {
    const nextName = name.trim() || t('project.newTitle');
    projectNameEditedRef.current = true;
    setProjectName(nextName);
    const nextStep: OnboardingStep = !site
      ? 'location'
      : !siteProfile
        ? 'analysis'
        : !selectedVariant
          ? 'species'
          : !irrigation || !costs
            ? 'design'
            : 'complete';
    updateOnboarding('active', nextStep, authUser, nextName);
    setSection(nextStep === 'species' ? 'species' : nextStep === 'design' ? 'layout' : nextStep === 'complete' ? 'costs' : 'site');
  }

  function beginOnboardingBoundary() {
    if (!isOnboardingLocationReady(locationSelected, mapZoom)) {
      setError(t(locationSelected ? 'onboarding.locationZoomRequired' : 'onboarding.locationSelectionRequired'));
      return;
    }
    setSection('site');
    activateDrawMode('site');
    updateOnboarding('active', 'boundary');
  }

  function currentProjectState(updatedAt: string): ProjectState | null {
    if (!site) return null;
    return {
      id: projectId,
      name: projectName.trim() || t('project.newTitle'),
      site,
      siteProfile,
      selectedSpeciesIds,
      designConfiguration,
      irrigationConfiguration,
      economicConfiguration,
      variants,
      selectedVariantId,
      timelineYear,
      irrigation,
      costs,
      fireOperations,
      analysis: projectAnalysis,
      collaboration,
      revision: projectRevisionRef.current,
      revisionId: revisions[0]?.revisionId ?? null,
      calculationRunId: null,
      createdAt: createdAtRef.current,
      updatedAt,
    };
  }

  function queueProjectSave(snapshot: ProjectState, serial: number, announce = false): Promise<void> {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      setSaveStatus('saving');
      try {
        const request = { ...snapshot, revision: projectRevisionRef.current, updatedAt: new Date().toISOString() };
        const saved = await api<ProjectState>(`/api/projects/${snapshot.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
        const revision = saved.revision ?? projectRevisionRef.current;
        projectRevisionRef.current = revision;
        setProjectRevision(revision);
        if (serial === dirtySerialRef.current) {
          setSaveStatus('saved');
          window.localStorage.removeItem('growup:draft:v2');
        } else {
          setSaveStatus('unsaved');
        }
        void refreshProjects(saved.id).catch((refreshError) => setError(messageOf(refreshError)));
        if (announce) setNotice(t('auth.savedRevision', { revision }));
      } catch (saveError) {
        const conflict = saveError instanceof GrowupApiError && saveError.status === 'PROJECT_REVISION_CONFLICT';
        setSaveStatus(conflict ? 'conflict' : 'unsaved');
        setError(conflict ? t('auth.conflict') : messageOf(saveError));
      }
    });
    return saveQueueRef.current;
  }

  async function saveProject() {
    if (!site) return;
    if (!authUser) {
      setAuthOpen(true);
      setNotice(t('auth.signInToSave'));
      return;
    }
    const snapshot = currentProjectState(new Date().toISOString());
    if (!snapshot) return;
    await queueProjectSave(snapshot, dirtySerialRef.current, true);
  }

  async function refreshProjects(activeProjectId = projectId) {
    const list = await api<ProjectSummary[]>('/api/projects');
    setProjects(list);
    if (activeProjectId && list.some((item) => item.id === activeProjectId)) {
      setRevisions(await api<ProjectRevisionSummary[]>(`/api/projects/${activeProjectId}/revisions`));
    }
  }

  function loadProjectIntoWorkspace(project: ProjectState, status: SaveStatus) {
    suppressDirtyRef.current = true;
    const revision = project.revision ?? 0;
    const normalizedDesign = normalizeDesignConfiguration(project.designConfiguration);
    const normalizedVariants = project.variants.map((variant) => {
      const variantDesign = normalizeDesignConfiguration(variant.design);
      return {
        ...variant,
        design: variantDesign,
        firebreak: variant.firebreak ?? disabledFirebreakPlan(variantDesign.firebreak),
      };
    });
    projectRevisionRef.current = revision;
    setProjectRevision(revision);
    setProjectId(project.id);
    setProjectName(project.name);
    projectNameEditedRef.current = true;
    createdAtRef.current = project.createdAt;
    setSite(normalizeSiteBoundary(project.site));
    setSiteProfile(project.siteProfile);
    setSelectedSpeciesIds(project.selectedSpeciesIds);
    setTreeSpeciesId(project.selectedSpeciesIds[0] ?? '');
    setDesignConfiguration(normalizedDesign);
    setIrrigationConfiguration(normalizeIrrigationConfiguration(project.irrigationConfiguration));
    setEconomicConfiguration(normalizeEconomicConfiguration(project.economicConfiguration, project.siteProfile?.location.countryCode ?? project.economicConfiguration?.countryCode ?? ''));
    setVariants(normalizedVariants);
    setSelectedVariantId(project.selectedVariantId);
    setTimelineYear(project.timelineYear);
    setIrrigation(project.irrigation);
    setCosts(project.costs);
    setFireOperations(normalizeFireOperationsPlan(project.fireOperations, project.updatedAt));
    setProjectAnalysis(project.analysis ?? null);
    setAnalysisError(null);
    setCollaboration(normalizeProjectCollaboration(project.collaboration));
    setSelectedTreeId(null);
    setSelectedTreeIds([]);
    setSharePath(null);
    fittedSiteRef.current = null;
    setSection(project.costs ? 'costs' : project.irrigation ? 'water' : normalizedVariants.length ? 'layout' : project.siteProfile ? 'profile' : 'site');
    setSaveStatus(status);
    if (project.siteProfile) {
      void api<{ recommendations: SpeciesRecommendation[] }>('/api/recommendations', post({ siteProfile: project.siteProfile, objectives: project.designConfiguration.objectives }))
        .then((result) => setRecommendations(result.recommendations))
        .catch((recommendationError) => setError(messageOf(recommendationError)));
    } else {
      setRecommendations([]);
    }
  }

  async function openProject(id: string) {
    if (!id) return;
    await runBusy(t('auth.opening'), async () => {
      const project = await api<ProjectState>(`/api/projects/${id}`);
      loadProjectIntoWorkspace(project, 'saved');
      setRevisions(await api<ProjectRevisionSummary[]>(`/api/projects/${id}/revisions`));
      setNotice(t('auth.opened', { revision: project.revision ?? 0 }));
    });
  }

  async function restoreRevision(revision: number) {
    await runBusy(t('auth.restoring'), async () => {
      const project = await api<ProjectState>(`/api/projects/${projectId}/revisions/${revision}/restore`, post({}));
      loadProjectIntoWorkspace(project, 'saved');
      setRevisions(await api<ProjectRevisionSummary[]>(`/api/projects/${projectId}/revisions`));
      setHistoryOpen(false);
      setNotice(t('auth.restored', { revision }));
    });
  }

  function recoverLocalDraft() {
    if (!recoveryDraft) return;
    loadProjectIntoWorkspace(recoveryDraft, 'local');
    setRecoveryDraft(null);
    setNotice(t('auth.draftRecovered'));
  }

  function discardLocalDraft() {
    window.localStorage.removeItem('growup:draft:v2');
    setRecoveryDraft(null);
  }

  async function authenticateGoogle(credential: string) {
    await runBusy(t('auth.signingIn'), async () => {
      const session = await api<{ authenticated: true; user: AuthUser }>('/api/auth/google', post({ credential }));
      const localOnboarding = readOnboardingPreference(window.localStorage);
      const remoteOnboarding = normalizeOnboardingPreference(session.user.preferences?.onboarding);
      const resolvedOnboarding = latestOnboardingPreference(localOnboarding, remoteOnboarding) ?? newOnboardingPreference();
      let user = session.user;
      if (resolvedOnboarding.updatedAt !== remoteOnboarding?.updatedAt) {
        user = await api<AuthUser>('/api/user/preferences/onboarding', put(resolvedOnboarding));
      }
      setAuthUser(user);
      setOnboarding(resolvedOnboarding);
      if (resolvedOnboarding.projectName && !site) {
        projectNameEditedRef.current = true;
        setProjectName(resolvedOnboarding.projectName);
      }
      writeOnboardingPreference(window.localStorage, resolvedOnboarding);
      setAuthOpen(false);
      await refreshProjects();
      setNotice(t('auth.signedIn', { name: user.name }));
    });
  }

  async function logout() {
    await api('/api/auth/logout', post({}));
    setAuthUser(null);
    setProjects([]);
    setRevisions([]);
    setNotice(t('auth.signedOut'));
  }

  async function searchCatalogue(filters: CatalogueFilters = {
    treeOnly: false,
    globUntOnly: false,
    designReadyOnly: false,
    stratum: '',
    succession: '',
    role: '',
    evergreen: '',
    nitrogenFixer: '',
    droughtMinimum: 0,
    evidenceMinimum: 0,
  }) {
    await runBusy(t('busy.searchingCatalogue'), async () => {
      const parameters = new URLSearchParams({ q: catalogueQuery, limit: '18' });
      if (filters.treeOnly) parameters.set('tree', 'true');
      if (filters.globUntOnly) parameters.set('globunt', 'true');
      if (filters.designReadyOnly) parameters.set('designReady', 'true');
      if (filters.stratum) parameters.set('stratum', filters.stratum);
      if (filters.succession) parameters.set('succession', filters.succession);
      if (filters.role) parameters.set('role', filters.role);
      if (filters.evergreen) parameters.set('evergreen', filters.evergreen);
      if (filters.nitrogenFixer) parameters.set('nitrogenFixer', filters.nitrogenFixer);
      if (filters.droughtMinimum > 0) parameters.set('droughtMin', String(filters.droughtMinimum));
      if (filters.evidenceMinimum > 0) parameters.set('evidenceMin', String(filters.evidenceMinimum));
      const result = await api<{ results: CatalogueSpecies[] }>(`/api/catalog/search?${parameters.toString()}`);
      setCatalogueResults(result.results);
    });
  }

  async function searchLocation() {
    const query = locationQuery.trim();
    if (query.length < 2) return setError(t('errors.searchLength'));
    await runBusy(t('busy.searchingPlaces'), async () => {
      const results = await api<LocationSearchResult[]>(`/api/locations/search?q=${encodeURIComponent(query)}`);
      setLocationResults(results);
      if (!results.length) setNotice(t('notices.noPlace'));
    });
  }

  function focusLocation(result: LocationSearchResult) {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    if (result.boundingBox) {
      map.fitBounds(new maps.LatLngBounds(
        { lat: result.boundingBox.south, lng: result.boundingBox.west },
        { lat: result.boundingBox.north, lng: result.boundingBox.east },
      ));
    } else {
      map.panTo(result.coordinate);
      map.setZoom(17);
    }
    setLocationResults([]);
    setLocationQuery(result.displayName);
    setLocationSelected(true);
    setNotice(t('notices.mapCentredPlace'));
    if (window.matchMedia('(max-width: 820px)').matches) {
      window.setTimeout(() => mapElementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }

  function updateLocationQuery(value: string) {
    setLocationQuery(value);
    setLocationSelected(false);
  }

  function useEnteredCoordinate(coordinate: Coordinate) {
    if (!Number.isFinite(coordinate.lat) || coordinate.lat < -90 || coordinate.lat > 90 || !Number.isFinite(coordinate.lng) || coordinate.lng < -180 || coordinate.lng > 180) {
      setError(t('errors.invalidCoordinate'));
      return;
    }
    if (drawMode !== 'idle' && drawMode !== 'edit-site' && drawMode !== 'edit-constraints') {
      mapClickRef.current(coordinate);
      return;
    }
    mapRef.current?.panTo(coordinate);
    mapRef.current?.setZoom(19);
    setLocationQuery(`${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}`);
    setLocationSelected(true);
    setNotice(t('notices.mapCentredCoordinate'));
    if (window.matchMedia('(max-width: 820px)').matches) {
      window.setTimeout(() => mapElementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }

  function toggleSpecies(id: string) {
    setSelectedSpeciesIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
    setVariants([]);
    setSelectedVariantId(null);
    setIrrigation(null);
    setCosts(null);
  }

  function updateDesignConfiguration(value: DesignConfiguration) {
    setDesignConfiguration(normalizeDesignConfiguration(value));
    setVariants([]);
    setSelectedVariantId(null);
    setIrrigation(null);
    setCosts(null);
  }

  function commitTrees(nextTrees: TreeInstance[], record = true) {
    if (!selectedVariant) return;
    if (record) {
      undoRef.current.push(selectedVariant.trees.map((tree) => ({ ...tree, coordinate: { ...tree.coordinate } })));
      redoRef.current = [];
    }
    setVariants((items) => items.map((item) => item.id === selectedVariant.id ? {
      ...item,
      trees: nextTrees,
      metrics: { ...item.metrics, totalTrees: nextTrees.length, speciesCount: new Set(nextTrees.map((tree) => tree.speciesId)).size },
    } : item));
    setIrrigation(null);
    setCosts(null);
  }

  function undoTrees() {
    if (!selectedVariant || !undoRef.current.length) return;
    const previous = undoRef.current.pop()!;
    redoRef.current.push(selectedVariant.trees);
    commitTrees(previous, false);
  }

  function redoTrees() {
    if (!selectedVariant || !redoRef.current.length) return;
    const next = redoRef.current.pop()!;
    undoRef.current.push(selectedVariant.trees);
    commitTrees(next, false);
  }

  function deleteSelectedTree() {
    if (!selectedVariant || !selectedTree) return;
    commitTrees(selectedVariant.trees.filter((tree) => tree.id !== selectedTree.id));
    setSelectedTreeId(null);
    setSelectedTreeIds((ids) => ids.filter((id) => id !== selectedTree.id));
  }

  function toggleTreeLock() {
    if (!selectedVariant || !selectedTree) return;
    commitTrees(selectedVariant.trees.map((tree) => tree.id === selectedTree.id ? { ...tree, locked: !tree.locked } : tree));
  }

  function selectTree(id: string | null) {
    setSelectedTreeId(id);
    setSelectedTreeIds(id ? [id] : []);
    if (id && selectedVariant) {
      const tree = selectedVariant.trees.find((candidate) => candidate.id === id);
      if (tree) setTreeSpeciesId(tree.speciesId);
    }
  }

  function selectTreeGroup(group: 'row' | 'species' | 'all') {
    if (!selectedVariant) return;
    const anchor = selectedTree ?? selectedVariant.trees.find((tree) => selectedTreeIds.includes(tree.id));
    const ids = group === 'all'
      ? selectedVariant.trees.map((tree) => tree.id)
      : anchor
        ? selectedVariant.trees.filter((tree) => group === 'row' ? tree.rowIndex === anchor.rowIndex : tree.speciesId === anchor.speciesId).map((tree) => tree.id)
        : [];
    setSelectedTreeIds(ids);
    if (!selectedTreeId && ids[0]) setSelectedTreeId(ids[0]);
  }

  function replaceSelectedTrees(speciesId: string) {
    if (!selectedVariant || !selectedTreeIds.length || !DESIGN_SPECIES_BY_ID.has(speciesId)) return;
    const ids = new Set(selectedTreeIds);
    commitTrees(selectedVariant.trees.map((tree) => ids.has(tree.id) ? { ...tree, speciesId } : tree));
    setTreeSpeciesId(speciesId);
  }

  function lockSelectedTrees(locked: boolean) {
    if (!selectedVariant || !selectedTreeIds.length) return;
    const ids = new Set(selectedTreeIds);
    commitTrees(selectedVariant.trees.map((tree) => ids.has(tree.id) ? { ...tree, locked } : tree));
  }

  function deleteSelectedTrees() {
    if (!selectedVariant || !selectedTreeIds.length) return;
    const ids = new Set(selectedTreeIds);
    commitTrees(selectedVariant.trees.filter((tree) => !ids.has(tree.id)));
    setSelectedTreeId(null);
    setSelectedTreeIds([]);
  }

  function alignSelectedTrees(evenSpacing: boolean) {
    if (!selectedVariant || !site || selectedTreeIds.length < 2) return;
    const ids = new Set(selectedTreeIds);
    const selected = selectedVariant.trees.filter((tree) => ids.has(tree.id));
    const projection = createLocalProjection(polygonCentroid(site.polygon));
    const projected = selected.map((tree) => ({ tree, point: projection.project(tree.coordinate) }));
    const center = {
      x: projected.reduce((sum, item) => sum + item.point.x, 0) / projected.length,
      y: projected.reduce((sum, item) => sum + item.point.y, 0) / projected.length,
    };
    const radians = selectedVariant.directionDegrees * Math.PI / 180;
    const direction = { x: Math.sin(radians), y: Math.cos(radians) };
    const ordered = projected.map((item) => ({
      ...item,
      offset: (item.point.x - center.x) * direction.x + (item.point.y - center.y) * direction.y,
    })).sort((a, b) => a.offset - b.offset);
    const minimum = ordered[0].offset;
    const maximum = ordered[ordered.length - 1].offset;
    const coordinates = new Map(ordered.map((item, index) => {
      const offset = evenSpacing && ordered.length > 1
        ? minimum + (maximum - minimum) * index / (ordered.length - 1)
        : item.offset;
      return [item.tree.id, projection.unproject({ x: center.x + direction.x * offset, y: center.y + direction.y * offset })];
    }));
    const invalid = selected.find((tree) => {
      const coordinate = coordinates.get(tree.id)!;
      return Boolean(plantingRestriction(coordinate, site, siteProfile, selectedVariant.firebreak, t));
    });
    if (invalid) {
      setError(t('layout.bulkConstraint'));
      return;
    }
    commitTrees(selectedVariant.trees.map((tree) => coordinates.has(tree.id) ? { ...tree, coordinate: coordinates.get(tree.id)! } : tree));
  }

  function updateFireTask(id: FireMaintenanceTask['id'], patch: Partial<FireMaintenanceTask>) {
    const now = new Date().toISOString();
    setFireOperations((plan) => normalizeFireOperationsPlan({
      ...plan,
      reviewedAt: now,
      tasks: plan.tasks.map((task) => task.id === id
        ? {
          ...task,
          ...patch,
          completedAt: patch.status === 'complete' ? task.completedAt ?? now : patch.status ? null : task.completedAt,
        }
        : task),
    }, now));
  }

  async function openCollaboration() {
    setCollaborationOpen(true);
    if (!authUser || projectRevisionRef.current < 1) return;
    setShareBusy(true);
    try {
      const response = await api<ShareResponse>(`/api/projects/${projectId}/share`);
      setSharePath(response.path ?? null);
      setCollaboration(normalizeProjectCollaboration(response.project.collaboration));
    } catch (shareError) {
      setError(messageOf(shareError));
    } finally {
      setShareBusy(false);
    }
  }

  async function enableProjectSharing(mode: 'view' | 'review', expiresAt: string | null) {
    if (!site) return;
    if (!authUser) {
      setAuthOpen(true);
      return;
    }
    setShareBusy(true);
    try {
      const snapshot = currentProjectState(new Date().toISOString());
      if (snapshot) await queueProjectSave(snapshot, dirtySerialRef.current);
      const response = await api<ShareResponse>(`/api/projects/${projectId}/share`, post({ mode, expiresAt }));
      applySharedProjectResponse(response);
      setNotice(t('sharing.linkReady'));
    } catch (shareError) {
      setError(messageOf(shareError));
    } finally {
      setShareBusy(false);
    }
  }

  async function disableProjectSharing() {
    setShareBusy(true);
    try {
      const response = await api<ShareResponse>(`/api/projects/${projectId}/share`, { method: 'DELETE' });
      applySharedProjectResponse(response);
      setNotice(t('sharing.linkDisabled'));
    } catch (shareError) {
      setError(messageOf(shareError));
    } finally {
      setShareBusy(false);
    }
  }

  function applySharedProjectResponse(response: ShareResponse) {
    const revision = response.project.revision ?? projectRevisionRef.current;
    projectRevisionRef.current = revision;
    setProjectRevision(revision);
    setCollaboration(normalizeProjectCollaboration(response.project.collaboration));
    setSharePath(response.path ?? null);
    void refreshProjects(projectId).catch((refreshError) => setError(messageOf(refreshError)));
  }

  function showBoundaryGuidance() {
    setError(null);
    setNotice(null);
    setGuidance(t('guidance.pointOutside'));
  }

  async function runBusy<T>(label: string, operation: () => Promise<T>) {
    setBusy(label);
    setError(null);
    setGuidance(null);
    try {
      return await operation();
    } catch (operationError) {
      setError(messageOf(operationError));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const completed = {
    site: Boolean(site),
    profile: Boolean(siteProfile),
    species: selectedSpeciesIds.length >= 3,
    layout: Boolean(selectedVariant),
    water: Boolean(irrigation),
    fire: fireOperations.tasks.every((task) => task.status === 'complete' || task.status === 'not-applicable'),
    costs: Boolean(costs),
    analysis: Boolean(projectAnalysis && projectAnalysis.contextFingerprint === projectAnalysisFingerprint(currentAssistantContext())),
  };
  const onboardingLocationReady = isOnboardingLocationReady(locationSelected, mapZoom);
  const renderStepButton = (step: (typeof STEPS)[number], index: number) => {
    const Icon = step.icon;
    return <button key={step.id} data-testid={`step-${step.id}`} className={section === step.id ? 'active' : ''} onClick={() => setSection(step.id)}>
      <span className="step-number">{completed[step.id] ? <Check size={12} /> : index + 1}</span>
      <Icon size={18} />
      <span>{t(stepLabelKey(step.id))}</span>
    </button>;
  };

  return (
    <div className={`app-shell ${selectedVariant ? 'has-succession-timeline' : ''} ${onboarding?.status === 'active' ? `onboarding-active onboarding-active-${onboarding.step}` : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setSection('site')} aria-label={`${t('nav.home')} · growup · ${t('brand.tagline')}`}>
          <span className="brand-mark"><Sprout size={21} strokeWidth={2.4} /></span>
          <span><strong>growup</strong><small>{t('brand.tagline')}</small></span>
        </button>
        <div className="project-title">
          <span className="eyebrow">{site ? t('project.activeField') : t('project.noField')}</span>
          <input
            aria-label={t('project.nameLabel')}
            value={projectName}
            maxLength={120}
            onChange={(event) => {
              projectNameEditedRef.current = true;
              setProjectName(event.target.value);
            }}
            onBlur={() => {
              if (!projectName.trim()) {
                projectNameEditedRef.current = false;
                setProjectName(t('project.newTitle'));
              }
            }}
          />
        </div>
        <div className="top-actions">
          <button className="button ai-trigger mobile-top-action mobile-ai-trigger" aria-label={t('actions.ask')} title={t('actions.ask')} onClick={() => setAssistantOpen(true)}>
            <Sparkles size={16} />
          </button>
          {authUser && <button className="mobile-top-action projects-trigger" aria-label={t('projects.open')} title={t('projects.open')} aria-expanded={projectsOpen} onClick={() => { setMobileMenuOpen(false); setProjectsOpen(true); }}><FolderOpen size={17} /></button>}
          <button className="mobile-top-action mobile-menu-trigger" aria-label={t('mobile.openMenu')} aria-expanded={mobileMenuOpen} aria-controls="mobile-product-menu" onClick={() => setMobileMenuOpen((value) => !value)}><Menu size={18} /></button>
        </div>
      </header>

      {mobileMenuOpen && <div className="mobile-menu-layer">
        <button className="mobile-menu-backdrop" aria-label={t('mobile.closeMenu')} onClick={() => setMobileMenuOpen(false)} />
        <aside id="mobile-product-menu" className="mobile-product-menu" role="dialog" aria-modal="true" aria-label={t('mobile.menu')}>
          <header><span><strong>{t('mobile.menu')}</strong><small>{projectName}</small></span><button aria-label={t('mobile.closeMenu')} onClick={() => setMobileMenuOpen(false)}><X size={18} /></button></header>
          {site && <div className={`mobile-save-status ${saveStatus}`} data-testid="save-status"><i /><span>{t(`auth.status.${saveStatus}`)}{projectRevision > 0 ? ` · r${projectRevision}` : ''}</span></div>}
          <div className="mobile-language-picker" role="group" aria-label={t('language.label')}>
            <span>{t('language.label')}</span>
            <div>{SUPPORTED_LOCALES.map((item) => <button key={item.code} aria-label={item.label} aria-pressed={locale === item.code} className={locale === item.code ? 'active' : ''} onClick={() => { setLocale(item.code); setMobileMenuOpen(false); }}><b aria-hidden="true">{item.flag}</b><small>{item.shortLabel}</small></button>)}</div>
          </div>
          <nav>
            <button onClick={() => { setMobileMenuOpen(false); updateOnboarding('active', 'welcome'); }}><span><MapIcon size={17} />{t('onboarding.tour')}</span><ChevronRight size={16} /></button>
            <button onClick={() => { setMobileMenuOpen(false); setInfoOpen(true); }}><span><Info size={17} />{t('info.open')}</span><ChevronRight size={16} /></button>
            <button onClick={() => { setMobileMenuOpen(false); void saveProject(); }} disabled={!site || Boolean(busy)}><span><Save size={17} />{t('actions.save')}</span><ChevronRight size={16} /></button>
            <button onClick={() => { setMobileMenuOpen(false); setHistoryOpen(true); }} disabled={!authUser || projectRevision < 1}><span><Database size={17} />{t('auth.history')}</span><ChevronRight size={16} /></button>
            <button onClick={() => { setMobileMenuOpen(false); void openCollaboration(); }} disabled={!site}><span><Share2 size={17} />{t('sharing.open')}</span><ChevronRight size={16} /></button>
          </nav>
          <div className="mobile-export-actions">
            <a className={!selectedVariant || !authUser ? 'disabled' : ''} aria-disabled={!selectedVariant || !authUser} href={selectedVariant && authUser ? `/api/projects/${projectId}/export.geojson` : undefined} onClick={() => setMobileMenuOpen(false)}><Download size={15} />GeoJSON</a>
            <a className={!selectedVariant || !authUser ? 'disabled' : ''} aria-disabled={!selectedVariant || !authUser} href={selectedVariant && authUser ? `/api/projects/${projectId}/export.csv` : undefined} onClick={() => setMobileMenuOpen(false)}><Download size={15} />CSV</a>
          </div>
          {authUser ? <button className="mobile-account-action" onClick={() => { setMobileMenuOpen(false); void logout(); }}>
            {authUser.pictureUrl ? <img src={authUser.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <span>{authUser.name.slice(0, 1).toUpperCase()}</span>}
            <strong>{authUser.name}</strong><small>{t('auth.signOut')}</small><LogOut size={17} />
          </button> : <button className="mobile-account-action signed-out" onClick={() => { setMobileMenuOpen(false); setAuthOpen(true); }}><span><LogIn size={17} /></span><strong>{t('auth.signIn')}</strong><small>{t('auth.workspace')}</small><ChevronRight size={17} /></button>}
        </aside>
      </div>}

      {recoveryDraft && !site && <div className="recovery-banner" role="status"><span><Save size={16} /><strong>{t('auth.recoveryTitle')}</strong><small>{t('auth.recoveryBody', { name: recoveryDraft.name })}</small></span><button onClick={recoverLocalDraft}>{t('auth.recover')}</button><button onClick={discardLocalDraft}>{t('auth.discard')}</button></div>}

      <aside className="step-rail" aria-label={t('nav.workflow')}>
        {STEPS.map(renderStepButton)}
        <div className="rail-data">
          <Database size={16} />
          <strong>{catalogueStats ? compactNumber(catalogueStats.total) : '—'}</strong>
          <span>{t('nav.taxa')}</span>
        </div>
      </aside>

      <main className="workspace">
        <section className={`map-stage ${isGeometryDrawMode(drawMode) ? 'drawing' : ''} ${selectedVariant ? 'has-timeline' : ''}`} aria-label={t('map.interactive')}>
          <div ref={mapElementRef} className="map-canvas" />
          {mapError && <div className="map-error"><Satellite size={22} /><strong>{t('map.unavailable')}</strong><span>{mapError}</span></div>}
          {isGeometryDrawMode(drawMode) && <div className="drawing-status" role="status">
            <span><PencilRuler size={15} />{t(`map.drawMode.${drawMode}`)}</span>
            <strong>{t('map.pointsPlaced', { count: draftPoints.length })}</strong>
            <small>{draftPoints.length < (drawMode === 'path' ? 2 : 3) ? t('map.pointsRemaining', { count: (drawMode === 'path' ? 2 : 3) - draftPoints.length }) : t('map.readyToFinish')}</small>
          </div>}
          <div className="map-toolbar">
            <MapToolbarButton icon={MousePointer2} label={t('map.editSite')} hint={t('map.tooltip.editSite')} active={drawMode === 'edit-site'} onClick={() => activateDrawMode(drawMode === 'edit-site' ? 'idle' : 'edit-site')} />
            <MapToolbarButton icon={ScanLine} label={t('map.editConstraints')} hint={t('map.tooltip.editConstraints')} active={drawMode === 'edit-constraints'} onClick={() => activateDrawMode(drawMode === 'edit-constraints' ? 'idle' : 'edit-constraints')} />
            <MapToolbarButton icon={PencilRuler} label={t('map.drawSite')} hint={t('map.tooltip.drawSite')} active={drawMode === 'site'} onClick={() => activateDrawMode('site')} />
            <MapToolbarButton icon={CircleOff} label={t('map.drawHole')} hint={t('map.tooltip.drawHole')} active={drawMode === 'hole'} onClick={() => activateDrawMode('hole')} />
            <MapToolbarButton icon={Ban} label={t('map.drawExclusion')} hint={t('map.tooltip.drawExclusion')} active={drawMode === 'exclusion'} onClick={() => activateDrawMode('exclusion')} />
            <MapToolbarButton icon={Tractor} label={t('map.drawPath')} hint={t('map.tooltip.drawPath')} active={drawMode === 'path'} onClick={() => activateDrawMode('path')} />
            {isGeometryDrawMode(drawMode) && <MapToolbarButton icon={Check} label={t('map.finish')} hint={t('map.tooltip.finish')} className="finish" onClick={finishDraft} />}
            <span />
            <MapToolbarButton icon={Layers3} label={t('map.layers')} hint={t('map.tooltip.layers')} active={showLayerPanel} className="layers" expanded={showLayerPanel} onClick={() => setShowLayerPanel((value) => !value)} />
            <MapToolbarButton icon={Waypoints} label={t('map.editIrrigation')} hint={t('map.tooltip.editIrrigation')} active={editingIrrigation} className="water" disabled={!irrigation} onClick={() => { setShowIrrigation(true); setEditingIrrigation((value) => !value); }} />
          </div>
          {showLayerPanel && <div className="map-layer-panel" data-testid="map-layer-panel" role="group" aria-label={t('map.layers')}>
            <header><span><Layers3 size={16} /><strong>{t('map.layersTitle')}</strong></span><button aria-label={t('map.closeLayers')} onClick={() => setShowLayerPanel(false)}><X size={15} /></button></header>
            <p>{t('map.layersHint')}</p>
            <small>{t('map.planningLayers')}</small>
            <MapLayerToggle icon={MapIcon} tone="boundary" active={showBoundary} disabled={!site} label={t('map.layerBoundary')} hint={t('map.layerBoundaryHint')} toggleLabel={t('map.toggleBoundary')} onToggle={() => { const next = !showBoundary; setShowBoundary(next); if (!next && drawMode === 'edit-site') setDrawMode('idle'); }} />
            <MapLayerToggle icon={CircleOff} tone="exclusions" active={showNoPlantAreas} disabled={!site || (!site.holes.length && !site.exclusions.length)} label={t('map.layerExclusions')} hint={t('map.layerExclusionsHint')} toggleLabel={t('map.toggleExclusions')} onToggle={() => setShowNoPlantAreas((value) => !value)} />
            <MapLayerToggle icon={Route} tone="paths" active={showManagementPaths} disabled={!site?.paths.length} label={t('map.layerPaths')} hint={t('map.layerPathsHint')} toggleLabel={t('map.togglePaths')} onToggle={() => setShowManagementPaths((value) => !value)} />
            <MapLayerToggle icon={LocateFixed} tone="infrastructure" active={showInfrastructure} disabled={!site || (!site.accessPoints.length && !site.waterPoints.length)} label={t('map.layerInfrastructure')} hint={t('map.layerInfrastructureHint')} toggleLabel={t('map.toggleInfrastructure')} onToggle={() => setShowInfrastructure((value) => !value)} />
            <MapLayerToggle icon={TreePine} tone="observed" active={showObservedTrees} disabled={!site?.existingTrees.length} label={t('map.layerObservedTrees')} hint={t('map.layerObservedTreesHint')} toggleLabel={t('map.toggleObservedTrees')} onToggle={() => setShowObservedTrees((value) => !value)} />
            <MapLayerToggle icon={Sprout} tone="trees" active={showPlannedTrees} disabled={!selectedVariant} label={t('map.layerTrees')} hint={t('map.layerTreesHint')} toggleLabel={t('map.toggleTrees')} onToggle={() => setShowPlannedTrees((value) => !value)} />
            <MapLayerToggle icon={Tractor} tone="machinery" active={showMachinery} disabled={!selectedVariant?.machinery.enabled} label={t('map.layerMachinery')} hint={t('map.layerMachineryHint')} toggleLabel={t('map.toggleMachinery')} onToggle={() => setShowMachinery((value) => !value)} />
            <MapLayerToggle icon={Flame} tone="firebreak" active={showFirebreaks} disabled={!selectedVariant?.firebreak?.enabled} label={t('map.layerFirebreak')} hint={t('map.layerFirebreakHint')} toggleLabel={t('map.toggleFirebreak')} onToggle={() => setShowFirebreaks((value) => !value)} />
            <MapLayerToggle icon={Droplets} tone="irrigation" active={showIrrigation} disabled={!irrigation} label={t('map.layerIrrigation')} hint={t('map.layerIrrigationHint')} toggleLabel={t('map.toggleIrrigation')} onToggle={() => { const next = !showIrrigation; setShowIrrigation(next); if (!next) setEditingIrrigation(false); }} />
            <small>{t('map.evidenceLayers')}</small>
            <MapLayerToggle icon={Flame} tone="risk" active={showFireWeather} disabled={!site} label={t('map.layerFireWeather')} hint={t('map.layerFireWeatherHint')} toggleLabel={t('map.toggleFireWeather')} onToggle={() => setShowFireWeather((value) => !value)} />
            <MapLayerToggle icon={WindIcon} tone="wind" active={showWind} disabled={siteProfile?.solar.status !== 'available'} label={t('map.layerWind')} hint={t('map.layerWindHint')} toggleLabel={t('map.toggleWind')} onToggle={() => setShowWind((value) => !value)} />
            <MapLayerToggle icon={TreePine} tone="vegetation" active={showExistingVegetation} disabled={!siteProfile?.satellite.existingVegetation.patches.length} label={t('map.layerVegetation')} hint={t('map.layerVegetationHint')} toggleLabel={t('map.toggleVegetation')} onToggle={() => setShowExistingVegetation((value) => !value)} />
            <MapLayerToggle icon={Waves} tone="ndmi" active={showNdmi} disabled={!siteProfile?.satellite.optical.ndmiPreviewUrl} label={t('map.layerNdmi')} hint={t('map.layerNdmiHint')} toggleLabel={t('map.toggleNdmi')} onToggle={() => setShowNdmi((value) => !value)} />
            <MapLayerToggle icon={Droplets} tone="water" active={showWaterSamples} disabled={!siteProfile?.satellite.optical.waterSamples.length} label={t('map.layerWater')} hint={t('map.layerWaterHint')} toggleLabel={t('map.toggleWater')} onToggle={() => setShowWaterSamples((value) => !value)} />
          </div>}
          {editingIrrigation && irrigation && <div className="irrigation-edit-status"><Route size={15} /><span><strong>{t('map.editIrrigation')}</strong><small>{t('map.editIrrigationHint')}</small></span></div>}
          {selectedVariant && (
            <div className="timeline-control" data-testid="succession-timeline">
              <div><span>{t('timeline.year')}</span><strong>{timelineYear}</strong></div>
              <input aria-label={t('timeline.year')} type="range" min="0" max="30" value={timelineYear} onChange={(event) => setTimelineYear(Number(event.target.value))} />
              <div className="timeline-marks"><span>{t('timeline.planting')}</span><span>{t('timeline.establishment')}</span><span>{t('timeline.maturity')}</span></div>
            </div>
          )}
          {showExistingVegetation && Boolean(siteProfile?.satellite.existingVegetation.patches.length) && (
            <div className="vegetation-legend">
              <span><i /> {t('map.existingVegetation')}</span>
              <small>{t('map.protectedZone')}</small>
            </div>
          )}
          {showWaterSamples && siteProfile?.satellite.optical.latest && (
            <div className="satellite-legend">
              <span><i className="dry" /> {t('map.priorityHigh')}</span>
              <span><i className="balanced" /> {t('map.priorityMonitor')}</span>
              <span><i className="wet" /> {t('map.priorityLow')}</span>
              <small>Sentinel-2 · {shortDate(siteProfile.satellite.optical.latest.acquiredAt, locale)}</small>
            </div>
          )}
          {showWind && siteProfile?.solar.status === 'available' && siteProfile.solar.prevailingWindDirectionDegrees !== null && (
            <div className="wind-map-legend" data-testid="wind-map-legend">
              <i style={{ transform: `rotate(${siteProfile.solar.prevailingWindDirectionDegrees + 180}deg)` }}>↑</i>
              <span><small>{t('wind.mapEyebrow')}</small><strong>{t('wind.fromDirection', { direction: siteProfile.solar.prevailingWindDirectionLabel ?? '—' })}</strong><b>{t('wind.mapSpeed', { mean: formatNumber(siteProfile.solar.meanWindSpeedMs ?? 0, 1), p90: formatNumber(siteProfile.solar.windSpeedP90Ms ?? 0, 1) })}</b></span>
            </div>
          )}
        </section>

        <section className="inspector">
          <InspectorHeader section={section} onPrevious={() => setSection(previousSection(section))} onNext={() => setSection(nextSection(section))} />
          {section === 'site' && <SitePanel
            site={site}
            profile={siteProfile}
            validation={siteValidation}
            drawMode={drawMode}
            onDrawMode={activateDrawMode}
            onAnalyze={analyzeSite}
            onClear={() => setClearSiteOpen(true)}
            onUpdate={invalidateSite}
            onImport={importGeoJsonFile}
            locationQuery={locationQuery}
            locationResults={locationResults}
            onLocationQuery={updateLocationQuery}
            onLocationSearch={searchLocation}
            onLocationSelect={focusLocation}
            onCoordinate={useEnteredCoordinate}
            onUndo={undoSite}
            onRedo={redoSite}
            canUndo={siteUndoRef.current.length > 0}
            canRedo={siteRedoRef.current.length > 0}
            busy={Boolean(busy)}
          />}
          {section === 'profile' && <ProfilePanel profile={siteProfile} hasSite={Boolean(site)} onAnalyze={analyzeSite} onOpenSite={() => setSection('site')} onShowNdmi={() => { setShowNdmi(true); setShowWaterSamples(true); }} onOverride={overrideSiteProfile} additionalEvidence={selectedVariant?.firebreak?.enabled ? selectedVariant.firebreak.evidence : []} />}
          {section === 'species' && <SpeciesPanel recommendations={recommendations} siteProfile={siteProfile} selectedIds={selectedSpeciesIds} onToggle={toggleSpecies} onGenerate={generateDesign} query={catalogueQuery} onQuery={setCatalogueQuery} onSearch={searchCatalogue} catalogueResults={catalogueResults} stats={catalogueStats} design={designConfiguration} onDesign={updateDesignConfiguration} />}
          {section === 'layout' && <LayoutPanel variants={variants} selectedVariant={selectedVariant} onSelect={(id) => { setSelectedVariantId(id); setSelectedTreeId(null); setSelectedTreeIds([]); }} selectedTree={selectedTree} selectedTreeIds={selectedTreeIds} onTreeSelect={selectTree} onSelectGroup={selectTreeGroup} onClearSelection={() => { setSelectedTreeId(null); setSelectedTreeIds([]); }} onReplaceSelected={replaceSelectedTrees} onLockSelected={lockSelectedTrees} onDeleteSelected={deleteSelectedTrees} onAlignSelected={() => alignSelectedTrees(false)} onSpaceSelected={() => alignSelectedTrees(true)} selectedSpecies={selectedSpecies} treeSpeciesId={treeSpeciesId} onTreeSpecies={setTreeSpeciesId} drawMode={drawMode} onMode={activateDrawMode} onDelete={deleteSelectedTree} onLock={toggleTreeLock} onUndo={undoTrees} onRedo={redoTrees} canUndo={undoRef.current.length > 0} canRedo={redoRef.current.length > 0} onRegenerate={regenerateUnlockedDesign} onCalculate={calculateWaterAndCosts} onOpenSpecies={() => setSection('species')} onFireOperations={() => setSection('fire')} />}
          {section === 'water' && <WaterPanel site={site} irrigation={irrigation} configuration={irrigationConfiguration} onConfiguration={setIrrigationConfiguration} profile={siteProfile} canCalculate={Boolean(selectedVariant && siteProfile)} onCalculate={calculateWaterAndCosts} onPrepare={() => setSection(selectedVariant ? 'layout' : 'species')} onCosts={() => setSection('costs')} onShowZones={() => { setShowWaterSamples(true); setShowNdmi(false); }} editingIrrigation={editingIrrigation} onEditIrrigation={() => { setShowIrrigation(true); setEditingIrrigation((value) => !value); }} />}
          {section === 'fire' && <FireOperationsPanel
            profile={siteProfile}
            variant={selectedVariant}
            plan={fireOperations}
            onPlan={(value) => setFireOperations(normalizeFireOperationsPlan(value))}
            onTask={updateFireTask}
            onShowLayer={() => setShowFireWeather(true)}
          />}
          {section === 'costs' && <CostsPanel costs={costs} irrigation={irrigation} species={selectedSpecies} configuration={economicConfiguration} onConfiguration={(value) => { setEconomicConfiguration(normalizeEconomicConfiguration(value, siteProfile?.location.countryCode ?? value.countryCode)); setIrrigation(null); setCosts(null); }} canCalculate={Boolean(selectedVariant && siteProfile)} onCalculate={calculateWaterAndCosts} onPrepare={() => setSection(selectedVariant ? 'layout' : 'species')} onSchedule={() => setScheduleOpen(true)} />}
          {section === 'analysis' && <ProjectAnalysisPanel
            configured={Boolean(config?.assistant.configured)}
            context={currentAssistantContext()}
            report={projectAnalysis}
            busy={analysisBusy}
            error={analysisError}
            onRun={runProjectAnalysis}
            onOpenSection={setSection}
          />}
        </section>
      </main>

      {onboarding?.status === 'active' && <OnboardingTour
        preference={onboarding}
        projectName={projectName}
        onProjectName={setProjectName}
        draftPointCount={draftPoints.length}
        siteReady={Boolean(site)}
        analysisReady={Boolean(site && siteValidation?.valid)}
        designReady={selectedSpeciesIds.length >= (designConfiguration.system === 'syntropic' ? 3 : designConfiguration.system === 'monoculture' ? 1 : 2)}
        locationSelected={locationSelected}
        locationReady={onboardingLocationReady}
        onStart={startOnboarding}
        onBoundary={beginOnboardingBoundary}
        onFinishBoundary={finishDraft}
        onAnalyse={analyzeSite}
        onGenerate={generateDesign}
        onCalculate={calculateWaterAndCosts}
        onViewCosts={() => setSection('costs')}
        onSkip={() => updateOnboarding('skipped', onboarding.step)}
        onComplete={() => updateOnboarding('completed', 'complete')}
      />}

      {assistantOpen && config && <AssistantPanel
        configured={config.assistant.configured}
        input={assistantInput}
        onInput={setAssistantInput}
        proposal={assistantProposal}
        busy={assistantBusy}
        error={assistantError}
        onAsk={askAssistant}
        onApply={applyAssistantProposal}
        onDismiss={() => { setAssistantProposal(null); setAssistantError(null); }}
        onClose={() => setAssistantOpen(false)}
      />}

      {authOpen && config && <AuthPanel
        configured={config.auth.configured}
        clientId={config.auth.googleClientId}
        locale={locale}
        onCredential={authenticateGoogle}
        onClose={() => setAuthOpen(false)}
      />}

      {infoOpen && <InfoPanel onClose={() => setInfoOpen(false)} />}

      {clearSiteOpen && <ClearSiteDialog onCancel={() => setClearSiteOpen(false)} onConfirm={clearSite} />}

      {projectsOpen && authUser && <ProjectsPage
        projects={projects}
        activeProjectId={projectId}
        onOpen={(id) => { setProjectsOpen(false); void openProject(id); }}
        onClose={() => setProjectsOpen(false)}
      />}

      {historyOpen && <ProjectHistoryPanel projectId={projectId} revisions={revisions} onRestore={restoreRevision} onClose={() => setHistoryOpen(false)} />}

      {collaborationOpen && config && <CollaborationPanel
        authenticated={Boolean(authUser)}
        configured={config.sharing.configured}
        collaboration={collaboration}
        sharePath={sharePath}
        busy={shareBusy}
        onEnable={enableProjectSharing}
        onDisable={disableProjectSharing}
        onSignIn={() => setAuthOpen(true)}
        onResolve={(id) => setCollaboration((value) => ({
          ...value,
          comments: value.comments.map((comment) => comment.id === id ? { ...comment, resolvedAt: comment.resolvedAt ? null : new Date().toISOString() } : comment),
        }))}
        onClose={() => setCollaborationOpen(false)}
      />}

      {scheduleOpen && site && siteProfile && selectedVariant && irrigation && costs && <OperationalSchedulePanel
        projectName={projectName}
        site={site}
        profile={siteProfile}
        variant={selectedVariant}
        species={selectedSpecies}
        irrigation={irrigation}
        costs={costs}
        revision={projectRevision}
        calculationRunId={revisions[0]?.calculationRunId ?? null}
        onClose={() => setScheduleOpen(false)}
      />}

      {(busy || error || guidance || notice) && (
        <div className={`toast ${error ? 'error' : guidance ? 'guidance' : notice ? 'success' : ''}`} role="status">
          {busy ? <LoaderCircle className="spin" size={18} /> : error ? <span className="toast-symbol">!</span> : guidance ? <Info size={18} /> : <Check size={18} />}
          <span>{busy ?? error ?? guidance ?? notice}</span>
          {!busy && <button aria-label={t('actions.close')} onClick={() => { setError(null); setGuidance(null); setNotice(null); }}>×</button>}
        </div>
      )}
    </div>
  );
}

function OnboardingTour({
  preference,
  projectName,
  onProjectName,
  draftPointCount,
  siteReady,
  analysisReady,
  designReady,
  locationSelected,
  locationReady,
  onStart,
  onBoundary,
  onFinishBoundary,
  onAnalyse,
  onGenerate,
  onCalculate,
  onViewCosts,
  onSkip,
  onComplete,
}: {
  preference: OnboardingPreference;
  projectName: string;
  onProjectName: (value: string) => void;
  draftPointCount: number;
  siteReady: boolean;
  analysisReady: boolean;
  designReady: boolean;
  locationSelected: boolean;
  locationReady: boolean;
  onStart: (name: string) => void;
  onBoundary: () => void;
  onFinishBoundary: () => void;
  onAnalyse: () => void;
  onGenerate: () => void;
  onCalculate: () => void;
  onViewCosts: () => void;
  onSkip: () => void;
  onComplete: () => void;
}) {
  const { t } = useI18n();
  const order: OnboardingStep[] = ['welcome', 'location', 'boundary', 'analysis', 'species', 'design', 'complete'];
  const stepIndex = Math.max(0, order.indexOf(preference.step));
  const content = {
    welcome: { title: t('onboarding.welcomeTitle'), body: t('onboarding.welcomeBody') },
    location: { title: t('onboarding.locationTitle'), body: t('onboarding.locationBody') },
    boundary: { title: t('onboarding.boundaryTitle'), body: t('onboarding.boundaryBody') },
    analysis: { title: t('onboarding.analysisTitle'), body: t('onboarding.analysisBody') },
    species: { title: t('onboarding.speciesTitle'), body: t('onboarding.speciesBody') },
    design: { title: t('onboarding.designTitle'), body: t('onboarding.designBody') },
    complete: { title: t('onboarding.completeTitle'), body: t('onboarding.completeBody') },
  }[preference.step];

  if (preference.step === 'welcome') {
    return <div className="onboarding-backdrop" data-testid="onboarding-tour" onMouseDown={(event) => event.target === event.currentTarget && onSkip()}>
      <section className="onboarding-welcome" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button className="onboarding-close" aria-label={t('onboarding.skip')} onClick={onSkip}><X size={18} /></button>
        <span className="onboarding-mark"><Sprout size={26} /></span>
        <small>{t('onboarding.eyebrow')}</small>
        <h2 id="onboarding-title">{content.title}</h2>
        <p>{content.body}</p>
        <label><span>{t('project.nameLabel')}</span><input value={projectName} maxLength={120} onChange={(event) => onProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && projectName.trim() && onStart(projectName)} /></label>
        <div className="onboarding-actions"><button onClick={onSkip}>{t('onboarding.skip')}</button><button className="primary" disabled={!projectName.trim()} onClick={() => onStart(projectName)}>{t('onboarding.start')}<ChevronRight size={17} /></button></div>
        <span className="onboarding-promise"><ShieldCheck size={14} />{t('onboarding.persistence')}</span>
      </section>
    </div>;
  }

  return <aside className={`onboarding-coach step-${preference.step}`} data-testid="onboarding-tour" role="dialog" aria-labelledby="onboarding-coach-title">
    <header><span>{t('onboarding.progress', { current: stepIndex + 1, total: order.length })}</span><button aria-label={t('onboarding.skip')} onClick={onSkip}><X size={16} /></button></header>
    <div className="onboarding-progress" aria-hidden="true"><i style={{ width: `${((stepIndex + 1) / order.length) * 100}%` }} /></div>
    <h2 id="onboarding-coach-title">{content.title}</h2>
    <p>{content.body}</p>
    {preference.step === 'location' && <>
      <span className={`onboarding-location-state ${locationReady ? 'ready' : ''}`} role="status">
        {locationReady ? <Check size={14} /> : <LocateFixed size={14} />}
        {t(locationReady ? 'onboarding.locationReady' : locationSelected ? 'onboarding.locationZoomRequired' : 'onboarding.locationSelectionRequired')}
      </span>
      <button className="onboarding-primary" disabled={!locationReady} onClick={onBoundary}>{t(locationReady ? 'onboarding.drawBoundary' : locationSelected ? 'onboarding.zoomCloser' : 'onboarding.selectSpecificPlace')}<ChevronRight size={16} /></button>
    </>}
    {preference.step === 'boundary' && <button className="onboarding-primary" disabled={draftPointCount < 3 && !siteReady} onClick={onFinishBoundary}>{siteReady ? t('onboarding.boundaryReady') : t('onboarding.finishBoundary', { count: draftPointCount })}<Check size={16} /></button>}
    {preference.step === 'analysis' && <button className="onboarding-primary" disabled={!analysisReady} onClick={onAnalyse}>{analysisReady ? t('onboarding.runAnalysis') : t('onboarding.validationPending')}<FlaskConical size={16} /></button>}
    {preference.step === 'species' && <button className="onboarding-primary" disabled={!designReady} onClick={onGenerate}>{t('onboarding.generateDesign')}<TreePine size={16} /></button>}
    {preference.step === 'design' && <button className="onboarding-primary" onClick={onCalculate}>{t('onboarding.calculatePlan')}<Droplets size={16} /></button>}
    {preference.step === 'complete' && <div className="onboarding-complete-actions"><button onClick={onViewCosts}>{t('onboarding.viewCosts')}</button><button className="onboarding-primary" onClick={onComplete}>{t('onboarding.finish')}<Check size={16} /></button></div>}
    <button className="onboarding-skip" onClick={onSkip}>{t('onboarding.skip')}</button>
  </aside>;
}

function MapLayerToggle({ icon: Icon, tone, active, disabled, label, hint, toggleLabel, onToggle }: {
  icon: typeof Layers3;
  tone: 'boundary' | 'exclusions' | 'paths' | 'infrastructure' | 'observed' | 'trees' | 'machinery' | 'firebreak' | 'risk' | 'irrigation' | 'vegetation' | 'ndmi' | 'water' | 'wind';
  active: boolean;
  disabled: boolean;
  label: string;
  hint: string;
  toggleLabel: string;
  onToggle: () => void;
}) {
  const visible = active && !disabled;
  return <button type="button" className={`map-layer-toggle ${visible ? 'active' : ''}`} aria-label={toggleLabel} aria-pressed={visible} disabled={disabled} onClick={onToggle}>
    <i className={`map-layer-swatch ${tone}`}><Icon size={15} /></i>
    <span><strong>{label}</strong><small>{hint}</small></span>
    <Check className="map-layer-check" size={14} />
  </button>;
}

function MapToolbarButton({ icon: Icon, label, hint, active = false, disabled = false, expanded, className = '', onClick }: {
  icon: typeof Layers3;
  label: string;
  hint: string;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return <button
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    className={`${className} ${active ? 'active' : ''}`.trim()}
    disabled={disabled}
    onClick={onClick}
  >
    <Icon size={17} />
    <span className="map-toolbar-tooltip" role="tooltip"><strong>{label}</strong><small>{hint}</small></span>
  </button>;
}

function AuthPanel({ configured, clientId, locale, onCredential, onClose }: {
  configured: boolean;
  clientId: string;
  locale: Locale;
  onCredential: (credential: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  useEffect(() => {
    if (!configured || !clientId || !buttonRef.current) return;
    let disposed = false;
    let stopObserving: (() => void) | undefined;
    renderGoogleSignIn(buttonRef.current, clientId, locale, onCredential)
      .then((cleanup) => {
        if (disposed) cleanup();
        else stopObserving = cleanup;
      })
      .catch((error) => setIdentityError(messageOf(error)));
    return () => {
      disposed = true;
      stopObserving?.();
    };
  }, [configured, clientId, locale, onCredential]);
  return (
    <div className="auth-backdrop" role="presentation">
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" aria-label={t('auth.close')} onClick={onClose}><X size={17} /></button>
        <span className="auth-mark"><Sprout size={25} /></span>
        <small>{t('auth.workspace')}</small>
        <h2 id="auth-title">{t('auth.title')}</h2>
        <p>{t('auth.body')}</p>
        {configured ? <div className="google-signin" ref={buttonRef} /> : (
          <div className="auth-setup"><ShieldCheck size={17} /><span><strong>{t('auth.setupTitle')}</strong><small>{t('auth.setupBody')}</small></span></div>
        )}
        {identityError && <div className="assistant-error"><strong>{t('auth.failed')}</strong><span>{identityError}</span></div>}
        <div className="auth-trust"><ShieldCheck size={15} /> {t('auth.trust')}</div>
      </section>
    </div>
  );
}

function InfoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const features = [
    { icon: Satellite, title: t('info.readTitle'), body: t('info.readBody') },
    { icon: TreePine, title: t('info.designTitle'), body: t('info.designBody') },
    { icon: Droplets, title: t('info.buildTitle'), body: t('info.buildBody') },
  ];
  return (
    <div className="info-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="info-panel" role="dialog" aria-modal="true" aria-labelledby="info-title" data-testid="info-panel">
        <button className="info-close" aria-label={t('info.close')} onClick={onClose} autoFocus><X size={17} /></button>
        <header><span className="info-mark"><Sprout size={24} /></span><small>{t('info.eyebrow')}</small><h2 id="info-title">{t('info.title')}</h2><p>{t('info.body')}</p></header>
        <div className="info-features">{features.map(({ icon: Icon, title, body }, index) => <article key={title}><span><Icon size={17} /></span><small>0{index + 1}</small><h3>{title}</h3><p>{body}</p></article>)}</div>
        <footer><ShieldCheck size={15} /><p>{t('info.disclaimer')}</p></footer>
      </section>
    </div>
  );
}

function InspectorHeader({ section, onPrevious, onNext }: { section: WorkspaceSection; onPrevious: () => void; onNext: () => void }) {
  const { t } = useI18n();
  const current = STEPS.find((step) => step.id === section)!;
  const Icon = current.icon;
  return (
    <div className="inspector-header">
      <div><span className="section-icon"><Icon size={18} /></span><span><small>{t('workspace.label')}</small><strong>{t(stepLabelKey(current.id))}</strong></span></div>
      <nav><button aria-label={t('nav.previous')} onClick={onPrevious}><ArrowLeft size={16} /></button><button aria-label={t('nav.next')} onClick={onNext}><ArrowRight size={16} /></button></nav>
    </div>
  );
}

function AssistantPanel({ configured, input, onInput, proposal, busy, error, onAsk, onApply, onDismiss, onClose }: {
  configured: boolean;
  input: string;
  onInput: (value: string) => void;
  proposal: AssistantProposal | null;
  busy: boolean;
  error: string | null;
  onAsk: (prompt?: string) => void;
  onApply: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const hasBodyContent = !configured || busy || Boolean(error) || Boolean(proposal);
  return (
    <aside className={`assistant-panel${hasBodyContent ? ' has-content' : ''}`} aria-label={t('assistant.aria')}>
      <header>
        <span className="assistant-mark"><Sparkles size={18} /></span>
        <span><small>{t('assistant.internal')}</small><strong>{t('actions.ask')}</strong></span>
        <button aria-label={t('assistant.close')} onClick={onClose}><X size={17} /></button>
      </header>
      {hasBodyContent && <div className="assistant-body">
        {!configured && <div className="assistant-warning">{t('assistant.unavailable')}</div>}
        {busy && <div className="assistant-thinking"><LoaderCircle className="spin" size={20} /><span>{t('assistant.reading')}</span></div>}
        {error && <div className="assistant-error"><strong>{t('assistant.notApplied')}</strong><span>{localizedDomainMessage(error, t)}</span></div>}
        {proposal && <div className="assistant-proposal" data-testid="assistant-proposal">
          <div className="assistant-answer"><small>{t('assistant.proposal')}</small><strong>{proposal.summary}</strong><p>{proposal.rationale}</p></div>
          {proposal.actions.length > 0 && <div className="assistant-actions"><small>{t('assistant.awaitingConfirmation')}</small>{proposal.actions.map((action, index) => <span key={`${action.type}-${index}`}><i>{index + 1}</i>{assistantActionLabel(action, t)}</span>)}</div>}
          {proposal.warnings.length > 0 && <div className="assistant-proposal-warnings">{proposal.warnings.map((warning) => <span key={warning}>• {warning}</span>)}</div>}
          <div className="assistant-confirm"><button onClick={onDismiss}>{t('assistant.dismiss')}</button>{proposal.requiresConfirmation ? <button className="confirm" onClick={onApply} disabled={busy}><ShieldCheck size={15} /> {t('assistant.apply')}</button> : <button className="confirm" onClick={onDismiss}>{t('assistant.done')}</button>}</div>
        </div>}
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
        <textarea
          aria-label={t('actions.ask')}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (configured && !busy && input.trim()) onAsk();
          }}
          placeholder={t('assistant.placeholder')}
          maxLength={2000}
        />
        <button aria-label={t('assistant.send')} type="submit" disabled={!configured || busy || !input.trim()}><Send size={17} /></button>
      </form>
    </aside>
  );
}

  function assistantActionLabel(action: AssistantAction, t: (key: string, values?: Record<string, string | number>) => string) {
  if (action.type === 'add_species') return t('assistant.actionAdd', { species: action.speciesIds.map((id) => speciesLabel(id, t)).join(', ') });
  if (action.type === 'remove_species') return t('assistant.actionRemove', { species: action.speciesIds.map((id) => speciesLabel(id, t)).join(', ') });
  if (action.type === 'select_variant') return t('assistant.actionSelect', { id: humanize(action.variantId) });
  if (action.type === 'set_timeline_year') return t('assistant.actionYear', { year: action.year });
  if (action.type === 'regenerate_layout') return t('assistant.actionRegenerate');
  if (action.type === 'recalculate_water_and_costs') return t('assistant.actionRecalculate');
  return t('assistant.actionOpen', { section: t(stepLabelKey(action.section)) });
}

function speciesLabel(id: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const species = DESIGN_SPECIES_BY_ID.get(id);
  return species ? speciesDisplayName(species, t) : id;
}

function SitePanel({
  site,
  profile,
  validation,
  drawMode,
  onDrawMode,
  onAnalyze,
  onClear,
  onUpdate,
  onImport,
  locationQuery,
  locationResults,
  onLocationQuery,
  onLocationSearch,
  onLocationSelect,
  onCoordinate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  busy,
}: {
  site: SiteBoundary | null;
  profile: SiteProfile | null;
  validation: SiteValidation | null;
  drawMode: DrawMode;
  onDrawMode: (mode: DrawMode) => void;
  onAnalyze: () => void;
  onClear: () => void;
  onUpdate: (site: SiteBoundary) => void;
  onImport: (file: File) => void;
  locationQuery: string;
  locationResults: LocationSearchResult[];
  onLocationQuery: (value: string) => void;
  onLocationSearch: () => void;
  onLocationSelect: (result: LocationSearchResult) => void;
  onCoordinate: (coordinate: Coordinate) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
}) {
  const { t } = useI18n();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [coordinateLat, setCoordinateLat] = useState('');
  const [coordinateLng, setCoordinateLng] = useState('');
  const removePolygon = (kind: 'holes' | 'exclusions', index: number) => {
    if (!site) return;
    onUpdate({ ...site, [kind]: site[kind].filter((_, itemIndex) => itemIndex !== index) });
  };
  return (
    <div className="panel-body persistent-action-panel">
      <div className="panel-scroll-content">
      <div className="panel-intro"><span className="eyebrow">{t('site.eyebrow')}</span><h1>{t('site.title')}</h1><p>{t('site.body')}</p></div>
      <div className="location-search">
        <Search size={16} />
        <input aria-label={t('site.searchPlace')} placeholder={t('site.searchPlaceholder')} value={locationQuery} onChange={(event) => onLocationQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onLocationSearch()} />
        <button onClick={onLocationSearch}>{t('site.find')}</button>
        {locationResults.length > 0 && <div className="location-results">{locationResults.map((result) => <button key={result.id} onClick={() => onLocationSelect(result)}><strong>{result.displayName}</strong><small>{humanize(result.type)} · {result.coordinate.lat.toFixed(5)}, {result.coordinate.lng.toFixed(5)}</small></button>)}</div>}
      </div>
      <div className="coordinate-entry">
        <label><span>{t('site.latitude')}</span><input aria-label={t('site.coordinateLatitude')} inputMode="decimal" value={coordinateLat} onChange={(event) => setCoordinateLat(event.target.value)} /></label>
        <label><span>{t('site.longitude')}</span><input aria-label={t('site.coordinateLongitude')} inputMode="decimal" value={coordinateLng} onChange={(event) => setCoordinateLng(event.target.value)} /></label>
        <button disabled={!coordinateLat.trim() || !coordinateLng.trim()} onClick={() => onCoordinate({ lat: Number(coordinateLat), lng: Number(coordinateLng) })}>{drawMode === 'idle' || drawMode.startsWith('edit') ? t('site.centreMap') : t('site.addCoordinate')}</button>
      </div>
      <div className="metric-grid">
        <Metric label={t('site.geometry')} value={validation?.geometryType ?? '—'} detail={t('site.regions', { count: validation?.counts.polygons ?? 0 })} />
        <Metric label={t('site.constraints')} value={String((site?.holes.length ?? 0) + (site?.exclusions.length ?? 0) + (site?.paths.length ?? 0) + (site?.existingTrees.length ?? 0) + (profile?.satellite.existingVegetation.patches.length ?? 0))} detail={t('site.constraintsDetail')} />
        <Metric label={t('site.grossArea')} value={validation ? `${formatNumber(validation.areaM2 / 10_000, 2)} ha` : site ? t('status.checking') : '—'} detail={t('site.areaSource')} />
        <Metric label={t('site.plantable')} value={validation ? `${formatNumber(validation.plantableAreaM2, 0)} m²` : site ? t('status.checking') : '—'} detail={site ? t('site.setbackDetail', { value: site.setbackM }) : t('site.noBoundary')} />
      </div>
      <div className={`field-card ${site ? '' : 'empty'}`}>
        <div className="field-card-icon"><LocateFixed size={20} /></div>
        <div><small>{t(site ? 'site.selectedField' : 'site.noField')}</small><strong>{site?.name ?? t('site.noFieldTitle')}</strong><span>{site ? t('site.customBoundary') : t('site.noFieldBody')}</span></div>
        {site ? <div className="field-card-actions">
          <button className="danger" aria-label={t('site.clear')} title={t('site.clear')} onClick={onClear}><Trash2 size={15} /></button>
        </div> : <div className="field-card-actions empty-actions">
          <button className="draw-site-action" onClick={() => onDrawMode('site')}><PencilRuler size={15} /><span>{t('site.draw')}</span></button>
        </div>}
      </div>
      {site && <div className={`site-validation ${validation?.valid ? 'valid' : 'pending'}`}>
        <ShieldCheck size={17} />
        <span><strong>{validation?.valid ? t('site.validationValid') : t('site.validationPending')}</strong><small>{validation?.valid ? t('site.validationReasonValid') : validation?.reason ? localizedDomainMessage(validation.reason, t) : t('site.validationFallback')}</small></span>
      </div>}
      <div className="site-history-actions">
        <button onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /> {t('site.undo')}</button>
        <button onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /> {t('site.redo')}</button>
        <button onClick={() => importInputRef.current?.click()}><Upload size={14} /> {t('site.import')}</button>
        <input ref={importInputRef} className="visually-hidden" aria-label={t('site.import')} type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = '';
        }} />
      </div>
      <div className="site-tool-grid" aria-label={t('site.tools')}>
        <button disabled={!site} className={drawMode === 'edit-constraints' ? 'active' : ''} onClick={() => onDrawMode('edit-constraints')}><MousePointer2 size={15} /><span>{t('site.editFeatures')}<small>{t('site.dragVertices')}</small></span></button>
        <button disabled={!site} className={drawMode === 'hole' ? 'active' : ''} onClick={() => onDrawMode('hole')}><CircleOff size={15} /><span>{t('site.hole')}<small>{t('site.holeDetail')}</small></span></button>
        <button disabled={!site} className={drawMode === 'exclusion' ? 'active' : ''} onClick={() => onDrawMode('exclusion')}><Layers3 size={15} /><span>{t('site.exclusion')}<small>{t('site.exclusionDetail')}</small></span></button>
        <button disabled={!site} className={drawMode === 'path' ? 'active' : ''} onClick={() => onDrawMode('path')}><Route size={15} /><span>{t('site.path')}<small>{t('site.pathDetail')}</small></span></button>
        <button disabled={!site} className={drawMode === 'access-point' ? 'active' : ''} onClick={() => onDrawMode('access-point')}><LocateFixed size={15} /><span>{t('site.access')}<small>{t('site.accessDetail')}</small></span></button>
        <button disabled={!site} className={drawMode === 'water-point' ? 'active' : ''} onClick={() => onDrawMode('water-point')}><Droplets size={15} /><span>{t('site.water')}<small>{t('site.waterDetail')}</small></span></button>
        <button disabled={!site} className={drawMode === 'existing-tree' ? 'active' : ''} onClick={() => onDrawMode('existing-tree')}><TreePine size={15} /><span>{t('site.existingTree')}<small>{t('site.existingTreeDetail')}</small></span></button>
      </div>
      {site && <div className="site-parameters">
        <label><span>{t('site.boundarySetback')}<small>{t('site.boundarySetbackDetail')}</small></span><span><input aria-label={t('site.boundarySetback')} type="number" min="0" max="30" step="0.1" value={site.setbackM} onChange={(event) => onUpdate({ ...site, setbackM: Number(event.target.value) })} /> m</span></label>
        {site.paths.map((path) => <label key={path.id}><span>{path.name}<small>{t('site.vertices', { count: path.points.length })}</small></span><span><input aria-label={t('site.pathWidth', { name: path.name })} type="number" min="0.5" max="30" step="0.5" value={path.widthM} onChange={(event) => onUpdate({ ...site, paths: site.paths.map((item) => item.id === path.id ? { ...item, widthM: Number(event.target.value) } : item) })} /> m <button aria-label={t('site.removeFeature', { name: path.name })} onClick={() => onUpdate({ ...site, paths: site.paths.filter((item) => item.id !== path.id) })}><X size={12} /></button></span></label>)}
      </div>}
      {site && (site.holes.length + site.exclusions.length + site.accessPoints.length + site.waterPoints.length + site.existingTrees.length > 0) && <div className="site-feature-list">
        {site.holes.map((_, index) => <span key={`hole-${index}`}><i>H{index + 1}</i><strong>{t('site.siteHole')}</strong><button aria-label={t('site.removeHole', { count: index + 1 })} onClick={() => removePolygon('holes', index)}><X size={13} /></button></span>)}
        {site.exclusions.map((_, index) => <span key={`exclusion-${index}`}><i>X{index + 1}</i><strong>{t('site.noPlantExclusion')}</strong><button aria-label={t('site.removeExclusion', { count: index + 1 })} onClick={() => removePolygon('exclusions', index)}><X size={13} /></button></span>)}
        {site.accessPoints.map((point) => <span key={point.id}><i>A</i><strong>{point.name}</strong><button aria-label={t('site.removeFeature', { name: point.name })} onClick={() => onUpdate({ ...site, accessPoints: site.accessPoints.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
        {site.waterPoints.map((point) => <span key={point.id}><i>W</i><strong>{point.name}</strong><button aria-label={t('site.removeFeature', { name: point.name })} onClick={() => onUpdate({ ...site, waterPoints: site.waterPoints.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
        {site.existingTrees.map((point) => <span key={point.id}><i>T</i><strong>{point.name}</strong><button aria-label={t('site.removeFeature', { name: point.name })} onClick={() => onUpdate({ ...site, existingTrees: site.existingTrees.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
      </div>}
      <div className="callout"><CloudSun size={18} /><div><strong>{t('site.climateTitle')}</strong><span>{t('site.climateBody')}</span></div></div>
      <p className="fine-print">{t('site.executionNote')}</p>
      </div>
      <div className="panel-action-bar">
        <button className="button primary wide sticky-action analyse-site-action" onClick={onAnalyze} disabled={!site || !validation?.valid || busy}>{profile ? t('actions.refresh') : t('actions.analyse')}<ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function ClearSiteDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return (
    <div className="confirmation-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-site-title" aria-describedby="clear-site-description">
        <span className="confirmation-mark"><Trash2 size={22} /></span>
        <small>{t('site.clearEyebrow')}</small>
        <h2 id="clear-site-title">{t('site.clearTitle')}</h2>
        <p id="clear-site-description">{t('site.clearBody')}</p>
        <div className="confirmation-actions">
          <button onClick={onCancel}>{t('actions.cancel')}</button>
          <button className="danger" onClick={onConfirm}><Trash2 size={15} />{t('site.clearConfirm')}</button>
        </div>
      </section>
    </div>
  );
}

function FireOperationsPanel({ profile, variant, plan, onPlan, onTask, onShowLayer }: {
  profile: SiteProfile | null;
  variant: LayoutVariant | null;
  plan: FireOperationsPlan;
  onPlan: (plan: FireOperationsPlan) => void;
  onTask: (id: FireMaintenanceTask['id'], patch: Partial<FireMaintenanceTask>) => void;
  onShowLayer: () => void;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'analysis' | 'data' | 'sources' | 'operations'>('analysis');
  const assessment = useMemo(() => assessFireScreening(profile, variant), [profile, variant]);
  const complete = plan.tasks.filter((task) => task.status === 'complete' || task.status === 'not-applicable').length;
  const evidence = assessment.components
    .flatMap((component) => component.evidence)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.source === item.source && candidate.version === item.version) === index);
  const componentIcon = (id: FireScreeningComponentId) => {
    if (id === 'wind') return WindIcon;
    if (id === 'terrain') return MapIcon;
    if (id === 'fuels') return Leaf;
    if (id === 'protection') return ShieldCheck;
    return Flame;
  };
  return <div className="panel-body fire-operations-page" data-testid="fire-operations-panel">
    <div className="panel-intro compact fire-operations-intro">
      <span className="eyebrow">{t('fireAnalysis.eyebrow')}</span>
      <h1 id="fire-operations-title">{t('fireAnalysis.title')}</h1>
      <p>{t('fireAnalysis.body')}</p>
    </div>
    <div className="fire-analysis-tabs" role="tablist" aria-label={t('fireAnalysis.tabs')}>
      {([
        ['analysis', Flame],
        ['data', Database],
        ['sources', Satellite],
        ['operations', ClipboardCheck],
      ] as const).map(([id, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
        <Icon size={15} /><span>{t(`fireAnalysis.tab.${id}`)}</span>
      </button>)}
    </div>

    {tab === 'analysis' && <div className="fire-analysis-overview" data-testid="fire-analysis-overview">
      {assessment.score === null ? <div className="fire-analysis-empty"><Flame size={23} /><strong>{t('fireAnalysis.unavailableTitle')}</strong><p>{t('fireAnalysis.unavailableBody')}</p></div> : <>
        <section className={`fire-analysis-hero ${assessment.level}`}>
          <div className="fire-score">
            <strong>{assessment.score}</strong><span>/100</span>
            <small>{t('fireAnalysis.attentionIndex')}</small>
          </div>
          <div>
            <span>{t('fireAnalysis.levelLabel')}</span>
            <h2>{t(`fireAnalysis.level.${assessment.level}`)}</h2>
            <p>{t('fireAnalysis.heroBody', { coverage: assessment.coveragePercent })}</p>
            <small><Info size={13} />{t('fireAnalysis.notCertification')}</small>
          </div>
        </section>
        <div className="fire-driver-heading"><span><strong>{t('fireAnalysis.driversTitle')}</strong><small>{t('fireAnalysis.driversBody')}</small></span><b>{t(`evidence.confidence.${assessment.confidence}`)}</b></div>
        <div className="fire-component-list">{assessment.components.map((component) => {
          const Icon = componentIcon(component.id);
          const primaryMetrics = component.metrics.filter((metric) => metric.value !== null).slice(0, 2);
          return <article key={component.id} className={component.level ?? 'unknown'}>
            <span className="fire-component-icon"><Icon size={17} /></span>
            <span><strong>{t(`fireAnalysis.component.${component.id}`)}</strong><small>{primaryMetrics.map((metric) => `${t(`fireAnalysis.metric.${metric.id}`)} ${formatNumber(metric.value!, 1)} ${metric.unit}`).join(' · ') || t('fireAnalysis.noData')}</small></span>
            <div><i style={{ width: `${component.score ?? 0}%` }} /></div>
            <b>{component.score ?? '—'}</b>
          </article>;
        })}</div>
        {variant && <section className={`fire-design-response ${variant.firebreak.enabled && variant.firebreak.planningWidthSatisfied ? 'satisfied' : 'attention'}`}>
          <header><span><ShieldCheck size={18} /><i><small>{t('fireAnalysis.designResponse')}</small><strong>{variant.firebreak.enabled ? t('fireAnalysis.firebreakPlanned') : t('fireAnalysis.firebreakMissing')}</strong></i></span><b>{variant.firebreak.enabled && variant.firebreak.planningWidthSatisfied ? t('fireAnalysis.basisMet') : t('fireAnalysis.reviewRequired')}</b></header>
          <div>
            <span><small>{t('fireAnalysis.plannedWidth')}</small><strong>{variant.firebreak.enabled ? `${formatNumber(variant.firebreak.plannedWidthM, 1)} m` : '—'}</strong></span>
            <span><small>{t('fireAnalysis.minimumWidth')}</small><strong>{variant.firebreak.enabled ? `${formatNumber(variant.firebreak.minimumPlanningWidthM, 1)} m` : '—'}</strong></span>
            <span><small>{t('fireAnalysis.windwardSections')}</small><strong>{variant.firebreak.lines.filter((line) => line.priority === 'windward').length}</strong></span>
            <span><small>{t('fireAnalysis.vehicleAccess')}</small><strong>{t(variant.firebreak.supportVehicleAccess ? 'common.yes' : 'common.no')}</strong></span>
          </div>
          <p>{t('fireAnalysis.localReview')}</p>
        </section>}
      </>}
      <EffisSourceCard plan={plan} onPlan={onPlan} onShowLayer={onShowLayer} />
    </div>}

    {tab === 'data' && <div className="fire-data-view" data-testid="fire-analysis-data">
      <div className="fire-data-note"><Database size={17} /><span><strong>{t('fireAnalysis.dataTitle')}</strong><small>{t('fireAnalysis.dataBody')}</small></span></div>
      {assessment.components.map((component) => {
        const Icon = componentIcon(component.id);
        return <section key={component.id} className="fire-data-section">
          <header><span><Icon size={16} /><strong>{t(`fireAnalysis.component.${component.id}`)}</strong></span><b>{component.score === null ? t('fireAnalysis.noData') : `${component.score}/100 · ${t('fireAnalysis.weight', { value: component.weight * 100 })}`}</b></header>
          <div>{component.metrics.map((metric) => <span key={metric.id}><small>{t(`fireAnalysis.metric.${metric.id}`)}</small><strong>{metric.value === null ? '—' : `${formatNumber(metric.value, 1)} ${metric.unit}`}</strong></span>)}</div>
          <footer>{component.evidence.length ? component.evidence.map((item) => item.source).join(' · ') : t('fireAnalysis.noSource')}</footer>
        </section>;
      })}
      <EffisSourceCard plan={plan} onPlan={onPlan} onShowLayer={onShowLayer} />
    </div>}

    {tab === 'sources' && <div className="fire-sources-view" data-testid="fire-analysis-sources">
      <div className="fire-data-note"><Satellite size={17} /><span><strong>{t('fireAnalysis.sourcesTitle')}</strong><small>{t('fireAnalysis.sourcesBody')}</small></span></div>
      <article className="fire-evidence-card"><span><Flame size={16} /><i><strong>Copernicus EFFIS</strong><small>{plan.sourceSnapshot.layer} · {plan.sourceSnapshot.forecastDate}</small></i></span><b>{t('fireOperations.resolution', { value: plan.sourceSnapshot.resolutionKm })}</b><p>{t('fireOperations.sourceBody')}</p><a href={plan.sourceSnapshot.sourceUrl} target="_blank" rel="noreferrer">{t('fireOperations.openSource')} <ChevronRight size={13} /></a></article>
      {evidence.map((item) => <article className="fire-evidence-card" key={`${item.source}-${item.version}`}>
        <span><Database size={16} /><i><strong>{item.source}</strong><small>{item.version}</small></i></span>
        <b>{t(`evidence.confidence.${item.confidence}`)}</b>
        <p>{item.resolution ?? t('fireAnalysis.resolutionUnavailable')} · {shortDate(item.observedAt, locale)}</p>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">{t('fireAnalysis.openSource')} <ChevronRight size={13} /></a>
      </article>)}
      <div className="fire-limitations"><strong>{t('fireAnalysis.limitationsTitle')}</strong>{assessment.limitations.map((item) => <p key={item}>• {t(fireLimitationKey(item))}</p>)}</div>
    </div>}

    {tab === 'operations' && <div className="fire-operations-view" data-testid="fire-operations-checklist">
      <div className="operations-progress"><span><strong>{t('fireOperations.readiness')}</strong><small>{t('fireOperations.completed', { complete, total: plan.tasks.length })}</small></span><div><i style={{ width: `${complete / plan.tasks.length * 100}%` }} /></div></div>
      <label className="operations-date"><span>{t('fireOperations.nextInspection')}</span><input type="date" value={plan.nextInspectionAt?.slice(0, 10) ?? ''} onChange={(event) => onPlan({ ...plan, nextInspectionAt: event.target.value ? new Date(`${event.target.value}T09:00:00`).toISOString() : null })} /></label>
      <div className="fire-task-list">{plan.tasks.map((task) => <article key={task.id} className={task.status}>
        <span><i>{task.status === 'complete' ? <Check size={14} /> : <Flame size={14} />}</i><strong>{t(`fireOperations.task.${task.id}`)}</strong></span>
        <select aria-label={t(`fireOperations.task.${task.id}`)} value={task.status} onChange={(event) => onTask(task.id, { status: event.target.value as FireMaintenanceTask['status'] })}>
          {(['due', 'scheduled', 'complete', 'not-applicable'] as const).map((status) => <option key={status} value={status}>{t(`fireOperations.status.${status}`)}</option>)}
        </select>
        <label><span>{t('fireOperations.due')}</span><input type="date" value={task.dueAt?.slice(0, 10) ?? ''} onChange={(event) => onTask(task.id, { dueAt: event.target.value ? new Date(`${event.target.value}T09:00:00`).toISOString() : null })} /></label>
        <input aria-label={t('fireOperations.taskNotes')} placeholder={t('fireOperations.taskNotes')} value={task.notes} onChange={(event) => onTask(task.id, { notes: event.target.value })} />
      </article>)}</div>
      <label className="operations-notes"><span>{t('fireOperations.notes')}</span><textarea maxLength={2000} value={plan.notes} onChange={(event) => onPlan({ ...plan, notes: event.target.value })} /></label>
      <footer className="fire-operations-footer"><small>{plan.reviewedAt ? t('fireOperations.reviewed', { date: shortDate(plan.reviewedAt, locale) }) : t('fireOperations.notReviewed')}</small></footer>
    </div>}
  </div>;
}

function EffisSourceCard({ plan, onPlan, onShowLayer }: {
  plan: FireOperationsPlan;
  onPlan: (plan: FireOperationsPlan) => void;
  onShowLayer: () => void;
}) {
  const { t } = useI18n();
  return <div className="fire-source-card">
    <span><Flame size={18} /><i><small>{t('fireOperations.source')}</small><strong>EFFIS · FWI</strong></i></span>
    <b>{t('fireOperations.resolution', { value: plan.sourceSnapshot.resolutionKm })}</b>
    <p>{t('fireOperations.sourceBody')}</p>
    <div><label><span>{t('fireOperations.forecastDate')}</span><input type="date" value={plan.sourceSnapshot.forecastDate} onChange={(event) => onPlan({ ...plan, sourceSnapshot: { ...plan.sourceSnapshot, forecastDate: event.target.value, observedAt: new Date().toISOString() } })} /></label><button onClick={onShowLayer}><Layers3 size={14} />{t('fireOperations.showLayer')}</button></div>
    <a href={plan.sourceSnapshot.sourceUrl} target="_blank" rel="noreferrer">{t('fireOperations.openSource')} <ChevronRight size={13} /></a>
  </div>;
}

function ProjectAnalysisPanel({ configured, context, report, busy, error, onRun, onOpenSection }: {
  configured: boolean;
  context: AssistantProjectContext;
  report: ProjectAnalysisReport | null;
  busy: boolean;
  error: string | null;
  onRun: () => void;
  onOpenSection: (section: WorkspaceSection) => void;
}) {
  const { t, locale } = useI18n();
  const currentFingerprint = projectAnalysisFingerprint(context);
  const stale = Boolean(report && report.contextFingerprint !== currentFingerprint);
  const readiness = [
    { id: 'evidence', ready: Boolean(context.siteProfile), section: 'profile' as const },
    { id: 'species', ready: context.selectedSpeciesIds.length > 0, section: 'species' as const },
    { id: 'design', ready: Boolean(context.selectedVariantId && context.variants.length), section: 'layout' as const },
    { id: 'water', ready: Boolean(context.irrigation), section: 'water' as const },
    { id: 'fire', ready: Boolean(context.variants.find((variant) => variant.id === context.selectedVariantId)?.firebreak), section: 'fire' as const },
    { id: 'economics', ready: Boolean(context.costs), section: 'costs' as const },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;
  const canRun = configured && readiness.slice(0, 3).every((item) => item.ready);
  return <div className="panel-body project-analysis-page" data-testid="project-analysis-panel">
    <div className="panel-intro compact">
      <span className="eyebrow">{t('projectAnalysis.eyebrow')}</span>
      <h1>{t('projectAnalysis.title')}</h1>
      <p>{t('projectAnalysis.body')}</p>
    </div>
    <section className="analysis-protocol">
      <header><span><ShieldCheck size={18} /><i><small>{t('projectAnalysis.protocolEyebrow')}</small><strong>{t('projectAnalysis.protocolTitle')}</strong></i></span><b>{readyCount}/{readiness.length}</b></header>
      <p>{t('projectAnalysis.protocolBody')}</p>
      <div>{readiness.map((item) => <button key={item.id} className={item.ready ? 'ready' : 'missing'} onClick={() => onOpenSection(item.section)}>
        {item.ready ? <Check size={13} /> : <Info size={13} />}<span>{t(`projectAnalysis.dimension.${item.id}`)}</span>
      </button>)}</div>
      <footer><span><Sparkles size={14} />{t('projectAnalysis.aiBoundary')}</span><button className="button primary" disabled={!canRun || busy} onClick={onRun}>{busy ? <LoaderCircle className="spin" size={15} /> : <ClipboardCheck size={15} />}{busy ? t('projectAnalysis.running') : report ? t('projectAnalysis.runAgain') : t('projectAnalysis.run')}</button></footer>
    </section>
    {!configured && <div className="analysis-inline-warning"><Info size={16} /><span><strong>{t('projectAnalysis.unavailableTitle')}</strong><small>{t('projectAnalysis.unavailableBody')}</small></span></div>}
    {configured && !canRun && <div className="analysis-inline-warning"><Info size={16} /><span><strong>{t('projectAnalysis.incompleteTitle')}</strong><small>{t('projectAnalysis.incompleteBody')}</small></span></div>}
    {error && <div className="assistant-error"><strong>{t('projectAnalysis.failed')}</strong><span>{localizedDomainMessage(error, t)}</span></div>}
    {busy && <div className="analysis-running"><LoaderCircle className="spin" size={22} /><strong>{t('projectAnalysis.runningTitle')}</strong><p>{t('projectAnalysis.runningBody')}</p></div>}
    {report && !busy && <div className="formal-review-report" data-testid="formal-review-report">
      {stale && <div className="analysis-stale"><Info size={15} /><span><strong>{t('projectAnalysis.staleTitle')}</strong><small>{t('projectAnalysis.staleBody')}</small></span></div>}
      <header className={`review-verdict ${report.verdict}`}>
        <div><small>{t('projectAnalysis.verdict')}</small><strong>{t(`projectAnalysis.verdict.${report.verdict}`)}</strong><span>{t('projectAnalysis.generated', { date: shortDate(report.generatedAt, locale) })} · {report.model}</span></div>
        <b>{report.overallScore}<small>/100</small></b>
      </header>
      <p className="review-summary">{report.executiveSummary}</p>
      <div className="review-dimensions">{report.dimensions.map((dimension) => <article key={dimension.id} className={dimension.status}>
        <header><strong>{t(`projectAnalysis.dimension.${dimension.id}`)}</strong><b>{dimension.score}</b></header>
        <div><i style={{ width: `${dimension.score}%` }} /></div>
        <p>{dimension.summary}</p>
      </article>)}</div>
      <section className="review-findings">
        <header><strong>{t('projectAnalysis.findings')}</strong><small>{report.findings.length}</small></header>
        {report.findings.length ? report.findings.map((finding) => <article key={finding.id} className={finding.severity}>
          <header><span>{t(`projectAnalysis.severity.${finding.severity}`)}</span><small>{t(`projectAnalysis.dimension.${finding.area}`)}</small></header>
          <strong>{finding.title}</strong>
          <p>{finding.explanation}</p>
          {finding.evidence.length > 0 && <div>{finding.evidence.map((item) => <code key={item}>{item}</code>)}</div>}
          <footer><Check size={13} /><span>{finding.recommendation}</span></footer>
        </article>) : <p className="review-empty">{t('projectAnalysis.noFindings')}</p>}
      </section>
      {(report.assumptions.length > 0 || report.limitations.length > 0) && <div className="review-boundaries">
        {report.assumptions.length > 0 && <section><strong>{t('projectAnalysis.assumptions')}</strong>{report.assumptions.map((item) => <p key={item}>• {item}</p>)}</section>}
        {report.limitations.length > 0 && <section><strong>{t('projectAnalysis.limitations')}</strong>{report.limitations.map((item) => <p key={item}>• {item}</p>)}</section>}
      </div>}
    </div>}
  </div>;
}

function ProjectsPage({ projects, activeProjectId, onOpen, onClose }: {
  projects: ProjectSummary[];
  activeProjectId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  return <div className="projects-page-backdrop">
    <section className="projects-page" role="dialog" aria-modal="true" aria-labelledby="projects-page-title" data-testid="projects-page">
      <header>
        <span className="projects-page-mark"><FolderOpen size={22} /></span>
        <span><small>{t('projects.eyebrow')}</small><h2 id="projects-page-title">{t('projects.title')}</h2><p>{t('projects.body')}</p></span>
        <button aria-label={t('projects.close')} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="projects-page-count">{t('projects.count', { count: projects.length })}</div>
      {projects.length > 0 ? <div className="projects-grid">
        {projects.map((project) => {
          const active = project.id === activeProjectId;
          return <button
            key={project.id}
            className={`project-card${active ? ' active' : ''}`}
            aria-label={t('projects.openProject', { name: project.name })}
            aria-current={active ? 'page' : undefined}
            onClick={() => onOpen(project.id)}
          >
            <span className="project-card-mark"><FolderOpen size={19} /></span>
            <span><strong>{project.name}</strong><small>{t('projects.updated', { date: shortDate(project.updatedAt, locale) })}</small></span>
            {active ? <b>{t('projects.active')}</b> : <ChevronRight size={17} />}
          </button>;
        })}
      </div> : <div className="projects-empty"><FolderOpen size={28} /><strong>{t('projects.emptyTitle')}</strong><p>{t('projects.emptyBody')}</p></div>}
    </section>
  </div>;
}

function CollaborationPanel({ authenticated, configured, collaboration, sharePath, busy, onEnable, onDisable, onSignIn, onResolve, onClose }: {
  authenticated: boolean;
  configured: boolean;
  collaboration: ProjectCollaboration;
  sharePath: string | null;
  busy: boolean;
  onEnable: (mode: 'view' | 'review', expiresAt: string | null) => Promise<void>;
  onDisable: () => Promise<void>;
  onSignIn: () => void;
  onResolve: (id: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'view' | 'review'>(collaboration.share.mode);
  const [expiryDays, setExpiryDays] = useState('30');
  const shareUrl = sharePath ? `${window.location.origin}${sharePath}` : '';
  const expiresAt = new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60_000).toISOString();
  return <div className="modal-backdrop" role="presentation"><section className="collaboration-panel" role="dialog" aria-modal="true" aria-labelledby="collaboration-title" data-testid="collaboration-panel">
    <header><span><small>{t('sharing.eyebrow')}</small><h2 id="collaboration-title">{t('sharing.title')}</h2></span><button aria-label={t('actions.close')} onClick={onClose}><X size={18} /></button></header>
    <p>{t('sharing.body')}</p>
    {!authenticated ? <div className="sharing-gate"><ShieldCheck size={22} /><strong>{t('sharing.signInTitle')}</strong><p>{t('sharing.signInBody')}</p><button className="button primary" onClick={onSignIn}>{t('auth.signIn')}</button></div> : !configured ? <div className="sharing-gate"><ShieldCheck size={22} /><strong>{t('sharing.unavailableTitle')}</strong><p>{t('sharing.unavailableBody')}</p></div> : <>
      <div className="share-controls">
        <label><span>{t('sharing.permission')}</span><select value={mode} onChange={(event) => setMode(event.target.value as 'view' | 'review')}><option value="view">{t('sharing.viewOnly')}</option><option value="review">{t('sharing.canReview')}</option></select></label>
        <label><span>{t('sharing.expiry')}</span><select value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)}><option value="7">{t('sharing.days', { count: 7 })}</option><option value="30">{t('sharing.days', { count: 30 })}</option><option value="90">{t('sharing.days', { count: 90 })}</option><option value="365">{t('sharing.days', { count: 365 })}</option></select></label>
        <button className="button primary" disabled={busy} onClick={() => void onEnable(mode, expiresAt)}>{busy ? t('status.saving') : collaboration.share.enabled ? t('sharing.updateLink') : t('sharing.createLink')}</button>
      </div>
      {collaboration.share.enabled && shareUrl && <div className="share-link"><span><small>{t('sharing.activeLink')}</small><strong>{collaboration.share.mode === 'review' ? t('sharing.canReview') : t('sharing.viewOnly')}</strong></span><div><input readOnly value={shareUrl} aria-label={t('sharing.activeLink')} /><button aria-label={t('sharing.copy')} onClick={() => void navigator.clipboard.writeText(shareUrl)}><Copy size={15} /></button></div><button className="text-button danger" disabled={busy} onClick={() => void onDisable()}>{t('sharing.disable')}</button></div>}
      <div className="review-summary">
        <span><ClipboardCheck size={18} /><i><small>{t('sharing.reviewStatus')}</small><strong>{collaboration.review ? t(`sharing.status.${collaboration.review.status}`) : t('sharing.status.pending')}</strong></i></span>
        {collaboration.review && <p><strong>{collaboration.review.reviewerName}</strong> · {shortDate(collaboration.review.updatedAt, locale)}<br />{collaboration.review.note}</p>}
      </div>
      <div className="owner-comments"><header><strong>{t('sharing.comments')}</strong><small>{collaboration.comments.filter((comment) => !comment.resolvedAt).length} {t('sharing.openComments')}</small></header>{collaboration.comments.length ? collaboration.comments.map((comment) => <article key={comment.id} className={comment.resolvedAt ? 'resolved' : ''}><span><strong>{comment.authorName}</strong><small>r{comment.revision} · {shortDate(comment.createdAt, locale)}</small></span><p>{comment.message}</p><button onClick={() => onResolve(comment.id)}>{t(comment.resolvedAt ? 'sharing.reopen' : 'sharing.resolve')}</button></article>) : <p className="inline-empty">{t('sharing.noComments')}</p>}</div>
    </>}
  </section></div>;
}

function ProjectHistoryPanel({ projectId, revisions, onRestore, onClose }: { projectId: string; revisions: ProjectRevisionSummary[]; onRestore: (revision: number) => Promise<void>; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [comparison, setComparison] = useState<{ revision: number; rows: Array<{ label: string; previous: string; current: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  async function compare(revision: number) {
    setBusy(true);
    try {
      const [previous, current] = await Promise.all([
        api<ProjectState>(`/api/projects/${projectId}/revisions/${revision}`),
        api<ProjectState>(`/api/projects/${projectId}`),
      ]);
      const previousVariant = previous.variants.find((item) => item.id === previous.selectedVariantId) ?? previous.variants[0];
      const currentVariant = current.variants.find((item) => item.id === current.selectedVariantId) ?? current.variants[0];
      setComparison({
        revision,
        rows: [
          { label: t('historyCompare.plants'), previous: String(previousVariant?.trees.length ?? 0), current: String(currentVariant?.trees.length ?? 0) },
          { label: t('historyCompare.species'), previous: String(new Set(previousVariant?.trees.map((tree) => tree.speciesId) ?? []).size), current: String(new Set(currentVariant?.trees.map((tree) => tree.speciesId) ?? []).size) },
          { label: t('historyCompare.fireTasks'), previous: String(previous.fireOperations.tasks.filter((task) => task.status === 'complete').length), current: String(current.fireOperations.tasks.filter((task) => task.status === 'complete').length) },
          { label: t('historyCompare.comments'), previous: String(previous.collaboration.comments.length), current: String(current.collaboration.comments.length) },
          { label: t('historyCompare.water'), previous: previous.irrigation ? `${formatNumber(previous.irrigation.annualWaterM3, 0)} m³` : '—', current: current.irrigation ? `${formatNumber(current.irrigation.annualWaterM3, 0)} m³` : '—' },
        ],
      });
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="presentation"><section className="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title">
    <header><span><small>{t('auth.historyEyebrow')}</small><h2 id="history-title">{t('auth.historyTitle')}</h2></span><button aria-label={t('auth.closeHistory')} onClick={onClose}><X size={18} /></button></header>
    <p>{t('auth.historyBody')}</p>
    <div className="revision-list">{revisions.map((revision, index) => <article key={revision.revisionId}>
      <span className="revision-number">r{revision.revision}</span>
      <span><strong>{revision.name}</strong><small>{shortDate(revision.createdAt, locale)} · {t('auth.revisionTrees', { count: revision.treeCount })}{revision.calculationRunId ? ` · ${t('auth.calculationCaptured')}` : ''}</small><code>{revision.contentHash.slice(0, 12)}</code></span>
      <span className="revision-actions"><button disabled={busy || index === 0} onClick={() => void compare(revision.revision)}>{t('historyCompare.compare')}</button><button disabled={index === 0} onClick={() => void onRestore(revision.revision)}>{index === 0 ? t('auth.currentRevision') : t('auth.restoreRevision')}</button></span>
    </article>)}</div>
    {comparison && <div className="revision-comparison"><header><span><small>{t('historyCompare.eyebrow')}</small><strong>{t('historyCompare.title', { revision: comparison.revision })}</strong></span><button aria-label={t('actions.close')} onClick={() => setComparison(null)}><X size={15} /></button></header><div><span><b>{t('historyCompare.metric')}</b><b>r{comparison.revision}</b><b>{t('historyCompare.current')}</b></span>{comparison.rows.map((row) => <span key={row.label}><strong>{row.label}</strong><i>{row.previous}</i><i>{row.current}</i></span>)}</div></div>}
  </section></div>;
}

function OperationalSchedulePanel({ projectName, site, profile, variant, species, irrigation, costs, revision, calculationRunId, onClose }: { projectName: string; site: SiteBoundary; profile: SiteProfile; variant: LayoutVariant; species: DesignSpecies[]; irrigation: IrrigationEstimate; costs: EstablishmentCost; revision: number; calculationRunId: string | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const schedule = buildOperationalSchedule(profile, variant, species, irrigation, costs);
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const reportLocale = locale === 'it' ? 'it-IT' : 'en-GB';
  const monthLabel = (month: number) => new Intl.DateTimeFormat(reportLocale, { month: 'long' }).format(new Date(Date.UTC(2026, month - 1, 1)));
  return <div className="schedule-backdrop" role="presentation"><article className="schedule-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-title" data-testid="operational-schedule">
    <header className="schedule-header">
      <span className="schedule-mark"><ClipboardCheck size={24} /></span>
      <span><small>{t('schedule.eyebrow')}</small><h1 id="schedule-title">{t('schedule.title')}</h1><p>{projectName} · {site.name}</p></span>
      <div className="schedule-actions"><button onClick={() => window.print()}><Printer size={16} />{t('schedule.print')}</button><button aria-label={t('schedule.close')} onClick={onClose}><X size={18} /></button></div>
    </header>
    <div className="schedule-audit-strip">
      <span><small>{t('schedule.location')}</small><strong>{profile.location.displayName}</strong></span>
      <span><small>{t('schedule.design')}</small><strong>{t(systemTranslationKey(variant.design.system))} · {Math.round(variant.directionDegrees)}°</strong></span>
      <span><small>{t('schedule.analysis')}</small><strong>{shortDate(profile.generatedAt, locale)}</strong></span>
      <span><small>{t('schedule.record')}</small><strong>{revision > 0 ? `r${revision}` : t('schedule.localDraft')}{calculationRunId ? ` · ${calculationRunId.slice(-18)}` : ''}</strong></span>
    </div>
    <div className="schedule-readiness"><ShieldCheck size={18} /><span><strong>{t('schedule.readinessTitle')}</strong><small>{t('schedule.readinessBody')}</small></span></div>
    <section className="schedule-summary">
      <ScheduleMetric label={t('schedule.trees')} value={formatNumber(schedule.summary.treeCount, 0)} detail={t('schedule.speciesCount', { count: schedule.summary.speciesCount })} />
      <ScheduleMetric label={t('schedule.plantingLabour')} value={`${formatNumber(schedule.summary.plantingLaborHours, 1)} h`} detail={t('schedule.personHours')} />
      <ScheduleMetric label={t('schedule.pipe')} value={`${formatNumber(schedule.summary.purchasePipeM, 0)} m`} detail={t('schedule.zonesEmitters', { zones: schedule.summary.zones, emitters: schedule.summary.emitterCount })} />
      <ScheduleMetric label={t('schedule.hydraulicDuty')} value={`${formatNumber(schedule.summary.requiredFlowM3Hour, 2)} m³/h`} detail={`${formatNumber(schedule.summary.requiredDynamicHeadM, 1)} m · ${schedule.summary.pumpRequired ? t('schedule.pump') : t('schedule.gravityPressure')}`} />
      <ScheduleMetric label={t('schedule.annualWater')} value={`${formatNumber(schedule.summary.annualWaterM3, 0)} m³`} detail={t('schedule.designYear', { year: irrigation.designYear })} />
      <ScheduleMetric label={t('schedule.annualOperation')} value={currency(schedule.summary.annualOperatingCost, costs.economics)} detail={t('schedule.designYear', { year: irrigation.designYear })} />
      <ScheduleMetric label={t('schedule.maintenanceLabour')} value={`${formatNumber(schedule.summary.maintenanceLaborHours, 1)} h`} detail={currency(schedule.summary.maintenanceLaborCost, costs.economics)} />
    </section>
    <ScheduleSection number="01" title={t('schedule.executionTitle')} subtitle={t('schedule.executionBody')}>
      <div className="schedule-task-list">{schedule.tasks.map((task, index) => <article key={task}><i>{index + 1}</i><span><small>{t(`schedule.task.${task}.timing`)}</small><strong>{t(`schedule.task.${task}.title`)}</strong><p>{t(`schedule.task.${task}.body`, scheduleTaskValues(schedule, site, profile, irrigation, costs))}</p></span><b>□</b></article>)}</div>
    </ScheduleSection>
    <ScheduleSection number="02" title={t('schedule.plantingTitle')} subtitle={t('schedule.plantingBody')}>
      <div className="schedule-table planting"><div><b>{t('schedule.species')}</b><b>{t('schedule.quantity')}</b><b>{t('schedule.unitCost')}</b><b>{t('schedule.labour')}</b><b>{t('schedule.subtotal')}</b></div>{schedule.planting.map((row) => {
        const item = speciesById.get(row.speciesId);
        return <div key={row.speciesId}><span><strong>{item ? speciesDisplayName(item, t) : row.commonName}</strong><small>{row.scientificName}</small></span><span>{row.count}</span><span>{currency(row.unitPlantCost, costs.economics)}</span><span>{formatNumber(row.laborHours, 1)} h</span><span>{currency(row.subtotalCost, costs.economics)}</span></div>;
      })}</div>
    </ScheduleSection>
    <ScheduleSection number="03" title={t('schedule.irrigationTitle')} subtitle={t('schedule.irrigationBody')}>
      <div className="schedule-table infrastructure"><div><b>{t('schedule.component')}</b><b>{t('schedule.specification')}</b><b>{t('schedule.measured')}</b><b>{t('schedule.purchase')}</b></div>{schedule.infrastructure.map((component) => <div key={component.id}><span><strong>{localizedNetworkComponent(component.label, t)}</strong><small>{component.category}</small></span><span>{localizedNetworkSpecification(component.specification, t)}</span><span>{formatNumber(component.measuredQuantity, component.unit === 'm' ? 1 : 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span><span>{formatNumber(component.purchaseQuantity, 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span></div>)}</div>
      <div className="schedule-months">{schedule.irrigationMonths.map((month) => <span key={month.month}><small>{monthLabel(month.month)}</small><strong>{formatNumber(month.grossM3, 1)} m³</strong><b>{currency(month.cost, costs.economics)}</b></span>)}</div>
      <p className="schedule-note">{t('schedule.satelliteAdjustment', { adjustment: signed(irrigation.satelliteScheduling.adjustmentPercent), confidence: translatedStatus(irrigation.satelliteScheduling.confidence, t) })}</p>
    </ScheduleSection>
    <ScheduleSection number="04" title={t('schedule.managementTitle')} subtitle={t('schedule.managementBody')}>
      <div className="schedule-maintenance-detail">
        <header><span><small>{t('costs.selectedYear', { year: schedule.maintenance.year })}</small><strong>{t('costs.maintenanceWorkload')}</strong></span><b>{formatNumber(schedule.maintenance.totalHours, 1)} h · {currency(schedule.maintenance.totalCost, costs.economics)}</b></header>
        <div>{schedule.maintenance.tasks.length > 0
          ? schedule.maintenance.tasks.map((task) => <span key={task.id}><strong>{t(`costs.maintenanceTask.${task.id}`)}</strong><small>{formatNumber(task.hours, 1)} h</small><b>{currency(task.cost, costs.economics)}</b></span>)
          : <span className="schedule-maintenance-autonomous"><strong>{t('costs.maintenanceAutonomousTitle')}</strong><small>{t('costs.maintenanceAutonomousBody')}</small></span>}</div>
      </div>
      <div className="schedule-management">{schedule.managementPhases.map((phase) => <article key={phase}><small>{t(`schedule.phase.${phase}.years`)}</small><strong>{t(`schedule.phase.${phase}.title`)}</strong><p>{t(`schedule.phase.${phase}.body`)}</p><em>{t(`schedule.management.system.${variant.design.system}`)}</em><span>□ {t('schedule.recordActuals')}</span></article>)}</div>
      {variant.machinery.enabled && <div className="schedule-machinery"><Tractor size={18} /><span><strong>{t('schedule.machineryTitle')}</strong><small>{t('schedule.machineryBody', { corridors: schedule.summary.machineryCorridorCount, area: formatNumber(schedule.summary.machineryReservedAreaM2, 0), headland: formatNumber(schedule.summary.machineryHeadlandDepthM, 1) })}</small></span></div>}
      {variant.firebreak?.enabled && <div className="schedule-machinery firebreak"><Flame size={18} /><span><strong>{t('schedule.firebreakTitle')}</strong><small>{t('schedule.firebreakBody', { length: formatNumber(schedule.summary.firebreakLengthM, 0), width: formatNumber(schedule.summary.firebreakWidthM, 1), area: formatNumber(schedule.summary.firebreakReservedAreaM2, 0) })}</small></span></div>}
    </ScheduleSection>
    <ScheduleSection number="05" title={t('schedule.evidenceTitle')} subtitle={t('schedule.evidenceBody')}>
      <div className="schedule-evidence">{schedule.evidence.map((item, index) => {
        const usage = evidenceUsageKey(item);
        return <article key={`${item.source}-${item.version}-${index}`}><span><strong>{item.source}</strong><small>{item.version} · {shortDate(item.observedAt, locale)}</small></span><span><b>{t('evidence.decision')}</b><small>{t(`${usage}.decision`)}</small></span><i>{translatedStatus(item.confidence, t)}</i></article>;
      })}</div>
    </ScheduleSection>
    {schedule.warnings.length > 0 && <section className="schedule-warnings"><strong>{t('schedule.warnings')}</strong>{schedule.warnings.map((warning) => <p key={warning}>• {localizedDomainMessage(warning, t)}</p>)}</section>}
    <footer className="schedule-footer"><span>growup · {t('schedule.footer')}</span><span>{t('schedule.generatedFrom', { version: variant.generation.engineVersion })}</span></footer>
  </article></div>;
}

function ScheduleSection({ number, title, subtitle, children }: { number: string; title: string; subtitle: string; children: ReactNode }) {
  return <section className="schedule-section" data-section={number}><header><i>{number}</i><span><h2>{title}</h2><p>{subtitle}</p></span></header>{children}</section>;
}

function ScheduleMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <span><small>{label}</small><strong>{value}</strong><i>{detail}</i></span>;
}

function scheduleTaskValues(schedule: OperationalSchedule, site: SiteBoundary, profile: SiteProfile, irrigation: IrrigationEstimate, costs: EstablishmentCost): Record<string, string | number> {
  const values = {
    area: formatNumber(profile.areaM2, 0),
    trees: schedule.summary.treeCount,
    existing: site.existingTrees.length + profile.satellite.existingVegetation.patches.length,
    overrides: profile.overrides?.length ?? 0,
    corridors: schedule.summary.machineryCorridorCount,
    reserved: formatNumber(schedule.summary.machineryReservedAreaM2, 0),
    headland: formatNumber(schedule.summary.machineryHeadlandDepthM, 1),
    pipe: formatNumber(schedule.summary.purchasePipeM, 0),
    zones: schedule.summary.zones,
    flow: formatNumber(schedule.summary.requiredFlowM3Hour, 2),
    head: formatNumber(schedule.summary.requiredDynamicHeadM, 1),
    labor: formatNumber(costs.plantingLaborHours, 1),
    emitters: schedule.summary.emitterCount,
    peak: formatNumber(irrigation.peakDayM3, 2),
    adjustment: signed(irrigation.satelliteScheduling.adjustmentPercent),
  };
  return values;
}

function ProfilePanel({ profile, hasSite, onAnalyze, onOpenSite, onShowNdmi, onOverride, additionalEvidence }: { profile: SiteProfile | null; hasSite: boolean; onAnalyze: () => void; onOpenSite: () => void; onShowNdmi: () => void; onOverride: (input: { field: SiteProfileOverrideField; value: string; reason: string; sourceLabel: string; observedAt: string }) => Promise<void>; additionalEvidence: Evidence[] }) {
  const { t, locale } = useI18n();
  const [activeEvidenceTab, setActiveEvidenceTab] = useState<'overview' | 'wind' | 'soil' | 'satellite' | 'sources'>('overview');
  const [overrideField, setOverrideField] = useState<SiteProfileOverrideField>(SITE_PROFILE_OVERRIDE_DEFINITIONS[0].field);
  const [overrideInput, setOverrideInput] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSource, setOverrideSource] = useState('Field measurement');
  const [overrideObservedAt, setOverrideObservedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const selectedOverrideDefinition = SITE_PROFILE_OVERRIDE_DEFINITIONS.find((item) => item.field === overrideField) ?? SITE_PROFILE_OVERRIDE_DEFINITIONS[0];
  useEffect(() => {
    if (!profile) return;
    const current = overrideValue(profile, overrideField);
    setOverrideInput(current === null ? '' : String(current));
  }, [profile, overrideField]);
  if (!profile) return <EmptyState icon={FlaskConical} title={t('profile.emptyTitle')} body={t(hasSite ? 'profile.emptyBody' : 'profile.emptyNoSiteBody')} action={t(hasSite ? 'profile.analyse' : 'profile.openSite')} onAction={hasSite ? onAnalyze : onOpenSite} />;
  const optical = profile.satellite.optical.latest;
  const radar = profile.satellite.radar;
  const vegetation = profile.satellite.existingVegetation;
  const soilProperties = profile.soil.properties ?? [];
  const chemicalSoilProperties = soilProperties.filter((property) => property.category === 'chemical');
  const physicalSoilProperties = soilProperties.filter((property) => property.category === 'physical' || property.key === 'plant-available-water');
  const soilSatellite = profile.soil.satelliteScreening;
  const evidenceItems = [
    profile.terrain.evidence,
    profile.climate.evidence,
    profile.solar.evidence,
    profile.soil.evidence,
    ...profile.satellite.existingVegetation.evidence,
    ...profile.satellite.evidence,
    ...additionalEvidence,
  ];
  const evidenceTabs = [
    ['overview', t('evidence.tab.overview'), 6],
    ['wind', t('evidence.tab.wind'), profile.solar.windClimatology?.[0]?.sectors.length ?? 1],
    ['soil', t('evidence.tab.soil'), soilProperties.length || 1],
    ['satellite', t('evidence.tab.satellite'), profile.satellite.evidence.length + profile.satellite.existingVegetation.evidence.length],
    ['sources', t('evidence.tab.sources'), evidenceItems.length],
  ] as const;
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('profile.eyebrow')}</span><h1>{profile.location.municipality ?? profile.location.region ?? profile.location.countryCode ?? t('profile.locationUnknown')}</h1><p>{profile.location.displayName}</p></div>
      <div className="evidence-tabs" role="tablist" aria-label={t('evidence.tabsLabel')} data-testid="evidence-tabs">
        {evidenceTabs.map(([id, label, count]) => <button key={id} id={`evidence-tab-${id}`} role="tab" aria-selected={activeEvidenceTab === id} aria-controls={`evidence-panel-${id}`} className={activeEvidenceTab === id ? 'active' : ''} onClick={() => setActiveEvidenceTab(id)}><span>{label}</span><b>{count}</b></button>)}
      </div>
      {activeEvidenceTab === 'overview' && <div className="evidence-tabpanel" id="evidence-panel-overview" role="tabpanel" aria-labelledby="evidence-tab-overview">
        <div className="metric-grid">
        <Metric label={t('profile.elevation')} value={`${formatNumber(profile.terrain.elevationMeanM, 0)} m`} detail={`${profile.terrain.elevationMinM}–${profile.terrain.elevationMaxM} m`} />
        <Metric label={t('profile.slope')} value={`${profile.terrain.slopePercent}%`} detail={t('profile.aspect', { value: localizedEnum(profile.terrain.aspectLabel, t) })} />
        <Metric label={t('profile.rain')} value={`${formatNumber(profile.climate.annualPrecipitationMm, 0)} mm`} detail={t('profile.annualMean')} />
        <Metric label="ET₀" value={`${formatNumber(profile.climate.annualEt0Mm, 0)} mm`} detail={t('profile.aridity', { value: profile.climate.aridityIndex })} />
        <Metric label={t('profile.solar')} value={profile.solar.status === 'available' ? `${formatNumber(profile.solar.annualGlobalHorizontalKwhM2, 0)} kWh/m²` : '—'} detail={t('profile.annualHorizontal')} />
        <Metric label={t('profile.wind')} value={profile.solar.prevailingWindDirectionLabel ? localizedEnum(profile.solar.prevailingWindDirectionLabel, t) : '—'} detail={profile.solar.meanWindSpeedMs === null ? t('status.unavailable') : t('profile.windMean', { value: profile.solar.meanWindSpeedMs })} />
        </div>
        {profile.warnings.length > 0 && <div className="warning-list">{profile.warnings.map((warning) => <p key={warning}>• {localizedDomainMessage(warning, t)}</p>)}</div>}
      </div>}
      {activeEvidenceTab === 'wind' && <div className="evidence-tabpanel" id="evidence-panel-wind" role="tabpanel" aria-labelledby="evidence-tab-wind">
        <WindClimatologyCard solar={profile.solar} />
      </div>}
      {activeEvidenceTab === 'soil' && <div className="evidence-tabpanel" id="evidence-panel-soil" role="tabpanel" aria-labelledby="evidence-tab-soil">
      <div className="evidence-card soil-card" data-testid="soil-composition">
        <div className="card-heading"><div><FlaskConical size={17} /><span><small>{t('soil.eyebrow')}</small><strong>{profile.soil.reactionClass && profile.soil.reactionClass !== 'unknown' ? t(`soil.reaction.${profile.soil.reactionClass}`) : profile.soil.textureClass ? localizedEnum(profile.soil.textureClass, t) : t('profile.fieldTestRequired')}</strong></span></div><StatusPill status={profile.soil.status} /></div>
        <p className="soil-intro">{t('soil.intro')}</p>
        <div className="soil-values">
          <span><small>pH</small><strong>{profile.soil.ph ?? '—'}</strong></span>
          <span><small>{t('profile.soc')}</small><strong>{profile.soil.organicCarbonGKg ?? '—'} <i>g/kg</i></strong></span>
          <span><small>{t('soil.property.total-nitrogen')}</small><strong>{soilPropertyValue(soilProperties, 'total-nitrogen')}</strong></span>
          <span><small>{t('soil.property.cation-exchange-capacity')}</small><strong>{soilPropertyValue(soilProperties, 'cation-exchange-capacity')}</strong></span>
        </div>
        {soilProperties.length > 0 && <div className="soil-composition-groups">
          <SoilPropertyGroup title={t('soil.chemicalTitle')} body={t('soil.chemicalBody')} properties={chemicalSoilProperties} />
          <SoilPropertyGroup title={t('soil.physicalTitle')} body={t('soil.physicalBody')} properties={physicalSoilProperties} />
        </div>}
        {soilSatellite && <div className={`soil-satellite-screening ${soilSatellite.status}`}>
          <Satellite size={18} />
          <span><small>{t('soil.satelliteEyebrow')}</small><strong>{t(`soil.satellite.${soilSatellite.status}`)}</strong><p>{t('soil.satelliteBody', { usable: soilSatellite.bareSoilObservationCount, total: soilSatellite.totalObservationCount })}</p></span>
        </div>}
        <div className="soil-provenance">
          <Database size={15} />
          <span><strong>{t('soil.sourceTitle')}</strong><small>{profile.soil.evidence.version} · {profile.soil.evidence.resolution ?? '250 m'} · {t('soil.modelled')}</small></span>
          <a href={profile.soil.evidence.sourceUrl} target="_blank" rel="noreferrer">{t('soil.openSource')}</a>
        </div>
        {(profile.soil.limitations?.length ?? 0) > 0 && <details className="soil-limitations"><summary>{t('soil.limitations')}</summary>{profile.soil.limitations!.map((limitation) => <p key={limitation}>• {localizedSoilLimitation(limitation, t)}</p>)}</details>}
      </div>
      <div className="profile-overrides" data-testid="profile-overrides">
        <div className="card-heading"><div><PencilRuler size={17} /><span><small>{t('profile.overrideEyebrow')}</small><strong>{t('profile.overrideTitle')}</strong></span></div><StatusPill status={(profile.overrides?.length ?? 0) > 0 ? 'available' : 'partial'} /></div>
        <p>{t('profile.overrideBody')}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          void onOverride({ field: overrideField, value: overrideInput, reason: overrideReason, sourceLabel: overrideSource, observedAt: overrideObservedAt }).then(() => setOverrideReason(''));
        }}>
          <label className="select-label"><span>{t('profile.overrideField')}</span><select aria-label={t('profile.overrideField')} value={overrideField} onChange={(event) => setOverrideField(event.target.value as SiteProfileOverrideField)}>{SITE_PROFILE_OVERRIDE_DEFINITIONS.map((item) => <option key={item.field} value={item.field}>{t(item.labelKey)}</option>)}</select></label>
          <label className="select-label"><span>{t('profile.overrideValue')}</span>{selectedOverrideDefinition.valueType === 'choice' ? <select aria-label={t('profile.overrideValue')} value={overrideInput} onChange={(event) => setOverrideInput(event.target.value)}>{selectedOverrideDefinition.options?.map((option) => <option key={option} value={option}>{localizedEnum(option, t)}</option>)}</select> : selectedOverrideDefinition.valueType === 'boolean' ? <select aria-label={t('profile.overrideValue')} value={overrideInput} onChange={(event) => setOverrideInput(event.target.value)}><option value="true">{t('actions.yes')}</option><option value="false">{t('actions.no')}</option></select> : <span className="input-with-unit"><input aria-label={t('profile.overrideValue')} type={selectedOverrideDefinition.valueType === 'number' ? 'number' : 'text'} min={selectedOverrideDefinition.minimum} max={selectedOverrideDefinition.maximum} step="any" required value={overrideInput} onChange={(event) => setOverrideInput(event.target.value)} />{selectedOverrideDefinition.unit && <small>{selectedOverrideDefinition.unit}</small>}</span>}</label>
          <label><span>{t('profile.overrideSource')}</span><input aria-label={t('profile.overrideSource')} minLength={2} maxLength={160} required value={overrideSource} onChange={(event) => setOverrideSource(event.target.value)} /></label>
          <label><span>{t('profile.overrideObservedAt')}</span><input aria-label={t('profile.overrideObservedAt')} type="date" required value={overrideObservedAt} onChange={(event) => setOverrideObservedAt(event.target.value)} /></label>
          <label><span>{t('profile.overrideReason')}</span><textarea aria-label={t('profile.overrideReason')} minLength={4} maxLength={500} required value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder={t('profile.overrideReasonPlaceholder')} /></label>
          <button className="button primary" type="submit" disabled={!overrideInput || overrideReason.trim().length < 4}>{t('profile.applyOverride')}</button>
        </form>
        {(profile.overrides?.length ?? 0) > 0 && <div className="override-audit"><strong>{t('profile.overrideAudit')}</strong>{[...(profile.overrides ?? [])].reverse().slice(0, 8).map((item) => <article key={item.id}><span><b>{t(SITE_PROFILE_OVERRIDE_DEFINITIONS.find((definition) => definition.field === item.field)?.labelKey ?? item.field)}</b><small>{item.sourceLabel} · {shortDate(item.observedAt, locale)}</small></span><span><s>{String(item.previousValue ?? '—')}</s><strong>{String(item.value)}{item.unit ? ` ${item.unit}` : ''}</strong></span><p>{item.reason}</p></article>)}</div>}
      </div>
      </div>}
      {activeEvidenceTab === 'satellite' && <div className="evidence-tabpanel" id="evidence-panel-satellite" role="tabpanel" aria-labelledby="evidence-tab-satellite">
      <div className="vegetation-audit" data-testid="existing-vegetation-audit">
        <div className="card-heading"><div><TreePine size={17} /><span><small>{t('profile.vegetationAudit')}</small><strong>{t('profile.protectedAreas', { count: vegetation.patches.length })}</strong></span></div><StatusPill status={vegetation.suitability} /></div>
        <div className="vegetation-metrics"><span><small>{t('profile.detectedCover')}</small><strong>{vegetation.detectedCoverPercent}%</strong></span><span><small>{t('profile.protectedArea')}</small><strong>{vegetation.protectedCoverPercent}%</strong></span><span><small>{t('profile.ndviDates')}</small><strong>{vegetation.analyzedOpticalScenes}</strong></span><span><small>{t('profile.treeMaps')}</small><strong>{vegetation.annualLandCoverYears.length + 1 + Number(vegetation.woodyVegetationLayerAvailable)}</strong></span></div>
        <p>{localizedDomainMessage(vegetation.conclusion, t)}</p>
        {vegetation.patches.length > 0 && <div className="vegetation-patches">{vegetation.patches.slice(0, 4).map((patch, index) => <span key={patch.id}><i>{index + 1}</i><strong>NDVI {patch.currentNdvi.toFixed(2)}</strong><small>{t('profile.patchDetail', { confidence: t(`status.${patch.confidence}`), area: patch.protectedAreaM2.toFixed(0) })}</small></span>)}</div>}
      </div>
      <div className="satellite-card">
        <div className="satellite-image">{profile.satellite.optical.ndmiPreviewUrl ? <img src={profile.satellite.optical.ndmiPreviewUrl} alt={t('profile.ndmiAlt')} /> : <Satellite size={30} />}</div>
        <div className="satellite-copy">
          <div className="card-heading"><div><Satellite size={17} /><span><small>{t('profile.sentinelWater')}</small><strong>{translatedStatus(profile.satellite.status, t)}</strong></span></div><StatusPill status={profile.satellite.status} /></div>
          {optical ? <><p>{t('profile.clearPixels', { date: shortDate(optical.acquiredAt, locale), cloud: optical.fieldCloudPercent })}</p><div className="index-row"><Index label="NDVI" value={optical.ndvi.mean} /><Index label="NDMI" value={optical.ndmi.mean} /><Index label="NDWI" value={optical.ndwi.mean} /></div></> : <p>{t('profile.noClearSentinel')}</p>}
          <div className="radar-line"><Waves size={15} /><span>Sentinel-1: <strong>{localizedEnum(radar.surfaceMoistureSignal, t)}</strong>{radar.latestVvAnomalyDb !== null ? ` · ${signed(radar.latestVvAnomalyDb)} dB` : ''}</span></div>
          <button className="text-button" onClick={onShowNdmi}>{t('profile.showWaterLayers')} <ChevronRight size={14} /></button>
        </div>
      </div>
      </div>}
      {activeEvidenceTab === 'sources' && <div className="evidence-tabpanel" id="evidence-panel-sources" role="tabpanel" aria-labelledby="evidence-tab-sources">
      <div className="source-traceability" data-testid="evidence-traceability">
        <div className="card-heading"><div><Database size={17} /><span><small>{t('evidence.traceability')}</small><strong>{t('evidence.howUsed')}</strong></span></div></div>
        {evidenceItems.map((item, index) => {
          const usageKey = evidenceUsageKey(item);
          return <article className="evidence-use-card" key={`${item.source}-${item.version}-${index}`}>
            <header><strong>{item.source}</strong><span className={`evidence-confidence ${item.confidence}`}>{t(`status.${item.confidence}`)}</span></header>
            <dl>
              <div><dt>{t('evidence.dataUsed')}</dt><dd>{t(`${usageKey}.data`)}</dd></div>
              <div><dt>{t('evidence.calculation')}</dt><dd>{t(`${usageKey}.calculation`)}</dd></div>
              <div><dt>{t('evidence.decision')}</dt><dd>{t(`${usageKey}.decision`)}</dd></div>
            </dl>
            <footer><span>{item.version}</span><span>{item.resolution ?? t('evidence.resolutionUnavailable')}</span><time dateTime={item.observedAt}>{shortDate(item.observedAt, locale)}</time><a href={item.sourceUrl} target="_blank" rel="noreferrer">{t('evidence.openSource')}</a></footer>
          </article>;
        })}
      </div>
      </div>}
    </div>
  );
}

function WindClimatologyCard({ solar }: { solar: SiteProfile['solar'] }) {
  const { t, locale } = useI18n();
  const [activePeriod, setActivePeriod] = useState<WindClimatologyPeriod['period']>('annual');
  const periods = solar.windClimatology ?? [];
  const selected = periods.find((item) => item.period === activePeriod) ?? periods[0] ?? null;
  if (solar.status !== 'available' || !selected) {
    return <div className="wind-card unavailable" data-testid="wind-climatology"><WindIcon size={24} /><span><strong>{t('wind.unavailableTitle')}</strong><p>{t('wind.unavailableBody')}</p></span></div>;
  }
  const maxFrequency = Math.max(1, ...selected.sectors.map((sector) => sector.frequencyPercent));
  const maxSpeed = Math.max(1, ...selected.sectors.map((sector) => sector.meanSpeedMs));
  return <div className="wind-card" data-testid="wind-climatology">
    <header className="wind-card-header">
      <span className="wind-card-mark"><WindIcon size={20} /></span>
      <span><small>{t('wind.eyebrow')}</small><strong>{t('wind.title')}</strong><p>{t('wind.intro')}</p></span>
      <StatusPill status={solar.evidence.confidence} />
    </header>
    <div className="wind-periods" role="group" aria-label={t('wind.periodLabel')}>
      {periods.map((period) => <button key={period.period} aria-pressed={selected.period === period.period} className={selected.period === period.period ? 'active' : ''} onClick={() => setActivePeriod(period.period)}>{t(`wind.period.${period.period}`)}</button>)}
    </div>
    <div className="wind-summary">
      <span><small>{t('wind.prevailing')}</small><strong>{selected.prevailingDirectionLabel ?? '—'} <i>{selected.prevailingDirectionDegrees === null ? '' : `${formatNumber(selected.prevailingDirectionDegrees, 0)}°`}</i></strong></span>
      <span><small>{t('wind.meanSpeed')}</small><strong>{selected.meanSpeedMs === null ? '—' : formatNumber(selected.meanSpeedMs, 1)} <i>m/s</i></strong></span>
      <span><small>{t('wind.p90Speed')}</small><strong>{selected.speedP90Ms === null ? '—' : formatNumber(selected.speedP90Ms, 1)} <i>m/s</i></strong></span>
      <span><small>{t('wind.calm')}</small><strong>{selected.calmFrequencyPercent === null ? '—' : formatNumber(selected.calmFrequencyPercent, 1)}<i>%</i></strong></span>
    </div>
    <div className="wind-rose-layout">
      <figure className="wind-rose" data-testid="wind-rose">
        <svg viewBox="0 0 240 240" role="img" aria-label={t('wind.roseLabel', { period: t(`wind.period.${selected.period}`) })}>
          {[30, 58, 86].map((radius) => <circle key={radius} cx="120" cy="120" r={radius} className="wind-ring" />)}
          {[0, 45, 90, 135].map((degrees) => <line key={degrees} x1="120" y1="23" x2="120" y2="217" className="wind-axis" transform={`rotate(${degrees} 120 120)`} />)}
          {selected.sectors.map((sector) => {
            const length = 18 + 70 * sector.frequencyPercent / maxFrequency;
            return <line
              key={sector.directionLabel}
              x1="120"
              y1="102"
              x2="120"
              y2={120 - length}
              className="wind-petal"
              strokeOpacity={0.42 + 0.58 * sector.meanSpeedMs / maxSpeed}
              transform={`rotate(${sector.centerDegrees} 120 120)`}
            ><title>{t('wind.sectorDetail', { direction: sector.directionLabel, frequency: formatNumber(sector.frequencyPercent, 1), speed: formatNumber(sector.meanSpeedMs, 1) })}</title></line>;
          })}
          <circle cx="120" cy="120" r="19" className="wind-centre" />
          <text x="120" y="116" className="wind-centre-label">{selected.prevailingDirectionLabel ?? '—'}</text>
          <text x="120" y="128" className="wind-centre-speed">{selected.meanSpeedMs === null ? '—' : `${formatNumber(selected.meanSpeedMs, 1)} m/s`}</text>
          <text x="120" y="14" className="wind-direction-label">N</text>
          <text x="226" y="123" className="wind-direction-label">E</text>
          <text x="120" y="235" className="wind-direction-label">S</text>
          <text x="14" y="123" className="wind-direction-label">W</text>
        </svg>
        <figcaption>{t('wind.roseCaption', { period: solar.period, samples: formatNumber(selected.sampleCount, 0) })}</figcaption>
      </figure>
      <div className="wind-sector-list">
        {selected.sectors.map((sector) => <article key={sector.directionLabel}>
          <strong>{sector.directionLabel}</strong>
          <span><i style={{ width: `${Math.max(4, sector.frequencyPercent / maxFrequency * 100)}%` }} /></span>
          <b>{formatNumber(sector.frequencyPercent, 1)}%</b>
          <small>{formatNumber(sector.meanSpeedMs, 1)} m/s</small>
        </article>)}
      </div>
    </div>
    <div className="wind-planning-impact"><Flame size={17} /><span><strong>{t('wind.planTitle')}</strong><p>{t('wind.planBody', { direction: selected.prevailingDirectionLabel ?? '—' })}</p></span></div>
    <div className="wind-source">
      <Database size={15} />
      <span><strong>{solar.evidence.source}</strong><small>{solar.evidence.version} · {solar.evidence.resolution ?? t('evidence.resolutionUnavailable')} · {shortDate(solar.evidence.observedAt, locale)}</small></span>
      <a href={solar.evidence.sourceUrl} target="_blank" rel="noreferrer">{t('evidence.openSource')}</a>
    </div>
    {solar.limitations.length > 0 && <details className="wind-limitations"><summary>{t('wind.limitations')}</summary>{solar.limitations.map((limitation) => <p key={limitation}>• {localizedWindLimitation(limitation, t)}</p>)}</details>}
  </div>;
}

function SpeciesPanel({ recommendations, siteProfile, selectedIds, onToggle, onGenerate, query, onQuery, onSearch, catalogueResults, stats, design, onDesign }: { recommendations: SpeciesRecommendation[]; siteProfile: SiteProfile | null; selectedIds: string[]; onToggle: (id: string) => void; onGenerate: () => void; query: string; onQuery: (value: string) => void; onSearch: (filters: CatalogueFilters) => void; catalogueResults: CatalogueSpecies[]; stats: CatalogueStats | null; design: DesignConfiguration; onDesign: (value: DesignConfiguration) => void }) {
  const { t } = useI18n();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [planningTab, setPlanningTab] = useState<'species' | 'firebreak' | 'machinery'>('species');
  const [filters, setFilters] = useState<CatalogueFilters>({
    treeOnly: true,
    globUntOnly: false,
    designReadyOnly: false,
    stratum: '',
    succession: '',
    role: '',
    evergreen: '',
    nitrogenFixer: '',
    droughtMinimum: 0,
    evidenceMinimum: 0,
  });
  const visible = recommendations.filter((item) => item.status !== 'blocked').slice(0, 18);
  const blocked = recommendations.filter((item) => item.status === 'blocked');
  const monitored = recommendations.filter((item) => item.species.invasiveStatus === 'monitor');
  const inspected = recommendations.find((item) => item.species.id === inspectedId) ?? visible[0] ?? recommendations[0] ?? null;
  const minimumSpecies = design.system === 'syntropic' ? 3 : design.system === 'monoculture' ? 1 : 2;
  const selectedOptions = recommendations.map((item) => item.species).filter((item) => selectedIds.includes(item.id) && item.treeLike && item.productiveFromYear !== null);
  const update = (patch: Partial<DesignConfiguration>) => onDesign({ ...design, ...patch });
  const updateMachinery = (patch: Partial<DesignConfiguration['machinery']>) => update({ machinery: { ...design.machinery, ...patch } });
  const updateFirebreak = (patch: Partial<DesignConfiguration['firebreak']>) => update({ firebreak: { ...design.firebreak, ...patch } });
  const machineEnvelope = machineryEnvelope(design.machinery);
  const plannedFirebreak = firebreakEnvelope(design.firebreak);
  const objectives = [
    { key: 'production', label: t('species.objective.production') },
    { key: 'biodiversity', label: t('species.objective.biodiversity') },
    { key: 'nativeHabitat', label: t('species.objective.nativeHabitat') },
    { key: 'waterResilience', label: t('species.objective.waterResilience') },
    { key: 'lowMaintenance', label: t('species.objective.lowMaintenance') },
  ] as const;
  const planningTabs = [
    { id: 'species', label: t('planning.tab.species'), icon: Sprout },
    { id: 'firebreak', label: t('planning.tab.firebreak'), icon: Flame },
    { id: 'machinery', label: t('planning.tab.machinery'), icon: Route },
  ] as const;
  return (
    <div className="panel-body persistent-action-panel">
      <div className="panel-scroll-content">
      <div className="panel-intro compact"><span className="eyebrow">{t('planning.eyebrow')}</span><h1>{t('planning.title')}</h1><p>{t('planning.summary', { count: selectedIds.length })}</p></div>
      <div className="planning-tabs" role="tablist" aria-label={t('planning.tabsLabel')} data-testid="planning-tabs">
        {planningTabs.map(({ id, label, icon: Icon }) => <button
          key={id}
          id={`planning-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={planningTab === id}
          aria-controls="planning-tab-panel"
          className={planningTab === id ? 'active' : ''}
          data-testid={`planning-tab-${id}`}
          onClick={() => setPlanningTab(id)}
        ><Icon size={16} /><span>{label}</span></button>)}
      </div>
      <div id="planning-tab-panel" className="planning-tab-panel" role="tabpanel" aria-labelledby={`planning-tab-${planningTab}`}>
      {planningTab === 'species' && <>
      <div className="recommendation-basis" data-testid="recommendation-basis"><Database size={17} /><span><strong>{t('planning.speciesBasisTitle')}</strong><p>{t('planning.speciesBasisBody', { count: DESIGN_SPECIES_BY_ID.size })}</p></span></div>
      {recommendations.length > 0 && <div className="safety-gate" data-testid="species-safety-gate"><ShieldCheck size={18} /><span><small>{t('species.safetyEyebrow')}</small><strong>{t('species.safetyCount', { blocked: blocked.length, monitored: monitored.length })}</strong><p>{t('species.safetyBody')}</p></span>{blocked.length > 0 && <button onClick={() => setInspectedId(blocked[0].species.id)}>{t('actions.inspect')}</button>}</div>}
      <div className="objective-panel" data-testid="design-objectives">
        <div className="card-heading"><div><Sprout size={17} /><span><small>{t('species.priorityModel')}</small><strong>{t('species.designObjectives')}</strong></span></div><small>0–100</small></div>
        <p>{t('species.objectivesBody')}</p>
        {objectives.map((objective) => <label className="objective-control" key={objective.key}><span><b>{objective.label}</b><output>{design.objectives[objective.key]}</output></span><input aria-label={objective.label} type="range" min="0" max="100" step="5" value={design.objectives[objective.key]} onChange={(event) => update({ objectives: { ...design.objectives, [objective.key]: Number(event.target.value) } })} /></label>)}
      </div>
      <div className="design-config" data-testid="design-config">
        <div className="card-heading"><div><Layers3 size={17} /><span><small>{t('design.logic')}</small><strong>{t('design.systemArea')}</strong></span></div></div>
        <label className="select-label"><span>{t('design.system')}</span><select aria-label={t('design.system')} value={design.system} onChange={(event) => {
          const system = event.target.value as DesignConfiguration['system'];
          update({ system, extent: system === 'windbreak' ? 'selected-edges' : system === 'boundary-buffer' ? 'perimeter-band' : design.extent });
        }}>
          <option value="syntropic">{t('system.syntropic')}</option>
          <option value="alley-cropping">{t('system.alley')}</option>
          <option value="mixed-orchard">{t('system.mixedOrchard')}</option>
          <option value="monoculture">{t('system.monoculture')}</option>
          <option value="windbreak">{t('system.windbreak')}</option>
          <option value="boundary-buffer">{t('system.boundary')}</option>
        </select></label>
        <p className="design-explainer">{t(designSystemDescriptionKey(design.system))}</p>
        <div className="extent-switch" role="group" aria-label={t('design.extent')}>
          <button className={design.extent === 'full-field' ? 'active' : ''} disabled={design.system === 'windbreak' || design.system === 'boundary-buffer'} onClick={() => update({ extent: 'full-field' })}>{t('design.fullField')}</button>
          <button className={design.extent === 'perimeter-band' ? 'active' : ''} disabled={design.system === 'windbreak'} onClick={() => update({ extent: 'perimeter-band' })}>{t('design.perimeterOnly')}</button>
          {design.system === 'windbreak' && <button className="active" disabled>{t('design.selectedEdges')}</button>}
        </div>
        {design.extent !== 'full-field' && <label className="range-control"><span><b>{t('design.boundaryBand')}</b><output>{design.perimeterBandM} m</output></span><input aria-label={t('design.boundaryBand')} type="range" min="3" max="20" step="1" value={design.perimeterBandM} onChange={(event) => update({ perimeterBandM: Number(event.target.value) })} /></label>}
        {design.system === 'alley-cropping' && <label className="range-control"><span><b>{t('design.cropAlley')}</b><output>{design.cropAlleyWidthM} m</output></span><input aria-label={t('design.cropAlley')} type="range" min="6" max="30" step="1" value={design.cropAlleyWidthM} onChange={(event) => update({ cropAlleyWidthM: Number(event.target.value) })} /></label>}
        {design.system === 'windbreak' && <label className="range-control"><span><b>{t('design.windbreakRows')}</b><output>{design.windbreakRows}</output></span><input aria-label={t('design.windbreakRows')} type="range" min="1" max="5" step="1" value={design.windbreakRows} onChange={(event) => update({ windbreakRows: Number(event.target.value) })} /></label>}
        {design.system === 'monoculture' && <label className="select-label"><span>{t('design.singleCrop')}</span><select aria-label={t('design.singleCrop')} value={design.monocultureSpeciesId ?? ''} onChange={(event) => update({ monocultureSpeciesId: event.target.value || null })}><option value="">{t('design.bestProductive')}</option>{selectedOptions.map((species) => <option key={species.id} value={species.id}>{speciesDisplayName(species, t)}</option>)}</select></label>}
        <label className="select-label"><span>{t('design.orientation')}</span><select aria-label={t('design.orientation')} value={design.orientationObjective} onChange={(event) => update({ orientationObjective: event.target.value as DesignConfiguration['orientationObjective'] })}>
          <option value="solar-crop">{t('orientation.solar')}</option>
          <option value="contour">{t('orientation.contour')}</option>
          <option value="operations">{t('orientation.operations')}</option>
          <option value="wind-protection">{t('orientation.wind')}</option>
          <option value="custom">{t('orientation.custom')}</option>
        </select></label>
        {design.orientationObjective === 'custom' && <label className="range-control"><span><b>{t('design.bearing')}</b><output>{design.customBearingDegrees}°</output></span><input aria-label={t('design.bearing')} type="range" min="0" max="175" step="5" value={design.customBearingDegrees} onChange={(event) => update({ customBearingDegrees: Number(event.target.value) })} /></label>}
      </div>
      </>}
      {planningTab === 'firebreak' && <div className="firebreak-config" data-testid="firebreak-config">
        <div className="card-heading"><div><Flame size={17} /><span><small>{t('firebreak.eyebrow')}</small><strong>{t('firebreak.title')}</strong></span></div><label className="compact-toggle"><input aria-label={t('firebreak.enabled')} type="checkbox" checked={design.firebreak.enabled} onChange={(event) => updateFirebreak({ enabled: event.target.checked })} /><span>{t('firebreak.enabled')}</span></label></div>
        <p>{t('firebreak.body')}</p>
        <div className="firebreak-inputs">
          <label className="select-label"><span>{t('firebreak.fuelModel')}</span><select aria-label={t('firebreak.fuelModel')} value={design.firebreak.fuelModel} disabled={!design.firebreak.enabled} onChange={(event) => {
            const next = firebreakConfigurationFromFuelModel(event.target.value as DesignConfiguration['firebreak']['fuelModel']);
            update({ firebreak: { ...next, treatment: design.firebreak.treatment, supportVehicleAccess: design.firebreak.supportVehicleAccess, protectPipeCrossings: design.firebreak.protectPipeCrossings } });
          }}>
            {FIREBREAK_FUEL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(`firebreak.fuel.${preset.id}`)}</option>)}
            <option value="custom">{t('firebreak.fuel.custom')}</option>
          </select></label>
          <label className="select-label"><span>{t('firebreak.treatment')}</span><select aria-label={t('firebreak.treatment')} value={design.firebreak.treatment} disabled={!design.firebreak.enabled} onChange={(event) => updateFirebreak({ treatment: event.target.value as DesignConfiguration['firebreak']['treatment'] })}>
            <option value="mown">{t('firebreak.treatment.mown')}</option>
            <option value="low-fuel-vegetation">{t('firebreak.treatment.lowFuel')}</option>
            <option value="bare-ground">{t('firebreak.treatment.bareGround')}</option>
          </select></label>
          <label><span>{t('firebreak.expectedFlame')}</span><span><input aria-label={t('firebreak.expectedFlame')} type="number" min="0.2" max="20" step="0.1" disabled={!design.firebreak.enabled} value={design.firebreak.expectedFlameLengthM} onChange={(event) => updateFirebreak({ fuelModel: 'custom', expectedFlameLengthM: Number(event.target.value) })} /> m</span></label>
          <label><span>{t('firebreak.plannedWidth')}</span><span><input aria-label={t('firebreak.plannedWidth')} type="number" min="1" max="60" step="0.5" disabled={!design.firebreak.enabled} value={design.firebreak.widthM} onChange={(event) => updateFirebreak({ widthM: Number(event.target.value) })} /> m</span></label>
        </div>
        <div className={`firebreak-result ${plannedFirebreak.planningWidthSatisfied ? 'satisfied' : 'insufficient'}`}>
          <span><small>{t('firebreak.minimumBasis')}</small><strong>{formatNumber(plannedFirebreak.minimumPlanningWidthM, 1)} m</strong></span>
          <span><small>{t('firebreak.plannedWidth')}</small><strong>{formatNumber(plannedFirebreak.plannedWidthM, 1)} m</strong></span>
          <span><small>{t('firebreak.widthCheck')}</small><strong>{t(plannedFirebreak.planningWidthSatisfied ? 'firebreak.basisMet' : 'firebreak.basisNotMet')}</strong></span>
        </div>
        <label className="pipe-crossing-toggle"><input type="checkbox" checked={design.firebreak.supportVehicleAccess} disabled={!design.firebreak.enabled} onChange={(event) => updateFirebreak({ supportVehicleAccess: event.target.checked })} /><span><strong>{t('firebreak.vehicleAccess')}</strong><small>{t('firebreak.vehicleAccessBody')}</small></span></label>
        <label className="pipe-crossing-toggle"><input type="checkbox" checked={design.firebreak.protectPipeCrossings} disabled={!design.firebreak.enabled} onChange={(event) => updateFirebreak({ protectPipeCrossings: event.target.checked })} /><span><strong>{t('firebreak.pipeCrossings')}</strong><small>{t('firebreak.pipeCrossingsBody')}</small></span></label>
        <p className="firebreak-source"><a href="https://www.gov.uk/government/publications/heather-and-grass-management-code/heather-and-grass-management-code-2025" target="_blank" rel="noreferrer">{t('firebreak.widthSource')}</a> · {t('firebreak.localReview')}</p>
      </div>}
      {planningTab === 'machinery' && <div className="machinery-config" data-testid="machinery-config">
        <div className="card-heading"><div><Route size={17} /><span><small>{t('machinery.eyebrow')}</small><strong>{t('machinery.title')}</strong></span></div><label className="compact-toggle"><input aria-label={t('machinery.enabled')} type="checkbox" checked={design.machinery.enabled} onChange={(event) => updateMachinery({ enabled: event.target.checked })} /><span>{t('machinery.enabled')}</span></label></div>
        <p>{t('machinery.body')}</p>
        <label className="select-label"><span>{t('machinery.preset')}</span><select aria-label={t('machinery.preset')} value={design.machinery.presetId} disabled={!design.machinery.enabled} onChange={(event) => update({ machinery: machineryConfigurationFromPreset(event.target.value as DesignConfiguration['machinery']['presetId']) })}>{MACHINERY_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(`machinery.category.${preset.category}`)} · {preset.referenceModel}</option>)}</select></label>
        <div className="machinery-dimensions">
          {([
            ['widthM', 'machinery.width'],
            ['lengthM', 'machinery.length'],
            ['turningRadiusM', 'machinery.turningRadius'],
            ['implementWidthM', 'machinery.implementWidth'],
            ['safetyClearanceM', 'machinery.safetyClearance'],
          ] as const).map(([key, label]) => <label key={key}><span>{t(label)}</span><span><input aria-label={t(label)} type="number" min="0.1" max="12" step="0.05" disabled={!design.machinery.enabled} value={design.machinery[key]} onChange={(event) => updateMachinery({ [key]: Number(event.target.value) })} /> m</span></label>)}
        </div>
        <div className="machinery-result"><span><small>{t('machinery.requiredCorridor')}</small><strong>{formatNumber(machineEnvelope.corridorWidthM, 2)} m</strong></span><span><small>{t('machinery.headland')}</small><strong>{formatNumber(machineEnvelope.headlandDepthM, 2)} m</strong></span></div>
        <label className="pipe-crossing-toggle"><input type="checkbox" checked={design.machinery.protectPipeCrossings} disabled={!design.machinery.enabled} onChange={(event) => updateMachinery({ protectPipeCrossings: event.target.checked })} /><span><strong>{t('machinery.pipeCrossings')}</strong><small>{t('machinery.pipeCrossingsBody')}</small></span></label>
      </div>}
      {planningTab === 'species' && <>
      <div className="catalogue-search"><Search size={16} /><input value={query} placeholder={t('species.searchPlaceholder')} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSearch(filters)} aria-label={t('species.searchCatalogue')} /><button onClick={() => onSearch(filters)}>{t('actions.search')}</button></div>
      <div className="catalogue-filters" aria-label={t('species.catalogueFilters')}>{([
        ['treeOnly', t('species.filterTrees')], ['globUntOnly', 'GlobUNT'], ['designReadyOnly', t('species.filterDesignReady')],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.checked })} /><span>{label}</span></label>)}</div>
      <div className="catalogue-advanced-filters" data-testid="catalogue-advanced-filters">
        <p>{t('species.advancedFiltersBody')}</p>
        <label><span>{t('species.filterStratum')}</span><select aria-label={t('species.filterStratum')} value={filters.stratum} onChange={(event) => setFilters({ ...filters, stratum: event.target.value })}><option value="">{t('species.filterAny')}</option>{['emergent', 'high', 'medium', 'low', 'ground', 'climber'].map((value) => <option key={value} value={value}>{localizedEnum(value, t)}</option>)}</select></label>
        <label><span>{t('species.filterSuccession')}</span><select aria-label={t('species.filterSuccession')} value={filters.succession} onChange={(event) => setFilters({ ...filters, succession: event.target.value })}><option value="">{t('species.filterAny')}</option>{['placenta', 'secondary', 'climax'].map((value) => <option key={value} value={value}>{localizedEnum(value, t)}</option>)}</select></label>
        <label><span>{t('species.filterRole')}</span><select aria-label={t('species.filterRole')} value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">{t('species.filterAny')}</option>{['food', 'fruit', 'biomass', 'nitrogen fixation', 'timber', 'fodder', 'wind protection', 'pollinator resource'].map((value) => <option key={value} value={value}>{localizedEnum(value, t)}</option>)}</select></label>
        <label><span>{t('species.filterEvergreen')}</span><select aria-label={t('species.filterEvergreen')} value={filters.evergreen} onChange={(event) => setFilters({ ...filters, evergreen: event.target.value as CatalogueFilters['evergreen'] })}><option value="">{t('species.filterAny')}</option><option value="true">{t('species.evergreen')}</option><option value="false">{t('species.deciduous')}</option></select></label>
        <label><span>{t('species.filterNitrogen')}</span><select aria-label={t('species.filterNitrogen')} value={filters.nitrogenFixer} onChange={(event) => setFilters({ ...filters, nitrogenFixer: event.target.value as CatalogueFilters['nitrogenFixer'] })}><option value="">{t('species.filterAny')}</option><option value="true">{t('actions.yes')}</option><option value="false">{t('actions.no')}</option></select></label>
        <label><span>{t('species.filterDrought')}</span><select aria-label={t('species.filterDrought')} value={filters.droughtMinimum} onChange={(event) => setFilters({ ...filters, droughtMinimum: Number(event.target.value) })}><option value="0">{t('species.filterAny')}</option>{[3, 4, 5].map((value) => <option key={value} value={value}>{value}/5+</option>)}</select></label>
        <label><span>{t('species.filterEvidence')}</span><select aria-label={t('species.filterEvidence')} value={filters.evidenceMinimum} onChange={(event) => setFilters({ ...filters, evidenceMinimum: Number(event.target.value) })}><option value="0">{t('species.filterAny')}</option>{[2, 3, 4].map((value) => <option key={value} value={value}>{value}+</option>)}</select></label>
      </div>
      <div className="catalogue-meta"><span><strong>{stats ? formatNumber(stats.total, 0) : '—'}</strong> {t('species.switchboardTaxa')}</span><span><strong>{stats ? formatNumber(stats.globUnt, 0) : '—'}</strong> {t('species.globUntRecords')}</span></div>
      {catalogueResults.length > 0 && <div className="catalogue-results">{catalogueResults.map((item) => <span key={item.id}><i>{item.scientificName}</i><span>{item.designReady && <small>{t('species.filterDesignReady')}</small>}{item.globUnt && <small>GlobUNT</small>}{item.stratum && <small>{localizedEnum(item.stratum, t)}</small>}{item.succession && <small>{localizedEnum(item.succession, t)}</small>}</span></span>)}</div>}
      {!recommendations.length ? <div className="inline-empty">{t('species.empty')}</div> : <div className="species-list">{visible.map((item) => {
        const selected = selectedIds.includes(item.species.id);
        return <div key={item.species.id} className={`species-row ${selected ? 'selected' : ''} ${inspected?.species.id === item.species.id ? 'inspected' : ''}`}>
          <button className="species-open" onClick={() => setInspectedId(item.species.id)} aria-label={t('species.inspect', { name: speciesDisplayName(item.species, t) })}>
            <span className="species-swatch" style={{ background: item.species.color }} />
            <span className="species-name"><strong>{speciesDisplayName(item.species, t)}</strong><i>{item.species.scientificName}</i><small>{localizedEnum(item.species.stratum, t)} · {localizedEnum(item.species.succession, t)} · {item.species.roles.slice(0, 2).map((role) => localizedEnum(role, t)).join(' / ')}</small></span>
            <span className="species-score"><strong>{item.score}</strong><small>/100</small></span>
          </button>
          <button className="select-check" onClick={() => onToggle(item.species.id)} aria-pressed={selected} aria-label={t(selected ? 'species.remove' : 'species.add', { name: speciesDisplayName(item.species, t) })}>{selected && <Check size={13} />}</button>
        </div>;
      })}</div>}
      {inspected && <div className={`species-inspector ${inspected.status}`} data-testid="species-inspector">
        <header><span className="species-swatch" style={{ background: inspected.species.color }} /><span><small>{translatedStatus(inspected.status, t)} · {t('species.score', { score: inspected.score })}</small><strong>{speciesDisplayName(inspected.species, t)}</strong><i>{inspected.species.scientificName}</i></span>{inspected.status === 'blocked' && <CircleOff size={20} />}</header>
        <div className="suitability-components">{inspected.components.map((component) => <div key={component.key} className={component.status}><span><strong>{t(`species.component.${component.key}`)}</strong><small>{t('species.weightStatus', { weight: Math.round(component.weight * 100), status: translatedStatus(component.status, t) })}</small></span><output>{component.score}</output><div><i style={{ width: `${component.score}%` }} /></div><p>{localizedSuitabilityExplanation(component, inspected.species, siteProfile, t)}</p></div>)}</div>
        {inspected.mitigations.length > 0 && <div className="mitigation-list"><strong>{t('species.checksBeforeUse')}</strong>{inspected.mitigations.map((item) => <p key={item}>• {localizedMitigation(item, inspected, siteProfile, t)}</p>)}</div>}
        <div className="species-sources"><strong>{t('species.linkedEvidence')}</strong>{inspected.species.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.label}-${source.version}`}><span>{source.label}</span><small>{source.version} · {source.supports.map((value) => localizedEnum(value, t)).join(', ')}</small></a>)}</div>
      </div>}
      </>}
      </div>
      </div>
      <div className="panel-action-bar">
      <button className="button primary wide sticky-action generate-design-action" onClick={onGenerate} disabled={selectedIds.length < minimumSpecies}>{t('actions.generate')} <ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function LayoutPanel({ variants, selectedVariant, onSelect, selectedTree, selectedTreeIds, onTreeSelect, onSelectGroup, onClearSelection, onReplaceSelected, onLockSelected, onDeleteSelected, onAlignSelected, onSpaceSelected, selectedSpecies, treeSpeciesId, onTreeSpecies, drawMode, onMode, onDelete, onLock, onUndo, onRedo, canUndo, canRedo, onRegenerate, onCalculate, onOpenSpecies, onFireOperations }: {
  variants: LayoutVariant[];
  selectedVariant: LayoutVariant | null;
  onSelect: (id: string) => void;
  selectedTree: TreeInstance | null;
  selectedTreeIds: string[];
  onTreeSelect: (id: string | null) => void;
  onSelectGroup: (group: 'row' | 'species' | 'all') => void;
  onClearSelection: () => void;
  onReplaceSelected: (speciesId: string) => void;
  onLockSelected: (locked: boolean) => void;
  onDeleteSelected: () => void;
  onAlignSelected: () => void;
  onSpaceSelected: () => void;
  selectedSpecies: DesignSpecies[];
  treeSpeciesId: string;
  onTreeSpecies: (id: string) => void;
  drawMode: DrawMode;
  onMode: (mode: DrawMode) => void;
  onDelete: () => void;
  onLock: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRegenerate: () => void;
  onCalculate: () => void;
  onOpenSpecies: () => void;
  onFireOperations: () => void;
}) {
  const { t } = useI18n();
  if (!selectedVariant) return <EmptyState icon={TreePine} title={t('layout.emptyTitle')} body={t('layout.emptyBody')} action={t('layout.openSpecies')} onAction={onOpenSpecies} />;
  const selectedTreeSpecies = selectedTree ? DESIGN_SPECIES_BY_ID.get(selectedTree.speciesId) : null;
  const selectedTreeGrowth = selectedTree && selectedTreeSpecies ? growthState(selectedTreeSpecies, selectedTree, selectedVariant.design.analysisYear) : null;
  return (
    <div className="panel-body persistent-action-panel">
      <div className="panel-scroll-content">
      <div className="panel-intro compact"><span className="eyebrow">{t('layout.eyebrow')}</span><h1>{localizedVariantName(selectedVariant, Math.max(0, variants.findIndex((variant) => variant.id === selectedVariant.id)), t)}</h1><p>{localizedVariantDescription(selectedVariant, t)}</p></div>
      <div className="variant-tabs">{variants.map((variant, index) => <button key={variant.id} className={variant.id === selectedVariant.id ? 'active' : ''} onClick={() => onSelect(variant.id)}><span>0{index + 1}</span><strong>{localizedVariantName(variant, index, t)}</strong><small>{t('layout.score', { score: variant.score })}</small></button>)}</div>
      <div className="metric-grid">
        <Metric label={t('layout.plants')} value={formatNumber(selectedVariant.metrics.totalTrees, 0)} detail={t('layout.speciesCount', { count: selectedVariant.metrics.speciesCount })} />
        <Metric label={t('layout.density')} value={formatNumber(selectedVariant.metrics.treesPerHectare, 0)} detail={t('layout.plantsPerHa')} />
        <Metric label={t('layout.canopyY10')} value={`${selectedVariant.metrics.projectedCanopyYear10Percent}%`} detail={t('layout.projectedCover')} />
        <Metric label={t('layout.canopyY20')} value={`${selectedVariant.metrics.projectedCanopyYear20Percent}%`} detail={t('layout.projectedCover')} />
        <Metric label={t('layout.openInterior')} value={`${formatNumber(selectedVariant.metrics.cropInteriorAreaM2, 0)} m²`} detail={t(selectedVariant.design.extent === 'full-field' ? 'layout.betweenRows' : 'layout.keptFree')} />
        <Metric label={t('layout.rowBearing')} value={`${selectedVariant.directionDegrees.toFixed(0)}°`} detail={localizedEnum(selectedVariant.design.orientationObjective, t)} />
      </div>
      <div className="composition-card" data-testid="layout-composition">
        <div className="card-heading"><div><Layers3 size={17} /><span><small>{t('layout.objectiveCheck')}</small><strong>{t('layout.composition')}</strong></span></div></div>
        <div className="composition-targets">{[
          [t('layout.productive'), selectedVariant.composition.productivePercent, selectedVariant.composition.targets.productivePercent],
          [t('layout.nativeSite'), selectedVariant.composition.nativePercent, selectedVariant.composition.targets.nativePercent],
          [t('layout.nitrogenFixers'), selectedVariant.composition.nitrogenFixerPercent, selectedVariant.composition.targets.nitrogenFixerPercent],
        ].map(([label, value, target]) => {
          const verified = typeof value === 'number';
          return <div key={String(label)} className={verified ? '' : 'unverified'}><span><strong>{label}</strong><small>{verified ? t('layout.actualTarget', { value, target: Number(target) }) : t('layout.nativeUnverified')}</small></span><div><i className={verified && value >= Number(target) ? 'met' : ''} style={{ width: `${verified ? Math.min(100, value) : 0}%` }} />{verified && <b style={{ left: `${Math.min(100, Number(target))}%` }} />}</div></div>;
        })}</div>
        <div className="composition-groups"><span><small>{t('layout.strata')}</small><strong>{Object.entries(selectedVariant.composition.byStratum).map(([key, value]) => `${localizedEnum(key, t)} ${value}`).join(' · ')}</strong></span><span><small>{t('layout.succession')}</small><strong>{Object.entries(selectedVariant.composition.bySuccession).map(([key, value]) => `${localizedEnum(key, t)} ${value}`).join(' · ')}</strong></span></div>
      </div>
      <div className="solar-assessment">
        <div className="card-heading"><div><CloudSun size={17} /><span><small>{t('layout.solarCheck')}</small><strong>{selectedVariant.solar.status === 'available' ? t('layout.cropAccess', { value: selectedVariant.solar.cropSolarAccessPercent ?? 0 }) : t('layout.radiationUnavailable')}</strong></span></div><StatusPill status={selectedVariant.solar.confidence} /></div>
        {selectedVariant.solar.status === 'available' && <div className="solar-metrics"><span><small>{t('layout.terrainPlane')}</small><strong>{formatNumber(selectedVariant.solar.terrainPlaneKwhM2Year ?? 0, 0)} kWh/m²·yr</strong></span><span><small>{t('layout.shadeLoss')}</small><strong>{selectedVariant.solar.shadedCropAreaPercent}%</strong></span><span><small>{t('layout.winterSun')}</small><strong>{selectedVariant.solar.winterSunHoursPerDay} h/day</strong></span><span><small>{t('layout.summerSun')}</small><strong>{selectedVariant.solar.summerSunHoursPerDay} h/day</strong></span></div>}
        <p>{t('layout.solarMethod')}</p>
        {selectedVariant.solar.limitations.length > 0 && <small className="solar-limitation">{t('layout.solarLimitation')}</small>}
      </div>
      <div className="generation-audit" data-testid="generation-audit">
        <div className="card-heading"><div><Sparkles size={17} /><span><small>{t('layout.generationAudit')}</small><strong>{t(selectedVariant.generation.mode === 'partial' ? 'layout.partialGeneration' : 'layout.fullGeneration')}</strong></span></div><StatusPill status={selectedVariant.generation.conflicts.length ? 'review-required' : 'available'} /></div>
        <div className="generation-audit-grid"><span><small>{t('layout.seed')}</small><strong>{selectedVariant.generation.seed}</strong></span><span><small>{t('layout.engine')}</small><strong>{selectedVariant.generation.engineVersion}</strong></span><span><small>{t('layout.lockedPreserved')}</small><strong>{selectedVariant.generation.lockedTreeCount}</strong></span></div>
      </div>
      {selectedVariant.machinery.enabled && <div className="machinery-plan" data-testid="machinery-plan">
        <div className="card-heading"><div><Route size={17} /><span><small>{t('machinery.planEyebrow')}</small><strong>{t('machinery.planTitle')}</strong></span></div><StatusPill status={selectedVariant.machinery.clearanceSatisfied ? 'available' : 'review-required'} /></div>
        <div className="machinery-result"><span><small>{t('machinery.corridors')}</small><strong>{selectedVariant.machinery.corridors.length}</strong></span><span><small>{t('machinery.turningAreas')}</small><strong>{selectedVariant.machinery.turningAreas.length}</strong></span><span><small>{t('machinery.reservedArea')}</small><strong>{formatNumber(selectedVariant.machinery.reservedAreaM2, 0)} m²</strong></span></div>
        <p>{t('machinery.planBody', { corridor: formatNumber(selectedVariant.machinery.requiredCorridorWidthM, 2), headland: formatNumber(selectedVariant.machinery.headlandDepthM, 2) })}</p>
      </div>}
      {selectedVariant.firebreak?.enabled && <div className="firebreak-plan" data-testid="firebreak-plan">
        <div className="card-heading"><div><Flame size={17} /><span><small>{t('firebreak.planEyebrow')}</small><strong>{t('firebreak.planTitle')}</strong></span></div><StatusPill status="review-required" /></div>
        <div className="firebreak-result"><span><small>{t('firebreak.plannedWidth')}</small><strong>{formatNumber(selectedVariant.firebreak.plannedWidthM, 1)} m</strong></span><span><small>{t('firebreak.totalLength')}</small><strong>{formatNumber(selectedVariant.firebreak.totalLengthM, 0)} m</strong></span><span><small>{t('firebreak.reservedArea')}</small><strong>{formatNumber(selectedVariant.firebreak.reservedAreaM2, 0)} m²</strong></span></div>
        <p>{t('firebreak.planBody', { width: formatNumber(selectedVariant.firebreak.plannedWidthM, 1), minimum: formatNumber(selectedVariant.firebreak.minimumPlanningWidthM, 1), treatment: t(`firebreak.treatment.${selectedVariant.firebreak.treatment === 'low-fuel-vegetation' ? 'lowFuel' : selectedVariant.firebreak.treatment === 'bare-ground' ? 'bareGround' : 'mown'}`) })}</p>
        <small className="firebreak-review">{t('firebreak.localReview')}</small>
        <button className="text-button fire-operations-link" onClick={onFireOperations}>{t('fireOperations.open')} <ChevronRight size={14} /></button>
      </div>}
      <div className="edit-toolbar"><button onClick={onUndo} disabled={!canUndo}><Undo2 size={15} /> {t('actions.undo')}</button><button onClick={onRedo} disabled={!canRedo}><Redo2 size={15} /> {t('actions.redo')}</button><button className={drawMode === 'add-tree' ? 'active' : ''} onClick={() => onMode(drawMode === 'add-tree' ? 'idle' : 'add-tree')}><Plus size={15} /> {t('actions.add')}</button><button onClick={onRegenerate} disabled={!selectedVariant.trees.some((tree) => tree.locked)}><Sparkles size={15} /> {t('actions.regenerateUnlocked')}</button></div>
      <label className="select-label"><span>{t('layout.manualSpecies')}</span><select value={treeSpeciesId} onChange={(event) => onTreeSpecies(event.target.value)}>{selectedSpecies.map((species) => <option key={species.id} value={species.id}>{speciesDisplayName(species, t)} — {localizedEnum(species.stratum, t)}</option>)}</select></label>
      <label className="select-label"><span>{t('layout.selectTree')}</span><select aria-label={t('layout.selectTree')} value={selectedTree?.id ?? ''} onChange={(event) => onTreeSelect(event.target.value || null)}><option value="">{t('layout.selectTreePlaceholder')}</option>{selectedVariant.trees.map((tree) => <option key={tree.id} value={tree.id}>{tree.id}</option>)}</select></label>
      <div className={`bulk-editor ${selectedTreeIds.length ? 'active' : ''}`} data-testid="bulk-editor">
        <div className="card-heading"><div><Layers3 size={17} /><span><small>{t('layout.bulkEyebrow')}</small><strong>{t('layout.bulkSelected', { count: selectedTreeIds.length })}</strong></span></div>{selectedTreeIds.length > 0 && <button className="bulk-clear" onClick={onClearSelection}>{t('actions.clear')}</button>}</div>
        <p>{t('layout.bulkHint')}</p>
        <div className="bulk-groups">
          <button disabled={!selectedTree} onClick={() => onSelectGroup('row')}>{t('layout.selectRow')}</button>
          <button disabled={!selectedTree} onClick={() => onSelectGroup('species')}>{t('layout.selectSpeciesGroup')}</button>
          <button onClick={() => onSelectGroup('all')}>{t('layout.selectAll')}</button>
        </div>
        {selectedTreeIds.length > 0 && <>
          <label className="select-label"><span>{t('layout.replaceSpecies')}</span><select aria-label={t('layout.replaceSpecies')} value={treeSpeciesId} onChange={(event) => onReplaceSelected(event.target.value)}>{selectedSpecies.map((species) => <option key={species.id} value={species.id}>{speciesDisplayName(species, t)}</option>)}</select></label>
          <div className="bulk-actions">
            <button disabled={selectedTreeIds.length < 2} onClick={onAlignSelected}>{t('layout.alignRow')}</button>
            <button disabled={selectedTreeIds.length < 2} onClick={onSpaceSelected}>{t('layout.equalSpacing')}</button>
            <button onClick={() => onLockSelected(true)}>{t('actions.lock')}</button>
            <button onClick={() => onLockSelected(false)}>{t('actions.unlock')}</button>
            <button className="danger" onClick={onDeleteSelected}><Trash2 size={13} />{t('actions.remove')}</button>
          </div>
        </>}
      </div>
      {selectedTree ? <div className="selected-tree-card"><span className="tree-dot" style={{ background: selectedTreeSpecies?.color }} /><div><small>{t('layout.selectedIndividual')}</small><strong>{selectedTreeSpecies ? speciesDisplayName(selectedTreeSpecies, t) : selectedTree.speciesId}</strong><span>{t(selectedTree.locked ? 'layout.positionLocked' : 'layout.positionEditable')} · {t('layout.plantedYear', { year: selectedTree.plantedYear })}</span></div>{selectedTreeGrowth && <div className="tree-growth-model" data-testid="tree-growth-model"><span><small>{t('layout.heightRange')}</small><strong>{formatNumber(selectedTreeGrowth.uncertainty.heightLowM, 1)}–{formatNumber(selectedTreeGrowth.heightM, 1)}–{formatNumber(selectedTreeGrowth.uncertainty.heightHighM, 1)} m</strong></span><span><small>{t('layout.crownRange')}</small><strong>{formatNumber(selectedTreeGrowth.uncertainty.crownDiameterLowM, 1)}–{formatNumber(selectedTreeGrowth.crownDiameterM, 1)}–{formatNumber(selectedTreeGrowth.uncertainty.crownDiameterHighM, 1)} m</strong></span><p>{t('layout.growthModel', { version: selectedTreeGrowth.model.version, confidence: translatedStatus(selectedTreeGrowth.model.confidence, t) })}</p></div>}<div className="tree-actions"><button onClick={onLock}>{t(selectedTree.locked ? 'actions.unlock' : 'actions.lock')}</button><button onClick={() => onMode('move-tree')} disabled={selectedTree.locked}>{t('actions.move')}</button><button className="danger" aria-label={t('actions.remove')} onClick={onDelete}><Trash2 size={14} /></button></div></div> : <div className="inline-empty">{t('layout.selectCrown')}</div>}
      {selectedVariant.warnings.length > 0 && <div className="warning-list">{selectedVariant.warnings.map((warning) => <p key={warning}>• {localizedDomainMessage(warning, t)}</p>)}</div>}
      </div>
      <div className="panel-action-bar">
        <button className="button primary wide sticky-action calculate-design-action" onClick={onCalculate}>{t('actions.calculate')} <ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function WaterPanel({ site, irrigation, configuration, onConfiguration, profile, canCalculate, onCalculate, onPrepare, onCosts, onShowZones, editingIrrigation, onEditIrrigation }: { site: SiteBoundary | null; irrigation: IrrigationEstimate | null; configuration: IrrigationConfiguration; onConfiguration: (value: IrrigationConfiguration) => void; profile: SiteProfile | null; canCalculate: boolean; onCalculate: () => void; onPrepare: () => void; onCosts: () => void; onShowZones: () => void; editingIrrigation: boolean; onEditIrrigation: () => void }) {
  const { t } = useI18n();
  const update = (patch: Partial<IrrigationConfiguration>) => onConfiguration({ ...configuration, ...patch });
  const sourceConfiguration = <div className="water-configuration" data-testid="water-configuration">
    <div className="card-heading"><div><Droplets size={17} /><span><small>{t('water.sourceEyebrow')}</small><strong>{t('water.sourceTitle')}</strong></span></div></div>
    <p>{t('water.sourceBody')}</p>
    <div className="water-source-grid">
      <label className="select-label"><span>{t('water.sourceType')}</span><select aria-label={t('water.sourceType')} value={configuration.sourceType} onChange={(event) => update({ sourceType: event.target.value as IrrigationConfiguration['sourceType'] })}><option value="network">{t('water.source.network')}</option><option value="well">{t('water.source.well')}</option><option value="tank">{t('water.source.tank')}</option><option value="reservoir">{t('water.source.reservoir')}</option></select></label>
      <label className="select-label"><span>{t('water.sourcePoint')}</span><select aria-label={t('water.sourcePoint')} value={configuration.sourcePointId ?? ''} onChange={(event) => update({ sourcePointId: event.target.value || null })}><option value="">{t(configuration.sourceType === 'tank' ? 'water.sourceAutoHigh' : 'water.sourceAuto')}</option>{site?.waterPoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label>
    </div>
    <div className="water-input-grid">
      <label><span>{t('water.availableFlow')}</span><span><input aria-label={t('water.availableFlow')} type="number" min="0.1" max="500" step="0.1" value={configuration.availableFlowM3Hour} onChange={(event) => update({ availableFlowM3Hour: Number(event.target.value) })} /> m³/h</span></label>
      <label><span>{t('water.inletPressure')}</span><span><input aria-label={t('water.inletPressure')} type="number" min="0" max="20" step="0.1" value={configuration.inletPressureBar} onChange={(event) => update({ inletPressureBar: Number(event.target.value) })} /> bar</span></label>
      <label><span>{t('water.emitterFlow')}</span><span><input aria-label={t('water.emitterFlow')} type="number" min="0.5" max="32" step="0.5" value={configuration.emitterFlowLHour} onChange={(event) => update({ emitterFlowLHour: Number(event.target.value) })} /> L/h</span></label>
      <label><span>{t('water.emittersPlant')}</span><span><input aria-label={t('water.emittersPlant')} type="number" min="1" max="12" step="1" value={configuration.emittersPerPlant} onChange={(event) => update({ emittersPerPlant: Number(event.target.value) })} /></span></label>
      <label><span>{t('water.distributionEfficiency')}</span><span><input aria-label={t('water.distributionEfficiency')} type="number" min="50" max="98" step="1" value={configuration.distributionEfficiencyPercent} onChange={(event) => update({ distributionEfficiencyPercent: Number(event.target.value) })} /> %</span></label>
      {configuration.sourceType === 'well' && <label><span>{t('water.wellLift')}</span><span><input aria-label={t('water.wellLift')} type="number" min="0" max="500" step="1" value={configuration.wellLiftM} onChange={(event) => update({ wellLiftM: Number(event.target.value) })} /> m</span></label>}
      {configuration.sourceType === 'tank' && <label><span>{t('water.tankCapacity')}</span><span><input aria-label={t('water.tankCapacity')} type="number" min="0.5" max="10000" step="0.5" value={configuration.tankCapacityM3} onChange={(event) => update({ tankCapacityM3: Number(event.target.value) })} /> m³</span></label>}
    </div>
    <small className="water-source-note">{t(configuration.sourceType === 'well' ? 'water.wellSurvey' : configuration.sourceType === 'tank' ? 'water.tankPlacement' : 'water.sourceVerification')}</small>
  </div>;
  if (!irrigation) return <div className="panel-body">{sourceConfiguration}<EmptyState icon={Droplets} title={t('water.emptyTitle')} body={t('water.emptyBody')} action={t(canCalculate ? 'water.calculate' : 'water.openDesign')} onAction={canCalculate ? onCalculate : onPrepare} /></div>;
  const maxMonthly = Math.max(...irrigation.monthly.map((month) => month.grossM3), 1);
  const routingValid = irrigation.network.routingValid !== false;
  const routingConflictCount = irrigation.network.unroutableLineIds?.length ?? 0;
  return (
    <div className="panel-body persistent-action-panel">
      <div className="panel-scroll-content">
      <div className="panel-intro compact"><span className="eyebrow">{t('water.eyebrow')}</span><h1>{t('water.annual', { value: formatNumber(irrigation.annualWaterM3, 0) })}</h1><p>{t('water.method')}</p></div>
      <div className="system-water-model" data-testid="system-water-model">
        <div><Sprout size={17} /><span><small>{t('water.systemModelEyebrow')}</small><strong>{t(systemTranslationKey(irrigation.waterModel.system))}</strong></span><b>{formatNumber(irrigation.waterModel.supplementalIrrigationPercent, 0)}%</b></div>
        <p>{t(irrigation.waterModel.system === 'syntropic' ? 'water.systemModelSyntropic' : irrigation.waterModel.system === 'monoculture' ? 'water.systemModelMonoculture' : 'water.systemModelDefault', { target: irrigation.waterModel.matureSupplementalTargetPercent, years: irrigation.waterModel.transitionYears })}</p>
        <small>{t('water.potentialDemand', { value: formatNumber(irrigation.potentialAnnualWaterM3, 0), irrigated: irrigation.irrigatedPlantCount })}</small>
      </div>
      {sourceConfiguration}
      <div className="metric-grid">
        <Metric label={t('water.gross')} value={`${formatNumber(irrigation.annualGrossMm, 0)} mm`} detail={irrigation.climatePeriod} />
        <Metric label={t('water.peak')} value={`${formatNumber(irrigation.peakDayM3, 1)} m³`} detail={t('water.designFlow')} />
        <Metric label={t('water.zones')} value={String(irrigation.zones)} detail={t('water.activePlants', { active: irrigation.activePlantCount, inactive: irrigation.inactivePlantCount })} />
        <Metric label={t('water.opexYear', { year: irrigation.designYear })} value={currency(irrigation.annualOperation.totalCost, irrigation.economics)} detail={t('water.opexDetail')} />
      </div>
      <div className="hydraulic-plan" data-testid="hydraulic-plan">
        <div className="card-heading"><div><Waves size={17} /><span><small>{t('water.hydraulicEyebrow')}</small><strong>{t('water.hydraulicTitle')}</strong></span></div><StatusPill status={irrigation.network.warnings.length ? 'review-required' : 'available'} /></div>
        <div className="hydraulic-metrics">
          <span><small>{t('water.requiredFlow')}</small><strong>{formatNumber(irrigation.network.requiredFlowM3Hour, 2)} m³/h</strong></span>
          <span><small>{t('water.dynamicHead')}</small><strong>{formatNumber(irrigation.network.requiredDynamicHeadM, 1)} m</strong></span>
          <span><small>{t('water.pump')}</small><strong>{irrigation.network.pumpRequired ? `${formatNumber(irrigation.network.pumpPowerKw, 2)} kW` : t('water.notRequired')}</strong></span>
          <span><small>{t('water.runtime')}</small><strong>{formatNumber(irrigation.network.peakZoneRuntimeHours, 1)} h</strong></span>
          <span><small>{t('water.pipeMeasured')}</small><strong>{formatNumber(irrigation.network.totalMeasuredPipeM, 0)} m</strong></span>
          <span><small>{t('water.pipePurchase')}</small><strong>{formatNumber(irrigation.network.totalPurchasePipeM, 0)} m</strong></span>
        </div>
        <p>{t('water.sourcePlacement', { elevation: irrigation.network.source.elevationM, source: t(`water.source.${irrigation.network.source.type}`) })}</p>
        {irrigation.network.source.placement === 'highest-terrain-sample' && <p>{t('water.autoHighEvidence')}</p>}
        <p>{t('water.dragSourceHint')}</p>
        {irrigation.network.protectedCrossingCount > 0 && <p>{t('water.protectedCrossings', { count: irrigation.network.protectedCrossingCount })}</p>}
        {irrigation.network.routedObstacleCount > 0 && <p>{t('water.routedObstacles', { count: irrigation.network.routedObstacleCount })}</p>}
        {!routingValid && <p className="hydraulic-conflict">{t('water.routingConflicts', { count: routingConflictCount })}</p>}
        {irrigation.network.manualOverrideCount > 0 && <p>{t('water.manualOverrides', { count: irrigation.network.manualOverrideCount })}</p>}
        {irrigation.network.warnings.map((warning) => <p className="hydraulic-warning" key={warning}>• {localizedDomainMessage(warning, t)}</p>)}
      </div>
      <div className={`network-lines${routingValid ? '' : ' has-conflicts'}`}><div className="card-heading"><div><Route size={17} /><span><small>{t('water.lineScheduleEyebrow')}</small><strong>{t('water.lineSchedule')}</strong></span></div><button className={editingIrrigation ? 'line-edit active' : 'line-edit'} onClick={onEditIrrigation}>{t(editingIrrigation ? 'water.finishLineEdit' : 'water.editLines')}</button></div><p className="line-edit-hint">{t('water.editLinesHint')}</p>{!routingValid && <p className="routing-conflict">{t('water.editBlockedLines')}</p>}{(['mainline', 'submain', 'lateral', 'protected-crossing'] as const).map((kind) => {
        const lines = irrigation.network.lines.filter((line) => line.kind === kind);
        if (!lines.length) return null;
        return <div key={kind}><span><i className={kind} /><strong>{t(`water.line.${kind}`)}</strong><small>{t('water.lineCountLength', { count: lines.length, length: formatNumber(lines.reduce((sum, line) => sum + line.lengthM, 0), 0) })}</small></span><span>{[...new Set(lines.map((line) => `${line.diameterMm} mm`))].join(' · ')}</span></div>;
      })}</div>
      <div className={`network-bom${routingValid ? '' : ' provisional'}`} data-testid="irrigation-bom" data-procurement-ready={routingValid}><div className="card-heading"><div><Database size={17} /><span><small>{t('water.bomEyebrow')}</small><strong>{t(routingValid ? 'water.bomTitle' : 'water.bomDraftTitle')}</strong></span></div></div>{!routingValid && <p className="bom-conflict">{t('water.bomConflict')}</p>}<div className="network-bom-head"><span>{t('water.component')}</span><span>{t('water.measured')}</span><span>{t('water.purchase')}</span></div>{irrigation.network.components.map((component) => <div className="network-bom-row" key={component.id}><span><strong>{localizedNetworkComponent(component.label, t)}</strong><small>{localizedNetworkSpecification(component.specification, t)}</small></span><span>{formatNumber(component.measuredQuantity, component.unit === 'm' ? 1 : 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span><span>{formatNumber(component.purchaseQuantity, component.unit === 'm' ? 0 : 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span></div>)}</div>
      <div className="monthly-chart"><div className="card-heading"><div><Droplets size={17} /><span><small>{t('water.monthlyDemand')}</small><strong>{t('water.monthlyUnit')}</strong></span></div></div><div className="bars">{irrigation.monthly.map((month) => <div key={month.month}><span style={{ height: `${Math.max(3, month.grossM3 / maxMonthly * 100)}%` }} title={`${month.grossM3} m³`} /><small>{monthName(month.month)}</small></div>)}</div></div>
      <div className="satellite-schedule"><div><Satellite size={18} /><span><small>{t('water.satelliteSchedule')}</small><strong>{t('water.nextPulse', { value: signed(irrigation.satelliteScheduling.adjustmentPercent) })}</strong></span><StatusPill status={irrigation.satelliteScheduling.confidence} /></div><p>{localizedIrrigationRecommendation(irrigation, t)}</p><div className="priority-counts"><span className="high">{irrigation.satelliteScheduling.highPrioritySamples} {t('water.priorityHigh')}</span><span className="medium">{irrigation.satelliteScheduling.mediumPrioritySamples} {t('water.priorityMonitor')}</span><span className="low">{irrigation.satelliteScheduling.lowPrioritySamples} {t('water.priorityLow')}</span></div><button className="text-button" onClick={onShowZones}>{t('water.showZones')} <ChevronRight size={14} /></button></div>
      <div className="cost-breakdown"><Row label={t('water.water')} value={currency(irrigation.annualOperation.waterCost, irrigation.economics)} /><Row label={t('water.pumping', { value: formatNumber(irrigation.annualOperation.pumpingKwh, 0) })} value={currency(irrigation.annualOperation.energyCost, irrigation.economics)} /><Row label={t('water.systemCare', { hours: formatNumber(irrigation.annualOperation.managementLaborHours, 1) })} value={currency(irrigation.annualOperation.managementLaborCost, irrigation.economics)} /><Row label={t('water.annualMaintenance')} value={currency(irrigation.annualOperation.maintenanceCost, irrigation.economics)} /><Row label={t('water.installationMaterials')} value={currency(irrigation.installation.materialsCost, irrigation.economics)} strong /><Row label={t('water.installationLabour', { hours: irrigation.installation.laborHours })} value={currency(irrigation.installation.laborCost, irrigation.economics)} /></div>
      {Boolean(profile?.satellite.limitations.length) && <p className="fine-print">{t('water.satelliteLimitation')}</p>}
      </div>
      <div className="panel-action-bar">
        <button className="button primary wide sticky-action" onClick={onCosts}>{t('water.reviewCosts')} <ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function CostsPanel({ costs, irrigation, species, configuration, onConfiguration, canCalculate, onCalculate, onPrepare, onSchedule }: { costs: EstablishmentCost | null; irrigation: IrrigationEstimate | null; species: DesignSpecies[]; configuration: EconomicConfiguration; onConfiguration: (value: EconomicConfiguration) => void; canCalculate: boolean; onCalculate: () => void; onPrepare: () => void; onSchedule: () => void }) {
  const { t } = useI18n();
  const update = (patch: Partial<EconomicConfiguration>) => onConfiguration({
    ...configuration,
    ...patch,
    pricingStatus: 'user-supplied',
    sourceSummary: 'Local rates reviewed or supplied for this project.',
    sourceVersion: 'User-supplied project rates',
    sourceObservedAt: new Date().toISOString(),
    confidence: 'high',
  });
  const rateConfiguration = <div className="economic-configuration" data-testid="economic-configuration">
    <div className="card-heading"><div><CircleDollarSign size={17} /><span><small>{t('costs.localBasisEyebrow')}</small><strong>{t('costs.localBasisTitle', { country: configuration.countryCode })}</strong></span></div><StatusPill status={configuration.missingLocalRates.length ? 'review-required' : 'available'} /></div>
    <p>{localizedEconomicSummary(configuration.sourceSummary, t)}</p>
    <div className="economic-input-grid">
      <label><span>{t('costs.currency')}</span><input aria-label={t('costs.currency')} value={configuration.currencyCode} maxLength={3} onChange={(event) => update({ currencyCode: event.target.value.toUpperCase() })} /></label>
      <label><span>{t('costs.labourRate')}</span><input aria-label={t('costs.labourRate')} type="number" min="0" step="0.01" value={configuration.laborCostPerHour} onChange={(event) => update({ laborCostPerHour: Number(event.target.value) })} /><i>{configuration.currencyCode}/h</i></label>
      <label><span>{t('costs.waterRate')}</span><input aria-label={t('costs.waterRate')} type="number" min="0" step="0.01" value={configuration.waterCostPerM3} onChange={(event) => update({ waterCostPerM3: Number(event.target.value) })} /><i>{configuration.currencyCode}/m³</i></label>
      <label><span>{t('costs.electricityRate')}</span><input aria-label={t('costs.electricityRate')} type="number" min="0" step="0.01" value={configuration.electricityCostPerKwh} onChange={(event) => update({ electricityCostPerKwh: Number(event.target.value) })} /><i>{configuration.currencyCode}/kWh</i></label>
      <label><span>{t('costs.plantMultiplier')}</span><input aria-label={t('costs.plantMultiplier')} type="number" min="0" step="0.01" value={configuration.plantReferenceMultiplier} onChange={(event) => update({ plantReferenceMultiplier: Number(event.target.value) })} /><i>×</i></label>
      <label><span>{t('costs.materialMultiplier')}</span><input aria-label={t('costs.materialMultiplier')} type="number" min="0" step="0.01" value={configuration.irrigationReferenceMultiplier} onChange={(event) => update({ irrigationReferenceMultiplier: Number(event.target.value) })} /><i>×</i></label>
      <label><span>{t('costs.smallProtection')}</span><input aria-label={t('costs.smallProtection')} type="number" min="0" step="0.01" value={configuration.smallProtectionUnitCost} onChange={(event) => update({ smallProtectionUnitCost: Number(event.target.value) })} /><i>{configuration.currencyCode}</i></label>
      <label><span>{t('costs.largeProtection')}</span><input aria-label={t('costs.largeProtection')} type="number" min="0" step="0.01" value={configuration.largeProtectionUnitCost} onChange={(event) => update({ largeProtectionUnitCost: Number(event.target.value) })} /><i>{configuration.currencyCode}</i></label>
    </div>
    {configuration.missingLocalRates.length > 0 && <div className="economic-warning"><ShieldCheck size={16} /><span>{t('costs.missingLocalRates', { values: configuration.missingLocalRates.map((value) => localizedEconomicRate(value, t)).join(', ') })}</span></div>}
  </div>;
  if (!costs || !irrigation) return <div className="panel-body">{rateConfiguration}<EmptyState icon={CircleDollarSign} title={t('costs.emptyTitle')} body={t('costs.emptyBody')} action={t(canCalculate ? 'costs.calculate' : 'costs.openDesign')} onAction={canCalculate ? onCalculate : onPrepare} /></div>;
  const speciesMap = new Map(species.map((item) => [item.id, item]));
  return (
    <div className="panel-body persistent-action-panel">
      <div className="panel-scroll-content">
      {rateConfiguration}
      {costs.economics.missingLocalRates.length > 0 && <div className="estimate-partial"><strong>{t('costs.partialTitle')}</strong><span>{t('costs.partialBody')}</span></div>}
      <div className="cost-scope-grid">
        <div className="total-cost"><small>{t(costs.economics.missingLocalRates.length ? 'costs.partialEstablishment' : 'costs.establishment')}</small><strong>{currency(costs.totalCost, costs.economics)}</strong><span>{t('costs.capexDetail')}</span></div>
        <div className="total-cost active"><small>{t('costs.activeSystem', { year: costs.activeSystem.designYear })}</small><strong>{currency(costs.activeSystem.totalReplacementCost, costs.economics)}</strong><span>{t('costs.activeSystemDetail', { active: costs.activeSystem.activePlantCount, inactive: costs.activeSystem.inactivePlantCount })}</span></div>
      </div>
      <CostTimelineChart costs={costs} irrigation={irrigation} />
      <MaintenanceTimelineChart costs={costs} irrigation={irrigation} />
      <div className="cost-breakdown large"><Row label={t('costs.plants')} value={currency(costs.plantPurchaseCost, costs.economics)} /><Row label={t('costs.labourHours', { label: t('costs.labour'), hours: formatNumber(costs.plantingLaborHours, 1) })} value={currency(costs.plantingLaborCost, costs.economics)} /><Row label={t('costs.protection')} value={currency(costs.protectionAndStakesCost, costs.economics)} /><Row label={t('costs.irrigation')} value={currency(costs.irrigationInstallationCost, costs.economics)} strong /><Row label={t('costs.annualWaterYear', { year: irrigation.designYear })} value={t('costs.perYear', { value: currency(irrigation.annualOperation.totalCost, costs.economics) })} strong /></div>
      <div className="cost-table"><div className="cost-table-head"><span>{t('costs.species')}</span><span>{t('costs.quantity')}</span><span>{t('costs.plant')}</span><span>{t('costs.labourShort')}</span><span>{t('costs.total')}</span></div>{costs.bySpecies.map((item) => {
        const entry = speciesMap.get(item.speciesId);
        return <div className="cost-table-row" key={item.speciesId}><span><strong>{entry ? speciesDisplayName(entry, t) : item.speciesId}</strong><i>{entry?.scientificName}</i></span><span>{item.count}</span><span>{currency(item.unitPlantCost, costs.economics)}</span><span>{formatNumber(item.unitLaborHours, 2)} h</span><span>{currency(item.subtotalCost, costs.economics)}</span></div>;
      })}</div>
      <div className="source-note"><Database size={17} /><div><strong>{t('costs.priceBasis')}</strong><span>{localizedEconomicSummary(costs.economics.sourceSummary, t)}</span></div></div>
      <button className="button schedule-button wide" data-testid="open-operational-schedule" onClick={onSchedule}><ClipboardCheck size={17} /> {t('schedule.open')}</button>
      </div>
      <div className="panel-action-bar">
        <button className="button primary wide sticky-action" onClick={onCalculate}>{t('costs.recalculate')} <ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function CostTimelineChart({ costs, irrigation }: { costs: EstablishmentCost; irrigation: IrrigationEstimate }) {
  const { t } = useI18n();
  const timeline = costs.timeline ?? [];
  if (timeline.length < 2) return null;
  const width = 640;
  const height = 236;
  const padding = { top: 20, right: 18, bottom: 32, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...timeline.map((point) => point.annualOperatingCost));
  const x = (index: number) => padding.left + index / (timeline.length - 1) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - value / maximum * plotHeight;
  const line = timeline.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.annualOperatingCost).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(timeline.length - 1).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} L ${x(0).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`;
  const currentIndex = Math.max(0, Math.min(timeline.length - 1, irrigation.designYear - 1));
  const current = timeline[currentIndex];
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const change = first.annualOperatingCost > 0 ? (last.annualOperatingCost - first.annualOperatingCost) / first.annualOperatingCost * 100 : 0;
  const markerYears = new Set([1, 5, 10, 15, 20, 25, timeline.length]);
  return (
    <section className="cost-timeline" data-testid="cost-timeline">
      <div className="card-heading"><div><CircleDollarSign size={17} /><span><small>{t('costs.timelineEyebrow')}</small><strong>{t('costs.timelineTitle')}</strong></span></div><StatusPill status={change < 0 ? 'available' : 'review-required'} /></div>
      <p>{t(irrigation.waterModel.system === 'syntropic' ? 'costs.timelineSyntropic' : irrigation.waterModel.system === 'monoculture' ? 'costs.timelineMonoculture' : 'costs.timelineOther', { system: t(systemTranslationKey(irrigation.waterModel.system)) })}</p>
      <div className="cost-timeline-summary">
        <span><small>{t('costs.yearOne')}</small><strong>{currency(first.annualOperatingCost, costs.economics)}</strong></span>
        <span><small>{t('costs.yearThirty')}</small><strong>{currency(last.annualOperatingCost, costs.economics)}</strong></span>
        <span className={change < 0 ? 'decline' : ''}><small>{t('costs.longTermChange')}</small><strong>{signed(Math.round(change))}%</strong></span>
      </div>
      <svg className="cost-timeline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('costs.timelineAria')}>
        <defs><linearGradient id="costTimelineFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#b8db55" stopOpacity=".42" /><stop offset="1" stopColor="#b8db55" stopOpacity=".03" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y(maximum * ratio)} y2={y(maximum * ratio)} /><text x={padding.left - 9} y={y(maximum * ratio) + 3} textAnchor="end">{compactCurrency(maximum * ratio, costs.economics)}</text></g>)}
        <path className="cost-area" d={area} />
        <path className="cost-line" d={line} />
        {timeline.map((point, index) => markerYears.has(point.year) ? <g key={point.year}><circle className="cost-point" cx={x(index)} cy={y(point.annualOperatingCost)} r="3.5"><title>{t('costs.pointTitle', { year: point.year, value: currency(point.annualOperatingCost, costs.economics) })}</title></circle><text className="year-label" x={x(index)} y={height - 9} textAnchor="middle">{point.year}</text></g> : null)}
        <line className="current-year-line" x1={x(currentIndex)} x2={x(currentIndex)} y1={padding.top} y2={padding.top + plotHeight} />
        <circle className="current-year-point" cx={x(currentIndex)} cy={y(current.annualOperatingCost)} r="5"><title>{t('costs.currentPoint', { year: current.year, value: currency(current.annualOperatingCost, costs.economics) })}</title></circle>
      </svg>
      <div className="cost-timeline-breakdown">
        <span><i className="water-energy" />{t('costs.waterEnergy')}<strong>{currency(current.waterAndEnergyCost, costs.economics)}</strong></span>
        <span><i className="care" />{t('costs.systemCare')}<strong>{currency(current.managementLaborCost, costs.economics)}</strong></span>
        <span><i className="maintenance" />{t('costs.maintenance')}<strong>{currency(current.maintenanceCost, costs.economics)}</strong></span>
      </div>
      <small className="cost-timeline-note">{t('costs.timelineNote')}</small>
    </section>
  );
}

function MaintenanceTimelineChart({ costs, irrigation }: { costs: EstablishmentCost; irrigation: IrrigationEstimate }) {
  const { t } = useI18n();
  const timeline = costs.timeline ?? [];
  if (!irrigation.systemMaintenance || timeline.length < 2 || timeline.some((point) => !Number.isFinite(point.maintenanceLaborHours) || !Array.isArray(point.maintenanceTasks))) return null;
  const width = 640;
  const height = 205;
  const padding = { top: 17, right: 18, bottom: 30, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...timeline.map((point) => point.maintenanceLaborHours));
  const x = (index: number) => padding.left + index / (timeline.length - 1) * plotWidth;
  const y = (value: number) => padding.top + plotHeight - value / maximum * plotHeight;
  const line = timeline.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.maintenanceLaborHours).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(timeline.length - 1).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} L ${x(0).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`;
  const currentIndex = Math.max(0, Math.min(timeline.length - 1, irrigation.designYear - 1));
  const current = timeline[currentIndex];
  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const change = first.maintenanceLaborHours > 0 ? (last.maintenanceLaborHours - first.maintenanceLaborHours) / first.maintenanceLaborHours * 100 : 0;
  const largestTask = Math.max(1, ...current.maintenanceTasks.map((task) => task.hours));
  const markerYears = new Set([1, 5, 10, 15, 20, 25, timeline.length]);
  const descriptionKey = irrigation.waterModel.system === 'syntropic'
    ? 'costs.maintenanceSyntropic'
    : irrigation.waterModel.system === 'monoculture'
      ? 'costs.maintenanceMonoculture'
      : irrigation.waterModel.system === 'windbreak' || irrigation.waterModel.system === 'boundary-buffer'
        ? 'costs.maintenancePerimeter'
        : 'costs.maintenanceOther';

  return (
    <section className="maintenance-timeline" data-testid="maintenance-timeline">
      <div className="card-heading"><div><Clock3 size={17} /><span><small>{t('costs.maintenanceEyebrow')}</small><strong>{t('costs.maintenanceTitle')}</strong></span></div><StatusPill status={irrigation.systemMaintenance.confidence === 'low' ? 'review-required' : 'available'} /></div>
      <p>{t(descriptionKey, { system: t(systemTranslationKey(irrigation.waterModel.system)) })}</p>
      <div className="maintenance-summary">
        {[first, current, last].map((point, index) => <span key={`${point.year}-${index}`} className={index === 1 ? 'selected' : ''}><small>{index === 0 ? t('costs.yearOne') : index === 1 ? t('costs.selectedYear', { year: point.year }) : t('costs.yearThirty')}</small><strong>{formatNumber(point.maintenanceLaborHours, 1)} h</strong><b>{currency(point.managementLaborCost, costs.economics)}</b></span>)}
      </div>
      <svg className="maintenance-timeline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('costs.maintenanceTimelineAria')}>
        <defs><linearGradient id="maintenanceTimelineFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3f8f7e" stopOpacity=".32" /><stop offset="1" stopColor="#3f8f7e" stopOpacity=".02" /></linearGradient></defs>
        {[0, 0.5, 1].map((ratio) => <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y(maximum * ratio)} y2={y(maximum * ratio)} /><text x={padding.left - 8} y={y(maximum * ratio) + 3} textAnchor="end">{formatNumber(maximum * ratio, 0)} h</text></g>)}
        <path className="maintenance-area" d={area} />
        <path className="maintenance-line" d={line} />
        {timeline.map((point, index) => markerYears.has(point.year) ? <g key={point.year}><circle className="maintenance-point" cx={x(index)} cy={y(point.maintenanceLaborHours)} r="3.5"><title>{t('costs.maintenancePointTitle', { year: point.year, hours: formatNumber(point.maintenanceLaborHours, 1), value: currency(point.managementLaborCost, costs.economics) })}</title></circle><text className="year-label" x={x(index)} y={height - 8} textAnchor="middle">{point.year}</text></g> : null)}
        <line className="current-year-line" x1={x(currentIndex)} x2={x(currentIndex)} y1={padding.top} y2={padding.top + plotHeight} />
        <circle className="current-year-point" cx={x(currentIndex)} cy={y(current.maintenanceLaborHours)} r="5" />
      </svg>
      <div className="maintenance-task-list">
        {current.maintenanceTasks.length > 0
          ? current.maintenanceTasks.map((task) => <div key={task.id}><span><strong>{t(`costs.maintenanceTask.${task.id}`)}</strong><small>{formatNumber(task.hours, 1)} h · {currency(task.cost, costs.economics)}</small></span><i><b style={{ width: `${task.hours / largestTask * 100}%` }} /></i></div>)
          : <div className="maintenance-autonomous"><span><strong>{t('costs.maintenanceAutonomousTitle')}</strong><small>{t('costs.maintenanceAutonomousBody')}</small></span><Check size={17} /></div>}
      </div>
      <div className="maintenance-method"><span>{t(`costs.maintenanceBasis.${irrigation.systemMaintenance.basis}`)}</span><b>{t('costs.maintenanceEvidence', { count: irrigation.systemMaintenance.sources.length, confidence: translatedStatus(irrigation.systemMaintenance.confidence, t) })}</b></div>
      <small className="maintenance-note">{t('costs.maintenanceNote', { rate: currency(irrigation.systemMaintenance.laborCostPerHour, costs.economics) })} · {t('costs.longTermHoursChange', { value: signed(Math.round(change)) })}</small>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function Index({ label, value }: { label: string; value: number }) { return <span><small>{label}</small><strong>{value.toFixed(3)}</strong></span>; }
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={strong ? 'strong' : ''}><span>{label}</span><strong>{value}</strong></div>; }
function SoilPropertyGroup({ title, body, properties }: { title: string; body: string; properties: SoilPropertyEstimate[] }) {
  const { t } = useI18n();
  return <section>
    <header><strong>{title}</strong><small>{body}</small></header>
    <div>{properties.map((property) => {
      const decimals = property.unit === 'kg/dm³' || property.unit === 'pH' ? 2 : 1;
      const unit = property.unit === 'ratio' ? '' : ` ${property.unit}`;
      return <article key={property.key}>
        <span><small>{t(`soil.property.${property.key}`)}</small><strong>{property.value === null ? '—' : `${formatNumber(property.value, decimals)}${unit}`}</strong></span>
        <p>{t('soil.depth', { top: property.depthTopCm, bottom: property.depthBottomCm })} · {t(`soil.estimate.${property.estimateType}`)}</p>
        {property.predictionInterval90 && <b>{t('soil.interval90', { low: formatNumber(property.predictionInterval90.low, decimals), high: formatNumber(property.predictionInterval90.high, decimals), unit })}</b>}
      </article>;
    })}</div>
  </section>;
}
function StatusPill({ status }: { status: string }) { const { t } = useI18n(); return <span className={`status-pill ${status}`}>{translatedStatus(status, t)}</span>; }
function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: typeof Leaf; title: string; body: string; action: string; onAction: () => void }) { return <div className="empty-state"><span><Icon size={27} /></span><h2>{title}</h2><p>{body}</p><button className="button primary" onClick={onAction}>{action}<ChevronRight size={17} /></button></div>; }

function post(value: unknown): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }
function put(value: unknown): RequestInit { return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }
class GrowupApiError extends Error {
  readonly statusCode: number;
  readonly status: string;
  constructor(message: string, statusCode: number, status: string) {
    super(message);
    this.name = 'GrowupApiError';
    this.statusCode = statusCode;
    this.status = status;
  }
}
async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new GrowupApiError(body?.error?.message ?? `Growup API returned ${response.status}`, response.status, body?.error?.status ?? 'API_ERROR');
  return body as T;
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Unexpected Growup error'; }
function soilPropertyValue(properties: SoilPropertyEstimate[], key: SoilPropertyEstimateKey) {
  const property = properties.find((item) => item.key === key);
  if (!property || property.value === null) return '—';
  return `${formatNumber(property.value, property.unit === 'kg/dm³' ? 2 : 1)}${property.unit === 'ratio' ? '' : ` ${property.unit}`}`;
}
function localizedSoilLimitation(value: string, t: (key: string) => string) {
  const keys: Record<string, string> = {
    'Values are global model predictions, not laboratory measurements from this parcel.': 'soil.limitation.modelled',
    'SoilGrids explains approximately 30–70% of observed variation depending on property and location.': 'soil.limitation.accuracy',
    'Total nitrogen is not plant-available nitrogen; phosphorus, potassium, micronutrients, salinity and contaminants are not estimated here.': 'soil.limitation.missingChemistry',
    'Use georeferenced laboratory samples before fertilisation, amendment or contamination decisions.': 'soil.limitation.fieldTest',
    'SoilGrids was unavailable; obtain a georeferenced laboratory soil analysis.': 'soil.limitation.unavailable',
  };
  return t(keys[value] ?? value);
}
function localizedWindLimitation(value: string, t: (key: string) => string) {
  if (value === 'Reanalysis does not resolve local obstacles, hedges or gust corridors; verify damaging winds on site.') return t('wind.limitation.reanalysis');
  if (value === 'Historical hourly radiation and wind could not be retrieved.') return t('wind.limitation.unavailable');
  return value;
}
function plantingRestriction(
  coordinate: Coordinate,
  site: SiteBoundary | null,
  profile: SiteProfile | null,
  firebreak: LayoutVariant['firebreak'] | null,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!site) return t('errors.selectSite');
  if (!siteContainsCoordinate(site, coordinate)) return t('errors.plantOutside');
  const boundaryDistanceM = distanceToSiteBoundaryM(site, coordinate);
  if (boundaryDistanceM < site.setbackM) return t('errors.boundarySetback', { value: site.setbackM });
  if (firebreak?.enabled && boundaryDistanceM < firebreak.plannedWidthM) return t('errors.firebreakReserve', { value: firebreak.plannedWidthM });
  if (site.paths.some((path) => distanceToSitePathM(coordinate, path) < path.widthM / 2)) return t('errors.reservedPath');
  if (site.existingTrees.some((tree) => {
    const projection = createLocalProjection(tree.coordinate);
    const point = projection.project(coordinate);
    return Math.hypot(point.x, point.y) < tree.crownDiameterM / 2 + tree.protectionBufferM;
  })) return t('errors.existingTreeBuffer');
  const projection = createLocalProjection(polygonCentroid(site.polygon));
  const point = projection.project(coordinate);
  if (site.exclusions.some((polygon) => pointInPolygon(point, polygon.map(projection.project)))) return t('errors.manualExclusion');
  const woody = profile?.satellite.existingVegetation.patches ?? [];
  if (woody.some((patch) => pointInPolygon(point, patch.polygon.map(projection.project)))) return t('errors.existingVegetation');
  return null;
}
function corridorSegmentPolygon(start: Coordinate, end: Coordinate, widthM: number): Coordinate[] {
  const origin = { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 };
  const projection = createLocalProjection(origin);
  const projectedStart = projection.project(start);
  const projectedEnd = projection.project(end);
  const deltaX = projectedEnd.x - projectedStart.x;
  const deltaY = projectedEnd.y - projectedStart.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.01) return [start, end, end, start];
  const halfWidth = Math.max(0.25, widthM / 2);
  const normalX = (-deltaY / length) * halfWidth;
  const normalY = (deltaX / length) * halfWidth;
  return [
    projection.unproject({ x: projectedStart.x + normalX, y: projectedStart.y + normalY }),
    projection.unproject({ x: projectedEnd.x + normalX, y: projectedEnd.y + normalY }),
    projection.unproject({ x: projectedEnd.x - normalX, y: projectedEnd.y - normalY }),
    projection.unproject({ x: projectedStart.x - normalX, y: projectedStart.y - normalY }),
  ];
}
function windVectorCoordinates(center: Coordinate, sourceDirectionDegrees: number, lengthM: number): [Coordinate, Coordinate] {
  const projection = createLocalProjection(center);
  const radians = sourceDirectionDegrees * Math.PI / 180;
  const halfLength = Math.max(10, lengthM / 2);
  const sourceOffset = { x: Math.sin(radians) * halfLength, y: Math.cos(radians) * halfLength };
  return [
    projection.unproject(sourceOffset),
    projection.unproject({ x: -sourceOffset.x, y: -sourceOffset.y }),
  ];
}
function cloneSite(site: SiteBoundary): SiteBoundary {
  return {
    ...site,
    polygon: site.polygon.map((point) => ({ ...point })),
    additionalPolygons: site.additionalPolygons.map((polygon) => polygon.map((point) => ({ ...point }))),
    holes: site.holes.map((polygon) => polygon.map((point) => ({ ...point }))),
    exclusions: site.exclusions.map((polygon) => polygon.map((point) => ({ ...point }))),
    paths: site.paths.map((path) => ({ ...path, points: path.points.map((point) => ({ ...point })) })),
    accessPoints: site.accessPoints.map((point) => ({ ...point, coordinate: { ...point.coordinate } })),
    waterPoints: site.waterPoints.map((point) => ({ ...point, coordinate: { ...point.coordinate } })),
    existingTrees: site.existingTrees.map((tree) => ({ ...tree, coordinate: { ...tree.coordinate } })),
  };
}
function previousSection(section: WorkspaceSection) { const index = STEPS.findIndex((step) => step.id === section); return STEPS[Math.max(0, index - 1)].id; }
function nextSection(section: WorkspaceSection) { const index = STEPS.findIndex((step) => step.id === section); return STEPS[Math.min(STEPS.length - 1, index + 1)].id; }
function stepLabelKey(section: WorkspaceSection) { return `nav.${section}`; }
function fireLimitationKey(value: string) {
  if (value.startsWith('This is a transparent planning-attention index')) return 'fireAnalysis.limitation.index';
  if (value.startsWith('Climate and wind inputs')) return 'fireAnalysis.limitation.field';
  if (value.startsWith('The EFFIS Fire Weather Index layer')) return 'fireAnalysis.limitation.effis';
  return value;
}
function compactNumber(value: number) { return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
function compactCurrency(value: number, economics: Pick<EconomicConfiguration, 'currencyCode' | 'currencyLocale'>) {
  try {
    return new Intl.NumberFormat(economics.currencyLocale, { style: 'currency', currency: economics.currencyCode, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return `${compactNumber(value)} ${economics.currencyCode}`;
  }
}
function formatNumber(value: number, digits: number) { return new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
function currency(value: number, economics: Pick<EconomicConfiguration, 'currencyCode' | 'currencyLocale'>) {
  try {
    return new Intl.NumberFormat(economics.currencyLocale, { style: 'currency', currency: economics.currencyCode, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${formatNumber(value, 0)} ${economics.currencyCode}`;
  }
}
function signed(value: number) { return `${value > 0 ? '+' : ''}${formatNumber(value, Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0)}`; }
function shortDate(value: string, locale: Locale = 'en') { return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)); }
function shortDay(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', { day: '2-digit', month: 'short' }).format(new Date(value)); }
function humanize(value: string) { return value.replaceAll('-', ' ').replaceAll('_', ' '); }
function translatedStatus(status: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const key = `status.${status}`;
  const translated = t(key);
  return translated === key ? humanize(status) : translated;
}
function localizedEnum(value: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const normalized = value.trim().toLowerCase().replaceAll(/\s+/g, '-').replaceAll('_', '-');
  const key = `enum.${normalized}`;
  const translated = t(key);
  return translated === key ? humanize(value) : translated;
}
function localizedEconomicSummary(value: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const keys: Record<string, string> = {
    'Global USD planning estimate. A current exchange rate is applied after field analysis; replace rates with local quotes before procurement.': 'costs.source.usd',
    'Global USD planning estimate converted with the current field currency rate. Replace labour, utility and supplier rates with local quotes before procurement.': 'costs.source.converted',
    'Local rates reviewed or supplied for this project.': 'costs.source.reviewed',
  };
  return keys[value] ? t(keys[value]) : value;
}
function localizedEconomicRate(value: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const keys: Record<string, string> = {
    labour: 'costs.rate.labour',
    water: 'costs.rate.water',
    electricity: 'costs.rate.electricity',
    'plant stock': 'costs.rate.plantStock',
    'irrigation materials': 'costs.rate.irrigationMaterials',
    'stakes and guards': 'costs.rate.stakesGuards',
  };
  return keys[value] ? t(keys[value]) : value;
}
function localizedDomainMessage(value: string, t: (key: string, values?: Record<string, string | number>) => string) {
  if (value === 'No existing woody patch met the multi-source detection threshold; field verification remains mandatory.') return t('profile.woodyNone');
  const woodyReject = value.match(/^Reject this parcel for a blank-slate layout: ([\d.]+)% is classified as existing woody vegetation\.$/);
  if (woodyReject) return t('profile.woodyReject', { value: woodyReject[1] });
  const woodyDetected = value.match(/^(\d+) existing woody (?:patch|patches) detected and protected before layout generation\.$/);
  if (woodyDetected) return t('profile.woodyDetected', { count: woodyDetected[1] });
  if (value === 'Existing woody vegetation could not be classified automatically. A field survey is required before placing plants.') return t('profile.woodyUnavailable');
  if (value === 'Existing woody vegetation classification is incomplete; do not place plants until the parcel is field-verified.') return t('profile.woodyIncomplete');
  const exact: Record<string, string> = {
    'Valid site geometry': 'validation.valid',
    'Every planting polygon requires at least three vertices.': 'validation.minimumVertices',
    'The site contains an invalid coordinate.': 'validation.invalidCoordinate',
    'Every planting polygon must cover at least 25 m².': 'validation.minimumArea',
    'A planting polygon self-intersects.': 'validation.selfIntersection',
    'Every hole must be a valid polygon contained by the site.': 'validation.invalidHole',
    'Every exclusion must be a valid polygon contained by the site.': 'validation.invalidExclusion',
    'Every management path must contain at least two points inside the site.': 'validation.invalidPath',
    'Access, water and existing-tree points must lie inside the site.': 'validation.invalidPoints',
    'Fewer than four vertical strata could be represented in this geometry.': 'layout.warning.strata',
    'The palette has no placenta-phase support species.': 'layout.warning.placenta',
    'The palette has no long-lived climax species.': 'layout.warning.climax',
    'Monoculture is a production baseline with lower planned diversity and resilience.': 'layout.warning.monoculture',
    'Wind direction is based on reanalysis; confirm damaging seasonal winds and barrier porosity in the field.': 'layout.warning.wind',
    'Year-20 projected crown cover is dense; scheduled pruning or thinning is required.': 'layout.warning.canopy',
    'A critical climate or water mismatch prevents recommendation for this site.': 'species.warning.criticalMismatch',
    'Set AI_PROVIDER_API_KEY on the Growup server to enable the internal assistant.': 'assistant.unavailable',
    'Well position is provisional at the highest sampled terrain point; hydrogeological survey and permitting are required before drilling.': 'water.warning.wellPosition',
    'The tank is provisionally placed at the highest sampled terrain point for gravity assistance; confirm access, bearing capacity and surveyed elevation.': 'water.warning.tankPosition',
    'Reservoir position requires a user-defined water point and geotechnical review.': 'water.warning.reservoirPosition',
    'One or more irrigation lines could not be routed safely around protected obstacles. Edit the blocked lines before procurement.': 'water.warning.routingConflict',
  };
  if (exact[value]) return t(exact[value]);
  let match = value.match(/^Planting is restricted to an inward ([\d.]+) m boundary band; the central crop area remains unplanted\.$/);
  if (match) return t('layout.warning.perimeter', { value: match[1] });
  match = value.match(/^(\d+) existing woody (?:patch is|patches are) protected from new planting\.$/);
  if (match) return t('layout.warning.woody', { count: match[1] });
  match = value.match(/^(\d+) field-observed existing (?:tree is|trees are) protected from new planting\.$/);
  if (match) return t('layout.warning.trees', { count: match[1] });
  match = value.match(/^(\d+) management (?:path is|paths are) reserved before placement\.$/);
  if (match) return t('layout.warning.paths', { count: match[1] });
  match = value.match(/^([\d.]+) m perimeter firebreak reserve excludes ([\d.]+) m² from planting and requires local AIB review\.$/);
  if (match) return t('layout.warning.firebreak', { width: match[1], area: match[2] });
  match = value.match(/^The firebreak width is below the ([\d.]+) m flame-length planning basis\.$/);
  if (match) return t('layout.warning.firebreakWidth', { minimum: match[1] });
  match = value.match(/^Native composition ([\d.]+)% is below the ([\d.]+)% objective target\.$/);
  if (match) return t('layout.warning.native', { value: match[1], target: match[2] });
  match = value.match(/^Nitrogen-fixer composition ([\d.]+)% is below the ([\d.]+)% target\.$/);
  if (match) return t('layout.warning.fixers', { value: match[1], target: match[2] });
  match = value.match(/^(\d+) strata are represented; the biodiversity objective targets (\d+)\.$/);
  if (match) return t('layout.warning.strataTarget', { value: match[1], target: match[2] });
  match = value.match(/^Partial regeneration preserved (\d+) locked (?:plant|plants) unchanged and reflowed (\d+) unlocked positions\.$/);
  if (match) return t('layout.warning.partial', { locked: match[1], unlocked: match[2] });
  match = value.match(/^(\d+) generated candidate (?:was|were) skipped to preserve locked-tree clearance\.$/);
  if (match) return t('layout.warning.lockedSkip', { count: match[1] });
  match = value.match(/^Row (\d+) alone requires ([\d.]+) m³\/h, above the configured source flow\.$/);
  if (match) return t('water.warning.rowFlow', { row: match[1], flow: match[2] });
  match = value.match(/^Peak-day runtime ([\d.]+) h exceeds the configured ([\d.]+) h operating window\.$/);
  if (match) return t('water.warning.runtime', { runtime: match[1], window: match[2] });
  return value;
}
function monthName(month: number) { return ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][month - 1]; }
function isGeometryDrawMode(mode: DrawMode): mode is 'site' | 'hole' | 'exclusion' | 'path' {
  return mode === 'site' || mode === 'hole' || mode === 'exclusion' || mode === 'path';
}
function evidenceUsageKey(item: Evidence) {
  const source = item.source.toLowerCase();
  const context = `${item.version} ${item.resolution ?? ''}`.toLowerCase();
  if (source.includes('elevation')) return 'evidence.usage.terrain';
  if (source.includes('open-meteo') && /radiation|wind|hourly/.test(context)) return 'evidence.usage.solar';
  if (source.includes('open-meteo')) return 'evidence.usage.climate';
  if (source.includes('soilgrids')) return 'evidence.usage.soil';
  if (source.includes('ndvi persistence')) return 'evidence.usage.woodyPersistence';
  if (source.includes('impact observatory')) return 'evidence.usage.landCoverHistory';
  if (source.includes('worldcover')) return 'evidence.usage.worldCover';
  if (source.includes('woody vegetation')) return 'evidence.usage.woodyLayer';
  if (source.includes('sentinel-2')) return 'evidence.usage.opticalWater';
  if (source.includes('sentinel-1')) return 'evidence.usage.radarWater';
  if (source.includes('planetary computer')) return 'evidence.usage.processing';
  if (/natural england|natural resources conservation service|civil protection department/.test(source)) return 'evidence.usage.firebreak';
  if (/agroforestry|almond orchard|alley model|windbreak|management practices/.test(source)) return 'evidence.usage.maintenance';
  return 'evidence.usage.generic';
}
function designSystemDescriptionKey(system: DesignConfiguration['system']) {
  return {
    syntropic: 'design.description.syntropic',
    'alley-cropping': 'design.description.alley',
    'mixed-orchard': 'design.description.mixedOrchard',
    monoculture: 'design.description.monoculture',
    windbreak: 'design.description.windbreak',
    'boundary-buffer': 'design.description.boundary',
  }[system];
}
function speciesDisplayName(species: DesignSpecies, t: (key: string, values?: Record<string, string | number>) => string) {
  const key = `species.name.${species.id}`;
  const translated = t(key);
  return translated === key ? species.commonName : translated;
}
function localizedSuitabilityExplanation(component: SuitabilityComponent, species: DesignSpecies, profile: SiteProfile | null, t: (key: string, values?: Record<string, string | number>) => string) {
  if (component.key === 'safety') return localizedDomainMessage(component.explanation, t);
  if (!profile) return localizedDomainMessage(component.explanation, t);
  if (component.key === 'climate') return t('species.explanation.climate', { observedMin: profile.climate.absoluteMinTemperatureC, observedMax: profile.climate.absoluteMaxTemperatureC, supportedMin: species.minTemperatureC, supportedMax: species.maxTemperatureC });
  if (component.key === 'soil') return profile.soil.ph === null
    ? t('species.explanation.soilUnknown')
    : t('species.explanation.soil', { ph: profile.soil.ph, min: species.phMin, max: species.phMax });
  if (component.key === 'water') return t('species.explanation.water', { rain: profile.climate.annualPrecipitationMm, supportedMin: species.annualRainMinMm, supportedMax: species.annualRainMaxMm, et0: profile.climate.annualEt0Mm, drought: species.droughtTolerance });
  if (component.key === 'native') return t('species.explanation.nativeUnverified', { country: profile.location.countryCode ?? profile.location.displayName });
  if (component.key === 'purpose') return t('species.explanation.purpose', { type: t(species.productiveFromYear !== null ? 'species.productive' : 'species.support'), roles: species.roles.map((role) => localizedEnum(role, t)).join(', ') });
  if (component.key === 'syntropic') return t('species.explanation.syntropic', { stratum: localizedEnum(species.stratum, t), succession: localizedEnum(species.succession, t), fixer: species.nitrogenFixer ? t('species.nitrogenFixerSuffix') : '' });
  if (component.key === 'maintenance') return t('species.explanation.maintenance', { growth: species.growthRate.toFixed(2), drought: species.droughtTolerance, biomass: species.roles.includes('biomass') ? t('species.biomassSuffix') : '' });
  if (component.key === 'evidence') return t('species.explanation.evidence', { count: species.sources.length });
  return localizedDomainMessage(component.explanation, t);
}

function localizedMitigation(
  value: string,
  recommendation: SpeciesRecommendation,
  profile: SiteProfile | null,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const component = recommendation.components.find((item) => item.explanation === value);
  if (component) return localizedSuitabilityExplanation(component, recommendation.species, profile, t);
  if (value === recommendation.species.invasiveNote) {
    const key = `species.invasiveNote.${recommendation.species.id}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return localizedDomainMessage(value, t);
}
function localizedNetworkComponent(value: string, t: (key: string) => string) {
  const key = ({
    'Pressure-compensating emitters': 'water.component.emitters',
    'Lateral take-off connectors': 'water.component.connectors',
    'Lateral flush/end valves': 'water.component.flushValves',
    'Zone isolation valves': 'water.component.zoneValves',
    'Zone pressure regulators': 'water.component.regulators',
    'Main filtration unit': 'water.component.filter',
    'Air release valve': 'water.component.airValve',
    'Irrigation controller': 'water.component.controller',
    'Duty pump allowance': 'water.component.pump',
    'Header tank': 'water.component.tank',
    'Well head and abstraction controls': 'water.component.wellHead',
    'Machinery crossing sleeve': 'water.component.sleeve',
    'Operational crossing sleeve': 'water.component.sleeve',
    'mainline pipe': 'water.component.mainlinePipe',
    'submain pipe': 'water.component.submainPipe',
    'lateral pipe': 'water.component.lateralPipe',
  } as Record<string, string>)[value];
  return key ? t(key) : value;
}
function localizedNetworkSpecification(value: string, t: (key: string, values?: Record<string, string | number>) => string) {
  let match = value.match(/^PE (\d+) mm · (\d+) m coils$/);
  if (match) return t('water.spec.pipeCoils', { diameter: match[1], length: match[2] });
  match = value.match(/^(\d+(?:\.\d+)?) L\/h$/);
  if (match) return t('water.spec.emitterFlow', { flow: match[1] });
  match = value.match(/^(\d+) zones$/);
  if (match) return t('water.spec.zones', { count: match[1] });
  match = value.match(/^(\d+(?:\.\d+)?) m³$/);
  if (match) return t('water.spec.capacity', { value: match[1] });
  const key = ({
    'with grommet': 'water.spec.grommet',
    'one per lateral': 'water.spec.onePerLateral',
    'sized to submain': 'water.spec.sizedSubmain',
    '1 bar downstream': 'water.spec.oneBar',
    'flow-rated disc filter': 'water.spec.discFilter',
    'network high point': 'water.spec.highPoint',
    'verify curve against calculated duty point': 'water.spec.verifyPumpCurve',
    'quote after hydrogeological survey': 'water.spec.afterHydroSurvey',
  } as Record<string, string>)[value];
  return key ? t(key) : value;
}
function localizedVariantName(variant: LayoutVariant, index: number, t: (key: string, values?: Record<string, string | number>) => string) {
  const prefix = t(index === 0 ? 'layout.variantPreferred' : index === 1 ? 'layout.variantSolar' : 'layout.variantField');
  return `${prefix} · ${t(systemTranslationKey(variant.design.system))}`;
}
function localizedVariantDescription(variant: LayoutVariant, t: (key: string, values?: Record<string, string | number>) => string) {
  const extent = variant.design.extent === 'full-field'
    ? t('layout.extentFull')
    : variant.design.extent === 'perimeter-band'
      ? t('layout.extentPerimeter', { value: variant.design.perimeterBandM })
      : t('layout.extentEdges');
  return t('layout.variantDescription', {
    system: t(systemTranslationKey(variant.design.system)),
    extent,
    bearing: Math.round(variant.directionDegrees),
    objective: localizedEnum(variant.design.orientationObjective, t),
  });
}
function localizedIrrigationRecommendation(irrigation: IrrigationEstimate, t: (key: string, values?: Record<string, string | number>) => string) {
  const adjustment = irrigation.satelliteScheduling.adjustmentPercent;
  if (adjustment > 0) return t('water.recommendIncrease', { value: adjustment });
  if (adjustment < 0) return t('water.recommendReduce', { value: Math.abs(adjustment) });
  return t('water.recommendStable');
}
function systemTranslationKey(system: DesignConfiguration['system']) {
  return {
    syntropic: 'system.syntropic',
    'alley-cropping': 'system.alley',
    'mixed-orchard': 'system.mixedOrchard',
    monoculture: 'system.monoculture',
    windbreak: 'system.windbreak',
    'boundary-buffer': 'system.boundary',
  }[system];
}
function stratumOrder(stratum: DesignSpecies['stratum']) { return { ground: 0, low: 1, medium: 2, climber: 3, high: 4, emergent: 5 }[stratum]; }
