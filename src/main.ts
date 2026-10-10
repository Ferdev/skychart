import { AU_KM_FALLBACK, MIN_ZOOM, MAX_ZOOM, ZOOM_SLIDER_STEPS, LOCAL_ZOOM_DURATION_MS, CAMERA_DATA_REFRESH_DEBOUNCE_MS, SEARCH_INPUT_DEBOUNCE_MS } from "./atlas/atlasConstants";
import { community } from "./community/communityController";
import { SpacecraftLoader } from "./catalog/spacecraftCatalog";
import { loadAtlasEphemeris } from "./atlas/atlasEphemerisLoader";
import "./destinationPicker.css";
import "./styles.css";
import { readRecentDestinations, type RecentDestination } from "./destinationPicker";
import { AU_PER_LIGHT_YEAR, MILKY_WAY_MODEL } from "./galacticModel";
import { initI18n, locale, t } from "./i18n";
import { dataLabelText } from "./i18n/dataLabels";
import { WebglPointRenderer } from "./webglPointRenderer";
import { installAnalytics, trackEvent } from "./analytics";
import { initializeErrorReporting } from "./errorReporting";
import { decodeSkyPermalink, decodeViewState, skyPermalinkToViewState, type BodyFilter, type DisplayLayer, type ViewState } from "./viewState";
import { TourPlayer } from "./tourPlayer";
import { bodyDistanceKm as calculateBodyDistanceKm, formatLightYears, formatNumber } from "./atlasFormatting";
import { formatDateTime } from "./format/quantity";
import { isPresent, type Rect, type ScreenPoint } from "./geometry";
import { CatalogPointDecoder } from "./catalog/catalogPointDecoder";
import { CatalogPointManifestRepository } from "./catalog/catalogPointManifest";
import { CatalogPointPlanner, type CatalogPointViewport } from "./catalog/catalogPointPlanner";
import { CatalogObjectMapper } from "./catalog/catalogObjectMapper";
import { smallBodyOrbitPathForBody } from "./catalog/smallBodyOrbit";
import { CatalogPointStream } from "./catalog/catalogPointStream";
import { CatalogPointSelector } from "./catalog/catalogPointSelector";
import { ObjectInspectionView, normalizeExternalLinks } from "./object/objectInspectionView";
import { SelectionConnectorView } from "./object/selectionConnectorView";
import { CatalogSearchGateway } from "./catalog/catalogSearchGateway";
import { DestinationSearchView, type DestinationSearchConfig, type DestinationSearchState } from "./destination/destinationSearchView";
import { MilkyWayRenderer } from "./rendering/milkyWayRenderer";
import { ConstellationOverlay } from "./atlas/constellationOverlay";
import { ObjectComparisonView } from "./object/objectComparisonView";
import { AtlasOverlayRenderer } from "./rendering/atlasOverlayRenderer";
import { AtlasVisibilityModel, isSolarSystemBody } from "./rendering/atlasVisibilityModel";
import { atlasDom } from "./atlas/atlasDom";
import { AtlasRefreshScheduler } from "./atlas/atlasRefreshScheduler";
import { UniverseEntryMarker } from "./atlas/universeEntryMarker";
import { loadNowEvents } from "./atlas/nowEventsView";
import { updateScienceLayerDisclosure } from "./atlas/scienceLayerDisclosure";
import { FEATURED_KEYS, TIME_STEPS, universeShellForRadius, zoomPresetBodies } from "./atlas/atlasDefinitions";
import { followCuratedSummaryLocale, mediaTextFor } from "./object/curatedSummaryLocales";
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
import { pickMapTarget } from "./rendering/bodyPick";
import { AtlasEmbedController } from "./atlas/atlasEmbedController";
import { AtlasTimeController } from "./atlas/atlasTimeController";
import { AtlasLoadingView } from "./atlas/atlasLoadingView";
import { AtlasDeferredEphemerisController } from "./atlas/atlasDeferredEphemerisController";
import { catalogSummaryFromEphemeris, createDefaultDisplayLayers, fetchCatalogSummary, mergeBodyList, replaceBodyList } from "./atlas/atlasState";
import { ExoplanetSystemNavigator } from "./object/exoplanetSystemNavigator";
import { bodyCanObserveSky, createSkyViewController, SkyViewController } from "./sky/skyViewController"; import type { UniverseViewController } from "./universe/universeViewController"; import { createUniverseViewController, initialUniverseState } from "./universe/universeViewFactory";
import type {
  ActiveAtlasTab, SizeMode, ZoomPreset, Body, Ephemeris, CatalogSummary, ObjectDetailHydrationState,
  Camera, LoadingStep, RenderRequestOptions, SelectBodyOptions, DataRefreshOptions, CatalogPointHitEntry,
  BodyFilterDefinition,
} from "./atlas/contracts";

