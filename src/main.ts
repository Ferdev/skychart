import "./destinationPicker.css";
import "./styles.css";
import { readRecentDestinations, type RecentDestination } from "./destinationPicker";
import { AU_PER_LIGHT_YEAR, MILKY_WAY_MODEL } from "./galacticModel";
import { initI18n, t } from "./i18n";
import { WebglPointRenderer } from "./webglPointRenderer";
import { installAnalytics, trackEvent } from "./analytics";
import { initializeErrorReporting } from "./errorReporting";
import { decodeViewState, type BodyFilter, type DisplayLayer, type ViewState } from "./viewState";
import { TourPlayer } from "./tourPlayer";
import { formatLightYears, formatNumber } from "./atlasFormatting";
import { isPresent, type Rect, type ScreenPoint } from "./geometry";
import { CatalogPointDecoder } from "./catalog/catalogPointDecoder";
import { CatalogPointManifestRepository } from "./catalog/catalogPointManifest";
import { CatalogPointPlanner, type CatalogPointViewport } from "./catalog/catalogPointPlanner";
import { CatalogObjectMapper } from "./catalog/catalogObjectMapper";
import { resolveSmallBodyPosition } from "./catalog/smallBodyPropagation";
import { smallBodyOrbitPathForBody } from "./catalog/smallBodyOrbit";
import { CatalogPointStream } from "./catalog/catalogPointStream";
import { CatalogPointSelector } from "./catalog/catalogPointSelector";
import { ObjectInspectionView, normalizeExternalLinks } from "./object/objectInspectionView";
import { SelectionConnectorView } from "./object/selectionConnectorView";
import { CatalogSearchGateway } from "./catalog/catalogSearchGateway";
import { DestinationSearchView, type DestinationSearchConfig, type DestinationSearchState } from "./destination/destinationSearchView";
import { MilkyWayRenderer } from "./rendering/milkyWayRenderer";
import { ObjectComparisonView } from "./object/objectComparisonView";
import { AtlasOverlayRenderer } from "./rendering/atlasOverlayRenderer";
import { AtlasVisibilityModel, isSolarSystemBody } from "./rendering/atlasVisibilityModel";
import { atlasDom } from "./atlas/atlasDom";
import { FEATURED_KEYS, STARTUP_EPHEMERIS_GROUPS, TIME_STEPS, universeShellForRadius, zoomPresetBodies } from "./atlas/atlasDefinitions";
import { CURATED_OBJECT_SUMMARIES } from "./object/curatedObjectSummaries";
import { ScientificValueFormatter, formatFullDate, toDatetimeLocalValue } from "./object/scientificValueFormatter";
import { ViewportCatalogLoader } from "./catalog/viewportCatalogLoader";
import { AtlasCameraController } from "./navigation/atlasCameraController";
import { CatalogObjectHydrator } from "./catalog/catalogObjectHydrator";
import { MapInteractionController } from "./navigation/mapInteractionController";
import { AtlasSharingController } from "./atlas/atlasSharingController";
import { AtlasStatsView } from "./atlas/atlasStatsView";
import { AtlasControlView } from "./atlas/atlasControlView";
import { bindDestinationEvents } from "./destination/destinationEventBindings";
import { CatalogLayerRenderer } from "./rendering/catalogLayerRenderer";
import { AtlasViewStateController } from "./navigation/atlasViewStateController";
import { CatalogMapSelectionController } from "./object/catalogMapSelectionController";
import { ObjectSelectionController } from "./object/objectSelectionController";
import { DestinationCatalogModel } from "./destination/destinationCatalogModel";
import { bindAtlasEvents } from "./atlas/atlasEventBindings";
import { AtlasViewport } from "./rendering/atlasViewport";
import { DestinationCatalogController } from "./destination/destinationCatalogController";
import { installAtlasDiagnostics } from "./atlas/atlasDiagnostics";
import { AtlasEmbedController } from "./atlas/atlasEmbedController";
import { AtlasTimeController } from "./atlas/atlasTimeController";
import { AtlasLoadingView } from "./atlas/atlasLoadingView";
import type {
  ActiveAtlasTab,
  SizeMode,
  ZoomPreset,
  Body,
  Ephemeris,
  CatalogSummary,
  ObjectDetailHydrationState,
  Camera,
  LoadingStep,
  RenderRequestOptions,
  SelectBodyOptions,
  DataRefreshOptions,
  CatalogPointHitEntry,
  BodyFilterDefinition,
} from "./atlas/contracts";

initializeErrorReporting();
installAnalytics();

