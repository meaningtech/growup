import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  CircleDollarSign,
  CircleOff,
  CloudSun,
  Database,
  Download,
  Droplets,
  FlaskConical,
  Layers3,
  Leaf,
  LoaderCircle,
  LogIn,
  LogOut,
  LocateFixed,
  Map as MapIcon,
  MousePointer2,
  PencilRuler,
  Plus,
  Printer,
  Redo2,
  Route,
  Satellite,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sprout,
  Tractor,
  Trash2,
  TreePine,
  Undo2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import { DESIGN_SPECIES_BY_ID } from './data/designSpecies';
import { defaultEconomicConfiguration, normalizeEconomicConfiguration } from './data/economicProfiles';
import { MACHINERY_PRESETS, machineryConfigurationFromPreset, machineryEnvelope } from './data/machinery';
import { growthState } from './lib/growth';
import { DEFAULT_IRRIGATION_CONFIGURATION, normalizeIrrigationConfiguration } from './lib/irrigation';
import { SITE_PROFILE_OVERRIDE_DEFINITIONS, overrideValue } from './lib/siteOverrides';
import { createLocalProjection, haversineM, pointInPolygon, polygonCentroid } from './lib/geometry';
import { DEFAULT_DESIGN_CONFIGURATION, normalizeDesignConfiguration } from './lib/layout';
import { buildOperationalSchedule, type OperationalSchedule } from './lib/schedule';
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
  ProjectRevisionSummary,
  SiteBoundary,
  SiteProfile,
  SiteProfileOverrideField,
  SiteValidation,
  SpeciesRecommendation,
  SuitabilityComponent,
  TreeInstance,
} from './types';

