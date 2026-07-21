import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
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
  Redo2,
  RotateCcw,
  Route,
  Satellite,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sprout,
  Trash2,
  TreePine,
  Undo2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import { DESIGN_SPECIES_BY_ID } from './data/designSpecies';
import { growthState } from './lib/growth';
import { createLocalProjection, pointInPolygon, polygonCentroid } from './lib/geometry';
import { DEFAULT_DESIGN_CONFIGURATION, normalizeDesignConfiguration } from './lib/layout';
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
import type {
  AssistantAction,
  AssistantProjectContext,
  AssistantProposal,
  CatalogueSpecies,
  Coordinate,
  DesignConfiguration,
  DesignSpecies,
  EstablishmentCost,
  IrrigationEstimate,
  LayoutVariant,
  LocationSearchResult,
  ProjectState,
  SiteBoundary,
  SiteProfile,
  SiteValidation,
  SpeciesRecommendation,
  TreeInstance,
} from './types';

type WorkspaceSection = 'site' | 'profile' | 'species' | 'layout' | 'water' | 'costs';
type DrawMode = 'idle' | 'site' | 'hole' | 'exclusion' | 'path' | 'access-point' | 'water-point' | 'existing-tree' | 'edit-site' | 'edit-constraints' | 'add-tree' | 'move-tree';

type AppConfig = {
  googleMapsApiKey: string;
  defaultSite: SiteBoundary;
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
};