const AU_KM_FALLBACK = 149_597_870.7;
const MIN_ZOOM = 1e-14;
const MAX_ZOOM = 50_000_000;
const ZOOM_SLIDER_STEPS = 1000;
const LOCAL_ZOOM_DURATION_MS = 1100;
const CAMERA_DATA_REFRESH_DEBOUNCE_MS = 180;
const SEARCH_INPUT_DEBOUNCE_MS = 180;
const catalogPointManifest = CatalogPointManifestRepository.fromBrowser();
const catalogPointPlanner = new CatalogPointPlanner(catalogPointManifest);
const catalogPointDecoder = new CatalogPointDecoder();
const catalogObjectMapper = new CatalogObjectMapper(() => ({
  auKm: auKm(),
  earth: bodyByKey.get("earth"),
  timestamp: ephemeris?.timestamp_utc,
  normalizeExternalLinks,
}));
const destinationCatalog = new DestinationCatalogModel({
  bodies: () => ephemeris?.bodies ?? [],
  bodyByKey: () => bodyByKey,
  selectedKey: () => selectedKey,
  compareTargetKey: () => compareTargetKey,
  activeFilter: () => activeFilter,
  activeCompareFilter: () => activeCompareFilter,
  activeGuidedSetId: () => activeGuidedSetId,
  recentDestinations: () => recentDestinations,
  auKm,
  catalogSummary: () => catalogSummary,
  catalogSearchState: () => catalogSearchState,
  compareSearchState: () => compareSearchState,
});
const catalogSearchGateway = new CatalogSearchGateway(catalogObjectMapper, (options) => destinationCatalog.localSearch(options));
const destinationSearchView = new DestinationSearchView({
  gateway: catalogSearchGateway,
  getRecentDestinations: () => recentDestinations,
  getAuKm: auKm,
  matchesFilter: (body, filter) => destinationCatalog.matches(body, filter),
});
const {
  pointCanvas, canvas, ctx, catalogPointHover, loadingScreen, loadingDetail, loadingFill, loadingProgressLabel,
  loadingStepLabel, loadingElapsed, loadState, selectedObjectPanel, mapHud, workspacePanel, bodySearch, bodyPicker,
  bodyInfo, nowStatus, nowEvents, compareHeading, compareSearch, comparePicker, comparePanel, timeSummary, timeInput,
  timeStepLabel, timeStepSlider, zoomScaleSlider, scienceLayerDisclosure, errorPanel, embedActivation, embedAttribution,
} = atlasDom;
const loadingView = new AtlasLoadingView({
  detail: loadingDetail, fill: loadingFill, progressLabel: loadingProgressLabel,
  stepLabel: loadingStepLabel, elapsed: loadingElapsed, errorPanel,
});
const pointRenderer = new WebglPointRenderer(pointCanvas);
const atlasViewport = new AtlasViewport({
  canvas,
  pointRenderer,
  camera: () => camera,
  activeTab: () => activeTab,
  selectedObjectPanel,
});
const catalogPointStream: CatalogPointStream = new CatalogPointStream({
  manifest: catalogPointManifest,
  planner: catalogPointPlanner,
  decoder: catalogPointDecoder,
  viewport: catalogPointViewport,
  canLoad: (): boolean => Boolean(ephemeris) && (!isEmbedMode || embedController.visible),
  isEmbed: () => isEmbedMode,
  setLayer: (id, source) => pointRenderer.setLayer(id, source),
  onChange: () => {
    updateStats();
    updatePerfHud();
  },
  requestRender: () => requestRender(),
});
let atlasVisibility: AtlasVisibilityModel;
const catalogPointSelector = new CatalogPointSelector({
  mapper: catalogObjectMapper,
  stream: catalogPointStream,
  planner: catalogPointPlanner,
  viewport: catalogPointViewport,
  screenToWorld: (point) => screenToWorld(point.x, point.y),
  pixelsPerAu: () => camera.pxPerAu,
  hitTest: (point) => atlasVisibility?.nearestCatalogPoint(point.x, point.y) ?? null,
  minimumZoom: MIN_ZOOM,
});
pointCanvas.addEventListener("point-renderer-unavailable", () => requestRender());
const bootViewState = decodeViewState(window.location.search);
const serverBootObjectKey = window.__ATLAS_BOOT__?.objectKey;
const isEmbedMode = window.location.pathname === "/embed" && document.querySelector<HTMLMetaElement>('meta[name="cosmic-atlas-boot-mode"]')?.content === "embed";

let ephemeris: Ephemeris | null = null;
let bodyByKey = new Map<string, Body>();
let selectedKey = "";
let activeTab: ActiveAtlasTab = null;
let activeFilter: BodyFilter = "all";
let activeCompareFilter: BodyFilter = "all";
let activeGuidedSetId: string | null = null;
let sizeMode: SizeMode = "hybrid";
let activeZoomPreset: ZoomPreset | null = "solar";
let displayLayers: Record<DisplayLayer, boolean> = {
  labels: true,
  orbits: true,
  grid: true,
  milkyWay: true,
  milkyWayArms: true,
  milkyWayDust: true,
  milkyWayGuides: true,
  references: true
};
let camera: Camera = { xAu: 0, yAu: 0, pxPerAu: 24 };
let viewTime: "now" | string = "now";
let loadSequence = 0;
let tourBootHandled = false;
let hoverKey: string | null = null;
let compareTargetKey: string | null = null;
let recentDestinations: RecentDestination[] = readRecentDestinations();
const catalogSearchState: DestinationSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
const compareSearchState: DestinationSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
let renderFrameId: number | null = null;
let cameraDataRefreshTimer: number | null = null;
let catalogSummary: CatalogSummary | null = null;
const objectDetailHydrationStates = new Map<string, ObjectDetailHydrationState>();
let perfEnabled = new URLSearchParams(window.location.search).has("perf") || window.localStorage.getItem("starsmap:perf") === "1";
let perfLastFrameAt = performance.now();
let perfFrameMs = 0;
let perfDrawMs = 0;
let perfHitTestMs = 0;
let perfLastViewportMs = 0;
let perfMilkyWayMs = 0;
let perfViewportLoads = 0;

