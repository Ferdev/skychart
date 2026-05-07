import "./destinationPicker.css";
import "./styles.css";
import {
  buildDestinationPickerSections,
  classifyBody,
  destinationPickerColorStyle,
  findDestinationBody,
  formatPickerDistance,
  normalizeBodyKey,
  readRecentDestinations,
  recordRecentDestination,
  type DestinationBody,
  type DestinationBodyType,
  type DestinationPickerItem,
  type RecentDestination
} from "./destinationPicker";
import { LIGHT_SPEED_KM_PER_SECOND, educationalComparisons } from "./navigationMetrics";

type AtlasTab = "explore" | "inspect" | "measure" | "time" | "view";
type SizeMode = "readable" | "hybrid" | "true";
type ZoomPreset = "inner" | "solar" | "nearby" | "messier" | "all";
type BodyFilter = "all" | "planet" | "moon" | "star" | "dwarf_planet" | "galaxy" | "nebula" | "star_cluster";
type DisplayLayer = "labels" | "orbits" | "grid" | "references";

type VectorComponents = {
  x: number;
  y: number;
  z: number;
};

type BodyPosition = DestinationBody["position"];

type BodyCatalog = {
  source_type?: string | null;
  position_model?: string | null;
  dynamic_position?: boolean;
  aliases?: readonly string[];
  parent_key?: string | null;
  catalog_group?: string;
};

type BodyStateVector = {
  position_km: VectorComponents;
  velocity_km_s: VectorComponents;
  distance_km: number;
  speed_km_s: number;
  heliocentric_distance_km: number;
  heliocentric_speed_km_s: number;
};

type BodyOrbit = {
  central_body_key: string;
  central_body_name: string;
  semi_major_axis_km: number | null;
  eccentricity: number | null;
  inclination_deg: number | null;
  longitude_of_ascending_node_deg: number | null;
  argument_of_periapsis_deg: number | null;
  true_anomaly_deg: number | null;
  periapsis_km: number | null;
  apoapsis_km: number | null;
  orbital_period_days: number | null;
  orbit_class: string;
  notes?: readonly string[];
};

type BodyStellar = {
  distance_pc?: number | null;
  distance_ly?: number | null;
  exoplanet_count?: number | null;
  stellar_radius_solar?: number | null;
  stellar_teff_k?: number | null;
};

type BodyDeepSky = {
  aliases?: readonly string[];
  deep_sky_type_label?: string | null;
  apparent_magnitude?: number | null;
  angular_size_arcmin?: string | null;
  constellation?: string | null;
  viewing_season?: string | null;
  common_name?: string | null;
  observing_equipment?: string | null;
  why_interesting?: string | null;
  physical_diameter_ly?: number | null;
  physical_minor_diameter_ly?: number | null;
  physical_size_note?: string | null;
};

type Body = DestinationBody & {
  catalog?: BodyCatalog | null;
  state_vector?: BodyStateVector | null;
  orbit?: BodyOrbit | null;
  stellar?: BodyStellar | null;
  deep_sky?: BodyDeepSky | null;
};

type Ephemeris = {
  timestamp_utc: string;
  generated_at_utc: string;
  data_source: string;
  coordinate_frame: string;
  au_km: number;
  bodies: Body[];
  catalog?: {
    groups?: Record<string, { label: string; description?: string }>;
    object_count?: number;
  };
};

type Camera = {
  xAu: number;
  yAu: number;
  pxPerAu: number;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type MeasurePoint = {
  label: string;
  xAu: number;
  yAu: number;
  zAu: number;
  bodyKey?: string;
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type LoadingStep = "api" | "download" | "parse" | "render";

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;
const MIN_ZOOM = 1e-10;
const MAX_ZOOM = 3_200;
const FEATURED_KEYS = ["earth", "moon", "mars", "jupiter", "saturn", "proxima-cen", "m31", "m42"];
const BODY_FILTERS: { key: BodyFilter; label: string; types?: DestinationBodyType[] }[] = [
  { key: "all", label: "All" },
  { key: "planet", label: "Planets", types: ["planet"] },
  { key: "moon", label: "Moons", types: ["moon"] },
  { key: "star", label: "Stars", types: ["star"] },
  { key: "dwarf_planet", label: "Dwarf", types: ["dwarf_planet"] },
  { key: "galaxy", label: "Galaxies", types: ["galaxy"] },
  { key: "nebula", label: "Nebulae", types: ["nebula"] },
  { key: "star_cluster", label: "Clusters", types: ["star_cluster"] }
];
const GUIDED_SETS: { id: string; label: string; keys: string[] }[] = [
  { id: "solar-neighborhood", label: "Solar neighborhood", keys: ["sun", "earth", "moon", "mars", "jupiter", "saturn"] },
  { id: "nearby-stars", label: "Nearby stars", keys: ["proxima-cen", "barnards-star", "eps-eri", "tau-cet", "gj-411"] },
  { id: "deep-sky", label: "Messier highlights", keys: ["m1", "m13", "m31", "m42", "m45", "m57"] },
  { id: "galaxies", label: "Galaxies", keys: ["m31", "m33", "m51", "m81", "m82", "m87"] },
  { id: "nebulae", label: "Nebulae", keys: ["m1", "m8", "m16", "m17", "m20", "m42", "m57"] }
];
const SCALE_STOPS = [
  { key: "planetary", label: "Planetary", maxAu: 0.08 },
  { key: "inner", label: "Inner Solar System", maxAu: 3 },
  { key: "outer", label: "Outer Solar System", maxAu: 60 },
  { key: "nearby", label: "Nearby stars", maxAu: 1_500_000 },
  { key: "milky-way", label: "Milky Way", maxAu: 2_500_000_000 },
  { key: "local-group", label: "Local Group", maxAu: Number.POSITIVE_INFINITY }
];

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>("#map");
const mapContext = canvas.getContext("2d");
if (!mapContext) throw new Error("Canvas 2D context is not available");
const ctx: CanvasRenderingContext2D = mapContext;

const loadingScreen = requiredElement<HTMLElement>("#loading-screen");
const loadingDetail = requiredElement<HTMLElement>("#loading-detail");
const loadingFill = requiredElement<HTMLElement>("#loading-progress-fill");
const loadingProgressLabel = requiredElement<HTMLElement>("#loading-progress-label");
const loadingStepLabel = requiredElement<HTMLElement>("#loading-step-label");
const loadingElapsed = requiredElement<HTMLElement>("#loading-elapsed");
const loadState = requiredElement<HTMLElement>("#load-state");
const atlasStats = requiredElement<HTMLElement>("#atlas-stats");
const bodySearch = requiredElement<HTMLInputElement>("#body-search");
const focusBodyButton = requiredElement<HTMLButtonElement>("#focus-body");
const quickFocusButtons = requiredElement<HTMLElement>("#quick-focus-buttons");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));
const catalogCount = requiredElement<HTMLElement>("#catalog-count");
const bodyFilterButtons = requiredElement<HTMLElement>("#body-filter-buttons");
const bodyPicker = requiredElement<HTMLElement>("#body-picker");
const guidedTours = requiredElement<HTMLElement>("#guided-tours");
const selectedHeading = requiredElement<HTMLElement>("#selected-heading");
const bodyInfo = requiredElement<HTMLElement>("#body-info");
const centerSelected = requiredElement<HTMLButtonElement>("#center-selected");
const zoomSelected = requiredElement<HTMLButtonElement>("#zoom-selected");
const clearMeasure = requiredElement<HTMLButtonElement>("#clear-measure");
const measureFromSelected = requiredElement<HTMLButtonElement>("#measure-from-selected");
const measureToSelected = requiredElement<HTMLButtonElement>("#measure-to-selected");
const measureClickMode = requiredElement<HTMLButtonElement>("#measure-click-mode");
const measurePanel = requiredElement<HTMLElement>("#measure-panel");
const timeSummary = requiredElement<HTMLElement>("#time-summary");
const timeInput = requiredElement<HTMLInputElement>("#time-input");
const timeNow = requiredElement<HTMLButtonElement>("#time-now");
const applyTime = requiredElement<HTMLButtonElement>("#apply-time");
const zoomPresets = requiredElement<HTMLElement>("#zoom-presets");
const zoomOut = requiredElement<HTMLButtonElement>("#zoom-out");
const zoomIn = requiredElement<HTMLButtonElement>("#zoom-in");
const centerSun = requiredElement<HTMLButtonElement>("#center-sun");
const sizeModeButtons = requiredElement<HTMLElement>("#size-mode-buttons");
const displayToggles = requiredElement<HTMLElement>("#display-toggles");
const scaleLadder = requiredElement<HTMLElement>("#scale-ladder");
const scaleNote = requiredElement<HTMLElement>("#scale-note");
const toolbarCenterSelected = requiredElement<HTMLButtonElement>("#toolbar-center-selected");
const toolbarMeasure = requiredElement<HTMLButtonElement>("#toolbar-measure");
const toolbarResetView = requiredElement<HTMLButtonElement>("#toolbar-reset-view");
const bodyPopover = requiredElement<HTMLElement>("#body-popover");
const errorPanel = requiredElement<HTMLElement>("#error-panel");

