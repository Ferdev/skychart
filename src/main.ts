import "./styles.css";
import "./destinationPicker.css";
import {
  buildDestinationPickerItems,
  buildDestinationPickerSections,
  classifyBody,
  findDestinationBody,
  readRecentDestinations,
  recordRecentDestination,
  type DestinationBodyType,
  type DestinationPickerItem
} from "./destinationPicker";
import { educationalComparisons } from "./navigationMetrics";
import { firstRunSteps, keyboardControls, modeCopy } from "./onboardingContent";

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_SPEED_KM_S = 299_792.458;
const EARTH_MOON_AVG_KM = 384_400;
const QUICK_TARGETS = ["moon", "mars", "jupiter", "saturn"];
const BODY_FILTERS = ["all", "planet", "moon", "star"] as const;
const ONBOARDING_DISMISSED_KEY = "cosmic-atlas.onboarding-dismissed";
const TRANSFER_PATH_SAMPLES = 96;
const ICONS: Record<string, string> = {
  target:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path></svg>',
  locate:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path><circle cx="12" cy="12" r="5"></circle></svg>',
  center:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h5M15 12h5M12 4v5M12 15v5"></path><circle cx="12" cy="12" r="2"></circle></svg>',
  check:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
  minus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"></path></svg>',
  plus:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"></path></svg>',
  sun:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>',
  ship:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 18-7-4-7 4 7-18Z"></path></svg>',
  back:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"></path></svg>',
  forward:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>',
  reset:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h7a6 6 0 1 1-5.2 9"></path><path d="M7 3v4h4"></path></svg>',
  restart:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V5"></path><path d="M6 5h10l-2 4 2 4H6"></path></svg>',
  waypoint:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path><circle cx="12" cy="10" r="2"></circle></svg>',
  ruler:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 17 4l3 3L7 20l-3-3Z"></path><path d="m13 8 3 3M10 11l2 2M7 14l3 3"></path></svg>',
  close:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
};

type BodyFilter = (typeof BODY_FILTERS)[number];
type InteractionMode = "pan" | "target" | "measure";
type DisplayLayer = "labels" | "rings" | "route" | "trails";
type ZoomPreset = "inner" | "outer" | "all";

type TargetKey = string;

type BodyPosition = {
  x_au: number;
  y_au: number;
  z_au: number;
  x_km: number;
  y_km: number;
  z_km: number;
  heliocentric_distance_km: number;
};

type Body = {
  key: string;
  name: string;
  radius_km: number;
  color: string;
  position: BodyPosition;
  distance_from_earth_km: number;
};

type Ephemeris = {
  timestamp_utc: string;
  generated_at_utc: string;
  data_source: string;
  coordinate_frame: string;
  units: Record<string, string>;
  au_km: number;
  earth_position: BodyPosition;
  bodies: Body[];
};

type Ship = {
  xAu: number;
  yAu: number;
  zAu: number;
  vxAuPerSec: number;
  vyAuPerSec: number;
  angleRad: number;
};

type JourneyStats = {
  targetKey: TargetKey;
  closestKm: number;
  arrived: boolean;
  elapsedSeconds: number;
  distanceTraveledKm: number;
  maxSpeedKmS: number;
  lastShipXAu: number | null;
  lastShipYAu: number | null;
};

type MeasurePoint = {
  label: string;
  xAu: number;
  yAu: number;
  zAu: number;
  bodyKey?: string;
};

type RouteWaypoint = {
  key: string;
  name: string;
};

type TrailPoint = {
  x_au: number;
  y_au: number;
  z_au: number;
};

type BodyTrail = {
  key: string;
  name: string;
  points: TrailPoint[];
};

type RoutePoint = {
  xAu: number;
  yAu: number;
  zAu: number;
};

type TrajectoryEvent = {
  kind: "departure" | "flyby" | "arrival";
  body_key: string;
  body_name: string;
  timestamp_utc: string;
  offset_days: number;
  x_au: number;
  y_au: number;
  z_au: number;
};

type TrajectorySample = {
  x_au: number;
  y_au: number;
  z_au: number;
};

type TrajectoryLeg = {
  from: string;
  from_name: string;
  to: string;
  to_name: string;
  tof_days: number;
  path_distance_km: number;
  departure_vinf_km_s: number;
  arrival_vinf_km_s: number;
};

type FlybyMetrics = {
  body_key: string;
  body_name: string;
  incoming_vinf_km_s: number;
  outgoing_vinf_km_s: number;
  speed_change_km_s: number;
  turn_angle_deg: number;
  max_turn_angle_deg: number;
  turn_deficit_deg: number;
  periapsis_altitude_km: number;
  powered_flyby_delta_v_km_s: number;
  feasible: boolean;
};

type TrajectoryCandidate = {
  id: string;
  kind: "direct" | "gravity_assist";
  label: string;
  body_sequence: string[];
  assist_body_key: string | null;
  events: TrajectoryEvent[];
  legs: TrajectoryLeg[];
  samples: TrajectorySample[];
  warnings: string[];
  flyby?: FlybyMetrics;
  metrics: {
    total_delta_v_km_s: number;
    launch_vinf_km_s: number;
    arrival_vinf_km_s: number;
    powered_flyby_delta_v_km_s?: number;
    total_time_days: number;
    departure_offset_days: number;
    flyby_offset_days?: number;
    arrival_offset_days: number;
    path_distance_km: number;
    assist_speed_change_km_s?: number;
    score: number;
    feasible: boolean;
  };
};

type TrajectoryPlan = {
  timestamp_utc: string;
  generated_at_utc: string;
  data_source: string;
  coordinate_frame: string;
  parameters: {
    origin: string;
    destination: string;
    assist: string;
    scan_days: number;
    step_days: number;
    candidate_count: number;
  };
  selected_candidate_id: string;
  best_direct_candidate_id: string | null;
  best_gravity_assist_candidate_id: string | null;
  candidates: TrajectoryCandidate[];
  limitations: string[];
};

const canvas = requiredElement<HTMLCanvasElement>("#map");
const hudValues = requiredElement<HTMLElement>("#hud-values");
const loadState = requiredElement<HTMLElement>("#load-state");
const targetButtons = requiredElement<HTMLElement>("#target-buttons");
const destinationSearch = requiredElement<HTMLInputElement>("#destination-search");
const bodyPicker = requiredElement<HTMLElement>("#body-picker");
const bodyFilterButtons = requiredElement<HTMLElement>("#body-filter-buttons");
const routeMemory = requiredElement<HTMLElement>("#route-memory");
const setDestination = requiredElement<HTMLButtonElement>("#set-destination");
const jumpDestination = requiredElement<HTMLButtonElement>("#jump-destination");
const bodySelect = requiredElement<HTMLSelectElement>("#body-select");
const journey = requiredElement<HTMLElement>("#journey");
const bodyInfo = requiredElement<HTMLElement>("#body-info");
const flightValues = requiredElement<HTMLElement>("#flight-values");
const errorPanel = requiredElement<HTMLElement>("#error-panel");
const timeSummary = requiredElement<HTMLElement>("#time-summary");
const zoomIn = requiredElement<HTMLButtonElement>("#zoom-in");
const zoomOut = requiredElement<HTMLButtonElement>("#zoom-out");
const centerSun = requiredElement<HTMLButtonElement>("#center-sun");
const centerShip = requiredElement<HTMLButtonElement>("#center-ship");
const centerSelected = requiredElement<HTMLButtonElement>("#center-selected");
const targetSelected = requiredElement<HTMLButtonElement>("#target-selected");
const timeInput = requiredElement<HTMLInputElement>("#time-input");
const applyTime = requiredElement<HTMLButtonElement>("#apply-time");
const timeNow = requiredElement<HTMLButtonElement>("#time-now");
const resetShipButton = requiredElement<HTMLButtonElement>("#reset-ship");
const restartJourneyButton = requiredElement<HTMLButtonElement>("#restart-journey");
const modeButtons = requiredElement<HTMLElement>("#mode-buttons");
const displayToggles = requiredElement<HTMLElement>("#display-toggles");
const zoomPresets = requiredElement<HTMLElement>("#zoom-presets");
const bodyPopover = requiredElement<HTMLElement>("#body-popover");
const measurePanel = requiredElement<HTMLElement>("#measure-panel");
const onboardingPanel = requiredElement<HTMLElement>("#onboarding-panel");
const ctx = requiredCanvasContext(canvas);

const keys = new Set<string>();
const camera = {
  xAu: 0,
  yAu: 0,
  pxPerAu: 64
};

let ephemeris: Ephemeris | null = null;
let bodyByKey = new Map<string, Body>();
let selectedTarget = "jupiter";
let selectedBodyKey = "jupiter";
let ship: Ship | null = null;
let journeyStats: JourneyStats = createJourneyStats(selectedTarget);
let activeBodyFilter: BodyFilter = "all";
let interactionMode: InteractionMode = "pan";
let recentDestinations = readRecentDestinations();
let routeWaypoints: RouteWaypoint[] = [];
let measurePoints: MeasurePoint[] = [];
let activePopoverBodyKey: string | null = null;
let bodyTrails: BodyTrail[] = [];
let trailsLoading = false;
let trailsError = "";
let trajectoryPlan: TrajectoryPlan | null = null;
let trajectoryLoading = false;
let trajectoryError = "";
let selectedTrajectoryCandidateId: string | null = null;
let trajectoryRequestId = 0;
const displayLayers: Record<DisplayLayer, boolean> = {
  labels: true,
  rings: true,
  route: true,
  trails: false
};
let warpEnabled = false;
let lastFrame = performance.now();
let lastHudRender = 0;
let isDragging = false;
let dragMoved = false;
let dragStart = { x: 0, y: 0, cameraXAu: 0, cameraYAu: 0 };