const {
  formatDistance, nullableDistance, nullableNumber, nullableDegrees, nullableDays, nullableLightYears,
  formatRightAscensionForBody, formatDeclinationForBody, formatRaDecDecimal, formatGalacticLongitude,
  formatGalacticLatitude, formatEclipticLongitude, formatEclipticLatitude, formatEclipticRadius,
  formatAuCoordinate, readableOptionalModel, readableCatalogGroup, readablePositionModel,
} = new ScientificValueFormatter(auKm);
const viewportCatalogLoader = new ViewportCatalogLoader({
  mapper: catalogObjectMapper,
  canLoad: () => Boolean(ephemeris),
  viewWidthLy: currentViewWidthLy,
  filter: activeBodyFilterDefinition,
  worldBounds: (paddingRatio) => {
    const rect = usableViewportRect();
    const leftTop = screenToWorld(rect.left, rect.top);
    const rightBottom = screenToWorld(rect.right, rect.bottom);
    const minXAu = Math.min(leftTop.xAu, rightBottom.xAu);
    const maxXAu = Math.max(leftTop.xAu, rightBottom.xAu);
    const minYAu = Math.min(leftTop.yAu, rightBottom.yAu);
    const maxYAu = Math.max(leftTop.yAu, rightBottom.yAu);
    const paddingXAu = (maxXAu - minXAu) * paddingRatio;
    const paddingYAu = (maxYAu - minYAu) * paddingRatio;
    return { minXAu: minXAu - paddingXAu, maxXAu: maxXAu + paddingXAu, minYAu: minYAu - paddingYAu, maxYAu: maxYAu + paddingYAu };
  },
  hasBody: (key) => bodyByKey.has(key),
  mergeBodies,
  afterMerge: () => {
    updateStats();
    updateGuidedSets();
    if (activeTab === "catalog" && !bodySearch.value.trim()) void updateBodyPicker();
    requestRender();
  },
  recordLoad: (milliseconds) => {
    perfLastViewportMs = milliseconds;
    perfViewportLoads += 1;
    updatePerfHud();
  },
});
const cameraController = new AtlasCameraController({
  camera: () => camera,
  setCamera: (next) => { camera = next; },
  viewport: usableViewportRect,
  auKm,
  clearPreset: () => {
    activeZoomPreset = null;
    updateZoomPresetButtons();
  },
  updateScale: updateScaleUi,
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  requestDataRefresh: () => requestDataRefresh({ immediate: true }),
  schedulePointRefresh: () => catalogPointStream.schedule({ immediate: true }),
  scheduleCameraRefresh: scheduleCameraDataRefresh,
});
const mapInteraction = new MapInteractionController({
  canvas,
  catalogPointHover,
  isEnabled: () => embedController.activated,
  camera: () => camera,
  setCamera: (next) => { camera = next; },
  hoverKey: () => hoverKey,
  setHoverKey: (key) => { hoverKey = key; },
  cancelCameraAnimation,
  zoomAt,
  edgeReferenceAt,
  nearestBodyAt,
  nearestCatalogPointAt: nearestCatalogTilePointAt,
  handleClick: handleMapClick,
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  scheduleViewStateReplace,
});
const sharingController = new AtlasSharingController({
  isEmbedMode,
  viewState: currentViewState,
  selectedBody,
  camera: () => camera,
  ephemeris: () => ephemeris,
  pointRenderer,
  manifest: catalogPointManifest,
  preparePointLayers: () => catalogLayerRenderer.prepare(),
  replaceViewState: replaceCurrentViewState,
  requestRender: () => requestRender(),
});
atlasVisibility = new AtlasVisibilityModel({
  frame: () => ({
    ephemeris,
    camera,
    viewport: usableViewportRect(),
    selectedKey,
    compareTargetKey,
    hoverKey,
    transientSelectedKey: mapSelection.transientKey,
    viewWidthLy: currentViewWidthLy(),
  }),
  stream: catalogPointStream,
  planner: catalogPointPlanner,
  matchesActiveFilter: bodyMatchesActiveFilter,
  auKm,
  bodyDistanceKm,
  recordHitTestMs: (milliseconds) => { perfHitTestMs = milliseconds; },
  featuredKeys: FEATURED_KEYS,
});
const catalogLayerRenderer = new CatalogLayerRenderer({
  context: ctx,
  pointCanvas,
  pointRenderer,
  stream: catalogPointStream,
  planner: catalogPointPlanner,
  viewport: catalogPointViewport,
  viewportRect: usableViewportRect,
  renderScale,
  camera: () => camera,
  ephemerisTimestamp: () => ephemeris?.timestamp_utc ?? "",
  visibleBodies,
  selectedBody,
  selectedKey: () => selectedKey,
  hoverKey: () => hoverKey,
  isDuplicateBody: isPointLayerDuplicateBody,
  bodyRadiusAu,
  performanceEnabled: () => perfEnabled,
  afterViewportMeasurement: updateStats,
});
const statsView = new AtlasStatsView({
  ephemeris: () => ephemeris,
  catalogSummary: () => catalogSummary,
  visibleBodyCount: () => atlasVisibility.visibleBodies().length,
  manifest: catalogPointManifest,
  planner: catalogPointPlanner,
  stream: catalogPointStream,
  perf: () => ({
    enabled: perfEnabled, frameMs: perfFrameMs, drawMs: perfDrawMs,
    webglMs: catalogLayerRenderer.metrics.webglMs, bufferMs: catalogLayerRenderer.metrics.bufferMs,
    hitTestMs: perfHitTestMs, milkyWayMs: perfMilkyWayMs, viewportMs: perfLastViewportMs,
    viewportLoads: perfViewportLoads, pointRenderer: catalogLayerRenderer.metrics.pointRenderer,
  }),
});
const controlView = new AtlasControlView();
const timeController = new AtlasTimeController({
  timeSummary, timeInput, timeStepLabel, timeStepSlider, steps: TIME_STEPS,
  ephemeris: () => ephemeris, formatDate: formatFullDate, toLocalInput: toDatetimeLocalValue,
  translate: t, loadAtlas: (timestamp) => { void loadAtlas(timestamp); },
});
const atlasOverlay = new AtlasOverlayRenderer({
  context: ctx,
  frame: () => ({
    ephemeris,
    camera,
    selected: selectedBody(),
    compareTarget: compareTarget(),
    selectedKey,
    hoverKey,
    pointRendererAvailable: pointRenderer.available,
    viewport: usableViewportRect(),
    visibleBodies: visibleBodies(),
    labelBodies: prioritizedLabelBodies(),
    edgeBodies: edgeReferenceBodies(),
  }),
  bodyByKey: () => bodyByKey,
  bodyToScreen,
  worldToScreen,
  screenToWorld,
  bodyDisplayRadiusPx,
  bodyMatchesActiveFilter,
  isSolarSystemBody,
  currentViewWidthAu,
  auKm,
  formatDistance,
  smallBodyOrbitPathAu: (body) => smallBodyOrbitPathForBody(body, ephemeris?.timestamp_utc ?? new Date().toISOString(), () => requestRender()),
});
const milkyWayRenderer = new MilkyWayRenderer({
  context: ctx,
  camera: () => camera,
  displayLayers: () => displayLayers,
  currentViewWidthLy,
  usableViewport: usableViewportRect,
  worldToScreen,
  drawLabel: atlasOverlay.drawLabel,
});
const objectComparison = new ObjectComparisonView({
  heading: compareHeading,
  panel: comparePanel,
  auKm,
  distanceKm: bodyDistanceKm,
  formatDistance,
  afterRender: updateSelectedPanelMetrics,
});
const objectHydrator = new CatalogObjectHydrator({
  mapper: catalogObjectMapper,
  states: objectDetailHydrationStates,
  ephemeris: () => ephemeris,
  body: (key) => bodyByKey.get(key),
  searchBodies: () => [...catalogSearchState.latestBodies, ...compareSearchState.latestBodies],
  selectedKey: () => selectedKey,
  serverBootKey: serverBootObjectKey,
  mergeBodies,
  updateInspection: () => objectInspection.update(),
  updateSelectedView: () => {
    updateAllUi();
    requestRender({ data: false });
  },
  detailError: () => t("object.detailErrorBody"),
});
const tourPlayer = new TourPlayer({ navigate: navigateTourStep, prewarm: prewarmTourStep, track: (event, properties) => trackEvent(event, properties) });
const objectInspection: ObjectInspectionView = new ObjectInspectionView({
  bodyInfo,
  nowStatus,
  nowEvents,
  scienceLayerDisclosure,
  hydrationStates: objectDetailHydrationStates,
  manifest: catalogPointManifest,
  curatedSummaries: CURATED_OBJECT_SUMMARIES,
  selectedBody,
  bodyByKey: () => bodyByKey,
  ephemeris: () => ephemeris,
  currentViewWidthLy,
  universeShellForRadius,
  formatLightYears,
  formatRightAscensionForBody,
  formatDeclinationForBody,
  formatRaDecDecimal,
  formatGalacticLongitude,
  formatGalacticLatitude,
  formatEclipticLongitude,
  formatEclipticLatitude,
  formatEclipticRadius,
  formatAuCoordinate,
  formatDistance,
  nullableDistance,
  nullableNumber,
  nullableDegrees,
  nullableDays,
  nullableLightYears,
  readablePositionModel,
  readableOptionalModel,
  readableCatalogGroup,
  formatFullDate,
  bodyDistanceKm,
  usableViewportRect,
  worldToScreen,
});
const selectionConnector = new SelectionConnectorView({
  element: atlasDom.selectionConnector,
  workspacePanel,
  bodyInfo,
  selectedBody,
  active: () => activeTab === "object" && !selectedObjectPanel.hidden,
  viewport: usableViewportRect,
  bodyToScreen,
});
const mapSelection: CatalogMapSelectionController = new CatalogMapSelectionController({
  selector: catalogPointSelector,
  hydrationStates: objectDetailHydrationStates,
  selectedKey: () => selectedKey,
  edgeBodyAt: (point) => edgeReferenceAt(point.x, point.y)?.body ?? null,
  nearestBodyAt: (point) => nearestBodyAt(point.x, point.y)?.body ?? null,
  nearestCatalogPointAt: (point) => nearestCatalogTilePointAt(point.x, point.y),
  mergeBody: (body) => mergeBodies([body]),
  removeBody: removeMergedBody,
  selectBody,
  clearSelection: clearSelectedObject,
  inspection: objectInspection,
  detailError: () => t("object.detailErrorBody"),
});
const objectSelection: ObjectSelectionController = new ObjectSelectionController({
  state: {
    get selectedKey() { return selectedKey; }, set selectedKey(value) { selectedKey = value; },
    get compareTargetKey() { return compareTargetKey; }, set compareTargetKey(value) { compareTargetKey = value; },
    get activeTab() { return activeTab; }, set activeTab(value) { activeTab = value; },
    get activeGuidedSetId() { return activeGuidedSetId; }, set activeGuidedSetId(value) { activeGuidedSetId = value; },
    get recentDestinations() { return recentDestinations; }, set recentDestinations(value) { recentDestinations = value; },
  },
  bodyByKey: () => bodyByKey,
  catalogSearchState,
  compareSearchState,
  bodySearch,
  compareSearch,
  hydrator: objectHydrator,
  hydrationStates: objectDetailHydrationStates,
  mergeBody: (body) => mergeBodies([body]),
  transientKey: (): string | null => mapSelection.transientKey,
  setTransientKey: (key) => mapSelection.setTransientKey(key),
  cleanupTransient: (key) => mapSelection.cleanupTransient(key),
  cancelMapSelection: () => mapSelection.cancel(),
  updateAllUi,
  updateCompareUi,
  centerOnBody,
  requestRender: (withData) => requestRender(withData ? { data: true } : {}),
  pushViewState: pushCurrentViewState,
});
const destinationController = new DestinationCatalogController({
  state: {
    get activeFilter() { return activeFilter; }, set activeFilter(value) { activeFilter = value; },
    get activeCompareFilter() { return activeCompareFilter; }, set activeCompareFilter(value) { activeCompareFilter = value; },
    get activeGuidedSetId() { return activeGuidedSetId; }, set activeGuidedSetId(value) { activeGuidedSetId = value; },
    get selectedKey() { return selectedKey; }, set selectedKey(value) { selectedKey = value; },
    get compareTargetKey() { return compareTargetKey; }, set compareTargetKey(value) { compareTargetKey = value; },
  },
  model: destinationCatalog,
  controlView,
  searchView: destinationSearchView,
  pointStream: catalogPointStream,
  comparisonView: objectComparison,
  catalogSearchState,
  compareSearchState,
  bodySearch,
  bodyPicker,
  compareSearch,
  comparePicker,
  bodies: () => ephemeris?.bodies ?? [],
  bodyByKey: () => bodyByKey,
  hydrateBodies: (keys) => objectHydrator.hydrateCatalogKeys(keys),
  catalogSummary: () => catalogSummary,
  selectedBody,
  compareTarget,
  ensureCompareTarget,
  selectBodyByKey,
  setCompareTargetByKey,
  applyZoomPreset,
  setActiveTab,
  updateStats,
  updateSelectedPanelMetrics,
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  translate: t,
  searchDebounceMs: SEARCH_INPUT_DEBOUNCE_MS,
});
const viewStateController = new AtlasViewStateController({
  state: {
    get camera() { return camera; }, set camera(value) { camera = value; },
    get viewTime() { return viewTime; }, set viewTime(value) { viewTime = value; },
    get activeZoomPreset() { return activeZoomPreset; }, set activeZoomPreset(value) { activeZoomPreset = value; },
    get displayLayers() { return displayLayers; }, set displayLayers(value) { displayLayers = value; },
    get activeFilter() { return activeFilter; }, set activeFilter(value) { activeFilter = value; },
    get activeCompareFilter() { return activeCompareFilter; }, set activeCompareFilter(value) { activeCompareFilter = value; },
    get selectedKey() { return selectedKey; }, set selectedKey(value) { selectedKey = value; },
    get compareTargetKey() { return compareTargetKey; }, set compareTargetKey(value) { compareTargetKey = value; },
  },
  manifest: catalogPointManifest,
  pointStream: catalogPointStream,
  minimumZoom: MIN_ZOOM,
  maximumZoom: MAX_ZOOM,
  localZoomDurationMs: LOCAL_ZOOM_DURATION_MS,
  isEmbedMode,
  hasEphemeris: () => Boolean(ephemeris),
  transientSelectedKey: () => mapSelection.transientKey,
  selectBodyByKey,
  setCompareTargetByKey,
  updateAllUi,
  updateScale: updateScaleUi,
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  requestDataRefresh: () => requestDataRefresh({ immediate: true }),
  loadAtlas,
  animateCameraTo,
}, bootViewState);
const embedController: AtlasEmbedController = new AtlasEmbedController({
  enabled: isEmbedMode,
  canvas,
  activation: embedActivation,
  attribution: embedAttribution,
  pointStream: catalogPointStream,
  viewportLoader: viewportCatalogLoader,
  updateAttribution: () => sharingController.updateEmbedAttribution(),
  cancelCameraAnimation,
  suspendRendering: () => {
    if (cameraDataRefreshTimer !== null) window.clearTimeout(cameraDataRefreshTimer);
    cameraDataRefreshTimer = null;
    if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
    renderFrameId = null;
  },
  requestRender: () => requestRender({ data: true }),
});
installAtlasDiagnostics({
  enabled: perfEnabled,
  selectedBody,
  bodyByKey: () => bodyByKey,
  bodyToScreen,
  viewport: () => atlasViewport.rect(),
  workspacePanel,
  camera: () => camera,
  gestureState: () => mapInteraction.diagnostics(),
});