let ephemeris: Ephemeris | null = null;
let bodyByKey = new Map<string, Body>();
let selectedKey = "earth";
let activeTab: AtlasTab = "explore";
let activeFilter: BodyFilter = "all";
let sizeMode: SizeMode = "hybrid";
let activeZoomPreset: ZoomPreset = "solar";
let displayLayers: Record<DisplayLayer, boolean> = {
  labels: true,
  orbits: true,
  grid: true,
  references: true
};
let camera: Camera = { xAu: 0, yAu: 0, pxPerAu: 24 };
let hoverKey: string | null = null;
let measureMode = false;
let measurePoints: MeasurePoint[] = [];
let recentDestinations: RecentDestination[] = readRecentDestinations();
let mapDragging = false;
let mapDragMoved = false;
let dragStart: ScreenPoint | null = null;
let dragCameraStart: Camera | null = null;
let loadingStartedAt = performance.now();
let renderRequested = false;

resizeCanvas();
bindEvents();
initializeUi();
loadAtlas();
requestAnimationFrame(render);

async function loadAtlas(timestampIso?: string) {
  loadingStartedAt = performance.now();
  setLoading("api", 8, "Connecting to local API");
  setError("");
  loadState.textContent = "loading";

  try {
    const query = new URLSearchParams();
    if (timestampIso) query.set("timestamp", timestampIso);
    const url = `/api/ephemeris${query.toString() ? `?${query.toString()}` : ""}`;
    setLoading("download", 28, "Loading ephemeris and catalog payload");
    const response = await fetch(url);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `API request failed with ${response.status}`);
    }

    setLoading("parse", 64, "Indexing celestial objects");
    const payload = (await response.json()) as Ephemeris;
    ephemeris = payload;
    bodyByKey = new Map(payload.bodies.map((body) => [body.key, body]));
    if (!bodyByKey.has(selectedKey)) selectedKey = bodyByKey.get("earth")?.key ?? payload.bodies[0]?.key ?? "";
    timeInput.value = toDatetimeLocalValue(new Date(payload.timestamp_utc));
    recentDestinations = readRecentDestinations();

    setLoading("render", 88, "Preparing scientific controls");
    updateAllUi();
    if (payload.bodies.length > 0) {
      applyZoomPreset(activeZoomPreset, false);
    }
    loadingScreen.hidden = true;
    loadState.textContent = "ready";
    requestRender();
  } catch (error) {
    loadState.textContent = "error";
    setError(error instanceof Error ? error.message : String(error));
    loadingDetail.textContent = "Unable to load the atlas data.";
    loadingProgressLabel.textContent = "error";
  }
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resizeCanvas();
    requestRender();
  });

  bodySearch.addEventListener("input", () => {
    updateBodyPicker();
  });

  bodySearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusSearchResult();
    }
  });

  focusBodyButton.addEventListener("click", focusSearchResult);

  quickFocusButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-focus-key]");
    if (!button) return;
    selectBody(button.dataset.focusKey ?? "", { center: true, zoom: "local" });
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab((button.dataset.tab as AtlasTab) ?? "explore");
    });
  });

  bodyFilterButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    if (!button) return;
    activeFilter = (button.dataset.bodyFilter as BodyFilter) ?? "all";
    updateBodyFilters();
    updateBodyPicker();
  });

  bodyPicker.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-key]");
    if (!button) return;
    selectBody(button.dataset.bodyKey ?? "", { center: true });
  });

  guidedTours.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tour-id]");
    if (!button) return;
    const tour = GUIDED_SETS.find((item) => item.id === button.dataset.tourId);
    if (!tour) return;
    const bodies = tour.keys.map((key) => bodyByKey.get(key)).filter(isPresent);
    if (bodies.length === 0) return;
    selectedKey = bodies[0].key;
    fitBodies(bodies, 0.2);
    setActiveTab("inspect");
    updateAllUi();
  });

  centerSelected.addEventListener("click", () => centerOnSelected(false));
  zoomSelected.addEventListener("click", () => centerOnSelected(true));
  toolbarCenterSelected.addEventListener("click", () => centerOnSelected(false));
  toolbarResetView.addEventListener("click", () => applyZoomPreset("solar"));

  clearMeasure.addEventListener("click", () => {
    measurePoints = [];
    updateMeasurePanel();
    requestRender();
  });

  measureFromSelected.addEventListener("click", () => setMeasurePointFromSelected(0));
  measureToSelected.addEventListener("click", () => setMeasurePointFromSelected(1));
  measureClickMode.addEventListener("click", () => {
    measureMode = !measureMode;
    setActiveTab("measure");
    updateMeasurePanel();
    requestRender();
  });
  toolbarMeasure.addEventListener("click", () => {
    measureMode = !measureMode;
    setActiveTab("measure");
    updateMeasurePanel();
    requestRender();
  });

  timeNow.addEventListener("click", () => {
    timeInput.value = toDatetimeLocalValue(new Date());
    void loadAtlas(new Date().toISOString());
  });

  applyTime.addEventListener("click", () => {
    const date = dateFromInput();
    if (date) void loadAtlas(date.toISOString());
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step-days]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = dateFromInput() ?? new Date(ephemeris?.timestamp_utc ?? Date.now());
      const days = Number(button.dataset.stepDays ?? "0");
      const next = new Date(current.getTime() + days * 86_400_000);
      timeInput.value = toDatetimeLocalValue(next);
      void loadAtlas(next.toISOString());
    });
  });

  zoomPresets.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-zoom-preset]");
    if (!button) return;
    applyZoomPreset((button.dataset.zoomPreset as ZoomPreset) ?? "solar");
  });

  zoomOut.addEventListener("click", () => zoomAt(canvas.width / 2, canvas.height / 2, 0.72));
  zoomIn.addEventListener("click", () => zoomAt(canvas.width / 2, canvas.height / 2, 1.32));
  centerSun.addEventListener("click", () => {
    const sun = bodyByKey.get("sun");
    if (sun) {
      selectedKey = sun.key;
      centerOnBody(sun, false);
      updateAllUi();
    }
  });

  sizeModeButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-size-mode]");
    if (!button) return;
    sizeMode = (button.dataset.sizeMode as SizeMode) ?? "hybrid";
    updateSizeModes();
    requestRender();
  });

  displayToggles.addEventListener("change", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-layer]");
    if (!input) return;
    const layer = input.dataset.layer as DisplayLayer;
    displayLayers = { ...displayLayers, [layer]: input.checked };
    updateDisplayToggles();
    requestRender();
  });

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    mapDragging = true;
    mapDragMoved = false;
    dragStart = { x: event.clientX, y: event.clientY };
    dragCameraStart = { ...camera };
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = eventToCanvasPoint(event);
    hoverKey = nearestBodyAt(point.x, point.y)?.body.key ?? null;
    if (mapDragging && dragStart && dragCameraStart) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 3) mapDragMoved = true;
      camera = {
        ...camera,
        xAu: dragCameraStart.xAu - dx / camera.pxPerAu,
        yAu: dragCameraStart.yAu + dy / camera.pxPerAu
      };
    }
    requestRender();
  });

  canvas.addEventListener("pointerup", (event) => {
    canvas.releasePointerCapture(event.pointerId);
    mapDragging = false;
    const point = eventToCanvasPoint(event);
    if (!mapDragMoved) handleMapClick(point);
    dragStart = null;
    dragCameraStart = null;
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = eventToCanvasPoint(event);
      zoomAt(point.x, point.y, event.deltaY > 0 ? 0.84 : 1.18);
    },
    { passive: false }
  );
}