for (const target of QUICK_TARGETS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "target-card";
  button.dataset.target = target;
  button.setAttribute("aria-label", `Set target to ${labelForKey(target)}`);
  button.innerHTML = quickTargetMarkup(target);
  button.addEventListener("click", () => {
    setTarget(target, { inspect: true, center: false });
  });
  targetButtons.appendChild(button);
}
initializeBodyFilterButtons();
initializeModeButtons();
decorateStaticControls();
renderOnboarding();
updateTargetButtons();

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) {
      warpEnabled = !warpEnabled;
      updateHud(true);
    }
    return;
  }
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 0.86 : 1.16);
});

canvas.addEventListener("pointerdown", (event) => {
  isDragging = true;
  dragMoved = false;
  canvas.setPointerCapture(event.pointerId);
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    cameraXAu: camera.xAu,
    cameraYAu: camera.yAu
  };
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 4) {
    dragMoved = true;
  }
  camera.xAu = dragStart.cameraXAu - (event.clientX - dragStart.x) / camera.pxPerAu;
  camera.yAu = dragStart.cameraYAu + (event.clientY - dragStart.y) / camera.pxPerAu;
});

canvas.addEventListener("pointerup", (event) => {
  isDragging = false;
  canvas.releasePointerCapture(event.pointerId);
  if (!dragMoved) {
    handleMapClick(event.clientX, event.clientY);
  }
});

zoomIn.addEventListener("click", () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25));
zoomOut.addEventListener("click", () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8));
centerSun.addEventListener("click", () => {
  camera.xAu = 0;
  camera.yAu = 0;
});
centerShip.addEventListener("click", () => {
  if (!ship) return;
  camera.xAu = ship.xAu;
  camera.yAu = ship.yAu;
});
centerSelected.addEventListener("click", () => centerOnBody(selectedBodyKey));
targetSelected.addEventListener("click", () => setTarget(selectedBodyKey, { inspect: true }));
bodySelect.addEventListener("change", () => {
  selectedBodyKey = bodySelect.value;
  renderBodyPicker();
  updateHud(true);
});
destinationSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    setDestination.click();
  }
});
destinationSearch.addEventListener("input", () => renderBodyPicker());
bodyPicker.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-picker-body]");
  const key = button?.dataset.pickerBody;
  if (!key) return;
  setTarget(key, { inspect: true });
});
routeMemory.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-recent-destination]");
  const key = button?.dataset.recentDestination;
  if (!key) return;
  setTarget(key, { inspect: true });
});
journey.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-trajectory-candidate]");
  const candidateId = button?.dataset.trajectoryCandidate;
  if (!candidateId) return;
  selectedTrajectoryCandidateId = candidateId;
  updateHud(true);
});
setDestination.addEventListener("click", () => {
  const body = bodyFromSearchValue(destinationSearch.value);
  if (!body) {
    flashSearchError();
    return;
  }
  setTarget(body.key, { inspect: true });
});
jumpDestination.addEventListener("click", () => {
  const body = bodyFromSearchValue(destinationSearch.value) ?? bodyByKey.get(selectedTarget);
  if (!body) {
    flashSearchError();
    return;
  }
  centerOnBody(body.key);
});
applyTime.addEventListener("click", () => {
  const timestamp = datetimeLocalToIso(timeInput.value);
  if (timestamp) {
    loadEphemeris(timestamp, { preserveCamera: true });
  }
});
timeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    applyTime.click();
  }
});
timeNow.addEventListener("click", () => loadEphemeris(new Date().toISOString(), { preserveCamera: true }));
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-step-days]")) {
  button.addEventListener("click", () => {
    if (!ephemeris) return;
    const days = Number(button.dataset.stepDays ?? "0");
    const next = new Date(ephemeris.timestamp_utc);
    next.setUTCDate(next.getUTCDate() + days);
    loadEphemeris(next.toISOString(), { preserveCamera: true });
  });
}
resetShipButton.addEventListener("click", () => {
  resetShipNearEarth(false);
  updateHud();
});
restartJourneyButton.addEventListener("click", () => {
  resetShipNearEarth(true);
  updateHud();
});
modeButtons.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]");
  const mode = button?.dataset.mode as InteractionMode | undefined;
  if (!mode || !modeCopy[mode]) return;
  interactionMode = mode;
  updateModeButtons();
  updateMeasurePanel();
});
displayToggles.addEventListener("change", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-layer]");
  const layer = input?.dataset.layer as DisplayLayer | undefined;
  if (!input || !layer) return;
  displayLayers[layer] = input.checked;
  if (layer === "trails" && input.checked) {
    loadTrails();
  }
  updateHud();
});
zoomPresets.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-zoom-preset]");
  const preset = button?.dataset.zoomPreset as ZoomPreset | undefined;
  if (!preset) return;
  applyZoomPreset(preset);
});
bodyPopover.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-popover-action]");
  if (!button || !activePopoverBodyKey) return;
  handlePopoverAction(button.dataset.popoverAction ?? "", activePopoverBodyKey);
});
measurePanel.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-measure-action]");
  if (button?.dataset.measureAction !== "clear") return;
  measurePoints = [];
  updateMeasurePanel();
});
onboardingPanel.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dismiss-onboarding]");
  if (!button) return;
  localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
  onboardingPanel.hidden = true;
});

resizeCanvas();
loadEphemeris();
requestAnimationFrame(loop);

async function loadEphemeris(timestampUtc?: string, options: { preserveCamera?: boolean } = {}) {
  try {
    loadState.textContent = "loading";
    const query = timestampUtc ? `?timestamp=${encodeURIComponent(timestampUtc)}` : "";
    const response = await fetch(`/api/ephemeris${query}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ephemeris API returned ${response.status}.\n${text}`);
    }

    ephemeris = (await response.json()) as Ephemeris;
    bodyByKey = new Map(ephemeris.bodies.map((body) => [body.key, body]));
    ensureSelectedKeysExist();
    populateCatalogControls();
    setTimeInputFromTimestamp(ephemeris.timestamp_utc);
    updateTimeSummary();
    initializeShip();
    resetJourneyStats();
    if (!options.preserveCamera) {
      fitInitialView();
    }
    if (displayLayers.trails) {
      loadTrails();
    }
    void loadTrajectoryPlan();
    loadState.textContent = "live";
    errorPanel.hidden = true;
    updateHud();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadState.textContent = "error";
    errorPanel.hidden = false;
    errorPanel.textContent = [
      "Could not load live ephemeris data.",
      "",
      "Start the Python API first, then reload the page.",
      "",
      message
    ].join("\n");
  }
}

async function loadTrajectoryPlan() {
  if (!ephemeris || !selectedTarget || selectedTarget === "earth" || selectedTarget === "sun") {
    trajectoryPlan = null;
    selectedTrajectoryCandidateId = null;
    trajectoryLoading = false;
    trajectoryError = "";
    return;
  }

  const requestId = ++trajectoryRequestId;
  trajectoryLoading = true;
  trajectoryError = "";
  updateHud(true);

  try {
    const assist = routeWaypoints[0]?.key ?? "auto";
    const query = new URLSearchParams({
      timestamp: ephemeris.timestamp_utc,
      destination: selectedTarget,
      assist,
      scan_days: "900",
      step_days: "60"
    });
    const response = await fetch(`/api/trajectory?${query.toString()}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as TrajectoryPlan;
    if (requestId !== trajectoryRequestId) return;
    trajectoryPlan = payload;
    selectedTrajectoryCandidateId = payload.selected_candidate_id;
  } catch (error) {
    if (requestId !== trajectoryRequestId) return;
    trajectoryPlan = null;
    selectedTrajectoryCandidateId = null;
    trajectoryError = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestId === trajectoryRequestId) {
      trajectoryLoading = false;
      updateHud(true);
    }
  }
}

async function loadTrails() {
  if (!ephemeris || trailsLoading) return;
  trailsLoading = true;
  trailsError = "";
  try {
    const bodyKeys = ephemeris.bodies
      .filter((body) => body.key !== "sun")
      .map((body) => body.key)
      .join(",");
    const query = new URLSearchParams({
      timestamp: ephemeris.timestamp_utc,
      bodies: bodyKeys,
      days: "3650",
      step_days: "45"
    });
    const response = await fetch(`/api/trails?${query.toString()}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = (await response.json()) as { bodies: BodyTrail[] };
    bodyTrails = payload.bodies.map((trail) => ({
      key: trail.key,
      name: trail.name,
      points: trail.points.map((point) => ({ x_au: point.x_au, y_au: point.y_au, z_au: point.z_au }))
    }));
  } catch (error) {
    trailsError = error instanceof Error ? error.message : String(error);
    displayLayers.trails = false;
    const input = displayToggles.querySelector<HTMLInputElement>('[data-layer="trails"]');
    if (input) input.checked = false;
  } finally {
    trailsLoading = false;
    updateHud();
  }
}

function initializeShip(force = false) {
  const earth = bodyByKey.get("earth");
  if (!earth || (ship && !force)) return;

  const earthAngle = Math.atan2(earth.position.y_au, earth.position.x_au);
  const tangent = earthAngle + Math.PI / 2;
  ship = {
    xAu: earth.position.x_au + Math.cos(tangent) * 0.002,
    yAu: earth.position.y_au + Math.sin(tangent) * 0.002,
    zAu: earth.position.z_au,
    vxAuPerSec: 0,
    vyAuPerSec: 0,
    angleRad: tangent
  };
}

function resetShipNearEarth(resetStats: boolean) {
  initializeShip(true);
  if (resetStats) {
    resetJourneyStats();
  }
}

function fitInitialView() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const outerBody = bodyByKey.get("saturn");
  const radiusAu = outerBody ? Math.hypot(outerBody.position.x_au, outerBody.position.y_au) : 10;
  camera.pxPerAu = clamp(Math.min(width, height) / (radiusAu * 2.35), 18, 82);
  camera.xAu = 0;
  camera.yAu = 0;
}

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateShip(dt);
  draw();
  requestAnimationFrame(loop);
}