if (bootViewState) applyDecodedViewStateFields(bootViewState);
if (isEmbedMode) initializeEmbedMode();

resizeCanvas();
initI18n();
bindEvents();
initializeUi();
void loadCatalogTileManifest();
void objectInspection.loadNowEvents();
loadAtlas(viewTime === "now" ? undefined : viewTime);
requestRender({ data: true });

async function loadAtlas(timestampIso?: string) {
  if (timestampIso) viewTime = new Date(timestampIso).toISOString();
  const loadId = ++loadSequence;
  const showTimeBusy = loadingScreen.hidden;
  if (showTimeBusy) setTimeBusy(true);
  loadingView.begin();
  setLoading("api", 8, t("loading.connecting"));
  setError("");
  loadState.textContent = t("status.loading");

  try {
    const query = new URLSearchParams();
    query.set("groups", STARTUP_EPHEMERIS_GROUPS.join(","));
    if (timestampIso) query.set("timestamp", timestampIso);
    const preservedBodies = [selectedKey ? bodyByKey.get(selectedKey) : null, compareTargetKey ? bodyByKey.get(compareTargetKey) : null].filter(isPresent);
    const url = `/api/ephemeris${query.toString() ? `?${query.toString()}` : ""}`;
    setLoading("download", 28, t("loading.corePayload"));
    const response = await fetch(url);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `API request failed with ${response.status}`);
    }

    setLoading("parse", 64, t("loading.indexing"));
    const payload = (await response.json()) as Ephemeris;
    const payloadEarth = payload.bodies.find((body) => body.key === "earth");
    const propagatedPreservedBodies = await Promise.all(preservedBodies.map((body) => (
      resolveSmallBodyPosition(body, payload.timestamp_utc, payload.au_km, payloadEarth)
    )));
    if (loadId !== loadSequence) return; // A newer time change superseded this load.
    const bodies = mergeBodyList(payload.bodies, propagatedPreservedBodies);
    ephemeris = { ...payload, bodies };
    catalogSummary = catalogSummaryFromEphemeris(payload);
    void refreshCatalogSummary();
    bodyByKey = new Map(bodies.map((body) => [body.key, body]));
    viewportCatalogLoader.reset();
    catalogPointStream.cancel();
    catalogPointStream.clear(false);
    if (selectedKey && !bodyByKey.has(selectedKey) && !viewStateController.restoring && !viewStateController.hasPendingSelection) selectedKey = "";
    ensureCompareTarget();
    timeInput.value = toDatetimeLocalValue(new Date(payload.timestamp_utc));
    recentDestinations = readRecentDestinations();

    setLoading("render", 88, t("loading.controls"));
    updateAllUi();
    if (payload.bodies.length > 0 && activeZoomPreset && !bootViewState && !serverBootObjectKey) {
      applyZoomPreset(activeZoomPreset, false);
    }
    const selectionState = viewStateController.takePendingSelection();
    if (selectionState) await restoreSelectionFromViewState(selectionState);
    else if (serverBootObjectKey) await selectBodyByKey(serverBootObjectKey, { center: true });
    requestDataRefresh({ immediate: true });
    loadingScreen.hidden = true;
    loadState.textContent = t("status.ready");
    requestRender();
    scheduleViewStateReplace();
    startBootTour();
  } catch (error) {
    if (loadId !== loadSequence) return; // A newer load owns the UI state now.
    loadState.textContent = t("status.error");
    setError(error instanceof Error ? error.message : String(error));
    loadingDetail.textContent = t("error.unableLoad");
    loadingProgressLabel.textContent = t("status.error");
  } finally {
    if (showTimeBusy && loadId === loadSequence) setTimeBusy(false);
  }
}