function initializeUi() {
  updateTabs();
  updateBodyFilters();
  updateSizeModes();
  updateDisplayToggles();
  updateMeasurePanel();
}

function updateAllUi() {
  updateStats();
  updateQuickFocus();
  updateTabs();
  updateBodyFilters();
  updateBodyPicker();
  updateGuidedSets();
  updateBodyInfo();
  updateMeasurePanel();
  updateTimeSummary();
  updateSizeModes();
  updateDisplayToggles();
  updateScaleUi();
}

function render() {
  renderRequested = false;
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  if (ephemeris) {
    if (displayLayers.grid) drawGrid();
    if (displayLayers.orbits) drawOrbitGuides();
    drawMeasurements();
    drawBodies();
    if (displayLayers.labels) drawLabels();
    if (displayLayers.references) drawEdgeReferences();
  }
  drawCrosshair();
  if (!renderRequested) requestAnimationFrame(render);
}

function requestRender() {
  renderRequested = true;
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#080a09");
  gradient.addColorStop(0.48, "#10110e");
  gradient.addColorStop(1, "#090908");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const seed = 44;
  ctx.save();
  for (let index = 0; index < 180; index += 1) {
    const x = pseudoRandom(seed + index * 11) * canvas.width;
    const y = pseudoRandom(seed + index * 17) * canvas.height;
    const alpha = 0.12 + pseudoRandom(seed + index * 23) * 0.44;
    const size = 0.5 + pseudoRandom(seed + index * 29) * 1.2;
    ctx.fillStyle = `rgba(238, 233, 211, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGrid() {
  const rect = usableViewportRect();
  const worldLeft = screenToWorld(rect.left, rect.top).xAu;
  const worldRight = screenToWorld(rect.right, rect.top).xAu;
  const worldTop = screenToWorld(rect.left, rect.top).yAu;
  const worldBottom = screenToWorld(rect.left, rect.bottom).yAu;
  const step = niceStep(Math.abs(worldRight - worldLeft) / 8);
  const startX = Math.floor(worldLeft / step) * step;
  const endX = Math.ceil(worldRight / step) * step;
  const startY = Math.floor(worldBottom / step) * step;
  const endY = Math.ceil(worldTop / step) * step;

  ctx.save();
  ctx.strokeStyle = "rgba(235, 228, 206, 0.09)";
  ctx.lineWidth = 1;
  for (let x = startX; x <= endX; x += step) {
    const screen = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(screen.x, rect.top);
    ctx.lineTo(screen.x, rect.bottom);
    ctx.stroke();
  }
  for (let y = startY; y <= endY; y += step) {
    const screen = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(rect.left, screen.y);
    ctx.lineTo(rect.right, screen.y);
    ctx.stroke();
  }
  drawScaleBar(rect, step);
  ctx.restore();
}

function drawScaleBar(rect: Rect, stepAu: number) {
  const lengthPx = Math.min(180, Math.max(64, stepAu * camera.pxPerAu));
  const lengthAu = lengthPx / camera.pxPerAu;
  const x = rect.left + 24;
  const y = rect.bottom - 34;
  ctx.strokeStyle = "rgba(239, 233, 213, 0.72)";
  ctx.fillStyle = "rgba(239, 233, 213, 0.82)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + lengthPx, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + lengthPx, y - 5);
  ctx.lineTo(x + lengthPx, y + 5);
  ctx.stroke();
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText(formatDistance(lengthAu * auKm()), x, y - 10);
}

function drawOrbitGuides() {
  const bodies = visibleBodies().filter((body) => body.orbit && body.parent_key);
  ctx.save();
  ctx.strokeStyle = "rgba(136, 189, 166, 0.22)";
  ctx.lineWidth = 1;
  for (const body of bodies) {
    const parent = bodyByKey.get(body.parent_key ?? "");
    const semiMajorKm = body.orbit?.semi_major_axis_km;
    if (!parent || !semiMajorKm || semiMajorKm <= 0) continue;
    const parentScreen = worldToScreen(parent.position.x_au, parent.position.y_au);
    const radiusPx = (semiMajorKm / auKm()) * camera.pxPerAu;
    if (radiusPx < 4 || radiusPx > Math.max(canvas.width, canvas.height) * 3) continue;
    ctx.beginPath();
    ctx.arc(parentScreen.x, parentScreen.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeasurements() {
  if (measurePoints.length === 0) return;
  ctx.save();
  const points = measurePoints.map((point) => worldToScreen(point.xAu, point.yAu));
  ctx.strokeStyle = "rgba(236, 183, 89, 0.82)";
  ctx.fillStyle = "rgba(236, 183, 89, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  if (points.length === 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  points.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    drawMapLabel(index === 0 ? "A" : "B", point.x + 10, point.y - 10, "rgba(236, 183, 89, 0.9)");
  });
  ctx.restore();
}

function drawBodies() {
  const selected = selectedBody();
  ctx.save();
  for (const body of visibleBodies()) {
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    const radius = markerRadius(body);
    const selectedOrHover = body.key === selected?.key || body.key === hoverKey;
    ctx.globalAlpha = selectedOrHover ? 1 : bodyAlpha(body);
    ctx.fillStyle = body.color || "#d9b86f";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (selectedOrHover) {
      ctx.strokeStyle = body.key === selected?.key ? "rgba(248, 218, 136, 0.95)" : "rgba(177, 218, 205, 0.82)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLabels() {
  const labels = prioritizedLabelBodies();
  const occupied: Rect[] = [];
  ctx.save();
  ctx.font = "12px Inter, system-ui, sans-serif";
  for (const body of labels) {
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    const label = body.name;
    const width = ctx.measureText(label).width + 18;
    const height = 22;
    const rect = {
      left: screen.x + 10,
      top: screen.y - height - 8,
      right: screen.x + 10 + width,
      bottom: screen.y - 8,
      width,
      height
    };
    if (!rectInCanvas(rect) || occupied.some((item) => rectsOverlap(item, rect))) continue;
    occupied.push(rect);
    drawMapLabel(label, rect.left, rect.top + 15, body.key === selectedKey ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.76)");
  }
  ctx.restore();
}

function drawEdgeReferences() {
  const rect = usableViewportRect();
  const references = bodiesOutsideViewport()
    .sort((a, b) => a.screenDistance - b.screenDistance)
    .slice(0, 8);

  ctx.save();
  ctx.font = "11px Inter, system-ui, sans-serif";
  for (const reference of references) {
    const clamped = {
      x: clamp(reference.screen.x, rect.left + 16, rect.right - 16),
      y: clamp(reference.screen.y, rect.top + 16, rect.bottom - 16)
    };
    const color = reference.body.color || "#d9b86f";
    ctx.strokeStyle = `${color}aa`;
    ctx.fillStyle = `${color}ee`;
    ctx.beginPath();
    ctx.arc(clamped.x, clamped.y, 4, 0, Math.PI * 2);
    ctx.fill();
    drawMapLabel(reference.body.name, clamped.x + 8, clamped.y + 4, "rgba(239, 233, 213, 0.6)");
  }
  ctx.restore();
}

function drawCrosshair() {
  if (!measureMode) return;
  const selected = selectedBody();
  if (!selected) return;
  const screen = worldToScreen(selected.position.x_au, selected.position.y_au);
  ctx.save();
  ctx.strokeStyle = "rgba(236, 183, 89, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(screen.x - 15, screen.y);
  ctx.lineTo(screen.x + 15, screen.y);
  ctx.moveTo(screen.x, screen.y - 15);
  ctx.lineTo(screen.x, screen.y + 15);
  ctx.stroke();
  ctx.restore();
}

function drawMapLabel(text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = "rgba(8, 10, 9, 0.72)";
  ctx.strokeStyle = "rgba(239, 233, 213, 0.13)";
  const width = ctx.measureText(text).width + 12;
  roundedRect(x - 6, y - 15, width, 22, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function updateStats() {
  if (!ephemeris) return;
  const counts = countBodies(ephemeris.bodies);
  atlasStats.innerHTML = `
    <div><dt>Objects</dt><dd>${ephemeris.bodies.length}</dd></div>
    <div><dt>Planets</dt><dd>${counts.planet}</dd></div>
    <div><dt>Moons</dt><dd>${counts.moon}</dd></div>
    <div><dt>Deep sky</dt><dd>${counts.deepSky}</dd></div>
    <div><dt>Epoch</dt><dd>${formatShortDate(ephemeris.timestamp_utc)}</dd></div>
  `;
  catalogCount.textContent = `${ephemeris.bodies.length} objects`;
}

function updateQuickFocus() {
  quickFocusButtons.innerHTML = FEATURED_KEYS.map((key) => bodyByKey.get(key))
    .filter(isPresent)
    .map(
      (body) => `
        <button type="button" data-focus-key="${escapeHtml(body.key)}" style="--body-color: ${escapeHtml(body.color)}">
          <span class="body-orb"></span>${escapeHtml(shortBodyName(body.name))}
        </button>
      `
    )
    .join("");
}

function updateTabs() {
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === activeTab);
    button.setAttribute("aria-selected", String(button.dataset.tab === activeTab));
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  }
  toolbarMeasure.classList.toggle("active", measureMode);
}

function setActiveTab(tab: AtlasTab) {
  activeTab = tab;
  updateTabs();
}

function updateBodyFilters() {
  bodyFilterButtons.innerHTML = BODY_FILTERS.map(
    (filter) => `
      <button type="button" data-body-filter="${filter.key}" class="${filter.key === activeFilter ? "active" : ""}">
        ${escapeHtml(filter.label)}
      </button>
    `
  ).join("");
}

function updateBodyPicker() {
  if (!ephemeris) return;
  const includeTypes = BODY_FILTERS.find((filter) => filter.key === activeFilter)?.types;
  const sections = buildDestinationPickerSections(ephemeris.bodies, {
    query: bodySearch.value,
    selectedKey,
    currentTargetKey: selectedKey,
    recentDestinations,
    includeTypes,
    auKm: auKm(),
    maxResults: bodySearch.value ? 80 : 240,
    maxFavorites: 8,
    maxFrequent: 8,
    maxRecent: 8,
    includeAllSection: true
  });

  const visibleSections = bodySearch.value.trim() ? sections : sections.filter((section) => section.kind === "all");

  bodyPicker.innerHTML = visibleSections
    .filter((section) => section.items.length > 0)
    .map(
      (section) => `
        <section class="destination-picker__section">
          <h3 class="destination-picker__section-title">${escapeHtml(section.label)}</h3>
          <div class="destination-picker__list">${section.items.map(renderPickerItem).join("")}</div>
        </section>
      `
    )
    .join("");
}

function renderPickerItem(item: DestinationPickerItem) {
  const style = destinationPickerColorStyle(item);
  return `
    <button
      type="button"
      class="destination-picker__item${item.key === selectedKey ? " is-selected" : ""}"
      data-body-key="${escapeHtml(item.key)}"
      aria-label="${escapeHtml(item.ariaLabel)}"
      style="--destination-color: ${escapeHtml(style["--destination-color"])}"
    >
      <span class="destination-picker__orb" aria-hidden="true"></span>
      <span class="destination-picker__copy">
        <strong class="destination-picker__name">${escapeHtml(item.name)}</strong>
        <span class="destination-picker__meta">${escapeHtml(item.metaLabel)}</span>
      </span>
      <span class="destination-picker__distance">${escapeHtml(item.distanceLabel)}</span>
    </button>
  `;
}

function updateGuidedSets() {
  guidedTours.innerHTML = GUIDED_SETS.map((tour) => {
    const available = tour.keys.map((key) => bodyByKey.get(key)).filter(isPresent);
    if (available.length === 0) return "";
    return `
      <button type="button" data-tour-id="${escapeHtml(tour.id)}">
        <strong>${escapeHtml(tour.label)}</strong>
        <span>${available.length} objects</span>
      </button>
    `;
  }).join("");
}

function updateBodyInfo() {
  const body = selectedBody();
  if (!body) {
    selectedHeading.textContent = "No object selected";
    bodyInfo.innerHTML = `<p class="empty-state">Select an object from the map or catalog.</p>`;
    return;
  }

  selectedHeading.textContent = body.name;
  const classification = classifyBody(body);
  const rows = [
    ["Type", classification.label],
    ["Earth distance", formatDistance(body.distance_from_earth_km)],
    ["Heliocentric distance", formatDistance(body.position.heliocentric_distance_km)],
    ["Radius", formatDistance(body.radius_km)],
    ["Position model", readablePositionModel(body.catalog?.position_model ?? body.catalog?.source_type ?? "")],
    ["Parent", body.parent_key ? bodyByKey.get(body.parent_key)?.name ?? body.parent_key : "None"]
  ];

  const stateRows = body.state_vector
    ? [
        ["Parent-relative speed", `${formatNumber(body.state_vector.speed_km_s)} km/s`],
        ["Heliocentric speed", `${formatNumber(body.state_vector.heliocentric_speed_km_s)} km/s`]
      ]
    : [];

  const orbitRows = body.orbit
    ? [
        ["Orbit class", body.orbit.orbit_class],
        ["Semi-major axis", nullableDistance(body.orbit.semi_major_axis_km)],
        ["Eccentricity", nullableNumber(body.orbit.eccentricity, 4)],
        ["Inclination", nullableDegrees(body.orbit.inclination_deg)],
        ["Period", nullableDays(body.orbit.orbital_period_days)]
      ]
    : [];

  const stellarRows = body.stellar
    ? [
        ["Catalog distance", nullableLightYears(body.stellar.distance_ly)],
        ["Known planets", nullableNumber(body.stellar.exoplanet_count, 0)],
        ["Temperature", body.stellar.stellar_teff_k ? `${formatNumber(body.stellar.stellar_teff_k)} K` : "Unknown"]
      ]
    : [];

  const deepSkyRows = body.deep_sky
    ? [
        ["Deep-sky type", body.deep_sky.deep_sky_type_label ?? "Unknown"],
        ["Magnitude", nullableNumber(body.deep_sky.apparent_magnitude, 1)],
        ["Constellation", body.deep_sky.constellation ?? "Unknown"],
        ["Viewing season", body.deep_sky.viewing_season ?? "Unknown"],
        ["Angular size", body.deep_sky.angular_size_arcmin ?? "Unknown"],
        ["Physical diameter", body.deep_sky.physical_diameter_ly ? `${formatNumber(body.deep_sky.physical_diameter_ly)} ly` : "Unknown"]
      ]
    : [];

  bodyInfo.innerHTML = `
    <article class="selected-object" style="--body-color: ${escapeHtml(body.color)}">
      <div class="object-hero">
        <span class="large-orb"></span>
        <div>
          <p>${escapeHtml(classification.label)}</p>
          <h3>${escapeHtml(body.name)}</h3>
        </div>
      </div>
      <dl class="detail-grid">${renderRows(rows)}</dl>
      ${stateRows.length ? `<h4>State vector</h4><dl class="detail-grid">${renderRows(stateRows)}</dl>` : ""}
      ${orbitRows.length ? `<h4>Osculating orbit</h4><dl class="detail-grid">${renderRows(orbitRows)}</dl>` : ""}
      ${stellarRows.length ? `<h4>Stellar catalog</h4><dl class="detail-grid">${renderRows(stellarRows)}</dl>` : ""}
      ${deepSkyRows.length ? `<h4>Deep-sky catalog</h4><dl class="detail-grid">${renderRows(deepSkyRows)}</dl>` : ""}
      ${body.deep_sky?.why_interesting ? `<p class="object-note">${escapeHtml(body.deep_sky.why_interesting)}</p>` : ""}
    </article>
  `;
}

function renderRows(rows: (string | number | null | undefined)[][]) {
  return rows
    .map(([label, value]) => `<dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value ?? "Unknown"))}</dd>`)
    .join("");
}

function updateMeasurePanel() {
  measureClickMode.classList.toggle("active", measureMode);
  toolbarMeasure.classList.toggle("active", measureMode);

  const selected = selectedBody();
  measureFromSelected.disabled = !selected;
  measureToSelected.disabled = !selected;

  if (measurePoints.length === 0) {
    measurePanel.innerHTML = `<div class="empty-state">No measurement selected.</div>`;
    return;
  }

  const pointRows = measurePoints
    .map(
      (point, index) => `
        <div class="measure-point">
          <span>${index === 0 ? "A" : "B"}</span>
          <strong>${escapeHtml(point.label)}</strong>
        </div>
      `
    )
    .join("");

  if (measurePoints.length === 1) {
    measurePanel.innerHTML = `${pointRows}<div class="empty-state">Choose a second point.</div>`;
    return;
  }

  const distanceKm = measureDistanceKm(measurePoints[0], measurePoints[1]);
  const comparisons = educationalComparisons(distanceKm, { auKm: auKm(), includeMissionComparisons: false }).slice(0, 4);
  measurePanel.innerHTML = `
    ${pointRows}
    <div class="measure-result">
      <span>Distance</span>
      <strong>${formatDistance(distanceKm)}</strong>
      <small>${formatNumber(distanceKm / auKm())} AU</small>
    </div>
    <dl class="comparison-list">
      ${comparisons.map((comparison) => `<dt>${escapeHtml(comparison.label)}</dt><dd>${escapeHtml(comparison.displayValue)}</dd>`).join("")}
    </dl>
  `;
}

function updateTimeSummary() {
  if (!ephemeris) return;
  timeSummary.textContent = formatFullDate(ephemeris.timestamp_utc);
}

function updateSizeModes() {
  for (const button of sizeModeButtons.querySelectorAll<HTMLButtonElement>("[data-size-mode]")) {
    button.classList.toggle("active", button.dataset.sizeMode === sizeMode);
  }
}

function updateDisplayToggles() {
  for (const input of displayToggles.querySelectorAll<HTMLInputElement>("input[data-layer]")) {
    input.checked = displayLayers[input.dataset.layer as DisplayLayer] ?? false;
  }
}

function updateScaleUi() {
  const scaleAu = Math.max(0.000001, usableViewportRect().width / camera.pxPerAu);
  const active = SCALE_STOPS.find((stop) => scaleAu <= stop.maxAu) ?? SCALE_STOPS[SCALE_STOPS.length - 1];
  scaleLadder.innerHTML = SCALE_STOPS.map(
    (stop) => `<span class="${stop.key === active.key ? "active" : ""}">${escapeHtml(stop.label)}</span>`
  ).join("");
  scaleNote.textContent = `${active.label} scale. View width: ${formatDistance(scaleAu * auKm())}.`;
}

function focusSearchResult() {
  if (!ephemeris) return;
  const query = bodySearch.value.trim();
  const body = findDestinationBody(ephemeris.bodies, query) ?? visiblePickerFirstMatch();
  if (!body) return;
  selectBody(body.key, { center: true, zoom: "local" });
}

function visiblePickerFirstMatch() {
  if (!ephemeris) return null;
  const includeTypes = BODY_FILTERS.find((filter) => filter.key === activeFilter)?.types;
  const sections = buildDestinationPickerSections(ephemeris.bodies, {
    query: bodySearch.value,
    selectedKey,
    currentTargetKey: selectedKey,
    recentDestinations,
    includeTypes,
    maxResults: 1,
    auKm: auKm()
  });
  const key = sections[0]?.items[0]?.key;
  return key ? bodyByKey.get(key) ?? null : null;
}

function selectBody(key: string, options: { center?: boolean; zoom?: "local" } = {}) {
  const body = bodyByKey.get(key);
  if (!body) return;
  selectedKey = body.key;
  recentDestinations = recordRecentDestination(body.key, { distanceFromEarthKm: body.distance_from_earth_km });
  if (options.center) centerOnBody(body, options.zoom === "local");
  bodySearch.value = body.name;
  setActiveTab("inspect");
  hidePopover();
  updateAllUi();
  requestRender();
}

function centerOnSelected(zoom: boolean) {
  const body = selectedBody();
  if (!body) return;
  centerOnBody(body, zoom);
  requestRender();
}

function centerOnBody(body: Body, zoom: boolean) {
  camera = { ...camera, xAu: body.position.x_au, yAu: body.position.y_au };
  if (zoom) {
    const distanceAu = Math.max(body.position.heliocentric_distance_km / auKm(), 0.02);
    const targetWidthAu = body.catalog?.source_type === "deep_sky_catalog" ? Math.max(distanceAu * 0.08, 80_000) : Math.max(distanceAu * 0.55, 0.05);
    camera.pxPerAu = clamp(usableViewportRect().width / targetWidthAu, MIN_ZOOM, MAX_ZOOM);
  }
  activeZoomPreset = "solar";
  updateScaleUi();
}

function applyZoomPreset(preset: ZoomPreset, update = true) {
  activeZoomPreset = preset;
  if (!ephemeris) return;
  const bodies = presetBodies(preset);
  if (bodies.length > 0) fitBodies(bodies, 0.16);
  updateZoomPresetButtons();
  updateScaleUi();
  if (update) requestRender();
}

function presetBodies(preset: ZoomPreset) {
  if (!ephemeris) return [];
  if (preset === "inner") {
    return ["sun", "mercury", "venus", "earth", "moon", "mars"].map((key) => bodyByKey.get(key)).filter(isPresent);
  }
  if (preset === "solar") {
    return ephemeris.bodies.filter((body) => isSolarSystemBody(body));
  }
  if (preset === "nearby") {
    return ephemeris.bodies.filter((body) => body.catalog_group === "nearby_exoplanet_systems" || body.key === "sun");
  }
  if (preset === "messier") {
    return ephemeris.bodies.filter((body) => body.catalog_group === "messier_deep_sky");
  }
  return ephemeris.bodies;
}

function updateZoomPresetButtons() {
  for (const button of zoomPresets.querySelectorAll<HTMLButtonElement>("[data-zoom-preset]")) {
    button.classList.toggle("active", button.dataset.zoomPreset === activeZoomPreset);
  }
}

function fitBodies(bodies: Body[], paddingRatio: number) {
  const rect = usableViewportRect();
  const xs = bodies.map((body) => body.position.x_au);
  const ys = bodies.map((body) => body.position.y_au);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthAu = Math.max(0.001, maxX - minX);
  const heightAu = Math.max(0.001, maxY - minY);
  const paddedWidthAu = widthAu * (1 + paddingRatio * 2);
  const paddedHeightAu = heightAu * (1 + paddingRatio * 2);
  camera = {
    xAu: (minX + maxX) / 2,
    yAu: (minY + maxY) / 2,
    pxPerAu: clamp(Math.min(rect.width / paddedWidthAu, rect.height / paddedHeightAu), MIN_ZOOM, MAX_ZOOM)
  };
  updateScaleUi();
}

function zoomAt(x: number, y: number, factor: number) {
  const before = screenToWorld(x, y);
  camera.pxPerAu = clamp(camera.pxPerAu * factor, MIN_ZOOM, MAX_ZOOM);
  const after = screenToWorld(x, y);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  updateScaleUi();
  requestRender();
}

function handleMapClick(point: ScreenPoint) {
  const nearest = nearestBodyAt(point.x, point.y);
  if (measureMode) {
    if (nearest) {
      addMeasurePoint(bodyToMeasurePoint(nearest.body));
    } else {
      const world = screenToWorld(point.x, point.y);
      addMeasurePoint({ label: "Map point", xAu: world.xAu, yAu: world.yAu, zAu: 0 });
    }
    return;
  }

  if (!nearest) {
    hidePopover();
    return;
  }
  selectedKey = nearest.body.key;
  recentDestinations = recordRecentDestination(nearest.body.key, { distanceFromEarthKm: nearest.body.distance_from_earth_km });
  showPopover(nearest.body, point);
  setActiveTab("inspect");
  updateAllUi();
  requestRender();
}

function nearestBodyAt(x: number, y: number) {
  let nearest: { body: Body; distancePx: number } | null = null;
  for (const body of ephemeris?.bodies ?? []) {
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    const threshold = Math.max(14, markerRadius(body) + 8);
    const distancePx = Math.hypot(screen.x - x, screen.y - y);
    if (distancePx <= threshold && (!nearest || distancePx < nearest.distancePx)) {
      nearest = { body, distancePx };
    }
  }
  return nearest;
}

function showPopover(body: Body, point: ScreenPoint) {
  const classification = classifyBody(body);
  bodyPopover.hidden = false;
  bodyPopover.style.left = `${Math.min(point.x + 16, canvas.width - 260)}px`;
  bodyPopover.style.top = `${Math.min(point.y + 16, canvas.height - 170)}px`;
  bodyPopover.innerHTML = `
    <div class="popover-head" style="--body-color: ${escapeHtml(body.color)}">
      <span class="body-orb"></span>
      <div>
        <strong>${escapeHtml(body.name)}</strong>
        <span>${escapeHtml(classification.label)}</span>
      </div>
    </div>
    <dl>
      <dt>Earth distance</dt><dd>${escapeHtml(formatDistance(body.distance_from_earth_km))}</dd>
      <dt>Radius</dt><dd>${escapeHtml(formatDistance(body.radius_km))}</dd>
    </dl>
  `;
}

function hidePopover() {
  bodyPopover.hidden = true;
}

function setMeasurePointFromSelected(index: 0 | 1) {
  const body = selectedBody();
  if (!body) return;
  const point = bodyToMeasurePoint(body);
  measurePoints[index] = point;
  measurePoints = measurePoints.slice(0, 2);
  updateMeasurePanel();
  requestRender();
}

function addMeasurePoint(point: MeasurePoint) {
  if (measurePoints.length >= 2) measurePoints = [];
  measurePoints = [...measurePoints, point].slice(0, 2);
  updateMeasurePanel();
  requestRender();
}

function bodyToMeasurePoint(body: Body): MeasurePoint {
  return {
    label: body.name,
    xAu: body.position.x_au,
    yAu: body.position.y_au,
    zAu: body.position.z_au,
    bodyKey: body.key
  };
}

function measureDistanceKm(a: MeasurePoint, b: MeasurePoint) {
  return Math.hypot(a.xAu - b.xAu, a.yAu - b.yAu, a.zAu - b.zAu) * auKm();
}

function visibleBodies() {
  const rect = expandedRect(usableViewportRect(), 80);
  return (ephemeris?.bodies ?? []).filter((body) => {
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    return screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom;
  });
}

function prioritizedLabelBodies() {
  const selected = selectedBody();
  const visible = visibleBodies();
  return visible
    .filter((body) => body.key === selected?.key || body.key === hoverKey || isMajorBody(body) || camera.pxPerAu > 12)
    .sort((a, b) => labelPriority(b) - labelPriority(a))
    .slice(0, 40);
}

function bodiesOutsideViewport() {
  const rect = usableViewportRect();
  const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  return (ephemeris?.bodies ?? [])
    .filter(isMajorBody)
    .map((body) => {
      const screen = worldToScreen(body.position.x_au, body.position.y_au);
      return { body, screen, screenDistance: Math.hypot(screen.x - center.x, screen.y - center.y) };
    })
    .filter(({ screen }) => screen.x < rect.left || screen.x > rect.right || screen.y < rect.top || screen.y > rect.bottom);
}

function markerRadius(body: Body) {
  const trueRadiusPx = (body.radius_km / auKm()) * camera.pxPerAu;
  const classification = classifyBody(body);
  const base = classification.type === "star" ? 5.4 : classification.type === "planet" ? 4.8 : classification.type === "moon" ? 3.5 : 3.2;
  if (sizeMode === "true") return clamp(trueRadiusPx, body.key === selectedKey ? 2.2 : 0.7, 36);
  if (sizeMode === "readable") return body.key === selectedKey ? base + 2.5 : base;
  return clamp(Math.max(trueRadiusPx, base), body.key === selectedKey ? 4.8 : 2.4, 42);
}

function bodyAlpha(body: Body) {
  if (body.catalog_group === "messier_deep_sky" && camera.pxPerAu > 1e-5) return 0.28;
  if (body.catalog_group === "nearby_exoplanet_systems" && camera.pxPerAu > 0.01) return 0.42;
  return 0.88;
}

function labelPriority(body: Body) {
  if (body.key === selectedKey) return 100;
  if (body.key === hoverKey) return 90;
  const classification = classifyBody(body);
  if (body.key === "sun") return 80;
  if (classification.type === "planet") return 70;
  if (classification.type === "moon") return 42;
  if (classification.type === "star") return 36;
  return 20;
}

function isMajorBody(body: Body) {
  const type = classifyBody(body).type;
  return type === "planet" || type === "star" || type === "galaxy" || body.key === selectedKey || FEATURED_KEYS.includes(body.key);
}

function isSolarSystemBody(body: Body) {
  return body.catalog_group === "core" || body.catalog_group?.endsWith("_moons");
}

function countBodies(bodies: Body[]) {
  return bodies.reduce(
    (counts, body) => {
      const type = classifyBody(body).type;
      if (type === "planet") counts.planet += 1;
      if (type === "moon") counts.moon += 1;
      if (body.catalog_group === "messier_deep_sky") counts.deepSky += 1;
      return counts;
    },
    { planet: 0, moon: 0, deepSky: 0 }
  );
}

function selectedBody() {
  return bodyByKey.get(selectedKey) ?? null;
}

function worldToScreen(xAu: number, yAu: number): ScreenPoint {
  const rect = usableViewportRect();
  return {
    x: rect.left + rect.width / 2 + (xAu - camera.xAu) * camera.pxPerAu,
    y: rect.top + rect.height / 2 - (yAu - camera.yAu) * camera.pxPerAu
  };
}

function screenToWorld(x: number, y: number) {
  const rect = usableViewportRect();
  return {
    xAu: camera.xAu + (x - (rect.left + rect.width / 2)) / camera.pxPerAu,
    yAu: camera.yAu - (y - (rect.top + rect.height / 2)) / camera.pxPerAu
  };
}

function usableViewportRect(): Rect {
  const shell = document.querySelector<HTMLElement>(".atlas-shell");
  const bar = document.querySelector<HTMLElement>(".atlas-bar");
  const shellRect = shell?.getBoundingClientRect();
  const barRect = bar?.getBoundingClientRect();
  const isWide = window.innerWidth >= 900;
  const left = 0;
  const top = isWide ? Math.max(0, (barRect?.bottom ?? 0) + 8) : Math.max(0, (barRect?.bottom ?? 0) + 8);
  const right = isWide && shellRect ? Math.max(240, shellRect.left - 12) : window.innerWidth;
  const bottom = !isWide && shellRect ? Math.max(top + 160, shellRect.top - 10) : window.innerHeight;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function expandedRect(rect: Rect, amount: number): Rect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

function eventToCanvasPoint(event: PointerEvent | WheelEvent): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function resizeCanvas() {
  const width = Math.floor(window.innerWidth);
  const height = Math.floor(window.innerHeight);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

function setLoading(step: LoadingStep, progress: number, detail: string) {
  const elapsed = (performance.now() - loadingStartedAt) / 1000;
  loadingDetail.textContent = detail;
  loadingFill.style.width = `${progress}%`;
  loadingProgressLabel.textContent = `${progress}%`;
  loadingStepLabel.textContent = step;
  loadingElapsed.textContent = `${elapsed.toFixed(1)}s`;
  for (const item of document.querySelectorAll<HTMLElement>("[data-loading-step]")) {
    item.classList.toggle("active", item.dataset.loadingStep === step);
  }
}

function setError(message: string) {
  errorPanel.hidden = !message;
  errorPanel.textContent = message;
}

function dateFromInput() {
  if (!timeInput.value) return null;
  const date = new Date(`${timeInput.value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatDistance(km: number) {
  return formatPickerDistance(km, auKm());
}

function nullableDistance(km: number | null | undefined) {
  return typeof km === "number" && Number.isFinite(km) ? formatDistance(km) : "Unknown";
}

function nullableNumber(value: number | null | undefined, digits: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "Unknown";
}

function nullableDegrees(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} deg` : "Unknown";
}

function nullableDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  if (value >= 365) return `${(value / 365.25).toFixed(2)} years`;
  return `${value.toFixed(2)} days`;
}

function nullableLightYears(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value)} ly` : "Unknown";
}

function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: "compact" }).format(value);
  if (abs >= 10_000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  if (abs >= 100) return Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  if (abs >= 1) return Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function readablePositionModel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) || "Unknown";
}

function shortBodyName(name: string) {
  return name.replace(/^M(\d+)\s+/, "M$1 ");
}

function niceStep(rawStep: number) {
  const exponent = Math.floor(Math.log10(Math.max(rawStep, 1e-12)));
  const base = 10 ** exponent;
  const fraction = rawStep / base;
  if (fraction <= 1) return base;
  if (fraction <= 2) return 2 * base;
  if (fraction <= 5) return 5 * base;
  return 10 * base;
}

function auKm() {
  return ephemeris?.au_km ?? AU_KM_FALLBACK;
}

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function rectInCanvas(rect: Rect) {
  return rect.right >= 0 && rect.left <= canvas.width && rect.bottom >= 0 && rect.top <= canvas.height;
}

function rectsOverlap(a: Rect, b: Rect) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function roundedRect(x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
