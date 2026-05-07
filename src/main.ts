import "./styles.css";
import "./destinationPicker.css";
import {
  buildDestinationPickerItems,
  buildDestinationPickerSections,
  classifyBody,
  findDestinationBody,
  normalizeDestinationQuery,
  readRecentDestinations,
  recordRecentDestination,
  type DestinationBodyType,
  type DestinationPickerItem
} from "./destinationPicker";
import { educationalComparisons } from "./navigationMetrics";
import { firstRunSteps, keyboardControls, modeCopy } from "./onboardingContent";

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_SPEED_KM_S = 299_792.458;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;
const EARTH_MOON_AVG_KM = 384_400;
const QUICK_TARGETS = ["moon", "mars", "jupiter", "saturn"];
const BODY_FILTERS = ["all", "planet", "moon", "dwarf_planet", "star", "galaxy", "nebula", "star_cluster"] as const;
const ONBOARDING_DISMISSED_KEY = "cosmic-atlas.onboarding-dismissed";
const TRANSFER_PATH_SAMPLES = 96;
const ORBIT_PATH_SAMPLES = 192;
const MIN_PX_PER_AU = 0.0000000001;
const MAX_PX_PER_AU = 24_000_000;
const VIEWPORT_REFERENCE_SIDES: ViewportReferenceSide[] = ["top", "right", "bottom", "left"];
const VIEWPORT_REFERENCE_CARD_WIDTH = 190;
const VIEWPORT_REFERENCE_CARD_HEIGHT = 56;
const VIEWPORT_REFERENCE_MARGIN = 14;
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
type DisplayLayer = "labels" | "orbits" | "route" | "trails";
type ZoomPreset = "inner" | "outer" | "local" | "group" | "deep" | "all";
type SizeMode = "readable" | "hybrid" | "true";
type ScaleBandKey = "planetary" | "solar" | "nearby_stars" | "milky_way" | "local_group" | "deep_sky";
type LoadingStepKey = "api" | "download" | "parse" | "render";

type GuidedTour = {
  id: string;
  label: string;
  description: string;
  keys: string[];
};

const BODY_FILTER_LABELS: Record<BodyFilter, string> = {
  all: "All",
  planet: "Planets",
  moon: "Moons",
  dwarf_planet: "Dwarf",
  star: "Stars",
  galaxy: "Galaxies",
  nebula: "Nebulae",
  star_cluster: "Clusters"
};

const BODY_FILTER_SECTION_LABELS: Record<BodyFilter, string> = {
  all: "All bodies",
  planet: "Planets",
  moon: "Moons",
  dwarf_planet: "Dwarf planets",
  star: "Stars",
  galaxy: "Galaxies",
  nebula: "Nebulae",
  star_cluster: "Star clusters"
};

const SCALE_LADDER_STOPS: { key: ScaleBandKey; label: string; maxViewportKm: number }[] = [
  { key: "planetary", label: "Planet", maxViewportKm: 1_000_000 },
  { key: "solar", label: "Solar System", maxViewportKm: AU_KM_FALLBACK * 80 },
  { key: "nearby_stars", label: "Nearby stars", maxViewportKm: LIGHT_YEAR_KM * 80 },
  { key: "milky_way", label: "Milky Way", maxViewportKm: LIGHT_YEAR_KM * 120_000 },
  { key: "local_group", label: "Local Group", maxViewportKm: LIGHT_YEAR_KM * 15_000_000 },
  { key: "deep_sky", label: "Deep sky", maxViewportKm: LIGHT_YEAR_KM * 120_000_000 }
];

const LOADING_STEPS: LoadingStepKey[] = ["api", "download", "parse", "render"];

const SIZE_MODE_COPY: Record<SizeMode, string> = {
  readable: "Size mode: readable. Body markers are deliberately exaggerated; numerical distances and radii remain real.",
  hybrid: "Size mode: hybrid. True radii render when they are large enough; markers remain for navigation.",
  true: "Size mode: true. Body disks use real radius-to-pixel scale; selection rings mark sub-pixel objects."
};

const COMPACT_SATELLITE_PARENT_KEYS: Record<string, string> = {
  phobos: "mars",
  deimos: "mars",
  io: "jupiter",
  europa: "jupiter",
  ganymede: "jupiter",
  callisto: "jupiter",
  mimas: "saturn",
  enceladus: "saturn",
  tethys: "saturn",
  dione: "saturn",
  rhea: "saturn",
  titan: "saturn",
  iapetus: "saturn"
};

const GUIDED_TOURS: GuidedTour[] = [
  {
    id: "messier-highlights",
    label: "Messier highlights",
    description: "Bright, famous deep-sky targets with known catalog distances.",
    keys: ["m31", "m42", "m45", "m13", "m1"]
  },
  {
    id: "galaxies",
    label: "Galaxies",
    description: "Nearby island universes in the Messier catalog.",
    keys: ["m31", "m33", "m51", "m81", "m104"]
  },
  {
    id: "nebulae",
    label: "Nebulae",
    description: "Star-forming regions, remnants, and glowing shells.",
    keys: ["m42", "m8", "m16", "m17", "m57"]
  },
  {
    id: "clusters",
    label: "Star clusters",
    description: "Young open clusters and ancient globular clusters.",
    keys: ["m45", "m13", "m22", "m5", "m11"]
  },
  {
    id: "nearby-stars",
    label: "Nearby stars",
    description: "Closest loaded exoplanet-host systems.",
    keys: ["proxima-cen", "barnards-star", "eps-eri", "ross-128", "tau-cet"]
  },
  {
    id: "local-group",
    label: "Local Group",
    description: "The Andromeda system and companions.",
    keys: ["m31", "m32", "m110"]
  }
];

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

type VectorComponents = {
  x: number;
  y: number;
  z: number;
};

type BodyStateVector = {
  frame: string;
  relative_to_key: string | null;
  relative_to_name: string | null;
  position_km: VectorComponents;
  velocity_km_s: VectorComponents;
  distance_km: number;
  speed_km_s: number;
  heliocentric_velocity_km_s: VectorComponents;
  heliocentric_speed_km_s: number;
};

type BodyOrbit = {
  epoch_utc: string;
  central_body_key: string;
  central_body_name: string;
  central_mu_km3_s2: number;
  source: string;
  semi_major_axis_km: number | null;
  eccentricity: number;
  inclination_deg: number | null;
  longitude_of_ascending_node_deg: number | null;
  argument_of_periapsis_deg: number | null;
  true_anomaly_deg: number | null;
  periapsis_km: number | null;
  apoapsis_km: number | null;
  orbital_period_days: number | null;
  mean_motion_deg_per_day: number | null;
  specific_orbital_energy_km2_s2: number;
  specific_angular_momentum_km2_s: number;
  orbit_class: string;
  notes: string[];
};

type StellarInfo = {
  ra_deg: number | null;
  dec_deg: number | null;
  distance_pc: number | null;
  distance_ly: number | null;
  exoplanet_count: number | null;
  stellar_radius_solar: number | null;
  stellar_teff_k: number | null;
};

type DeepSkyInfo = {
  messier: number | null;
  ngc: string | null;
  ic: string | null;
  aliases: string[];
  ra_deg: number | null;
  dec_deg: number | null;
  distance_ly: number | null;
  distance_quality: string | null;
  deep_sky_type: string | null;
  deep_sky_type_label: string | null;
  apparent_magnitude: number | null;
  angular_size_arcmin: string | null;
  constellation: string | null;
  viewing_season: string | null;
  common_name: string | null;
  observing_equipment: string | null;
  why_interesting: string | null;
};

type Body = {
  key: string;
  name: string;
  radius_km: number;
  color: string;
  object_type?: DestinationBodyType;
  parent_key?: string | null;
  catalog_group?: string;
  catalog?: CatalogObject;
  position: BodyPosition;
  state_vector?: BodyStateVector;
  orbit?: BodyOrbit | null;
  stellar?: StellarInfo | null;
  deep_sky?: DeepSkyInfo | null;
  distance_from_earth_km: number;
};

type CatalogObject = {
  key: string;
  name: string;
  object_type: DestinationBodyType;
  parent_key: string | null;
  catalog_group: string;
  catalog_group_label: string;
  ephemeris_id: string;
  ephemeris_kernel: string;
  ephemeris_source: string;
  position_model: string;
  dynamic_position: boolean;
  aliases?: string[];
  ra_deg?: number | null;
  dec_deg?: number | null;
  distance_pc?: number | null;
  distance_ly?: number | null;
  exoplanet_count?: number | null;
  stellar_radius_solar?: number | null;
  stellar_teff_k?: number | null;
  messier?: number | null;
  ngc?: string | null;
  ic?: string | null;
  deep_sky_type?: string | null;
  deep_sky_type_label?: string | null;
  apparent_magnitude?: number | null;
  angular_size_arcmin?: string | null;
  constellation?: string | null;
  viewing_season?: string | null;
  common_name?: string | null;
  observing_equipment?: string | null;
  why_interesting?: string | null;
};

type CatalogSummary = {
  schema_version: number;
  groups: string[];
  object_count: number;
  kernels: string[];
  objects: CatalogObject[];
};

type Ephemeris = {
  timestamp_utc: string;
  generated_at_utc: string;
  data_source: string;
  coordinate_frame: string;
  units: Record<string, string>;
  au_km: number;
  catalog?: CatalogSummary;
  earth_position: BodyPosition;
  bodies: Body[];
};