function setTimeBusy(busy: boolean): void {
  atlasDom.timeBusy.hidden = !busy;
  atlasDom.timeNow.disabled = busy;
  atlasDom.applyTime.disabled = busy;
  atlasDom.timeStepBack.disabled = busy;
  atlasDom.timeStepForward.disabled = busy;
}

function bindEvents() {
  bindAtlasEvents({
    dom: atlasDom,
    state: {
      get viewTime() { return viewTime; }, set viewTime(value) { viewTime = value; },
      get sizeMode() { return sizeMode; }, set sizeMode(value) { sizeMode = value; },
      get displayLayers() { return displayLayers; }, set displayLayers(value) { displayLayers = value; },
      get performanceEnabled() { return perfEnabled; }, set performanceEnabled(value) { perfEnabled = value; },
    },
    mapInteraction,
    bindDestinations: () => bindDestinationEvents({
      state: {
        get activeGuidedSetId() { return activeGuidedSetId; }, set activeGuidedSetId(value) { activeGuidedSetId = value; },
        get activeFilter() { return activeFilter; }, set activeFilter(value) { activeFilter = value; },
        get activeCompareFilter() { return activeCompareFilter; }, set activeCompareFilter(value) { activeCompareFilter = value; },
        get activeTab() { return activeTab; }, set activeTab(value) { activeTab = value; },
        get compareTargetKey() { return compareTargetKey; }, set compareTargetKey(value) { compareTargetKey = value; },
      },
      catalogSearchState, compareSearchState, searchView: destinationSearchView, pointStream: catalogPointStream,
      inspection: objectInspection, bodyByKey: () => bodyByKey, bodyPickerConfig, comparePickerConfig,
      scheduleBodyPickerUpdate, scheduleComparePickerUpdate, updateBodyPicker, updateComparePicker,
      updateExploreDomains, updateGuidedSets, updateBodyFilters, updateCompareFilters, updateStats, updateComparePanel,
      focusSearchResult, focusCompareResult, selectBodyByKey, selectBody, setCompareTargetByKey, clearSelectedObject,
      setActiveTab, focusMapFilter, applyExploreDomain, fitBodies, centerOnSelected, updateScale: updateScaleUi,
      requestRender: (withData = false) => requestRender(withData ? { data: true } : {}), pushViewState: pushCurrentViewState,
    }),
    restoreTourStep: (step) => { void tourPlayer.restoreStep(step); },
    restoreViewState: (state) => { void restoreViewState(state); },
    exportCurrentView: () => { void exportCurrentView(); },
    shareCurrentView: (native) => { void shareCurrentView(native); },
    copyEmbedSnippet: () => { void copyEmbedSnippet(); },
    activateEmbedInteraction,
    loadAtlas: (timestamp) => { void loadAtlas(timestamp); },
    dateFromInput,
    updateTimeSummary, updateTimeStepUi, stepTime, applyZoomPreset, zoomViewportCenter, setZoomFromSlider,
    updateSizeModes, updateDisplayToggles, updatePerformanceHud: updatePerfHud, updateAllUi, resizeCanvas,
    updateSelectedPanelMetrics, requestRender: (data = false) => requestRender(data ? { data: true } : {}),
    scheduleViewStateReplace, translate: t,
  });
}