function updateShip(dt: number) {
  if (!ship) return;
  const previousX = ship.xAu;
  const previousY = ship.yAu;

  const rotationSpeed = warpEnabled ? 1.45 : 1.9;
  if (keys.has("KeyA")) ship.angleRad += rotationSpeed * dt;
  if (keys.has("KeyD")) ship.angleRad -= rotationSpeed * dt;

  const warpMultiplier = warpEnabled ? 250 : 1;
  const accelerationAu = 0.00000018 * warpMultiplier;
  const maxSpeedAu = 0.000026 * warpMultiplier;
  let thrust = 0;
  if (keys.has("KeyW")) thrust += 1;
  if (keys.has("KeyS")) thrust -= 0.75;

  if (thrust !== 0) {
    ship.vxAuPerSec += Math.cos(ship.angleRad) * accelerationAu * thrust * dt;
    ship.vyAuPerSec += Math.sin(ship.angleRad) * accelerationAu * thrust * dt;
  }

  if (!warpEnabled) {
    ship.vxAuPerSec *= 0.9995;
    ship.vyAuPerSec *= 0.9995;
  }

  const speed = Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec);
  if (speed > maxSpeedAu) {
    const ratio = maxSpeedAu / speed;
    ship.vxAuPerSec *= ratio;
    ship.vyAuPerSec *= ratio;
  }

  ship.xAu += ship.vxAuPerSec * dt;
  ship.yAu += ship.vyAuPerSec * dt;

  const target = bodyByKey.get(selectedTarget);
  if (target) {
    updateJourneyStats(shipTargetDistanceKm(target), target, dt, previousX, previousY);
  }
  updateHud();
}

function draw() {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, width, height);
  drawStarfield(width, height);
  if (displayLayers.rings) {
    drawDistanceRings();
  }

  if (ephemeris) {
    if (displayLayers.trails) {
      drawBodyTrails();
    }
    if (displayLayers.route) {
      drawRouteGuide();
    }
    drawTargetHeadingIndicator();
    for (const body of ephemeris.bodies) {
      drawBody(body);
    }
  }

  drawMeasurement();
  drawShip();
  drawMiniMap(width, height);
  ctx.restore();
}

function drawStarfield(width: number, height: number) {
  ctx.fillStyle = "#060607";
  ctx.fillRect(0, 0, width, height);

  const gridAu = pickGridAu();
  const left = camera.xAu - width / 2 / camera.pxPerAu;
  const right = camera.xAu + width / 2 / camera.pxPerAu;
  const bottom = camera.yAu - height / 2 / camera.pxPerAu;
  const top = camera.yAu + height / 2 / camera.pxPerAu;
  const startX = Math.floor(left / gridAu) * gridAu;
  const startY = Math.floor(bottom / gridAu) * gridAu;

  ctx.strokeStyle = "rgba(243, 240, 232, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= right; x += gridAu) {
    const p = worldToScreen(x, 0);
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, height);
  }
  for (let y = startY; y <= top; y += gridAu) {
    const p = worldToScreen(0, y);
    ctx.moveTo(0, p.y);
    ctx.lineTo(width, p.y);
  }
  ctx.stroke();
}

function drawDistanceRings() {
  const rings = [0.39, 0.72, 1, 1.52, 5.2, 9.58, 19.2, 30.1];
  const sun = worldToScreen(0, 0);
  ctx.save();
  ctx.strokeStyle = "rgba(243, 240, 232, 0.12)";
  ctx.fillStyle = "rgba(243, 240, 232, 0.46)";
  ctx.font = "11px ui-sans-serif, system-ui";

  for (const au of rings) {
    const radius = au * camera.pxPerAu;
    if (radius < 6 || radius > Math.max(canvas.width, canvas.height) / devicePixelRatio * 2) continue;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (radius > 26) {
      ctx.fillText(`${formatAu(au)} AU`, sun.x + radius + 5, sun.y - 4);
    }
  }
  ctx.restore();
}