initializeErrorReporting();
installAnalytics();

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
  loadingStepLabel, loadingElapsed, loadState, selectedObjectPanel, workspacePanel, bodySearch, bodyPicker,
  bodyInfo, nowStatus, nowEvents, compareHeading, compareSearch, comparePicker, comparePanel, timeSummary, timeInput,
  zoomScaleSlider, scienceLayerDisclosure, errorPanel, embedActivation, embedAttribution,
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
const skyRouteRequested = /^\/sky\/[^/]+\/?$/.test(window.location.pathname);
const bootSkyPermalink = decodeSkyPermalink(window.location.pathname, window.location.search);
const bootViewState = bootSkyPermalink
  ? skyPermalinkToViewState(bootSkyPermalink)
  : decodeViewState(window.__ATLAS_BOOT__?.viewState ?? window.location.search);
const invalidSkyRoute = skyRouteRequested && !bootSkyPermalink && !bootViewState?.sky;
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
let displayLayers: Record<DisplayLayer, boolean> = createDefaultDisplayLayers();
let camera: Camera = { xAu: 0, yAu: 0, pxPerAu: 24 };
let viewTime: "now" | string = "now";
let loadSequence = 0;
let tourBootHandled = false;
let hoverKey: string | null = null;
let compareTargetKey: string | null = null;
let recentDestinations: RecentDestination[] = readRecentDestinations();
const catalogSearchState: DestinationSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
const compareSearchState: DestinationSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
let catalogSummary: CatalogSummary | null = null;
const objectDetailHydrationStates = new Map<string, ObjectDetailHydrationState>();
let perfEnabled = new URLSearchParams(window.location.search).has("perf") || window.localStorage.getItem("starsmap:perf") === "1";
let perfLastFrameAt = performance.now();
let perfFrameMs = 0;
let perfDrawMs = 0;
let perfHitTestMs = 0;
let perfLastViewportMs = 0;
let perfMilkyWayMs = 0;
let perfViewportLoads = 0; let skyView: SkyViewController | null = null; let universeView: UniverseViewController | null = null;