function initializeEmbedMode() { embedController.initialize(); }
function activateEmbedInteraction() { embedController.activate(); }
function updateEmbedAttribution() { sharingController.updateEmbedAttribution(); }
async function copyEmbedSnippet() { await sharingController.copyEmbedSnippet(); }
async function exportCurrentView() { await sharingController.exportCurrentView(); }
function applyDecodedViewStateFields(state: ViewState) { viewStateController.applyFields(state); }
function currentViewState(): ViewState { return viewStateController.current(); }
function replaceCurrentViewState() { viewStateController.replace(); }
function scheduleViewStateReplace() { viewStateController.scheduleReplace(); }
function pushCurrentViewState() { viewStateController.push(); }
async function restoreSelectionFromViewState(state: ViewState) { await viewStateController.restoreSelection(state); }
async function restoreViewState(state: ViewState) { await viewStateController.restore(state); }

function startBootTour() {
  if (tourBootHandled || isEmbedMode) return;
  const params = new URLSearchParams(window.location.search), slug = params.get("tour");
  if (!slug) return;
  tourBootHandled = true;
  const step = Number(params.get("step") ?? "0");
  void tourPlayer.start(slug, Number.isSafeInteger(step) && step >= 0 ? step : 0);
}

async function navigateTourStep(state: ViewState, options: { animate: boolean; slug: string; step: number; restoring: boolean; signal: AbortSignal }) { await viewStateController.navigateTour(state, options); }
function prewarmTourStep(state: ViewState) { viewStateController.prewarmTour(state); }
async function shareCurrentView(preferNative: boolean) { await sharingController.share(preferNative); }

function initializeUi() {
  bodySearch.setAttribute("aria-controls", bodyPicker.id);
  bodySearch.setAttribute("aria-autocomplete", "list");
  compareSearch.setAttribute("aria-controls", comparePicker.id);
  compareSearch.setAttribute("aria-autocomplete", "list");
  updateTabs();
  updateExploreDomains();
  updateBodyFilters();
  updateCompareFilters();
  updateSizeModes();
  updateDisplayToggles();
  updateContextModeStatus();
  updateCompareUi();
  updateTimeStepUi();
  updateScaleUi();
}

function updateAllUi() {
  updateStats();
  updateSelectedSummary();
  updateQuickFocus();
  updateTabs();
  updateExploreDomains();
  updateBodyFilters();
  updateCompareFilters();
  updateBodyPicker();
  updateGuidedSets();
  objectInspection.update();
  updateCompareUi();
  updateTimeSummary();
  updateTimeStepUi();
  updateSizeModes();
  updateDisplayToggles();
  updateContextModeStatus();
  updateScaleUi();
  updateSelectedPanelMetrics();
  selectionConnector.update();
  updateEmbedAttribution();
}

function render() {
  const frameStartedAt = performance.now();
  const previousFrameAt = perfLastFrameAt;
  perfLastFrameAt = frameStartedAt;
  perfFrameMs = frameStartedAt - previousFrameAt;
  renderFrameId = null;
  atlasVisibility.invalidate();
  resizeCanvas();
  selectionConnector.update();
  atlasViewport.beginFrame();
  const dpr = renderScale();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  try {
    if (ephemeris) {
      catalogLayerRenderer.prepare();
      if (displayLayers.milkyWay) drawMilkyWayLayer();
      if (displayLayers.grid) atlasOverlay.drawGrid();
      if (displayLayers.orbits) atlasOverlay.drawOrbitGuides();
      atlasOverlay.drawComparisonGuide();
      atlasOverlay.drawBodies();
      if (displayLayers.labels) atlasOverlay.drawLabels();
      if (displayLayers.references) atlasOverlay.drawEdgeReferences();
    } else {
      pointRenderer.clear();
    }
  } finally {
    atlasViewport.endFrame();
  }
  perfDrawMs = performance.now() - frameStartedAt;
  updatePerfHud();
  objectInspection.updateScienceLayerDisclosure();
}