type AuthSession = { authenticated: boolean; configured: boolean; user: AuthUser | null };

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
  const [locationQuery, setLocationQuery] = useState('Ragusa Ibla');
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([]);
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null);
  const [recommendations, setRecommendations] = useState<SpeciesRecommendation[]>([]);
  const [selectedSpeciesIds, setSelectedSpeciesIds] = useState<string[]>([]);
  const [designConfiguration, setDesignConfiguration] = useState<DesignConfiguration>(DEFAULT_DESIGN_CONFIGURATION);
  const [variants, setVariants] = useState<LayoutVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [timelineYear, setTimelineYear] = useState(5);
  const [irrigation, setIrrigation] = useState<IrrigationEstimate | null>(null);
  const [costs, setCosts] = useState<EstablishmentCost | null>(null);
  const [section, setSection] = useState<WorkspaceSection>('site');
  const [drawMode, setDrawMode] = useState<DrawMode>('idle');
  const [draftPoints, setDraftPoints] = useState<Coordinate[]>([]);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [treeSpeciesId, setTreeSpeciesId] = useState<string>('');
  const [showNdmi, setShowNdmi] = useState(false);
  const [showWaterSamples, setShowWaterSamples] = useState(false);
  const [showExistingVegetation, setShowExistingVegetation] = useState(true);
  const [busy, setBusy] = useState<string | null>('Loading Growaf');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [catalogueQuery, setCatalogueQuery] = useState('Quercus');
  const [catalogueResults, setCatalogueResults] = useState<CatalogueSpecies[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantProposal, setAssistantProposal] = useState<AssistantProposal | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [projectId] = useState(() => `ragusa-ibla-${crypto.randomUUID().slice(0, 8)}`);
  const createdAtRef = useRef(new Date().toISOString());
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const boundaryRef = useRef<any[]>([]);
  const exclusionsRef = useRef<any[]>([]);
  const existingVegetationRef = useRef<any[]>([]);
  const draftOverlayRef = useRef<any>(null);
  const treeOverlaysRef = useRef<any[]>([]);
  const waterOverlaysRef = useRef<any[]>([]);
  const ndmiOverlayRef = useRef<any>(null);
  const mapClickRef = useRef<(coordinate: Coordinate) => void>(() => undefined);
  const undoRef = useRef<TreeInstance[][]>([]);
  const redoRef = useRef<TreeInstance[][]>([]);
  const siteUndoRef = useRef<SiteBoundary[]>([]);
  const siteRedoRef = useRef<SiteBoundary[]>([]);
  const recommendationObjectiveRef = useRef(JSON.stringify(DEFAULT_DESIGN_CONFIGURATION.objectives));

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
        setSite(normalizeSiteBoundary(appConfig.defaultSite));
        setCatalogueStats(stats);
        setAuthUser(session.user);
        setBusy(null);
      })
      .catch((loadError) => {
        setError(messageOf(loadError));
        setBusy(null);
      });
  }, []);

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
    if (!config || !site || !mapElementRef.current || mapRef.current) return;
    loadGoogleMaps(config.googleMapsApiKey)
      .then((maps) => {
        const center = centroid(site.polygon);
        const map = new maps.Map(mapElementRef.current, {
          center,
          zoom: 18,
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
        mapRef.current = map;
        setMapError(null);
        setSite((current) => current ? cloneSite(current) : current);
      })
      .catch((mapsError) => setMapError(messageOf(mapsError)));
  }, [config, site]);

  useEffect(() => {
    if (!site) return;
    const local = localSiteValidation(site);
    if (!local.valid) {
      setSiteValidation(null);
      setError(local.reason);
      return;
    }
    const timer = window.setTimeout(() => {
      api<SiteValidation>('/api/site/validate', post(site))
        .then((validation) => {
          setSiteValidation(validation);
          if (!validation.valid) setError(validation.reason);
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
    boundaryRef.current = sitePolygons(site).map((polygon, index) => new maps.Polygon({
      map,
      paths: polygon,
      strokeColor: '#f0c36b',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#b8d96f',
      fillOpacity: 0.13,
      editable: drawMode === 'edit-site' && index === 0,
      zIndex: 10,
    }));
    if (drawMode === 'edit-site') {
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
    if (!bounds.isEmpty() && section === 'site') map.fitBounds(bounds, 72);
    return () => boundaryRef.current.forEach((overlay) => overlay.setMap(null));
  }, [site?.polygon, site?.additionalPolygons, drawMode]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !site) return;
    exclusionsRef.current.forEach((overlay) => overlay.setMap(null));
    const constraintPolygons = [...site.holes.map((polygon, index) => ({ polygon, kind: 'hole' as const, index })), ...site.exclusions.map((polygon, index) => ({ polygon, kind: 'exclusion' as const, index }))];
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
    const pathOverlays = site.paths.map((path, index) => {
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
      ...site.accessPoints.map((point) => ({ point, label: 'A', color: '#f0c36b' })),
      ...site.waterPoints.map((point) => ({ point, label: 'W', color: '#62c8bd' })),
      ...site.existingTrees.map((point) => ({ point, label: 'T', color: '#d7ff83' })),
    ].map(({ point, label, color }) => new maps.Marker({
      map,
      position: point.coordinate,
      clickable: false,
      label: { text: label, color: '#17351f', fontSize: '9px', fontWeight: '700' },
      icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: color, fillOpacity: 1, strokeColor: '#17351f', strokeWeight: 2 },
      zIndex: 15,
    }));
    exclusionsRef.current = [...polygonOverlays, ...pathOverlays, ...pointOverlays];
    return () => exclusionsRef.current.forEach((overlay) => overlay.setMap(null));
  }, [site?.holes, site?.exclusions, site?.paths, site?.accessPoints, site?.waterPoints, site?.existingTrees, drawMode]);

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
    if (draftPoints.length) {
      draftOverlayRef.current = drawMode !== 'path' && draftPoints.length >= 3
        ? new maps.Polygon({ map, paths: draftPoints, strokeColor: '#ffffff', strokeWeight: 2, fillColor: '#ffffff', fillOpacity: 0.12, zIndex: 50 })
        : new maps.Polyline({ map, path: draftPoints, strokeColor: '#ffffff', strokeWeight: 3, zIndex: 50 });
    }
    return () => draftOverlayRef.current?.setMap(null);
  }, [draftPoints, drawMode]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps) return;
    treeOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    treeOverlaysRef.current = [];
    if (!selectedVariant) return;
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
  }, [selectedVariant, timelineYear, selectedTreeId]);

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
        setError('Site infrastructure and existing trees must be placed inside the field boundary.');
        setDrawMode('idle');
        return;
      }
      const id = crypto.randomUUID();
      if (drawMode === 'access-point') invalidateSite({ ...site, accessPoints: [...site.accessPoints, { id: `access-${id}`, name: `Access ${site.accessPoints.length + 1}`, coordinate }] });
      if (drawMode === 'water-point') invalidateSite({ ...site, waterPoints: [...site.waterPoints, { id: `water-${id}`, name: `Water source ${site.waterPoints.length + 1}`, coordinate }] });
      if (drawMode === 'existing-tree') invalidateSite({ ...site, existingTrees: [...site.existingTrees, { id: `existing-${id}`, name: `Observed tree ${site.existingTrees.length + 1}`, coordinate, speciesName: null, crownDiameterM: 5, protectionBufferM: 2.5 }] });
      setDrawMode('idle');
      return;
    }
    if (drawMode === 'add-tree' && selectedVariant && treeSpeciesId) {
      const restriction = plantingRestriction(coordinate, site, siteProfile);
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
      const restriction = plantingRestriction(coordinate, site, siteProfile);
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
      setError(validation.reason);
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
    setNotice('Boundary changed. Re-run evidence analysis before generating a design.');
  }

  function finishDraft() {
    const minimumPoints = drawMode === 'path' ? 2 : 3;
    if (!site || draftPoints.length < minimumPoints) {
      setError(`Add at least ${minimumPoints} points before finishing this geometry.`);
      return;
    }
    if (drawMode === 'site') invalidateSite({ ...site, polygon: draftPoints });
    if (drawMode === 'hole') invalidateSite({ ...site, holes: [...site.holes, draftPoints] });
    if (drawMode === 'exclusion') invalidateSite({ ...site, exclusions: [...site.exclusions, draftPoints] });
    if (drawMode === 'path') invalidateSite({ ...site, paths: [...site.paths, { id: `path-${crypto.randomUUID()}`, name: `Management path ${site.paths.length + 1}`, points: draftPoints, widthM: 3 }] });
    setDraftPoints([]);
    setDrawMode('idle');
  }

  async function importGeoJsonFile(file: File) {
    await runBusy('Validating imported GeoJSON', async () => {
      const imported = importSiteGeoJson(JSON.parse(await file.text()), { id: site?.id, name: site?.name });
      const validation = await api<SiteValidation>('/api/site/validate', post(imported));
      if (!validation.valid) throw new Error(validation.reason);
      invalidateSite(imported);
      setSiteValidation(validation);
      setNotice(`${validation.geometryType} imported: ${validation.plantableAreaM2.toFixed(0)} m² plantable after constraints.`);
    });
  }

  function undoSite() {
    if (!site || !siteUndoRef.current.length) return;
    const previous = siteUndoRef.current.pop()!;
    siteRedoRef.current.push(cloneSite(site));
    setSite(previous);
    clearDerivedSiteState();
  }

  function redoSite() {
    if (!site || !siteRedoRef.current.length) return;
    const next = siteRedoRef.current.pop()!;
    siteUndoRef.current.push(cloneSite(site));
    setSite(next);
    clearDerivedSiteState();
  }

  function clearDerivedSiteState() {
    setSiteProfile(null);
    setRecommendations([]);
    setVariants([]);
    setSelectedVariantId(null);
    setIrrigation(null);
    setCosts(null);
  }

  async function analyzeSite() {
    if (!site) return;
    await runBusy('Reading terrain, climate, soil and Sentinel scenes', async () => {
      const profile = await api<SiteProfile>('/api/site/profile', post(site));
      const result = await api<{ recommendations: SpeciesRecommendation[]; palette: DesignSpecies[] }>('/api/recommendations', post({ siteProfile: profile, objectives: designConfiguration.objectives }));
      recommendationObjectiveRef.current = JSON.stringify(designConfiguration.objectives);
      setSiteProfile(profile);
      setRecommendations(result.recommendations);
      const palette = result.palette.map((species) => species.id);
      setSelectedSpeciesIds(palette);
      setTreeSpeciesId(palette[0] ?? '');
      setSection('profile');
      setShowWaterSamples(false);
      setShowExistingVegetation(true);
      const woody = profile.satellite.existingVegetation;
      setNotice(`Evidence ready: ${woody.patches.length} existing woody ${woody.patches.length === 1 ? 'patch' : 'patches'} protected.`);
    });
  }

  async function generateDesign() {
    if (!site || !siteProfile) return setError('Complete the site evidence analysis first.');
    const minimumSpecies = designConfiguration.system === 'syntropic' ? 3 : designConfiguration.system === 'monoculture' ? 1 : 2;
    if (selectedSpeciesIds.length < minimumSpecies) return setError(`Select at least ${minimumSpecies} compatible ${minimumSpecies === 1 ? 'species' : 'species'}.`);
    await runBusy('Generating evidence-scored planting systems', async () => {
      const result = await api<{ variants: LayoutVariant[] }>('/api/layout/generate', post({ site, siteProfile, selectedSpeciesIds, designConfiguration }));
      setVariants(result.variants);
      setSelectedVariantId(result.variants[0]?.id ?? null);
      setSection('layout');
      setTimelineYear(5);
      setShowWaterSamples(false);
      setShowNdmi(false);
      setIrrigation(null);
      setCosts(null);
      undoRef.current = [];
      redoRef.current = [];
      setNotice(`${result.variants.length} reproducible layouts generated.`);
    });
  }

  async function calculateWaterAndCosts() {
    if (!selectedVariant || !siteProfile) return setError('Generate and select a layout first.');
    await runBusy('Sizing irrigation and calculating establishment costs', async () => {
      const result = await api<{ irrigation: IrrigationEstimate; establishment: EstablishmentCost }>('/api/costs/calculate', post({
        variant: selectedVariant,
        siteProfile,
        selectedSpeciesIds,
        designYear: timelineYear,
      }));
      setIrrigation(result.irrigation);
      setCosts(result.establishment);
      setSection('water');
      setNotice('Irrigation CAPEX, annual operation and establishment costs calculated.');
    });
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
      if (nextSpeciesIds.length < minimumSpecies) throw new Error(`This design system requires at least ${minimumSpecies} selected ${minimumSpecies === 1 ? 'species' : 'species'}.`);
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
        if (!site || !siteProfile) throw new Error('Complete the site evidence analysis before regenerating a layout.');
        const layoutResult = await api<{ variants: LayoutVariant[] }>('/api/layout/generate', post({ site, siteProfile, selectedSpeciesIds: nextSpeciesIds, designConfiguration }));
        nextVariants = layoutResult.variants;
        nextVariantId = nextVariants.some((variant) => variant.id === nextVariantId) ? nextVariantId : nextVariants[0]?.id ?? null;
        nextIrrigation = null;
        nextCosts = null;
      }
      if (recalculate) {
        if (!siteProfile) throw new Error('Complete the site evidence analysis before calculating water and costs.');
        const chosenVariant = nextVariants.find((variant) => variant.id === nextVariantId) ?? nextVariants[0];
        if (!chosenVariant) throw new Error('Generate a layout before calculating water and costs.');
        const costResult = await api<{ irrigation: IrrigationEstimate; establishment: EstablishmentCost }>('/api/costs/calculate', post({
          variant: chosenVariant,
          siteProfile,
          selectedSpeciesIds: nextSpeciesIds,
          designYear: nextTimelineYear,
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
      setNotice('AI proposal validated and applied to the Growaf project.');
    } catch (assistantApplyError) {
      setAssistantError(messageOf(assistantApplyError));
    } finally {
      setAssistantBusy(false);
    }
  }

  async function saveProject() {
    if (!site) return;
    if (!authUser) {
      setAuthOpen(true);
      setNotice(t('auth.signInToSave'));
      return;
    }
    const now = new Date().toISOString();
    const project: ProjectState = {
      id: projectId,
      name: 'Ragusa Ibla pilot agroforestry system',
      site,
      siteProfile,
      selectedSpeciesIds,
      designConfiguration,
      variants,
      selectedVariantId,
      timelineYear,
      irrigation,
      costs,
      createdAt: createdAtRef.current,
      updatedAt: now,
    };
    await runBusy(t('auth.saving'), async () => {
      await api(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) });
      setNotice(t('auth.saved'));
    });
  }

  async function authenticateGoogle(credential: string) {
    await runBusy(t('auth.signingIn'), async () => {
      const session = await api<{ authenticated: true; user: AuthUser }>('/api/auth/google', post({ credential }));
      setAuthUser(session.user);
      setAuthOpen(false);
      setNotice(t('auth.signedIn', { name: session.user.name }));
    });
  }

  async function logout() {
    await api('/api/auth/logout', post({}));
    setAuthUser(null);
    setNotice(t('auth.signedOut'));
  }

  async function searchCatalogue(filters: CatalogueFilters = { treeOnly: false, globUntOnly: false, designReadyOnly: false }) {
    await runBusy('Searching the evidence catalogue', async () => {
      const parameters = new URLSearchParams({ q: catalogueQuery, limit: '18' });
      if (filters.treeOnly) parameters.set('tree', 'true');
      if (filters.globUntOnly) parameters.set('globunt', 'true');
      if (filters.designReadyOnly) parameters.set('designReady', 'true');
      const result = await api<{ results: CatalogueSpecies[] }>(`/api/catalog/search?${parameters.toString()}`);
      setCatalogueResults(result.results);
    });
  }

  async function searchLocation() {
    const query = locationQuery.trim();
    if (query.length < 2) return setError('Enter at least two characters to search for a place.');
    await runBusy('Searching places', async () => {
      const results = await api<LocationSearchResult[]>(`/api/locations/search?q=${encodeURIComponent(query)}`);
      setLocationResults(results);
      if (!results.length) setNotice('No matching place was found. The current field is unchanged.');
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
    setNotice('Map centred on the selected place. Draw or import the authoritative field boundary before analysis.');
  }

  function useEnteredCoordinate(coordinate: Coordinate) {
    if (!Number.isFinite(coordinate.lat) || coordinate.lat < -90 || coordinate.lat > 90 || !Number.isFinite(coordinate.lng) || coordinate.lng < -180 || coordinate.lng > 180) {
      setError('Enter a valid latitude and longitude.');
      return;
    }
    if (drawMode !== 'idle' && drawMode !== 'edit-site' && drawMode !== 'edit-constraints') {
      mapClickRef.current(coordinate);
      return;
    }
    mapRef.current?.panTo(coordinate);
    mapRef.current?.setZoom(19);
    setNotice('Map centred on the entered coordinate. Select a drawing tool to use keyboard-entered vertices.');
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
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setSection('site')} aria-label="Growaf home">
          <span className="brand-mark"><Sprout size={21} strokeWidth={2.4} /></span>
          <span><strong>growaf</strong><small>{t('brand.tagline')}</small></span>
        </button>
        <div className="project-title">
          <span className="eyebrow">{t('project.pilot')}</span>
          <strong>{t('project.title')}</strong>
        </div>
        <div className="top-actions">
          <span className="source-status"><span /> {siteProfile ? t('status.siteData', { date: shortDay(siteProfile.generatedAt, locale) }) : t('status.awaiting')}</span>
          <label className="language-select"><span className="visually-hidden">{t('language.label')}</span><select aria-label={t('language.label')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((item) => <option key={item.code} value={item.code}>{item.shortLabel}</option>)}</select></label>
          <button className="button ai-trigger" onClick={() => setAssistantOpen(true)}><Sparkles size={16} /> {t('actions.ask')}</button>
          <button className="button ghost" onClick={saveProject} disabled={!site || Boolean(busy)}><Save size={16} /> {t('actions.save')}</button>
          <a className={`button ghost ${!selectedVariant || !authUser ? 'disabled' : ''}`} href={selectedVariant && authUser ? `/api/projects/${projectId}/export.geojson` : undefined}><Download size={16} /> GeoJSON</a>
          {authUser ? (
            <button className="user-chip" onClick={logout} aria-label={t('auth.signOut')} title={t('auth.signOut')}>
              {authUser.pictureUrl ? <img src={authUser.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <span>{authUser.name.slice(0, 1).toUpperCase()}</span>}
              <strong>{authUser.name}</strong><LogOut size={14} />
            </button>
          ) : <button className="button auth-trigger" onClick={() => setAuthOpen(true)}><LogIn size={15} /> {t('auth.signIn')}</button>}
        </div>
      </header>

      <aside className="step-rail" aria-label="Workflow">
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
        <section className="map-stage" aria-label="Interactive site map">
          <div ref={mapElementRef} className="map-canvas" />
          {mapError && <div className="map-error"><Satellite size={22} /><strong>Satellite map unavailable</strong><span>{mapError}</span></div>}
          <div className="map-badge"><Satellite size={14} /> {t('map.live')}</div>
          <div className="map-toolbar">
            <button aria-label="Edit site vertices" className={drawMode === 'edit-site' ? 'active' : ''} onClick={() => { setDrawMode(drawMode === 'edit-site' ? 'idle' : 'edit-site'); setDraftPoints([]); }} title="Edit site vertices"><MousePointer2 size={17} /></button>
            <button aria-label="Edit constraint vertices" className={drawMode === 'edit-constraints' ? 'active' : ''} onClick={() => { setDrawMode(drawMode === 'edit-constraints' ? 'idle' : 'edit-constraints'); setDraftPoints([]); }} title="Edit constraint vertices"><Route size={17} /></button>
            <button aria-label="Draw a new site" className={drawMode === 'site' ? 'active' : ''} onClick={() => { setDrawMode('site'); setDraftPoints([]); }} title="Draw a new site"><PencilRuler size={17} /></button>
            <button aria-label="Draw a hole" className={drawMode === 'hole' ? 'active' : ''} onClick={() => { setDrawMode('hole'); setDraftPoints([]); }} title="Draw a hole"><CircleOff size={17} /></button>
            <button aria-label="Draw an exclusion" className={drawMode === 'exclusion' ? 'active' : ''} onClick={() => { setDrawMode('exclusion'); setDraftPoints([]); }} title="Draw an exclusion"><Layers3 size={17} /></button>
            <button aria-label="Draw a management path" className={drawMode === 'path' ? 'active' : ''} onClick={() => { setDrawMode('path'); setDraftPoints([]); }} title="Draw a management path"><Route size={17} /></button>
            {(drawMode === 'site' || drawMode === 'hole' || drawMode === 'exclusion' || drawMode === 'path') && <button aria-label="Finish geometry" className="finish" onClick={finishDraft} title="Finish geometry"><Check size={17} /></button>}
            <span />
            <button aria-label="Toggle existing vegetation mask" className={showExistingVegetation ? 'active vegetation' : ''} onClick={() => setShowExistingVegetation((value) => !value)} disabled={!siteProfile?.satellite.existingVegetation.patches.length} title="Toggle existing vegetation mask"><TreePine size={17} /></button>
            <button aria-label="Toggle NDMI raster" className={showNdmi ? 'active water' : ''} onClick={() => setShowNdmi((value) => !value)} disabled={!siteProfile?.satellite.optical.ndmiPreviewUrl} title="Toggle NDMI raster"><Waves size={17} /></button>
            <button aria-label="Toggle water-priority samples" className={showWaterSamples ? 'active water' : ''} onClick={() => setShowWaterSamples((value) => !value)} disabled={!siteProfile?.satellite.optical.waterSamples.length} title="Toggle water-priority samples"><Droplets size={17} /></button>
          </div>
          {selectedVariant && (
            <div className="timeline-control">
              <div><span>{t('timeline.year')}</span><strong>{timelineYear}</strong></div>
              <input aria-label="Succession year" type="range" min="0" max="30" value={timelineYear} onChange={(event) => setTimelineYear(Number(event.target.value))} />
              <div className="timeline-marks"><span>{t('timeline.planting')}</span><span>{t('timeline.establishment')}</span><span>{t('timeline.maturity')}</span></div>
            </div>
          )}
          {showExistingVegetation && Boolean(siteProfile?.satellite.existingVegetation.patches.length) && (
            <div className="vegetation-legend">
              <span><i /> existing woody vegetation</span>
              <small>protected zone · no new planting</small>
            </div>
          )}
          {showWaterSamples && siteProfile?.satellite.optical.latest && (
            <div className="satellite-legend">
              <span><i className="dry" /> higher priority</span>
              <span><i className="balanced" /> monitor</span>
              <span><i className="wet" /> lower priority</span>
              <small>Sentinel-2 · {shortDate(siteProfile.satellite.optical.latest.acquiredAt)}</small>
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
            onDrawMode={(mode) => { setDrawMode(mode); setDraftPoints([]); }}
            onAnalyze={analyzeSite}
            onReset={() => config && invalidateSite(normalizeSiteBoundary(config.defaultSite))}
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
          {section === 'profile' && <ProfilePanel profile={siteProfile} onAnalyze={analyzeSite} onShowNdmi={() => { setShowNdmi(true); setShowWaterSamples(true); }} />}
          {section === 'species' && <SpeciesPanel recommendations={recommendations} selectedIds={selectedSpeciesIds} onToggle={toggleSpecies} onGenerate={generateDesign} query={catalogueQuery} onQuery={setCatalogueQuery} onSearch={searchCatalogue} catalogueResults={catalogueResults} stats={catalogueStats} design={designConfiguration} onDesign={updateDesignConfiguration} />}
          {section === 'layout' && <LayoutPanel variants={variants} selectedVariant={selectedVariant} onSelect={setSelectedVariantId} selectedTree={selectedTree} selectedSpecies={selectedSpecies} treeSpeciesId={treeSpeciesId} onTreeSpecies={setTreeSpeciesId} drawMode={drawMode} onMode={setDrawMode} onDelete={deleteSelectedTree} onLock={toggleTreeLock} onUndo={undoTrees} onRedo={redoTrees} canUndo={undoRef.current.length > 0} canRedo={redoRef.current.length > 0} onCalculate={calculateWaterAndCosts} />}
          {section === 'water' && <WaterPanel irrigation={irrigation} profile={siteProfile} onCalculate={calculateWaterAndCosts} onCosts={() => setSection('costs')} onShowZones={() => { setShowWaterSamples(true); setShowNdmi(false); }} />}
          {section === 'costs' && <CostsPanel costs={costs} irrigation={irrigation} species={selectedSpecies} onCalculate={calculateWaterAndCosts} />}
        </section>
      </main>

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
      <nav><button onClick={onPrevious}><ArrowLeft size={16} /></button><button onClick={onNext}><ArrowRight size={16} /></button></nav>
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
    'Aggiungi una specie produttiva adatta al sito e rigenera il progetto.',
    'Riduci il fabbisogno idrico senza perdere troppi strati.',
    'Spiegami perché queste specie sono adatte a questo terreno.',
  ];
  return (
    <aside className="assistant-panel" aria-label="Growaf AI assistant">
      <header>
        <span className="assistant-mark"><Sparkles size={18} /></span>
        <span><small>{t('assistant.internal')}</small><strong>{t('actions.ask')}</strong></span>
        <span className={`assistant-model ${configured ? 'ready' : ''}`}>{configured ? t('assistant.connected') : t('assistant.notConfigured')}</span>
        <button aria-label="Close assistant" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="assistant-body">
        <div className="assistant-trust"><ShieldCheck size={16} /><span><strong>{t('assistant.validated')}</strong><small>{t('assistant.validatedBody')}</small></span></div>
        {!configured && <div className="assistant-warning">Set <code>AI_PROVIDER_API_KEY</code> on the server. The key is never exposed to the browser.</div>}
        {!proposal && !busy && <div className="assistant-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => { onInput(prompt); onAsk(prompt); }} disabled={!configured}>{prompt}</button>)}</div>}
        {busy && <div className="assistant-thinking"><LoaderCircle className="spin" size={20} /><span>Reading the current site, palette and design…</span></div>}
        {error && <div className="assistant-error"><strong>Request not applied</strong><span>{error}</span></div>}
        {proposal && <div className="assistant-proposal" data-testid="assistant-proposal">
          <div className="assistant-answer"><small>{t('assistant.proposal')}</small><strong>{proposal.summary}</strong><p>{proposal.rationale}</p></div>
          {proposal.actions.length > 0 && <div className="assistant-actions"><small>Changes awaiting confirmation</small>{proposal.actions.map((action, index) => <span key={`${action.type}-${index}`}><i>{index + 1}</i>{assistantActionLabel(action)}</span>)}</div>}
          {proposal.warnings.length > 0 && <div className="assistant-proposal-warnings">{proposal.warnings.map((warning) => <span key={warning}>• {warning}</span>)}</div>}
          <div className="assistant-confirm"><button onClick={onDismiss}>Dismiss</button>{proposal.requiresConfirmation ? <button className="confirm" onClick={onApply} disabled={busy}><ShieldCheck size={15} /> Apply validated changes</button> : <button className="confirm" onClick={onDismiss}>Done</button>}</div>
        </div>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
        <textarea aria-label="Ask Growaf" value={input} onChange={(event) => onInput(event.target.value)} placeholder="Ask to add a species, compare variants, reduce water use…" maxLength={2000} />
        <button aria-label="Send to AI assistant" type="submit" disabled={!configured || busy || !input.trim()}><Send size={17} /></button>
      </form>
    </aside>
  );
}

function assistantActionLabel(action: AssistantAction) {
  if (action.type === 'add_species') return `Add ${action.speciesIds.map(speciesLabel).join(', ')}`;
  if (action.type === 'remove_species') return `Remove ${action.speciesIds.map(speciesLabel).join(', ')}`;
  if (action.type === 'select_variant') return `Select layout ${humanize(action.variantId)}`;
  if (action.type === 'set_timeline_year') return `Set succession year to ${action.year}`;
  if (action.type === 'regenerate_layout') return 'Regenerate all three validated layouts';
  if (action.type === 'recalculate_water_and_costs') return 'Recalculate irrigation and costs';
  return `Open ${humanize(action.section)}`;
}

function speciesLabel(id: string) {
  return DESIGN_SPECIES_BY_ID.get(id)?.commonName ?? id;
}

function SitePanel({
  site,
  profile,
  validation,
  drawMode,
  onDrawMode,
  onAnalyze,
  onReset,
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
  onReset: () => void;
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
  const [coordinateLat, setCoordinateLat] = useState('36.92100');
  const [coordinateLng, setCoordinateLng] = useState('14.75320');
  const removePolygon = (kind: 'holes' | 'exclusions', index: number) => {
    if (!site) return;
    onUpdate({ ...site, [kind]: site[kind].filter((_, itemIndex) => itemIndex !== index) });
  };
  return (
    <div className="panel-body">
      <div className="panel-intro"><span className="eyebrow">{t('site.eyebrow')}</span><h1>{t('site.title')}</h1><p>{t('site.body')}</p></div>
      <div className="location-search">
        <Search size={16} />
        <input aria-label="Search place or address" value={locationQuery} onChange={(event) => onLocationQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onLocationSearch()} />
        <button onClick={onLocationSearch}>{t('site.find')}</button>
        {locationResults.length > 0 && <div className="location-results">{locationResults.map((result) => <button key={result.id} onClick={() => onLocationSelect(result)}><strong>{result.displayName}</strong><small>{humanize(result.type)} · {result.coordinate.lat.toFixed(5)}, {result.coordinate.lng.toFixed(5)}</small></button>)}</div>}
      </div>
      <div className="coordinate-entry">
        <label><span>Latitude</span><input aria-label="Coordinate latitude" inputMode="decimal" value={coordinateLat} onChange={(event) => setCoordinateLat(event.target.value)} /></label>
        <label><span>Longitude</span><input aria-label="Coordinate longitude" inputMode="decimal" value={coordinateLng} onChange={(event) => setCoordinateLng(event.target.value)} /></label>
        <button onClick={() => onCoordinate({ lat: Number(coordinateLat), lng: Number(coordinateLng) })}>{drawMode === 'idle' || drawMode.startsWith('edit') ? 'Centre map' : 'Add coordinate'}</button>
      </div>
      <div className="metric-grid">
        <Metric label={t('site.geometry')} value={validation?.geometryType ?? '—'} detail={`${validation?.counts.polygons ?? 0} planting region${validation?.counts.polygons === 1 ? '' : 's'}`} />
        <Metric label={t('site.constraints')} value={String((site?.holes.length ?? 0) + (site?.exclusions.length ?? 0) + (site?.paths.length ?? 0) + (site?.existingTrees.length ?? 0) + (profile?.satellite.existingVegetation.patches.length ?? 0))} detail="holes · paths · vegetation" />
        <Metric label={t('site.grossArea')} value={validation ? `${formatNumber(validation.areaM2 / 10_000, 2)} ha` : 'checking'} detail="PostGIS geography" />
        <Metric label={t('site.plantable')} value={validation ? `${formatNumber(validation.plantableAreaM2, 0)} m²` : 'checking'} detail={`${site?.setbackM ?? 0} m setback`} />
      </div>
      <div className="field-card">
        <div className="field-card-icon"><LocateFixed size={20} /></div>
        <div><small>Selected field</small><strong>{site?.name ?? 'No site selected'}</strong><span>Ragusa Ibla, Sicily · real pilot boundary</span></div>
        <button onClick={onReset}><RotateCcw size={15} /></button>
      </div>
      <div className={`site-validation ${validation?.valid ? 'valid' : 'pending'}`}>
        <ShieldCheck size={17} />
        <span><strong>{validation?.valid ? t('site.validationValid') : t('site.validationPending')}</strong><small>{validation?.reason ?? 'Boundary, blockers and plantable area are checked server-side.'}</small></span>
      </div>
      <div className="site-history-actions">
        <button onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /> Undo site</button>
        <button onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /> Redo site</button>
        <button onClick={() => importInputRef.current?.click()}><Upload size={14} /> Import GeoJSON</button>
        <input ref={importInputRef} className="visually-hidden" aria-label="Import site GeoJSON" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = '';
        }} />
      </div>
      <div className="site-tool-grid" aria-label="Site feature tools">
        <button className={drawMode === 'edit-constraints' ? 'active' : ''} onClick={() => onDrawMode('edit-constraints')}><MousePointer2 size={15} /><span>Edit features<small>drag vertices</small></span></button>
        <button className={drawMode === 'hole' ? 'active' : ''} onClick={() => onDrawMode('hole')}><CircleOff size={15} /><span>Hole<small>pond / building</small></span></button>
        <button className={drawMode === 'exclusion' ? 'active' : ''} onClick={() => onDrawMode('exclusion')}><Layers3 size={15} /><span>Exclusion<small>no-plant area</small></span></button>
        <button className={drawMode === 'path' ? 'active' : ''} onClick={() => onDrawMode('path')}><Route size={15} /><span>Path<small>management access</small></span></button>
        <button className={drawMode === 'access-point' ? 'active' : ''} onClick={() => onDrawMode('access-point')}><LocateFixed size={15} /><span>Access<small>click gate point</small></span></button>
        <button className={drawMode === 'water-point' ? 'active' : ''} onClick={() => onDrawMode('water-point')}><Droplets size={15} /><span>Water<small>click source point</small></span></button>
        <button className={drawMode === 'existing-tree' ? 'active' : ''} onClick={() => onDrawMode('existing-tree')}><TreePine size={15} /><span>Existing tree<small>protected buffer</small></span></button>
      </div>
      {site && <div className="site-parameters">
        <label><span>Boundary setback<small>applied before tree placement</small></span><span><input aria-label="Boundary setback metres" type="number" min="0" max="30" step="0.1" value={site.setbackM} onChange={(event) => onUpdate({ ...site, setbackM: Number(event.target.value) })} /> m</span></label>
        {site.paths.map((path) => <label key={path.id}><span>{path.name}<small>{path.points.length} vertices</small></span><span><input aria-label={`${path.name} width metres`} type="number" min="0.5" max="30" step="0.5" value={path.widthM} onChange={(event) => onUpdate({ ...site, paths: site.paths.map((item) => item.id === path.id ? { ...item, widthM: Number(event.target.value) } : item) })} /> m <button aria-label={`Remove ${path.name}`} onClick={() => onUpdate({ ...site, paths: site.paths.filter((item) => item.id !== path.id) })}><X size={12} /></button></span></label>)}
      </div>}
      {site && (site.holes.length + site.exclusions.length + site.accessPoints.length + site.waterPoints.length + site.existingTrees.length > 0) && <div className="site-feature-list">
        {site.holes.map((_, index) => <span key={`hole-${index}`}><i>H{index + 1}</i><strong>Site hole</strong><button aria-label={`Remove hole ${index + 1}`} onClick={() => removePolygon('holes', index)}><X size={13} /></button></span>)}
        {site.exclusions.map((_, index) => <span key={`exclusion-${index}`}><i>X{index + 1}</i><strong>No-plant exclusion</strong><button aria-label={`Remove exclusion ${index + 1}`} onClick={() => removePolygon('exclusions', index)}><X size={13} /></button></span>)}
        {site.accessPoints.map((point) => <span key={point.id}><i>A</i><strong>{point.name}</strong><button aria-label={`Remove ${point.name}`} onClick={() => onUpdate({ ...site, accessPoints: site.accessPoints.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
        {site.waterPoints.map((point) => <span key={point.id}><i>W</i><strong>{point.name}</strong><button aria-label={`Remove ${point.name}`} onClick={() => onUpdate({ ...site, waterPoints: site.waterPoints.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
        {site.existingTrees.map((point) => <span key={point.id}><i>T</i><strong>{point.name}</strong><button aria-label={`Remove ${point.name}`} onClick={() => onUpdate({ ...site, existingTrees: site.existingTrees.filter((item) => item.id !== point.id) })}><X size={13} /></button></span>)}
      </div>}
      <div className="callout"><CloudSun size={18} /><div><strong>{t('site.climateTitle')}</strong><span>{t('site.climateBody')}</span></div></div>
      <button className="button primary wide" onClick={onAnalyze} disabled={!site || !validation?.valid || busy}>{profile ? t('actions.refresh') : t('actions.analyse')}<ChevronRight size={18} /></button>
      <p className="fine-print">Execution decisions still require a field visit, soil sampling and water-source verification.</p>
    </div>
  );
}

function ProfilePanel({ profile, onAnalyze, onShowNdmi }: { profile: SiteProfile | null; onAnalyze: () => void; onShowNdmi: () => void }) {
  const { t } = useI18n();
  if (!profile) return <EmptyState icon={FlaskConical} title="No evidence profile yet" body="Analyse the selected field to retrieve terrain, climate, soil and Sentinel observations." action="Analyse field" onAction={onAnalyze} />;
  const optical = profile.satellite.optical.latest;
  const radar = profile.satellite.radar;
  const vegetation = profile.satellite.existingVegetation;
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('profile.eyebrow')}</span><h1>{profile.location.municipality ?? 'Ragusa Ibla'}</h1><p>{profile.location.displayName}</p></div>
      <div className="metric-grid">
        <Metric label={t('profile.elevation')} value={`${formatNumber(profile.terrain.elevationMeanM, 0)} m`} detail={`${profile.terrain.elevationMinM}–${profile.terrain.elevationMaxM} m`} />
        <Metric label={t('profile.slope')} value={`${profile.terrain.slopePercent}%`} detail={`${profile.terrain.aspectLabel} aspect`} />
        <Metric label={t('profile.rain')} value={`${formatNumber(profile.climate.annualPrecipitationMm, 0)} mm`} detail="annual mean" />
        <Metric label="ET₀" value={`${formatNumber(profile.climate.annualEt0Mm, 0)} mm`} detail={`aridity ${profile.climate.aridityIndex}`} />
        <Metric label={t('profile.solar')} value={profile.solar.status === 'available' ? `${formatNumber(profile.solar.annualGlobalHorizontalKwhM2, 0)} kWh/m²` : '—'} detail="annual horizontal" />
        <Metric label={t('profile.wind')} value={profile.solar.prevailingWindDirectionLabel ?? '—'} detail={profile.solar.meanWindSpeedMs === null ? 'unavailable' : `${profile.solar.meanWindSpeedMs} m/s mean`} />
      </div>
      <div className="evidence-card soil-card">
        <div className="card-heading"><div><FlaskConical size={17} /><span><small>SoilGrids · 0–5 cm</small><strong>{profile.soil.textureClass ?? 'Field test required'}</strong></span></div><StatusPill status={profile.soil.status} /></div>
        <div className="soil-values"><span><small>pH</small><strong>{profile.soil.ph ?? '—'}</strong></span><span><small>Sand</small><strong>{profile.soil.sandPercent ?? '—'}%</strong></span><span><small>Clay</small><strong>{profile.soil.clayPercent ?? '—'}%</strong></span><span><small>SOC</small><strong>{profile.soil.organicCarbonGKg ?? '—'}</strong></span></div>
      </div>
      <div className="vegetation-audit" data-testid="existing-vegetation-audit">
        <div className="card-heading"><div><TreePine size={17} /><span><small>Existing vegetation audit</small><strong>{vegetation.patches.length} protected {vegetation.patches.length === 1 ? 'patch' : 'patches'}</strong></span></div><StatusPill status={vegetation.suitability} /></div>
        <div className="vegetation-metrics"><span><small>Detected cover</small><strong>{vegetation.detectedCoverPercent}%</strong></span><span><small>Protected area</small><strong>{vegetation.protectedCoverPercent}%</strong></span><span><small>NDVI dates</small><strong>{vegetation.analyzedOpticalScenes}</strong></span><span><small>Tree maps</small><strong>{vegetation.annualLandCoverYears.length + 1 + Number(vegetation.woodyVegetationLayerAvailable)}</strong></span></div>
        <p>{vegetation.conclusion}</p>
        {vegetation.patches.length > 0 && <div className="vegetation-patches">{vegetation.patches.slice(0, 4).map((patch, index) => <span key={patch.id}><i>{index + 1}</i><strong>NDVI {patch.currentNdvi.toFixed(2)}</strong><small>{patch.confidence} confidence · {patch.protectedAreaM2.toFixed(0)} m² protected</small></span>)}</div>}
      </div>
      <div className="satellite-card">
        <div className="satellite-image">{profile.satellite.optical.ndmiPreviewUrl ? <img src={profile.satellite.optical.ndmiPreviewUrl} alt="Sentinel-2 NDMI field crop" /> : <Satellite size={30} />}</div>
        <div className="satellite-copy">
          <div className="card-heading"><div><Satellite size={17} /><span><small>Sentinel field water</small><strong>{profile.satellite.status}</strong></span></div><StatusPill status={profile.satellite.status} /></div>
          {optical ? <><p>Clear pixels from {shortDate(optical.acquiredAt)} · {optical.fieldCloudPercent}% field cloud.</p><div className="index-row"><Index label="NDVI" value={optical.ndvi.mean} /><Index label="NDMI" value={optical.ndmi.mean} /><Index label="NDWI" value={optical.ndwi.mean} /></div></> : <p>No clear Sentinel-2 observation was available.</p>}
          <div className="radar-line"><Waves size={15} /><span>Sentinel-1: <strong>{humanize(radar.surfaceMoistureSignal)}</strong>{radar.latestVvAnomalyDb !== null ? ` · ${signed(radar.latestVvAnomalyDb)} dB` : ''}</span></div>
          <button className="text-button" onClick={onShowNdmi}>Show water layers on map <ChevronRight size={14} /></button>
        </div>
      </div>
      {profile.warnings.length > 0 && <div className="warning-list">{profile.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div>}
      <div className="source-list">
        {[profile.terrain.evidence, profile.climate.evidence, profile.solar.evidence, profile.soil.evidence, ...profile.satellite.existingVegetation.evidence, ...profile.satellite.evidence].map((item) => <a key={`${item.source}-${item.version}`} href={item.sourceUrl} target="_blank" rel="noreferrer"><span>{item.source}</span><small>{item.version} · {item.resolution}</small></a>)}
      </div>
    </div>
  );
}

function SpeciesPanel({ recommendations, selectedIds, onToggle, onGenerate, query, onQuery, onSearch, catalogueResults, stats, design, onDesign }: { recommendations: SpeciesRecommendation[]; selectedIds: string[]; onToggle: (id: string) => void; onGenerate: () => void; query: string; onQuery: (value: string) => void; onSearch: (filters: CatalogueFilters) => void; catalogueResults: CatalogueSpecies[]; stats: CatalogueStats | null; design: DesignConfiguration; onDesign: (value: DesignConfiguration) => void }) {
  const { t } = useI18n();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<CatalogueFilters>({ treeOnly: true, globUntOnly: false, designReadyOnly: false });
  const visible = recommendations.filter((item) => item.status !== 'blocked').slice(0, 18);
  const blocked = recommendations.filter((item) => item.status === 'blocked');
  const monitored = recommendations.filter((item) => item.species.invasiveStatus === 'monitor');
  const inspected = recommendations.find((item) => item.species.id === inspectedId) ?? visible[0] ?? recommendations[0] ?? null;
  const minimumSpecies = design.system === 'syntropic' ? 3 : design.system === 'monoculture' ? 1 : 2;
  const selectedOptions = recommendations.map((item) => item.species).filter((item) => selectedIds.includes(item.id) && item.treeLike && item.productiveFromYear !== null);
  const update = (patch: Partial<DesignConfiguration>) => onDesign({ ...design, ...patch });
  const objectives = [
    { key: 'production', label: 'Food & production' },
    { key: 'biodiversity', label: 'Biodiversity' },
    { key: 'nativeHabitat', label: 'Native habitat' },
    { key: 'waterResilience', label: 'Water resilience' },
    { key: 'lowMaintenance', label: 'Low maintenance' },
  ] as const;
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('species.eyebrow')}</span><h1>{t('species.title')}</h1><p>{t('species.selected', { count: selectedIds.length })}</p></div>
      {recommendations.length > 0 && <div className="safety-gate" data-testid="species-safety-gate"><ShieldCheck size={18} /><span><small>Jurisdictional safety gate</small><strong>{blocked.length} blocked · {monitored.length} monitored</strong><p>Blocked taxa cannot enter generated layouts. Monitored taxa are capped at conditional and require containment.</p></span>{blocked.length > 0 && <button onClick={() => setInspectedId(blocked[0].species.id)}>Inspect</button>}</div>}
      <div className="objective-panel" data-testid="design-objectives">
        <div className="card-heading"><div><Sprout size={17} /><span><small>Priority model</small><strong>Design objectives</strong></span></div><small>0–100</small></div>
        <p>These priorities change suitability weights, palette order and composition targets.</p>
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
        <p className="design-explainer">{designSystemDescription(design.system)}</p>
        <div className="extent-switch" role="group" aria-label={t('design.extent')}>
          <button className={design.extent === 'full-field' ? 'active' : ''} disabled={design.system === 'windbreak' || design.system === 'boundary-buffer'} onClick={() => update({ extent: 'full-field' })}>{t('design.fullField')}</button>
          <button className={design.extent === 'perimeter-band' ? 'active' : ''} disabled={design.system === 'windbreak'} onClick={() => update({ extent: 'perimeter-band' })}>{t('design.perimeterOnly')}</button>
          {design.system === 'windbreak' && <button className="active" disabled>{t('design.selectedEdges')}</button>}
        </div>
        {design.extent !== 'full-field' && <label className="range-control"><span><b>{t('design.boundaryBand')}</b><output>{design.perimeterBandM} m</output></span><input aria-label="Perimeter band width" type="range" min="3" max="20" step="1" value={design.perimeterBandM} onChange={(event) => update({ perimeterBandM: Number(event.target.value) })} /></label>}
        {design.system === 'alley-cropping' && <label className="range-control"><span><b>{t('design.cropAlley')}</b><output>{design.cropAlleyWidthM} m</output></span><input aria-label="Crop alley width" type="range" min="6" max="30" step="1" value={design.cropAlleyWidthM} onChange={(event) => update({ cropAlleyWidthM: Number(event.target.value) })} /></label>}
        {design.system === 'windbreak' && <label className="range-control"><span><b>{t('design.windbreakRows')}</b><output>{design.windbreakRows}</output></span><input aria-label="Windbreak rows" type="range" min="1" max="5" step="1" value={design.windbreakRows} onChange={(event) => update({ windbreakRows: Number(event.target.value) })} /></label>}
        {design.system === 'monoculture' && <label className="select-label"><span>{t('design.singleCrop')}</span><select aria-label="Monoculture species" value={design.monocultureSpeciesId ?? ''} onChange={(event) => update({ monocultureSpeciesId: event.target.value || null })}><option value="">Best selected productive species</option>{selectedOptions.map((species) => <option key={species.id} value={species.id}>{species.commonName}</option>)}</select></label>}
        <label className="select-label"><span>{t('design.orientation')}</span><select aria-label={t('design.orientation')} value={design.orientationObjective} onChange={(event) => update({ orientationObjective: event.target.value as DesignConfiguration['orientationObjective'] })}>
          <option value="solar-crop">{t('orientation.solar')}</option>
          <option value="contour">{t('orientation.contour')}</option>
          <option value="operations">{t('orientation.operations')}</option>
          <option value="wind-protection">{t('orientation.wind')}</option>
          <option value="custom">{t('orientation.custom')}</option>
        </select></label>
        {design.orientationObjective === 'custom' && <label className="range-control"><span><b>{t('design.bearing')}</b><output>{design.customBearingDegrees}°</output></span><input aria-label="Custom row bearing" type="range" min="0" max="175" step="5" value={design.customBearingDegrees} onChange={(event) => update({ customBearingDegrees: Number(event.target.value) })} /></label>}
      </div>
      <div className="catalogue-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSearch(filters)} aria-label="Search scientific catalogue" /><button onClick={() => onSearch(filters)}>Search</button></div>
      <div className="catalogue-filters" aria-label="Catalogue filters">{([
        ['treeOnly', 'Trees'], ['globUntOnly', 'GlobUNT'], ['designReadyOnly', 'Design-ready'],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.checked })} /><span>{label}</span></label>)}</div>
      <div className="catalogue-meta"><span><strong>{stats ? formatNumber(stats.total, 0) : '—'}</strong> Switchboard taxa</span><span><strong>{stats ? formatNumber(stats.globUnt, 0) : '—'}</strong> GlobUNT records</span></div>
      {catalogueResults.length > 0 && <div className="catalogue-results">{catalogueResults.map((item) => <span key={item.id}><i>{item.scientificName}</i><span>{item.designReady && <small>Design-ready</small>}{item.globUnt && <small>GlobUNT</small>}</span></span>)}</div>}
      {!recommendations.length ? <div className="inline-empty">Complete field evidence to rank the design-ready palette.</div> : <div className="species-list">{visible.map((item) => {
        const selected = selectedIds.includes(item.species.id);
        return <div key={item.species.id} className={`species-row ${selected ? 'selected' : ''} ${inspected?.species.id === item.species.id ? 'inspected' : ''}`}>
          <button className="species-open" onClick={() => setInspectedId(item.species.id)} aria-label={`Inspect ${item.species.commonName}`}>
            <span className="species-swatch" style={{ background: item.species.color }} />
            <span className="species-name"><strong>{item.species.commonName}</strong><i>{item.species.scientificName}</i><small>{item.species.stratum} · {item.species.succession} · {item.species.roles.slice(0, 2).join(' / ')}</small></span>
            <span className="species-score"><strong>{item.score}</strong><small>/100</small></span>
          </button>
          <button className="select-check" onClick={() => onToggle(item.species.id)} aria-pressed={selected} aria-label={`${selected ? 'Remove' : 'Add'} ${item.species.commonName}`}>{selected && <Check size={13} />}</button>
        </div>;
      })}</div>}
      {inspected && <div className={`species-inspector ${inspected.status}`} data-testid="species-inspector">
        <header><span className="species-swatch" style={{ background: inspected.species.color }} /><span><small>{humanize(inspected.status)} · score {inspected.score}/100</small><strong>{inspected.species.commonName}</strong><i>{inspected.species.scientificName}</i></span>{inspected.status === 'blocked' && <CircleOff size={20} />}</header>
        <div className="suitability-components">{inspected.components.map((component) => <div key={component.key} className={component.status}><span><strong>{component.label}</strong><small>{Math.round(component.weight * 100)}% weight · {component.status}</small></span><output>{component.score}</output><div><i style={{ width: `${component.score}%` }} /></div><p>{component.explanation}</p></div>)}</div>
        {inspected.mitigations.length > 0 && <div className="mitigation-list"><strong>Checks before use</strong>{inspected.mitigations.map((item) => <p key={item}>• {item}</p>)}</div>}
        <div className="species-sources"><strong>Linked evidence</strong>{inspected.species.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.label}-${source.version}`}><span>{source.label}</span><small>{source.version} · {source.supports.join(', ')}</small></a>)}</div>
      </div>}
      <button className="button primary wide sticky-action" onClick={onGenerate} disabled={selectedIds.length < minimumSpecies}>{t('actions.generate')} <ChevronRight size={18} /></button>
    </div>
  );
}

function LayoutPanel({ variants, selectedVariant, onSelect, selectedTree, selectedSpecies, treeSpeciesId, onTreeSpecies, drawMode, onMode, onDelete, onLock, onUndo, onRedo, canUndo, canRedo, onCalculate }: { variants: LayoutVariant[]; selectedVariant: LayoutVariant | null; onSelect: (id: string) => void; selectedTree: TreeInstance | null; selectedSpecies: DesignSpecies[]; treeSpeciesId: string; onTreeSpecies: (id: string) => void; drawMode: DrawMode; onMode: (mode: DrawMode) => void; onDelete: () => void; onLock: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onCalculate: () => void }) {
  const { t } = useI18n();
  if (!selectedVariant) return <EmptyState icon={TreePine} title="No system generated" body="Select a compatible species palette, then generate reproducible syntropic arrangements clipped to the site." action="Open species" onAction={() => undefined} />;
  const selectedTreeSpecies = selectedTree ? DESIGN_SPECIES_BY_ID.get(selectedTree.speciesId) : null;
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('layout.eyebrow')}</span><h1>{selectedVariant.name}</h1><p>{selectedVariant.description}</p></div>
      <div className="variant-tabs">{variants.map((variant, index) => <button key={variant.id} className={variant.id === selectedVariant.id ? 'active' : ''} onClick={() => onSelect(variant.id)}><span>0{index + 1}</span><strong>{variant.name}</strong><small>score {variant.score}</small></button>)}</div>
      <div className="metric-grid">
        <Metric label={t('layout.plants')} value={formatNumber(selectedVariant.metrics.totalTrees, 0)} detail={`${selectedVariant.metrics.speciesCount} species`} />
        <Metric label={t('layout.density')} value={formatNumber(selectedVariant.metrics.treesPerHectare, 0)} detail="plants / ha" />
        <Metric label="Canopy Y10" value={`${selectedVariant.metrics.projectedCanopyYear10Percent}%`} detail="projected cover" />
        <Metric label="Canopy Y20" value={`${selectedVariant.metrics.projectedCanopyYear20Percent}%`} detail="projected cover" />
        <Metric label={t('layout.openInterior')} value={`${formatNumber(selectedVariant.metrics.cropInteriorAreaM2, 0)} m²`} detail={selectedVariant.design.extent === 'full-field' ? 'between woody rows' : 'kept free of new trees'} />
        <Metric label={t('layout.rowBearing')} value={`${selectedVariant.directionDegrees.toFixed(0)}°`} detail={humanize(selectedVariant.design.orientationObjective)} />
      </div>
      <div className="composition-card" data-testid="layout-composition">
        <div className="card-heading"><div><Layers3 size={17} /><span><small>Objective check</small><strong>Planned composition</strong></span></div></div>
        <div className="composition-targets">{[
          ['Productive', selectedVariant.composition.productivePercent, selectedVariant.composition.targets.productivePercent],
          ['Native Italy', selectedVariant.composition.nativePercent, selectedVariant.composition.targets.nativePercent],
          ['Nitrogen fixers', selectedVariant.composition.nitrogenFixerPercent, selectedVariant.composition.targets.nitrogenFixerPercent],
        ].map(([label, value, target]) => <div key={String(label)}><span><strong>{label}</strong><small>{value}% actual · {target}% target</small></span><div><i className={Number(value) >= Number(target) ? 'met' : ''} style={{ width: `${Math.min(100, Number(value))}%` }} /><b style={{ left: `${Math.min(100, Number(target))}%` }} /></div></div>)}</div>
        <div className="composition-groups"><span><small>Strata</small><strong>{Object.entries(selectedVariant.composition.byStratum).map(([key, value]) => `${humanize(key)} ${value}`).join(' · ')}</strong></span><span><small>Succession</small><strong>{Object.entries(selectedVariant.composition.bySuccession).map(([key, value]) => `${humanize(key)} ${value}`).join(' · ')}</strong></span></div>
      </div>
      <div className="solar-assessment">
        <div className="card-heading"><div><CloudSun size={17} /><span><small>{t('layout.solarCheck')}</small><strong>{selectedVariant.solar.status === 'available' ? t('layout.cropAccess', { value: selectedVariant.solar.cropSolarAccessPercent ?? 0 }) : 'Radiation unavailable'}</strong></span></div><StatusPill status={selectedVariant.solar.confidence} /></div>
        {selectedVariant.solar.status === 'available' && <div className="solar-metrics"><span><small>{t('layout.terrainPlane')}</small><strong>{formatNumber(selectedVariant.solar.terrainPlaneKwhM2Year ?? 0, 0)} kWh/m²·yr</strong></span><span><small>{t('layout.shadeLoss')}</small><strong>{selectedVariant.solar.shadedCropAreaPercent}%</strong></span><span><small>{t('layout.winterSun')}</small><strong>{selectedVariant.solar.winterSunHoursPerDay} h/day</strong></span><span><small>{t('layout.summerSun')}</small><strong>{selectedVariant.solar.summerSunHoursPerDay} h/day</strong></span></div>}
        <p>{selectedVariant.solar.method}</p>
        {selectedVariant.solar.limitations.slice(0, 1).map((item) => <small className="solar-limitation" key={item}>{item}</small>)}
      </div>
      <div className="edit-toolbar"><button onClick={onUndo} disabled={!canUndo}><Undo2 size={15} /> Undo</button><button onClick={onRedo} disabled={!canRedo}><Redo2 size={15} /> Redo</button><button className={drawMode === 'add-tree' ? 'active' : ''} onClick={() => onMode(drawMode === 'add-tree' ? 'idle' : 'add-tree')}><Plus size={15} /> Add</button></div>
      <label className="select-label"><span>Species for manual additions</span><select value={treeSpeciesId} onChange={(event) => onTreeSpecies(event.target.value)}>{selectedSpecies.map((species) => <option key={species.id} value={species.id}>{species.commonName} — {species.stratum}</option>)}</select></label>
      {selectedTree ? <div className="selected-tree-card"><span className="tree-dot" style={{ background: selectedTreeSpecies?.color }} /><div><small>Selected individual</small><strong>{selectedTreeSpecies?.commonName ?? selectedTree.speciesId}</strong><span>{selectedTree.locked ? 'Position locked' : 'Position editable'} · planted Y{selectedTree.plantedYear}</span></div><div className="tree-actions"><button onClick={onLock}>{selectedTree.locked ? 'Unlock' : 'Lock'}</button><button onClick={() => onMode('move-tree')} disabled={selectedTree.locked}>Move</button><button className="danger" onClick={onDelete}><Trash2 size={14} /></button></div></div> : <div className="inline-empty">Select a crown on the map to edit that individual.</div>}
      {selectedVariant.warnings.length > 0 && <div className="warning-list">{selectedVariant.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div>}
      <button className="button primary wide" onClick={onCalculate}>{t('actions.calculate')} <ChevronRight size={18} /></button>
    </div>
  );
}

function WaterPanel({ irrigation, profile, onCalculate, onCosts, onShowZones }: { irrigation: IrrigationEstimate | null; profile: SiteProfile | null; onCalculate: () => void; onCosts: () => void; onShowZones: () => void }) {
  const { t } = useI18n();
  if (!irrigation) return <EmptyState icon={Droplets} title="Irrigation not sized" body="Generate a layout to calculate FAO crop demand, installed drip infrastructure, annual water and pumping use." action="Calculate water system" onAction={onCalculate} />;
  const maxMonthly = Math.max(...irrigation.monthly.map((month) => month.grossM3), 1);
  return (
    <div className="panel-body">
      <div className="panel-intro compact"><span className="eyebrow">{t('water.eyebrow')}</span><h1>{t('water.annual', { value: formatNumber(irrigation.annualWaterM3, 0) })}</h1><p>FAO crop-coefficient demand, effective rainfall and 90% drip distribution efficiency.</p></div>
      <div className="metric-grid">
        <Metric label={t('water.gross')} value={`${formatNumber(irrigation.annualGrossMm, 0)} mm`} detail={irrigation.climatePeriod} />
        <Metric label={t('water.peak')} value={`${formatNumber(irrigation.peakDayM3, 1)} m³`} detail="design flow" />
        <Metric label={t('water.zones')} value={String(irrigation.zones)} detail={`${irrigation.emitterCount} emitters`} />
        <Metric label={t('water.opex')} value={currency(irrigation.annualOperation.totalEur)} detail="water + energy + care" />
      </div>
      <div className="monthly-chart"><div className="card-heading"><div><Droplets size={17} /><span><small>Monthly gross demand</small><strong>m³ by month</strong></span></div></div><div className="bars">{irrigation.monthly.map((month) => <div key={month.month}><span style={{ height: `${Math.max(3, month.grossM3 / maxMonthly * 100)}%` }} title={`${month.grossM3} m³`} /><small>{monthName(month.month)}</small></div>)}</div></div>
      <div className="satellite-schedule"><div><Satellite size={18} /><span><small>Current satellite scheduling</small><strong>{signed(irrigation.satelliteScheduling.adjustmentPercent)}% next pulse</strong></span><StatusPill status={irrigation.satelliteScheduling.confidence} /></div><p>{irrigation.satelliteScheduling.recommendation}</p><div className="priority-counts"><span className="high">{irrigation.satelliteScheduling.highPrioritySamples} high</span><span className="medium">{irrigation.satelliteScheduling.mediumPrioritySamples} monitor</span><span className="low">{irrigation.satelliteScheduling.lowPrioritySamples} low</span></div><button className="text-button" onClick={onShowZones}>Show sampled zones <ChevronRight size={14} /></button></div>
      <div className="cost-breakdown"><Row label="Water" value={currency(irrigation.annualOperation.waterEur)} /><Row label={`Pumping · ${formatNumber(irrigation.annualOperation.pumpingKwh, 0)} kWh`} value={currency(irrigation.annualOperation.energyEur)} /><Row label="Annual maintenance" value={currency(irrigation.annualOperation.maintenanceEur)} /><Row label="Installation materials" value={currency(irrigation.installation.materialsEur)} strong /><Row label={`Installation labour · ${irrigation.installation.laborHours} h`} value={currency(irrigation.installation.laborEur)} /></div>
      {profile?.satellite.limitations.slice(0, 2).map((limitation) => <p className="fine-print" key={limitation}>{limitation}</p>)}
      <button className="button primary wide" onClick={onCosts}>Review complete cost plan <ChevronRight size={18} /></button>
    </div>
  );
}

function CostsPanel({ costs, irrigation, species, onCalculate }: { costs: EstablishmentCost | null; irrigation: IrrigationEstimate | null; species: DesignSpecies[]; onCalculate: () => void }) {
  const { t } = useI18n();
  if (!costs || !irrigation) return <EmptyState icon={CircleDollarSign} title="No cost plan yet" body="Calculate the chosen layout to price every plant, planting labour, protection, irrigation installation and annual operation." action="Calculate cost plan" onAction={onCalculate} />;
  const speciesMap = new Map(species.map((item) => [item.id, item]));
  return (
    <div className="panel-body">
      <div className="total-cost"><small>{t('costs.establishment')}</small><strong>{currency(costs.totalEur)}</strong><span>plants, labour, protection and irrigation CAPEX</span></div>
      <div className="cost-breakdown large"><Row label={t('costs.plants')} value={currency(costs.plantPurchaseEur)} /><Row label={`${t('costs.labour')} · ${formatNumber(costs.plantingLaborHours, 1)} person-hours`} value={currency(costs.plantingLaborEur)} /><Row label="Stakes + protection" value={currency(costs.protectionAndStakesEur)} /><Row label={t('costs.irrigation')} value={currency(costs.irrigationInstallationEur)} strong /><Row label="Annual water + operation" value={`${currency(irrigation.annualOperation.totalEur)} / yr`} strong /></div>
      <div className="cost-table"><div className="cost-table-head"><span>Species</span><span>Qty</span><span>Plant</span><span>Labour</span><span>Total</span></div>{costs.bySpecies.map((item) => {
        const entry = speciesMap.get(item.speciesId);
        return <div className="cost-table-row" key={item.speciesId}><span><strong>{entry?.commonName ?? item.speciesId}</strong><i>{entry?.scientificName}</i></span><span>{item.count}</span><span>{currency(item.unitPlantEur)}</span><span>{formatNumber(item.unitLaborHours, 2)} h</span><span>{currency(item.subtotalEur)}</span></div>;
      })}</div>
      <div className="source-note"><Database size={17} /><div><strong>Regional price basis</strong><span>Sicilian Agriculture Price Book 2023; common agricultural labour €24.91/h with the 2024 table validity extended through 2026. Retail nursery comparisons are retained by stock class.</span></div></div>
      <div className="callout"><Droplets size={18} /><div><strong>Water tariff is editable</strong><span>The €0.42/m³ baseline is a regional district planning average, not a verified contract for this parcel.</span></div></div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function Index({ label, value }: { label: string; value: number }) { return <span><small>{label}</small><strong>{value.toFixed(3)}</strong></span>; }
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={strong ? 'strong' : ''}><span>{label}</span><strong>{value}</strong></div>; }
function StatusPill({ status }: { status: string }) { return <span className={`status-pill ${status}`}>{humanize(status)}</span>; }
function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: typeof Leaf; title: string; body: string; action: string; onAction: () => void }) { return <div className="empty-state"><span><Icon size={27} /></span><h2>{title}</h2><p>{body}</p><button className="button primary" onClick={onAction}>{action}<ChevronRight size={17} /></button></div>; }

function post(value: unknown): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }
async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Growaf API returned ${response.status}`);
  return body as T;
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Unexpected Growaf error'; }
function centroid(polygon: Coordinate[]) { return { lat: polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length, lng: polygon.reduce((sum, point) => sum + point.lng, 0) / polygon.length }; }
function plantingRestriction(coordinate: Coordinate, site: SiteBoundary | null, profile: SiteProfile | null) {
  if (!site) return 'Select a valid site before placing a plant.';
  if (!siteContainsCoordinate(site, coordinate)) return 'New plants must remain inside the field boundary and outside site holes.';
  if (distanceToSiteBoundaryM(site, coordinate) < site.setbackM) return `New plants must respect the ${site.setbackM} m boundary setback.`;
  if (site.paths.some((path) => distanceToSitePathM(coordinate, path) < path.widthM / 2)) return 'This point is inside a reserved management path.';
  if (site.existingTrees.some((tree) => {
    const projection = createLocalProjection(tree.coordinate);
    const point = projection.project(coordinate);
    return Math.hypot(point.x, point.y) < tree.crownDiameterM / 2 + tree.protectionBufferM;
  })) return 'This point is inside the protection buffer of a field-observed existing tree.';
  const projection = createLocalProjection(polygonCentroid(site.polygon));
  const point = projection.project(coordinate);
  if (site.exclusions.some((polygon) => pointInPolygon(point, polygon.map(projection.project)))) return 'This point is inside a manual no-plant exclusion.';
  const woody = profile?.satellite.existingVegetation.patches ?? [];
  if (woody.some((patch) => pointInPolygon(point, patch.polygon.map(projection.project)))) return 'This point is protected existing vegetation; place the new plant outside its crown and root buffer.';
  return null;
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
function formatNumber(value: number, digits: number) { return new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
function currency(value: number) { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value); }
function signed(value: number) { return `${value > 0 ? '+' : ''}${formatNumber(value, Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0)}`; }
function shortDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)); }
function shortDay(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', { day: '2-digit', month: 'short' }).format(new Date(value)); }
function humanize(value: string) { return value.replaceAll('-', ' ').replaceAll('_', ' '); }
function monthName(month: number) { return ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][month - 1]; }
function designSystemDescription(system: DesignConfiguration['system']) {
  return {
    syntropic: 'Mixed strata and succession phases with planned biomass, pruning and removals.',
    'alley-cropping': 'Woody rows separated by explicit crop alleys sized for light and machinery.',
    'mixed-orchard': 'Compatible productive trees in regular rows with optional support species.',
    monoculture: 'A transparent single-species production baseline; not presented as agroforestry.',
    windbreak: 'Selected boundary edges perpendicular to troublesome prevailing winds.',
    'boundary-buffer': 'A productive perimeter hedge that leaves the central cultivation area empty.',
  }[system];
}
function stratumOrder(stratum: DesignSpecies['stratum']) { return { ground: 0, low: 1, medium: 2, climber: 3, high: 4, emergent: 5 }[stratum]; }