function drawRouteGuide() {
  const earth = bodyByKey.get("earth");
  const target = bodyByKey.get(selectedTarget);
  if (!earth || !target) return;

  const activePlan = activeTrajectoryCandidate();
  const routeBodies = routeBodySequence(earth, target);
  const routePoints = activeRoutePoints(earth, target);
  if (routePoints.length < 2) return;
  const routeScreens = routePoints.map((point) => worldToScreen(point.xAu, point.yAu));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(116, 196, 255, 0.12)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  routeScreens.forEach((screen, index) => {
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();

  ctx.strokeStyle = activePlan?.kind === "gravity_assist" ? "rgba(217, 184, 111, 0.78)" : "rgba(116, 196, 255, 0.68)";
  ctx.lineWidth = 2.4;
  ctx.setLineDash(activePlan?.kind === "gravity_assist" ? [9, 7] : []);
  ctx.beginPath();
  routeScreens.forEach((screen, index) => {
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();

  ctx.setLineDash([]);
  if (activePlan) {
    for (const event of activePlan.events) {
      const screen = worldToScreen(event.x_au, event.y_au);
      ctx.fillStyle = event.kind === "flyby" ? "rgba(217, 184, 111, 0.96)" : "rgba(116, 196, 255, 0.92)";
      ctx.strokeStyle = "rgba(6, 6, 7, 0.86)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, event.kind === "flyby" ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(244, 241, 232, 0.82)";
      ctx.font = "700 11px ui-sans-serif, system-ui";
      ctx.fillText(`${event.kind}: ${event.body_name}`, screen.x + 9, screen.y - 7);
    }
  } else {
    for (const body of routeBodies) {
      const screen = worldToScreen(body.position.x_au, body.position.y_au);
      ctx.strokeStyle = body.key === selectedTarget ? "rgba(217, 184, 111, 0.88)" : "rgba(116, 196, 255, 0.58)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(7, displayRadius(body) + 4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const labelPoint = routeScreens[Math.floor(routeScreens.length * 0.5)];
  if (labelPoint) {
    ctx.fillStyle = activePlan?.kind === "gravity_assist" ? "rgba(217, 184, 111, 0.9)" : "rgba(116, 196, 255, 0.82)";
    ctx.font = "700 11px ui-sans-serif, system-ui";
    ctx.fillText(activePlan?.kind === "gravity_assist" ? "gravity-assist plan" : "transfer plan", labelPoint.x + 10, labelPoint.y - 8);
  }
  ctx.restore();
}

function drawBodyTrails() {
  if (!bodyTrails.length) return;
  ctx.save();
  for (const trail of bodyTrails) {
    if (trail.points.length < 2) continue;
    const isTarget = trail.key === selectedTarget;
    ctx.strokeStyle = isTarget ? "rgba(217, 184, 111, 0.42)" : "rgba(244, 241, 232, 0.13)";
    ctx.lineWidth = isTarget ? 1.8 : 1;
    ctx.setLineDash(isTarget ? [6, 5] : [2, 7]);
    ctx.beginPath();
    trail.points.forEach((point, index) => {
      const screen = worldToScreen(point.x_au, point.y_au);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeasurement() {
  if (measurePoints.length === 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(217, 184, 111, 0.76)";
  ctx.fillStyle = "rgba(217, 184, 111, 0.96)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 5]);
  const screens = measurePoints.map((point) => worldToScreen(point.xAu, point.yAu));
  if (screens.length === 2) {
    ctx.beginPath();
    ctx.moveTo(screens[0].x, screens[0].y);
    ctx.lineTo(screens[1].x, screens[1].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const screen of screens) {
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMiniMap(width: number, height: number) {
  if (!ephemeris || window.innerWidth < 760) return;
  const size = 118;
  const x = width - size - 504;
  const y = height - size - 16;
  if (x < 380) return;
  const maxAu = Math.max(1, ...ephemeris.bodies.map((body) => Math.hypot(body.position.x_au, body.position.y_au)));
  const scale = (size - 22) / (maxAu * 2);

  ctx.save();
  ctx.fillStyle = "rgba(10, 14, 15, 0.7)";
  ctx.strokeStyle = "rgba(244, 241, 232, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 8);
  ctx.fill();
  ctx.stroke();

  const centerX = x + size / 2;
  const centerY = y + size / 2;
  for (const body of ephemeris.bodies) {
    const px = centerX + body.position.x_au * scale;
    const py = centerY - body.position.y_au * scale;
    ctx.fillStyle = body.key === selectedTarget ? "#d9b86f" : body.color;
    ctx.beginPath();
    ctx.arc(px, py, body.key === selectedTarget ? 3.5 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const viewHalfWidthAu = width / 2 / camera.pxPerAu;
  const viewHalfHeightAu = height / 2 / camera.pxPerAu;
  ctx.strokeStyle = "rgba(116, 196, 255, 0.58)";
  ctx.strokeRect(
    centerX + (camera.xAu - viewHalfWidthAu) * scale,
    centerY - (camera.yAu + viewHalfHeightAu) * scale,
    viewHalfWidthAu * 2 * scale,
    viewHalfHeightAu * 2 * scale
  );
  ctx.restore();
}

function drawTargetHeadingIndicator() {
  if (!ship) return;
  const target = bodyByKey.get(selectedTarget);
  if (!target) return;

  const shipScreen = worldToScreen(ship.xAu, ship.yAu);
  const direction = Math.atan2(target.position.y_au - ship.yAu, target.position.x_au - ship.xAu);
  const forward = { x: Math.cos(direction), y: -Math.sin(direction) };
  const side = { x: -forward.y, y: forward.x };
  const start = 28;
  const end = 74;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 209, 102, 0.78)";
  ctx.fillStyle = "rgba(255, 209, 102, 0.92)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(shipScreen.x + forward.x * start, shipScreen.y + forward.y * start);
  ctx.lineTo(shipScreen.x + forward.x * end, shipScreen.y + forward.y * end);
  ctx.stroke();

  const tipX = shipScreen.x + forward.x * end;
  const tipY = shipScreen.y + forward.y * end;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - forward.x * 11 + side.x * 6, tipY - forward.y * 11 + side.y * 6);
  ctx.lineTo(tipX - forward.x * 11 - side.x * 6, tipY - forward.y * 11 - side.y * 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBody(body: Body) {
  const screen = worldToScreen(body.position.x_au, body.position.y_au);
  const radius = displayRadius(body);
  const isTarget = body.key === selectedTarget;
  const isSelectedBody = body.key === selectedBodyKey;

  ctx.save();
  if (body.key === "saturn") {
    ctx.strokeStyle = "rgba(216, 194, 138, 0.74)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, radius * 1.65, radius * 0.55, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = body.color;
  ctx.strokeStyle = isTarget ? "#f3f0e8" : isSelectedBody ? "#74c4ff" : "rgba(0, 0, 0, 0.38)";
  ctx.lineWidth = isTarget || isSelectedBody ? 2 : 1;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (isSelectedBody && !isTarget) {
    ctx.strokeStyle = "rgba(116, 196, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (displayLayers.labels) {
    ctx.fillStyle = body.key === "sun" ? "#ffe8a3" : "#f3f0e8";
    ctx.font = isTarget || isSelectedBody ? "700 13px ui-sans-serif, system-ui" : "12px ui-sans-serif, system-ui";
    ctx.textBaseline = "middle";
    ctx.fillText(body.name, screen.x + radius + 7, screen.y);
  }
  ctx.restore();
}

function drawShip() {
  if (!ship) return;
  const screen = worldToScreen(ship.xAu, ship.yAu);
  const forward = { x: Math.cos(ship.angleRad), y: -Math.sin(ship.angleRad) };
  const side = { x: -forward.y, y: forward.x };
  const size = warpEnabled ? 14 : 11;

  ctx.save();
  if (warpEnabled) {
    ctx.strokeStyle = "rgba(116, 196, 255, 0.56)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, size + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#f3f0e8";
  ctx.strokeStyle = "#060607";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(screen.x + forward.x * size, screen.y + forward.y * size);
  ctx.lineTo(screen.x - forward.x * size * 0.75 + side.x * size * 0.62, screen.y - forward.y * size * 0.75 + side.y * size * 0.62);
  ctx.lineTo(screen.x - forward.x * size * 0.35, screen.y - forward.y * size * 0.35);
  ctx.lineTo(screen.x - forward.x * size * 0.75 - side.x * size * 0.62, screen.y - forward.y * size * 0.75 - side.y * size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function updateHud(force = false) {
  if (!ephemeris || !ship) return;
  const now = performance.now();
  if (!force && now - lastHudRender < 160) return;
  lastHudRender = now;

  const target = bodyByKey.get(selectedTarget);
  if (!target) return;

  const shipTargetKm = shipTargetDistanceKm(target);
  const shipSpeedKmS = shipSpeedKmPerSecond();
  const scaleKm = ephemeris.au_km / camera.pxPerAu;
  const navigation = navigationMetrics(target, shipTargetKm);
  const inspectedBody = bodyByKey.get(selectedBodyKey);

  hudValues.innerHTML = "";
  appendDefinition("UTC", formatTimestamp(ephemeris.timestamp_utc));
  appendDefinition("Target", target.name);
  appendDefinition("Inspecting", inspectedBody?.name ?? "none");
  appendDefinition("Data", ephemeris.data_source.replace("NASA/JPL ", "JPL "));
  appendDefinition("Frame", "heliocentric ecliptic x/y");

  updateFlightValues(shipSpeedKmS, scaleKm, navigation);
  updateBodyInfo();
  updateJourney(target, shipTargetKm);
}

function appendDefinition(term: string, value: string) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  hudValues.append(dt, dd);
}

function updateJourney(target: Body, shipTargetKm: number) {
  if (!ephemeris || !ship) return;
  const earth = bodyByKey.get("earth");
  if (!earth) return;

  const progress = journeyRouteProgress(earth, target, ship);
  const progressPercent = progress * 100;
  const remainingLightSeconds = shipTargetKm / LIGHT_SPEED_KM_S;
  const navigation = navigationMetrics(target, shipTargetKm);
  const thresholdKm = arrivalThresholdKm(target);
  const targetLightSeconds = target.distance_from_earth_km / LIGHT_SPEED_KM_S;
  const activePlan = activeTrajectoryCandidate();
  const routeDistanceKm = routeTotalDistanceKm(earth, target);
  const directRouteLabel = activePlan
    ? `${activePlan.label} path distance`
    : routeWaypoints.length
      ? `Transfer preview via ${routeWaypoints.length} waypoint${routeWaypoints.length === 1 ? "" : "s"}`
      : "Approx transfer preview distance";
  const nextAction = nextGuidanceText(navigation, shipTargetKm, thresholdKm);
  const comparisonText = distanceComparisonText(target.distance_from_earth_km);
  const status = journeyStats.arrived
    ? "arrived"
    : shipTargetKm <= thresholdKm
      ? "inside arrival zone"
      : navigation.closingSpeedKmS > 0
        ? "closing"
        : "not closing";
  const statusLabel = journeyStats.arrived ? "Arrival confirmed" : status;
  const routeProgress = clamp(progressPercent, 0, 100);
  const progressLabel = activePlan?.kind === "gravity_assist" ? "gravity-assist plan" : "transfer preview";

  journey.innerHTML = `
    <div class="journey-hero">
      <div>
        <span class="eyebrow">Journey</span>
        <h2>Earth to ${escapeHtml(target.name)}</h2>
      </div>
      <span class="status-token">${statusLabel}</span>
    </div>
    <div class="route-card">
      <div class="route-body origin">
        ${bodyOrbHtml(earth, "large")}
        <span>Origin</span>
        <strong>${escapeHtml(earth.name)}</strong>
      </div>
      <div class="route-vector" aria-label="Route progress from Earth to ${escapeHtml(target.name)}">
        <div class="route-track">
          <span class="route-progress-dot" style="left: ${routeProgress.toFixed(2)}%"></span>
        </div>
        <span>${activePlan?.kind === "gravity_assist" ? "gravity assist" : "transfer"} · ${formatDistance(routeDistanceKm)}</span>
      </div>
      <div class="route-body destination">
        ${bodyOrbHtml(target, "large")}
        <span>Destination</span>
        <strong>${escapeHtml(target.name)}</strong>
      </div>
    </div>
    <p class="route-note">${escapeHtml(routeNoteText(activePlan))}</p>
    ${renderTrajectoryPlanner(activePlan)}
    <div class="distance-focus">
      <span>${nextAction}</span>
      <strong>${formatDistance(shipTargetKm)}</strong>
    </div>
    <div class="progress-track" aria-label="Journey progress">
      <div class="progress-fill" style="width: ${progressPercent.toFixed(2)}%"></div>
    </div>
    <div class="progress-caption">
      <span>${progressPercent.toFixed(2)}% along ${progressLabel}</span>
      <span>${formatDuration(remainingLightSeconds)} light time remaining</span>
    </div>
    <div class="metric-tiles">
      <article>
        <span>ETA now</span>
        <strong>${navigation.etaText}</strong>
      </article>
      <article>
        <span>Heading error</span>
        <strong>${formatDegrees(navigation.headingErrorDeg)}</strong>
      </article>
      <article>
        <span>Closest approach</span>
        <strong>${Number.isFinite(journeyStats.closestKm) ? formatDistance(journeyStats.closestKm) : "not recorded"}</strong>
      </article>
      <article>
        <span>Arrival zone</span>
        <strong>${formatDistance(thresholdKm)}</strong>
      </article>
    </div>
    <div class="journey-grid detail-grid">
      <span>${directRouteLabel}</span><strong>${formatDistance(routeDistanceKm)}</strong>
      <span>Earth-target light time</span><strong>${formatDuration(targetLightSeconds)}</strong>
      <span>Comparison</span><strong>${comparisonText}</strong>
      <span>Distance flown</span><strong>${formatDistance(journeyStats.distanceTraveledKm)}</strong>
      <span>Max speed</span><strong>${formatNumber(journeyStats.maxSpeedKmS)} km/s</strong>
      <span>Elapsed flight time</span><strong>${formatDuration(journeyStats.elapsedSeconds)}</strong>
    </div>
  `;
}

function routeNoteText(candidate: TrajectoryCandidate | null) {
  if (!candidate) {
    return "Approximate Sun-centered trajectory preview. It uses real current positions, but it is not a full mission-grade gravity solve yet.";
  }
  if (candidate.kind === "gravity_assist") {
    const flyby = candidate.flyby;
    const status = flyby?.feasible ? "unpowered turn feasible" : "correction burn likely";
    return `${candidate.label}: patched-conic single-flyby plan from real JPL ephemeris states; ${status}.`;
  }
  return "Direct patched-conic transfer estimate from real JPL ephemeris states.";
}

function renderTrajectoryPlanner(activePlan: TrajectoryCandidate | null) {
  if (trajectoryLoading) {
    return `
      <section class="trajectory-panel">
        <div class="trajectory-head">
          <span>Gravity-assist planner</span>
          <strong>searching launch windows</strong>
        </div>
      </section>
    `;
  }

  if (trajectoryError) {
    return `
      <section class="trajectory-panel warning">
        <div class="trajectory-head">
          <span>Gravity-assist planner</span>
          <strong>unavailable</strong>
        </div>
        <p>${escapeHtml(trajectoryError)}</p>
      </section>
    `;
  }

  if (!trajectoryPlan || !activePlan) {
    return "";
  }

  const cards = trajectoryPlan.candidates.slice(0, 5).map((candidate) => renderTrajectoryCandidateCard(candidate, candidate.id === activePlan.id)).join("");
  const eventText = activePlan.events.map((event) => `${event.kind} ${event.body_name} ${offsetLabel(event.offset_days)}`).join(" · ");
  const flyby = activePlan.flyby;
  const flybyMetrics = flyby
    ? `
      <span>Flyby turn</span><strong>${formatDegrees(flyby.turn_angle_deg)} / ${formatDegrees(flyby.max_turn_angle_deg)}</strong>
      <span>Assist gain</span><strong>${formatSignedSpeed(flyby.speed_change_km_s)}</strong>
      <span>Flyby altitude</span><strong>${formatDistance(flyby.periapsis_altitude_km)}</strong>
    `
    : "";

  return `
    <section class="trajectory-panel">
      <div class="trajectory-head">
        <span>Gravity-assist planner</span>
        <strong>${activePlan.kind === "gravity_assist" ? "single-flyby patched conic" : "direct transfer"}</strong>
      </div>
      <div class="trajectory-cards">${cards}</div>
      <div class="trajectory-detail">
        <span>Selected plan</span><strong>${escapeHtml(activePlan.label)}</strong>
        <span>Events</span><strong>${escapeHtml(eventText)}</strong>
        <span>Total Δv estimate</span><strong>${formatDeltaV(activePlan.metrics.total_delta_v_km_s)}</strong>
        <span>Flight time</span><strong>${formatDuration(activePlan.metrics.total_time_days * 86_400)}</strong>
        ${flybyMetrics}
      </div>
      <p>${escapeHtml(activePlan.warnings[0] ?? trajectoryPlan.limitations[0] ?? "Patched-conic planning estimate.")}</p>
    </section>
  `;
}

function renderTrajectoryCandidateCard(candidate: TrajectoryCandidate, active: boolean) {
  const feasible = candidate.metrics.feasible;
  const flybyLabel = candidate.kind === "gravity_assist" ? "flyby" : "direct";
  return `
    <button type="button" class="trajectory-card${active ? " active" : ""}" data-trajectory-candidate="${escapeHtml(candidate.id)}">
      <span>${escapeHtml(flybyLabel)}</span>
      <strong>${escapeHtml(candidate.label)}</strong>
      <small>${formatDeltaV(candidate.metrics.total_delta_v_km_s)} · ${formatDuration(candidate.metrics.total_time_days * 86_400)}</small>
      <em>${feasible ? "feasible" : "needs burn"}</em>
    </button>
  `;
}

function updateFlightValues(shipSpeedKmS: number, scaleKm: number, navigation: ReturnType<typeof navigationMetrics>) {
  flightValues.innerHTML = `
    <div class="flight-help">
      ${keyboardControls
        .map((control) => {
          const pressed = control.keys.some((key) => keys.has(key.code)) || (control.id === "warp" && warpEnabled);
          return `
            <article class="${pressed ? "active" : ""}" title="${escapeHtml(control.tooltip)}">
              <div class="key-group">${control.keys.map((key) => `<kbd>${escapeHtml(key.label)}</kbd>`).join("")}</div>
              <span>${escapeHtml(control.label)}</span>
            </article>
          `;
        })
        .join("")}
    </div>
    <div class="flight-metric">
      <span>Speed</span>
      <strong>${formatNumber(shipSpeedKmS)} km/s</strong>
    </div>
    <div class="flight-metric">
      <span>Warp</span>
      <strong>${warpEnabled ? "on · 250x" : "off"}</strong>
    </div>
    <div class="flight-metric">
      <span>Closing</span>
      <strong>${navigation.closingSpeedKmS > 0 ? `${formatNumber(navigation.closingSpeedKmS)} km/s` : "not closing"}</strong>
    </div>
    <div class="flight-metric">
      <span>Scale</span>
      <strong>${shortScaleText(scaleKm, ephemeris?.au_km ?? AU_KM_FALLBACK)}</strong>
    </div>
  `;
}

function updateBodyInfo() {
  if (!ephemeris) return;
  const body = bodyByKey.get(selectedBodyKey) ?? bodyByKey.get(selectedTarget);
  if (!body) {
    bodyInfo.textContent = "";
    return;
  }

  bodyInfo.innerHTML = `
    <div class="body-info-title">
      <div class="body-title-main">
        ${bodyOrbHtml(body)}
        <div>
          <span class="eyebrow">Inspected body</span>
          <strong>${escapeHtml(body.name)}</strong>
        </div>
      </div>
    </div>
    <div class="body-grid">
      <span>From Sun</span><strong>${formatDistance(body.position.heliocentric_distance_km)}</strong>
      <span>From Earth</span><strong>${formatDistance(body.distance_from_earth_km)}</strong>
      <span>Ecliptic z</span><strong>${formatDistance(body.position.z_km)}</strong>
      <span>Mean radius</span><strong>${formatDistance(body.radius_km)}</strong>
    </div>
  `;
}

function shipTargetDistanceKm(target: Body) {
  if (!ephemeris || !ship) return 0;
  const dx = ship.xAu - target.position.x_au;
  const dy = ship.yAu - target.position.y_au;
  const dz = ship.zAu - target.position.z_au;
  return Math.hypot(dx, dy, dz) * ephemeris.au_km;
}

function shipSpeedKmPerSecond() {
  if (!ephemeris || !ship) return 0;
  return Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec) * ephemeris.au_km;
}

function navigationMetrics(target: Body, shipTargetKm: number) {
  if (!ephemeris || !ship) {
    return { closingSpeedKmS: 0, etaText: "unavailable", headingErrorDeg: 0 };
  }

  const dx = target.position.x_au - ship.xAu;
  const dy = target.position.y_au - ship.yAu;
  const dz = target.position.z_au - ship.zAu;
  const distanceAu = Math.hypot(dx, dy, dz);
  if (distanceAu === 0) {
    return { closingSpeedKmS: 0, etaText: "arrived", headingErrorDeg: 0 };
  }

  const closingSpeedAuS = (ship.vxAuPerSec * dx + ship.vyAuPerSec * dy) / distanceAu;
  const closingSpeedKmS = closingSpeedAuS * ephemeris.au_km;
  const etaText = closingSpeedKmS > 0.001 ? formatDuration(shipTargetKm / closingSpeedKmS) : "not closing";
  const targetBearing = Math.atan2(dy, dx);
  const headingErrorDeg = Math.abs(radToDeg(normalizeAngle(targetBearing - ship.angleRad)));

  return { closingSpeedKmS, etaText, headingErrorDeg };
}

function updateJourneyStats(shipTargetKm: number, target: Body, dt = 0, previousXAu?: number, previousYAu?: number) {
  if (journeyStats.targetKey !== selectedTarget) {
    resetJourneyStats();
  }

  if (ship && previousXAu !== undefined && previousYAu !== undefined && ephemeris) {
    const segmentKm = Math.hypot(ship.xAu - previousXAu, ship.yAu - previousYAu) * ephemeris.au_km;
    journeyStats.distanceTraveledKm += segmentKm;
    journeyStats.elapsedSeconds += dt;
    journeyStats.maxSpeedKmS = Math.max(journeyStats.maxSpeedKmS, shipSpeedKmPerSecond());
    journeyStats.lastShipXAu = ship.xAu;
    journeyStats.lastShipYAu = ship.yAu;
  }

  journeyStats.closestKm = Math.min(journeyStats.closestKm, shipTargetKm);
  if (shipTargetKm <= arrivalThresholdKm(target)) {
    journeyStats.arrived = true;
  }
}

function resetJourneyStats() {
  journeyStats = createJourneyStats(selectedTarget);
  const target = bodyByKey.get(selectedTarget);
  if (target && ship) {
    journeyStats.closestKm = shipTargetDistanceKm(target);
    journeyStats.arrived = journeyStats.closestKm <= arrivalThresholdKm(target);
    journeyStats.lastShipXAu = ship.xAu;
    journeyStats.lastShipYAu = ship.yAu;
  }
}

function createJourneyStats(targetKey: TargetKey): JourneyStats {
  return {
    targetKey,
    closestKm: Number.POSITIVE_INFINITY,
    arrived: false,
    elapsedSeconds: 0,
    distanceTraveledKm: 0,
    maxSpeedKmS: 0,
    lastShipXAu: null,
    lastShipYAu: null
  };
}

function arrivalThresholdKm(target: Body) {
  return Math.max(25_000, target.radius_km * 8);
}

function selectBodyAt(clientX: number, clientY: number) {
  const hit = bodyAtScreenPoint(clientX, clientY);
  if (!hit) return;
  selectedBodyKey = hit.key;
  syncBodySelect();
  renderBodyPicker();
  updateHud();
}

function bodyAtScreenPoint(clientX: number, clientY: number) {
  if (!ephemeris) return null;
  const hit = ephemeris.bodies
    .map((body) => {
      const screen = worldToScreen(body.position.x_au, body.position.y_au);
      const distancePx = Math.hypot(screen.x - clientX, screen.y - clientY);
      return { body, distancePx, hitRadius: Math.max(14, displayRadius(body) + 8) };
    })
    .filter((candidate) => candidate.distancePx <= candidate.hitRadius)
    .sort((a, b) => a.distancePx - b.distancePx)[0];
  return hit?.body ?? null;
}

function handleMapClick(clientX: number, clientY: number) {
  const body = bodyAtScreenPoint(clientX, clientY);
  if (interactionMode === "target") {
    if (body) {
      setTarget(body.key, { inspect: true });
      showBodyPopover(body, clientX, clientY);
    }
    return;
  }

  if (interactionMode === "measure") {
    addMeasurementPoint(body, clientX, clientY);
    if (body) {
      selectedBodyKey = body.key;
      syncBodySelect();
      showBodyPopover(body, clientX, clientY);
    } else {
      hideBodyPopover();
    }
    updateHud();
    return;
  }

  if (body) {
    selectedBodyKey = body.key;
    syncBodySelect();
    renderBodyPicker();
    showBodyPopover(body, clientX, clientY);
    updateHud();
  } else {
    hideBodyPopover();
  }
}

function showBodyPopover(body: Body, clientX: number, clientY: number) {
  activePopoverBodyKey = body.key;
  bodyPopover.hidden = false;
  bodyPopover.style.left = `${clamp(clientX + 14, 12, window.innerWidth - 260)}px`;
  bodyPopover.style.top = `${clamp(clientY + 14, 12, window.innerHeight - 210)}px`;
  bodyPopover.innerHTML = `
    <div class="popover-title">
      ${bodyOrbHtml(body)}
      <div>
        <strong>${escapeHtml(body.name)}</strong>
        <span>${escapeHtml(classifyBody(body).label)} · ${formatDistance(body.distance_from_earth_km)} from Earth</span>
      </div>
      <button type="button" class="icon-button" data-popover-action="close" aria-label="Close body actions">${icon("close")}</button>
    </div>
    <div class="popover-actions">
      <button type="button" data-popover-action="target">${icon("target")}<span>Target</span></button>
      <button type="button" data-popover-action="center">${icon("center")}<span>Center</span></button>
      <button type="button" data-popover-action="measure">${icon("ruler")}<span>Measure</span></button>
      <button type="button" data-popover-action="waypoint">${icon("waypoint")}<span>Waypoint</span></button>
    </div>
  `;
}

function hideBodyPopover() {
  activePopoverBodyKey = null;
  bodyPopover.hidden = true;
}

function handlePopoverAction(action: string, key: string) {
  const body = bodyByKey.get(key);
  if (!body) return;
  if (action === "close") {
    hideBodyPopover();
    return;
  }
  if (action === "target") {
    setTarget(key, { inspect: true });
  } else if (action === "center") {
    centerOnBody(key);
  } else if (action === "measure") {
    interactionMode = "measure";
    updateModeButtons();
    addMeasurementPoint(body);
  } else if (action === "waypoint") {
    addRouteWaypoint(body);
  }
  updateHud();
}

function addMeasurementPoint(body: Body | null, clientX?: number, clientY?: number) {
  let point: MeasurePoint;
  if (body) {
    point = {
      label: body.name,
      xAu: body.position.x_au,
      yAu: body.position.y_au,
      zAu: body.position.z_au,
      bodyKey: body.key
    };
  } else if (clientX !== undefined && clientY !== undefined) {
    const world = screenToWorld(clientX, clientY);
    point = { label: "Map point", xAu: world.xAu, yAu: world.yAu, zAu: 0 };
  } else {
    return;
  }

  measurePoints = [...measurePoints.filter((candidate) => candidate.bodyKey !== point.bodyKey || !point.bodyKey), point].slice(-2);
  updateMeasurePanel();
}

function updateMeasurePanel() {
  if (interactionMode !== "measure" && measurePoints.length === 0) {
    measurePanel.hidden = true;
    return;
  }

  measurePanel.hidden = false;
  const distanceKm = measurePoints.length === 2 ? measureDistanceKm() : null;
  measurePanel.innerHTML = `
    <div class="measure-title">
      ${icon("ruler")}
      <strong>Measure</strong>
      <button type="button" class="text-action" data-measure-action="clear">Clear</button>
    </div>
    <div class="measure-points">
      <span>${escapeHtml(measurePoints[0]?.label ?? "Choose first point")}</span>
      <span>${escapeHtml(measurePoints[1]?.label ?? "Choose second point")}</span>
    </div>
    <strong>${distanceKm === null ? "Click two bodies or map points" : formatDistance(distanceKm)}</strong>
    ${distanceKm === null ? "" : `<span>${formatDuration(distanceKm / LIGHT_SPEED_KM_S)} light time</span>`}
  `;
}

function measureDistanceKm() {
  if (!ephemeris || measurePoints.length < 2) return 0;
  const [a, b] = measurePoints;
  return Math.hypot(a.xAu - b.xAu, a.yAu - b.yAu, a.zAu - b.zAu) * ephemeris.au_km;
}

function addRouteWaypoint(body: Body) {
  if (body.key === "earth" || body.key === selectedTarget) return;
  routeWaypoints = [...routeWaypoints.filter((waypoint) => waypoint.key !== body.key), { key: body.key, name: body.name }].slice(-4);
  trajectoryPlan = null;
  selectedTrajectoryCandidateId = null;
  trajectoryError = "";
  void loadTrajectoryPlan();
}

function routeBodySequence(earth: Body, target: Body) {
  const sequence = [earth];
  for (const waypoint of routeWaypoints) {
    const body = bodyByKey.get(waypoint.key);
    if (body && body.key !== earth.key && body.key !== target.key) {
      sequence.push(body);
    }
  }
  sequence.push(target);
  return sequence;
}

function routeTrajectoryPoints(earth: Body, target: Body) {
  const sequence = routeBodySequence(earth, target);
  const points: RoutePoint[] = [];
  for (let index = 1; index < sequence.length; index += 1) {
    const segment = transferSegmentPoints(sequence[index - 1].position, sequence[index].position, TRANSFER_PATH_SAMPLES);
    if (points.length) {
      segment.shift();
    }
    points.push(...segment);
  }
  return points;
}

function activeTrajectoryCandidate() {
  if (!trajectoryPlan || trajectoryPlan.parameters.destination !== selectedTarget) return null;
  const plan = trajectoryPlan;
  return (
    plan.candidates.find((candidate) => candidate.id === selectedTrajectoryCandidateId) ??
    plan.candidates.find((candidate) => candidate.id === plan.selected_candidate_id) ??
    plan.candidates[0] ??
    null
  );
}

function activeRoutePoints(earth: Body, target: Body) {
  const candidate = activeTrajectoryCandidate();
  if (candidate?.samples.length) {
    return candidate.samples.map((point) => ({ xAu: point.x_au, yAu: point.y_au, zAu: point.z_au }));
  }
  return routeTrajectoryPoints(earth, target);
}

function transferSegmentPoints(start: BodyPosition, end: BodyPosition, sampleCount: number) {
  const startPoint = positionToRoutePoint(start);
  const endPoint = positionToRoutePoint(end);
  const chordAu = routePointDistanceAu(startPoint, endPoint);
  if (chordAu === 0) return [startPoint, endPoint];

  const startRadiusAu = Math.hypot(startPoint.xAu, startPoint.yAu);
  const endRadiusAu = Math.hypot(endPoint.xAu, endPoint.yAu);
  if (startRadiusAu < 0.02 || endRadiusAu < 0.02) {
    return linearSegmentPoints(startPoint, endPoint, sampleCount);
  }

  const startTangent = progradeTangent(startPoint);
  const endTangent = progradeTangent(endPoint);
  const controlAu = clamp(chordAu * 0.44 + Math.abs(endRadiusAu - startRadiusAu) * 0.08, 0.001, Math.max(chordAu, startRadiusAu, endRadiusAu) * 0.8);
  const controlA = {
    xAu: startPoint.xAu + startTangent.x * controlAu,
    yAu: startPoint.yAu + startTangent.y * controlAu,
    zAu: startPoint.zAu
  };
  const controlB = {
    xAu: endPoint.xAu - endTangent.x * controlAu,
    yAu: endPoint.yAu - endTangent.y * controlAu,
    zAu: endPoint.zAu
  };

  const points: RoutePoint[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    points.push(cubicRoutePoint(startPoint, controlA, controlB, endPoint, t));
  }
  return points;
}

function linearSegmentPoints(start: RoutePoint, end: RoutePoint, sampleCount: number) {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    points.push({
      xAu: start.xAu + (end.xAu - start.xAu) * t,
      yAu: start.yAu + (end.yAu - start.yAu) * t,
      zAu: start.zAu + (end.zAu - start.zAu) * t
    });
  }
  return points;
}

function positionToRoutePoint(position: BodyPosition): RoutePoint {
  return {
    xAu: position.x_au,
    yAu: position.y_au,
    zAu: position.z_au
  };
}

function progradeTangent(point: RoutePoint) {
  const radiusAu = Math.hypot(point.xAu, point.yAu);
  if (radiusAu === 0) return { x: 0, y: 1 };
  return { x: -point.yAu / radiusAu, y: point.xAu / radiusAu };
}

function cubicRoutePoint(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint, t: number) {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const t2 = t * t;
  return {
    xAu: inv2 * inv * a.xAu + 3 * inv2 * t * b.xAu + 3 * inv * t2 * c.xAu + t2 * t * d.xAu,
    yAu: inv2 * inv * a.yAu + 3 * inv2 * t * b.yAu + 3 * inv * t2 * c.yAu + t2 * t * d.yAu,
    zAu: a.zAu + (d.zAu - a.zAu) * t
  };
}

function routePointDistanceAu(a: RoutePoint, b: RoutePoint) {
  return Math.hypot(a.xAu - b.xAu, a.yAu - b.yAu, a.zAu - b.zAu);
}

function routeTotalDistanceKm(earth: Body, target: Body) {
  if (!ephemeris) return target.distance_from_earth_km;
  const activePlan = activeTrajectoryCandidate();
  if (activePlan) {
    return activePlan.metrics.path_distance_km;
  }
  const points = activeRoutePoints(earth, target);
  let totalKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalKm += routePointDistanceAu(points[index - 1], points[index]) * ephemeris.au_km;
  }
  return totalKm;
}

function journeyRouteProgress(earth: Body, target: Body, currentShip: Ship) {
  const points = activeRoutePoints(earth, target);
  if (points.length < 2) return 0;

  const shipPoint = { xAu: currentShip.xAu, yAu: currentShip.yAu, zAu: currentShip.zAu };
  let totalAu = 0;
  let walkedAu = 0;
  let nearestDistanceAu = Number.POSITIVE_INFINITY;
  let nearestAlongAu = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentAu = routePointDistanceAu(start, end);
    if (segmentAu === 0) continue;

    const projection = closestProgressOnSegment(start, end, shipPoint);
    if (projection.distanceAu < nearestDistanceAu) {
      nearestDistanceAu = projection.distanceAu;
      nearestAlongAu = walkedAu + segmentAu * projection.t;
    }
    walkedAu += segmentAu;
    totalAu += segmentAu;
  }

  if (totalAu === 0) return 0;
  return clamp(nearestAlongAu / totalAu, 0, 1);
}

function closestProgressOnSegment(start: RoutePoint, end: RoutePoint, point: RoutePoint) {
  const vx = end.xAu - start.xAu;
  const vy = end.yAu - start.yAu;
  const vz = end.zAu - start.zAu;
  const wx = point.xAu - start.xAu;
  const wy = point.yAu - start.yAu;
  const wz = point.zAu - start.zAu;
  const mag2 = vx * vx + vy * vy + vz * vz;
  const t = mag2 === 0 ? 0 : clamp((wx * vx + wy * vy + wz * vz) / mag2, 0, 1);
  return {
    t,
    distanceAu: Math.hypot(start.xAu + vx * t - point.xAu, start.yAu + vy * t - point.yAu, start.zAu + vz * t - point.zAu)
  };
}

function nextGuidanceText(navigation: ReturnType<typeof navigationMetrics>, distanceKm: number, thresholdKm: number) {
  if (distanceKm <= thresholdKm) return "Inside arrival zone";
  if (navigation.closingSpeedKmS <= 0) return "Point toward target, then thrust";
  if (navigation.headingErrorDeg > 25) return "Course correcting";
  if (warpEnabled) return "Warp flight";
  return "Distance remaining";
}

function distanceComparisonText(distanceKm: number) {
  const comparisons = educationalComparisons(distanceKm, { auKm: ephemeris?.au_km ?? AU_KM_FALLBACK });
  const light = comparisons.find((comparison) => comparison.key === "light_time");
  const moon = comparisons.find((comparison) => comparison.key === "earth_moon_distances");
  if (light && moon) {
    return `${moon.displayValue} Earth-Moon distances · ${light.displayValue} light time`;
  }
  return `${formatNumber(distanceKm / EARTH_MOON_AVG_KM)} Earth-Moon distances`;
}

function centerOnBody(key: string) {
  const body = bodyByKey.get(key);
  if (!body) return;
  camera.xAu = body.position.x_au;
  camera.yAu = body.position.y_au;
}

function ensureSelectedKeysExist() {
  const loadedKeys = Array.from(bodyByKey.keys());
  if (!bodyByKey.has(selectedTarget)) {
    selectedTarget = bodyByKey.has(selectedBodyKey) ? selectedBodyKey : bodyByKey.has("jupiter") ? "jupiter" : (loadedKeys[0] ?? "");
  }
  if (!bodyByKey.has(selectedBodyKey)) {
    selectedBodyKey = selectedTarget;
  }
}

function populateCatalogControls() {
  if (!ephemeris) return;
  const previous = bodySelect.value || selectedBodyKey;
  bodySelect.innerHTML = "";

  for (const body of ephemeris.bodies) {
    const option = document.createElement("option");
    option.value = body.key;
    option.textContent = body.name;
    bodySelect.appendChild(option);
  }

  selectedBodyKey = bodyByKey.has(previous) ? previous : selectedBodyKey;
  syncBodySelect();
  syncDestinationSearch();
  renderBodyPicker();
  renderRouteMemory();
  updateTargetButtons();
}

function syncBodySelect() {
  if (bodySelect.value !== selectedBodyKey) {
    bodySelect.value = selectedBodyKey;
  }
}

function initializeBodyFilterButtons() {
  bodyFilterButtons.innerHTML = BODY_FILTERS.map((filter) => {
    const label = filter === "all" ? "All" : labelForKey(filter.replace("_", " "));
    return `<button type="button" data-body-filter="${filter}">${escapeHtml(label)}</button>`;
  }).join("");
  bodyFilterButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    const filter = button?.dataset.bodyFilter as BodyFilter | undefined;
    if (!filter || !BODY_FILTERS.includes(filter)) return;
    activeBodyFilter = filter;
    renderBodyPicker();
  });
}

function initializeModeButtons() {
  for (const button of modeButtons.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    const mode = button.dataset.mode as InteractionMode | undefined;
    if (!mode || !modeCopy[mode]) continue;
    button.textContent = modeCopy[mode].label;
    button.title = modeCopy[mode].tooltip;
    button.setAttribute("aria-label", modeCopy[mode].tooltip);
  }
  updateModeButtons();
}

function renderBodyPicker() {
  if (!ephemeris) return;
  const includeTypes = activeBodyFilter === "all" ? undefined : [activeBodyFilter as DestinationBodyType];
  const sections = buildDestinationPickerSections(ephemeris.bodies, {
    query: destinationSearch.value,
    selectedKey: selectedBodyKey,
    currentTargetKey: selectedTarget,
    recentDestinations,
    includeTypes,
    maxResults: 10,
    maxFavorites: 4,
    maxFrequent: 4,
    maxRecent: 4,
    includeAllSection: true,
    auKm: ephemeris.au_km
  }).filter((section) => section.items.length > 0);

  for (const button of bodyFilterButtons.querySelectorAll<HTMLButtonElement>("[data-body-filter]")) {
    button.classList.toggle("active", button.dataset.bodyFilter === activeBodyFilter);
  }

  bodyPicker.innerHTML = sections
    .map((section) => {
      const items = section.items.slice(0, section.kind === "all" ? 8 : 4);
      return `
        <section class="destination-picker__section">
          <span class="destination-picker__section-title">${escapeHtml(section.label)}</span>
          <div class="destination-picker__list">
            ${items.map(renderDestinationPickerItem).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderDestinationPickerItem(item: DestinationPickerItem) {
  const badges = item.badges
    .slice(0, 2)
    .map((badge) => `<span class="destination-picker__badge">${escapeHtml(badge.label)}</span>`)
    .join("");
  return `
    <button
      type="button"
      class="destination-picker__item"
      data-picker-body="${escapeHtml(item.key)}"
      data-active="${item.isCurrentTarget}"
      aria-label="${escapeHtml(item.ariaLabel)}"
    >
      <span class="destination-picker__orb body-${escapeHtml(item.key)}" style="--destination-color: ${escapeHtml(item.color)}"></span>
      <span class="destination-picker__copy">
        <strong class="destination-picker__name">${escapeHtml(item.name)}</strong>
        <span class="destination-picker__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(item.radiusLabel)} radius</span>
      </span>
      <span class="destination-picker__distance">${escapeHtml(item.distanceLabel)}</span>
      ${badges ? `<span class="destination-picker__badges">${badges}</span>` : ""}
    </button>
  `;
}

function renderRouteMemory() {
  const recent = recentDestinations
    .map((entry) => bodyByKey.get(entry.key))
    .filter((body): body is Body => Boolean(body))
    .slice(0, 4);
  if (!recent.length) {
    routeMemory.innerHTML = "";
    return;
  }
  routeMemory.innerHTML = `
    <span>Recent destinations</span>
    <div>
      ${recent
        .map(
          (body) => `
            <button type="button" data-recent-destination="${escapeHtml(body.key)}">
              ${bodyOrbHtml(body)}
              <span>${escapeHtml(body.name)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function updateModeButtons() {
  for (const button of modeButtons.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === interactionMode);
  }
  canvas.classList.toggle("measure-mode", interactionMode === "measure");
  canvas.classList.toggle("target-mode", interactionMode === "target");
}

function decorateStaticControls() {
  setButtonContent(setDestination, "target", "Target");
  setButtonContent(jumpDestination, "locate", "Center", { compact: true });
  setButtonContent(targetSelected, "target", "Set as target", { compact: true });
  setButtonContent(centerSelected, "center", "Center map", { compact: true });
  setButtonContent(applyTime, "check", "Apply timestamp", { compact: true });
  setButtonContent(zoomOut, "minus", "Zoom out", { compact: true });
  setButtonContent(zoomIn, "plus", "Zoom in", { compact: true });
  setButtonContent(centerSun, "sun", "Center on Sun", { compact: true });
  setButtonContent(centerShip, "ship", "Center on ship", { compact: true });
  setButtonContent(resetShipButton, "reset", "Reset ship", { compact: true });
  setButtonContent(restartJourneyButton, "restart", "Restart journey", { compact: true });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-step-days]")) {
    const days = Number(button.dataset.stepDays ?? "0");
    const label = `${Math.abs(days)}d`;
    button.classList.add("time-step");
    button.classList.toggle("past", days < 0);
    button.classList.toggle("future", days > 0);
    button.innerHTML = `${icon(days < 0 ? "back" : "forward")}<span>${label}</span>`;
  }
}

function setButtonContent(button: HTMLButtonElement, iconName: string, label: string, options: { compact?: boolean } = {}) {
  const labelClass = options.compact ? "sr-only" : "button-label";
  button.innerHTML = `${icon(iconName)}<span class="${labelClass}">${escapeHtml(label)}</span>`;
}

function updateTargetButtons() {
  for (const button of targetButtons.querySelectorAll<HTMLButtonElement>("button")) {
    const key = button.dataset.target;
    if (!key) continue;
    const body = bodyByKey.get(key);
    button.classList.toggle("active", key === selectedTarget);
    button.disabled = !bodyByKey.has(key);
    button.setAttribute("aria-label", `Set target to ${body?.name ?? labelForKey(key)}`);
    button.innerHTML = quickTargetMarkup(key, body);
  }
}

function quickTargetMarkup(key: string, body?: Body) {
  const name = body?.name ?? labelForKey(key);
  const distance = body ? compactDistance(body.distance_from_earth_km) : "loading";
  return `
    ${bodyOrbHtml(body ?? key)}
    <span class="target-copy">
      <strong>${escapeHtml(name)}</strong>
      <small>${distance}</small>
    </span>
  `;
}

function setTarget(key: string, options: { inspect?: boolean; center?: boolean } = {}) {
  const body = bodyByKey.get(key);
  if (!body) return;

  selectedTarget = body.key;
  trajectoryPlan = null;
  selectedTrajectoryCandidateId = null;
  trajectoryError = "";
  recentDestinations = recordRecentDestination(body.key, { distanceFromEarthKm: body.distance_from_earth_km });
  if (options.inspect) {
    selectedBodyKey = body.key;
    syncBodySelect();
  }
  syncDestinationSearch();
  resetJourneyStats();
  renderBodyPicker();
  renderRouteMemory();
  updateTargetButtons();
  if (options.center) {
    centerOnBody(body.key);
  }
  updateHud();
  void loadTrajectoryPlan();
}

function bodyFromSearchValue(value: string) {
  return findDestinationBody(Array.from(bodyByKey.values()), value);
}

function flashSearchError() {
  destinationSearch.setCustomValidity("No loaded body matches this destination.");
  destinationSearch.reportValidity();
  window.setTimeout(() => destinationSearch.setCustomValidity(""), 1800);
}

function bodySearchLabel(body: Body) {
  return body.name;
}

function bodyOrbHtml(bodyOrKey: Body | string, size: "large" | "" = "") {
  const key = typeof bodyOrKey === "string" ? bodyOrKey : bodyOrKey.key;
  const color = typeof bodyOrKey === "string" ? fallbackBodyColor(key) : safeCssColor(bodyOrKey.color);
  const classKey = key.replace(/[^a-z0-9_-]/gi, "");
  const className = ["body-orb", `body-${classKey}`, size].filter(Boolean).join(" ");
  return `<span class="${className}" style="--body-color: ${color};" aria-hidden="true"></span>`;
}

function fallbackBodyColor(key: string) {
  const colors: Record<string, string> = {
    sun: "#ffd166",
    mercury: "#b8a48a",
    venus: "#d8b26f",
    earth: "#62a8ff",
    moon: "#c8c8c8",
    mars: "#df6b43",
    jupiter: "#d9b382",
    saturn: "#d8c28a",
    uranus: "#83d8d8",
    neptune: "#6f8cff"
  };
  return colors[key] ?? "#d9b86f";
}

function safeCssColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d9b86f";
}

function icon(name: string) {
  return ICONS[name] ?? "";
}

function compactDistance(km: number) {
  if (!Number.isFinite(km)) return "distance pending";
  const abs = Math.abs(km);
  if (abs >= AU_KM_FALLBACK * 0.1) return `${formatAu(km / AU_KM_FALLBACK)} AU`;
  if (abs >= 1_000_000) {
    const millions = km / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}M km`;
  }
  if (abs >= 100_000) return `${(km / 1_000).toFixed(0)}k km`;
  return `${formatNumber(km)} km`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function syncDestinationSearch() {
  const target = bodyByKey.get(selectedTarget);
  if (target) {
    destinationSearch.value = bodySearchLabel(target);
  }
}

function resizeCanvas() {
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

function zoomAt(clientX: number, clientY: number, factor: number) {
  const before = screenToWorld(clientX, clientY);
  camera.pxPerAu = clamp(camera.pxPerAu * factor, 4, 240_000);
  const after = screenToWorld(clientX, clientY);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  updateHud();
}

function applyZoomPreset(preset: ZoomPreset) {
  if (!ephemeris) return;
  const keysByPreset: Record<ZoomPreset, string[]> = {
    inner: ["mercury", "venus", "earth", "moon", "mars"],
    outer: ["jupiter", "saturn", "uranus", "neptune"],
    all: ephemeris.bodies.map((body) => body.key)
  };
  const bodies = keysByPreset[preset].map((key) => bodyByKey.get(key)).filter((body): body is Body => Boolean(body));
  if (!bodies.length) return;
  const maxAu = Math.max(...bodies.map((body) => Math.hypot(body.position.x_au, body.position.y_au)), 0.5);
  camera.xAu = 0;
  camera.yAu = 0;
  camera.pxPerAu = clamp(Math.min(window.innerWidth, window.innerHeight) / (maxAu * 2.4), 4, 240_000);
  updateHud();
}

function updateTimeSummary() {
  if (!ephemeris) return;
  timeSummary.textContent = formatTimestamp(ephemeris.timestamp_utc).slice(0, 16);
}

function renderOnboarding() {
  if (localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1") return;
  onboardingPanel.hidden = false;
  onboardingPanel.innerHTML = `
    <div class="onboarding-head">
      <span class="eyebrow">First flight</span>
      <button type="button" class="icon-button" data-dismiss-onboarding aria-label="Dismiss first flight guide">${icon("close")}</button>
    </div>
    <div class="onboarding-steps">
      ${firstRunSteps
        .map((step, index) => {
          const hints = "controlHint" in step ? step.controlHint : undefined;
          return `
            <article>
              <span>${index + 1}</span>
              <div>
                <strong>${escapeHtml(step.label)}</strong>
                <p>${escapeHtml(step.body)}</p>
                ${hints ? `<div class="mini-key-row">${hints.map((key) => `<kbd>${escapeHtml(key.label)}</kbd>`).join("")}</div>` : ""}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function worldToScreen(xAu: number, yAu: number) {
  return {
    x: window.innerWidth / 2 + (xAu - camera.xAu) * camera.pxPerAu,
    y: window.innerHeight / 2 - (yAu - camera.yAu) * camera.pxPerAu
  };
}

function screenToWorld(x: number, y: number) {
  return {
    xAu: camera.xAu + (x - window.innerWidth / 2) / camera.pxPerAu,
    yAu: camera.yAu - (y - window.innerHeight / 2) / camera.pxPerAu
  };
}

function displayRadius(body: Body) {
  if (body.key === "sun") return 15;
  if (body.key === "jupiter") return 10;
  if (body.key === "saturn") return 9;
  if (body.key === "uranus" || body.key === "neptune") return 7;
  if (body.key === "moon") return 3.5;
  return 5.5;
}

function pickGridAu() {
  const targetPx = 88;
  const rawAu = targetPx / camera.pxPerAu;
  const powers = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  return powers.find((value) => value >= rawAu) ?? 20;
}

function scaleText(kmPerPx: number, auKm: number) {
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `1 px = ${formatNumber(kmPerPx)} km / ${formatAu(auPerPx)} AU`;
  return `1 px = ${formatNumber(kmPerPx)} km`;
}

function shortScaleText(kmPerPx: number, auKm: number) {
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `${formatAu(auPerPx)} AU/px`;
  return `${formatNumber(kmPerPx)} km/px`;
}

function formatTimestamp(timestampUtc: string) {
  return timestampUtc.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace("Z", " UTC");
}

function formatDistance(km: number) {
  const abs = Math.abs(km);
  if (abs >= AU_KM_FALLBACK * 0.1) {
    return `${formatNumber(km)} km (${formatAu(km / AU_KM_FALLBACK)} AU)`;
  }
  return `${formatNumber(km)} km`;
}

function formatDuration(seconds: number) {
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(2)} h`;
  return `${(hours / 24).toFixed(2)} d`;
}

function formatDegrees(degrees: number) {
  return `${degrees.toFixed(1)}°`;
}

function formatDeltaV(value: number) {
  return `${formatNumber(value)} km/s Δv`;
}

function formatSignedSpeed(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)} km/s`;
}

function offsetLabel(days: number) {
  if (Math.abs(days) < 0.05) return "now";
  return days > 0 ? `+${formatNumber(days)} d` : `${formatNumber(days)} d`;
}

function formatAu(au: number) {
  const abs = Math.abs(au);
  if (abs >= 10) return au.toFixed(1);
  if (abs >= 1) return au.toFixed(2);
  if (abs >= 0.01) return au.toFixed(3);
  return au.toExponential(2);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function labelForKey(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(radians: number) {
  let angle = radians;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function radToDeg(radians: number) {
  return (radians * 180) / Math.PI;
}

function datetimeLocalToIso(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value.endsWith("Z") ? value.slice(0, -1) : value}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function setTimeInputFromTimestamp(timestampUtc: string) {
  const parsed = new Date(timestampUtc);
  if (Number.isNaN(parsed.getTime())) return;
  timeInput.value = parsed.toISOString().slice(0, 19);
}

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function requiredCanvasContext(targetCanvas: HTMLCanvasElement) {
  const context = targetCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return context;
}