function requestRender(options: RenderRequestOptions = {}) {
  if (isEmbedMode && !embedController.visible) return;
  atlasVisibility.invalidate();
  if (options.data) requestDataRefresh();
  if (renderFrameId !== null) return;
  renderFrameId = requestAnimationFrame(render);
}

function requestDataRefresh(options: DataRefreshOptions = {}) {
  if (isEmbedMode && !embedController.visible) return;
  if (cameraDataRefreshTimer !== null) {
    window.clearTimeout(cameraDataRefreshTimer);
    cameraDataRefreshTimer = null;
  }
  viewportCatalogLoader.schedule(options);
  catalogPointStream.schedule(options);
}

function scheduleCameraDataRefresh() {
  if (cameraDataRefreshTimer !== null) window.clearTimeout(cameraDataRefreshTimer);
  cameraDataRefreshTimer = window.setTimeout(() => {
    cameraDataRefreshTimer = null;
    requestDataRefresh();
  }, CAMERA_DATA_REFRESH_DEBOUNCE_MS);
  scheduleViewStateReplace();
}

function drawMilkyWayLayer() { perfMilkyWayMs = milkyWayRenderer.draw(perfMilkyWayMs); }
function updateStats() { statsView.updateStats(); }
function updatePerfHud() { statsView.updatePerfHud(); }

function catalogSummaryFromEphemeris(payload: Ephemeris): CatalogSummary | null {
  if (!payload.catalog?.object_count) return null;
  return {
    object_count: payload.catalog.object_count,
    group_counts: payload.catalog.group_counts
  };
}

async function refreshCatalogSummary() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`Catalog summary failed with ${response.status}`);
    catalogSummary = (await response.json()) as CatalogSummary;
    updateStats();
    updateExploreDomains();
    updateBodyFilters();
  } catch (error) {
    console.warn("Phoenix catalog summary unavailable.", error);
  }
}

function updateSelectedSummary() { controlView.updateSelectedSummary(selectedBody(), formatDistance); }

function updateSelectedPanelMetrics() {
  mapHud.classList.remove("has-selected-object");
  mapHud.style.removeProperty("--selected-panel-bottom");
}

function updateQuickFocus() { controlView.updateQuickFocus(bodyByKey); }

function updateTabs() {
  activeTab = controlView.updateTabs(activeTab, Boolean(selectedBody()));
}

function setActiveTab(tab: ActiveAtlasTab) {
  if (tab === "object" && !selectedBody()) {
    activeTab = null;
    updateTabs();
    requestRender();
    return;
  }
  activeTab = tab;
  updateTabs();
  if (activeTab === "catalog") bodySearch.focus();
  requestRender();
}

function updateBodyFilters() { destinationController.updateBodyFilters(); }
function updateExploreDomains() { destinationController.updateExploreDomains(); }
function applyExploreDomain(domainId: string) { void destinationController.applyExploreDomain(domainId); }
function updateCompareFilters() { destinationController.updateCompareFilters(); }
function focusMapFilter(filterKey: BodyFilter) { destinationController.focusMapFilter(filterKey); }
function activeBodyFilterDefinition() { return destinationCatalog.activeFilter(); }
function bodyMatchesActiveFilter(body: Body) { return bodyMatchesFilter(body, activeBodyFilterDefinition()); }
function bodyMatchesFilter(body: Body, filter: BodyFilterDefinition) { return destinationCatalog.matches(body, filter); }

async function loadCatalogTileManifest() {
  await catalogPointManifest.load();
  updatePerfHud();
  if (ephemeris) requestDataRefresh({ immediate: true });
}

function catalogPointViewport(): CatalogPointViewport {
  const rect = usableViewportRect();
  return {
    camera: { ...camera },
    viewportWidthPx: rect.width,
    viewportHeightPx: rect.height,
    viewWidthLy: currentViewWidthLy(),
    visibleBounds: viewportCatalogLoader.bounds(0),
    filter: activeBodyFilterDefinition(),
    embed: isEmbedMode
  };
}

async function updateBodyPicker() { await destinationController.updateBodyPicker(); }
function bodyPickerConfig(): DestinationSearchConfig | null { return destinationController.bodyPickerConfig(); }
function scheduleBodyPickerUpdate() { destinationController.scheduleBodyPicker(); }
function scheduleComparePickerUpdate() { destinationController.scheduleComparePicker(); }
function updateGuidedSets() { destinationController.updateGuidedSets(); }
function updateCompareUi() { destinationController.updateCompareUi(); }
async function updateComparePicker() { await destinationController.updateComparePicker(); }
function comparePickerConfig(): DestinationSearchConfig | null { return destinationController.comparePickerConfig(); }
function updateComparePanel() { destinationController.updateComparePanel(); }

function updateTimeSummary() { timeController.updateSummary(); }
function updateTimeStepUi() { timeController.updateStep(); }
function stepTime(direction: -1 | 1) { timeController.step(direction); }

function updateSizeModes() { controlView.updateSizeModes(sizeMode); }
function updateDisplayToggles() { controlView.updateDisplayToggles(displayLayers, perfEnabled); }
function updateContextModeStatus() { updateScaleUi(); }

function updateScaleUi() {
  const scaleAu = currentViewWidthAu();
  const zoomLevel = zoomToSliderValue(camera.pxPerAu);
  controlView.updateScale({ viewWidthAu: scaleAu, viewWidthLy: scaleAu / AU_PER_LIGHT_YEAR, pxPerAu: camera.pxPerAu, auKm: auKm(), zoomLevel, sliderSteps: ZOOM_SLIDER_STEPS, formatDistance, displayLayers });
}

function currentViewWidthAu() { return Math.max(0.000001, usableViewportRect().width / camera.pxPerAu); }

function currentViewWidthLy() { return currentViewWidthAu() / AU_PER_LIGHT_YEAR; }
async function focusSearchResult() { await destinationController.focusPrimaryResult(); }
async function focusCompareResult() { await destinationController.focusCompareResult(); }
async function setCompareTargetByKey(key: string) { await objectSelection.setCompareTargetByKey(key); }
async function selectBodyByKey(key: string, options: SelectBodyOptions = {}) { await objectSelection.selectByKey(key, options); }
function selectBody(key: string, options: SelectBodyOptions = {}) { objectSelection.select(key, options); }
function clearSelectedObject(options: { openSearch?: boolean; preserveMapDetailRequest?: boolean } = {}) { objectSelection.clear(options); }