type Ship = {
  xAu: number;
  yAu: number;
  zAu: number;
  vxAuPerSec: number;
  vyAuPerSec: number;
  vzAuPerSec: number;
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
  lastShipZAu: number | null;
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

type ScreenPoint = {
  x: number;
  y: number;
};

type ViewportReferenceSide = "left" | "right" | "top" | "bottom";

type ViewportReference = {
  side: ViewportReferenceSide;
  body: Body;
  distanceKm: number;
  screen: ScreenPoint;
  anchor: ScreenPoint;
};

type LabelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LabelPlacement = {
  dx: number;
  dy: number;
  align?: "left" | "center" | "right";
};

type BodyLabelLayout = {
  body: Body;
  text: string;
  rect: LabelRect;
  font: string;
  color: string;
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
const guidedTours = requiredElement<HTMLElement>("#guided-tours");
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
const sizeModeButtons = requiredElement<HTMLElement>("#size-mode-buttons");
const displayToggles = requiredElement<HTMLElement>("#display-toggles");
const zoomPresets = requiredElement<HTMLElement>("#zoom-presets");
const bodyPopover = requiredElement<HTMLElement>("#body-popover");
const measurePanel = requiredElement<HTMLElement>("#measure-panel");
const onboardingPanel = requiredElement<HTMLElement>("#onboarding-panel");
const scaleLadder = requiredElement<HTMLElement>("#scale-ladder");
const scaleNote = requiredElement<HTMLElement>("#scale-note");
const loadingScreen = requiredElement<HTMLElement>("#loading-screen");
const loadingProgressFill = requiredElement<HTMLElement>("#loading-progress-fill");
const loadingProgressLabel = requiredElement<HTMLElement>("#loading-progress-label");
const loadingStepLabel = requiredElement<HTMLElement>("#loading-step-label");
const loadingDetail = requiredElement<HTMLElement>("#loading-detail");
const loadingElapsed = requiredElement<HTMLElement>("#loading-elapsed");
const loadingSteps = requiredElement<HTMLElement>("#loading-steps");
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
let sizeMode: SizeMode = "hybrid";
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
  orbits: true,
  route: true,
  trails: false
};
let warpEnabled = false;
let lastFrame = performance.now();
let lastHudRender = 0;
let journeyStructuralKey = "";
let isDragging = false;
let dragMoved = false;
let dragStart = { x: 0, y: 0, cameraXAu: 0, cameraYAu: 0 };
let loadingRunId = 0;
let loadingStartedAt = performance.now();
let loadingElapsedTimer: number | null = null;
let loadingPercent = 0;

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
initializeSizeModeButtons();
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
  zoomAt(event.clientX, event.clientY, zoomWheelFactor(event.deltaY));
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
guidedTours.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tour-target]");
  const key = button?.dataset.tourTarget;
  if (!key) return;
  setTarget(key, { inspect: true, center: true });
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
sizeModeButtons.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-size-mode]");
  const mode = button?.dataset.sizeMode as SizeMode | undefined;
  if (!mode || !(mode in SIZE_MODE_COPY)) return;
  sizeMode = mode;
  updateSizeModeButtons();
  updateHud(true);
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
for (const button of zoomPresets.querySelectorAll<HTMLButtonElement>("[data-zoom-preset]")) {
  button.addEventListener("click", () => {
    const preset = button.dataset.zoomPreset as ZoomPreset | undefined;
    if (!preset) return;
    applyZoomPreset(preset);
  });
}
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
  const loadingRun = beginLoading(timestampUtc ? "Recomputing atlas for selected UTC timestamp." : "Loading current UTC atlas.");
  try {
    updateLoadingProgress(loadingRun, "api", 12, "Connecting to local ephemeris API", "Opening the Python/Skyfield data service on this machine.");
    scheduleLoadingProgress(
      loadingRun,
      450,
      "download",
      28,
      "Waiting for ephemeris payload",
      "Skyfield, JPL kernels, Horizons vectors, and catalog rows can take a moment on first load."
    );
    const query = timestampUtc ? `?timestamp=${encodeURIComponent(timestampUtc)}` : "";
    const response = await fetch(`/api/ephemeris${query}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ephemeris API returned ${response.status}.\n${text}`);
    }

    updateLoadingProgress(loadingRun, "download", 48, "Ephemeris payload received", "Reading real heliocentric positions and catalog metadata.");
    scheduleLoadingProgress(loadingRun, 180, "parse", 64, "Parsing catalog objects", "Building the local body index, aliases, and search filters.");
    ephemeris = (await response.json()) as Ephemeris;
    updateLoadingProgress(loadingRun, "parse", 72, "Catalog parsed", `Loaded ${ephemeris.bodies.length} bodies into the atlas.`);
    bodyByKey = new Map(ephemeris.bodies.map((body) => [body.key, body]));
    ensureSelectedKeysExist();
    populateCatalogControls();
    setTimeInputFromTimestamp(ephemeris.timestamp_utc);
    updateTimeSummary();
    initializeShip();
    resetJourneyStats();
    updateLoadingProgress(loadingRun, "render", 88, "Preparing map view", "Positioning the ship, journey panel, labels, and scale ladder.");
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
    finishLoading(loadingRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadState.textContent = "error";
    failLoading(loadingRun, message);
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

function beginLoading(detail: string) {
  loadingRunId += 1;
  const runId = loadingRunId;
  loadingPercent = 0;
  loadingStartedAt = performance.now();
  loadState.textContent = "loading";
  loadingScreen.hidden = false;
  loadingScreen.classList.remove("error");
  loadingDetail.textContent = detail;
  updateLoadingElapsed(runId);
  if (loadingElapsedTimer !== null) {
    window.clearInterval(loadingElapsedTimer);
  }
  loadingElapsedTimer = window.setInterval(() => updateLoadingElapsed(runId), 100);
  updateLoadingProgress(runId, "api", 4, "Starting atlas boot", detail);
  return runId;
}

function scheduleLoadingProgress(
  runId: number,
  delayMs: number,
  step: LoadingStepKey,
  percent: number,
  label: string,
  detail: string
) {
  window.setTimeout(() => updateLoadingProgress(runId, step, percent, label, detail), delayMs);
}

function updateLoadingProgress(runId: number, step: LoadingStepKey, percent: number, label: string, detail: string) {
  if (runId !== loadingRunId || percent < loadingPercent) return;
  loadingPercent = clamp(percent, 0, 100);
  loadingProgressFill.style.width = `${loadingPercent}%`;
  loadingProgressLabel.textContent = `${Math.round(loadingPercent)}%`;
  loadingStepLabel.textContent = label;
  loadingDetail.textContent = detail;

  const activeIndex = LOADING_STEPS.indexOf(step);
  for (const item of loadingSteps.querySelectorAll<HTMLElement>("[data-loading-step]")) {
    const itemStep = item.dataset.loadingStep as LoadingStepKey | undefined;
    const itemIndex = itemStep ? LOADING_STEPS.indexOf(itemStep) : -1;
    item.classList.toggle("done", itemIndex >= 0 && itemIndex < activeIndex);
    item.classList.toggle("active", itemStep === step);
  }
}

function finishLoading(runId: number) {
  updateLoadingProgress(runId, "render", 100, "Atlas ready", "Live coordinates are rendered. The route planner can continue updating in the journey panel.");
  window.setTimeout(() => {
    if (runId !== loadingRunId) return;
    loadingScreen.hidden = true;
    stopLoadingElapsedTimer();
  }, 260);
}

function failLoading(runId: number, message: string) {
  if (runId !== loadingRunId) return;
  loadingScreen.classList.add("error");
  updateLoadingProgress(runId, "api", Math.max(loadingPercent, 100), "Load failed", "The local ephemeris API did not return usable data.");
  loadingDetail.textContent = message.split("\n")[0] || "Could not load live ephemeris data.";
  stopLoadingElapsedTimer();
}

function updateLoadingElapsed(runId: number) {
  if (runId !== loadingRunId) return;
  loadingElapsed.textContent = `${((performance.now() - loadingStartedAt) / 1000).toFixed(1)}s`;
}

function stopLoadingElapsedTimer() {
  if (loadingElapsedTimer === null) return;
  window.clearInterval(loadingElapsedTimer);
  loadingElapsedTimer = null;
}

async function loadTrajectoryPlan() {
  const targetBody = bodyByKey.get(selectedTarget);
  if (
    !ephemeris ||
    !targetBody ||
    !selectedTarget ||
    selectedTarget === "earth" ||
    selectedTarget === "sun" ||
    isStaticStellarCatalogBody(targetBody)
  ) {
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
      .filter((body) => body.key !== "sun" && body.catalog?.position_model !== "horizons_vectors" && !isStaticStellarCatalogBody(body))
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
    vzAuPerSec: 0,
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
  const previousZ = ship.zAu;
  const target = bodyByKey.get(selectedTarget);

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
    const depth = target ? targetDepthVector(target) : null;
    if (depth && depth.direction !== 0) {
      ship.vzAuPerSec += depth.direction * accelerationAu * thrust * depth.blend * dt;
    }
  }

  if (!warpEnabled) {
    ship.vxAuPerSec *= 0.9995;
    ship.vyAuPerSec *= 0.9995;
    ship.vzAuPerSec *= 0.9995;
  }

  const speed = Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec, ship.vzAuPerSec);
  if (speed > maxSpeedAu) {
    const ratio = maxSpeedAu / speed;
    ship.vxAuPerSec *= ratio;
    ship.vyAuPerSec *= ratio;
    ship.vzAuPerSec *= ratio;
  }

  ship.xAu += ship.vxAuPerSec * dt;
  ship.yAu += ship.vyAuPerSec * dt;
  ship.zAu += ship.vzAuPerSec * dt;

  if (target) {
    updateJourneyStats(shipTargetDistanceKm(target), target, dt, previousX, previousY, previousZ);
  }
  updateHud();
}

function targetDepthVector(target: Body) {
  if (!ship) return null;
  const dx = target.position.x_au - ship.xAu;
  const dy = target.position.y_au - ship.yAu;
  const dz = target.position.z_au - ship.zAu;
  const distanceAu = Math.hypot(dx, dy, dz);
  if (distanceAu <= 0) return null;
  return {
    direction: Math.abs(dz) < 1e-12 ? 0 : Math.sign(dz),
    blend: clamp(Math.abs(dz) / distanceAu, 0, 0.92)
  };
}

function draw() {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, width, height);
  drawStarfield(width, height);

  if (ephemeris) {
    if (displayLayers.orbits) {
      drawOrbitPaths();
    }
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
    drawBodyLabels();
  }

  drawMeasurement();
  drawShip();
  if (ephemeris) {
    drawViewportReferences(width, height);
  }
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

function drawOrbitPaths() {
  if (!ephemeris) return;
  const drawableBodies = ephemeris.bodies
    .filter((body) => body.orbit && body.orbit.semi_major_axis_km && body.orbit.eccentricity < 1)
    .sort((a, b) => orbitDrawPriority(a) - orbitDrawPriority(b));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const body of drawableBodies) {
    drawOrbitPath(body);
  }
  ctx.restore();
}

function orbitDrawPriority(body: Body) {
  if (body.key === selectedTarget) return 1000;
  if (body.key === selectedBodyKey) return 900;
  if (body.object_type === "moon") return 300 + body.radius_km / 1000;
  return 100 + body.radius_km / 1000;
}