const atlasState = {
  get selectedKey() { return selectedKey; }, set selectedKey(value) { selectedKey = value; },
  get compareTargetKey() { return compareTargetKey; }, set compareTargetKey(value) { compareTargetKey = value; },
  get activeTab() { return activeTab; }, set activeTab(value) { activeTab = value; },
  get activeFilter() { return activeFilter; }, set activeFilter(value) { activeFilter = value; },
  get activeCompareFilter() { return activeCompareFilter; }, set activeCompareFilter(value) { activeCompareFilter = value; },
  get activeGuidedSetId() { return activeGuidedSetId; }, set activeGuidedSetId(value) { activeGuidedSetId = value; },
  get recentDestinations() { return recentDestinations; }, set recentDestinations(value) { recentDestinations = value; },
  get camera() { return camera; }, set camera(value) { camera = value; },
  get viewTime() { return viewTime; }, set viewTime(value) { viewTime = value; },
  get activeZoomPreset() { return activeZoomPreset; }, set activeZoomPreset(value) { activeZoomPreset = value; },
  get displayLayers() { return displayLayers; }, set displayLayers(value) { displayLayers = value; },
  get sizeMode() { return sizeMode; }, set sizeMode(value) { sizeMode = value; },
  get performanceEnabled() { return perfEnabled; }, set performanceEnabled(value) { perfEnabled = value; },
};
const scientificFormat = new ScientificValueFormatter(auKm);
const { formatDistance } = scientificFormat;
const viewportCatalogLoader = new ViewportCatalogLoader({
  mapper: catalogObjectMapper,
  canLoad: () => Boolean(ephemeris),
  viewWidthLy: currentViewWidthLy,
  filter: activeBodyFilterDefinition,
  worldBounds: (paddingRatio) => atlasViewport.worldBounds(paddingRatio),
  hasBody: (key) => bodyByKey.has(key),
  mergeBodies,
  afterMerge: () => {
    updateStats();
    updateGuidedSets();
    if (activeTab === "catalog" && !bodySearch.value.trim()) void updateBodyPicker();
    requestRender({ data: true }); // New planets can move a system to the object path, so the tile plan runs again.
  },
  recordLoad: (milliseconds) => {
    perfLastViewportMs = milliseconds;
    perfViewportLoads += 1;
    updatePerfHud();
  },
});
const refreshScheduler = new AtlasRefreshScheduler({
  canRender: () => !universeView?.active && (!isEmbedMode || embedController.visible),
  canLoadData: () => !isEmbedMode || embedController.visible,
  render,
  invalidate: () => atlasVisibility.invalidate(),
  viewportLoader: viewportCatalogLoader,
  pointStream: catalogPointStream,
  viewStateChanged: scheduleViewStateReplace,
  cameraDebounceMs: CAMERA_DATA_REFRESH_DEBOUNCE_MS,
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
  zoomAt: (x, y, factor, clearPreset, dataMode) => cameraController.zoomAt(x, y, factor, clearPreset, dataMode),
  edgeReferenceAt,
  nearestBodyAt,
  nearestCatalogPointAt: nearestCatalogTilePointAt,
  handleClick: (point) => mapSelection.handleClick(point),
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  scheduleViewStateReplace,
});
const sharingController = new AtlasSharingController({
  isEmbedMode,
  viewState: () => viewStateController.current(),
  selectedBody,
  camera: () => camera, viewportRect: usableViewportRect,
  ephemeris: () => ephemeris,
  pointRenderer,
  manifest: catalogPointManifest,
  preparePointLayers: () => catalogLayerRenderer.prepare(),
  replaceViewState: () => viewStateController.replace(),
  requestRender: () => requestRender(),
});
atlasVisibility = new AtlasVisibilityModel({
  frame: () => ({
    ephemeris,
    camera,
    viewport: usableViewportRect(),
    renderViewport: atlasViewport.renderRect(),
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
  renderRect: () => atlasViewport.renderRect(),
  renderScale,
  camera: () => camera,
  ephemerisTimestamp: () => ephemeris?.timestamp_utc ?? "",
  visibleBodies,
  selectedBody,
  selectedKey: () => selectedKey,
  hoverKey: () => hoverKey,
  isDuplicateBody: (body) => atlasVisibility.isPointLayerDuplicateBody(body),
  bodyRadiusAu: (body) => atlasVisibility.bodyRadiusAu(body),
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
const timeController: AtlasTimeController = new AtlasTimeController({
  bars: [
    { root: atlasDom.timeBar, ids: { back: "time-step-back", forward: "time-step-forward", date: "time-date", stepSize: "time-step-size", play: "time-play", now: "time-now", busy: "time-busy" } },
    { root: atlasDom.skyTimeBar, ids: { back: "sky-time-back", forward: "sky-time-forward" } },
    { root: atlasDom.universeTimeBar },
  ],
  popover: atlasDom.timePopover, timeSummary, timeInput, applyButton: atlasDom.applyTime, popoverStepSize: atlasDom.timePopoverStepSize, popoverPlay: atlasDom.timePopoverPlay, popoverNow: atlasDom.timePopoverNow, steps: TIME_STEPS, defaultStepIndex: 2,
  ephemeris: () => ephemeris, isNow: () => viewTime === "now", formatDate: formatFullDate, toLocalInput: toDatetimeLocalValue,
  formatBarDate: (timestamp, timeZone) => formatDateTime(timestamp, { dateStyle: "medium", timeStyle: "short", timeZone }),
  translate: t, loadAtlas: (timestamp) => { if (!timestamp) viewTime = "now"; void loadAtlas(timestamp); },
  // Play loads the core bodies only for each step. The moons of Jupiter and Saturn come at the pause.
  playbackChanged: (state) => { if (!state.playing && ephemeris) deferredEphemerisLoader.load(ephemeris.timestamp_utc, null); },
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
    renderViewport: atlasViewport.renderRect(),
    visibleBodies: visibleBodies(),
    labelBodies: atlasVisibility.prioritizedLabelBodies(),
    edgeBodies: atlasVisibility.edgeReferenceBodies(), exoplanetOrbits: atlasVisibility.resolvedExoplanets(), solarSystemCollapsed: atlasVisibility.solarSystemCollapsed(), scaleBarOrigin: atlasViewport.scaleBarOrigin(),
  }),
  bodyByKey: () => bodyByKey, universeEntryMarker: new UniverseEntryMarker(atlasDom.universeEntryMarker, atlasDom.universeToggle), exoplanetOrbitNote: atlasDom.exoplanetOrbitNote, toolbar: atlasDom.atlasToolbar,
  bodyToScreen,
  worldToScreen,
  screenToWorld,
  bodyDisplayRadiusPx: (body) => atlasVisibility.bodyDisplayRadiusPx(body),
  bodyMatchesActiveFilter,
  isSolarSystemBody,
  currentViewWidthAu,
  pxPerAu: () => camera.pxPerAu,
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
  drawLabel: atlasOverlay.drawLabel, labelText: dataLabelText,
});
const constellationRenderer = new ConstellationOverlay({
  stateChanged: scheduleViewStateReplace,
  context: ctx,
  bodyByKey: () => bodyByKey,
  worldToScreen,
  viewport: usableViewportRect,
  requestRender: () => requestRender(),
});
const objectComparison = new ObjectComparisonView({
  heading: compareHeading,
  panel: comparePanel, actions: atlasDom.compareActions,
  auKm,
  distanceKm: bodyDistanceKm,
  formatDistance,
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
const exoplanetSystems = new ExoplanetSystemNavigator({
  root: bodyInfo, mapper: catalogObjectMapper, body: (key) => bodyByKey.get(key), bodies: () => ephemeris?.bodies ?? [], mergeBodies, viewport: usableViewportRect, maximumZoom: MAX_ZOOM,
  animateCameraTo: (target) => { activeZoomPreset = null; updateZoomPresetButtons(); animateCameraTo(target, LOCAL_ZOOM_DURATION_MS, scheduleViewStateReplace); },
});
const tourPlayer = new TourPlayer({ navigate: (state, options) => viewStateController.navigateTour(state, options), prewarm: (state) => viewStateController.prewarmTour(state), track: (event, properties) => trackEvent(event, properties), translate: t, closed: () => viewStateController.endTour() });
const objectInspection: ObjectInspectionView = new ObjectInspectionView({
  bodyInfo,
  hydrationStates: objectDetailHydrationStates,
  manifest: catalogPointManifest,
  curatedSummaries: followCuratedSummaryLocale(locale, () => { if (ephemeris) updateAllUi(); }), mediaText: mediaTextFor(locale, t),
  selectedBody,
  bodyByKey: () => bodyByKey,
  ephemeris: () => ephemeris,
  currentViewWidthLy,
  universeShellForRadius,
  formatLightYears,
  ...scientificFormat,
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
  active: () => activeTab === "object" && !selectedObjectPanel.hidden && atlasVisibility.hasMapMarker(selectedBody()),
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
  state: atlasState,
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
  state: atlasState,
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
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  translate: t,
  searchDebounceMs: SEARCH_INPUT_DEBOUNCE_MS,
});
const viewStateController = new AtlasViewStateController({
  constellations: constellationRenderer,
  state: atlasState,
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
  dismissSelection: () => objectSelection.dismiss(),
  updateAllUi,
  updateScale: updateScaleUi,
  requestRender: (withData = false) => requestRender(withData ? { data: true } : {}),
  requestDataRefresh: () => requestDataRefresh({ immediate: true }),
  loadAtlas,
  animateCameraTo,
  skyState: () => skyView?.state(), restoreSky: (state) => skyView?.restore(state) ?? Promise.resolve(), universeState: () => universeView?.state(), restoreUniverse: (state) => universeView?.restore(state),
}, bootViewState);
skyView = createSkyViewController(atlasDom, {
  bodyByKey: () => bodyByKey,
  ephemeris: () => ephemeris,
  translate: t,
  selectBody: selectBodyByKey,
  stateChanged: (mode) => mode === "push" ? pushCurrentViewState() : scheduleViewStateReplace(),
  resolveObserver: async (key) => bodyByKey.get(key) ?? (await objectHydrator.hydrateMany([key]))[0] ?? null,
  catalogRelease: () => catalogPointManifest.value?.version,
  locale, closeInspector: () => setActiveTab(null),
});
universeView = createUniverseViewController(atlasDom, { bodyByKey: () => bodyByKey, selectedBody, translate: t, selectBody: selectBodyByKey, inspectInAtlas: (key) => { const body = bodyByKey.get(key); if (body) { centerOnBody(body, false); requestRender({ data: true }); } }, searchDestinations: async (query, signal) => (await catalogSearchGateway.search({ query, limit: 12, signal })).bodies, loadPlanetarySystem: (host) => exoplanetSystems.load(host), openSky: (body, origin) => skyView?.open(body, undefined, skyReturnTo3d(origin)) ?? Promise.resolve(), closeInspector: () => setActiveTab(null), destinationSuggestions: () => ({ suggested: FEATURED_KEYS.flatMap((key) => bodyByKey.get(key) ?? []), recent: recentDestinations.slice(0, 6).flatMap((recent) => bodyByKey.get(recent.key) ?? []) }), stateChanged: (mode) => mode === "push" ? pushCurrentViewState() : scheduleViewStateReplace(), closeSky: () => skyView?.close({ updateHistory: false }), resumeAtlas: () => requestRender(), initialState: () => initialUniverseState({ x: camera.xAu, y: camera.yAu }, usableViewportRect().width / camera.pxPerAu / 12, selectedBody(), bodyByKey.values()) });
const embedController: AtlasEmbedController = new AtlasEmbedController({
  enabled: isEmbedMode,
  canvas,
  activation: embedActivation,
  attribution: embedAttribution,
  pointStream: catalogPointStream,
  viewportLoader: viewportCatalogLoader,
  updateAttribution: () => sharingController.updateEmbedAttribution(),
  cancelCameraAnimation,
  suspendRendering: () => refreshScheduler.suspend(),
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
  gestureState: () => mapInteraction.diagnostics(), visibility: () => atlasVisibility, drawnLabels: () => [...atlasOverlay.drawnLabels()], drawnEdgePointers: () => [...atlasOverlay.drawnEdgeReferences()], skyLabels: () => skyView?.labels() ?? [], universeLabels: () => universeView?.labels() ?? [],
});

const spacecraftLoader = new SpacecraftLoader((bodies) => {
  // Generic catalog merging retains already-hydrated records. Dated mission
  // states must replace them, including transitions to an unavailable position.
  if (ephemeris) ephemeris = { ...ephemeris, bodies: ephemeris.bodies.filter(body => body.object_type !== "spacecraft") };
  mergeBodies(bodies);
  objectSelection.positionsUpdated();
  updateAllUi();
  requestRender();
}, () => selectedKey);
const deferredEphemerisLoader = new AtlasDeferredEphemerisController({
  serverBootObjectKey, hasBody: (key) => bodyByKey.has(key), restoreSelection: restoreSelectionFromViewState,
  selectServerBoot: (key) => selectBodyByKey(key, { center: true, zoom: "local" }),
  applyBodies: (bodies) => {
    if (!ephemeris) return;
    ephemeris = { ...ephemeris, bodies: replaceBodyList(ephemeris.bodies, bodies) };
    for (const body of bodies) bodyByKey.set(body.key, body);
    objectSelection.positionsUpdated(); updateAllUi(); requestRender();
  },
});

if (bootViewState) viewStateController.applyFields(bootViewState);
if (isEmbedMode) embedController.initialize();

resizeCanvas();
document.body.classList.add("app-started"); initI18n();
bindEvents();
initializeUi();
void loadCatalogTileManifest();
void loadNowEvents(nowStatus, nowEvents, atlasDom.nowShowAll);
loadAtlas(viewTime === "now" ? undefined : viewTime);
requestRender({ data: true });

async function loadAtlas(timestampIso?: string) {
  if (timestampIso) viewTime = new Date(timestampIso).toISOString();
  const loadId = ++loadSequence;
  deferredEphemerisLoader.cancel();
  spacecraftLoader.stop();
  const showTimeBusy = loadingScreen.hidden;
  if (showTimeBusy) setTimeBusy(true);
  loadingView.begin();
  setLoading("api", 8, t("loading.connecting"));
  setError("");
  loadState.textContent = t("status.loading");

  try {
    const preservedBodies = [selectedKey ? bodyByKey.get(selectedKey) : null, compareTargetKey ? bodyByKey.get(compareTargetKey) : null, skyView?.observerBody()].filter(isPresent);
    setLoading("download", 28, t("loading.corePayload"));
    const { payload, bodies } = await loadAtlasEphemeris(timestampIso, preservedBodies, () => {
      setLoading("parse", 64, t("loading.indexing"));
    });
    if (loadId !== loadSequence) return; // A newer time change superseded this load.
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
    else if (serverBootObjectKey) await selectBodyByKey(serverBootObjectKey, { center: true, zoom: "local" });
    else if (invalidSkyRoute) skyView?.showUnavailable(t("sky.invalidLink"));
    if (skyView?.active && !selectionState?.sky) await skyView.refreshForTime(); if (universeView?.active && !selectionState?.universe) universeView.refreshForTime();
    requestDataRefresh({ immediate: true });
    loadingScreen.hidden = true;
    loadState.textContent = t("status.ready");
    requestRender();
    scheduleViewStateReplace();
    startBootTour();
    spacecraftLoader.start(payload.timestamp_utc);
    if (!timeController.playing) deferredEphemerisLoader.load(payload.timestamp_utc, selectionState);
    timeController.loadCompleted();
  } catch (error) {
    if (loadId !== loadSequence) return; // A newer load owns the UI state now.
    loadState.textContent = t("status.error");
    setError(error instanceof Error ? error.message : String(error));
    loadingDetail.textContent = t("error.unableLoad");
    loadingProgressLabel.textContent = t("status.error");
    timeController.loadFailed();
  } finally {
    if (showTimeBusy && loadId === loadSequence) setTimeBusy(false);
  }
}

function setTimeBusy(busy: boolean): void { timeController.setBusy(busy); }
/** Sky view that opens from 3D mode goes back to the same 3D position and target. */
function skyReturnTo3d(origin: ViewState["universe"]) { return origin ? { labelKey: "sky.backTo3d", restore: () => universeView?.restore(origin) } : undefined; }

function bindEvents() {
  bindAtlasEvents({
    dom: atlasDom,
    state: atlasState,
    mapInteraction,
    bindDestinations: () => bindDestinationEvents({
      state: atlasState,
      catalogSearchState, compareSearchState, searchView: destinationSearchView, pointStream: catalogPointStream,
      inspection: objectInspection, bodyByKey: () => bodyByKey,
      bodyPickerConfig: () => destinationController.bodyPickerConfig(), comparePickerConfig: () => destinationController.comparePickerConfig(),
      scheduleBodyPickerUpdate: () => destinationController.scheduleBodyPicker(), scheduleComparePickerUpdate: () => destinationController.scheduleComparePicker(), updateBodyPicker, updateComparePicker,
      updateExploreDomains, updateGuidedSets, updateBodyFilters, updateCompareFilters, updateStats, updateComparePanel: () => destinationController.updateComparePanel(),
      focusSearchResult: () => destinationController.focusPrimaryResult(), focusCompareResult: () => destinationController.focusCompareResult(),
      selectBodyByKey, selectBody, setCompareTargetByKey, clearSelectedObject,
      setActiveTab, focusMapFilter: (filterKey) => destinationController.focusMapFilter(filterKey),
      applyExploreDomain: (domainId) => { void destinationController.applyExploreDomain(domainId); }, fitBodies, centerOnSelected, updateScale: updateScaleUi,
      requestRender: (withData = false) => requestRender(withData ? { data: true } : {}), pushViewState: pushCurrentViewState,
      startTour: (slug) => { setActiveTab(null); void tourPlayer.start(slug); }, setComparisonMode: (open) => controlView.setComparisonMode(open),
    }),
    restoreTourStep: (step) => { void tourPlayer.restoreStep(step); },
    restoreViewState: (state) => { void viewStateController.restore(state); },
    exportCurrentView: () => { void exportCurrentView(); },
    shareCurrentView: (native, feedback) => { void sharingController.share(native, feedback); },
    copyEmbedSnippet: () => { void copyEmbedSnippet(); },
    activateEmbedInteraction: () => embedController.activate(),
    applyZoomPreset, zoomViewportCenter: (factor) => cameraController.zoomViewportCenter(factor),
    setZoomFromSlider: () => cameraController.setFromSlider(Number(zoomScaleSlider.value)),
    updateSizeModes, updateDisplayToggles, updatePerformanceHud: updatePerfHud, updateAllUi, resizeCanvas,
    requestRender: (data = false) => requestRender(data ? { data: true } : {}),
    scheduleViewStateReplace, translate: t,
    viewSkySelected: () => { const body = selectedBody(); if (body && bodyCanObserveSky(body)) { const origin = universeView?.state(); universeView?.close({ updateHistory: false }); void skyView?.open(body, undefined, skyReturnTo3d(origin)); } },
  });
}

function updateEmbedAttribution() { sharingController.updateEmbedAttribution(); }
async function copyEmbedSnippet() { await sharingController.copyEmbedSnippet(); }
async function exportCurrentView() { await sharingController.exportCurrentView(); }
function scheduleViewStateReplace() { viewStateController.scheduleReplace(); }
function pushCurrentViewState() { viewStateController.push(); }
async function restoreSelectionFromViewState(state: ViewState) { await viewStateController.restoreSelection(state); }

function startBootTour() {
  if (tourBootHandled || isEmbedMode) return;
  const params = new URLSearchParams(window.location.search), slug = params.get("tour");
  if (!slug) return;
  tourBootHandled = true;
  const step = Number(params.get("step") ?? "0");
  void tourPlayer.start(slug, Number.isSafeInteger(step) && step >= 0 ? step : 0);
}


function initializeUi() {
  updateTabs();
  updateExploreDomains();
  updateBodyFilters();
  updateCompareFilters();
  updateSizeModes();
  updateDisplayToggles();
  updateCompareUi();
  timeController.update();
  updateScaleUi();
}

function updateAllUi() {
  updateStats();
  controlView.updateSelectedSummary(selectedBody(), formatDistance, bodyCanObserveSky);
  controlView.updateQuickFocus(bodyByKey);
  updateTabs();
  updateExploreDomains();
  updateBodyFilters();
  updateCompareFilters();
  updateBodyPicker();
  updateGuidedSets();
  objectInspection.update(); if (selectedBody()) community.mount(bodyInfo, selectedBody()!.key, selectedBody()!.name);
  updateCompareUi();
  timeController.update();
  updateSizeModes();
  updateDisplayToggles();
  updateScaleUi();
  selectionConnector.update();
  updateEmbedAttribution();
}

function render() {
  if (universeView?.active) return;
  const frameStartedAt = performance.now();
  const previousFrameAt = perfLastFrameAt;
  perfLastFrameAt = frameStartedAt;
  perfFrameMs = frameStartedAt - previousFrameAt;
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
      if (displayLayers.milkyWay) perfMilkyWayMs = milkyWayRenderer.draw(perfMilkyWayMs);
      if (displayLayers.grid) atlasOverlay.drawGrid();
      if (displayLayers.orbits) atlasOverlay.drawOrbitGuides();
      if (displayLayers.constellations) { constellationRenderer.draw(displayLayers.labels); atlasOverlay.addNote(t("constellations.mapNote")); }
      atlasOverlay.drawComparisonGuide();
      atlasOverlay.drawBodies(); atlasOverlay.finishFrame();
      if (displayLayers.labels) atlasOverlay.drawLabels(); else atlasOverlay.clearLabels();
      if (displayLayers.references) atlasOverlay.drawEdgeReferences();
    } else {
      pointRenderer.clear();
    }
  } finally {
    atlasViewport.endFrame();
  }
  community.render("map", canvas.parentElement!, (ephemeris?.bodies ?? []).filter(body => bodyMatchesActiveFilter(body)).map(body => ({key: body.key, ...bodyToScreen(body)})), displayLayers.photos);
  perfDrawMs = performance.now() - frameStartedAt;
  updatePerfHud();
  updateScienceLayerDisclosure(scienceLayerDisclosure, catalogPointManifest, currentViewWidthLy());
}

function requestRender(options: RenderRequestOptions = {}) { refreshScheduler.requestRender(options); }
function requestDataRefresh(options: DataRefreshOptions = {}) { refreshScheduler.requestDataRefresh(options); }
function scheduleCameraDataRefresh() { refreshScheduler.scheduleCameraDataRefresh(); }

function updateStats() { statsView.updateStats(); }
function updatePerfHud() { statsView.updatePerfHud(); }

async function refreshCatalogSummary() {
  const summary = await fetchCatalogSummary();
  if (!summary) return;
  catalogSummary = summary;
  updateStats();
  updateExploreDomains();
  updateBodyFilters();
}

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
function updateCompareFilters() { destinationController.updateCompareFilters(); }
function activeBodyFilterDefinition() { return destinationCatalog.activeFilter(); }
function bodyMatchesActiveFilter(body: Body) { return destinationCatalog.matches(body, activeBodyFilterDefinition()); }

async function loadCatalogTileManifest() {
  await catalogPointManifest.load();
  updatePerfHud();
  if (ephemeris) requestDataRefresh({ immediate: true });
}

function catalogPointViewport(): CatalogPointViewport {
  const rect = atlasViewport.renderRect();
  return {
    camera: { ...camera },
    viewportWidthPx: rect.width,
    viewportHeightPx: rect.height,
    viewWidthLy: currentViewWidthLy(),
    visibleBounds: viewportCatalogLoader.bounds(0),
    filter: activeBodyFilterDefinition(),
    embed: isEmbedMode, resolvedExoplanetOrbits: (atlasVisibility?.resolvedExoplanets().length ?? 0) > 0,
  };
}

async function updateBodyPicker() { await destinationController.updateBodyPicker(); }
function updateGuidedSets() { destinationController.updateGuidedSets(); }
function updateCompareUi() { destinationController.updateCompareUi(); }
async function updateComparePicker() { await destinationController.updateComparePicker(); }


function updateSizeModes() { controlView.updateSizeModes(sizeMode); }
function updateDisplayToggles() { controlView.updateDisplayToggles(displayLayers, perfEnabled); }

function updateScaleUi() {
  const scaleAu = currentViewWidthAu();
  const zoomLevel = cameraController.zoomToSliderValue(camera.pxPerAu);
  controlView.updateScale({ viewWidthAu: scaleAu, viewWidthLy: scaleAu / AU_PER_LIGHT_YEAR, pxPerAu: camera.pxPerAu, auKm: auKm(), zoomLevel, sliderSteps: ZOOM_SLIDER_STEPS, formatDistance, displayLayers });
}

function currentViewWidthAu() { return Math.max(0.000001, usableViewportRect().width / camera.pxPerAu); }

function currentViewWidthLy() { return currentViewWidthAu() / AU_PER_LIGHT_YEAR; }
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

function centerOnSelected(zoom: boolean) {
  const body = selectedBody();
  if (!body) return;
  skyView?.closeForAtlasNavigation(() => { centerOnBody(body, zoom, zoom); requestRender({ data: true }); });
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

function removeMergedBody(key: string) {
  if (ephemeris) ephemeris = { ...ephemeris, bodies: ephemeris.bodies.filter((body) => body.key !== key) };
  bodyByKey.delete(key);
  atlasVisibility.invalidate();
  catalogLayerRenderer.invalidateBodies();
  requestRender();
}

// A drawn label reacts like its object. The label is on top of the markers, so it is first.
function nearestBodyAt(x: number, y: number) { const point = atlasVisibility.nearestCatalogPoint(x, y); return pickMapTarget({ marker: atlasVisibility.nearestBody(x, y), labelled: atlasOverlay.labelAt(x, y), catalogPointDistancePx: point ? Math.hypot(point.x - x, point.y - y) : null }); }
function nearestCatalogTilePointAt(x: number, y: number): CatalogPointHitEntry | null { return atlasVisibility.nearestCatalogPoint(x, y); }

function edgeReferenceAt(x: number, y: number) {
  const body = atlasOverlay.edgeReferenceAt(x, y);
  return body ? { body } : null;
}

function visibleBodies() { return atlasVisibility.visibleBodies(); }
function selectedBody(): Body | null { return objectSelection.selectedBody(); }
function compareTarget(): Body | null { return objectSelection.compareTarget(); }
function ensureCompareTarget() { objectSelection.ensureCompareTarget(); }

function bodyDistanceKm(a: Body, b: Body) { return calculateBodyDistanceKm(a, b, auKm()); }

function worldToScreen(xAu: number, yAu: number): ScreenPoint { return atlasViewport.worldToScreen(xAu, yAu); }
function bodyToScreen(body: Body): ScreenPoint { return worldToScreen(body.position.x_au, body.position.y_au); }
function screenToWorld(x: number, y: number) { return atlasViewport.screenToWorld(x, y); }
function usableViewportRect(): Rect { return atlasViewport.rect(); }
function renderScale() { return atlasViewport.renderScale(); }
function resizeCanvas() { atlasViewport.resize(); }

function setLoading(step: LoadingStep, progress: number, detail: string) { loadingView.update(step, progress, detail); }
function setError(message: string) { loadingView.setError(message); }


function auKm() { return ephemeris?.au_km ?? AU_KM_FALLBACK; }