function mergeBodies(bodies: readonly Body[]) {
  if (!ephemeris || bodies.length === 0) return;
  ephemeris = { ...ephemeris, bodies: mergeBodyList(ephemeris.bodies, bodies) };
  for (const body of ephemeris.bodies) {
    bodyByKey.set(body.key, body);
  }
}

function mergeBodyList(primaryBodies: readonly Body[], fallbackBodies: readonly Body[]) {
  const merged = new Map(primaryBodies.map((body) => [body.key, body]));
  for (const body of fallbackBodies) {
    const existing = merged.get(body.key);
    if (!existing || (existing.catalog?.preview && !body.catalog?.preview)) merged.set(body.key, body);
  }
  return Array.from(merged.values());
}

function centerOnSelected(zoom: boolean) {
  const body = selectedBody();
  if (!body) return;
  centerOnBody(body, zoom, zoom);
  requestRender({ data: true });
}

function centerOnBody(body: Body, zoom: boolean, animate = false) { cameraController.centerOnBody(body, zoom, animate); }
function animateCameraTo(target: Camera, durationMs = LOCAL_ZOOM_DURATION_MS, onComplete?: () => void) { cameraController.animateTo(target, durationMs, onComplete); }
function cancelCameraAnimation() { cameraController.cancelAnimation(); }

function applyZoomPreset(preset: ZoomPreset, update = true) {
  activeZoomPreset = preset;
  if (!ephemeris) return;
  if (preset === "galaxy") {
    fitMilkyWayModel(0.14);
  } else if (preset === "localGroup") {
    fitPhysicalScale(5_000_000, 0.12);
  } else if (preset === "cosmicWeb") {
    fitPhysicalScale(4_000_000_000, 0.10);
  } else {
    const bodies = zoomPresetBodies(preset, ephemeris, bodyByKey);
    if (bodies.length > 0) fitBodies(bodies, 0.16);
  }
  updateZoomPresetButtons();
  updateScaleUi();
  if (update) {
    requestRender();
    requestDataRefresh({ immediate: true });
    pushCurrentViewState();
  }
}

function updateZoomPresetButtons() { controlView.updateZoomPresets(activeZoomPreset); }
function fitBodies(bodies: Body[], paddingRatio: number) { cameraController.fitBodies(bodies, paddingRatio); }

function fitMilkyWayModel(paddingRatio: number) {
  const bounds = MILKY_WAY_MODEL.bounds;
  cameraController.cancelAnimation();
  cameraController.fitWorldBounds(bounds.minXAu, bounds.maxXAu, bounds.minYAu, bounds.maxYAu, paddingRatio);
}

function fitPhysicalScale(widthLy: number, paddingRatio: number) { cameraController.fitPhysicalScale(widthLy, paddingRatio); }
function zoomViewportCenter(factor: number) { cameraController.zoomViewportCenter(factor); }
function setZoomFromSlider() { cameraController.setFromSlider(Number(zoomScaleSlider.value)); }
function zoomToSliderValue(pxPerAu: number) { return cameraController.zoomToSliderValue(pxPerAu); }
function zoomAt(x: number, y: number, factor: number, clearPreset = false, dataMode: "immediate" | "deferred" | "none" = "immediate") { cameraController.zoomAt(x, y, factor, clearPreset, dataMode); }
async function handleMapClick(point: ScreenPoint) { await mapSelection.handleClick(point); }

function removeMergedBody(key: string) {
  if (ephemeris) ephemeris = { ...ephemeris, bodies: ephemeris.bodies.filter((body) => body.key !== key) };
  bodyByKey.delete(key);
  atlasVisibility.invalidate();
  catalogLayerRenderer.invalidateBodies();
  requestRender();
}

function nearestBodyAt(x: number, y: number) { return atlasVisibility.nearestBody(x, y); }
function nearestCatalogTilePointAt(x: number, y: number): CatalogPointHitEntry | null { return atlasVisibility.nearestCatalogPoint(x, y); }

function edgeReferenceAt(x: number, y: number) {
  const body = atlasOverlay.edgeReferenceAt(x, y);
  return body ? { body } : null;
}

function visibleBodies() { return atlasVisibility.visibleBodies(); }
function prioritizedLabelBodies() { return atlasVisibility.prioritizedLabelBodies(); }
function edgeReferenceBodies() { return atlasVisibility.edgeReferenceBodies(); }
function bodyDisplayRadiusPx(body: Body) { return atlasVisibility.bodyDisplayRadiusPx(body); }
function bodyRadiusAu(body: Body) { return atlasVisibility.bodyRadiusAu(body); }
function isPointLayerDuplicateBody(body: Body) { return atlasVisibility.isPointLayerDuplicateBody(body); }
function selectedBody(): Body | null { return objectSelection.selectedBody(); }
function compareTarget(): Body | null { return objectSelection.compareTarget(); }
function ensureCompareTarget() { objectSelection.ensureCompareTarget(); }

function bodyDistanceKm(a: Body, b: Body) {
  return (
    Math.hypot(
      a.position.x_au - b.position.x_au,
      a.position.y_au - b.position.y_au,
      a.position.z_au - b.position.z_au
    ) * auKm()
  );
}

function worldToScreen(xAu: number, yAu: number): ScreenPoint { return atlasViewport.worldToScreen(xAu, yAu); }
function bodyToScreen(body: Body): ScreenPoint { return worldToScreen(body.position.x_au, body.position.y_au); }
function screenToWorld(x: number, y: number) { return atlasViewport.screenToWorld(x, y); }
function usableViewportRect(): Rect { return atlasViewport.rect(); }
function renderScale() { return atlasViewport.renderScale(); }
function resizeCanvas() { atlasViewport.resize(); }

function setLoading(step: LoadingStep, progress: number, detail: string) { loadingView.update(step, progress, detail); }
function setError(message: string) { loadingView.setError(message); }

function dateFromInput() { return timeController.dateFromInput(); }

function auKm() { return ephemeris?.au_km ?? AU_KM_FALLBACK; }