function drawOrbitPath(body: Body) {
  if (!ephemeris || !body.orbit || body.orbit.semi_major_axis_km === null) return;
  if (body.orbit.eccentricity >= 1) return;

  const parent = bodyByKey.get(body.orbit.central_body_key);
  if (!parent) return;

  const points = orbitPathPoints(body, parent);
  if (points.length < 3) return;

  const screens = points.map((point) => worldToScreen(point.xAu, point.yAu));
  if (!orbitPathShouldDraw(screens, body)) return;

  const emphasized = body.key === selectedTarget || body.key === selectedBodyKey;
  const isMoon = body.object_type === "moon";
  const color = safeCssColor(body.color);

  if (emphasized) {
    ctx.setLineDash([]);
    ctx.strokeStyle = hexToRgba(color, 0.18);
    ctx.lineWidth = isMoon ? 6 : 5;
    drawScreenPath(screens);
  }

  ctx.setLineDash(isMoon ? [3, 6] : []);
  ctx.strokeStyle = hexToRgba(color, emphasized ? 0.86 : isMoon ? 0.38 : 0.46);
  ctx.lineWidth = emphasized ? 2.2 : isMoon ? 1.1 : 1.35;
  drawScreenPath(screens);

  if (emphasized) {
    const periapsis = orbitPointAtTrueAnomaly(body, parent, 0);
    if (periapsis) {
      const marker = worldToScreen(periapsis.xAu, periapsis.yAu);
      if (isScreenPointVisible(marker, 16)) {
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(color, 0.78);
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function orbitPathPoints(body: Body, parent: Body) {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= ORBIT_PATH_SAMPLES; index += 1) {
    const trueAnomalyRad = (index / ORBIT_PATH_SAMPLES) * Math.PI * 2;
    const point = orbitPointAtTrueAnomaly(body, parent, trueAnomalyRad);
    if (point) points.push(point);
  }
  return points;
}

function orbitPointAtTrueAnomaly(body: Body, parent: Body, trueAnomalyRad: number): RoutePoint | null {
  if (!ephemeris || !body.orbit || body.orbit.semi_major_axis_km === null) return null;
  const eccentricity = body.orbit.eccentricity;
  if (eccentricity >= 1) return null;

  const semiMajorAxisAu = body.orbit.semi_major_axis_km / ephemeris.au_km;
  const semiLatusRectumAu = semiMajorAxisAu * (1 - eccentricity * eccentricity);
  const radiusAu = semiLatusRectumAu / (1 + eccentricity * Math.cos(trueAnomalyRad));
  if (!Number.isFinite(radiusAu) || radiusAu <= 0) return null;

  const inclinationRad = degToRad(body.orbit.inclination_deg ?? 0);
  const longitudeNodeRad = degToRad(body.orbit.longitude_of_ascending_node_deg ?? 0);
  const argumentPeriapsisRad = degToRad(body.orbit.argument_of_periapsis_deg ?? 0);
  const argumentRad = argumentPeriapsisRad + trueAnomalyRad;

  const cosNode = Math.cos(longitudeNodeRad);
  const sinNode = Math.sin(longitudeNodeRad);
  const cosInclination = Math.cos(inclinationRad);
  const sinInclination = Math.sin(inclinationRad);
  const cosArgument = Math.cos(argumentRad);
  const sinArgument = Math.sin(argumentRad);

  const xAu = radiusAu * (cosNode * cosArgument - sinNode * sinArgument * cosInclination);
  const yAu = radiusAu * (sinNode * cosArgument + cosNode * sinArgument * cosInclination);
  const zAu = radiusAu * (sinArgument * sinInclination);

  return {
    xAu: parent.position.x_au + xAu,
    yAu: parent.position.y_au + yAu,
    zAu: parent.position.z_au + zAu
  };
}

function orbitPathShouldDraw(screens: ScreenPoint[], body: Body) {
  const emphasized = body.key === selectedTarget || body.key === selectedBodyKey;
  const xs = screens.map((point) => point.x);
  const ys = screens.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;
  const spanPx = Math.max(maxX - minX, maxY - minY);
  if (spanPx < (emphasized ? 4 : 7)) return false;
  if (maxX < -80 || minX > width + 80 || maxY < -80 || minY > height + 80) return false;
  return true;
}

function drawScreenPath(screens: ScreenPoint[]) {
  ctx.beginPath();
  screens.forEach((screen, index) => {
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
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
  const occupiedLabels = displayLayers.labels ? bodyLabelRects() : [];
  if (activePlan) {
    drawFutureBodyMotion(activePlan.events);
    for (const event of activePlan.events) {
      const screen = worldToScreen(event.x_au, event.y_au);
      ctx.fillStyle = event.kind === "flyby" ? "rgba(217, 184, 111, 0.96)" : "rgba(116, 196, 255, 0.92)";
      ctx.strokeStyle = "rgba(6, 6, 7, 0.86)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, event.kind === "flyby" ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawMapCallout(trajectoryEventLabel(event), screen, eventLabelPlacements(event.kind), occupiedLabels, {
        color: event.kind === "flyby" ? "rgba(255, 230, 169, 0.94)" : "rgba(201, 234, 255, 0.94)"
      });
    }
  } else {
    for (const body of routeBodies) {
      const screen = worldToScreen(body.position.x_au, body.position.y_au);
      ctx.strokeStyle = body.key === selectedTarget ? "rgba(217, 184, 111, 0.88)" : "rgba(116, 196, 255, 0.58)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(7, labelAnchorRadius(body) + 4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const labelPoint = routeLabelAnchor(routeScreens, activePlan?.events ?? []);
  if (labelPoint) {
    drawMapCallout(
      activePlan?.kind === "gravity_assist" ? "gravity-assist plan" : "transfer plan",
      labelPoint,
      routeLabelPlacements(),
      occupiedLabels,
      {
        color: activePlan?.kind === "gravity_assist" ? "rgba(255, 225, 153, 0.94)" : "rgba(187, 226, 255, 0.94)",
        background: "rgba(10, 14, 15, 0.88)",
        border: activePlan?.kind === "gravity_assist" ? "rgba(217, 184, 111, 0.5)" : "rgba(116, 196, 255, 0.44)"
      }
    );
  }
  ctx.restore();
}

function drawFutureBodyMotion(events: TrajectoryEvent[]) {
  ctx.save();
  for (const event of events) {
    if (Math.abs(event.offset_days) < 0.5) continue;
    const currentBody = bodyByKey.get(event.body_key);
    if (!currentBody) continue;

    const currentScreen = worldToScreen(currentBody.position.x_au, currentBody.position.y_au);
    const eventScreen = worldToScreen(event.x_au, event.y_au);
    if (!isScreenPointVisible(currentScreen, 140) && !isScreenPointVisible(eventScreen, 140)) continue;

    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = event.kind === "flyby" ? "rgba(217, 184, 111, 0.24)" : "rgba(116, 196, 255, 0.18)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(currentScreen.x, currentScreen.y);
    ctx.lineTo(eventScreen.x, eventScreen.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = event.kind === "flyby" ? "rgba(217, 184, 111, 0.46)" : "rgba(116, 196, 255, 0.34)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(eventScreen.x, eventScreen.y, event.kind === "flyby" ? 13 : 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function trajectoryEventLabel(event: TrajectoryEvent) {
  if (event.kind === "departure") return `${event.body_name} departure ${offsetLabel(event.offset_days)}`;
  if (event.kind === "flyby") return `${event.body_name} at flyby ${offsetLabel(event.offset_days)}`;
  return `${event.body_name} at arrival ${offsetLabel(event.offset_days)}`;
}

function eventLabelPlacements(kind: TrajectoryEvent["kind"]): LabelPlacement[] {
  if (kind === "flyby") {
    return [
      { dx: 16, dy: -42 },
      { dx: 16, dy: 20 },
      { dx: -18, dy: -42, align: "right" },
      { dx: -18, dy: 20, align: "right" },
      { dx: 0, dy: -58, align: "center" }
    ];
  }
  return [
    { dx: 14, dy: -34 },
    { dx: 14, dy: 18 },
    { dx: -16, dy: -34, align: "right" },
    { dx: -16, dy: 18, align: "right" },
    { dx: 0, dy: -52, align: "center" }
  ];
}

function routeLabelPlacements(): LabelPlacement[] {
  return [
    { dx: 18, dy: -34 },
    { dx: 18, dy: 18 },
    { dx: -18, dy: -34, align: "right" },
    { dx: -18, dy: 18, align: "right" },
    { dx: 0, dy: -52, align: "center" }
  ];
}

function routeLabelAnchor(routeScreens: ScreenPoint[], events: TrajectoryEvent[]) {
  const eventScreens = events.map((event) => worldToScreen(event.x_au, event.y_au));
  const candidates = [0.5, 0.62, 0.38, 0.74, 0.26, 0.86, 0.14]
    .map((fraction) => routeScreens[Math.max(0, Math.min(routeScreens.length - 1, Math.floor(routeScreens.length * fraction)))])
    .filter((point): point is ScreenPoint => Boolean(point));
  return (
    candidates.find((point) => {
      if (!isScreenPointVisible(point, 80)) return false;
      return eventScreens.every((eventPoint) => Math.hypot(point.x - eventPoint.x, point.y - eventPoint.y) > 96);
    }) ??
    candidates.find((point) => isScreenPointVisible(point, 80)) ??
    candidates[0] ??
    null
  );
}

function drawMapCallout(
  text: string,
  anchor: ScreenPoint,
  placements: LabelPlacement[],
  occupied: LabelRect[],
  options: { color?: string; background?: string; border?: string } = {}
) {
  ctx.save();
  ctx.font = "700 11px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";

  const paddingX = 7;
  const paddingY = 4;
  const width = Math.ceil(ctx.measureText(text).width + paddingX * 2);
  const height = 20 + paddingY;
  const viewportWidth = canvas.width / devicePixelRatio;
  const viewportHeight = canvas.height / devicePixelRatio;
  const placement = placements
    .map((candidate) => labelRectForPlacement(anchor, candidate, width, height, viewportWidth, viewportHeight))
    .find((rect) => occupied.every((existing) => !rectsOverlap(rect, existing, 12))) ??
    labelRectForPlacement(anchor, placements[0] ?? { dx: 12, dy: -28 }, width, height, viewportWidth, viewportHeight);

  if (Math.hypot(anchor.x - (placement.x + placement.width / 2), anchor.y - (placement.y + placement.height / 2)) > 24) {
    ctx.strokeStyle = options.border ?? "rgba(244, 241, 232, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(placement.x + placement.width / 2, placement.y + placement.height / 2);
    ctx.stroke();
  }

  ctx.fillStyle = options.background ?? "rgba(6, 8, 9, 0.88)";
  ctx.strokeStyle = options.border ?? "rgba(244, 241, 232, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(placement.x, placement.y, placement.width, placement.height, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = options.color ?? "rgba(244, 241, 232, 0.9)";
  ctx.fillText(text, placement.x + paddingX, placement.y + placement.height / 2);
  ctx.restore();

  occupied.push(placement);
}

function labelRectForPlacement(
  anchor: ScreenPoint,
  placement: LabelPlacement,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): LabelRect {
  let x = anchor.x + placement.dx;
  if (placement.align === "center") x -= width / 2;
  if (placement.align === "right") x -= width;
  return {
    x: clamp(x, 8, Math.max(8, viewportWidth - width - 8)),
    y: clamp(anchor.y + placement.dy, 8, Math.max(8, viewportHeight - height - 8)),
    width,
    height
  };
}

function bodyLabelRects() {
  return bodyLabelLayouts().map((layout) => layout.rect);
}

function bodyLabelLayouts(): BodyLabelLayout[] {
  if (!ephemeris) return [];
  const bodies = ephemeris.bodies;
  const occupied: LabelRect[] = [];
  const layouts: BodyLabelLayout[] = [];
  ctx.save();
  for (const body of [...bodies].sort((a, b) => bodyLabelPriority(b) - bodyLabelPriority(a))) {
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    if (!isScreenPointVisible(screen, 80)) continue;
    if (!shouldDrawBodyLabel(body, screen)) continue;

    const radius = labelAnchorRadius(body);
    const label = bodyDisplayLabel(body);
    const isEmphasized = body.key === selectedTarget || body.key === selectedBodyKey;
    const font = isEmphasized ? "700 13px ui-sans-serif, system-ui" : "12px ui-sans-serif, system-ui";
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(label).width + 10);
    const height = isEmphasized ? 19 : 18;
    const rect = bodyLabelPlacements(radius, body)
      .map((placement) => labelRectForPlacement(screen, placement, width, height, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio))
      .find((candidate) => occupied.every((existing) => !rectsOverlap(candidate, existing, 14)));
    if (!rect) continue;

    occupied.push(rect);
    layouts.push({
      body,
      text: label,
      rect,
      font,
      color: body.key === "sun" ? "#ffe8a3" : "#f3f0e8"
    });
  }
  ctx.restore();
  return layouts.sort((a, b) => bodies.indexOf(a.body) - bodies.indexOf(b.body));
}

function bodyLabelPriority(body: Body) {
  if (body.key === selectedTarget) return 1000;
  if (body.key === selectedBodyKey) return 900;
  if (body.key === "sun") return 800;
  if (body.radius_km > 1000) return 600 + Math.min(body.radius_km, 100_000) / 1000;
  return 100 + body.radius_km;
}

function shouldDrawBodyLabel(body: Body, screen: ScreenPoint) {
  if (body.key === selectedTarget || body.key === selectedBodyKey) return true;
  if (bodyHasFutureEvent(body) && hasNearbyLargerBody(body, screen, 96)) return false;

  const parentKey = body.parent_key ?? COMPACT_SATELLITE_PARENT_KEYS[body.key];
  if (!parentKey) return true;

  const parent = bodyByKey.get(parentKey);
  if (!parent) return true;

  const parentScreen = worldToScreen(parent.position.x_au, parent.position.y_au);
  if (Math.hypot(screen.x - parentScreen.x, screen.y - parentScreen.y) <= 34) return false;

  return true;
}

function hasNearbyLargerBody(body: Body, screen: ScreenPoint, minDistancePx: number) {
  for (const other of bodyByKey.values()) {
    if (other.key === body.key || other.radius_km < body.radius_km) continue;
    const otherScreen = worldToScreen(other.position.x_au, other.position.y_au);
    if (Math.hypot(screen.x - otherScreen.x, screen.y - otherScreen.y) < minDistancePx) {
      return true;
    }
  }
  return false;
}

function bodyLabelPlacements(radius: number, body?: Body): LabelPlacement[] {
  const placements: LabelPlacement[] = [
    { dx: radius + 12, dy: -10 },
    { dx: radius + 12, dy: 14 },
    { dx: -radius - 12, dy: -10, align: "right" },
    { dx: -radius - 12, dy: 14, align: "right" },
    { dx: 0, dy: -radius - 31, align: "center" },
    { dx: 0, dy: radius + 14, align: "center" }
  ];
  if (body && bodyHasFutureEvent(body)) {
    return [placements[4], placements[5], placements[2], placements[3], placements[0], placements[1]];
  }
  return placements;
}

function drawBodyLabels() {
  if (!displayLayers.labels) return;
  const layouts = bodyLabelLayouts();
  ctx.save();
  ctx.textBaseline = "middle";
  for (const layout of layouts) {
    ctx.font = layout.font;
    ctx.fillStyle = layout.color;
    ctx.fillText(layout.text, layout.rect.x + 5, layout.rect.y + layout.rect.height / 2);
  }
  ctx.restore();
}

function bodyDisplayLabel(body: Body) {
  return bodyHasFutureEvent(body) ? `${body.name} now` : body.name;
}

function bodyHasFutureEvent(body: Body) {
  const candidate = activeTrajectoryCandidate();
  return Boolean(candidate?.events.some((event) => event.body_key === body.key && Math.abs(event.offset_days) >= 0.5));
}

function rectsOverlap(a: LabelRect, b: LabelRect, padding = 0) {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

function isScreenPointVisible(point: ScreenPoint, margin = 0) {
  const width = canvas.width / devicePixelRatio;
  const height = canvas.height / devicePixelRatio;
  return point.x >= -margin && point.x <= width + margin && point.y >= -margin && point.y <= height + margin;
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

function drawViewportReferences(width: number, height: number) {
  const references = viewportReferences(width, height);
  if (!references.length) return;

  const obstructions = canvasOverlayRects(width, height);
  ctx.save();
  for (const reference of references) {
    const rect = viewportReferenceRect(reference, width, height, obstructions);
    drawViewportReferenceLead(reference, rect);
    drawViewportReferenceCard(reference, rect);
  }
  ctx.restore();
}

function viewportReferences(width: number, height: number) {
  if (!ephemeris) return [];

  const closestBySide = new Map<ViewportReferenceSide, ViewportReference>();
  const center = { x: width / 2, y: height / 2 };

  for (const body of ephemeris.bodies) {
    if (!Number.isFinite(body.position.x_au) || !Number.isFinite(body.position.y_au)) continue;
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    if (isPointInViewport(screen, width, height, 40)) continue;

    const dx = screen.x - center.x;
    const dy = screen.y - center.y;
    if (Math.hypot(dx, dy) < 1) continue;

    const side = viewportReferenceSide(dx, dy, width, height);
    const distanceKm = bodyDistanceFromCameraCenterKm(body);
    const existing = closestBySide.get(side);
    if (existing && existing.distanceKm <= distanceKm) continue;

    closestBySide.set(side, {
      side,
      body,
      distanceKm,
      screen,
      anchor: viewportEdgeIntersection(side, dx, dy, width, height)
    });
  }

  return VIEWPORT_REFERENCE_SIDES.map((side) => closestBySide.get(side)).filter((reference): reference is ViewportReference =>
    Boolean(reference)
  );
}

function viewportReferenceSide(dx: number, dy: number, width: number, height: number): ViewportReferenceSide {
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs((width / 2) / dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs((height / 2) / dy);
  if (tx < ty) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

function viewportEdgeIntersection(side: ViewportReferenceSide, dx: number, dy: number, width: number, height: number): ScreenPoint {
  const center = { x: width / 2, y: height / 2 };
  if (side === "left" || side === "right") {
    const x = side === "left" ? 0 : width;
    const t = dx === 0 ? 0 : (x - center.x) / dx;
    return { x, y: clamp(center.y + dy * t, 0, height) };
  }

  const y = side === "top" ? 0 : height;
  const t = dy === 0 ? 0 : (y - center.y) / dy;
  return { x: clamp(center.x + dx * t, 0, width), y };
}

function isPointInViewport(point: ScreenPoint, width: number, height: number, margin = 0) {
  return point.x >= -margin && point.x <= width + margin && point.y >= -margin && point.y <= height + margin;
}

function bodyDistanceFromCameraCenterKm(body: Body) {
  const auKm = ephemeris?.au_km ?? AU_KM_FALLBACK;
  return Math.hypot(body.position.x_au - camera.xAu, body.position.y_au - camera.yAu, body.position.z_au) * auKm;
}

function viewportReferenceRect(reference: ViewportReference, width: number, height: number, obstructions: LabelRect[]): LabelRect {
  const cardWidth = Math.min(VIEWPORT_REFERENCE_CARD_WIDTH, Math.max(144, width - VIEWPORT_REFERENCE_MARGIN * 2));
  const cardHeight = VIEWPORT_REFERENCE_CARD_HEIGHT;
  let rect: LabelRect;

  if (reference.side === "left") {
    rect = {
      x: VIEWPORT_REFERENCE_MARGIN,
      y: reference.anchor.y - cardHeight / 2,
      width: cardWidth,
      height: cardHeight
    };
  } else if (reference.side === "right") {
    rect = {
      x: width - cardWidth - VIEWPORT_REFERENCE_MARGIN,
      y: reference.anchor.y - cardHeight / 2,
      width: cardWidth,
      height: cardHeight
    };
  } else if (reference.side === "top") {
    rect = {
      x: reference.anchor.x - cardWidth / 2,
      y: VIEWPORT_REFERENCE_MARGIN,
      width: cardWidth,
      height: cardHeight
    };
  } else {
    rect = {
      x: reference.anchor.x - cardWidth / 2,
      y: height - cardHeight - VIEWPORT_REFERENCE_MARGIN,
      width: cardWidth,
      height: cardHeight
    };
  }

  return avoidReferenceObstructions(clampReferenceRect(rect, width, height), reference.side, obstructions, width, height);
}

function avoidReferenceObstructions(
  rect: LabelRect,
  side: ViewportReferenceSide,
  obstructions: LabelRect[],
  width: number,
  height: number
) {
  let next = rect;
  for (let index = 0; index < obstructions.length * 2; index += 1) {
    const obstruction = obstructions.find((candidate) => rectsOverlap(next, candidate, 8));
    if (!obstruction) break;

    if (side === "left") {
      const belowY = obstruction.y + obstruction.height + 10;
      const aboveY = obstruction.y - next.height - 10;
      next =
        obstruction.x <= next.x
          ? { ...next, x: obstruction.x + obstruction.width + 10 }
          : belowY <= height - next.height - VIEWPORT_REFERENCE_MARGIN
            ? { ...next, y: belowY }
            : { ...next, y: aboveY };
    } else if (side === "right") {
      const belowY = obstruction.y + obstruction.height + 10;
      const aboveY = obstruction.y - next.height - 10;
      next =
        obstruction.x + obstruction.width >= next.x + next.width
          ? { ...next, x: obstruction.x - next.width - 10 }
          : belowY <= height - next.height - VIEWPORT_REFERENCE_MARGIN
            ? { ...next, y: belowY }
            : { ...next, y: aboveY };
    } else if (side === "top") {
      const leftX = obstruction.x - next.width - 10;
      const rightX = obstruction.x + obstruction.width + 10;
      next =
        obstruction.x + obstruction.width / 2 > width / 2 && leftX >= VIEWPORT_REFERENCE_MARGIN
          ? { ...next, x: leftX }
          : rightX <= width - next.width - VIEWPORT_REFERENCE_MARGIN
            ? { ...next, x: rightX }
            : { ...next, y: obstruction.y + obstruction.height + 10 };
    } else {
      const leftX = obstruction.x - next.width - 10;
      const rightX = obstruction.x + obstruction.width + 10;
      const aboveY = obstruction.y - next.height - 10;
      next =
        aboveY >= VIEWPORT_REFERENCE_MARGIN
          ? { ...next, y: aboveY }
          : obstruction.x + obstruction.width / 2 > width / 2 && leftX >= VIEWPORT_REFERENCE_MARGIN
          ? { ...next, x: leftX }
          : rightX <= width - next.width - VIEWPORT_REFERENCE_MARGIN
            ? { ...next, x: rightX }
            : { ...next, y: aboveY };
    }
    next = clampReferenceRect(next, width, height);
  }
  return next;
}

function clampReferenceRect(rect: LabelRect, width: number, height: number): LabelRect {
  return {
    ...rect,
    x: clamp(rect.x, VIEWPORT_REFERENCE_MARGIN, Math.max(VIEWPORT_REFERENCE_MARGIN, width - rect.width - VIEWPORT_REFERENCE_MARGIN)),
    y: clamp(rect.y, VIEWPORT_REFERENCE_MARGIN, Math.max(VIEWPORT_REFERENCE_MARGIN, height - rect.height - VIEWPORT_REFERENCE_MARGIN))
  };
}

function canvasOverlayRects(width: number, height: number): LabelRect[] {
  const canvasRect = canvas.getBoundingClientRect();
  const selectors = [".hud", ".map-tools", ".onboarding-panel", ".mission-panel", ".journey-panel", ".flight-deck", ".measure-panel", ".body-popover"];
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
    })
    .map((element) => element.getBoundingClientRect())
    .map((rect) => ({
      x: rect.left - canvasRect.left,
      y: rect.top - canvasRect.top,
      width: rect.width,
      height: rect.height
    }))
    .filter((rect) => rect.x < width && rect.y < height && rect.x + rect.width > 0 && rect.y + rect.height > 0);
}

function drawViewportReferenceLead(reference: ViewportReference, rect: LabelRect) {
  const attach = viewportReferenceAttachPoint(reference.side, rect);
  ctx.save();
  ctx.strokeStyle = "rgba(217, 184, 111, 0.34)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(attach.x, attach.y);
  ctx.lineTo(reference.anchor.x, reference.anchor.y);
  ctx.stroke();
  ctx.restore();
}

function viewportReferenceAttachPoint(side: ViewportReferenceSide, rect: LabelRect): ScreenPoint {
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function drawViewportReferenceCard(reference: ViewportReference, rect: LabelRect) {
  const iconSize = 34;
  const iconX = rect.x + 13 + iconSize / 2;
  const iconY = rect.y + rect.height / 2;
  const textX = rect.x + 58;
  const textWidth = rect.width - 70;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "rgba(11, 15, 16, 0.88)";
  ctx.strokeStyle = "rgba(217, 184, 111, 0.34)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();

  drawReferenceBodyImage(reference.body, iconX, iconY, iconSize);

  ctx.textBaseline = "middle";
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#f5efe3";
  ctx.fillText(truncateCanvasText(reference.body.name, textWidth), textX, rect.y + 20);
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(217, 184, 111, 0.94)";
  ctx.fillText(truncateCanvasText(compactDistance(reference.distanceKm), textWidth), textX, rect.y + 38);
  ctx.restore();
}

function drawReferenceBodyImage(body: Body, x: number, y: number, size: number) {
  const radius = size / 2;
  ctx.save();
  if (body.object_type === "galaxy") {
    const glow = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius * 1.1);
    glow.addColorStop(0, "rgba(255, 244, 212, 0.95)");
    glow.addColorStop(0.42, hexToRgba(body.color, 0.72));
    glow.addColorStop(1, "rgba(217, 184, 111, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.24, radius * 0.48, -0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(body.color, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.94, radius * 0.34, -0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff0bc";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (body.object_type === "nebula") {
    const glow = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius * 1.15);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.82)");
    glow.addColorStop(0.42, hexToRgba(body.color, 0.68));
    glow.addColorStop(1, "rgba(215, 155, 220, 0)");
    ctx.fillStyle = glow;
    for (const blob of [
      { dx: -0.18, dy: 0.02, rx: 0.82, ry: 0.52, rot: -0.4 },
      { dx: 0.26, dy: -0.1, rx: 0.54, ry: 0.36, rot: 0.45 }
    ]) {
      ctx.beginPath();
      ctx.ellipse(x + radius * blob.dx, y + radius * blob.dy, radius * blob.rx, radius * blob.ry, blob.rot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#fff4c7";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (body.object_type === "star_cluster" || body.object_type === "asterism" || body.object_type === "milky_way_patch") {
    ctx.strokeStyle = hexToRgba(body.color, 0.5);
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff3cf";
    const points = [
      [0, 0, 0.12],
      [-0.34, -0.2, 0.09],
      [0.32, -0.25, 0.08],
      [-0.12, 0.35, 0.07],
      [0.4, 0.24, 0.06],
      [-0.42, 0.26, 0.06]
    ];
    for (const [dx, dy, r] of points) {
      ctx.beginPath();
      ctx.arc(x + radius * dx, y + radius * dy, radius * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (body.object_type === "star") {
    const glow = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius * 1.35);
    glow.addColorStop(0, body.color);
    glow.addColorStop(0.54, `${body.color}88`);
    glow.addColorStop(1, "rgba(255, 209, 102, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.35, 0, Math.PI * 2);
    ctx.fill();
  }

  if (body.key === "saturn") {
    ctx.strokeStyle = "rgba(234, 214, 154, 0.72)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.25, radius * 0.42, -0.25, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = body.color;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (body.key === "earth") {
    ctx.fillStyle = "rgba(91, 181, 121, 0.82)";
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.18, y - radius * 0.14, radius * 0.22, radius * 0.34, -0.8, 0, Math.PI * 2);
    ctx.ellipse(x + radius * 0.2, y + radius * 0.18, radius * 0.26, radius * 0.18, 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (body.key === "jupiter" || body.key === "saturn") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 246, 214, 0.35)";
    ctx.lineWidth = 2;
    for (let offset = -radius * 0.32; offset <= radius * 0.36; offset += radius * 0.24) {
      ctx.beginPath();
      ctx.moveTo(x - radius, y + offset);
      ctx.lineTo(x + radius, y + offset + radius * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  } else if (body.object_type === "moon") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    for (const crater of [
      { dx: -0.22, dy: -0.12, r: 0.08 },
      { dx: 0.2, dy: 0.1, r: 0.11 },
      { dx: -0.02, dy: 0.28, r: 0.06 }
    ]) {
      ctx.beginPath();
      ctx.arc(x + radius * crater.dx, y + radius * crater.dy, radius * crater.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function truncateCanvasText(text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}...`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, Math.max(1, low))}...`;
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
  const miniMapBodies = ephemeris.bodies.filter((body) => !isStaticStellarCatalogBody(body));
  const bodies = miniMapBodies.length ? miniMapBodies : ephemeris.bodies;
  const maxAu = Math.max(1, ...bodies.map((body) => Math.hypot(body.position.x_au, body.position.y_au)));
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
  for (const body of bodies) {
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
  const radius = renderedBodyRadius(body);
  const markerRadius = readableDisplayRadius(body);
  const isTarget = body.key === selectedTarget;
  const isSelectedBody = body.key === selectedBodyKey;
  const emphasized = isTarget || isSelectedBody;

  ctx.save();
  if (isDeepSkyBody(body)) {
    drawReferenceBodyImage(body, screen.x, screen.y, Math.max(22, markerRadius * 3.6));
    ctx.strokeStyle = isTarget ? "#f3f0e8" : isSelectedBody ? "#74c4ff" : hexToRgba(body.color, 0.38);
    ctx.lineWidth = isTarget || isSelectedBody ? 2 : 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, markerRadius + (isTarget || isSelectedBody ? 6 : 3), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (sizeMode === "true" && radius < 0.35 && !emphasized) {
    ctx.restore();
    return;
  }

  const markerOnly = sizeMode === "hybrid" && radius < 1.2;
  const shouldDrawSymbolicMarker = sizeMode === "readable" || markerOnly;
  const visibleRadius = shouldDrawSymbolicMarker ? markerRadius : radius;

  if (body.key === "saturn" && (shouldDrawSymbolicMarker || visibleRadius >= 1.8)) {
    ctx.strokeStyle = "rgba(216, 194, 138, 0.74)";
    ctx.lineWidth = shouldDrawSymbolicMarker ? 2 : Math.max(0.6, Math.min(1.5, visibleRadius * 0.08));
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, visibleRadius * 1.65, visibleRadius * 0.55, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (sizeMode === "hybrid" && markerOnly) {
    ctx.strokeStyle = hexToRgba(body.color, 0.62);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, markerRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (visibleRadius >= 0.35) {
    ctx.fillStyle = body.color;
    ctx.strokeStyle = isTarget ? "#f3f0e8" : isSelectedBody ? "#74c4ff" : "rgba(0, 0, 0, 0.38)";
    ctx.lineWidth = isTarget || isSelectedBody ? 2 : Math.max(0.75, Math.min(1, visibleRadius * 0.16));
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, visibleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (sizeMode === "hybrid" && !markerOnly && radius >= 1.2 && radius < markerRadius) {
    ctx.strokeStyle = hexToRgba(body.color, 0.34);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, markerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelectedBody && !isTarget) {
    ctx.strokeStyle = "rgba(116, 196, 255, 0.72)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(labelAnchorRadius(body) + 5, 7), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isTarget) {
    ctx.strokeStyle = "rgba(244, 241, 232, 0.72)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(labelAnchorRadius(body) + 5, 7), 0, Math.PI * 2);
    ctx.stroke();
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
  appendDefinition("Catalog", `${ephemeris.catalog?.object_count ?? ephemeris.bodies.length} loaded objects`);
  appendDefinition("Data", ephemeris.data_source.replace("NASA/JPL ", "JPL "));
  appendDefinition("Frame", "heliocentric ecliptic x/y");

  updateFlightValues(shipSpeedKmS, scaleKm, navigation);
  updateScaleLadder(scaleKm);
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
  const isStaticCatalogTarget = isStaticStellarCatalogBody(target);
  const directRouteLabel = activePlan
    ? `${activePlan.label} path distance`
    : isStaticCatalogTarget
      ? "Straight-line catalog distance"
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
  const progressLabel = activePlan?.kind === "gravity_assist" ? "gravity-assist plan" : isStaticCatalogTarget ? "straight-line reference" : "transfer preview";
  const structuralKey = [
    ephemeris.timestamp_utc,
    target.key,
    selectedBodyKey,
    trajectoryLoading ? "loading" : "ready",
    trajectoryError,
    trajectoryPlan?.generated_at_utc ?? "no-plan",
    activePlan?.id ?? "no-active-plan",
    routeWaypoints.map((waypoint) => waypoint.key).join(",")
  ].join("|");

  if (journeyStructuralKey !== structuralKey) {
    journeyStructuralKey = structuralKey;
    journey.innerHTML = `
      <div class="journey-hero">
        <div>
          <span class="eyebrow">Journey</span>
          <h2>Earth to ${escapeHtml(target.name)}</h2>
        </div>
        <span class="status-token" data-journey-field="status"></span>
      </div>
      <div class="route-card">
        <div class="route-body origin">
          ${bodyOrbHtml(earth, "large")}
          <span>Origin</span>
          <strong>${escapeHtml(earth.name)}</strong>
        </div>
        <div class="route-vector" aria-label="Route progress from Earth to ${escapeHtml(target.name)}">
          <div class="route-track">
            <span class="route-progress-dot" data-journey-field="route-dot"></span>
          </div>
          <span data-journey-field="route-summary"></span>
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
        <span data-journey-field="next-action"></span>
        <strong data-journey-field="ship-target-distance"></strong>
      </div>
      <div class="progress-track" aria-label="Journey progress">
        <div class="progress-fill" data-journey-field="progress-fill"></div>
      </div>
      <div class="progress-caption">
        <span data-journey-field="progress-label"></span>
        <span data-journey-field="light-time-remaining"></span>
      </div>
      <div class="metric-tiles">
        <article>
          <span>ETA now</span>
          <strong data-journey-field="eta"></strong>
        </article>
        <article>
          <span>Heading error</span>
          <strong data-journey-field="heading-error"></strong>
        </article>
        <article>
          <span>Closest approach</span>
          <strong data-journey-field="closest-approach"></strong>
        </article>
        <article>
          <span>Arrival zone</span>
          <strong data-journey-field="arrival-zone"></strong>
        </article>
      </div>
      <div class="journey-grid detail-grid">
        <span>${escapeHtml(directRouteLabel)}</span><strong data-journey-field="route-distance"></strong>
        <span>Earth-target light time</span><strong data-journey-field="earth-target-light-time"></strong>
        <span>Light story</span><strong data-journey-field="light-story"></strong>
        <span>Comparison</span><strong data-journey-field="comparison"></strong>
        <span>Distance flown</span><strong data-journey-field="distance-flown"></strong>
        <span>Max speed</span><strong data-journey-field="max-speed"></strong>
        <span>Elapsed flight time</span><strong data-journey-field="elapsed-flight-time"></strong>
      </div>
    `;
  }

  updateJourneyField("status", statusLabel);
  updateJourneyField(
    "route-summary",
    `${activePlan?.kind === "gravity_assist" ? "gravity assist" : isStaticCatalogTarget ? "reference" : "transfer"} · ${formatDistance(routeDistanceKm)}`
  );
  updateJourneyField("next-action", nextAction);
  updateJourneyField("ship-target-distance", formatDistance(shipTargetKm));
  updateJourneyField("progress-label", `${progressPercent.toFixed(2)}% along ${progressLabel}`);
  updateJourneyField("light-time-remaining", `${formatDuration(remainingLightSeconds)} light time remaining`);
  updateJourneyField("eta", navigation.etaText);
  updateJourneyField("heading-error", formatDegrees(navigation.headingErrorDeg));
  updateJourneyField("closest-approach", Number.isFinite(journeyStats.closestKm) ? formatDistance(journeyStats.closestKm) : "not recorded");
  updateJourneyField("arrival-zone", formatDistance(thresholdKm));
  updateJourneyField("route-distance", formatDistance(routeDistanceKm));
  updateJourneyField("earth-target-light-time", formatDuration(targetLightSeconds));
  updateJourneyField("light-story", lightStoryText(target, shipTargetKm));
  updateJourneyField("comparison", comparisonText);
  updateJourneyField("distance-flown", formatDistance(journeyStats.distanceTraveledKm));
  updateJourneyField("max-speed", `${formatNumber(journeyStats.maxSpeedKmS)} km/s`);
  updateJourneyField("elapsed-flight-time", formatDuration(journeyStats.elapsedSeconds));
  const progressFill = journey.querySelector<HTMLElement>('[data-journey-field="progress-fill"]');
  if (progressFill) progressFill.style.width = `${progressPercent.toFixed(2)}%`;
  const progressDot = journey.querySelector<HTMLElement>('[data-journey-field="route-dot"]');
  if (progressDot) progressDot.style.left = `${routeProgress.toFixed(2)}%`;
}

function updateJourneyField(field: string, value: string) {
  const element = journey.querySelector<HTMLElement>(`[data-journey-field="${field}"]`);
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function routeNoteText(candidate: TrajectoryCandidate | null) {
  if (!candidate) {
    const target = bodyByKey.get(selectedTarget);
    if (target && isStaticStellarCatalogBody(target)) {
      return `${target.deep_sky ? "Deep-sky" : "Interstellar"} catalog target: straight-line reference distance only. No mission trajectory model is active yet.`;
    }
    return "Approximate Sun-centered trajectory preview. It uses real current positions, but it is not a full mission-grade gravity solve yet.";
  }
  if (candidate.kind === "gravity_assist") {
    const flyby = candidate.flyby;
    const status = flyby?.feasible ? "unpowered turn feasible" : "correction burn likely";
    return `${candidate.label}: event markers show future body positions; patched-conic single-flyby estimate; ${status}.`;
  }
  return "Direct patched-conic transfer estimate; arrival marker shows the target's future position.";
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
  const departure = offsetLabel(candidate.metrics.departure_offset_days);
  const arrival = offsetLabel(candidate.metrics.arrival_offset_days);
  return `
    <button type="button" class="trajectory-card${active ? " active" : ""}" data-trajectory-candidate="${escapeHtml(candidate.id)}">
      <span>${escapeHtml(flybyLabel)}</span>
      <strong>${escapeHtml(candidate.label)}</strong>
      <small>depart ${departure} · arrive ${arrival}</small>
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
      <span>Depth</span>
      <strong>${depthMetricText(navigation)}</strong>
    </div>
    <div class="flight-metric">
      <span>Scale</span>
      <strong>${shortScaleText(scaleKm, ephemeris?.au_km ?? AU_KM_FALLBACK)}</strong>
    </div>
  `;
}

function updateScaleLadder(kmPerPx: number) {
  const viewportKm = kmPerPx * Math.max(window.innerWidth, window.innerHeight);
  const activeBand = scaleBandForViewport(viewportKm);
  const markerPercent = scaleLadderMarkerPercent(viewportKm);
  scaleLadder.innerHTML = `
    <div class="scale-ladder-head">
      <span>Scale ladder</span>
      <strong>${escapeHtml(scaleBandTitle(activeBand))}</strong>
    </div>
    <div class="scale-ladder-track" style="--scale-marker: ${markerPercent.toFixed(2)}%" aria-hidden="true">
      <span class="scale-ladder-line"></span>
      <span class="scale-ladder-marker"></span>
      ${SCALE_LADDER_STOPS.map((band) => `<span class="scale-ladder-tick ${band.key === activeBand ? "active" : ""}"></span>`).join("")}
    </div>
    <div class="scale-ladder-labels">
      ${SCALE_LADDER_STOPS.map((band) => `<span class="${band.key === activeBand ? "active" : ""}">${escapeHtml(band.label)}</span>`).join("")}
    </div>
    <p>${escapeHtml(scaleBandDescription(activeBand, viewportKm))}</p>
  `;
}

function scaleBandForViewport(viewportKm: number): ScaleBandKey {
  for (const stop of SCALE_LADDER_STOPS) {
    if (viewportKm < stop.maxViewportKm) return stop.key;
  }
  return "deep_sky";
}

function scaleLadderMarkerPercent(viewportKm: number) {
  const minKm = SCALE_LADDER_STOPS[0].maxViewportKm / 10;
  const maxKm = SCALE_LADDER_STOPS[SCALE_LADDER_STOPS.length - 1].maxViewportKm;
  const value = clamp(viewportKm, minKm, maxKm);
  const minLog = Math.log10(minKm);
  const maxLog = Math.log10(maxKm);
  return ((Math.log10(value) - minLog) / (maxLog - minLog)) * 100;
}

function scaleBandTitle(band: ScaleBandKey) {
  const labels: Record<ScaleBandKey, string> = {
    planetary: "planetary close-up",
    solar: "Solar System scale",
    nearby_stars: "nearby-star scale",
    milky_way: "Milky Way scale",
    local_group: "Local Group scale",
    deep_sky: "deep-sky scale"
  };
  return labels[band];
}

function scaleBandDescription(band: ScaleBandKey, viewportKm: number) {
  const span = compactDistance(viewportKm);
  const descriptions: Record<ScaleBandKey, string> = {
    planetary: `${span} across this viewport: moon systems and planet close approaches are readable here.`,
    solar: `${span} across this viewport: planets, moons, and transfer paths fit in the same coordinate space.`,
    nearby_stars: `${span} across this viewport: the hidden depth axis matters as much as the top-down position.`,
    milky_way: `${span} across this viewport: catalog objects are static sky positions with distance estimates.`,
    local_group: `${span} across this viewport: light-time becomes historical lookback time.`,
    deep_sky: `${span} across this viewport: this is an atlas scale, not a mission-planning scale.`
  };
  return descriptions[band];
}

function depthMetricText(navigation: ReturnType<typeof navigationMetrics>) {
  if (navigation.depthOffsetKm < 1) return "on plane";
  const closing = navigation.depthClosingSpeedKmS > 0.001;
  return `${compactDistance(navigation.depthOffsetKm)}${closing ? " closing" : ""}`;
}

function updateBodyInfo() {
  if (!ephemeris) return;
  const body = bodyByKey.get(selectedBodyKey) ?? bodyByKey.get(selectedTarget);
  if (!body) {
    bodyInfo.textContent = "";
    return;
  }

  const classification = classifyBody(body);
  const parent = body.parent_key ? bodyByKey.get(body.parent_key) : null;
  const source = body.catalog?.ephemeris_kernel ?? body.catalog_group ?? "loaded catalog";
  const stellarRows = stellarInfoRows(body);
  const deepSkyRows = deepSkyInfoRows(body);
  const orbitRows = orbitInfoRows(body);
  const sizeComparison = sizeComparisonMarkup(body);

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
    ${sizeComparison}
    <div class="body-grid">
      <span>Type</span><strong>${escapeHtml(classification.label)}</strong>
      <span>Parent</span><strong>${escapeHtml(parent?.name ?? (body.parent_key ? labelForKey(body.parent_key) : "none"))}</strong>
      <span>From Sun</span><strong>${formatDistance(body.position.heliocentric_distance_km)}</strong>
      <span>From Earth</span><strong>${formatDistance(body.distance_from_earth_km)}</strong>
      <span>Ecliptic z</span><strong>${formatDistance(body.position.z_km)}</strong>
      <span>${body.deep_sky ? "Physical radius" : "Mean radius"}</span><strong>${body.deep_sky ? "not represented" : formatDistance(body.radius_km)}</strong>
      <span>Source</span><strong>${escapeHtml(source)}</strong>
      ${stellarRows}
      ${deepSkyRows}
      ${orbitRows}
    </div>
  `;
}

function stellarInfoRows(body: Body) {
  const stellar = body.stellar;
  if (!stellar) return "";
  const exoplanetText = stellar.exoplanet_count === null ? "confirmed host" : `${stellar.exoplanet_count} confirmed`;
  const coordinates =
    stellar.ra_deg === null || stellar.dec_deg === null
      ? "not listed"
      : `${stellar.ra_deg.toFixed(2)}° RA / ${stellar.dec_deg.toFixed(2)}° Dec`;
  return `
    <span>Catalog distance</span><strong>${formatLightYears(stellar.distance_ly)}</strong>
    <span>Exoplanets</span><strong>${escapeHtml(exoplanetText)}</strong>
    <span>Sky position</span><strong>${escapeHtml(coordinates)}</strong>
    <span>Stellar temp</span><strong>${stellar.stellar_teff_k ? `${formatNumber(stellar.stellar_teff_k)} K` : "not listed"}</strong>
  `;
}

function deepSkyInfoRows(body: Body) {
  const deepSky = body.deep_sky;
  if (!deepSky) return "";
  const aliases = [deepSky.ngc ? `NGC ${deepSky.ngc}` : "", deepSky.ic ? deepSky.ic.replace(/^IC/, "IC ") : "", deepSky.common_name ?? ""]
    .filter(Boolean)
    .join(" · ");
  const coordinates =
    deepSky.ra_deg === null || deepSky.dec_deg === null
      ? "not listed"
      : `${deepSky.ra_deg.toFixed(2)}° RA / ${deepSky.dec_deg.toFixed(2)}° Dec`;
  return `
    <span>Catalog ID</span><strong>${escapeHtml([deepSky.messier ? `M${deepSky.messier}` : "", aliases].filter(Boolean).join(" · "))}</strong>
    <span>Deep-sky type</span><strong>${escapeHtml(deepSky.deep_sky_type_label ?? "Deep-sky object")}</strong>
    <span>Catalog distance</span><strong>${formatLightYears(deepSky.distance_ly)}</strong>
    <span>Lookback time</span><strong>${formatLookbackTime(deepSky.distance_ly)}</strong>
    <span>Apparent mag</span><strong>${deepSky.apparent_magnitude === null ? "not listed" : formatMagnitude(deepSky.apparent_magnitude)}</strong>
    <span>Angular size</span><strong>${escapeHtml(deepSky.angular_size_arcmin ? `${deepSky.angular_size_arcmin} arcmin` : "not listed")}</strong>
    <span>Constellation</span><strong>${escapeHtml(deepSky.constellation || "not listed")}</strong>
    <span>Best season</span><strong>${escapeHtml(deepSky.viewing_season || "not listed")}</strong>
    <span>Observe with</span><strong>${escapeHtml(deepSky.observing_equipment || "not listed")}</strong>
    <span>Sky position</span><strong>${escapeHtml(coordinates)}</strong>
    <span>Why it matters</span><strong>${escapeHtml(deepSky.why_interesting || "catalog highlight")}</strong>
  `;
}

function sizeComparisonMarkup(body: Body) {
  if (body.deep_sky) {
    return `
      <section class="size-comparison">
        <div class="size-comparison-head">
          <span>Size reference</span>
          <strong>Angular, not physical</strong>
        </div>
        <p>Physical radius is not represented for this catalog object. Use angular size, distance, and lookback time instead.</p>
      </section>
    `;
  }

  const comparisonBodies = sizeComparisonBodies(body);
  if (!comparisonBodies.length) return "";
  const maxDiameterKm = Math.max(...comparisonBodies.map((item) => item.radius_km * 2), 1);

  return `
    <section class="size-comparison">
      <div class="size-comparison-head">
        <span>True relative diameter</span>
        <strong>${escapeHtml(body.name)}</strong>
      </div>
      <div class="size-comparison-bars">
        ${comparisonBodies
          .map((item) => {
            const diameterKm = item.radius_km * 2;
            const ratio = clamp(diameterKm / maxDiameterKm, 0, 1);
            return `
              <div class="size-comparison-row">
                <span>${bodyOrbHtml(item)}</span>
                <strong>${escapeHtml(item.name)}</strong>
                <i style="--diameter-ratio: ${ratio.toFixed(6)}"></i>
                <em>${formatDistance(diameterKm)}</em>
              </div>
            `;
          })
          .join("")}
      </div>
      <p>Bars use real diameter ratios. Tiny bodies may become hairlines at this scale.</p>
    </section>
  `;
}

function sizeComparisonBodies(body: Body) {
  const keys = [
    body.key,
    body.parent_key ?? "",
    selectedTarget,
    "sun",
    "jupiter",
    "saturn",
    "earth",
    "moon"
  ];
  const seen = new Set<string>();
  return keys
    .map((key) => bodyByKey.get(key))
    .filter((item): item is Body => Boolean(item && item.radius_km > 0 && !isStaticStellarCatalogBody(item)))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => b.radius_km - a.radius_km)
    .slice(0, 6);
}

function orbitInfoRows(body: Body) {
  const orbit = body.orbit;
  const state = body.state_vector;
  if (!orbit || !state) {
    if (!state) return "";
    return `
      <span>State frame</span><strong>${escapeHtml(state.frame)}</strong>
      <span>Speed</span><strong>${formatSpeed(state.heliocentric_speed_km_s)}</strong>
    `;
  }

  return `
    <span>Orbit around</span><strong>${escapeHtml(orbit.central_body_name)}</strong>
    <span>Orbit class</span><strong>${escapeHtml(labelForOrbitClass(orbit.orbit_class))}</strong>
    <span>Parent distance</span><strong>${formatDistance(state.distance_km)}</strong>
    <span>Orbital speed</span><strong>${formatSpeed(state.speed_km_s)}</strong>
    <span>Semi-major axis</span><strong>${formatNullableDistance(orbit.semi_major_axis_km)}</strong>
    <span>Period</span><strong>${formatOrbitPeriod(orbit.orbital_period_days)}</strong>
    <span>Eccentricity</span><strong>${formatRatio(orbit.eccentricity)}</strong>
    <span>Inclination</span><strong>${formatNullableDegrees(orbit.inclination_deg)}</strong>
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
  return Math.hypot(ship.vxAuPerSec, ship.vyAuPerSec, ship.vzAuPerSec) * ephemeris.au_km;
}

function navigationMetrics(target: Body, shipTargetKm: number) {
  if (!ephemeris || !ship) {
    return { closingSpeedKmS: 0, etaText: "unavailable", headingErrorDeg: 0, depthOffsetKm: 0, depthClosingSpeedKmS: 0 };
  }

  const dx = target.position.x_au - ship.xAu;
  const dy = target.position.y_au - ship.yAu;
  const dz = target.position.z_au - ship.zAu;
  const distanceAu = Math.hypot(dx, dy, dz);
  const depthOffsetKm = Math.abs(dz) * ephemeris.au_km;
  const depthClosingSpeedKmS = Math.abs(dz) < 1e-12 ? 0 : ship.vzAuPerSec * Math.sign(dz) * ephemeris.au_km;
  if (distanceAu === 0) {
    return { closingSpeedKmS: 0, etaText: "arrived", headingErrorDeg: 0, depthOffsetKm, depthClosingSpeedKmS };
  }

  const closingSpeedAuS = (ship.vxAuPerSec * dx + ship.vyAuPerSec * dy + ship.vzAuPerSec * dz) / distanceAu;
  const closingSpeedKmS = closingSpeedAuS * ephemeris.au_km;
  const etaText = closingSpeedKmS > 0.001 ? formatDuration(shipTargetKm / closingSpeedKmS) : "not closing";
  const targetBearing = Math.atan2(dy, dx);
  const headingErrorDeg = Math.abs(radToDeg(normalizeAngle(targetBearing - ship.angleRad)));

  return { closingSpeedKmS, etaText, headingErrorDeg, depthOffsetKm, depthClosingSpeedKmS };
}

function updateJourneyStats(shipTargetKm: number, target: Body, dt = 0, previousXAu?: number, previousYAu?: number, previousZAu?: number) {
  if (journeyStats.targetKey !== selectedTarget) {
    resetJourneyStats();
  }

  if (ship && previousXAu !== undefined && previousYAu !== undefined && previousZAu !== undefined && ephemeris) {
    const segmentKm = Math.hypot(ship.xAu - previousXAu, ship.yAu - previousYAu, ship.zAu - previousZAu) * ephemeris.au_km;
    journeyStats.distanceTraveledKm += segmentKm;
    journeyStats.elapsedSeconds += dt;
    journeyStats.maxSpeedKmS = Math.max(journeyStats.maxSpeedKmS, shipSpeedKmPerSecond());
    journeyStats.lastShipXAu = ship.xAu;
    journeyStats.lastShipYAu = ship.yAu;
    journeyStats.lastShipZAu = ship.zAu;
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
    journeyStats.lastShipZAu = ship.zAu;
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
    lastShipYAu: null,
    lastShipZAu: null
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
      return { body, distancePx, hitRadius: Math.max(14, labelAnchorRadius(body) + 8) };
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
    const start = sequence[index - 1];
    const end = sequence[index];
    const segment =
      isStaticStellarCatalogBody(start) || isStaticStellarCatalogBody(end)
        ? linearSegmentPoints(positionToRoutePoint(start.position), positionToRoutePoint(end.position), TRANSFER_PATH_SAMPLES)
        : transferSegmentPoints(start.position, end.position, TRANSFER_PATH_SAMPLES);
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

function lightStoryText(target: Body, shipTargetKm: number) {
  if (target.deep_sky?.distance_ly) {
    return `You see it as it was ${formatLookbackTime(target.deep_sky.distance_ly)} ago.`;
  }
  if (isStaticStellarCatalogBody(target)) {
    return `Target light takes ${formatLightYears(shipTargetKm / LIGHT_YEAR_KM)} to reach the ship.`;
  }
  return `Current ship-target light time is ${formatDuration(shipTargetKm / LIGHT_SPEED_KM_S)}.`;
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
  renderGuidedTours();
  updateTargetButtons();
}

function syncBodySelect() {
  if (bodySelect.value !== selectedBodyKey) {
    bodySelect.value = selectedBodyKey;
  }
}

function initializeBodyFilterButtons() {
  bodyFilterButtons.innerHTML = BODY_FILTERS.map((filter) => {
    const label = BODY_FILTER_LABELS[filter];
    return `<button type="button" data-body-filter="${filter}">${escapeHtml(label)}</button>`;
  }).join("");
  bodyFilterButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    const filter = button?.dataset.bodyFilter as BodyFilter | undefined;
    if (!filter || !BODY_FILTERS.includes(filter)) return;
    activeBodyFilter = filter;
    if (isSelectedDestinationSearchValue()) {
      destinationSearch.value = "";
    }
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

function initializeSizeModeButtons() {
  updateSizeModeButtons();
}

function renderBodyPicker() {
  if (!ephemeris) return;
  const includeTypes = activeBodyFilter === "all" ? undefined : [activeBodyFilter as DestinationBodyType];
  const query = destinationPickerQuery();
  const sections = buildDestinationPickerSections(ephemeris.bodies, {
    query,
    selectedKey: selectedBodyKey,
    currentTargetKey: selectedTarget,
    recentDestinations,
    includeTypes,
    maxResults: query ? 12 : undefined,
    maxFavorites: activeBodyFilter === "all" ? 4 : 0,
    maxFrequent: activeBodyFilter === "all" ? 4 : 0,
    maxRecent: activeBodyFilter === "all" ? 4 : 0,
    includeAllSection: true,
    auKm: ephemeris.au_km
  }).filter((section) => section.items.length > 0);

  for (const button of bodyFilterButtons.querySelectorAll<HTMLButtonElement>("[data-body-filter]")) {
    button.classList.toggle("active", button.dataset.bodyFilter === activeBodyFilter);
  }

  bodyPicker.innerHTML = sections
    .map((section) => {
      const allSectionLimit = activeBodyFilter === "all" ? 10 : 16;
      const items = section.items.slice(0, section.kind === "all" ? allSectionLimit : 4);
      const label = section.kind === "all" && activeBodyFilter !== "all" ? BODY_FILTER_SECTION_LABELS[activeBodyFilter] : section.label;
      return `
        <section class="destination-picker__section">
          <span class="destination-picker__section-title">${escapeHtml(label)}</span>
          <div class="destination-picker__list">
            ${items.map(renderDestinationPickerItem).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function destinationPickerQuery() {
  return isSelectedDestinationSearchValue() ? "" : destinationSearch.value;
}

function isSelectedDestinationSearchValue(value = destinationSearch.value) {
  const target = bodyByKey.get(selectedTarget);
  if (!target) return false;
  return normalizeDestinationQuery(value) === normalizeDestinationQuery(bodySearchLabel(target));
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
      <span class="destination-picker__orb body-${escapeHtml(item.key)} type-${escapeHtml(item.type)}" style="--destination-color: ${escapeHtml(item.color)}"></span>
      <span class="destination-picker__copy">
        <strong class="destination-picker__name">${escapeHtml(item.name)}</strong>
        <span class="destination-picker__meta">${escapeHtml(item.metaLabel)}</span>
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

function renderGuidedTours() {
  const availableTours = GUIDED_TOURS.map((tour) => ({
    ...tour,
    bodies: tour.keys.map((key) => bodyByKey.get(key)).filter((body): body is Body => Boolean(body))
  })).filter((tour) => tour.bodies.length > 0);

  guidedTours.innerHTML = availableTours
    .map(
      (tour) => `
        <article class="tour-card">
          <div>
            <strong>${escapeHtml(tour.label)}</strong>
            <span>${escapeHtml(tour.description)}</span>
          </div>
          <div class="tour-targets">
            ${tour.bodies
              .map(
                (body) => `
                  <button type="button" data-tour-target="${escapeHtml(body.key)}" title="${escapeHtml(body.name)}">
                    ${bodyOrbHtml(body)}
                    <span>${escapeHtml(tourTargetLabel(body))}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function tourTargetLabel(body: Body) {
  if (body.deep_sky?.common_name) return body.deep_sky.common_name;
  return body.name;
}

function updateModeButtons() {
  for (const button of modeButtons.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.classList.toggle("active", button.dataset.mode === interactionMode);
  }
  canvas.classList.toggle("measure-mode", interactionMode === "measure");
  canvas.classList.toggle("target-mode", interactionMode === "target");
}

function updateSizeModeButtons() {
  for (const button of sizeModeButtons.querySelectorAll<HTMLButtonElement>("[data-size-mode]")) {
    const mode = button.dataset.sizeMode as SizeMode | undefined;
    button.classList.toggle("active", mode === sizeMode);
    if (mode && mode in SIZE_MODE_COPY) {
      button.title = SIZE_MODE_COPY[mode];
    }
  }
  scaleNote.textContent = SIZE_MODE_COPY[sizeMode];
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
  const typeClass = typeof bodyOrKey === "string" ? "" : `type-${bodyOrKey.object_type ?? "unknown"}`;
  const classKey = key.replace(/[^a-z0-9_-]/gi, "");
  const className = ["body-orb", `body-${classKey}`, typeClass, size].filter(Boolean).join(" ");
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
    phobos: "#9b8066",
    deimos: "#b19a82",
    jupiter: "#d9b382",
    io: "#e5c45f",
    europa: "#d8c7a8",
    ganymede: "#a89980",
    callisto: "#7b6a58",
    saturn: "#d8c28a",
    mimas: "#b9b7ad",
    enceladus: "#dfe9ef",
    tethys: "#c9c7bd",
    dione: "#c6c7c2",
    rhea: "#b9b5aa",
    titan: "#d6a657",
    iapetus: "#8d8070",
    uranus: "#83d8d8",
    neptune: "#6f8cff",
    pluto: "#c9a27c"
  };
  return colors[key] ?? "#d9b86f";
}

function safeCssColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d9b86f";
}

function hexToRgba(color: string, alpha: number) {
  const safe = safeCssColor(color);
  const value = safe.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function icon(name: string) {
  return ICONS[name] ?? "";
}

function compactDistance(km: number) {
  if (!Number.isFinite(km)) return "distance pending";
  const abs = Math.abs(km);
  if (abs >= LIGHT_YEAR_KM * 0.1) return formatLightYears(km / LIGHT_YEAR_KM);
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
  camera.pxPerAu = clamp(camera.pxPerAu * factor, MIN_PX_PER_AU, MAX_PX_PER_AU);
  const after = screenToWorld(clientX, clientY);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  updateHud(true);
}

function zoomWheelFactor(deltaY: number) {
  const zoomingOut = deltaY > 0;
  const kmPerPx = (ephemeris?.au_km ?? AU_KM_FALLBACK) / camera.pxPerAu;
  const viewportKm = kmPerPx * Math.max(window.innerWidth, window.innerHeight);

  if (zoomingOut) {
    if (viewportKm >= LIGHT_YEAR_KM * 100_000) return 0.48;
    if (viewportKm >= LIGHT_YEAR_KM * 20) return 0.56;
    if (viewportKm >= AU_KM_FALLBACK * 80) return 0.68;
    return 0.86;
  }

  if (viewportKm >= LIGHT_YEAR_KM * 100_000) return 1.9;
  if (viewportKm >= LIGHT_YEAR_KM * 20) return 1.7;
  if (viewportKm >= AU_KM_FALLBACK * 80) return 1.45;
  return 1.16;
}

function applyZoomPreset(preset: ZoomPreset) {
  if (!ephemeris) return;
  if (preset === "local") {
    const body = bodyByKey.get(selectedBodyKey) ?? bodyByKey.get(selectedTarget);
    if (!body) return;
    const viewRadiusAu = localViewRadiusAu(body);
    camera.xAu = body.position.x_au;
    camera.yAu = body.position.y_au;
    camera.pxPerAu = clamp(
      Math.min(window.innerWidth, window.innerHeight) / (viewRadiusAu * 2.15),
      MIN_PX_PER_AU,
      MAX_PX_PER_AU
    );
    updateHud(true);
    return;
  }

  const keysByPreset: Record<ZoomPreset, string[]> = {
    inner: ["mercury", "venus", "earth", "moon", "mars", "phobos", "deimos"],
    outer: ["jupiter", "saturn", "uranus", "neptune", "pluto"],
    local: [],
    group: ["sun", "proxima-cen", "m31", "m32", "m33", "m110"],
    deep: ephemeris.bodies.filter((body) => isDeepSkyBody(body)).map((body) => body.key),
    all: ephemeris.bodies.map((body) => body.key)
  };
  const bodies = keysByPreset[preset].map((key) => bodyByKey.get(key)).filter((body): body is Body => Boolean(body));
  if (!bodies.length) return;
  const maxAu = Math.max(...bodies.map((body) => Math.hypot(body.position.x_au, body.position.y_au)), 0.5);
  camera.xAu = 0;
  camera.yAu = 0;
  camera.pxPerAu = clamp(Math.min(window.innerWidth, window.innerHeight) / (maxAu * 2.4), MIN_PX_PER_AU, MAX_PX_PER_AU);
  updateHud(true);
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

function readableDisplayRadius(body: Body) {
  if (body.key === "sun") return 15;
  if (isStaticStellarCatalogBody(body)) return 5.5;
  if (body.key === "jupiter") return 10;
  if (body.key === "saturn") return 9;
  if (body.key === "uranus" || body.key === "neptune") return 7;
  if (body.key === "pluto") return 4.5;
  if (body.key === "moon") return 3.5;
  if (body.key === "phobos" || body.key === "deimos") return 3;
  if (body.object_type === "moon") return body.radius_km > 1000 ? 4.5 : 3.2;
  return 5.5;
}

function trueBodyRadiusPx(body: Body) {
  if (isStaticStellarCatalogBody(body) || body.radius_km <= 0) return 0;
  return (body.radius_km / (ephemeris?.au_km ?? AU_KM_FALLBACK)) * camera.pxPerAu;
}

function renderedBodyRadius(body: Body) {
  if (sizeMode === "readable" || isStaticStellarCatalogBody(body)) return readableDisplayRadius(body);
  if (sizeMode === "true") return trueBodyRadiusPx(body);
  return trueBodyRadiusPx(body);
}

function labelAnchorRadius(body: Body) {
  if (sizeMode === "true") return Math.max(readableDisplayRadius(body), trueBodyRadiusPx(body));
  return readableDisplayRadius(body);
}

function localViewRadiusAu(body: Body) {
  if (isStaticStellarCatalogBody(body)) return 25;

  const systemRadiusAu: Record<string, number> = {
    sun: 0.04,
    mercury: 0.00035,
    venus: 0.00035,
    earth: 0.0032,
    moon: 0.00035,
    mars: 0.00024,
    phobos: 0.00008,
    deimos: 0.00008,
    jupiter: 0.017,
    saturn: 0.035,
    uranus: 0.008,
    neptune: 0.006,
    pluto: 0.0012
  };
  const configuredRadius = systemRadiusAu[body.key];
  if (configuredRadius) return configuredRadius;

  const auKm = ephemeris?.au_km ?? AU_KM_FALLBACK;
  const bodyRadiusAu = body.radius_km / auKm;
  return clamp(bodyRadiusAu * 180, 0.00008, 0.04);
}

function isStaticStellarCatalogBody(body: Body) {
  return body.catalog?.position_model === "stellar_catalog_coordinates" || body.catalog?.position_model === "deep_sky_catalog_coordinates";
}

function isDeepSkyBody(body: Body) {
  return Boolean(body.deep_sky);
}

function pickGridAu() {
  const targetPx = 88;
  const rawAu = targetPx / camera.pxPerAu;
  if (!Number.isFinite(rawAu) || rawAu <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawAu));
  const multiplier = [1, 2, 5, 10].find((value) => value * magnitude >= rawAu) ?? 10;
  return multiplier * magnitude;
}

function scaleText(kmPerPx: number, auKm: number) {
  if (kmPerPx >= LIGHT_YEAR_KM * 0.001) return `1 px = ${formatLightYears(kmPerPx / LIGHT_YEAR_KM)}`;
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `1 px = ${formatNumber(kmPerPx)} km / ${formatAu(auPerPx)} AU`;
  if (kmPerPx < 1) return `1 px = ${formatNumber(kmPerPx * 1000)} m`;
  return `1 px = ${formatNumber(kmPerPx)} km`;
}

function shortScaleText(kmPerPx: number, auKm: number) {
  if (kmPerPx >= LIGHT_YEAR_KM * 0.001) return `${formatLightYears(kmPerPx / LIGHT_YEAR_KM)}/px`;
  const auPerPx = kmPerPx / auKm;
  if (auPerPx >= 0.001) return `${formatAu(auPerPx)} AU/px`;
  if (kmPerPx < 1) return `${formatNumber(kmPerPx * 1000)} m/px`;
  return `${formatNumber(kmPerPx)} km/px`;
}

function formatTimestamp(timestampUtc: string) {
  return timestampUtc.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace("Z", " UTC");
}

function degToRad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function formatDistance(km: number) {
  const abs = Math.abs(km);
  if (abs >= LIGHT_YEAR_KM * 0.1) {
    return formatLightYears(km / LIGHT_YEAR_KM);
  }
  if (abs >= AU_KM_FALLBACK * 0.1) {
    return `${formatNumber(km)} km (${formatAu(km / AU_KM_FALLBACK)} AU)`;
  }
  return `${formatNumber(km)} km`;
}

function formatLightYears(lightYears: number | null) {
  if (lightYears === null || !Number.isFinite(lightYears)) return "not listed";
  const abs = Math.abs(lightYears);
  if (abs >= 100) return `${formatNumber(lightYears)} ly`;
  if (abs >= 10) return `${lightYears.toFixed(1)} ly`;
  return `${lightYears.toFixed(2)} ly`;
}

function formatLookbackTime(lightYears: number | null) {
  if (lightYears === null || !Number.isFinite(lightYears)) return "not listed";
  if (lightYears >= 1_000_000) return `${formatNumber(lightYears / 1_000_000)} million years`;
  if (lightYears >= 1_000) return `${formatNumber(lightYears / 1_000)} thousand years`;
  return `${formatNumber(lightYears)} years`;
}

function formatMagnitude(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatNullableDistance(km: number | null) {
  return km === null || !Number.isFinite(km) ? "not defined" : formatDistance(km);
}

function formatSpeed(kmPerSecond: number) {
  return `${formatNumber(kmPerSecond)} km/s`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "unavailable";
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(2)} h`;
  const days = hours / 24;
  if (days >= 365.25 * 2) return `${formatNumber(days / 365.25)} yr`;
  return `${days.toFixed(2)} d`;
}

function formatOrbitPeriod(days: number | null) {
  if (days === null || !Number.isFinite(days)) return "not closed";
  if (days >= 365.25 * 2) return `${formatNumber(days / 365.25)} yr`;
  if (days >= 2) return `${formatNumber(days)} d`;
  return formatDuration(days * 86_400);
}

function formatDegrees(degrees: number) {
  return `${degrees.toFixed(1)}°`;
}

function formatNullableDegrees(degrees: number | null) {
  return degrees === null || !Number.isFinite(degrees) ? "not defined" : formatDegrees(degrees);
}

function formatRatio(value: number) {
  if (!Number.isFinite(value)) return "not defined";
  if (Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
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

function labelForOrbitClass(value: string) {
  return value
    .split("-")
    .map((part) => labelForKey(part))
    .join(" ");
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