type WorkspaceSection = 'site' | 'profile' | 'species' | 'layout' | 'water' | 'costs';
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
  { id: 'costs', label: 'Costs', icon: CircleDollarSign },
];

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [catalogueStats, setCatalogueStats] = useState<CatalogueStats | null>(null);
  const [site, setSite] = useState<SiteBoundary | null>(null);
  const [siteValidation, setSiteValidation] = useState<SiteValidation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([]);
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
  const [section, setSection] = useState<WorkspaceSection>('site');
  const [drawMode, setDrawMode] = useState<DrawMode>('idle');
  const [draftPoints, setDraftPoints] = useState<Coordinate[]>([]);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
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
  const [showIrrigation, setShowIrrigation] = useState(true);
  const [editingIrrigation, setEditingIrrigation] = useState(false);
  const [busy, setBusy] = useState<string | null>(() => t('busy.loading'));
  const [error, setError] = useState<string | null>(null);
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
  const [clearSiteOpen, setClearSiteOpen] = useState(false);
  const [projectName, setProjectName] = useState(() => readOnboardingPreference(window.localStorage)?.projectName ?? t('project.newTitle'));
  const [projectId, setProjectId] = useState(() => `growup-${crypto.randomUUID().slice(0, 8)}`);
  const [projectRevision, setProjectRevision] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevisionSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
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
  }, [projectName, site, siteProfile, selectedSpeciesIds, designConfiguration, irrigationConfiguration, economicConfiguration, variants, selectedVariantId, timelineYear, irrigation, costs, authUser]);

  useEffect(() => {
    if (!projectNameEditedRef.current) setProjectName(t('project.newTitle'));
  }, [locale, t]);

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
          if (mapElementRef.current) mapElementRef.current.dataset.zoom = String(map.getZoom() ?? '');
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
          setError(t('errors.infrastructureOutside'));
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
    treeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    treeOverlaysRef.current = [];
    if (!selectedVariant || !showPlannedTrees) return;
    for (const tree of selectedVariant.trees) {
      const species = DESIGN_SPECIES_BY_ID.get(tree.speciesId);
      if (!species) continue;
      const state = growthState(species, tree, timelineYear);
      if (!state.active) continue;
      const selected = tree.id === selectedTreeId;
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
      crown.addListener('click', () => {
        setSelectedTreeId(tree.id);
        setTreeSpeciesId(tree.speciesId);
      });
      treeOverlaysRef.current.push(crown);
    }
    return () => treeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
  }, [selectedVariant, timelineYear, selectedTreeId, showPlannedTrees]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    irrigationNetworkOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    irrigationNetworkOverlaysRef.current = [];
    if (!irrigation || !showIrrigation) return;
    for (const line of irrigation.network.lines) {
      const color = line.kind === 'mainline' ? '#1c5f88' : line.kind === 'submain' ? '#278c9e' : line.kind === 'protected-crossing' ? '#f0a536' : '#61b9c7';
      const editable = editingIrrigation && line.kind !== 'protected-crossing';
      const overlay = new maps.Polyline({
        map,
        path: line.points,
        strokeColor: color,
        strokeOpacity: line.kind === 'protected-crossing' ? 1 : 0.9,
        strokeWeight: line.kind === 'mainline' ? 5 : line.kind === 'submain' ? 4 : line.kind === 'protected-crossing' ? 7 : 2,
        clickable: editable,
        editable,
        zIndex: line.kind === 'protected-crossing' ? 33 : 30,
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
        setError(t('errors.infrastructureOutside'));
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
        setError(t('errors.infrastructureOutside'));
        setDrawMode('idle');
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
      const restriction = plantingRestriction(coordinate, site, siteProfile, t);
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
      const restriction = plantingRestriction(coordinate, site, siteProfile, t);
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
    setDrawMode('idle');
    setDraftPoints([]);
    setShowNdmi(false);
    setShowWaterSamples(false);
    setProjectId(`growup-${crypto.randomUUID().slice(0, 8)}`);
    setProjectRevision(0);
    projectRevisionRef.current = 0;
    setRevisions([]);
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
    if (!siteContainsCoordinate(site, coordinate)) return setError(t('errors.infrastructureOutside'));
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
      setError(t('errors.infrastructureOutside'));
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
      variants: variants.map(({ id, name, description, score, metrics }) => ({ id, name, description, score, metrics })),
      selectedVariantId,
      timelineYear,
      irrigation,
      costs,
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
    setDesignConfiguration(normalizeDesignConfiguration(project.designConfiguration));
    setIrrigationConfiguration(normalizeIrrigationConfiguration(project.irrigationConfiguration));
    setEconomicConfiguration(normalizeEconomicConfiguration(project.economicConfiguration, project.siteProfile?.location.countryCode ?? project.economicConfiguration?.countryCode ?? ''));
    setVariants(project.variants);
    setSelectedVariantId(project.selectedVariantId);
    setTimelineYear(project.timelineYear);
    setIrrigation(project.irrigation);
    setCosts(project.costs);
    setSelectedTreeId(null);
    fittedSiteRef.current = null;
    setSection(project.costs ? 'costs' : project.irrigation ? 'water' : project.variants.length ? 'layout' : project.siteProfile ? 'profile' : 'site');
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
    setNotice(t('notices.mapCentredPlace'));
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
    setNotice(t('notices.mapCentredCoordinate'));
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
      metrics: { ...item.metrics, totalTrees: nextTrees.length },
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
  }

  function toggleTreeLock() {
    if (!selectedVariant || !selectedTree) return;
    commitTrees(selectedVariant.trees.map((tree) => tree.id === selectedTree.id ? { ...tree, locked: !tree.locked } : tree));
  }

  async function runBusy<T>(label: string, operation: () => Promise<T>) {
    setBusy(label);
    setError(null);
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
    costs: Boolean(costs),
  };

  return (
    <div className={`app-shell ${onboarding?.status === 'active' ? `onboarding-active onboarding-active-${onboarding.step}` : ''}`}>
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
          {authUser && projects.length > 0 && <label className="project-select"><span className="visually-hidden">{t('auth.projectSelector')}</span><select aria-label={t('auth.projectSelector')} value={projects.some((item) => item.id === projectId) ? projectId : ''} onChange={(event) => void openProject(event.target.value)}><option value="">{t('auth.openProject')}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          {site && <span className={`save-status ${saveStatus}`} data-testid="save-status"><i />{t(`auth.status.${saveStatus}`)}{projectRevision > 0 ? ` · r${projectRevision}` : ''}</span>}
          <label className="language-select"><span className="visually-hidden">{t('language.label')}</span><select aria-label={t('language.label')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((item) => <option key={item.code} value={item.code}>{item.shortLabel}</option>)}</select></label>
          <button className="button ghost tour-trigger" onClick={() => updateOnboarding('active', 'welcome')} title={t('onboarding.restart')}><MapIcon size={16} /> {t('onboarding.tour')}</button>
          <button className="button ai-trigger" onClick={() => setAssistantOpen(true)}><Sparkles size={16} /> {t('actions.ask')}</button>
          <button className="button ghost" onClick={saveProject} disabled={!site || Boolean(busy)}><Save size={16} /> {t('actions.save')}</button>
          <button className="button ghost history-trigger" onClick={() => setHistoryOpen(true)} disabled={!authUser || projectRevision < 1}><Database size={15} /> {t('auth.history')}</button>
          <a className={`button ghost export-action ${!selectedVariant || !authUser ? 'disabled' : ''}`} aria-disabled={!selectedVariant || !authUser} href={selectedVariant && authUser ? `/api/projects/${projectId}/export.geojson` : undefined}><Download size={16} /> GeoJSON</a>
          <a className={`button ghost export-action ${!selectedVariant || !authUser ? 'disabled' : ''}`} aria-disabled={!selectedVariant || !authUser} href={selectedVariant && authUser ? `/api/projects/${projectId}/export.csv` : undefined}><Download size={16} /> CSV</a>
          {authUser ? (
            <button className="user-chip" onClick={logout} aria-label={t('auth.signOut')} title={t('auth.signOut')}>
              {authUser.pictureUrl ? <img src={authUser.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <span>{authUser.name.slice(0, 1).toUpperCase()}</span>}
              <strong>{authUser.name}</strong><LogOut size={14} />
            </button>
          ) : <button className="button auth-trigger" onClick={() => setAuthOpen(true)}><LogIn size={15} /> {t('auth.signIn')}</button>}
        </div>
      </header>

      {recoveryDraft && !site && <div className="recovery-banner" role="status"><span><Save size={16} /><strong>{t('auth.recoveryTitle')}</strong><small>{t('auth.recoveryBody', { name: recoveryDraft.name })}</small></span><button onClick={recoverLocalDraft}>{t('auth.recover')}</button><button onClick={discardLocalDraft}>{t('auth.discard')}</button></div>}

      <aside className="step-rail" aria-label={t('nav.workflow')}>
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <button key={step.id} data-testid={`step-${step.id}`} className={section === step.id ? 'active' : ''} onClick={() => setSection(step.id)}>
              <span className="step-number">{completed[step.id] ? <Check size={12} /> : index + 1}</span>
              <Icon size={18} />
              <span>{t(stepLabelKey(step.id))}</span>
            </button>
          );
        })}
        <div className="rail-data">
          <Database size={16} />
          <strong>{catalogueStats ? compactNumber(catalogueStats.total) : '—'}</strong>
          <span>{t('nav.taxa')}</span>
        </div>
      </aside>

      <main className="workspace">
        <section className={`map-stage ${isGeometryDrawMode(drawMode) ? 'drawing' : ''}`} aria-label={t('map.interactive')}>
          <div ref={mapElementRef} className="map-canvas" />
          {mapError && <div className="map-error"><Satellite size={22} /><strong>{t('map.unavailable')}</strong><span>{mapError}</span></div>}
          {isGeometryDrawMode(drawMode) && <div className="drawing-status" role="status">
            <span><PencilRuler size={15} />{t(`map.drawMode.${drawMode}`)}</span>
            <strong>{t('map.pointsPlaced', { count: draftPoints.length })}</strong>
            <small>{draftPoints.length < (drawMode === 'path' ? 2 : 3) ? t('map.pointsRemaining', { count: (drawMode === 'path' ? 2 : 3) - draftPoints.length }) : t('map.readyToFinish')}</small>
          </div>}
          <div className="map-toolbar">
            <button aria-label={t('map.editSite')} className={drawMode === 'edit-site' ? 'active' : ''} onClick={() => activateDrawMode(drawMode === 'edit-site' ? 'idle' : 'edit-site')} title={t('map.editSite')}><MousePointer2 size={17} /></button>
            <button aria-label={t('map.editConstraints')} className={drawMode === 'edit-constraints' ? 'active' : ''} onClick={() => activateDrawMode(drawMode === 'edit-constraints' ? 'idle' : 'edit-constraints')} title={t('map.editConstraints')}><Route size={17} /></button>
            <button aria-label={t('map.drawSite')} className={drawMode === 'site' ? 'active' : ''} onClick={() => activateDrawMode('site')} title={t('map.drawSite')}><PencilRuler size={17} /></button>
            <button aria-label={t('map.drawHole')} className={drawMode === 'hole' ? 'active' : ''} onClick={() => activateDrawMode('hole')} title={t('map.drawHole')}><CircleOff size={17} /></button>
            <button aria-label={t('map.drawExclusion')} className={drawMode === 'exclusion' ? 'active' : ''} onClick={() => activateDrawMode('exclusion')} title={t('map.drawExclusion')}><Layers3 size={17} /></button>
            <button aria-label={t('map.drawPath')} className={drawMode === 'path' ? 'active' : ''} onClick={() => activateDrawMode('path')} title={t('map.drawPath')}><Route size={17} /></button>
            {isGeometryDrawMode(drawMode) && <button aria-label={t('map.finish')} className="finish" onClick={finishDraft} title={t('map.finish')}><Check size={17} /></button>}
            <span />
            <button aria-label={t('map.layers')} aria-expanded={showLayerPanel} className={showLayerPanel ? 'active layers' : 'layers'} onClick={() => setShowLayerPanel((value) => !value)} title={t('map.layers')}><Layers3 size={17} /></button>
            <button aria-label={t('map.editIrrigation')} className={editingIrrigation ? 'active water' : ''} onClick={() => { setShowIrrigation(true); setEditingIrrigation((value) => !value); }} disabled={!irrigation} title={t('map.editIrrigation')}><Route size={17} /></button>
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
            <MapLayerToggle icon={Droplets} tone="irrigation" active={showIrrigation} disabled={!irrigation} label={t('map.layerIrrigation')} hint={t('map.layerIrrigationHint')} toggleLabel={t('map.toggleIrrigation')} onToggle={() => { const next = !showIrrigation; setShowIrrigation(next); if (!next) setEditingIrrigation(false); }} />
            <small>{t('map.evidenceLayers')}</small>
            <MapLayerToggle icon={TreePine} tone="vegetation" active={showExistingVegetation} disabled={!siteProfile?.satellite.existingVegetation.patches.length} label={t('map.layerVegetation')} hint={t('map.layerVegetationHint')} toggleLabel={t('map.toggleVegetation')} onToggle={() => setShowExistingVegetation((value) => !value)} />
            <MapLayerToggle icon={Waves} tone="ndmi" active={showNdmi} disabled={!siteProfile?.satellite.optical.ndmiPreviewUrl} label={t('map.layerNdmi')} hint={t('map.layerNdmiHint')} toggleLabel={t('map.toggleNdmi')} onToggle={() => setShowNdmi((value) => !value)} />
            <MapLayerToggle icon={Droplets} tone="water" active={showWaterSamples} disabled={!siteProfile?.satellite.optical.waterSamples.length} label={t('map.layerWater')} hint={t('map.layerWaterHint')} toggleLabel={t('map.toggleWater')} onToggle={() => setShowWaterSamples((value) => !value)} />
          </div>}
          {editingIrrigation && irrigation && <div className="irrigation-edit-status"><Route size={15} /><span><strong>{t('map.editIrrigation')}</strong><small>{t('map.editIrrigationHint')}</small></span></div>}
          {selectedVariant && (
            <div className="timeline-control">
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
            onLocationQuery={setLocationQuery}
            onLocationSearch={searchLocation}
            onLocationSelect={focusLocation}
            onCoordinate={useEnteredCoordinate}
            onUndo={undoSite}
            onRedo={redoSite}
            canUndo={siteUndoRef.current.length > 0}
            canRedo={siteRedoRef.current.length > 0}
            busy={Boolean(busy)}
          />}
          {section === 'profile' && <ProfilePanel profile={siteProfile} hasSite={Boolean(site)} onAnalyze={analyzeSite} onOpenSite={() => setSection('site')} onShowNdmi={() => { setShowNdmi(true); setShowWaterSamples(true); }} onOverride={overrideSiteProfile} />}
          {section === 'species' && <SpeciesPanel recommendations={recommendations} siteProfile={siteProfile} selectedIds={selectedSpeciesIds} onToggle={toggleSpecies} onGenerate={generateDesign} query={catalogueQuery} onQuery={setCatalogueQuery} onSearch={searchCatalogue} catalogueResults={catalogueResults} stats={catalogueStats} design={designConfiguration} onDesign={updateDesignConfiguration} />}
          {section === 'layout' && <LayoutPanel variants={variants} selectedVariant={selectedVariant} onSelect={setSelectedVariantId} selectedTree={selectedTree} onTreeSelect={setSelectedTreeId} selectedSpecies={selectedSpecies} treeSpeciesId={treeSpeciesId} onTreeSpecies={setTreeSpeciesId} drawMode={drawMode} onMode={activateDrawMode} onDelete={deleteSelectedTree} onLock={toggleTreeLock} onUndo={undoTrees} onRedo={redoTrees} canUndo={undoRef.current.length > 0} canRedo={redoRef.current.length > 0} onRegenerate={regenerateUnlockedDesign} onCalculate={calculateWaterAndCosts} onOpenSpecies={() => setSection('species')} />}
          {section === 'water' && <WaterPanel site={site} irrigation={irrigation} configuration={irrigationConfiguration} onConfiguration={setIrrigationConfiguration} profile={siteProfile} canCalculate={Boolean(selectedVariant && siteProfile)} onCalculate={calculateWaterAndCosts} onPrepare={() => setSection(selectedVariant ? 'layout' : 'species')} onCosts={() => setSection('costs')} onShowZones={() => { setShowWaterSamples(true); setShowNdmi(false); }} editingIrrigation={editingIrrigation} onEditIrrigation={() => { setShowIrrigation(true); setEditingIrrigation((value) => !value); }} />}
          {section === 'costs' && <CostsPanel costs={costs} irrigation={irrigation} species={selectedSpecies} configuration={economicConfiguration} onConfiguration={(value) => { setEconomicConfiguration(normalizeEconomicConfiguration(value, siteProfile?.location.countryCode ?? value.countryCode)); setIrrigation(null); setCosts(null); }} canCalculate={Boolean(selectedVariant && siteProfile)} onCalculate={calculateWaterAndCosts} onPrepare={() => setSection(selectedVariant ? 'layout' : 'species')} onSchedule={() => setScheduleOpen(true)} />}
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

      {clearSiteOpen && <ClearSiteDialog onCancel={() => setClearSiteOpen(false)} onConfirm={clearSite} />}

      {historyOpen && <ProjectHistoryPanel revisions={revisions} onRestore={restoreRevision} onClose={() => setHistoryOpen(false)} />}

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

      {(busy || error || notice) && (
        <div className={`toast ${error ? 'error' : notice ? 'success' : ''}`} role="status">
          {busy ? <LoaderCircle className="spin" size={18} /> : error ? <span className="toast-symbol">!</span> : <Check size={18} />}
          <span>{busy ?? error ?? notice}</span>
          {!busy && <button onClick={() => { setError(null); setNotice(null); }}>×</button>}
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
    {preference.step === 'location' && <button className="onboarding-primary" onClick={onBoundary}>{t('onboarding.drawBoundary')}<ChevronRight size={16} /></button>}
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
  tone: 'boundary' | 'exclusions' | 'paths' | 'infrastructure' | 'observed' | 'trees' | 'machinery' | 'irrigation' | 'vegetation' | 'ndmi' | 'water';
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
    renderGoogleSignIn(buttonRef.current, clientId, locale, onCredential).catch((error) => setIdentityError(messageOf(error)));
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
  const prompts = [
    t('assistant.promptProductive'),
    t('assistant.promptWater'),
    t('assistant.promptExplain'),
  ];
  return (
    <aside className="assistant-panel" aria-label={t('assistant.aria')}>
      <header>
        <span className="assistant-mark"><Sparkles size={18} /></span>
        <span><small>{t('assistant.internal')}</small><strong>{t('actions.ask')}</strong></span>
        <button aria-label={t('assistant.close')} onClick={onClose}><X size={17} /></button>
      </header>
      <div className="assistant-body">
        <div className="assistant-trust"><ShieldCheck size={16} /><span><strong>{t('assistant.validated')}</strong><small>{t('assistant.validatedBody')}</small></span></div>
        {!configured && <div className="assistant-warning">{t('assistant.unavailable')}</div>}
        {!proposal && !busy && <div className="assistant-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => { onInput(prompt); onAsk(prompt); }} disabled={!configured}>{prompt}</button>)}</div>}
        {busy && <div className="assistant-thinking"><LoaderCircle className="spin" size={20} /><span>{t('assistant.reading')}</span></div>}
        {error && <div className="assistant-error"><strong>{t('assistant.notApplied')}</strong><span>{localizedDomainMessage(error, t)}</span></div>}
        {proposal && <div className="assistant-proposal" data-testid="assistant-proposal">
          <div className="assistant-answer"><small>{t('assistant.proposal')}</small><strong>{proposal.summary}</strong><p>{proposal.rationale}</p></div>
          {proposal.actions.length > 0 && <div className="assistant-actions"><small>{t('assistant.awaitingConfirmation')}</small>{proposal.actions.map((action, index) => <span key={`${action.type}-${index}`}><i>{index + 1}</i>{assistantActionLabel(action, t)}</span>)}</div>}
          {proposal.warnings.length > 0 && <div className="assistant-proposal-warnings">{proposal.warnings.map((warning) => <span key={warning}>• {warning}</span>)}</div>}
          <div className="assistant-confirm"><button onClick={onDismiss}>{t('assistant.dismiss')}</button>{proposal.requiresConfirmation ? <button className="confirm" onClick={onApply} disabled={busy}><ShieldCheck size={15} /> {t('assistant.apply')}</button> : <button className="confirm" onClick={onDismiss}>{t('assistant.done')}</button>}</div>
        </div>}
      </div>
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
    <div className="panel-body">
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
      <button className="button primary wide analyse-site-action" onClick={onAnalyze} disabled={!site || !validation?.valid || busy}>{profile ? t('actions.refresh') : t('actions.analyse')}<ChevronRight size={18} /></button>
      <p className="fine-print">{t('site.executionNote')}</p>
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

function ProjectHistoryPanel({ revisions, onRestore, onClose }: { revisions: ProjectRevisionSummary[]; onRestore: (revision: number) => Promise<void>; onClose: () => void }) {
  const { t, locale } = useI18n();
  return <div className="modal-backdrop" role="presentation"><section className="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title">
    <header><span><small>{t('auth.historyEyebrow')}</small><h2 id="history-title">{t('auth.historyTitle')}</h2></span><button aria-label={t('auth.closeHistory')} onClick={onClose}><X size={18} /></button></header>
    <p>{t('auth.historyBody')}</p>
    <div className="revision-list">{revisions.map((revision, index) => <article key={revision.revisionId}>
      <span className="revision-number">r{revision.revision}</span>
      <span><strong>{revision.name}</strong><small>{shortDate(revision.createdAt, locale)} · {t('auth.revisionTrees', { count: revision.treeCount })}{revision.calculationRunId ? ` · ${t('auth.calculationCaptured')}` : ''}</small><code>{revision.contentHash.slice(0, 12)}</code></span>
      <button disabled={index === 0} onClick={() => void onRestore(revision.revision)}>{index === 0 ? t('auth.currentRevision') : t('auth.restoreRevision')}</button>
    </article>)}</div>
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
      <div className="schedule-management">{schedule.managementPhases.map((phase) => <article key={phase}><small>{t(`schedule.phase.${phase}.years`)}</small><strong>{t(`schedule.phase.${phase}.title`)}</strong><p>{t(`schedule.phase.${phase}.body`)}</p><em>{t(`schedule.management.system.${variant.design.system}`)}</em><span>□ {t('schedule.recordActuals')}</span></article>)}</div>
      {variant.machinery.enabled && <div className="schedule-machinery"><Tractor size={18} /><span><strong>{t('schedule.machineryTitle')}</strong><small>{t('schedule.machineryBody', { corridors: schedule.summary.machineryCorridorCount, area: formatNumber(schedule.summary.machineryReservedAreaM2, 0), headland: formatNumber(schedule.summary.machineryHeadlandDepthM, 1) })}</small></span></div>}
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
  return <section className="schedule-section"><header><i>{number}</i><span><h2>{title}</h2><p>{subtitle}</p></span></header>{children}</section>;
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

function ProfilePanel({ profile, hasSite, onAnalyze, onOpenSite, onShowNdmi, onOverride }: { profile: SiteProfile | null; hasSite: boolean; onAnalyze: () => void; onOpenSite: () => void; onShowNdmi: () => void; onOverride: (input: { field: SiteProfileOverrideField; value: string; reason: string; sourceLabel: string; observedAt: string }) => Promise<void> }) {
  const { t, locale } = useI18n();
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
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('profile.eyebrow')}</span><h1>{profile.location.municipality ?? profile.location.region ?? profile.location.countryCode ?? t('profile.locationUnknown')}</h1><p>{profile.location.displayName}</p></div>
      <div className="metric-grid">
        <Metric label={t('profile.elevation')} value={`${formatNumber(profile.terrain.elevationMeanM, 0)} m`} detail={`${profile.terrain.elevationMinM}–${profile.terrain.elevationMaxM} m`} />
        <Metric label={t('profile.slope')} value={`${profile.terrain.slopePercent}%`} detail={t('profile.aspect', { value: localizedEnum(profile.terrain.aspectLabel, t) })} />
        <Metric label={t('profile.rain')} value={`${formatNumber(profile.climate.annualPrecipitationMm, 0)} mm`} detail={t('profile.annualMean')} />
        <Metric label="ET₀" value={`${formatNumber(profile.climate.annualEt0Mm, 0)} mm`} detail={t('profile.aridity', { value: profile.climate.aridityIndex })} />
        <Metric label={t('profile.solar')} value={profile.solar.status === 'available' ? `${formatNumber(profile.solar.annualGlobalHorizontalKwhM2, 0)} kWh/m²` : '—'} detail={t('profile.annualHorizontal')} />
        <Metric label={t('profile.wind')} value={profile.solar.prevailingWindDirectionLabel ? localizedEnum(profile.solar.prevailingWindDirectionLabel, t) : '—'} detail={profile.solar.meanWindSpeedMs === null ? t('status.unavailable') : t('profile.windMean', { value: profile.solar.meanWindSpeedMs })} />
      </div>
      <div className="evidence-card soil-card">
        <div className="card-heading"><div><FlaskConical size={17} /><span><small>SoilGrids · 0–5 cm</small><strong>{profile.soil.textureClass ? localizedEnum(profile.soil.textureClass, t) : t('profile.fieldTestRequired')}</strong></span></div><StatusPill status={profile.soil.status} /></div>
        <div className="soil-values"><span><small>pH</small><strong>{profile.soil.ph ?? '—'}</strong></span><span><small>{t('profile.sand')}</small><strong>{profile.soil.sandPercent ?? '—'}%</strong></span><span><small>{t('profile.clay')}</small><strong>{profile.soil.clayPercent ?? '—'}%</strong></span><span><small>{t('profile.soc')}</small><strong>{profile.soil.organicCarbonGKg ?? '—'}</strong></span></div>
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
      {profile.warnings.length > 0 && <div className="warning-list">{profile.warnings.map((warning) => <p key={warning}>• {localizedDomainMessage(warning, t)}</p>)}</div>}
      <div className="source-traceability" data-testid="evidence-traceability">
        <div className="card-heading"><div><Database size={17} /><span><small>{t('evidence.traceability')}</small><strong>{t('evidence.howUsed')}</strong></span></div></div>
        {[profile.terrain.evidence, profile.climate.evidence, profile.solar.evidence, profile.soil.evidence, ...profile.satellite.existingVegetation.evidence, ...profile.satellite.evidence].map((item, index) => {
          const usageKey = evidenceUsageKey(item);
          return <article className="evidence-use-card" key={`${item.source}-${item.version}-${index}`}>
            <header><strong>{item.source}</strong><span className={`evidence-confidence ${item.confidence}`}>{t(`status.${item.confidence}`)}</span></header>
            <dl>
              <div><dt>{t('evidence.dataUsed')}</dt><dd>{t(`${usageKey}.data`)}</dd></div>
              <div><dt>{t('evidence.calculation')}</dt><dd>{t(`${usageKey}.calculation`)}</dd></div>
              <div><dt>{t('evidence.decision')}</dt><dd>{t(`${usageKey}.decision`)}</dd></div>
            </dl>
            <footer><span>{item.version}</span><span>{item.resolution ?? t('evidence.resolutionUnavailable')}</span><time dateTime={item.observedAt}>{shortDate(item.observedAt, locale)}</time></footer>
          </article>;
        })}
      </div>
    </div>
  );
}

function SpeciesPanel({ recommendations, siteProfile, selectedIds, onToggle, onGenerate, query, onQuery, onSearch, catalogueResults, stats, design, onDesign }: { recommendations: SpeciesRecommendation[]; siteProfile: SiteProfile | null; selectedIds: string[]; onToggle: (id: string) => void; onGenerate: () => void; query: string; onQuery: (value: string) => void; onSearch: (filters: CatalogueFilters) => void; catalogueResults: CatalogueSpecies[]; stats: CatalogueStats | null; design: DesignConfiguration; onDesign: (value: DesignConfiguration) => void }) {
  const { t } = useI18n();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
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
  const machineEnvelope = machineryEnvelope(design.machinery);
  const objectives = [
    { key: 'production', label: t('species.objective.production') },
    { key: 'biodiversity', label: t('species.objective.biodiversity') },
    { key: 'nativeHabitat', label: t('species.objective.nativeHabitat') },
    { key: 'waterResilience', label: t('species.objective.waterResilience') },
    { key: 'lowMaintenance', label: t('species.objective.lowMaintenance') },
  ] as const;
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('species.eyebrow')}</span><h1>{t('species.title')}</h1><p>{t('species.selected', { count: selectedIds.length })}</p></div>
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
      <div className="machinery-config" data-testid="machinery-config">
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
      </div>
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
      <button className="button primary wide sticky-action generate-design-action" onClick={onGenerate} disabled={selectedIds.length < minimumSpecies}>{t('actions.generate')} <ChevronRight size={18} /></button>
    </div>
  );
}

function LayoutPanel({ variants, selectedVariant, onSelect, selectedTree, onTreeSelect, selectedSpecies, treeSpeciesId, onTreeSpecies, drawMode, onMode, onDelete, onLock, onUndo, onRedo, canUndo, canRedo, onRegenerate, onCalculate, onOpenSpecies }: { variants: LayoutVariant[]; selectedVariant: LayoutVariant | null; onSelect: (id: string) => void; selectedTree: TreeInstance | null; onTreeSelect: (id: string | null) => void; selectedSpecies: DesignSpecies[]; treeSpeciesId: string; onTreeSpecies: (id: string) => void; drawMode: DrawMode; onMode: (mode: DrawMode) => void; onDelete: () => void; onLock: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onRegenerate: () => void; onCalculate: () => void; onOpenSpecies: () => void }) {
  const { t } = useI18n();
  if (!selectedVariant) return <EmptyState icon={TreePine} title={t('layout.emptyTitle')} body={t('layout.emptyBody')} action={t('layout.openSpecies')} onAction={onOpenSpecies} />;
  const selectedTreeSpecies = selectedTree ? DESIGN_SPECIES_BY_ID.get(selectedTree.speciesId) : null;
  const selectedTreeGrowth = selectedTree && selectedTreeSpecies ? growthState(selectedTreeSpecies, selectedTree, selectedVariant.design.analysisYear) : null;
  return (
    <div className="panel-body">
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
      <div className="edit-toolbar"><button onClick={onUndo} disabled={!canUndo}><Undo2 size={15} /> {t('actions.undo')}</button><button onClick={onRedo} disabled={!canRedo}><Redo2 size={15} /> {t('actions.redo')}</button><button className={drawMode === 'add-tree' ? 'active' : ''} onClick={() => onMode(drawMode === 'add-tree' ? 'idle' : 'add-tree')}><Plus size={15} /> {t('actions.add')}</button><button onClick={onRegenerate} disabled={!selectedVariant.trees.some((tree) => tree.locked)}><Sparkles size={15} /> {t('actions.regenerateUnlocked')}</button></div>
      <label className="select-label"><span>{t('layout.manualSpecies')}</span><select value={treeSpeciesId} onChange={(event) => onTreeSpecies(event.target.value)}>{selectedSpecies.map((species) => <option key={species.id} value={species.id}>{speciesDisplayName(species, t)} — {localizedEnum(species.stratum, t)}</option>)}</select></label>
      <label className="select-label"><span>{t('layout.selectTree')}</span><select aria-label={t('layout.selectTree')} value={selectedTree?.id ?? ''} onChange={(event) => onTreeSelect(event.target.value || null)}><option value="">{t('layout.selectTreePlaceholder')}</option>{selectedVariant.trees.map((tree) => <option key={tree.id} value={tree.id}>{tree.id}</option>)}</select></label>
      {selectedTree ? <div className="selected-tree-card"><span className="tree-dot" style={{ background: selectedTreeSpecies?.color }} /><div><small>{t('layout.selectedIndividual')}</small><strong>{selectedTreeSpecies ? speciesDisplayName(selectedTreeSpecies, t) : selectedTree.speciesId}</strong><span>{t(selectedTree.locked ? 'layout.positionLocked' : 'layout.positionEditable')} · {t('layout.plantedYear', { year: selectedTree.plantedYear })}</span></div>{selectedTreeGrowth && <div className="tree-growth-model" data-testid="tree-growth-model"><span><small>{t('layout.heightRange')}</small><strong>{formatNumber(selectedTreeGrowth.uncertainty.heightLowM, 1)}–{formatNumber(selectedTreeGrowth.heightM, 1)}–{formatNumber(selectedTreeGrowth.uncertainty.heightHighM, 1)} m</strong></span><span><small>{t('layout.crownRange')}</small><strong>{formatNumber(selectedTreeGrowth.uncertainty.crownDiameterLowM, 1)}–{formatNumber(selectedTreeGrowth.crownDiameterM, 1)}–{formatNumber(selectedTreeGrowth.uncertainty.crownDiameterHighM, 1)} m</strong></span><p>{t('layout.growthModel', { version: selectedTreeGrowth.model.version, confidence: translatedStatus(selectedTreeGrowth.model.confidence, t) })}</p></div>}<div className="tree-actions"><button onClick={onLock}>{t(selectedTree.locked ? 'actions.unlock' : 'actions.lock')}</button><button onClick={() => onMode('move-tree')} disabled={selectedTree.locked}>{t('actions.move')}</button><button className="danger" aria-label={t('actions.remove')} onClick={onDelete}><Trash2 size={14} /></button></div></div> : <div className="inline-empty">{t('layout.selectCrown')}</div>}
      {selectedVariant.warnings.length > 0 && <div className="warning-list">{selectedVariant.warnings.map((warning) => <p key={warning}>• {localizedDomainMessage(warning, t)}</p>)}</div>}
      <button className="button primary wide calculate-design-action" onClick={onCalculate}>{t('actions.calculate')} <ChevronRight size={18} /></button>
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
  return (
    <div className="panel-body">
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
        {irrigation.network.manualOverrideCount > 0 && <p>{t('water.manualOverrides', { count: irrigation.network.manualOverrideCount })}</p>}
        {irrigation.network.warnings.map((warning) => <p className="hydraulic-warning" key={warning}>• {localizedDomainMessage(warning, t)}</p>)}
      </div>
      <div className="network-lines"><div className="card-heading"><div><Route size={17} /><span><small>{t('water.lineScheduleEyebrow')}</small><strong>{t('water.lineSchedule')}</strong></span></div><button className={editingIrrigation ? 'line-edit active' : 'line-edit'} onClick={onEditIrrigation}>{t(editingIrrigation ? 'water.finishLineEdit' : 'water.editLines')}</button></div><p className="line-edit-hint">{t('water.editLinesHint')}</p>{(['mainline', 'submain', 'lateral', 'protected-crossing'] as const).map((kind) => {
        const lines = irrigation.network.lines.filter((line) => line.kind === kind);
        if (!lines.length) return null;
        return <div key={kind}><span><i className={kind} /><strong>{t(`water.line.${kind}`)}</strong><small>{t('water.lineCountLength', { count: lines.length, length: formatNumber(lines.reduce((sum, line) => sum + line.lengthM, 0), 0) })}</small></span><span>{[...new Set(lines.map((line) => `${line.diameterMm} mm`))].join(' · ')}</span></div>;
      })}</div>
      <div className="network-bom" data-testid="irrigation-bom"><div className="card-heading"><div><Database size={17} /><span><small>{t('water.bomEyebrow')}</small><strong>{t('water.bomTitle')}</strong></span></div></div><div className="network-bom-head"><span>{t('water.component')}</span><span>{t('water.measured')}</span><span>{t('water.purchase')}</span></div>{irrigation.network.components.map((component) => <div className="network-bom-row" key={component.id}><span><strong>{localizedNetworkComponent(component.label, t)}</strong><small>{localizedNetworkSpecification(component.specification, t)}</small></span><span>{formatNumber(component.measuredQuantity, component.unit === 'm' ? 1 : 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span><span>{formatNumber(component.purchaseQuantity, component.unit === 'm' ? 0 : 0)} {component.unit === 'm' ? 'm' : t('water.each')}</span></div>)}</div>
      <div className="monthly-chart"><div className="card-heading"><div><Droplets size={17} /><span><small>{t('water.monthlyDemand')}</small><strong>{t('water.monthlyUnit')}</strong></span></div></div><div className="bars">{irrigation.monthly.map((month) => <div key={month.month}><span style={{ height: `${Math.max(3, month.grossM3 / maxMonthly * 100)}%` }} title={`${month.grossM3} m³`} /><small>{monthName(month.month)}</small></div>)}</div></div>
      <div className="satellite-schedule"><div><Satellite size={18} /><span><small>{t('water.satelliteSchedule')}</small><strong>{t('water.nextPulse', { value: signed(irrigation.satelliteScheduling.adjustmentPercent) })}</strong></span><StatusPill status={irrigation.satelliteScheduling.confidence} /></div><p>{localizedIrrigationRecommendation(irrigation, t)}</p><div className="priority-counts"><span className="high">{irrigation.satelliteScheduling.highPrioritySamples} {t('water.priorityHigh')}</span><span className="medium">{irrigation.satelliteScheduling.mediumPrioritySamples} {t('water.priorityMonitor')}</span><span className="low">{irrigation.satelliteScheduling.lowPrioritySamples} {t('water.priorityLow')}</span></div><button className="text-button" onClick={onShowZones}>{t('water.showZones')} <ChevronRight size={14} /></button></div>
      <div className="cost-breakdown"><Row label={t('water.water')} value={currency(irrigation.annualOperation.waterCost, irrigation.economics)} /><Row label={t('water.pumping', { value: formatNumber(irrigation.annualOperation.pumpingKwh, 0) })} value={currency(irrigation.annualOperation.energyCost, irrigation.economics)} /><Row label={t('water.systemCare', { hours: formatNumber(irrigation.annualOperation.managementLaborHours, 1) })} value={currency(irrigation.annualOperation.managementLaborCost, irrigation.economics)} /><Row label={t('water.annualMaintenance')} value={currency(irrigation.annualOperation.maintenanceCost, irrigation.economics)} /><Row label={t('water.installationMaterials')} value={currency(irrigation.installation.materialsCost, irrigation.economics)} strong /><Row label={t('water.installationLabour', { hours: irrigation.installation.laborHours })} value={currency(irrigation.installation.laborCost, irrigation.economics)} /></div>
      {Boolean(profile?.satellite.limitations.length) && <p className="fine-print">{t('water.satelliteLimitation')}</p>}
      <button className="button primary wide" onClick={onCosts}>{t('water.reviewCosts')} <ChevronRight size={18} /></button>
    </div>
  );
}

function CostsPanel({ costs, irrigation, species, configuration, onConfiguration, canCalculate, onCalculate, onPrepare, onSchedule }: { costs: EstablishmentCost | null; irrigation: IrrigationEstimate | null; species: DesignSpecies[]; configuration: EconomicConfiguration; onConfiguration: (value: EconomicConfiguration) => void; canCalculate: boolean; onCalculate: () => void; onPrepare: () => void; onSchedule: () => void }) {
  const { t, locale } = useI18n();
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
    <small>{t('costs.exchangeBasis', { rate: formatNumber(configuration.exchangeRateToLocal, 4), currency: configuration.currencyCode, date: shortDate(configuration.sourceObservedAt, locale), confidence: translatedStatus(configuration.confidence, t) })}</small>
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
    <div className="panel-body">
      {rateConfiguration}
      {costs.economics.missingLocalRates.length > 0 && <div className="estimate-partial"><strong>{t('costs.partialTitle')}</strong><span>{t('costs.partialBody')}</span></div>}
      <div className="cost-scope-grid">
        <div className="total-cost"><small>{t(costs.economics.missingLocalRates.length ? 'costs.partialEstablishment' : 'costs.establishment')}</small><strong>{currency(costs.totalCost, costs.economics)}</strong><span>{t('costs.capexDetail')}</span></div>
        <div className="total-cost active"><small>{t('costs.activeSystem', { year: costs.activeSystem.designYear })}</small><strong>{currency(costs.activeSystem.totalReplacementCost, costs.economics)}</strong><span>{t('costs.activeSystemDetail', { active: costs.activeSystem.activePlantCount, inactive: costs.activeSystem.inactivePlantCount })}</span></div>
      </div>
      <CostTimelineChart costs={costs} irrigation={irrigation} />
      <div className="cost-breakdown large"><Row label={t('costs.plants')} value={currency(costs.plantPurchaseCost, costs.economics)} /><Row label={t('costs.labourHours', { label: t('costs.labour'), hours: formatNumber(costs.plantingLaborHours, 1) })} value={currency(costs.plantingLaborCost, costs.economics)} /><Row label={t('costs.protection')} value={currency(costs.protectionAndStakesCost, costs.economics)} /><Row label={t('costs.irrigation')} value={currency(costs.irrigationInstallationCost, costs.economics)} strong /><Row label={t('costs.annualWaterYear', { year: irrigation.designYear })} value={t('costs.perYear', { value: currency(irrigation.annualOperation.totalCost, costs.economics) })} strong /></div>
      <div className="cost-table"><div className="cost-table-head"><span>{t('costs.species')}</span><span>{t('costs.quantity')}</span><span>{t('costs.plant')}</span><span>{t('costs.labourShort')}</span><span>{t('costs.total')}</span></div>{costs.bySpecies.map((item) => {
        const entry = speciesMap.get(item.speciesId);
        return <div className="cost-table-row" key={item.speciesId}><span><strong>{entry ? speciesDisplayName(entry, t) : item.speciesId}</strong><i>{entry?.scientificName}</i></span><span>{item.count}</span><span>{currency(item.unitPlantCost, costs.economics)}</span><span>{formatNumber(item.unitLaborHours, 2)} h</span><span>{currency(item.subtotalCost, costs.economics)}</span></div>;
      })}</div>
      <div className="source-note"><Database size={17} /><div><strong>{t('costs.priceBasis')}</strong><span>{localizedEconomicSummary(costs.economics.sourceSummary, t)}</span></div></div>
      <button className="button schedule-button wide" data-testid="open-operational-schedule" onClick={onSchedule}><ClipboardCheck size={17} /> {t('schedule.open')}</button>
      <button className="button primary wide" onClick={onCalculate}>{t('costs.recalculate')} <ChevronRight size={18} /></button>
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

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function Index({ label, value }: { label: string; value: number }) { return <span><small>{label}</small><strong>{value.toFixed(3)}</strong></span>; }
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={strong ? 'strong' : ''}><span>{label}</span><strong>{value}</strong></div>; }
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
function plantingRestriction(coordinate: Coordinate, site: SiteBoundary | null, profile: SiteProfile | null, t: (key: string, values?: Record<string, string | number>) => string) {
  if (!site) return t('errors.selectSite');
  if (!siteContainsCoordinate(site, coordinate)) return t('errors.plantOutside');
  if (distanceToSiteBoundaryM(site, coordinate) < site.setbackM) return t('errors.boundarySetback', { value: site.setbackM });
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
  if (component.key === 'water') return t('species.explanation.water', { rain: profile.climate.annualPrecipitationMm, et0: profile.climate.annualEt0Mm, drought: species.droughtTolerance });
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
