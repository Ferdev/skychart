import "./destinationPicker.css";
import "./styles.css";
import { decodeSmp3SourceId, smp3SourceIdRange } from "./smp3SourceIds";
import {
  buildDestinationPickerSections,
  buildDestinationPickerItems,
  classifyBody,
  destinationPickerColorStyle,
  findDestinationBody,
  formatPickerDistance,
  readRecentDestinations,
  recordRecentDestination,
  type DestinationBody,
  type DestinationBodyType,
  type DestinationPickerItem,
  type RecentDestination
} from "./destinationPicker";
import { eclipticCartesianToSpherical, equatorialToGalactic, formatDecimalDegrees, formatDeclination, formatRightAscension } from "./coordinates";
import { AU_PER_LIGHT_YEAR, MILKY_WAY_MODEL, lightYearsToAu, type GalacticModelFeature, type GalacticModelPoint } from "./galacticModel";
import { educationalComparisons } from "./navigationMetrics";
import { objectMediaFor, objectMediaStatusFor } from "./objectMedia";
import { initI18n, t } from "./i18n";
import { WebglPointRenderer, type PointLayerSource, type PointRenderStats } from "./webglPointRenderer";
import { composeAtlasPng } from "./exportCompositor";
import { measuredRedshift, scienceSemanticsFor, uncertaintySummary } from "./scienceSemantics";
import { installAnalytics, trackAnalytics, trackEvent } from "./analytics";
import { initializeErrorReporting } from "./errorReporting";
import { DISPLAY_LAYERS, decodeViewState, encodeViewState, type BodyFilter, type DisplayLayer, type ViewState } from "./viewState";
import { TourPlayer } from "./tourPlayer";
import { bindControlInfoTips, bindScaleDisclosures } from "./controlPanelInteractions";
import { escapeHtml, formatCount, formatInteger, formatNumber, formatRatio, identifierLabel, identifierValue, shortBodyName, uniquePairs, uniqueTextValues } from "./atlasFormatting";
import { clamp, degToRad, easeInOutCubic, edgeAnchorForScreen, expandedRect, isPresent, lerp, niceStep, pointInRect, pointRect, rectsOverlap, rectUnion, type EdgeSide, type Rect, type ScreenPoint } from "./geometry";

declare global {
  interface Window {
    __ATLAS_BOOT__?: { objectKey?: string };
    __ATLAS_DIAGNOSTICS__?: {
      smp3SourceIdFixture(): { range: ReturnType<typeof smp3SourceIdRange>; sourceId: string | null; absent: ReturnType<typeof smp3SourceIdRange> };
      webglClipFixture(): Promise<{ centerAlpha: number; outsideAlpha: number; pointsInViewport: number; occupiedPixels: number; preserveDrawingBuffer: boolean | null; contextLossFallback: boolean | null } | null>;
      selectionGeometry(): { selected: ScreenPoint | null; usable: Rect; workspaceTop: number | null; camera: Camera };
      bodyScreen(key: string): ScreenPoint | null;
      gestureState(): { activePointerIds: number[]; hadPinch: boolean };
    };
  }
}

initializeErrorReporting();
installAnalytics();

type AtlasTab = "catalog" | "object";
type ActiveAtlasTab = AtlasTab | null;
type SizeMode = "readable" | "hybrid" | "true";
type ZoomPreset = "inner" | "solar" | "nearby" | "galaxy" | "localGroup" | "messier" | "cosmicWeb" | "all";
type UniverseShell = {
  id: string;
  labelKey: string;
  radiusLy: number;
  noteKey: string;
};

type ExternalLink = {
  provider?: string | null;
  label?: string | null;
  url?: string | null;
};

type VectorComponents = {
  x: number;
  y: number;
  z: number;
};

type BodyCatalog = {
  source_type?: string | null;
  position_model?: string | null;
  dynamic_position?: boolean;
  preview?: boolean;
  aliases?: readonly string[];
  parent_key?: string | null;
  catalog_group?: string;
  ra_deg?: number | null;
  dec_deg?: number | null;
  external_ids?: Record<string, unknown> | null;
  external_links?: readonly ExternalLink[];
  source?: Record<string, unknown> | null;
  facts?: Record<string, unknown> | null;
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
  parallax_mas?: number | null;
  hip?: number | null;
  hd?: number | null;
  apparent_magnitude?: number | null;
  absolute_magnitude?: number | null;
  bv_color_index?: number | null;
  exoplanet_count?: number | null;
  stellar_radius_solar?: number | null;
  stellar_teff_k?: number | null;
  stellar_mass_solar?: number | null;
  spectral_type?: string | null;
  stellar_radius_source?: string | null;
};

type BodyExoplanet = {
  name: string;
  radius_earth?: number | null;
  mass_earth?: number | null;
  period_days?: number | null;
  semi_major_axis_au?: number | null;
  discovery_method?: string | null;
  discovery_year?: number | null;
};

type BodyExoplanetSystem = {
  source?: string | null;
  system_star_count?: number | null;
  system_planet_count?: number | null;
  system_moon_count?: number | null;
  confirmed_planet_count?: number | null;
  planets?: BodyExoplanet[];
  why_interesting?: string | null;
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

type BodySmallBody = {
  orbit_class?: string | null;
  neo?: boolean | null;
  pha?: boolean | null;
  diameter_km?: number | null;
  estimated_diameter_km?: number | null;
  h_absolute_magnitude?: number | null;
  perihelion_au?: number | null;
  aphelion_au?: number | null;
  semi_major_axis_au?: number | null;
  eccentricity?: number | null;
  inclination_deg?: number | null;
  orbital_period_days?: number | null;
  earth_moid_au?: number | null;
};

type Body = DestinationBody & {
  catalog?: BodyCatalog | null;
  state_vector?: BodyStateVector | null;
  orbit?: BodyOrbit | null;
  stellar?: BodyStellar | null;
  exoplanet_system?: BodyExoplanetSystem | null;
  deep_sky?: BodyDeepSky | null;
  small_body?: BodySmallBody | null;
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
    group_counts?: Record<string, number>;
  };
};

type CatalogSummary = {
  object_count: number;
  group_counts?: Record<string, number>;
  type_counts?: Record<string, number>;
  available_groups?: { key: string; label: string; description?: string }[];
};

type CatalogSearchPayload = {
  timestamp_utc?: string;
  au_km?: number;
  query: string;
  groups: string[];
  types: string[];
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  bodies?: Body[];
  objects?: CatalogObjectPayload[];
};

type CatalogViewportPayload = {
  bounds: {
    min_x_au: number;
    max_x_au: number;
    min_y_au: number;
    max_y_au: number;
  };
  limit: number;
  total: number;
  objects: CatalogObjectPayload[];
};

type CatalogDensityPayload = {
  bounds: {
    min_x_au: number;
    max_x_au: number;
    min_y_au: number;
    max_y_au: number;
  };
  bins: number;
  groups: string[];
  types: string[];
  total: number;
  max_cell_count: number;
  cells: CatalogDensityCell[];
};

type CatalogDensityCell = {
  x_bin: number;
  y_bin: number;
  count: number;
  min_magnitude?: number | null;
  avg_magnitude?: number | null;
};

type CatalogPointPayload = {
  bounds: {
    min_x_au: number;
    max_x_au: number;
    min_y_au: number;
    max_y_au: number;
  };
  groups: string[];
  types: string[];
  limit: number;
  total: number;
  returned: number;
  vertices: Float32Array;
  origin: { x: number; y: number };
  format?: "SMP2" | "SMP3";
  declared: number;
  flags: number;
};

type CatalogPointTileRequest = {
  key: string;
  layerId: string;
  signature: string;
  params: URLSearchParams;
  staticUrl?: string;
  staticRange?: { offset: number; length: number };
  staticLayerId?: string;
  priority: number;
  phase: "active" | "prefetch";
  bounds: CatalogPointPayload["bounds"];
  groups: string[];
  types: DestinationBodyType[];
  limit: number;
};

type CatalogPointTile = {
  request: CatalogPointTileRequest;
  payload?: CatalogPointPayload;
  source?: PointLayerSource;
  abortController?: AbortController;
  loadedAt?: number;
  failedAt?: number;
  retryCount?: number;
  lastUsedAt: number;
};

type CatalogPointTileManifestLevel = {
  span_log2: number;
  span_au: number;
  sample_buckets?: number;
  max_points_per_tile?: number;
  tile_count?: number;
  point_count?: number;
  raw_point_count?: number;
};

type CatalogPointContainerIndex = {
  view: DataView;
  count: number;
};

type CatalogPointTileManifestLayer = {
  id: string;
  tile_url_template?: string;
  container?: string;
  containerIndex?: CatalogPointContainerIndex;
  groups: string[];
  types: DestinationBodyType[];
  source_counts: Record<string, number>;
  levels: CatalogPointTileManifestLevel[];
};

type CatalogPointTileManifest = {
  version: string;
  format: "SMP2" | "SMP3";
  color_lut: number[][];
  source_counts: Record<string, number>;
  layers: CatalogPointTileManifestLayer[];
};

type CatalogPointTileManifestState = "loading" | "ready" | "missing";
type ObjectDetailHydrationStatus = "loading" | "error";

type ObjectDetailHydrationState = {
  status: ObjectDetailHydrationStatus;
  message?: string;
  requestId: number;
};

type CatalogNearestPayload = {
  object?: CatalogObjectPayload | null;
};

type CatalogObjectPayload = {
  key: string;
  name: string;
  object_type?: DestinationBodyType | string | null;
  catalog_group?: string | null;
  source_type?: string | null;
  position_model?: string | null;
  parent_key?: string | null;
  color?: string | null;
  radius_km?: number | null;
  aliases?: readonly string[] | null;
  external_ids?: Record<string, unknown> | null;
  external_links?: readonly { provider: string; label: string; url: string }[] | null;
  source?: Record<string, unknown> | null;
  facts?: Record<string, unknown> | null;
  astrometry?: {
    ra_deg?: number | null;
    dec_deg?: number | null;
    distance_pc?: number | null;
    distance_ly?: number | null;
    apparent_magnitude?: number | null;
    absolute_magnitude?: number | null;
  } | null;
  position?: {
    x_au?: number | null;
    y_au?: number | null;
    z_au?: number | null;
    x_km?: number | null;
    y_km?: number | null;
    z_km?: number | null;
  } | null;
};

type CatalogSearchResult = {
  bodies: Body[];
  source: "phoenix" | "local";
  fallback?: boolean;
  total?: number;
  hasMore?: boolean;
  nextOffset?: number;
};

const STARTUP_EPHEMERIS_GROUPS = [
  "core",
  "mars_moons",
  "jupiter_major_moons",
  "saturn_major_moons",
  "nearby_exoplanet_systems",
  "messier_deep_sky"
] as const;

type Camera = {
  xAu: number;
  yAu: number;
  pxPerAu: number;
};

type LoadingStep = "api" | "download" | "parse" | "render";

type EdgeReferenceHitRegion = {
  body: Body;
  rect: Rect;
};

type SizeVisual = {
  diameterKm: number;
  diameterPx: number;
  isSubpixel: boolean;
  visualType: DestinationBodyType;
};

type RenderRequestOptions = {
  data?: boolean;
};

type SelectBodyOptions = {
  center?: boolean;
  zoom?: "local";
  animate?: boolean;
  transient?: boolean;
};

type CatalogNearestQuery = {
  xAu: number;
  yAu: number;
  radiusAu: number;
  groups: string[];
  types: DestinationBodyType[];
};

type DataRefreshOptions = {
  immediate?: boolean;
};

type BodyHitEntry = {
  body: Body;
  x: number;
  y: number;
  radius: number;
};

type CatalogPointHitEntry = {
  x: number;
  y: number;
  radius: number;
  tile: CatalogPointTile;
  pointIndex: number;
};

type PickerSearchState = {
  requestId: number;
  latestBodies: Body[];
  activeOptionKey: string | null;
  signature?: string;
  total?: number;
  nextOffset?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  fallback?: boolean;
  abortController?: AbortController;
};

type PickerSearchConfig = {
  state: PickerSearchState;
  input: HTMLInputElement;
  picker: HTMLElement;
  filter: BodyFilterDefinition;
  sourceBodies: Body[];
  activeKey: string | null;
  currentTargetKey: string | null;
  emptyMessage: string;
  loadingMessage: string;
  fallbackMessage: string;
  guidedSet?: { labelKey: string } | null;
  excludeKeys?: string[];
  queryForSearch?: (query: string) => string;
  afterRender?: () => void;
};

const AU_KM_FALLBACK = 149_597_870.7;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;
const MIN_ZOOM = 1e-14;
const MAX_ZOOM = 50_000_000;
const ZOOM_SLIDER_STEPS = 1000;
const LOCAL_ZOOM_DIAMETER_PX = 170;
const LOCAL_ZOOM_DURATION_MS = 1100;
const FEATURED_KEYS = ["earth", "moon", "mars", "jupiter", "saturn", "proxima-cen", "m31", "m42"];
const CURATED_OBJECT_SUMMARIES: Record<string, string> = {
  sun: "The Sun anchors every Solar System orbit in the atlas and provides the reference scale for stellar mass, radius, and luminosity.",
  mercury: "Mercury is the innermost planet, showing how solar heating and tidal history shape small rocky worlds.",
  venus: "Venus is Earth's near twin in size but a climate extreme, making it a key comparison point for terrestrial planet evolution.",
  earth: "Earth is the observing baseline for the atlas and the only known inhabited world, tying sky position to local distance and scale.",
  moon: "The Moon preserves impact and volcanic history close enough to connect telescopic detail with spacecraft-era geology.",
  mars: "Mars is the best-studied nearby rocky planet beyond Earth and a reference for climate loss, volcanism, and surface exploration.",
  jupiter: "Jupiter dominates Solar System dynamics and its major moons form a compact comparison set of geologically diverse worlds.",
  saturn: "Saturn connects giant-planet structure, rings, and moon systems in one of the clearest natural laboratories in the Solar System.",
  uranus: "Uranus is an ice giant with an extreme axial tilt, useful for comparing outer-planet interiors and seasonal geometry.",
  neptune: "Neptune anchors the outer classical planets and shows how fast atmospheric dynamics persist far from the Sun.",
  pluto: "Pluto links dwarf planets, Kuiper Belt history, and volatile geology at the edge of the planetary system.",
  io: "Io is the Solar System's most volcanically active moon, driven by tidal heating inside Jupiter's moon system.",
  europa: "Europa is a high-value ocean-world target because its icy surface likely overlies a global salty ocean.",
  ganymede: "Ganymede is the largest moon in the Solar System and the only moon known to generate its own magnetic field.",
  callisto: "Callisto records ancient outer Solar System impacts and contrasts strongly with the more active inner Galilean moons.",
  titan: "Titan is the only moon with a dense atmosphere and stable surface liquids, making it central to comparative planetary chemistry.",
  enceladus: "Enceladus vents material from a subsurface ocean into space, making it one of the most direct ocean-world sampling targets.",
  m13: "M13 is a benchmark northern globular cluster, showing a dense ancient stellar population in the Milky Way halo.",
  m31: "Andromeda is the nearest large spiral galaxy, placing the Milky Way in direct Local Group context.",
  m42: "The Orion Nebula is a nearby massive star-forming region where young stars illuminate their natal gas and dust.",
  m45: "The Pleiades are a nearby young open cluster, useful for reading stellar color, age, and reflection nebulosity.",
  m57: "The Ring Nebula shows a late Sun-like stellar evolutionary phase, with expelled gas surrounding a hot central remnant."
};
const STARTUP_CATALOG_GROUPS = ["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons", "nearby_exoplanet_systems", "messier_deep_sky"];
const VIEWPORT_CATALOG_MAX_WIDTH_LY = 120_000_000;
const VIEWPORT_CATALOG_DEBOUNCE_MS = 90;
const CAMERA_DATA_REFRESH_DEBOUNCE_MS = 180;
const SEARCH_INPUT_DEBOUNCE_MS = 180;
const POINT_LAYER_MAX_WIDTH_LY = 250_000;
const POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY = 30_000_000_000;
const POINT_LAYER_QUASAR_MAX_WIDTH_LY = 30_000_000_000;
const POINT_LAYER_VIEWPORT_PADDING = 0.35;
const POINT_TILE_TARGET_VIEW_DIVISIONS = 2;
const POINT_TILE_TARGET_VIEW_DIVISIONS_WIDE = 1;
const POINT_TILE_MAX_ACTIVE = 28;
const POINT_TILE_MAX_ACTIVE_WIDE = 8;
const POINT_TILE_MAX_ACTIVE_UNIVERSE = 6;
const POINT_TILE_MAX_ACTIVE_UNIVERSE_DENSE = 192;
const POINT_TILE_MAX_POINTS = 24_000;
const POINT_TILE_MAX_POINTS_WIDE = 12_000;
const POINT_TILE_MAX_POINTS_UNIVERSE = 7_500;
const POINT_TILE_CACHE_LIMIT = 256;
const POINT_TILE_FETCH_CONCURRENCY = 12;
const POINT_TILE_PREFETCH_LEVEL_RADIUS = 1;
const POINT_TILE_PREFETCH_MAX_REQUESTS = 12;
const POINT_TILE_PREFETCH_DELAY_MS = 350;
const POINT_TILE_RETRY_BASE_MS = 1_200;
const POINT_TILE_RETRY_MAX_MS = 8_000;
const MILKY_WAY_DETAIL_BUDGET_MS = 6;
const PERF_POINT_MEASURE_INTERVAL_MS = 1_000;
const POINT_BINARY_HEADER_BYTES = 8;
const POINT_BINARY_RECORD_BYTES = 12;
const POINT_VERTEX_STRIDE_FLOATS = 3;
const CATALOG_TILE_MANIFEST_URL = catalogTileManifestUrl();
const ALLOW_DYNAMIC_POINT_FALLBACK = dynamicPointFallbackEnabled();
const catalogPointDecodeWorker = createCatalogPointDecodeWorker();
let catalogPointDecodeRequestId = 0;
const catalogPointDecodeCallbacks = new Map<
  number,
  { resolve: (value: CatalogPointDecoded) => void; reject: (reason?: unknown) => void }
>();
type CatalogPointDecoded = {
  returned: number;
  declared: number;
  flags: number;
  vertices: Float32Array;
  format: "SMP2" | "SMP3";
  originX: number;
  originY: number;
};
let perfWebglEmaMs = 0;
const POINT_LAYER_GROUPS = ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"];
const DEEP_SKY_POINT_GROUPS = ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "curated_extragalactic_survey", "desi_dr1_galaxies", "desi_dr1_quasars", "quaia_g20_quasars"];
const DEEP_SKY_POINT_TYPES: DestinationBodyType[] = ["galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster"];
const UNIVERSE_DENSE_LAYER_IDS = new Set(["desi_dr1", "quaia_g20"]);
const EXTRAGALACTIC_POINT_TYPES = new Set<DestinationBodyType>(["galaxy", "quasar", "active_galaxy"]);
const POINT_LAYER_GROUP_SET = new Set(POINT_LAYER_GROUPS);
const POINT_SAMPLE_BUCKET_COUNT = 1_024;
const BODY_HIT_GRID_CELL_PX = 56;
const CATALOG_POINT_HIT_GRID_CELL_PX = 4;
const CATALOG_POINT_HIT_RADIUS_PX = 6;
const MAP_POINT_RADIUS_PX = 1.3;
const MAP_POINT_ALPHA = 0.82;
const MAP_POINT_SELECTION_RING_PX = 8.5;
const WORKSPACE_LABEL_KEYS: Record<AtlasTab, string> = {
  catalog: "workspace.searchCatalog",
  object: "workspace.selectedObject"
};
type BodyFilterDefinition = { key: BodyFilter; labelKey: string; types?: DestinationBodyType[]; groups?: string[] };

type ExploreDomainDefinition = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  filterKey: BodyFilter;
  guidedSetId: string;
  zoomPreset: ZoomPreset;
  count: (summary: CatalogSummary | null, bodies: Body[]) => number | null;
};

const BODY_FILTERS: BodyFilterDefinition[] = [
  { key: "all", labelKey: "filters.all" },
  {
    key: "solar_system",
    labelKey: "filters.solarSystem",
    types: ["star", "planet", "moon", "dwarf_planet"],
    groups: ["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons"]
  },
  { key: "planet", labelKey: "filters.planets", types: ["planet"], groups: ["core"] },
  { key: "moon", labelKey: "filters.moons", types: ["moon"], groups: ["core", "mars_moons", "jupiter_major_moons", "saturn_major_moons"] },
  {
    key: "star",
    labelKey: "filters.stars",
    types: ["star"],
    groups: ["core", "bright_stars", "nearby_exoplanet_systems", "exoplanet_systems", "gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"]
  },
  { key: "bright_star", labelKey: "filters.bright", types: ["star"], groups: ["bright_stars"] },
  { key: "gaia_star", labelKey: "filters.gaia", types: ["star"], groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"] },
  { key: "exoplanet_system", labelKey: "filters.exoplanets", groups: ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"] },
  { key: "dwarf_planet", labelKey: "filters.dwarf", types: ["dwarf_planet"], groups: ["core"] },
  { key: "small_body", labelKey: "filters.smallBodies", types: ["asteroid", "comet", "small_body"], groups: ["jpl_small_bodies"] },
  { key: "deep_sky", labelKey: "filters.deepSky", types: ["galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster"], groups: ["messier_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "curated_extragalactic_survey", "desi_dr1_galaxies", "desi_dr1_quasars", "quaia_g20_quasars"] },
  { key: "galaxy", labelKey: "filters.galaxies", types: ["galaxy"], groups: ["messier_deep_sky", "simbad_extragalactic", "curated_extragalactic_survey", "desi_dr1_galaxies"] },
  { key: "quasar", labelKey: "filters.quasars", types: ["quasar"], groups: ["simbad_extragalactic", "curated_extragalactic_survey", "desi_dr1_quasars", "quaia_g20_quasars"] },
  { key: "active_galaxy", labelKey: "filters.agn", types: ["active_galaxy"], groups: ["simbad_extragalactic", "curated_extragalactic_survey"] },
  { key: "black_hole", labelKey: "filters.blackHoles", types: ["black_hole"], groups: ["simbad_compact_objects"] },
  { key: "pulsar", labelKey: "filters.pulsars", types: ["pulsar"], groups: ["simbad_compact_objects"] },
  { key: "nebula", labelKey: "filters.nebulae", types: ["nebula"], groups: ["messier_deep_sky"] },
  { key: "star_cluster", labelKey: "filters.clusters", types: ["star_cluster"], groups: ["messier_deep_sky"] }
];
const GUIDED_SETS: { id: string; labelKey: string; keys: string[] }[] = [
  { id: "solar-neighborhood", labelKey: "guided.solarNeighborhood", keys: ["sun", "earth", "moon", "mars", "jupiter", "saturn"] },
  { id: "bright-stars", labelKey: "guided.brightStars", keys: ["hip-32349", "hip-30438", "hip-69673", "hip-71683", "hip-91262", "hip-24436", "hip-24608"] },
  { id: "nearby-stars", labelKey: "guided.nearbyStars", keys: ["proxima-cen", "barnards-star", "eps-eri", "tau-cet", "gj-411"] },
  { id: "small-bodies", labelKey: "guided.smallBodies", keys: ["jpl-sbdb-20000001", "jpl-sbdb-20000004", "jpl-sbdb-20000433", "jpl-sbdb-1000036"] },
  { id: "exoplanets", labelKey: "guided.exoplanetSystems", keys: ["exosys-trappist-1", "exosys-55-cnc", "exosys-hr-8799", "exosys-kepler-11", "exosys-toi-700", "exosys-lhs-1140"] },
  { id: "deep-sky", labelKey: "guided.messierHighlights", keys: ["m1", "m13", "m31", "m42", "m45", "m57"] },
  { id: "galaxies", labelKey: "guided.galaxies", keys: ["m31", "m33", "m51", "m81", "m82", "m87"] },
  { id: "active-galaxies", labelKey: "guided.activeGalaxies", keys: ["simbad-m-87", "simbad-3c-273", "simbad-ngc-1068", "simbad-3c-279"] },
  { id: "nebulae", labelKey: "guided.nebulae", keys: ["m1", "m8", "m16", "m17", "m20", "m42", "m57"] }
];
const EXPLORE_DOMAINS: ExploreDomainDefinition[] = [
  {
    id: "solar-system",
    titleKey: "explore.solarSystem.title",
    descriptionKey: "explore.solarSystem.description",
    filterKey: "solar_system",
    guidedSetId: "solar-neighborhood",
    zoomPreset: "solar",
    count: (_summary, bodies) => bodies.filter(isSolarSystemBody).length
  },
  {
    id: "nearby-stars",
    titleKey: "explore.nearbyStars.title",
    descriptionKey: "explore.nearbyStars.description",
    filterKey: "star",
    guidedSetId: "nearby-stars",
    zoomPreset: "nearby",
    count: (summary, bodies) => summary?.group_counts?.nearby_exoplanet_systems ?? bodies.filter((body) => body.catalog_group === "nearby_exoplanet_systems").length
  },
  {
    id: "messier-deep-sky",
    titleKey: "explore.messier.title",
    descriptionKey: "explore.messier.description",
    filterKey: "deep_sky",
    guidedSetId: "deep-sky",
    zoomPreset: "messier",
    count: (summary, bodies) => summary?.group_counts?.messier_deep_sky ?? bodies.filter((body) => body.catalog_group === "messier_deep_sky").length
  },
  {
    id: "galaxies",
    titleKey: "explore.galaxies.title",
    descriptionKey: "explore.galaxies.description",
    filterKey: "galaxy",
    guidedSetId: "galaxies",
    zoomPreset: "all",
    count: (summary, bodies) => summary?.type_counts?.galaxy ?? bodies.filter((body) => classifyBody(body).type === "galaxy").length
  },
  {
    id: "universe-scale",
    titleKey: "explore.universe.title",
    descriptionKey: "explore.universe.description",
    filterKey: "deep_sky",
    guidedSetId: "galaxies",
    zoomPreset: "cosmicWeb",
    count: (summary, bodies) => {
      const catalogDeepSky = (summary?.type_counts?.galaxy ?? 0) + (summary?.type_counts?.quasar ?? 0) + (summary?.type_counts?.active_galaxy ?? 0);
      return catalogDeepSky || bodies.filter((body) => ["galaxy", "quasar", "active_galaxy"].includes(classifyBody(body).type)).length;
    }
  },
  {
    id: "exoplanet-systems",
    titleKey: "explore.exoplanets.title",
    descriptionKey: "explore.exoplanets.description",
    filterKey: "exoplanet_system",
    guidedSetId: "exoplanets",
    zoomPreset: "nearby",
    count: (summary, bodies) => (summary?.group_counts?.nearby_exoplanet_systems ?? 0) + (summary?.group_counts?.exoplanet_systems ?? 0) || bodies.filter((body) => body.exoplanet_system).length
  },
  {
    id: "small-bodies",
    titleKey: "explore.smallBodies.title",
    descriptionKey: "explore.smallBodies.description",
    filterKey: "small_body",
    guidedSetId: "small-bodies",
    zoomPreset: "solar",
    count: (summary, bodies) => (summary?.type_counts?.asteroid ?? 0) + (summary?.type_counts?.comet ?? 0) + (summary?.type_counts?.small_body ?? 0) || bodies.filter((body) => ["asteroid", "comet", "small_body"].includes(classifyBody(body).type)).length
  }
];
const TIME_STEPS = [
  { labelKey: "time.oneDay", days: 1 },
  { labelKey: "time.oneWeek", days: 7 },
  { labelKey: "time.oneMonth", days: 30 },
  { labelKey: "time.oneYear", days: 365.25 },
  { labelKey: "time.tenYears", days: 3652.5 },
  { labelKey: "time.oneCentury", days: 36_525 },
  { labelKey: "time.oneMillennium", days: 365_250 },
  { labelKey: "time.tenThousandYears", days: 3_652_500 },
  { labelKey: "time.oneMillionYears", days: 365_250_000 }
];
const MAX_COMPARISON_DIAMETER_PX = 112;
const OBSERVABLE_UNIVERSE_RADIUS_LY = 46_500_000_000;
const UNIVERSE_SHELLS: UniverseShell[] = [
  { id: "current-view", labelKey: "universe.shell.currentView", radiusLy: 100_000, noteKey: "universe.shell.currentViewNote" },
  { id: "local-volume", labelKey: "universe.shell.localVolume", radiusLy: 35_000_000, noteKey: "universe.shell.localVolumeNote" },
  { id: "laniakea", labelKey: "universe.shell.laniakea", radiusLy: 260_000_000, noteKey: "universe.shell.laniakeaNote" },
  { id: "quasar-epoch", labelKey: "universe.shell.quasarEpoch", radiusLy: 13_000_000_000, noteKey: "universe.shell.quasarEpochNote" },
  { id: "observable", labelKey: "universe.shell.observable", radiusLy: OBSERVABLE_UNIVERSE_RADIUS_LY, noteKey: "universe.shell.observableNote" }
];

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const pointCanvas = requiredElement<HTMLCanvasElement>("#point-map");
const pointRenderer = new WebglPointRenderer(pointCanvas);
pointCanvas.addEventListener("point-renderer-unavailable", () => requestRender());
const canvas = requiredElement<HTMLCanvasElement>("#map");
const catalogPointHover = requiredElement<HTMLElement>("#catalog-point-hover");
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
const selectedObjectPanel = requiredElement<HTMLElement>("#selected-object-panel");
const selectedSummaryOrb = requiredElement<HTMLElement>("#selected-summary-orb");
const selectedSummaryName = requiredElement<HTMLElement>("#selected-summary-name");
const selectedSummaryMeta = requiredElement<HTMLElement>("#selected-summary-meta");
const mapHud = requiredElement<HTMLElement>("#controls");
const workspacePanel = requiredElement<HTMLElement>("#workspace-panel");
const workspaceLabel = requiredElement<HTMLElement>("#workspace-label");
const workspaceSearchLink = requiredElement<HTMLButtonElement>("#workspace-search-link");
const closePanel = requiredElement<HTMLButtonElement>("#close-panel");
const modeRail = requiredElement<HTMLElement>(".mode-rail");
const bodySearch = requiredElement<HTMLInputElement>("#body-search");
const focusBodyButton = requiredElement<HTMLButtonElement>("#focus-body");
const quickFocusButtons = requiredElement<HTMLElement>("#quick-focus-buttons");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]"));
const catalogCount = requiredElement<HTMLElement>("#catalog-count");
const bodyFilterButtons = requiredElement<HTMLElement>("#body-filter-buttons");
const mapFilterButtons = requiredElement<HTMLElement>("#map-filter-buttons");
const bodyPicker = requiredElement<HTMLElement>("#body-picker");
const exploreDomains = requiredElement<HTMLElement>("#explore-domains");
const guidedTours = requiredElement<HTMLElement>("#guided-tours");
const bodyInfo = requiredElement<HTMLElement>("#body-info");
const nowStatus = requiredElement<HTMLElement>("#now-status");
const nowEvents = requiredElement<HTMLOListElement>("#now-events");
const centerSelected = requiredElement<HTMLButtonElement>("#center-selected");
const zoomSelected = requiredElement<HTMLButtonElement>("#zoom-selected");
const compareHeading = requiredElement<HTMLElement>("#compare-heading");
const clearCompare = requiredElement<HTMLButtonElement>("#clear-compare");
const compareSearch = requiredElement<HTMLInputElement>("#compare-search");
const compareFocus = requiredElement<HTMLButtonElement>("#compare-focus");
const compareFilterButtons = requiredElement<HTMLElement>("#compare-filter-buttons");
const comparePicker = requiredElement<HTMLElement>("#compare-picker");
const comparePanel = requiredElement<HTMLElement>("#compare-panel");
const timeSummary = requiredElement<HTMLElement>("#time-summary");
const timeInput = requiredElement<HTMLInputElement>("#time-input");
const timeNow = requiredElement<HTMLButtonElement>("#time-now");
const applyTime = requiredElement<HTMLButtonElement>("#apply-time");
const timeStepLabel = requiredElement<HTMLElement>("#time-step-label");
const timeStepSlider = requiredElement<HTMLInputElement>("#time-step-slider");
const timeStepBack = requiredElement<HTMLButtonElement>("#time-step-back");
const timeStepForward = requiredElement<HTMLButtonElement>("#time-step-forward");
const zoomPresets = requiredElement<HTMLElement>("#zoom-presets");
const mobileScaleToggle = document.querySelector<HTMLButtonElement>("#mobile-scale-toggle");
const zoomOut = requiredElement<HTMLButtonElement>("#zoom-out");
const zoomIn = requiredElement<HTMLButtonElement>("#zoom-in");
const zoomScaleSlider = requiredElement<HTMLInputElement>("#zoom-scale-slider");
const zoomScaleLabel = requiredElement<HTMLOutputElement>("#zoom-scale-label");
const zoomPixelScale = requiredElement<HTMLElement>("#zoom-pixel-scale");
const zoomViewScale = requiredElement<HTMLElement>("#zoom-view-scale");
const sizeModeButtons = requiredElement<HTMLElement>("#size-mode-buttons");
const displayToggles = requiredElement<HTMLElement>("#display-toggles");
const diagnosticsToggle = requiredElement<HTMLInputElement>("#diagnostics-toggle");
const contextModeStatus = requiredElement<HTMLElement>("#context-mode-status");
const scienceLayerDisclosure = requiredElement<HTMLElement>("#science-layer-disclosure");
const perfHud = document.querySelector<HTMLElement>("#perf-hud");
const errorPanel = requiredElement<HTMLElement>("#error-panel");
const exportResolution = requiredElement<HTMLSelectElement>("#export-resolution");
const exportButton = requiredElement<HTMLButtonElement>("#export-image");
const exportStatus = requiredElement<HTMLElement>("#export-status");
const copyLinkButton = requiredElement<HTMLButtonElement>("#copy-link");
const nativeShareButton = requiredElement<HTMLButtonElement>("#native-share");
const shareFeedback = requiredElement<HTMLElement>("#share-feedback");
const shareCompareButton = requiredElement<HTMLButtonElement>("#share-compare");
const copyEmbedButton = requiredElement<HTMLButtonElement>("#copy-embed");
const embedFeedback = requiredElement<HTMLElement>("#embed-feedback");
const shareMenuButton = requiredElement<HTMLButtonElement>("#share-menu-button");
const sharePopover = requiredElement<HTMLElement>("#share-popover");
const closeSharePopoverButton = requiredElement<HTMLButtonElement>("#close-share-popover");
const controlInfoTooltip = requiredElement<HTMLElement>("#control-info-tooltip");
const embedActivation = requiredElement<HTMLButtonElement>("#embed-activation");
const embedAttribution = requiredElement<HTMLElement>("#embed-attribution");
const embedCanonicalLink = requiredElement<HTMLAnchorElement>("#embed-canonical-link");
const embedViewName = requiredElement<HTMLElement>("#embed-view-name");

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
let requestedCatalogRelease: string | undefined;
let historyRestoreInProgress = false;
let viewStateReplaceTimer: number | null = null;
let pendingSelectionState: ViewState | null = bootViewState;
let tourBootHandled = false;
let hoverKey: string | null = null;
let compareTargetKey: string | null = null;
let recentDestinations: RecentDestination[] = readRecentDestinations();
const catalogSearchState: PickerSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
const compareSearchState: PickerSearchState = { requestId: 0, latestBodies: [], activeOptionKey: null };
let mapDragging = false;
let mapDragMoved = false;
let dragStart: ScreenPoint | null = null;
let dragCameraStart: Camera | null = null;
const activeMapPointers = new Map<number, ScreenPoint>();
let pinchGesture: { midpoint: ScreenPoint; distance: number } | null = null;
let mapGestureHadPinch = false;
let loadingStartedAt = performance.now();
let renderRequested = false;
let renderFrameId: number | null = null;
let cameraAnimationFrame: number | null = null;
let cameraAnimationComplete: (() => void) | null = null;
let cameraDataRefreshTimer: number | null = null;
let edgeReferenceHitRegions: EdgeReferenceHitRegion[] = [];
let viewportCatalogTimer: number | null = null;
let viewportCatalogRequestId = 0;
let viewportCatalogSignature = "";
let viewportCatalogInFlightSignature = "";
let bodyPickerUpdateTimer: number | null = null;
let comparePickerUpdateTimer: number | null = null;
let catalogSummary: CatalogSummary | null = null;
let catalogDensity: CatalogDensityPayload | null = null;
let catalogDensityTimer: number | null = null;
let catalogDensityRequestId = 0;
let catalogDensitySignature = "";
let catalogDensityInFlightSignature = "";
let catalogPointTimer: number | null = null;
let catalogPointPrefetchTimer: number | null = null;
let catalogPointRequestId = 0;
let catalogPointSignature = "";
let catalogPointPrefetchSignature = "";
let catalogPointTiles = new Map<string, CatalogPointTile>();
let activeCatalogPointTileKeys = new Set<string>();
let renderedCatalogPointLayerIds = new Set<string>();
let catalogPointTileManifest: CatalogPointTileManifest | null = null;
let catalogPointTileManifestState: CatalogPointTileManifestState = "loading";
let objectDetailHydrationRequestId = 0;
const objectDetailHydrationStates = new Map<string, ObjectDetailHydrationState>();
let transientSelectedKey: string | null = null;
let mapDetailSelectionController: AbortController | null = null;
let catalogPointTileManifestPromise: Promise<void> | null = null;
let visibleBodiesFrameCache: Body[] | null = null;
let bodyHitGrid = new Map<string, BodyHitEntry[]>();
let bodyHitGridValid = false;
let catalogPointHitGrid = new Map<string, CatalogPointHitEntry>();
let catalogPointHitGridValid = false;
let bodyPointLayerCache: PointLayerSource | null = null;
const pointColorCache = new Map<string, [number, number, number]>();
let usableViewportRectCache: Rect | null = null;
let perfEnabled = new URLSearchParams(window.location.search).has("perf") || window.localStorage.getItem("starsmap:perf") === "1";
let perfLastFrameAt = performance.now();
let perfFrameMs = 0;
let perfDrawMs = 0;
let perfWebglMs = 0;
let perfBufferMs = 0;
let perfHitTestMs = 0;
let perfPointRendererStats: PointRenderStats = { layerCount: 0, pointsDrawn: 0, pointsInViewport: 0, occupiedPixels: 0, capped: false };
let catalogPointsInViewport: number | null = null;
let catalogViewportMeasurePending = true;
let perfLastPointMeasureAt = -Infinity;
let perfLastViewportMs = 0;
let perfLastPointMs = 0;
let perfMilkyWayMs = 0;
let perfViewportLoads = 0;
let perfPointTileLoads = 0;
let perfPointTileQueued = 0;
let perfPointTileActiveInFlight = 0;
let perfPointTilePrefetchInFlight = 0;
let perfPointTileAborts = 0;
let embedActivated = !isEmbedMode;
let embedVisible = true;

const tourPlayer = new TourPlayer({ navigate: navigateTourStep, prewarm: prewarmTourStep, track: (event, properties) => trackEvent(event, properties) });
if (perfEnabled) window.__ATLAS_DIAGNOSTICS__ = { smp3SourceIdFixture, webglClipFixture, selectionGeometry, bodyScreen, gestureState };

if (bootViewState) applyDecodedViewStateFields(bootViewState);
if (isEmbedMode) initializeEmbedMode();

resizeCanvas();
initI18n();
bindEvents();
initializeUi();
void loadCatalogTileManifest();
void loadNowEvents();
loadAtlas(viewTime === "now" ? undefined : viewTime);
requestRender({ data: true });

async function loadAtlas(timestampIso?: string) {
  if (timestampIso) viewTime = new Date(timestampIso).toISOString();
  loadingStartedAt = performance.now();
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
    const bodies = mergeBodyList(payload.bodies, preservedBodies);
    ephemeris = { ...payload, bodies };
    catalogSummary = catalogSummaryFromEphemeris(payload);
    void refreshCatalogSummary();
    bodyByKey = new Map(bodies.map((body) => [body.key, body]));
    viewportCatalogSignature = "";
    viewportCatalogInFlightSignature = "";
    catalogDensity = null;
    catalogDensitySignature = "";
    catalogDensityInFlightSignature = "";
    cancelCatalogPointRequest();
    clearCatalogPointTiles(false);
    if (selectedKey && !bodyByKey.has(selectedKey) && !historyRestoreInProgress && !pendingSelectionState) selectedKey = "";
    ensureCompareTarget();
    timeInput.value = toDatetimeLocalValue(new Date(payload.timestamp_utc));
    recentDestinations = readRecentDestinations();

    setLoading("render", 88, t("loading.controls"));
    updateAllUi();
    if (payload.bodies.length > 0 && activeZoomPreset && !bootViewState && !serverBootObjectKey) {
      applyZoomPreset(activeZoomPreset, false);
    }
    const selectionState = pendingSelectionState;
    pendingSelectionState = null;
    if (selectionState) await restoreSelectionFromViewState(selectionState);
    else if (serverBootObjectKey) await selectBodyByKey(serverBootObjectKey, { center: true });
    requestDataRefresh({ immediate: true });
    loadingScreen.hidden = true;
    loadState.textContent = t("status.ready");
    requestRender();
    scheduleViewStateReplace();
    startBootTour();
  } catch (error) {
    loadState.textContent = t("status.error");
    setError(error instanceof Error ? error.message : String(error));
    loadingDetail.textContent = t("error.unableLoad");
    loadingProgressLabel.textContent = t("status.error");
  }
}

function bindEvents() {
  bindScaleDisclosures();
  bindControlInfoTips(controlInfoTooltip);
  sharePopover.addEventListener("toggle", () => {
    shareMenuButton.setAttribute("aria-expanded", String(sharePopover.matches(":popover-open")));
  });
  closeSharePopoverButton.addEventListener("click", () => sharePopover.hidePopover());
  exportButton.addEventListener("click", () => void exportCurrentView());
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const tourStep = Number(params.get("step"));
    if (params.get("tour") && Number.isSafeInteger(tourStep) && tourStep >= 0) { void tourPlayer.restoreStep(tourStep); return; }
    const state = decodeViewState(window.location.search);
    if (state) void restoreViewState(state);
  });
  copyLinkButton.addEventListener("click", () => void shareCurrentView(false));
  shareCompareButton.addEventListener("click", () => void shareCurrentView(false));
  nativeShareButton.addEventListener("click", () => void shareCurrentView(true));
  nativeShareButton.hidden = typeof navigator.share !== "function";
  copyEmbedButton.addEventListener("click", () => void copyEmbedSnippet());
  embedActivation.addEventListener("click", activateEmbedInteraction);
  window.addEventListener("cosmic-atlas:locale-change", () => {
    if (loadingScreen.hidden) loadState.textContent = errorPanel.hidden ? t("status.ready") : t("status.error");
    updateAllUi();
    updateTimeSummary();
    updateTimeStepUi();
    requestRender({ data: true });
    scheduleViewStateReplace();
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    updateSelectedPanelMetrics();
    requestRender({ data: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "p" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    perfEnabled = !perfEnabled;
    window.localStorage.setItem("starsmap:perf", perfEnabled ? "1" : "0");
    diagnosticsToggle.checked = perfEnabled;
    updatePerfHud();
  });

  bodySearch.addEventListener("input", () => {
    activeGuidedSetId = null;
    resetPickerSearchState(catalogSearchState);
    renderPickerStatus(bodyPicker, t("search.loading"), "updating");
    updateExploreDomains();
    updateGuidedSets();
    scheduleBodyPickerUpdate();
  });

  bodySearch.addEventListener("keydown", (event) => {
    if (
      handlePickerKeyboard(event, {
        state: catalogSearchState,
        input: bodySearch,
        picker: bodyPicker,
        onSelect: (key) => void selectBodyByKey(key, { center: true }),
        onFallbackEnter: () => void focusSearchResult(),
        onEscapeClear: () => {
          activeGuidedSetId = null;
          resetPickerSearchState(catalogSearchState);
          void updateBodyPicker();
        }
      })
    ) {
      event.preventDefault();
    }
  });

  focusBodyButton.addEventListener("click", () => {
    void focusSearchResult();
  });

  quickFocusButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-focus-key]");
    if (!button) return;
    selectBody(button.dataset.focusKey ?? "", { center: true, zoom: "local" });
  });

  bodyInfo.addEventListener("click", (event) => {
    const observeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-observe-location]");
    if (observeButton) { void requestObservation(observeButton.dataset.observeLocation === "browser"); return; }
    const citationButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy-citation]");
    if (citationButton) {
      const body = bodyByKey.get(citationButton.dataset.copyCitation ?? "");
      if (body) void copyCitationDetails(body, citationButton);
      return;
    }
    const relatedButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-related-key]");
    if (!relatedButton) return;
    void selectBodyByKey(relatedButton.dataset.relatedKey ?? "", { center: true, animate: true });
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = (button.dataset.tab as AtlasTab) ?? "catalog";
      setActiveTab(activeTab === tab && tab !== "catalog" ? null : tab);
    });
  });

  closePanel.addEventListener("click", () => {
    if (activeTab === "object") clearSelectedObject();
    else setActiveTab(null);
  });
  workspaceSearchLink.addEventListener("click", () => setActiveTab("catalog"));
  mobileScaleToggle?.addEventListener("click", () => {
    const isExpanded = mapHud.classList.toggle("scale-expanded");
    mobileScaleToggle.setAttribute("aria-expanded", String(isExpanded));
    mobileScaleToggle.setAttribute("aria-label", isExpanded ? t("scale.collapse") : t("scale.expand"));
  });

  const handleBodyFilterClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    if (!button) return;
    activeFilter = (button.dataset.bodyFilter as BodyFilter) ?? "all";
    trackAnalytics("filter", { filter: activeFilter });
    activeGuidedSetId = null;
    bodySearch.value = "";
    resetPickerSearchState(catalogSearchState, { preserveActiveOption: true });
    cancelCatalogPointRequest();
    clearCatalogPointTiles(false);
    updateExploreDomains();
    updateBodyFilters();
    updateGuidedSets();
    updateStats();
    void updateBodyPicker();
    requestRender({ data: true });
    pushCurrentViewState();
  };
  bodyFilterButtons.addEventListener("click", handleBodyFilterClick);
  mapFilterButtons.addEventListener("click", handleBodyFilterClick);

  exploreDomains.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-explore-domain]");
    if (!button) return;
    applyExploreDomain(button.dataset.exploreDomain ?? "");
  });

  bodyPicker.addEventListener("click", (event) => {
    const loadMoreButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-picker-load-more]");
    if (loadMoreButton) {
      void loadMoreSearchResults("catalog");
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-key]");
    if (!button) return;
    void selectBodyByKey(button.dataset.bodyKey ?? "", { center: true });
  });

  guidedTours.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tour-id]");
    if (!button) return;
    const tour = GUIDED_SETS.find((item) => item.id === button.dataset.tourId);
    if (!tour) return;
    trackAnalytics("tour_started", { tour: tour.id });
    const bodies = tour.keys.map((key) => bodyByKey.get(key)).filter(isPresent);
    if (bodies.length === 0) return;
    activeGuidedSetId = tour.id;
    activeFilter = "all";
    bodySearch.value = "";
    resetPickerSearchState(catalogSearchState);
    fitBodies(bodies, 0.2);
    setActiveTab("catalog");
    updateExploreDomains();
    updateBodyFilters();
    updateGuidedSets();
    void updateBodyPicker();
    updateScaleUi();
    requestRender({ data: true });
  });

  centerSelected.addEventListener("click", () => centerOnSelected(false));
  zoomSelected.addEventListener("click", () => centerOnSelected(true));

  compareSearch.addEventListener("input", () => {
    resetPickerSearchState(compareSearchState);
    renderPickerStatus(comparePicker, t("search.loading"), "updating");
    scheduleComparePickerUpdate();
  });

  compareSearch.addEventListener("keydown", (event) => {
    if (
      handlePickerKeyboard(event, {
        state: compareSearchState,
        input: compareSearch,
        picker: comparePicker,
        onSelect: (key) => void setCompareTargetByKey(key),
        onFallbackEnter: () => void focusCompareResult(),
        onEscapeClear: () => void updateComparePicker()
      })
    ) {
      event.preventDefault();
    }
  });

  compareFocus.addEventListener("click", () => {
    void focusCompareResult();
  });

  compareFilterButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    if (!button) return;
    activeCompareFilter = (button.dataset.bodyFilter as BodyFilter) ?? "all";
    trackAnalytics("filter", { filter: activeCompareFilter });
    compareSearch.value = "";
    resetPickerSearchState(compareSearchState, { preserveActiveOption: true });
    updateCompareFilters();
    void updateComparePicker();
  });

  comparePicker.addEventListener("click", (event) => {
    const loadMoreButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-picker-load-more]");
    if (loadMoreButton) {
      void loadMoreSearchResults("compare");
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-key]");
    if (!button) return;
    void setCompareTargetByKey(button.dataset.bodyKey ?? "");
  });

  clearCompare.addEventListener("click", () => {
    compareTargetKey = null;
    compareSearch.value = "";
    resetPickerSearchState(compareSearchState);
    activeCompareFilter = "all";
    void updateComparePicker();
    updateCompareFilters();
    updateComparePanel();
    requestRender();
    pushCurrentViewState();
  });

  timeNow.addEventListener("click", () => {
    timeInput.value = toDatetimeLocalValue(new Date());
    viewTime = "now";
    void loadAtlas();
  });

  applyTime.addEventListener("click", () => {
    const date = dateFromInput();
    if (date) void loadAtlas(date.toISOString());
  });

  timeStepSlider.addEventListener("input", updateTimeStepUi);
  timeStepBack.addEventListener("click", () => {
    stepTime(-1);
  });
  timeStepForward.addEventListener("click", () => {
    stepTime(1);
  });

  zoomPresets.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-zoom-preset]");
    if (!button) return;
    applyZoomPreset((button.dataset.zoomPreset as ZoomPreset) ?? "solar");
  });

  zoomOut.addEventListener("click", () => zoomViewportCenter(1 / 2.4));
  zoomIn.addEventListener("click", () => zoomViewportCenter(2.4));
  zoomScaleSlider.addEventListener("input", () => setZoomFromSlider());

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
    scheduleViewStateReplace();
  });

  diagnosticsToggle.addEventListener("change", () => {
    perfEnabled = diagnosticsToggle.checked;
    window.localStorage.setItem("starsmap:perf", perfEnabled ? "1" : "0");
    updatePerfHud();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!embedActivated) return;
    cancelCameraAnimation();
    const point = eventToCanvasPoint(event);
    activeMapPointers.set(event.pointerId, point);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events and interrupted gestures may not have an active capture target.
    }

    if (activeMapPointers.size >= 2) {
      pinchGesture = currentPinchGesture();
      mapGestureHadPinch = true;
      mapDragMoved = true;
      mapDragging = false;
      dragStart = null;
      dragCameraStart = null;
      hoverKey = null;
      hideCatalogPointHover();
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }

    mapGestureHadPinch = false;
    mapDragging = true;
    mapDragMoved = false;
    dragStart = { x: event.clientX, y: event.clientY };
    dragCameraStart = { ...camera };
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = eventToCanvasPoint(event);
    const previousHoverKey = hoverKey;
    if (activeMapPointers.has(event.pointerId)) {
      activeMapPointers.set(event.pointerId, point);
    }

    if (activeMapPointers.size >= 2) {
      const nextPinch = currentPinchGesture();
      if (nextPinch && pinchGesture) {
        const dx = nextPinch.midpoint.x - pinchGesture.midpoint.x;
        const dy = nextPinch.midpoint.y - pinchGesture.midpoint.y;
        camera.xAu -= dx / camera.pxPerAu;
        camera.yAu += dy / camera.pxPerAu;
        const factor = nextPinch.distance / Math.max(0.001, pinchGesture.distance);
        if (Number.isFinite(factor) && factor > 0) zoomAt(nextPinch.midpoint.x, nextPinch.midpoint.y, factor, true, "none");
      }
      pinchGesture = nextPinch;
      mapGestureHadPinch = true;
      mapDragMoved = true;
      hoverKey = null;
      hideCatalogPointHover();
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }

    if (mapDragging && dragStart && dragCameraStart) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 3) mapDragMoved = true;
      camera = {
        ...camera,
        xAu: dragCameraStart.xAu - dx / camera.pxPerAu,
        yAu: dragCameraStart.yAu + dy / camera.pxPerAu
      };
      hoverKey = null;
      hideCatalogPointHover();
      canvas.style.cursor = "grabbing";
      requestRender();
      return;
    }

    const edgeReference = edgeReferenceAt(point.x, point.y);
    const nearest = edgeReference ? null : nearestBodyAt(point.x, point.y);
    const catalogPoint = edgeReference || nearest ? null : nearestCatalogTilePointAt(point.x, point.y);
    hoverKey = edgeReference?.body.key ?? nearest?.body.key ?? null;
    if (catalogPoint) showCatalogPointHover(catalogPoint);
    else hideCatalogPointHover();
    canvas.style.cursor = edgeReference || nearest || catalogPoint ? "pointer" : "grab";
    if (previousHoverKey !== hoverKey) requestRender();
  });

  const finishMapPointer = (event: PointerEvent, releaseCapture = true) => {
    const pointerWasActive = activeMapPointers.delete(event.pointerId);
    if (releaseCapture) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Capture can already be gone after interrupted or synthetic pointer sequences.
      }
    }

    if (!pointerWasActive) return;
    if (activeMapPointers.size >= 2) {
      pinchGesture = currentPinchGesture();
      return;
    }
    if (activeMapPointers.size === 1) {
      const remaining = activeMapPointers.values().next().value as ScreenPoint;
      pinchGesture = null;
      mapDragging = true;
      dragStart = { ...remaining };
      dragCameraStart = { ...camera };
      return;
    }

    const completedPinch = mapGestureHadPinch;
    mapDragging = false;
    pinchGesture = null;
    const point = eventToCanvasPoint(event);
    if (event.type === "pointerup" && !mapDragMoved && !completedPinch) void handleMapClick(point);
    else requestRender({ data: true });
    canvas.style.cursor = hoverKey || catalogPointHover.dataset.visible === "true" ? "pointer" : "grab";
    dragStart = null;
    dragCameraStart = null;
    mapGestureHadPinch = false;
    scheduleViewStateReplace();
  };

  canvas.addEventListener("pointerup", (event) => finishMapPointer(event));
  canvas.addEventListener("pointercancel", (event) => finishMapPointer(event));
  canvas.addEventListener("lostpointercapture", (event) => finishMapPointer(event, false));

  canvas.addEventListener("pointerleave", () => {
    hideCatalogPointHover();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!embedActivated) return;
      event.preventDefault();
      const point = eventToCanvasPoint(event);
      const wheelFactor = clamp(Math.exp(-event.deltaY * 0.004), 0.32, 3.2);
      zoomAt(point.x, point.y, wheelFactor, true, "deferred");
    },
    { passive: false }
  );
}

function initializeEmbedMode() {
  document.body.dataset.atlasMode = "embed";
  document.body.dataset.embedActive = "false";
  canvas.tabIndex = 0;
  embedActivation.hidden = false;
  embedAttribution.hidden = false;
  updateEmbedAttribution();
  trackAnalytics("embed_loaded");
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(([entry]) => {
    const visible = Boolean(entry?.isIntersecting);
    if (visible === embedVisible) return;
    embedVisible = visible;
    document.body.dataset.embedVisible = String(visible);
    if (!visible) {
      cancelCameraAnimation();
      cancelCatalogPointRequest();
      for (const timer of [cameraDataRefreshTimer, viewportCatalogTimer, catalogDensityTimer]) {
        if (timer !== null) window.clearTimeout(timer);
      }
      cameraDataRefreshTimer = null;
      viewportCatalogTimer = null;
      catalogDensityTimer = null;
      viewportCatalogRequestId += 1;
      catalogDensityRequestId += 1;
      if (renderFrameId !== null) cancelAnimationFrame(renderFrameId);
      renderFrameId = null;
      renderRequested = false;
      return;
    }
    requestRender({ data: true });
  }, { threshold: 0.01 });
  observer.observe(document.querySelector("#app")!);
}

function activateEmbedInteraction() {
  if (!isEmbedMode || embedActivated) return;
  embedActivated = true;
  document.body.dataset.embedActive = "true";
  embedActivation.hidden = true;
  embedActivation.setAttribute("aria-pressed", "true");
  canvas.focus({ preventScroll: true });
}

function canonicalViewUrl() {
  const url = new URL("/", window.location.origin);
  url.search = encodeViewState(currentViewState());
  return url.toString();
}

function updateEmbedAttribution() {
  if (!isEmbedMode) return;
  const selected = selectedKey ? bodyByKey.get(selectedKey) : null;
  embedViewName.textContent = selected?.name ?? t("launch.openFullAtlas");
  if (selected) {
    const url = new URL(`/o/${encodeURIComponent(selected.key)}`, window.location.origin);
    url.search = encodeViewState(currentViewState());
    embedCanonicalLink.href = url.toString();
  } else {
    embedCanonicalLink.href = canonicalViewUrl();
  }
}

async function copyEmbedSnippet() {
  const url = new URL("/embed", window.location.origin);
  url.search = encodeViewState(currentViewState());
  const title = selectedKey && bodyByKey.get(selectedKey) ? `Cosmic Atlas · ${bodyByKey.get(selectedKey)!.name}` : t("launch.iframeTitle");
  const snippet = `<iframe src="${escapeHtmlAttribute(url.toString())}" width="960" height="600" loading="lazy" title="${escapeHtmlAttribute(title)}"></iframe>`;
  try {
    await navigator.clipboard.writeText(snippet);
    embedFeedback.textContent = t("launch.iframeCopied");
    trackEvent("share", { method: "embed" });
  } catch {
    embedFeedback.textContent = t("launch.iframeCopyFailed");
  }
  window.setTimeout(() => { embedFeedback.textContent = ""; }, 2500);
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function exportCurrentView() {
  const limits = pointRenderer.getExportLimits();
  if (!limits) {
    exportStatus.textContent = t("launch.webglRequired");
    return;
  }
  const tier = exportResolution.value;
  const requestedWidth = tier === "8k" ? 8000 : tier === "4k" ? 3840 : canvas.width;
  exportButton.disabled = true;
  exportResolution.disabled = true;
  exportStatus.textContent = t("launch.preparingImage");
  try {
    // Ensure all currently active sources are uploaded immediately before the
    // private framebuffer pass. The visible canvas itself is never read.
    drawWebglPointLayers();
    const blob = await composeAtlasPng({
      width: requestedWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      maxTileSize: limits.maxTileSize,
      overlay: canvas,
      provenance: {
        centerXAu: camera.xAu,
        centerYAu: camera.yAu,
        pxPerAu: camera.pxPerAu,
        epoch: ephemeris?.timestamp_utc ?? "unknown",
        catalogVersion: catalogPointTileManifest?.version ?? "unknown",
        attribution: "Catalog data: ESA/Gaia/DPAC · DESI DR1 · Quaia · NASA/JPL · SIMBAD/CDS"
      },
      renderPoints: (tile) => pointRenderer.exportPixels({
        camera: tile.camera,
        centerX: tile.width / (2 * tile.scale),
        centerY: tile.height / (2 * tile.scale),
        width: tile.width,
        height: tile.height,
        dpr: tile.scale,
        clip: { left: 0, top: 0, right: tile.width / tile.scale, bottom: tile.height / tile.scale }
      }),
      onProgress: (complete, total) => {
        exportStatus.textContent = t("launch.renderingImage", { percent: Math.round(complete / total * 100) });
      }
    });
    exportStatus.dataset.provenance = `${catalogPointTileManifest?.version ?? "unknown"}|${ephemeris?.timestamp_utc ?? "unknown"}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cosmic-atlas-${tier}-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    exportStatus.textContent = t("launch.pngDownloaded");
    trackEvent("export", { resolution_tier: tier });
  } catch (error) {
    exportStatus.textContent = error instanceof Error ? error.message : t("launch.exportFailed");
  } finally {
    exportButton.disabled = false;
    exportResolution.disabled = false;
    requestRender();
  }
}

function applyDecodedViewStateFields(state: ViewState) {
  camera = { xAu: state.center.x, yAu: state.center.y, pxPerAu: clamp(state.zoom, MIN_ZOOM, MAX_ZOOM) };
  viewTime = state.time;
  requestedCatalogRelease = state.catalogRelease;
  activeZoomPreset = null;
  for (const layer of DISPLAY_LAYERS) if (state.layers[layer] !== undefined) displayLayers[layer] = state.layers[layer];
  if (state.filters) {
    activeFilter = state.filters.primary;
    activeCompareFilter = state.filters.compare;
  }
  selectedKey = state.compare?.[0] ?? state.objectKey ?? "";
  compareTargetKey = state.compare?.[1] ?? null;
}

function currentViewState(): ViewState {
  const stableSelectedKey = selectedKey && selectedKey !== transientSelectedKey ? selectedKey : "";
  return {
    center: { x: camera.xAu, y: camera.yAu }, zoom: camera.pxPerAu, time: viewTime,
    objectKey: stableSelectedKey || undefined,
    compare: stableSelectedKey && compareTargetKey ? [stableSelectedKey, compareTargetKey] : undefined,
    catalogRelease: catalogPointTileManifest?.version ?? requestedCatalogRelease,
    layers: { ...displayLayers }, filters: { primary: activeFilter, compare: activeCompareFilter }
  };
}

function currentViewUrl() {
  const params = new URLSearchParams(encodeViewState(currentViewState()));
  const existing = new URLSearchParams(window.location.search);
  for (const name of ["perf", "dynamicPointFallback"]) {
    const value = existing.get(name);
    if (value !== null) params.set(name, value);
  }
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

function replaceCurrentViewState() {
  if (!historyRestoreInProgress && ephemeris && !new URLSearchParams(window.location.search).has("tour")) history.replaceState(null, "", currentViewUrl());
}

function scheduleViewStateReplace() {
  if (historyRestoreInProgress || new URLSearchParams(window.location.search).has("tour")) return;
  if (viewStateReplaceTimer !== null) window.clearTimeout(viewStateReplaceTimer);
  viewStateReplaceTimer = window.setTimeout(() => { viewStateReplaceTimer = null; replaceCurrentViewState(); }, 300);
}

function pushCurrentViewState() {
  if (historyRestoreInProgress || !ephemeris) return;
  if (viewStateReplaceTimer !== null) window.clearTimeout(viewStateReplaceTimer);
  viewStateReplaceTimer = null;
  history.pushState(null, "", currentViewUrl());
}

async function restoreSelectionFromViewState(state: ViewState) {
  const selected = state.compare?.[0] ?? state.objectKey;
  if (selected) await selectBodyByKey(selected);
  if (state.compare?.[1]) await setCompareTargetByKey(state.compare[1]);
}

async function restoreViewState(state: ViewState) {
  historyRestoreInProgress = true;
  if (viewStateReplaceTimer !== null) window.clearTimeout(viewStateReplaceTimer);
  viewStateReplaceTimer = null;
  const oldTime = viewTime;
  applyDecodedViewStateFields(state);
  pendingSelectionState = state;
  updateAllUi();
  requestRender({ data: true });
  if (oldTime !== state.time) await loadAtlas(state.time === "now" ? undefined : state.time);
  else { pendingSelectionState = null; await restoreSelectionFromViewState(state); }
  historyRestoreInProgress = false;
}

function startBootTour() {
  if (tourBootHandled || isEmbedMode) return;
  const params = new URLSearchParams(window.location.search), slug = params.get("tour");
  if (!slug) return;
  tourBootHandled = true;
  const step = Number(params.get("step") ?? "0");
  void tourPlayer.start(slug, Number.isSafeInteger(step) && step >= 0 ? step : 0);
}

async function navigateTourStep(state: ViewState, options: { animate: boolean; slug: string; step: number; restoring: boolean; signal: AbortSignal }) {
  if (options.restoring) historyRestoreInProgress = true;
  const start = { ...camera };
  applyDecodedViewStateFields(state);
  const target = { ...camera };
  if (options.animate) { camera = start; await new Promise<void>((resolve) => animateCameraTo(target, LOCAL_ZOOM_DURATION_MS, resolve)); }
  else { camera = target; updateScaleUi(); requestRender({ data: true }); }
  if (options.signal.aborted) { if (options.restoring) historyRestoreInProgress = false; return; }
  await restoreSelectionFromViewState(state);
  if (options.signal.aborted) { if (options.restoring) historyRestoreInProgress = false; return; }
  const params = new URLSearchParams(encodeViewState({ ...state, tour: options.slug, step: options.step }));
  const perf = new URLSearchParams(window.location.search).get("perf"); if (perf !== null) params.set("perf", perf);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (!options.restoring) history.pushState(null, "", url); else history.replaceState(null, "", url);
  requestDataRefresh({ immediate: true });
  if (options.restoring) historyRestoreInProgress = false;
}

function prewarmTourStep(state: ViewState) {
  if (!ephemeris || catalogPointTileManifestState !== "ready" || !catalogPointSignature || isEmbedMode) return;
  const previous = camera; camera = { xAu: state.center.x, yAu: state.center.y, pxPerAu: clamp(state.zoom, MIN_ZOOM, MAX_ZOOM) };
  const target = prioritizeCatalogPointRequests(catalogPointRequests()).slice(0, POINT_TILE_PREFETCH_MAX_REQUESTS); camera = previous;
  if (!target.length) return;
  const signature = `${catalogPointSignature}::prefetch::tour::${target.map((request) => request.key).join("|")}`;
  catalogPointPrefetchSignature = signature; void loadCatalogPointPrefetchTiles(target, signature);
}

async function shareCurrentView(preferNative: boolean) {
  replaceCurrentViewState();
  try {
    if (preferNative && navigator.share) {
      await navigator.share({ title: document.title, url: window.location.href });
      shareFeedback.textContent = t("launch.linkShared");
      trackEvent("share", { method: "native" });
    } else {
      await navigator.clipboard.writeText(window.location.href);
      shareFeedback.textContent = t("launch.linkCopied");
      trackEvent("share", { method: "clipboard" });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    shareFeedback.textContent = t("launch.shareFailed");
  }
  window.setTimeout(() => { shareFeedback.textContent = ""; }, 2500);
}

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

function smp3SourceIdFixture() {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setBigUint64(0, 5_931_842_930_184_739_845n, true);
  return {
    range: smp3SourceIdRange(1_000, 32 + 3 * 8 + 3 * 8, 3, 2, 1),
    sourceId: decodeSmp3SourceId(bytes),
    absent: smp3SourceIdRange(1_000, 80, 3, 2, 0)
  };
}

async function webglClipFixture() {
  const fixtureCanvas = document.createElement("canvas");
  const renderer = new WebglPointRenderer(fixtureCanvas);
  if (!renderer.available) return null;
  renderer.setSize(200, 200);
  renderer.setLayer("fixture", { kind: "rich", signature: "clip-fixture", vertices: new Float32Array([0, 0, 1, 1, 1, 30]), count: 1 });
  const stats = renderer.render({ camera: { xAu: 0, yAu: 0, pxPerAu: 1 }, centerX: 100, centerY: 100, width: 200, height: 200, dpr: 1, clip: { left: 75, top: 75, right: 125, bottom: 125 }, measurePixels: true });
  const gl = fixtureCanvas.getContext("webgl2") ?? fixtureCanvas.getContext("webgl");
  if (!gl) return null;
  const center = new Uint8Array(4), outside = new Uint8Array(4);
  gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
  gl.readPixels(60, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, outside);
  const preserveDrawingBuffer = gl.getContextAttributes()?.preserveDrawingBuffer ?? null;
  const loseContext = gl.getExtension("WEBGL_lose_context");
  if (loseContext) { const unavailable = new Promise<void>((resolve) => fixtureCanvas.addEventListener("point-renderer-unavailable", () => resolve(), { once: true })); loseContext.loseContext(); await unavailable; }
  return { centerAlpha: center[3]!, outsideAlpha: outside[3]!, pointsInViewport: stats.pointsInViewport, occupiedPixels: stats.occupiedPixels, preserveDrawingBuffer, contextLossFallback: loseContext ? !renderer.available : null };
}

function selectionGeometry() {
  const body = selectedBody();
  const usable = computeUsableViewportRect();
  const workspaceRect = workspacePanel.hidden ? null : workspacePanel.getBoundingClientRect();
  return {
    selected: body ? bodyToScreen(body) : null,
    usable,
    workspaceTop: workspaceRect?.top ?? null,
    camera: { ...camera }
  };
}

function bodyScreen(key: string) {
  const body = bodyByKey.get(key);
  return body ? bodyToScreen(body) : null;
}

function gestureState() {
  return { activePointerIds: Array.from(activeMapPointers.keys()), hadPinch: mapGestureHadPinch };
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
  updateBodyInfo();
  updateCompareUi();
  updateTimeSummary();
  updateTimeStepUi();
  updateSizeModes();
  updateDisplayToggles();
  updateContextModeStatus();
  updateScaleUi();
  updateSelectedPanelMetrics();
  updateEmbedAttribution();
}

function render() {
  const frameStartedAt = performance.now();
  const previousFrameAt = perfLastFrameAt;
  perfLastFrameAt = frameStartedAt;
  perfFrameMs = frameStartedAt - previousFrameAt;
  renderFrameId = null;
  renderRequested = false;
  visibleBodiesFrameCache = null;
  bodyHitGridValid = false;
  catalogPointHitGridValid = false;
  resizeCanvas();
  usableViewportRectCache = computeUsableViewportRect();
  const dpr = renderScale();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  try {
    if (ephemeris) {
      drawWebglPointLayers();
      if (displayLayers.milkyWay) drawMilkyWayLayer();
      if (displayLayers.grid) drawGrid();
      if (displayLayers.orbits) drawOrbitGuides();
      drawComparisonGuide();
      drawBodies();
      if (displayLayers.labels) drawLabels();
      if (displayLayers.references) drawEdgeReferences();
    } else {
      pointRenderer.clear();
    }
  } finally {
    usableViewportRectCache = null;
  }
  perfDrawMs = performance.now() - frameStartedAt;
  updatePerfHud();
  updateScienceLayerDisclosure();
}

function requestRender(options: RenderRequestOptions = {}) {
  if (isEmbedMode && !embedVisible) return;
  renderRequested = true;
  visibleBodiesFrameCache = null;
  bodyHitGridValid = false;
  catalogPointHitGridValid = false;
  if (options.data) requestDataRefresh();
  if (renderFrameId !== null) return;
  renderFrameId = requestAnimationFrame(render);
}

function requestDataRefresh(options: DataRefreshOptions = {}) {
  if (isEmbedMode && !embedVisible) return;
  if (cameraDataRefreshTimer !== null) {
    window.clearTimeout(cameraDataRefreshTimer);
    cameraDataRefreshTimer = null;
  }
  scheduleViewportCatalogLoad(options);
  scheduleCatalogPointLoad(options);
}

function scheduleCameraDataRefresh() {
  if (cameraDataRefreshTimer !== null) window.clearTimeout(cameraDataRefreshTimer);
  cameraDataRefreshTimer = window.setTimeout(() => {
    cameraDataRefreshTimer = null;
    requestDataRefresh();
  }, CAMERA_DATA_REFRESH_DEBOUNCE_MS);
  scheduleViewStateReplace();
}

function drawWebglPointLayers() {
  if (!pointRenderer.available) {
    drawCatalogPointLayer2dFallback();
    return;
  }

  const rect = usableViewportRect();
  const pointBodies = webglBodyPointLayerSource();
  const uploadStartedAt = performance.now();
  pointRenderer.setLayer("bodies", pointBodies);

  const nextCatalogLayerIds = new Set<string>();
  for (const tile of activeCatalogPointTiles()) {
    if (!tile.source) continue;
    pointRenderer.setLayer(tile.request.layerId, tile.source);
    nextCatalogLayerIds.add(tile.request.layerId);
  }
  for (const layerId of renderedCatalogPointLayerIds) {
    if (!nextCatalogLayerIds.has(layerId)) pointRenderer.setLayer(layerId, null);
  }
  renderedCatalogPointLayerIds = nextCatalogLayerIds;
  perfBufferMs = performance.now() - uploadStartedAt;

  const renderStartedAt = performance.now();
  const measurePixels = perfEnabled && renderStartedAt - perfLastPointMeasureAt >= PERF_POINT_MEASURE_INTERVAL_MS;
  const measureViewport = measurePixels || catalogViewportMeasurePending;
  if (measurePixels) perfLastPointMeasureAt = renderStartedAt;
  perfPointRendererStats = pointRenderer.render({
    camera,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width: pointCanvas.width,
    height: pointCanvas.height,
    dpr: renderScale(),
    clip: rect,
    measureViewport,
    measurePixels
  });
  if (catalogViewportMeasurePending) {
    catalogViewportMeasurePending = false;
    catalogPointsInViewport = Math.max(0, perfPointRendererStats.pointsInViewport - richPointLayerPointsInViewport(pointBodies, rect));
    updateStats();
  }
  if (!pointRenderer.available) {
    drawCatalogPointLayer2dFallback();
    return;
  }
  perfWebglMs = performance.now() - renderStartedAt;
  perfWebglEmaMs = perfWebglEmaMs === 0 ? perfWebglMs : perfWebglEmaMs * 0.9 + perfWebglMs * 0.1;
}

function richPointLayerPointsInViewport(source: PointLayerSource | null, rect: Rect) {
  if (!source || source.kind !== "rich") return 0;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let visible = 0;
  for (let index = 0; index < source.count; index += 1) {
    const offset = index * 6;
    const x = centerX + ((source.vertices[offset] ?? 0) - camera.xAu) * camera.pxPerAu;
    const y = centerY - ((source.vertices[offset + 1] ?? 0) - camera.yAu) * camera.pxPerAu;
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) visible += 1;
  }
  return visible;
}

function webglBodyPointLayerSource(): PointLayerSource | null {
  const catalogLayerReady = hasActiveCatalogPointLayer();
  const selected = selectedBody();
  const bodies = visibleBodies().filter((body) => {
    const selectedOrHover = body.key === selected?.key || body.key === hoverKey;
    return !selectedOrHover && (!catalogLayerReady || !isPointLayerDuplicateBody(body));
  });
  if (bodies.length === 0) return null;
  const signature = `bodies:${ephemeris?.timestamp_utc ?? ""}:${selectedKey}:${hoverKey}:${bodies.map((body) => body.key).join("|")}`;
  if (bodyPointLayerCache?.signature === signature) return bodyPointLayerCache;

  const vertices = new Float32Array(bodies.length * 6);
  bodies.forEach((body, index) => {
    const [red, green, blue] = rgbForCatalogPoint(body.color ?? null);
    const offset = index * 6;
    vertices[offset] = body.position.x_au;
    vertices[offset + 1] = body.position.y_au;
    vertices[offset + 2] = red / 255;
    vertices[offset + 3] = green / 255;
    vertices[offset + 4] = blue / 255;
    vertices[offset + 5] = bodyRadiusAu(body);
  });

  bodyPointLayerCache = {
    kind: "rich",
    signature,
    vertices,
    count: bodies.length
  };
  return bodyPointLayerCache;
}

function catalogPointLayerFromPayload(payload: CatalogPointPayload, signature: string): PointLayerSource {
  return { kind: "compact", signature, vertices: payload.vertices, count: payload.returned, origin: payload.origin, format: payload.format, blend: "source-over" };
}

function catalogPointVertexStrideFloats(payload: CatalogPointPayload) {
  return payload.format === "SMP3" ? 4 : POINT_VERTEX_STRIDE_FLOATS;
}

function catalogPointVertexStrideBytes(payload: CatalogPointPayload) {
  return catalogPointVertexStrideFloats(payload) * Float32Array.BYTES_PER_ELEMENT;
}

function drawCatalogPointLayer2dFallback() {
  const viewWidthLy = currentViewWidthLy();
  const filterParams = catalogPointFilterParams();
  if (!filterParams || !shouldUseCatalogPoints(viewWidthLy, filterParams)) {
    return;
  }

  const rect = usableViewportRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const pxPerAu = camera.pxPerAu;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  let pointsInViewport = 0;

  for (const tile of activeCatalogPointTiles()) {
    const layer = tile.payload;
    if (!layer || layer.returned === 0) continue;
    const originX = layer.origin.x;
    const originY = layer.origin.y;
    const strideFloats = catalogPointVertexStrideFloats(layer);
    const strideBytes = catalogPointVertexStrideBytes(layer);
    const colors = new Uint8Array(layer.vertices.buffer, layer.vertices.byteOffset, layer.returned * strideBytes);
    for (let index = 0; index < layer.returned; index += 1) {
      const floatOffset = index * strideFloats;
      const xAu = originX + (layer.vertices[floatOffset] ?? 0);
      const yAu = originY + (layer.vertices[floatOffset + 1] ?? 0);
      const x = Math.round(centerX + (xAu - camera.xAu) * pxPerAu);
      const y = Math.round(centerY - (yAu - camera.yAu) * pxPerAu);
      if (x < 0 || x >= cssWidth || y < 0 || y >= cssHeight) continue;
      pointsInViewport += 1;

      const byteOffset = index * strideBytes + 8;
      const red = colors[byteOffset] ?? 204;
      const green = colors[byteOffset + 1] ?? 222;
      const blue = colors[byteOffset + 2] ?? 255;
      ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${MAP_POINT_ALPHA})`;
      ctx.beginPath();
      ctx.arc(x, y, MAP_POINT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (catalogViewportMeasurePending) {
    catalogViewportMeasurePending = false;
    catalogPointsInViewport = pointsInViewport;
    updateStats();
  }
}

function rgbForCatalogPoint(color: string | null): [number, number, number] {
  const fallback: [number, number, number] = [205, 222, 255];
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  const cached = pointColorCache.get(color);
  if (cached) return cached;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const rgb: [number, number, number] = [red, green, blue];
  pointColorCache.set(color, rgb);
  return rgb;
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

type MilkyWayHazeCache = {
  screenBlend: HTMLCanvasElement;
  sourceBlend: HTMLCanvasElement;
  cameraXAu: number;
  cameraYAu: number;
  pxPerAu: number;
  centerX: number;
  centerY: number;
  marginX: number;
  marginY: number;
  cssWidth: number;
  cssHeight: number;
  layerAlphaBucket: number;
  detailAlphaBucket: number;
  arms: boolean;
  dust: boolean;
};

const MILKY_WAY_HAZE_MARGIN_RATIO = 0.25;
const CACHED_OVERLAY_ZOOM_DRIFT_LOG2 = Math.log2(1.2);
let milkyWayHazeCache: MilkyWayHazeCache | null = null;

function drawMilkyWayLayer() {
  const startedAt = performance.now();
  const viewWidthLy = currentViewWidthLy();
  if (viewWidthLy < 500) return;

  const rect = expandedRect(usableViewportRect(), 220);
  const layerAlpha = clamp((Math.log10(viewWidthLy) - 2.7) / 1.1, 0, 1);
  const previousFrameOverBudget = perfMilkyWayMs > MILKY_WAY_DETAIL_BUDGET_MS;
  const detailAlpha = previousFrameOverBudget ? 0 : clamp((Math.log10(viewWidthLy) - 3.55) / 0.9, 0, 1);
  if (layerAlpha <= 0) return;

  const rebuiltHaze = ensureMilkyWayHazeCache(layerAlpha, detailAlpha);
  blitMilkyWayHaze();

  const occupiedLabels: Rect[] = [];
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (displayLayers.milkyWayGuides) drawGalacticReferenceGuides(layerAlpha, detailAlpha, rect, occupiedLabels);

  if (detailAlpha > 0.45) {
    for (const marker of MILKY_WAY_MODEL.markers) {
      const screen = galacticPointToScreen(marker.point);
      if (!pointInRect(screen, rect)) continue;
      ctx.globalAlpha = detailAlpha;
      ctx.setLineDash([]);
      ctx.fillStyle = marker.color;
      ctx.strokeStyle = "rgba(8, 10, 9, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawMilkyWayLabel(marker.label, screen.x + 12, screen.y - 10, "rgba(248, 218, 136, 0.92)", occupiedLabels);
    }
  }

  ctx.restore();
  if (!rebuiltHaze) perfMilkyWayMs = performance.now() - startedAt;
}

function ensureMilkyWayHazeCache(layerAlpha: number, detailAlpha: number) {
  const cssWidth = Math.floor(window.innerWidth);
  const cssHeight = Math.floor(window.innerHeight);
  const marginX = Math.ceil(cssWidth * MILKY_WAY_HAZE_MARGIN_RATIO);
  const marginY = Math.ceil(cssHeight * MILKY_WAY_HAZE_MARGIN_RATIO);
  const layerAlphaBucket = Math.round(layerAlpha * 12);
  const detailAlphaBucket = Math.round(detailAlpha * 12);
  const cache = milkyWayHazeCache;
  if (cache) {
    const zoomDrift = Math.abs(Math.log2(camera.pxPerAu / cache.pxPerAu));
    const panXPx = Math.abs(cache.cameraXAu - camera.xAu) * camera.pxPerAu;
    const panYPx = Math.abs(cache.cameraYAu - camera.yAu) * camera.pxPerAu;
    if (
      cache.cssWidth === cssWidth &&
      cache.cssHeight === cssHeight &&
      cache.arms === displayLayers.milkyWayArms &&
      cache.dust === displayLayers.milkyWayDust &&
      cache.layerAlphaBucket === layerAlphaBucket &&
      cache.detailAlphaBucket === detailAlphaBucket &&
      zoomDrift <= CACHED_OVERLAY_ZOOM_DRIFT_LOG2 &&
      panXPx <= marginX * 0.6 &&
      panYPx <= marginY * 0.6
    ) {
      return false;
    }
  }

  const fullWidth = cssWidth + marginX * 2;
  const fullHeight = cssHeight + marginY * 2;
  const screenBlend = cache?.screenBlend ?? document.createElement("canvas");
  const sourceBlend = cache?.sourceBlend ?? document.createElement("canvas");
  // The haze is low-frequency gradient content, so the cache renders at 1x
  // regardless of devicePixelRatio to keep the two offscreen layers small.
  screenBlend.width = fullWidth;
  screenBlend.height = fullHeight;
  sourceBlend.width = fullWidth;
  sourceBlend.height = fullHeight;
  const screenCtx = screenBlend.getContext("2d");
  const sourceCtx = sourceBlend.getContext("2d");
  if (!screenCtx || !sourceCtx) {
    milkyWayHazeCache = null;
    return false;
  }

  const hazeRect: Rect = {
    left: -marginX,
    top: -marginY,
    right: cssWidth + marginX,
    bottom: cssHeight + marginY,
    width: fullWidth,
    height: fullHeight
  };
  screenCtx.setTransform(1, 0, 0, 1, marginX, marginY);
  sourceCtx.setTransform(1, 0, 0, 1, marginX, marginY);
  screenCtx.lineJoin = "round";
  screenCtx.lineCap = "round";
  drawGalacticDisk(screenCtx, layerAlpha);
  drawGalacticCore(screenCtx, layerAlpha);
  if (displayLayers.milkyWayArms) drawGalacticArmGlow(screenCtx, detailAlpha, hazeRect);
  if (displayLayers.milkyWayDust) drawGalacticDustClouds(sourceCtx, detailAlpha, hazeRect);

  const viewport = usableViewportRect();
  milkyWayHazeCache = {
    screenBlend,
    sourceBlend,
    cameraXAu: camera.xAu,
    cameraYAu: camera.yAu,
    pxPerAu: camera.pxPerAu,
    centerX: viewport.left + viewport.width / 2,
    centerY: viewport.top + viewport.height / 2,
    marginX,
    marginY,
    cssWidth,
    cssHeight,
    layerAlphaBucket,
    detailAlphaBucket,
    arms: displayLayers.milkyWayArms,
    dust: displayLayers.milkyWayDust
  };
  return true;
}

function blitMilkyWayHaze() {
  const cache = milkyWayHazeCache;
  if (!cache) return;
  const viewport = usableViewportRect();
  const centerX = viewport.left + viewport.width / 2;
  const centerY = viewport.top + viewport.height / 2;
  const scale = camera.pxPerAu / cache.pxPerAu;
  const destX = centerX + (-cache.marginX - cache.centerX) * scale + (cache.cameraXAu - camera.xAu) * camera.pxPerAu;
  const destY = centerY + (-cache.marginY - cache.centerY) * scale + (camera.yAu - cache.cameraYAu) * camera.pxPerAu;
  const destWidth = (cache.cssWidth + cache.marginX * 2) * scale;
  const destHeight = (cache.cssHeight + cache.marginY * 2) * scale;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(cache.screenBlend, destX, destY, destWidth, destHeight);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(cache.sourceBlend, destX, destY, destWidth, destHeight);
  ctx.restore();
}

function drawGalacticDisk(target: CanvasRenderingContext2D, alpha: number) {
  const disk = MILKY_WAY_MODEL.features.find((feature) => feature.kind === "disk");
  if (!disk) return;
  const screens = disk.points.map(galacticPointToScreen);
  target.save();
  target.globalAlpha = alpha;
  target.globalCompositeOperation = "screen";
  traceScreenPath(screens, true, target);
  target.fillStyle = "rgba(213, 190, 139, 0.035)";
  target.fill();
  target.restore();
}

function drawGalacticCore(target: CanvasRenderingContext2D, alpha: number) {
  const marker = MILKY_WAY_MODEL.markers.find((item) => item.key === "galactic-center");
  if (!marker) return;
  const screen = galacticPointToScreen(marker.point);
  const radius = galacticLyToPx(10_000);
  if (radius < 1) return;
  const gradient = target.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
  gradient.addColorStop(0, `rgba(248, 218, 136, ${0.34 * alpha})`);
  gradient.addColorStop(0.28, `rgba(236, 183, 89, ${0.16 * alpha})`);
  gradient.addColorStop(0.68, `rgba(189, 101, 73, ${0.055 * alpha})`);
  gradient.addColorStop(1, "rgba(236, 183, 89, 0)");
  target.save();
  target.globalCompositeOperation = "screen";
  target.fillStyle = gradient;
  target.beginPath();
  target.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  target.fill();
  target.restore();
}

function drawGalacticDustClouds(target: CanvasRenderingContext2D, alpha: number, rect: Rect) {
  if (alpha <= 0) return;
  target.save();
  target.globalCompositeOperation = "source-over";
  for (const cloud of MILKY_WAY_MODEL.clouds) {
    const screen = galacticPointToScreen(cloud.point);
    const radius = clamp(galacticLyToPx(cloud.radiusLy), 1.8, 58);
    if (!rectsOverlap(pointRect(screen, radius * 2), rect)) continue;
    const cloudAlpha = alpha * cloud.alpha;
    const gradient = target.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
    gradient.addColorStop(0, `rgba(${cloud.color}, ${cloudAlpha})`);
    gradient.addColorStop(0.55, `rgba(${cloud.color}, ${cloudAlpha * 0.46})`);
    gradient.addColorStop(1, `rgba(${cloud.color}, 0)`);
    target.fillStyle = gradient;
    target.beginPath();
    target.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    target.fill();
  }
  target.restore();
}

// Three widening, fading strokes approximate the previous per-frame gaussian
// blur closely enough for low-alpha haze without canvas filter cost.
const SOFT_STROKE_PASSES: [number, number][] = [
  [1.7, 0.3],
  [0.85, 0.35],
  [0, 0.45]
];

function drawGalacticArmGlow(target: CanvasRenderingContext2D, alpha: number, rect: Rect) {
  if (alpha <= 0) return;
  const arms = MILKY_WAY_MODEL.features.filter((feature) => feature.kind === "arm");
  target.save();
  target.globalCompositeOperation = "screen";
  for (const feature of arms) {
    const screens = feature.points.map(galacticPointToScreen);
    if (!screenPathNearRect(screens, rect)) continue;
    const broadWidth = clamp(galacticLyToPx(3_100), 4, 34);
    const spreadPx = clamp(galacticLyToPx(1_000), 1.5, 7);
    target.setLineDash([]);
    target.strokeStyle = feature.color;
    for (const [widthScale, alphaScale] of SOFT_STROKE_PASSES) {
      target.globalAlpha = alpha * 0.11 * alphaScale;
      target.lineWidth = broadWidth + spreadPx * 2 * widthScale;
      traceScreenPath(screens, false, target);
      target.stroke();
    }
  }
  target.restore();
}

function drawGalacticReferenceGuides(alpha: number, detailAlpha: number, rect: Rect, occupiedLabels: Rect[]) {
  const viewWidthLy = currentViewWidthLy();
  if (viewWidthLy > 105_000) return;
  const guideAlpha = Math.min(alpha * 0.28, 0.2);
  ctx.save();
  for (const feature of MILKY_WAY_MODEL.features) {
    if (feature.kind !== "ring") continue;
    const screens = feature.points.map(galacticPointToScreen);
    if (!screenPathNearRect(screens, rect)) continue;
    ctx.globalAlpha = guideAlpha;
    ctx.strokeStyle = feature.color;
    ctx.lineWidth = 0.8;
    ctx.setLineDash(feature.dash ? [...feature.dash] : []);
    traceScreenPath(screens, true);
    ctx.stroke();
  }

  if (detailAlpha > 0.78 && viewWidthLy < 65_000) {
    for (const feature of MILKY_WAY_MODEL.features) {
      if (feature.kind !== "arm" || !feature.labelPoint) continue;
      drawGalacticFeatureLabel(feature, occupiedLabels);
    }
  }
  ctx.restore();
}

function drawGalacticFeatureLabel(feature: GalacticModelFeature, occupiedLabels: Rect[]) {
  if (!feature.labelPoint) return;
  const screen = galacticPointToScreen(feature.labelPoint);
  drawMilkyWayLabel(feature.label, screen.x + 8, screen.y - 8, "rgba(239, 233, 213, 0.68)", occupiedLabels);
}

function drawMilkyWayLabel(text: string, x: number, y: number, color: string, occupiedLabels: Rect[]) {
  ctx.save();
  ctx.font = "11px Inter, system-ui, sans-serif";
  const width = ctx.measureText(text).width + 12;
  const height = 22;
  const rect = { left: x - 6, top: y - 15, right: x - 6 + width, bottom: y - 15 + height, width, height };
  const bounds = usableViewportRect();
  if (!pointInRect({ x, y }, bounds) || occupiedLabels.some((item) => rectsOverlap(item, rect))) {
    ctx.restore();
    return;
  }
  occupiedLabels.push(rect);
  drawMapLabel(text, x, y, color);
  ctx.restore();
}

function galacticPointToScreen(point: GalacticModelPoint): ScreenPoint {
  return worldToScreen(point.xAu, point.yAu);
}

function galacticLyToPx(valueLy: number) {
  return lightYearsToAu(valueLy) * camera.pxPerAu;
}

function traceScreenPath(points: ScreenPoint[], closePath: boolean, target: CanvasRenderingContext2D = ctx) {
  target.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (closePath) ctx.closePath();
}

function screenPathNearRect(points: ScreenPoint[], rect: Rect) {
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (pointInRect(point, rect)) return true;
    const next = points[index + 1];
    if (!next) continue;
    const left = Math.min(point.x, next.x);
    const right = Math.max(point.x, next.x);
    const top = Math.min(point.y, next.y);
    const bottom = Math.max(point.y, next.y);
    if (right >= rect.left && left <= rect.right && bottom >= rect.top && top <= rect.bottom) return true;
  }
  return false;
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
  if (currentViewWidthAu() > 1_000) return;
  const bodies = (ephemeris?.bodies ?? []).filter((body) => bodyMatchesActiveFilter(body) && body.orbit && body.parent_key && isSolarSystemBody(body));
  const rect = expandedRect(usableViewportRect(), 160);
  ctx.save();
  for (const body of bodies) {
    const screens = orbitGuideScreens(body);
    if (!screens || !screens.some((point) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) continue;
    ctx.strokeStyle = body.key === selectedKey ? "rgba(248, 218, 136, 0.72)" : "rgba(136, 189, 166, 0.36)";
    ctx.lineWidth = body.key === selectedKey ? 1.8 : 1.15;
    ctx.beginPath();
    screens.forEach((screen, index) => {
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function orbitGuideScreens(body: Body) {
  const orbit = body.orbit;
  const parent = bodyByKey.get(body.parent_key ?? "");
  const semiMajorKm = orbit?.semi_major_axis_km;
  if (!orbit || !parent || !semiMajorKm || semiMajorKm <= 0) return null;

  const aAu = semiMajorKm / auKm();
  const eccentricity = clamp(orbit.eccentricity ?? 0, 0, 0.98);
  const pAu = aAu * (1 - eccentricity * eccentricity);
  const omega = degToRad(orbit.argument_of_periapsis_deg ?? 0);
  const inclination = degToRad(orbit.inclination_deg ?? 0);
  const ascendingNode = degToRad(orbit.longitude_of_ascending_node_deg ?? 0);
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const cosNode = Math.cos(ascendingNode);
  const sinNode = Math.sin(ascendingNode);
  const screens: ScreenPoint[] = [];

  for (let index = 0; index <= 180; index += 1) {
    const anomaly = (index / 180) * Math.PI * 2;
    const radiusAu = pAu / Math.max(0.02, 1 + eccentricity * Math.cos(anomaly));
    const orbitalX = radiusAu * Math.cos(anomaly);
    const orbitalY = radiusAu * Math.sin(anomaly);
    const argX = cosOmega * orbitalX - sinOmega * orbitalY;
    const argY = sinOmega * orbitalX + cosOmega * orbitalY;
    const inclinedY = cosInclination * argY;
    const worldX = parent.position.x_au + cosNode * argX - sinNode * inclinedY;
    const worldY = parent.position.y_au + sinNode * argX + cosNode * inclinedY;
    screens.push(worldToScreen(worldX, worldY));
  }

  return screens;
}

function drawComparisonGuide() {
  const selected = selectedBody();
  const target = compareTarget();
  if (!selected || !target) return;
  ctx.save();
  const points = [selected, target].map(bodyToScreen);
  if (points.some((point) => !pointInRect(point, expandedRect(usableViewportRect(), 80)))) return;
  ctx.strokeStyle = "rgba(236, 183, 89, 0.82)";
  ctx.fillStyle = "rgba(236, 183, 89, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.stroke();
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
    const screen = bodyToScreen(body);
    const selectedOrHover = body.key === selected?.key || body.key === hoverKey;

    if (pointRenderer.available && !selectedOrHover) continue;
    drawBodyAsCatalogPoint(body, screen, selectedOrHover);
  }
  ctx.restore();
}

function drawBodyAsCatalogPoint(body: Body, screen: ScreenPoint, selectedOrHover: boolean) {
  const color = body.color || "#d9b86f";
  const radius = bodyDisplayRadiusPx(body);

  ctx.save();
  ctx.globalAlpha = selectedOrHover ? 1 : MAP_POINT_ALPHA;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();

  if (selectedOrHover) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = body.key === selectedKey ? "rgba(248, 218, 136, 0.95)" : "rgba(177, 218, 205, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + MAP_POINT_SELECTION_RING_PX, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabels() {
  const labels = prioritizedLabelBodies();
  const occupied: Rect[] = [];
  ctx.save();
  ctx.font = "12px Inter, system-ui, sans-serif";
  for (const body of labels) {
    const screen = bodyToScreen(body);
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
  const references = edgeReferenceBodies().slice(0, 8);
  const selected = selectedBody();
  const selectedScreen = selected ? bodyToScreen(selected) : null;
  const rectCenter = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  const origin = selectedScreen && pointInRect(selectedScreen, rect) ? selectedScreen : rectCenter;
  edgeReferenceHitRegions = [];

  ctx.save();
  ctx.font = "11px Inter, system-ui, sans-serif";
  for (const reference of references) {
    const edge = edgeAnchorForScreen(reference.screen, origin, rect);
    const color = reference.body.color || "#d9b86f";
    const labelRect = edgeLabelRect(reference.body.name, edge.point, edge.side, rect);
    const hitRect = expandedRect(rectUnion(labelRect, pointRect(edge.point, 16)), 4);

    drawEdgeReferenceChevron(edge.point, edge.side, color, hoverKey === reference.body.key);
    drawMapLabel(reference.body.name, labelRect.left + 6, labelRect.top + 15, hoverKey === reference.body.key ? "rgba(248, 218, 136, 0.95)" : "rgba(239, 233, 213, 0.68)");
    edgeReferenceHitRegions.push({ body: reference.body, rect: hitRect });
  }
  ctx.restore();
}

function drawEdgeReferenceChevron(point: ScreenPoint, side: EdgeSide, color: string, active: boolean) {
  const length = active ? 13 : 10;
  const spread = active ? 6 : 4.5;
  const direction =
    side === "left"
      ? { x: 1, y: 0 }
      : side === "right"
        ? { x: -1, y: 0 }
        : side === "top"
          ? { x: 0, y: 1 }
          : { x: 0, y: -1 };
  const normal = { x: -direction.y, y: direction.x };
  const tip = { x: point.x + direction.x * length, y: point.y + direction.y * length };

  ctx.save();
  ctx.strokeStyle = active ? "rgba(248, 218, 136, 0.95)" : `${color}cc`;
  ctx.lineWidth = active ? 2.4 : 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(point.x + normal.x * spread, point.y + normal.y * spread);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(point.x - normal.x * spread, point.y - normal.y * spread);
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
  const catalogTotal = catalogSummary?.object_count ?? ephemeris.catalog?.object_count ?? ephemeris.bodies.length;
  const mapped = mappedCatalogStats();
  const pointLayerShown = catalogPointsInViewport ?? 0;
  const representedTotal = visibleBodies().length + pointLayerShown;
  const mappedTitle = mapped.total > 0
    ? t("status.mappedBreakdown", {
        count: formatInteger(mapped.total),
        stars: formatInteger(mapped.stars),
        extragalactic: formatInteger(mapped.extragalactic),
        other: formatInteger(mapped.other)
      })
    : t("status.mappedLoading");
  atlasStats.innerHTML = `
    <div title="${escapeHtml(t("status.searchableObjects", { count: formatInteger(catalogTotal) }))}"><dt>${escapeHtml(t("status.searchable"))}</dt><dd>${formatCount(catalogTotal)}</dd></div>
    <div title="${escapeHtml(mappedTitle)}" aria-label="${escapeHtml(mappedTitle)}"><dt>${escapeHtml(t("status.mapped"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.total) : "—"}</dd></div>
    <div title="${escapeHtml(t("status.selectableObjects", { count: formatInteger(representedTotal) }))}"><dt>${escapeHtml(t("status.shown"))}</dt><dd>${formatCount(representedTotal)}</dd></div>
    <div title="${escapeHtml(t("status.mappedStars", { count: formatInteger(mapped.stars) }))}"><dt>${escapeHtml(t("status.stars"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.stars) : "—"}</dd></div>
    <div title="${escapeHtml(t("status.mappedExtragalactic", { count: formatInteger(mapped.extragalactic) }))}"><dt>${escapeHtml(t("status.extragalactic"))}</dt><dd>${mapped.total > 0 ? formatCount(mapped.extragalactic) : "—"}</dd></div>
  `;
  const representedLabel = pointLayerShown > 0 ? `${t("status.shownInline", { count: formatCount(representedTotal) })} · ` : "";
  const mappedLabel = mapped.total > 0 ? `${t("status.mappedInline", { count: formatCount(mapped.total) })} · ` : "";
  catalogCount.textContent =
    catalogTotal > ephemeris.bodies.length
      ? `${t("status.searchableInline", { count: formatCount(catalogTotal) })} · ${mappedLabel}${representedLabel}${t("status.selectableInline", { count: formatInteger(ephemeris.bodies.length) })}`
      : t("status.objects", { count: formatInteger(ephemeris.bodies.length) });
}

function mappedCatalogStats() {
  const empty = { total: 0, stars: 0, extragalactic: 0, other: 0 };
  if (!catalogPointTileManifest) return empty;
  const layers = catalogPointTileManifest.layers.filter(
    (layer) => !isStaticLayerCoveredByPreferredAggregate(layer, catalogPointTileManifest!.layers, [])
  );
  let total = 0;
  let stars = 0;
  let extragalactic = 0;
  for (const layer of layers) {
    const sourceTotal = Object.values(layer.source_counts).reduce((sum, count) => sum + count, 0);
    const finest = layer.levels[0];
    const count = sourceTotal || finest?.raw_point_count || finest?.point_count || 0;
    total += count;
    if (layer.id === "gaia_stars" || layer.types.includes("star")) stars += count;
    if (layer.types.length > 0 && layer.types.every((type) => EXTRAGALACTIC_POINT_TYPES.has(type))) extragalactic += count;
  }
  return { total, stars, extragalactic, other: Math.max(0, total - stars - extragalactic) };
}

function updatePerfHud() {
  if (!perfHud) return;
  perfHud.hidden = !perfEnabled;
  if (!perfEnabled) return;

  const loadedTiles = activeCatalogPointTiles();
  const activeTileCount = activeCatalogPointTileKeys.size;
  const loadedTileCount = loadedTiles.length;
  const activePoints = loadedTiles.reduce((sum, tile) => sum + (tile.payload?.returned ?? 0), 0);
  const declaredPoints = loadedTiles.reduce((sum, tile) => sum + (tile.payload?.declared ?? 0), 0);
  const requestedPoints = [...activeCatalogPointTileKeys].reduce((sum, key) => sum + (catalogPointTiles.get(key)?.request.limit ?? 0), 0);
  const loadingTiles = [...catalogPointTiles.values()].filter((tile) => activeCatalogPointTileKeys.has(tile.request.key) && tile.abortController).length;
  const visibleCount = visibleBodies().length;
  const fps = perfFrameMs > 0 ? 1000 / perfFrameMs : 0;
  const pointTileSource = catalogPointTileManifestState === "ready" ? "static" : catalogPointTileManifestState;

  perfHud.innerHTML = `
    <strong>Perf</strong>
    <dl>
      <dt>Frame</dt><dd>${formatCompactMs(perfDrawMs)} / ${formatCompactNumber(fps)} fps</dd>
      <dt>WebGL</dt><dd>${formatCompactMs(perfWebglMs)} render · ${formatCompactMs(perfBufferMs)} buffer</dd>
      <dt>Milky Way</dt><dd>${formatCompactMs(perfMilkyWayMs)} overlay${perfMilkyWayMs > MILKY_WAY_DETAIL_BUDGET_MS ? " · simplified" : ""}</dd>
      <dt>Pipeline</dt><dd>${formatInteger(declaredPoints)} available · ${formatInteger(requestedPoints)} requested · ${formatInteger(activePoints)} decoded</dd>
      <dt>Visible</dt><dd>${formatInteger(perfPointRendererStats.pointsInViewport)} in viewport · ${formatInteger(perfPointRendererStats.pointsDrawn)} submitted${perfPointRendererStats.capped ? " capped" : ""}</dd>
      <dt>Pixels</dt><dd>${formatInteger(perfPointRendererStats.occupiedPixels)} occupied in ${loadedTileCount}/${activeTileCount} active tiles</dd>
      <dt>Tiles</dt><dd>${pointTileSource}</dd>
      <dt>Catalog</dt><dd>${loadingTiles} loading · ${formatCompactMs(perfLastPointMs)} points · ${formatCompactMs(perfLastViewportMs)} objects</dd>
      <dt>Pressure</dt><dd>${perfPointTileQueued} queued · ${perfPointTileActiveInFlight}/${perfPointTilePrefetchInFlight} active/prefetch · ${perfPointTileAborts} aborted</dd>
      <dt>Selectable</dt><dd>${formatInteger(visibleCount)} visible · ${formatCompactMs(perfHitTestMs)} hit</dd>
      <dt>Requests</dt><dd>${perfPointTileLoads} point tiles · ${perfViewportLoads} object loads</dd>
    </dl>
  `;
}

function formatCompactMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0ms";
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
}

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
  } catch (error) {
    console.warn("Phoenix catalog summary unavailable.", error);
  }
}

function updateSelectedSummary() {
  const body = selectedBody();
  if (!body) {
    selectedObjectPanel.hidden = true;
    selectedSummaryName.textContent = "";
    selectedSummaryMeta.textContent = "";
    selectedSummaryOrb.style.setProperty("--body-color", "#d8a23f");
    centerSelected.disabled = true;
    zoomSelected.disabled = true;
    return;
  }

  selectedObjectPanel.hidden = false;
  const typeLabel = classifyBody(body).label;
  selectedSummaryName.textContent = body.name;
  selectedSummaryMeta.textContent = `${typeLabel} · ${formatDistance(body.distance_from_earth_km)} ${t("object.fromEarth")}`;
  selectedSummaryOrb.style.setProperty("--body-color", body.color || "#d8a23f");
  centerSelected.disabled = false;
  zoomSelected.disabled = false;
}

function updateSelectedPanelMetrics() {
  mapHud.classList.remove("has-selected-object");
  mapHud.style.removeProperty("--selected-panel-bottom");
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
  const hasSelectedBody = Boolean(selectedBody());
  const isSelectedObjectWorkspace = activeTab === "object" && hasSelectedBody;
  if (!hasSelectedBody && activeTab === "object") activeTab = null;
  modeRail.hidden = hasSelectedBody;
  workspacePanel.hidden = activeTab === null;
  mapHud.classList.toggle("workspace-open", activeTab !== null);
  if (activeTab) {
    mapHud.dataset.workspaceTab = activeTab;
  } else {
    delete mapHud.dataset.workspaceTab;
  }
  workspaceSearchLink.hidden = activeTab !== "object" || !hasSelectedBody;
  workspaceLabel.hidden = activeTab === "object" && hasSelectedBody;
  workspaceLabel.textContent = activeTab ? t(WORKSPACE_LABEL_KEYS[activeTab]) : t("workspace.title");
  closePanel.textContent = isSelectedObjectWorkspace ? "×" : t("workspace.close");
  closePanel.classList.toggle("workspace-close-icon", isSelectedObjectWorkspace);
  closePanel.setAttribute("aria-label", isSelectedObjectWorkspace ? t("workspace.deselectCurrent") : t("workspace.close"));
  if (isSelectedObjectWorkspace) closePanel.setAttribute("title", t("workspace.deselectCurrent"));
  else closePanel.removeAttribute("title");
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === activeTab);
    button.setAttribute("aria-pressed", String(button.dataset.tab === activeTab));
  }
  for (const panel of tabPanels) {
    panel.hidden = activeTab === null || panel.dataset.tabPanel !== activeTab;
  }
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

function updateBodyFilters() {
  const filters = renderFilterButtons(activeFilter);
  bodyFilterButtons.innerHTML = filters;
  mapFilterButtons.innerHTML = filters;
}

function updateExploreDomains() {
  const bodies = ephemeris?.bodies ?? [];
  exploreDomains.innerHTML = EXPLORE_DOMAINS.map((domain) => renderExploreDomain(domain, bodies)).join("");
}

function renderExploreDomain(domain: ExploreDomainDefinition, bodies: Body[]) {
  const count = domain.count(catalogSummary, bodies);
  const active = activeGuidedSetId === domain.guidedSetId && activeFilter === domain.filterKey;
  return `
    <button type="button" class="explore-domain-card${active ? " active" : ""}" data-explore-domain="${escapeHtml(domain.id)}" aria-pressed="${active ? "true" : "false"}">
      <span class="explore-domain-card__copy">
        <strong>${escapeHtml(t(domain.titleKey))}</strong>
        <small>${escapeHtml(t(domain.descriptionKey))}</small>
      </span>
      ${count === null ? "" : `<span class="explore-domain-card__count">${escapeHtml(t("explore.count", { count: formatCount(count) }))}</span>`}
    </button>
  `;
}

function applyExploreDomain(domainId: string) {
  const domain = EXPLORE_DOMAINS.find((item) => item.id === domainId);
  if (!domain) return;
  activeFilter = domain.filterKey;
  activeGuidedSetId = domain.guidedSetId;
  bodySearch.value = "";
  catalogSearchState.latestBodies = [];
  catalogSearchState.activeOptionKey = null;
  cancelCatalogPointRequest();
  clearCatalogPointTiles(false);
  updateExploreDomains();
  updateBodyFilters();
  updateGuidedSets();
  void updateBodyPicker();
  applyZoomPreset(domain.zoomPreset);
  setActiveTab("catalog");
  requestRender({ data: true });
}

function updateCompareFilters() {
  compareFilterButtons.innerHTML = renderFilterButtons(activeCompareFilter);
}

function renderFilterButtons(active: BodyFilter) {
  return BODY_FILTERS.map(
    (filter) => `
      <button type="button" data-body-filter="${filter.key}" class="${filter.key === active ? "active" : ""}" aria-pressed="${filter.key === active ? "true" : "false"}">
        ${escapeHtml(t(filter.labelKey))}
      </button>
    `
  ).join("");
}

function activeBodyFilterDefinition() {
  return BODY_FILTERS.find((item) => item.key === activeFilter) ?? BODY_FILTERS[0];
}

function activeCompareFilterDefinition() {
  return BODY_FILTERS.find((item) => item.key === activeCompareFilter) ?? BODY_FILTERS[0];
}

function bodyMatchesActiveFilter(body: Body) {
  return bodyMatchesFilter(body, activeBodyFilterDefinition());
}

function bodyMatchesFilter(body: Body, filter: BodyFilterDefinition) {
  if (filter.key === "all") return true;
  const matchesGroup = !filter.groups || filter.groups.includes(body.catalog_group ?? "");
  const matchesType = !filter.types || filter.types.includes(classifyBody(body).type);
  return matchesGroup && matchesType;
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

async function searchCatalog(options: { query: string; filter?: BodyFilterDefinition; limit: number; offset?: number; signal?: AbortSignal }): Promise<CatalogSearchResult> {
  const params = new URLSearchParams();
  const query = options.query.trim();
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  if (query) params.set("q", query);
  if (options.filter?.groups) params.set("groups", options.filter.groups.join(","));
  if (options.filter?.types) params.set("types", options.filter.types.join(","));
  params.set("limit", String(options.limit));
  if (offset > 0) params.set("offset", String(offset));

  try {
    const gaiaSourceId = /^Gaia\s+DR3\s+(\d+)$/i.exec(query)?.[1];
    if (gaiaSourceId && offset === 0) {
      const response = await fetch(`/api/objects/gaia/${gaiaSourceId}`, { signal: options.signal });
      if (response.ok) {
        const body = catalogObjectToBody((await response.json()) as CatalogObjectPayload);
        return { bodies: [body], source: "phoenix", total: 1, hasMore: false, nextOffset: 1 };
      }
      if (response.status !== 404) throw new Error(`Gaia hydration failed with ${response.status}`);
      return { bodies: [], source: "phoenix", total: 0, hasMore: false, nextOffset: 0 };
    }
    const response = await fetch(`/api/catalog/search?${params.toString()}`, { signal: options.signal });
    if (!response.ok) throw new Error(`Catalog search failed with ${response.status}`);
    const payload = (await response.json()) as CatalogSearchPayload;
    const bodies = Array.isArray(payload.bodies) && payload.bodies.length > 0 ? payload.bodies : (payload.objects ?? []).map(catalogObjectToBody);
    const localBodies = localCatalogSearch(options);
    const returnedCount = payload.bodies?.length ?? payload.objects?.length ?? bodies.length;
    const nextOffset = payload.has_more && returnedCount === 0 ? payload.offset + payload.limit : Math.max(offset + returnedCount, payload.offset + returnedCount);
    return {
      // Keep loaded landmark bodies (for example Mars or Jupiter) ahead of a
      // broad server page so an exact local match cannot be crowded out by
      // dozens of lower-quality substring matches.
      bodies: offset === 0 ? mergeSearchBodies(localBodies, bodies, options.limit) : bodies.slice(0, options.limit),
      source: "phoenix",
      total: payload.total,
      hasMore: payload.has_more,
      nextOffset
    };
  } catch (error) {
    if (options.signal?.aborted) return { bodies: [], source: "local" };
    console.warn("Phoenix catalog search unavailable; using loaded ephemeris catalog.", error);
    return { bodies: localCatalogSearch(options), source: "local", fallback: true };
  }
}

function mergeSearchBodies(primary: Body[], fallback: Body[], limit: number) {
  const seen = new Set<string>();
  const merged: Body[] = [];
  for (const body of [...primary, ...fallback]) {
    if (seen.has(body.key)) continue;
    seen.add(body.key);
    merged.push(body);
    if (merged.length >= limit) break;
  }
  return merged;
}

function scheduleViewportCatalogLoad(options: DataRefreshOptions = {}) {
  if (!ephemeris) return;
  const request = viewportCatalogRequest();
  if (!request) return;
  if (request.signature === viewportCatalogSignature || request.signature === viewportCatalogInFlightSignature) return;

  if (viewportCatalogTimer !== null) window.clearTimeout(viewportCatalogTimer);
  if (options.immediate) {
    viewportCatalogTimer = null;
    void loadViewportCatalog(request);
    return;
  }
  viewportCatalogTimer = window.setTimeout(() => {
    viewportCatalogTimer = null;
    void loadViewportCatalog(request);
  }, VIEWPORT_CATALOG_DEBOUNCE_MS);
}

async function loadViewportCatalog(request: { signature: string; params: URLSearchParams }) {
  if (request.signature === viewportCatalogSignature || request.signature === viewportCatalogInFlightSignature) return;
  const requestId = ++viewportCatalogRequestId;
  viewportCatalogInFlightSignature = request.signature;
  const startedAt = performance.now();

  try {
    const response = await fetch(`/api/catalog/viewport?${request.params.toString()}`);
    if (!response.ok) throw new Error(`Viewport catalog load failed with ${response.status}`);
    const payload = (await response.json()) as CatalogViewportPayload;
    if (requestId !== viewportCatalogRequestId) return;

    const bodies = payload.objects.map(catalogObjectToBody);
    const newBodies = bodies.filter((body) => !bodyByKey.has(body.key));
    viewportCatalogSignature = request.signature;
    viewportCatalogInFlightSignature = "";
    if (newBodies.length === 0) return;

    mergeBodies(newBodies);
    updateStats();
    updateGuidedSets();
    if (activeTab === "catalog" && !bodySearch.value.trim()) void updateBodyPicker();
    requestRender();
  } catch (error) {
    if (requestId === viewportCatalogRequestId) viewportCatalogInFlightSignature = "";
    console.warn("Unable to load viewport catalog objects.", error);
  } finally {
    if (requestId === viewportCatalogRequestId) {
      perfLastViewportMs = performance.now() - startedAt;
      perfViewportLoads += 1;
      updatePerfHud();
    }
  }
}

async function loadCatalogTileManifest() {
  if (catalogPointTileManifestPromise) return catalogPointTileManifestPromise;

  catalogPointTileManifestPromise = (async () => {
    try {
      // The browser-facing manifest URL is intentionally versionless. Never
      // reuse an older release from the HTTP cache; the versioned SMPK
      // containers referenced by the manifest remain immutable and cached.
      const response = await fetch(CATALOG_TILE_MANIFEST_URL, { cache: "no-store" });
      if (response.status === 404) {
        catalogPointTileManifestState = "missing";
        return;
      }
      if (!response.ok) throw new Error(`Static catalog tile manifest failed with ${response.status}`);

      const manifest = parseCatalogTileManifest(await response.json());
      if (!manifest) throw new Error("Static catalog tile manifest had an invalid shape.");
      if (manifest.format === "SMP3") await loadCatalogContainerIndexes(manifest);
      catalogPointTileManifest = manifest;
      catalogPointTileManifestState = "ready";
    } catch (error) {
      catalogPointTileManifest = null;
      catalogPointTileManifestState = "missing";
      console.warn("Static catalog point tiles unavailable.", error);
    } finally {
      updatePerfHud();
      if (ephemeris) requestDataRefresh({ immediate: true });
    }
  })();

  return catalogPointTileManifestPromise;
}

function catalogTileManifestUrl() {
  const configuredUrl = document
    .querySelector<HTMLMetaElement>('meta[name="catalog-tile-manifest-url"]')
    ?.content.trim();
  return configuredUrl || "/catalog-tiles/v1/manifest.json";
}

function dynamicPointFallbackEnabled() {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("dynamicPointFallback");
  if (queryValue === "1" || queryValue === "true") return true;
  if (queryValue === "0" || queryValue === "false") return false;
  return window.localStorage.getItem("starsmap:dynamic-point-fallback") === "1";
}

function parseCatalogTileManifest(value: unknown): CatalogPointTileManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== "SMP2" && manifest.format !== "SMP3") return null;

  const rawLayers = Array.isArray(manifest.layers)
    ? manifest.layers
    : [{ id: "default", tile_url_template: manifest.tile_url_template, groups: manifest.groups, types: [], levels: manifest.levels }];
  const layers = rawLayers.map(parseCatalogTileManifestLayer).filter(isPresent);
  if (layers.length === 0) return null;

  return {
    version: String(manifest.version ?? "v1"),
    format: manifest.format,
    color_lut: Array.isArray(manifest.color_lut)
      ? manifest.color_lut.filter((color): color is number[] => Array.isArray(color) && color.length >= 3).map((color) => color.slice(0, 3).map(Number))
      : [],
    source_counts: parseCountRecord(manifest.source_counts),
    layers
  };
}

function parseCatalogTileManifestLayer(value: unknown): CatalogPointTileManifestLayer | null {
  if (!value || typeof value !== "object") return null;
  const layer = value as Record<string, unknown>;
  const tileUrlTemplate = typeof layer.tile_url_template === "string" ? layer.tile_url_template : undefined;
  const container = typeof layer.container === "string" ? layer.container : undefined;
  if (!tileUrlTemplate && !container) return null;
  if (!Array.isArray(layer.groups) || !Array.isArray(layer.levels)) return null;

  const levels = layer.levels
    .map((level) => {
      if (!level || typeof level !== "object") return null;
      const rawLevel = level as Record<string, unknown>;
      return {
        span_log2: Number(rawLevel.span_log2),
        span_au: Number(rawLevel.span_au),
        sample_buckets: optionalNumber(rawLevel.sample_buckets),
        max_points_per_tile: optionalNumber(rawLevel.max_points_per_tile),
        tile_count: optionalNumber(rawLevel.tile_count),
        point_count: optionalNumber(rawLevel.point_count),
        raw_point_count: optionalNumber(rawLevel.raw_point_count)
      };
    })
    .filter(isPresent)
    .filter((level) => Number.isFinite(level.span_log2) && Number.isFinite(level.span_au) && level.span_au > 0)
    .sort((a, b) => a.span_au - b.span_au);

  if (levels.length === 0) return null;

  return {
    id: typeof layer.id === "string" && layer.id ? layer.id : "default",
    tile_url_template: tileUrlTemplate,
    container,
    groups: layer.groups.filter((group): group is string => typeof group === "string" && group.length > 0),
    types: Array.isArray(layer.types) ? layer.types.filter(isDestinationBodyType) : [],
    source_counts: parseCountRecord(layer.source_counts),
    levels
  };
}

function parseCountRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [key, Number(count)] as const)
      .filter(([, count]) => Number.isFinite(count) && count >= 0)
  );
}

async function loadCatalogContainerIndexes(manifest: CatalogPointTileManifest) {
  await Promise.all(manifest.layers.map(async (layer) => {
    if (!layer.container) return;
    const headerResponse = await fetch(layer.container, { headers: { Range: "bytes=0-15" }, cache: "force-cache" });
    if (!headerResponse.ok) throw new Error(`SMPK1 header failed with ${headerResponse.status}`);
    const header = new DataView(await headerResponse.arrayBuffer());
    if (header.byteLength < 16 || readAscii(header, 0, 5) !== "SMPK1") throw new Error("Catalog container had an invalid SMPK1 header.");
    const count = header.getUint32(12, true);
    const indexEnd = 16 + count * 24 - 1;
    const indexResponse = await fetch(layer.container, { headers: { Range: `bytes=16-${indexEnd}` }, cache: "force-cache" });
    if (!indexResponse.ok) throw new Error(`SMPK1 index failed with ${indexResponse.status}`);
    let indexBuffer = await indexResponse.arrayBuffer();
    if (indexResponse.status === 200) indexBuffer = indexBuffer.slice(16, indexEnd + 1);
    const index = new DataView(indexBuffer);
    if (index.byteLength < count * 24) throw new Error("Catalog container index was truncated.");
    // Keep the sorted SMPK1 index in its compact 24-byte binary form. A Map
    // would turn the Gaia T2 index's 3.85M entries into millions of strings
    // and objects, multiplying its memory footprint several times over.
    layer.containerIndex = { view: index, count };
  }));
}

function readAscii(view: DataView, offset: number, length: number) {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

function isDestinationBodyType(value: unknown): value is DestinationBodyType {
  return typeof value === "string" && normalizeDestinationType(value) === value;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function scheduleCatalogPointLoad(options: DataRefreshOptions = {}) {
  if (isEmbedMode && !embedVisible) return;
  if (!ephemeris) return;
  const requests = catalogPointRequests();
  if (requests.length === 0) {
    cancelCatalogPointRequest();
    clearCatalogPointTiles();
    perfPointTileQueued = 0;
    updatePerfHud();
    return;
  }

  const signature = requests.map((request) => request.key).join("|");
  catalogPointsInViewport = null;
  catalogViewportMeasurePending = true;
  const previousActiveKeys = activeCatalogPointTileKeys;
  activeCatalogPointTileKeys = new Set(requests.map((request) => request.key));
  catalogPointSignature = signature;
  let activeTileSetChanged = previousActiveKeys.size !== activeCatalogPointTileKeys.size;
  for (const tile of catalogPointTiles.values()) {
    if (!activeCatalogPointTileKeys.has(tile.request.key)) {
      activeTileSetChanged = true;
      tile.abortController?.abort();
      tile.abortController = undefined;
    }
  }
  if (!activeTileSetChanged) {
    for (const key of Array.from(activeCatalogPointTileKeys)) {
      if (!previousActiveKeys.has(key)) {
        activeTileSetChanged = true;
        break;
      }
    }
  }

  for (const request of requests) {
    const existing = catalogPointTiles.get(request.key);
    if (existing) {
      existing.lastUsedAt = performance.now();
      existing.request = request;
    } else {
      catalogPointTiles.set(request.key, { request, lastUsedAt: performance.now() });
    }
  }

  evictCatalogPointTiles();
  const now = performance.now();
  const missingRequests = requests.filter((request) => {
    const tile = catalogPointTiles.get(request.key);
    return tile && !tile.source && !tile.abortController && canRetryCatalogPointTile(tile, now);
  });

  const prioritizedMissingRequests = prioritizeCatalogPointRequests(missingRequests);
  perfPointTileQueued = prioritizedMissingRequests.length;
  updateStats();
  updatePerfHud();
  requestRender();
  const schedulePrefetch = () => scheduleCatalogPointPrefetch(requests, signature);
  if (missingRequests.length === 0) {
    schedulePrefetch();
    return;
  }
  if (catalogPointTimer !== null) window.clearTimeout(catalogPointTimer);
  if (options.immediate) {
    catalogPointTimer = null;
    void loadCatalogPointTiles(prioritizedMissingRequests, signature).then(schedulePrefetch);
    return;
  }
  catalogPointTimer = window.setTimeout(() => {
    catalogPointTimer = null;
    void loadCatalogPointTiles(prioritizedMissingRequests, signature).then(schedulePrefetch);
  }, VIEWPORT_CATALOG_DEBOUNCE_MS);
}

function scheduleCatalogPointPrefetch(activeRequests: CatalogPointTileRequest[], activeSignature: string) {
  if (catalogPointPrefetchTimer !== null) {
    window.clearTimeout(catalogPointPrefetchTimer);
    catalogPointPrefetchTimer = null;
  }
  if (isEmbedMode || catalogPointTileManifestState !== "ready" || activeRequests.length === 0 || activeSignature !== catalogPointSignature) return;

  const requests = catalogPointPrefetchRequests(activeRequests);
  if (requests.length === 0) return;

  const signature = `${activeSignature}::prefetch::${requests.map((request) => request.key).join("|")}`;
  if (signature === catalogPointPrefetchSignature) return;
  catalogPointPrefetchSignature = signature;
  catalogPointPrefetchTimer = window.setTimeout(() => {
    catalogPointPrefetchTimer = null;
    void loadCatalogPointPrefetchTiles(requests, signature);
  }, POINT_TILE_PREFETCH_DELAY_MS);
}

async function loadCatalogPointPrefetchTiles(requests: CatalogPointTileRequest[], signature: string) {
  if (signature !== catalogPointPrefetchSignature || !signature.startsWith(`${catalogPointSignature}::prefetch::`)) return;
  const requestId = catalogPointRequestId;
  const queue = [...requests];
  while (queue.length > 0 && requestId === catalogPointRequestId && signature === catalogPointPrefetchSignature) {
    const request = queue.shift();
    if (!request) continue;
    const tile = catalogPointTiles.get(request.key);
    if (tile?.source || tile?.abortController) continue;
    await loadCatalogPointTile({ ...request, phase: "prefetch" }, requestId);
  }
  evictCatalogPointTiles();
  if (catalogPointPrefetchSignature === signature) catalogPointPrefetchSignature = "";
}

async function loadCatalogPointTiles(requests: CatalogPointTileRequest[], signature: string) {
  const requestId = ++catalogPointRequestId;
  const startedAt = performance.now();

  const queue = prioritizeCatalogPointRequests(requests);
  perfPointTileQueued = queue.length;
  updatePerfHud();
  const workers = Array.from({ length: Math.min(POINT_TILE_FETCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && requestId === catalogPointRequestId) {
      const request = queue.shift();
      if (request) await loadCatalogPointTile(request, requestId);
    }
  });

  await Promise.all(workers);
  if (requestId === catalogPointRequestId) {
    perfPointTileQueued = 0;
    catalogViewportMeasurePending = true;
    updateStats();
  }
  perfLastPointMs = performance.now() - startedAt;
  scheduleCatalogPointRetryIfNeeded(requestId);
  requestRender();
}

async function loadCatalogPointTile(request: CatalogPointTileRequest, requestId: number) {
  let tile = catalogPointTiles.get(request.key);
  if (!tile) {
    tile = { request, lastUsedAt: performance.now() };
    catalogPointTiles.set(request.key, tile);
  }
  if (tile.source || tile.abortController) return;

  const abortController = new AbortController();
  tile.abortController = abortController;
  if (request.phase === "prefetch") perfPointTilePrefetchInFlight += 1;
  else perfPointTileActiveInFlight += 1;
  updatePerfHud();

  try {
    if (request.phase === "prefetch" && !catalogPointPrefetchSignature) {
      abortController.abort();
      return;
    }
    if (request.phase === "active" && !activeCatalogPointTileKeys.has(request.key)) {
      abortController.abort();
      return;
    }
    const requestUrl = request.staticUrl ?? `/api/catalog/points.bin?${request.params.toString()}`;
    const rangeStart = request.staticRange?.offset;
    const rangeEnd = request.staticRange
      ? Math.min(request.staticRange.offset + request.staticRange.length - 1, request.staticRange.offset + 32 + request.limit * 8 - 1)
      : undefined;
    const response = await fetch(requestUrl, {
      signal: abortController.signal,
      headers: rangeStart !== undefined && rangeEnd !== undefined ? { Range: `bytes=${rangeStart}-${rangeEnd}` } : undefined
    });
    if (request.staticUrl && (response.status === 403 || response.status === 404)) {
      // A newer load pass may have superseded this one, but a completed
      // download is still valid for this tile; discarding it strands the
      // tile as unloaded-but-unqueued until the camera changes again.
      if (abortController.signal.aborted) return;
      tile.payload = emptyCatalogPointPayload(request);
      tile.source = catalogPointLayerFromPayload(tile.payload, request.signature);
      tile.loadedAt = performance.now();
      tile.failedAt = undefined;
      tile.retryCount = 0;
      tile.lastUsedAt = tile.loadedAt;
      if (activeCatalogPointTileKeys.has(request.key)) requestRender();
      return;
    }
    if (!response.ok) throw new Error(`Catalog points failed with ${response.status}`);
    let buffer = await response.arrayBuffer();
    if (request.staticRange && response.status === 200) {
      const end = Math.min(buffer.byteLength, (rangeEnd ?? request.staticRange.offset) + 1);
      buffer = buffer.slice(request.staticRange.offset, end);
    }
    const payload = await catalogPointPayloadFromBinary(buffer, request.params, response);
    if (abortController.signal.aborted) return;

    tile.payload = payload;
    tile.source = catalogPointLayerFromPayload(payload, request.signature);
    tile.loadedAt = performance.now();
    tile.failedAt = undefined;
    tile.retryCount = 0;
    tile.lastUsedAt = tile.loadedAt;
    perfPointTileLoads += 1;
    if (activeCatalogPointTileKeys.has(request.key)) requestRender();
  } catch (error) {
    if (!abortController.signal.aborted) {
      tile.failedAt = performance.now();
      tile.retryCount = (tile.retryCount ?? 0) + 1;
      console.warn("Unable to load catalog point tile.", error);
    }
  } finally {
    if (abortController.signal.aborted) perfPointTileAborts += 1;
    if (request.phase === "prefetch") perfPointTilePrefetchInFlight = Math.max(0, perfPointTilePrefetchInFlight - 1);
    else perfPointTileActiveInFlight = Math.max(0, perfPointTileActiveInFlight - 1);
    if (tile.abortController === abortController) tile.abortController = undefined;
    updatePerfHud();
  }
}

function emptyCatalogPointPayload(request: CatalogPointTileRequest): CatalogPointPayload {
  return {
    bounds: request.bounds,
    groups: request.groups,
    types: request.types,
    limit: request.limit,
    total: 0,
    returned: 0,
    vertices: new Float32Array(),
    origin: { x: request.bounds.min_x_au, y: request.bounds.min_y_au },
    declared: 0,
    flags: 0
  };
}

function canRetryCatalogPointTile(tile: CatalogPointTile, now: number) {
  if (!tile.failedAt) return true;
  const retryDelay = Math.min(POINT_TILE_RETRY_MAX_MS, POINT_TILE_RETRY_BASE_MS * 2 ** Math.max(0, (tile.retryCount ?? 1) - 1));
  return now - tile.failedAt >= retryDelay;
}

function scheduleCatalogPointRetryIfNeeded(requestId: number) {
  if (requestId !== catalogPointRequestId || catalogPointTimer !== null) return;
  const now = performance.now();
  let retryDelay = Number.POSITIVE_INFINITY;
  for (const key of activeCatalogPointTileKeys) {
    const tile = catalogPointTiles.get(key);
    if (!tile || tile.source || tile.abortController || !tile.failedAt) continue;
    const delay = Math.min(POINT_TILE_RETRY_MAX_MS, POINT_TILE_RETRY_BASE_MS * 2 ** Math.max(0, (tile.retryCount ?? 1) - 1));
    retryDelay = Math.min(retryDelay, Math.max(0, tile.failedAt + delay - now));
  }
  if (!Number.isFinite(retryDelay)) return;
  catalogPointTimer = window.setTimeout(() => {
    catalogPointTimer = null;
    scheduleCatalogPointLoad();
  }, retryDelay);
}

async function catalogPointPayloadFromBinary(buffer: ArrayBuffer, params: URLSearchParams, response: Response): Promise<CatalogPointPayload> {
  const originX = Number(params.get("min_x_au"));
  const originY = Number(params.get("min_y_au"));
  const decoded = await decodeCatalogPointBinary(buffer, originX, originY, catalogPointTileManifest?.color_lut ?? [], Number(params.get("limit")) || undefined);
  return catalogPointPayloadFromDecoded(decoded, params, response);
}

function createCatalogPointDecodeWorker() {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(new URL("./catalogPointTileWorker.ts", import.meta.url), { type: "module" });
    worker.addEventListener(
      "message",
      (event: MessageEvent<({ id: number; ok: true } & CatalogPointDecoded) | { id: number; ok: false; error: string }>) => {
        const callback = catalogPointDecodeCallbacks.get(event.data.id);
        if (!callback) return;
        catalogPointDecodeCallbacks.delete(event.data.id);
        if (event.data.ok) callback.resolve(event.data);
        else callback.reject(new Error(event.data.error));
      }
    );
    worker.addEventListener("error", (event) => {
      for (const callback of catalogPointDecodeCallbacks.values()) callback.reject(event.error ?? new Error(event.message));
      catalogPointDecodeCallbacks.clear();
    });
    return worker;
  } catch (error) {
    console.warn("Catalog point decode worker unavailable; decoding on main thread.", error);
    return null;
  }
}

function decodeCatalogPointBinary(buffer: ArrayBuffer, originX: number, originY: number, colorLut: readonly (readonly number[])[] = [], maxRecords?: number): Promise<CatalogPointDecoded> {
  if (!catalogPointDecodeWorker) return Promise.resolve(decodeCatalogPointBinaryOnMainThread(buffer, originX, originY, colorLut, maxRecords));

  const id = ++catalogPointDecodeRequestId;
  return new Promise((resolve, reject) => {
    catalogPointDecodeCallbacks.set(id, { resolve, reject });
    try {
      catalogPointDecodeWorker.postMessage({ id, buffer, originX, originY, colorLut, maxRecords }, [buffer]);
    } catch (error) {
      catalogPointDecodeCallbacks.delete(id);
      reject(error);
    }
  });
}

function decodeCatalogPointBinaryOnMainThread(buffer: ArrayBuffer, originX: number, originY: number, colorLut: readonly (readonly number[])[] = [], maxRecords = Number.POSITIVE_INFINITY): CatalogPointDecoded {
  const view = new DataView(buffer);
  const magic =
    buffer.byteLength >= 4
      ? String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
      : "";
  if (magic === "SMP3") {
    if (buffer.byteLength < 32) throw new Error("SMP3 header was truncated.");
    const declared = view.getUint32(28, true);
    const flags = view.getUint16(6, true);
    const returned = Math.min(declared, maxRecords, Math.floor((buffer.byteLength - 32) / 8));
    const tileOriginX = view.getFloat64(8, true);
    const tileOriginY = view.getFloat64(16, true);
    const span = view.getFloat32(24, true);
    const output = new ArrayBuffer(returned * 16);
    const floats = new Float32Array(output);
    const bytes = new Uint8Array(output);
    for (let index = 0; index < returned; index += 1) {
      const inputOffset = 32 + index * 8;
      const outputOffset = index * 16;
      floats[outputOffset / 4] = view.getUint16(inputOffset, true) / 65535 * span;
      floats[outputOffset / 4 + 1] = view.getUint16(inputOffset + 2, true) / 65535 * span;
      const color = colorLut[view.getUint8(inputOffset + 5)] ?? [224, 196, 128];
      bytes[outputOffset + 8] = color[0] ?? 224;
      bytes[outputOffset + 9] = color[1] ?? 196;
      bytes[outputOffset + 10] = color[2] ?? 128;
      bytes[outputOffset + 11] = view.getUint8(inputOffset + 6);
      bytes[outputOffset + 12] = view.getUint8(inputOffset + 4);
      bytes[outputOffset + 13] = view.getUint8(inputOffset + 7);
    }
    return { returned, declared, flags, vertices: new Float32Array(output), format: "SMP3", originX: tileOriginX, originY: tileOriginY };
  }
  if (magic !== "SMP2") throw new Error("Catalog point binary payload had an unknown format.");

  const returned = Math.min(view.getUint32(4, true), maxRecords);
  const expectedBytes = POINT_BINARY_HEADER_BYTES + returned * POINT_BINARY_RECORD_BYTES;
  if (buffer.byteLength < expectedBytes) throw new Error("Catalog point binary payload was truncated.");

  const floatIn = new Float32Array(buffer, POINT_BINARY_HEADER_BYTES, returned * POINT_VERTEX_STRIDE_FLOATS);
  const byteIn = new Uint8Array(buffer, POINT_BINARY_HEADER_BYTES, returned * POINT_BINARY_RECORD_BYTES);
  const out = new ArrayBuffer(returned * POINT_BINARY_RECORD_BYTES);
  const floatOut = new Float32Array(out);
  const byteOut = new Uint8Array(out);
  for (let index = 0; index < returned; index += 1) {
    const floatOffset = index * POINT_VERTEX_STRIDE_FLOATS;
    const byteOffset = index * POINT_BINARY_RECORD_BYTES;
    floatOut[floatOffset] = floatIn[floatOffset] - originX;
    floatOut[floatOffset + 1] = floatIn[floatOffset + 1] - originY;
    byteOut[byteOffset + 8] = byteIn[byteOffset + 8];
    byteOut[byteOffset + 9] = byteIn[byteOffset + 9];
    byteOut[byteOffset + 10] = byteIn[byteOffset + 10];
    byteOut[byteOffset + 11] = byteIn[byteOffset + 11];
  }

  return { returned, declared: returned, flags: 0, vertices: floatOut, format: "SMP2", originX, originY };
}

function catalogPointPayloadFromDecoded(
  decoded: CatalogPointDecoded,
  params: URLSearchParams,
  response: Response
): CatalogPointPayload {
  const bounds = {
    min_x_au: Number(params.get("min_x_au")),
    max_x_au: Number(params.get("max_x_au")),
    min_y_au: Number(params.get("min_y_au")),
    max_y_au: Number(params.get("max_y_au"))
  };
  return {
    bounds,
    groups: (params.get("groups") ?? "").split(",").filter(Boolean),
    types: (params.get("types") ?? "").split(",").filter(Boolean),
    limit: Number(params.get("limit")) || decoded.returned,
    total: Number(response.headers.get("x-starsmap-total")) || decoded.returned,
    returned: decoded.returned,
    vertices: decoded.vertices,
    origin: { x: decoded.originX, y: decoded.originY },
    format: decoded.format,
    declared: decoded.declared,
    flags: decoded.flags
  };
}

function cancelCatalogPointRequest() {
  if (catalogPointTimer !== null) {
    window.clearTimeout(catalogPointTimer);
    catalogPointTimer = null;
  }
  if (catalogPointPrefetchTimer !== null) {
    window.clearTimeout(catalogPointPrefetchTimer);
    catalogPointPrefetchTimer = null;
  }
  catalogPointPrefetchSignature = "";
  for (const tile of catalogPointTiles.values()) {
    if (tile.abortController) perfPointTileAborts += 1;
    tile.abortController?.abort();
    tile.abortController = undefined;
  }
  catalogPointRequestId += 1;
}

function clearCatalogPointTiles(update = true) {
  if (catalogPointTiles.size === 0 && activeCatalogPointTileKeys.size === 0 && renderedCatalogPointLayerIds.size === 0 && !catalogPointSignature) return;
  for (const tile of catalogPointTiles.values()) {
    if (tile.abortController) perfPointTileAborts += 1;
    tile.abortController?.abort();
  }
  for (const layerId of renderedCatalogPointLayerIds) pointRenderer.setLayer(layerId, null);
  catalogPointTiles = new Map();
  activeCatalogPointTileKeys = new Set();
  renderedCatalogPointLayerIds = new Set();
  catalogPointSignature = "";
  catalogPointPrefetchSignature = "";
  catalogPointsInViewport = 0;
  catalogViewportMeasurePending = false;
  if (update) updateStats();
}

function catalogPointRequests(): CatalogPointTileRequest[] {
  const requestContext = catalogPointRequestContext();
  if (!requestContext) return [];

  const maxRequests = catalogPointMaxActiveTiles(requestContext.viewWidthLy);
  const staticLayers = requestContext.staticLayers.length > 0 ? requestContext.staticLayers : [requestContext.staticLayer];
  const requestsByLayer = staticLayers.map((staticLayer) => {
    const layerContext = { ...requestContext, staticLayer };
    const tileSpanAu = catalogPointTileSpanAu(layerContext.bounds, layerContext.viewWidthLy, staticLayer);
    const defaultLevel = catalogStaticTileLevelForSpan(tileSpanAu, staticLayer);
    const staticLevel = densestCompleteUniverseLevel(layerContext.bounds, layerContext.viewWidthLy, staticLayer, defaultLevel);
    const selectedSpanAu = staticLevel?.span_au ?? tileSpanAu;
    const layerMaxRequests = staticLevel && isDenseUniverseLayer(staticLayer) && layerContext.viewWidthLy > 450_000_000
      ? Math.min(POINT_TILE_MAX_ACTIVE_UNIVERSE_DENSE, catalogTileCountForBounds(layerContext.bounds, selectedSpanAu))
      : maxRequests;
    return catalogPointRequestsForLevel(layerContext, selectedSpanAu, staticLevel, layerMaxRequests);
  });

  // The highest-priority layer keeps its full viewport coverage; secondary
  // layers share one extra budget. A single global slice let same-position
  // tiles from secondary layers starve most of the primary star coverage.
  const [primaryRequests, ...secondaryLayerRequests] = requestsByLayer;
  const fullCoverageSecondaryRequests = secondaryLayerRequests.flatMap((requests, index) =>
    isDenseUniverseLayer(staticLayers[index + 1]) && requestContext.viewWidthLy > 450_000_000 ? requests : []
  );
  const sharedSecondaryRequests = secondaryLayerRequests.flatMap((requests, index) =>
    isDenseUniverseLayer(staticLayers[index + 1]) && requestContext.viewWidthLy > 450_000_000 ? [] : requests
  );
  const secondaryRequests = sharedSecondaryRequests
    .sort(compareCatalogPointTileRequests)
    .slice(0, maxRequests);
  const requests =
    requestContext.viewWidthLy > 450_000_000
      ? [...(primaryRequests ?? []), ...fullCoverageSecondaryRequests, ...secondaryRequests]
      : [
          ...(primaryRequests ?? []).slice(0, maxRequests),
          ...secondaryRequests.slice(0, Math.max(0, maxRequests - (primaryRequests?.length ?? 0)))
        ];
  return isEmbedMode ? requests.slice(0, Math.max(1, Math.floor(requests.length / 2))) : requests;
}

function catalogPointPrefetchRequests(activeRequests: CatalogPointTileRequest[]): CatalogPointTileRequest[] {
  if (POINT_TILE_PREFETCH_MAX_REQUESTS <= 0) return [];
  const requestContext = catalogPointRequestContext();
  if (!requestContext || catalogPointTileManifestState !== "ready" || !catalogPointTileManifest) return [];
  if (requestContext.viewWidthLy > 70_000) return [];

  const activeKeys = new Set(activeRequests.map((request) => request.key));
  const requests: CatalogPointTileRequest[] = [];
  const staticLayers = requestContext.staticLayers.length > 0 ? requestContext.staticLayers : [requestContext.staticLayer].filter(isPresent);

  for (const staticLayer of staticLayers) {
    const layerContext = { ...requestContext, staticLayer };
    const activeSpanAu = catalogPointTileSpanAu(layerContext.bounds, layerContext.viewWidthLy, staticLayer);
    const activeLevel = catalogStaticTileLevelForSpan(activeSpanAu, staticLayer);
    if (!activeLevel) continue;

    const activeLevelIndex = staticLayer.levels.findIndex((level) => level.span_au === activeLevel.span_au);
    if (activeLevelIndex < 0) continue;

    const firstLevelIndex = Math.max(0, activeLevelIndex - POINT_TILE_PREFETCH_LEVEL_RADIUS);
    const lastLevelIndex = Math.min(staticLayer.levels.length - 1, activeLevelIndex + POINT_TILE_PREFETCH_LEVEL_RADIUS);

    for (let levelIndex = firstLevelIndex; levelIndex <= lastLevelIndex; levelIndex += 1) {
      if (levelIndex === activeLevelIndex) continue;
      const level = staticLayer.levels[levelIndex];
      const prefetchContext = catalogPointRequestContextForTileSpan(layerContext, level.span_au);
      requests.push(...catalogPointRequestsForLevel(prefetchContext, level.span_au, level, catalogPointMaxActiveTiles(prefetchContext.viewWidthLy)));
    }
  }

  const now = performance.now();
  return requests
    .filter((request) => {
      if (activeKeys.has(request.key)) return false;
      const tile = catalogPointTiles.get(request.key);
      return !tile || (!tile.source && !tile.abortController && canRetryCatalogPointTile(tile, now));
    })
    .sort(compareCatalogPointTileRequests)
    .slice(0, POINT_TILE_PREFETCH_MAX_REQUESTS);
}

function compareCatalogPointTileRequests(a: CatalogPointTileRequest, b: CatalogPointTileRequest) {
  const distanceDelta = tileDistanceToCamera(a) - tileDistanceToCamera(b);
  if (Math.abs(distanceDelta) > 1) return distanceDelta;
  const priorityDelta = catalogStaticLayerPriority(a.staticLayerId) - catalogStaticLayerPriority(b.staticLayerId);
  return priorityDelta !== 0 ? priorityDelta : distanceDelta;
}

function catalogStaticLayerPriority(layerId: string | undefined) {
  if (!layerId) return 0;
  if (layerId === "desi_dr1" && currentViewWidthLy() >= 1_000_000) return -1;
  if (layerId === "quaia_g20" && currentViewWidthLy() >= 1_000_000) return 0;
  if (layerId === "gaia_stars") return 0;
  if (layerId === "deep_sky") return 1;
  if (layerId === "exoplanet_systems") return 3;
  if (layerId === "small_bodies") return 4;
  return 2;
}

function catalogPointRequestContextForTileSpan(
  requestContext: NonNullable<ReturnType<typeof catalogPointRequestContext>>,
  tileSpanAu: number
): NonNullable<ReturnType<typeof catalogPointRequestContext>> {
  const rect = usableViewportRect();
  const normalViewWidthLy = (tileSpanAu * POINT_TILE_TARGET_VIEW_DIVISIONS) / AU_PER_LIGHT_YEAR;
  const divisions = catalogPointTileViewDivisions(normalViewWidthLy);
  const viewWidthAu = tileSpanAu * divisions;
  const viewHeightAu = viewWidthAu * (rect.height / Math.max(1, rect.width));
  const paddingXAu = viewWidthAu * POINT_LAYER_VIEWPORT_PADDING;
  const paddingYAu = viewHeightAu * POINT_LAYER_VIEWPORT_PADDING;
  return {
    ...requestContext,
    viewWidthLy: viewWidthAu / AU_PER_LIGHT_YEAR,
    bounds: {
      minXAu: camera.xAu - viewWidthAu / 2 - paddingXAu,
      maxXAu: camera.xAu + viewWidthAu / 2 + paddingXAu,
      minYAu: camera.yAu - viewHeightAu / 2 - paddingYAu,
      maxYAu: camera.yAu + viewHeightAu / 2 + paddingYAu
    }
  };
}

function catalogPointRequestContext() {
  const viewWidthLy = currentViewWidthLy();
  const filterParams = catalogPointFilterParams();
  if (!filterParams || !shouldUseCatalogPoints(viewWidthLy, filterParams)) return null;
  if (catalogPointTileManifestState === "loading") return null;
  if (catalogPointTileManifestState === "missing" && !ALLOW_DYNAMIC_POINT_FALLBACK) return null;
  const filter = activeBodyFilterDefinition();
  const staticLayers = prioritizedCatalogStaticTileLayers(catalogStaticTileLayersForFilter(filterParams), viewWidthLy, filter.key === "all");
  const staticLayer = staticLayers[0] ?? null;
  if (catalogPointTileManifestState === "ready" && staticLayers.length === 0 && !ALLOW_DYNAMIC_POINT_FALLBACK) return null;
  return {
    viewWidthLy,
    bounds: viewportWorldBounds(POINT_LAYER_VIEWPORT_PADDING),
    filterParams,
    staticLayer,
    staticLayers
  };
}

function catalogPointRequestsForLevel(
  requestContext: NonNullable<ReturnType<typeof catalogPointRequestContext>>,
  tileSpanAu: number,
  staticLevel: CatalogPointTileManifestLevel | null,
  maxRequests: number
): CatalogPointTileRequest[] {
  const { bounds, filterParams, viewWidthLy } = requestContext;
  const minTileX = Math.floor(bounds.minXAu / tileSpanAu);
  const maxTileX = Math.floor(bounds.maxXAu / tileSpanAu);
  const minTileY = Math.floor(bounds.minYAu / tileSpanAu);
  const maxTileY = Math.floor(bounds.maxYAu / tileSpanAu);
  const requests: CatalogPointTileRequest[] = [];
  const configuredLimit = staticLevel?.max_points_per_tile ?? catalogPointTileLimit(viewWidthLy);
  // An SMP3 tile prefix is already capped by its immutable pyramid level.
  // Keep that prefix stable for a camera/level: tying it to frame timing made
  // every budget adjustment produce a new cache key and re-download the view.
  const limit = catalogPointTileManifest?.format === "SMP3"
    ? configuredLimit
    : Math.min(configuredLimit, legacySmp2TileLimit(viewWidthLy));
  const sampleBuckets = staticLevel?.sample_buckets ?? catalogPointSampleBuckets(viewWidthLy);
  const groupSignature = filterParams.groups.join("+");
  const typeSignature = filterParams.types.join("+");

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const tileBounds = {
        min_x_au: tileX * tileSpanAu,
        max_x_au: (tileX + 1) * tileSpanAu,
        min_y_au: tileY * tileSpanAu,
        max_y_au: (tileY + 1) * tileSpanAu
      };
      const tileKey = `layer${requestContext.staticLayer?.id ?? "api"}:z${Math.round(Math.log2(tileSpanAu) * 100) / 100}:x${tileX}:y${tileY}:g${groupSignature}:t${typeSignature}:l${limit}:s${sampleBuckets}:m${staticLevel ? "static" : "api"}`;
      const params = new URLSearchParams();
      params.set("min_x_au", String(tileBounds.min_x_au));
      params.set("max_x_au", String(tileBounds.max_x_au));
      params.set("min_y_au", String(tileBounds.min_y_au));
      params.set("max_y_au", String(tileBounds.max_y_au));
      params.set("groups", filterParams.groups.join(","));
      if (filterParams.types.length > 0) params.set("types", filterParams.types.join(","));
      params.set("limit", String(limit));
      if (sampleBuckets < POINT_SAMPLE_BUCKET_COUNT) params.set("sample_buckets", String(sampleBuckets));
      const staticLocation = staticLevel && requestContext.staticLayer
        ? catalogStaticTileLocation(requestContext.staticLayer, staticLevel, tileX, tileY)
        : undefined;
      if (staticLevel && requestContext.staticLayer && !staticLocation) continue;
      requests.push({
        key: tileKey,
        layerId: `catalog:${tileKey}`,
        signature: `points:${tileKey}`,
        params,
        staticUrl: staticLocation?.url,
        staticRange: staticLocation?.range,
        staticLayerId: requestContext.staticLayer?.id,
        priority: tileBoundsDistanceToCamera(tileBounds),
        phase: "active",
        bounds: tileBounds,
        groups: filterParams.groups,
        types: filterParams.types,
        limit
      });
    }
  }

  return requests
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxRequests);
}

function prioritizeCatalogPointRequests(requests: CatalogPointTileRequest[]) {
  return [...requests].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function catalogPointFilterParams(): { groups: string[]; types: DestinationBodyType[] } | null {
  const filter = activeBodyFilterDefinition();
  const sourceGroups = filter.key === "all" || !filter.groups ? catalogPointManifestGroups() : filter.groups;
  const groups = sourceGroups.filter((group) => POINT_LAYER_GROUP_SET.has(group) || catalogPointManifestGroupSet().has(group));
  if (groups.length === 0) return null;
  return { groups: uniqueStrings(groups), types: filter.types ?? [] };
}

function catalogPointManifestGroups() {
  if (catalogPointTileManifestState !== "ready" || !catalogPointTileManifest) return POINT_LAYER_GROUPS;
  return uniqueStrings(catalogPointTileManifest.layers.flatMap((layer) => layer.groups));
}

function catalogPointManifestGroupSet() {
  return new Set(catalogPointManifestGroups());
}

function catalogStaticTileLayersForFilter(filterParams: { groups: string[]; types: DestinationBodyType[] }): CatalogPointTileManifestLayer[] {
  if (catalogPointTileManifestState !== "ready" || !catalogPointTileManifest) return [];
  const requestedGroups = new Set(filterParams.groups);
  const matchingLayers = catalogPointTileManifest.layers.filter((layer) => layer.groups.some((group) => requestedGroups.has(group)) && layerCoversAnyType(layer, filterParams.types));
  const requestedDeepSkyTypes = filterParams.types.filter((type) => DEEP_SKY_POINT_TYPES.includes(type));

  if (filterParams.types.length === 1 && requestedDeepSkyTypes.length === 1) {
    const specializedLayers = matchingLayers.filter((layer) => layer.types.length > 0 && layer.types.every((type) => type === requestedDeepSkyTypes[0]));
    if (specializedLayers.length > 0) return specializedLayers;
  }

  return matchingLayers.filter((layer) => !isStaticLayerCoveredByPreferredAggregate(layer, matchingLayers, requestedDeepSkyTypes));
}

function prioritizedCatalogStaticTileLayers(layers: CatalogPointTileManifestLayer[], viewWidthLy: number, isDefaultFilter: boolean) {
  const visibleLayers = isDefaultFilter && viewWidthLy > 70_000
    ? layers.filter((layer) => !["exoplanet_systems", "small_bodies"].includes(layer.id))
    : layers;
  return [...visibleLayers].sort((a, b) => catalogStaticLayerPriority(a.id) - catalogStaticLayerPriority(b.id));
}

function layerCoversAnyType(layer: CatalogPointTileManifestLayer, types: DestinationBodyType[]) {
  if (layer.types.length === 0 || types.length === 0) return true;
  return layer.types.some((type) => types.includes(type));
}

function isStaticLayerCoveredByPreferredAggregate(
  layer: CatalogPointTileManifestLayer,
  matchingLayers: CatalogPointTileManifestLayer[],
  requestedDeepSkyTypes: DestinationBodyType[]
) {
  if (layer.types.length === 0) return false;
  return matchingLayers.some((aggregateLayer) => {
    if (aggregateLayer === layer || aggregateLayer.types.length <= layer.types.length) return false;
    if (!aggregateLayer.types.every((type) => DEEP_SKY_POINT_TYPES.includes(type))) return false;
    if (requestedDeepSkyTypes.length > 0 && !requestedDeepSkyTypes.every((type) => aggregateLayer.types.includes(type))) return false;
    if (!layer.types.every((type) => aggregateLayer.types.includes(type))) return false;
    return layer.groups.some((group) => aggregateLayer.groups.includes(group));
  });
}


function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values));
}

function shouldUseCatalogPoints(viewWidthLy: number, filterParams: { groups: string[]; types: DestinationBodyType[] }) {
  if (!Number.isFinite(viewWidthLy) || viewWidthLy <= 0) return false;
  const hasQuasarScale = filterParams.types.some((type) => type === "quasar" || type === "active_galaxy") || filterParams.groups.includes("simbad_extragalactic");
  const hasDeepSkyScale = filterParams.groups.some((group) => DEEP_SKY_POINT_GROUPS.includes(group));
  const maxWidthLy = hasQuasarScale ? POINT_LAYER_QUASAR_MAX_WIDTH_LY : hasDeepSkyScale ? POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY : POINT_LAYER_MAX_WIDTH_LY;
  return viewWidthLy <= maxWidthLy;
}

function hasActiveCatalogPointLayer() {
  return activeCatalogPointTiles().some((tile) => (tile.payload?.returned ?? 0) > 0);
}

function activeCatalogPointTiles() {
  const now = performance.now();
  const tiles: CatalogPointTile[] = [];
  for (const key of activeCatalogPointTileKeys) {
    const tile = catalogPointTiles.get(key);
    if (!tile) continue;
    tile.lastUsedAt = now;
    if (tile.source) tiles.push(tile);
  }
  return tiles;
}

function activeCatalogPointCount() {
  return activeCatalogPointTiles().reduce((sum, tile) => sum + (tile.payload?.returned ?? 0), 0);
}

function catalogPointTileSpanAu(
  bounds: { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number },
  viewWidthLy: number,
  staticLayer: CatalogPointTileManifestLayer | null = null
) {
  const spanAu = Math.max(bounds.maxXAu - bounds.minXAu, bounds.maxYAu - bounds.minYAu, 1);
  const divisions = catalogPointTileViewDivisions(viewWidthLy);
  const rawSpan = spanAu / divisions;
  const dynamicSpan = Math.pow(2, Math.max(0, Math.round(Math.log2(rawSpan))));
  const staticLevel = catalogStaticTileLevelNearest(dynamicSpan, staticLayer);
  return staticLevel?.span_au ?? dynamicSpan;
}

function catalogStaticTileLevelNearest(spanAu: number, staticLayer: CatalogPointTileManifestLayer | null = null): CatalogPointTileManifestLevel | null {
  if (catalogPointTileManifestState !== "ready" || !staticLayer) return null;
  return staticLayer.levels.reduce<CatalogPointTileManifestLevel | null>((best, level) => {
    if (!best) return level;
    return Math.abs(Math.log2(level.span_au / spanAu)) < Math.abs(Math.log2(best.span_au / spanAu)) ? level : best;
  }, null);
}

function catalogStaticTileLevelForSpan(spanAu: number, staticLayer: CatalogPointTileManifestLayer | null = null): CatalogPointTileManifestLevel | null {
  if (catalogPointTileManifestState !== "ready" || !staticLayer) return null;
  return staticLayer.levels.find((level) => level.span_au === spanAu) ?? null;
}

function densestCompleteUniverseLevel(
  bounds: { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number },
  viewWidthLy: number,
  layer: CatalogPointTileManifestLayer | null,
  fallback: CatalogPointTileManifestLevel | null
) {
  if (!layer || !isDenseUniverseLayer(layer) || viewWidthLy <= 450_000_000) return fallback;
  const candidates = layer.levels.filter(
    (level) => catalogTileCountForBounds(bounds, level.span_au) <= POINT_TILE_MAX_ACTIVE_UNIVERSE_DENSE
  );
  if (candidates.length === 0) return fallback;
  return candidates.reduce((best, level) => {
    const pointDelta = (level.point_count ?? 0) - (best.point_count ?? 0);
    return pointDelta > 0 || (pointDelta === 0 && level.span_au < best.span_au) ? level : best;
  });
}

function isDenseUniverseLayer(layer: CatalogPointTileManifestLayer | null | undefined) {
  return Boolean(layer && UNIVERSE_DENSE_LAYER_IDS.has(layer.id));
}

function catalogTileCountForBounds(
  bounds: { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number },
  tileSpanAu: number
) {
  const columns = Math.floor(bounds.maxXAu / tileSpanAu) - Math.floor(bounds.minXAu / tileSpanAu) + 1;
  const rows = Math.floor(bounds.maxYAu / tileSpanAu) - Math.floor(bounds.minYAu / tileSpanAu) + 1;
  return Math.max(0, columns * rows);
}

function catalogStaticTileLocation(layer: CatalogPointTileManifestLayer, level: CatalogPointTileManifestLevel, tileX: number, tileY: number) {
  if (layer.container && layer.containerIndex) {
    const entry = findCatalogContainerIndexEntry(layer.containerIndex, level.span_log2, tileX, tileY);
    return entry ? { url: layer.container, range: entry } : undefined;
  }
  if (!layer.tile_url_template) return undefined;
  return { url: layer.tile_url_template
    .replace(/\{span_log2\}/g, String(level.span_log2))
    .replace(/\{x\}/g, String(tileX))
    .replace(/\{y\}/g, String(tileY)) };
}

function findCatalogContainerIndexEntry(index: CatalogPointContainerIndex, span: number, x: number, y: number) {
  let low = 0;
  let high = index.count - 1;
  while (low <= high) {
    const entry = Math.floor((low + high) / 2);
    const offset = entry * 24;
    const entrySpan = index.view.getUint8(offset);
    const entryX = index.view.getInt32(offset + 4, true);
    const entryY = index.view.getInt32(offset + 8, true);
    const comparison = entrySpan - span || entryX - x || entryY - y;
    if (comparison < 0) low = entry + 1;
    else if (comparison > 0) high = entry - 1;
    else {
      return {
        offset: Number(index.view.getBigUint64(offset + 12, true)),
        length: index.view.getUint32(offset + 20, true)
      };
    }
  }
  return undefined;
}

function catalogPointTileViewDivisions(viewWidthLy: number) {
  if (viewWidthLy > 450_000_000) return 0.5;
  if (viewWidthLy > 70_000) return POINT_TILE_TARGET_VIEW_DIVISIONS_WIDE;
  return POINT_TILE_TARGET_VIEW_DIVISIONS;
}

function catalogPointTileLimit(viewWidthLy: number) {
  if (viewWidthLy > 450_000_000) return POINT_TILE_MAX_POINTS_UNIVERSE;
  if (viewWidthLy > 70_000) return POINT_TILE_MAX_POINTS_WIDE;
  if (viewWidthLy < 80) return Math.min(POINT_TILE_MAX_POINTS, 18_000);
  if (viewWidthLy > 10_000) return Math.min(POINT_TILE_MAX_POINTS, 16_000);
  return POINT_TILE_MAX_POINTS;
}

function legacySmp2TileLimit(viewWidthLy: number) {
  // SMP2 tiles predate magnitude prefixes and density-preserving level-wide
  // sampling. Keep the compatibility path visually quiet while an SMP3
  // pyramid is rolled out; otherwise every capped square becomes visible.
  if (viewWidthLy < 500) return 18_000;
  if (viewWidthLy < 2_000) return 8_000;
  if (viewWidthLy < 15_000) return 2_500;
  if (viewWidthLy < 70_000) return 1_500;
  return 1_000;
}

function catalogPointSampleBuckets(viewWidthLy: number) {
  if (viewWidthLy < 120) return POINT_SAMPLE_BUCKET_COUNT;
  if (viewWidthLy < 2_000) return 5;
  if (viewWidthLy < 15_000) return 4;
  if (viewWidthLy < 70_000) return 3;
  if (viewWidthLy < 8_000_000) return 2;
  if (viewWidthLy < 450_000_000) return 1;
  return 1;
}

function catalogPointMaxActiveTiles(viewWidthLy: number) {
  if (viewWidthLy > 450_000_000) return POINT_TILE_MAX_ACTIVE_UNIVERSE;
  return viewWidthLy > 70_000 ? POINT_TILE_MAX_ACTIVE_WIDE : POINT_TILE_MAX_ACTIVE;
}

function tileDistanceToCamera(request: CatalogPointTileRequest) {
  return tileBoundsDistanceToCamera(request.bounds);
}

function tileBoundsDistanceToCamera(bounds: CatalogPointTileRequest["bounds"]) {
  const centerX = (bounds.min_x_au + bounds.max_x_au) / 2;
  const centerY = (bounds.min_y_au + bounds.max_y_au) / 2;
  return Math.hypot(centerX - camera.xAu, centerY - camera.yAu);
}

function evictCatalogPointTiles() {
  if (catalogPointTiles.size <= POINT_TILE_CACHE_LIMIT) return;
  const activeKeys = activeCatalogPointTileKeys;
  const evictable = [...catalogPointTiles.values()]
    .filter((tile) => !activeKeys.has(tile.request.key) && !tile.abortController)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  for (const tile of evictable.slice(0, Math.max(0, catalogPointTiles.size - POINT_TILE_CACHE_LIMIT))) {
    pointRenderer.setLayer(tile.request.layerId, null);
    catalogPointTiles.delete(tile.request.key);
    renderedCatalogPointLayerIds.delete(tile.request.layerId);
  }
}

function viewportCatalogRequest() {
  const viewWidthLy = currentViewWidthLy();
  if (!Number.isFinite(viewWidthLy) || viewWidthLy > VIEWPORT_CATALOG_MAX_WIDTH_LY) return null;

  const bounds = viewportWorldBounds(0.35);
  const filter = activeBodyFilterDefinition();
  const groups = filter.key === "all" || !filter.groups ? viewportCatalogGroups(viewWidthLy) : filter.groups;
  const types = filter.key === "all" ? [] : (filter.types ?? []);
  const limit = viewportCatalogLimit(viewWidthLy);
  const params = new URLSearchParams();
  params.set("min_x_au", String(bounds.minXAu));
  params.set("max_x_au", String(bounds.maxXAu));
  params.set("min_y_au", String(bounds.minYAu));
  params.set("max_y_au", String(bounds.maxYAu));
  params.set("groups", groups.join(","));
  if (types.length > 0) params.set("types", types.join(","));
  params.set("limit", String(limit));

  return {
    params,
    signature: viewportCatalogSignatureFor(bounds, groups, types, limit)
  };
}

function viewportCatalogGroups(viewWidthLy: number) {
  if (viewWidthLy < 0.08) return ["jpl_small_bodies"];
  if (viewWidthLy < 40) return ["jpl_small_bodies", "bright_stars", "gaia_local_stars", "exoplanet_systems", "exoplanets"];
  if (viewWidthLy < 6_000) return ["bright_stars", "gaia_local_stars", "gaia_500pc_stars", "exoplanet_systems", "exoplanets", "simbad_compact_objects"];
  if (viewWidthLy < 25_000) return ["bright_stars", "simbad_compact_objects"];
  return ["simbad_extragalactic", "simbad_compact_objects", "messier_deep_sky"];
}

function viewportCatalogLimit(viewWidthLy: number) {
  if (viewWidthLy < 0.08) return 1_400;
  if (viewWidthLy < 40) return 1_100;
  if (viewWidthLy >= 25_000) return 450;
  if (viewWidthLy < 100) return 900;
  if (viewWidthLy < 1_000) return 700;
  if (viewWidthLy < 6_000) return 500;
  return 350;
}

function viewportCatalogSignatureFor(
  bounds: { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number },
  groups: readonly string[],
  types: readonly string[],
  limit: number
) {
  const widthAu = Math.max(1, bounds.maxXAu - bounds.minXAu);
  const heightAu = Math.max(1, bounds.maxYAu - bounds.minYAu);
  const spanAu = Math.max(widthAu, heightAu);
  const cellAu = Math.max(1, spanAu / 3);
  const centerXAu = (bounds.minXAu + bounds.maxXAu) / 2;
  const centerYAu = (bounds.minYAu + bounds.maxYAu) / 2;
  const scaleBucket = Math.round(Math.log10(spanAu) * 8) / 8;
  const centerBucketX = Math.round(centerXAu / cellAu);
  const centerBucketY = Math.round(centerYAu / cellAu);
  return `${groups.join("+")}:${types.join("+")}:${limit}:${scaleBucket}:${centerBucketX}:${centerBucketY}`;
}

function viewportWorldBounds(paddingRatio: number) {
  const rect = usableViewportRect();
  const leftTop = screenToWorld(rect.left, rect.top);
  const rightBottom = screenToWorld(rect.right, rect.bottom);
  const minXAu = Math.min(leftTop.xAu, rightBottom.xAu);
  const maxXAu = Math.max(leftTop.xAu, rightBottom.xAu);
  const minYAu = Math.min(leftTop.yAu, rightBottom.yAu);
  const maxYAu = Math.max(leftTop.yAu, rightBottom.yAu);
  const paddingXAu = (maxXAu - minXAu) * paddingRatio;
  const paddingYAu = (maxYAu - minYAu) * paddingRatio;
  return {
    minXAu: minXAu - paddingXAu,
    maxXAu: maxXAu + paddingXAu,
    minYAu: minYAu - paddingYAu,
    maxYAu: maxYAu + paddingYAu
  };
}

function localCatalogSearch(options: { query: string; filter?: BodyFilterDefinition; limit: number }) {
  const bodies = (ephemeris?.bodies ?? []).filter((body) => {
    if (options.filter?.groups && !options.filter.groups.includes(body.catalog_group ?? "")) return false;
    if (options.filter?.types && !options.filter.types.includes(classifyBody(body).type)) return false;
    return true;
  });
  return buildDestinationPickerItems(bodies, {
    query: options.query,
    selectedKey,
    currentTargetKey: selectedKey,
    recentDestinations,
    auKm: auKm(),
    maxResults: options.limit
  })
    .map((item) => bodyByKey.get(item.key))
    .filter(isPresent);
}

function catalogObjectToBody(object: CatalogObjectPayload): Body {
  const position = object.position ?? {};
  const xAu = finiteNumber(position.x_au, 0);
  const yAu = finiteNumber(position.y_au, 0);
  const zAu = finiteNumber(position.z_au, 0);
  const xKm = finiteNumber(position.x_km, xAu * auKm());
  const yKm = finiteNumber(position.y_km, yAu * auKm());
  const zKm = finiteNumber(position.z_km, zAu * auKm());
  const earth = bodyByKey.get("earth");
  const distanceFromEarthKm = earth ? Math.hypot(xAu - earth.position.x_au, yAu - earth.position.y_au, zAu - earth.position.z_au) * auKm() : Math.hypot(xKm, yKm, zKm);
  const facts = object.facts ?? {};
  const astrometry = object.astrometry ?? {};
  const objectType = normalizeDestinationType(object.object_type);
  const isDeepSkyLike = ["galaxy", "nebula", "star_cluster", "quasar", "active_galaxy", "black_hole", "pulsar"].includes(objectType);
  const isSmallBodyLike = ["asteroid", "comet", "small_body"].includes(objectType);

  return {
    key: object.key,
    name: object.name,
    radius_km: finiteNumber(object.radius_km, 0),
    color: object.color || "#d9b86f",
    object_type: objectType,
    parent_key: object.parent_key ?? undefined,
    catalog_group: object.catalog_group ?? undefined,
    aliases: object.aliases ?? [],
    catalog: {
      source_type: object.source_type,
      position_model: object.position_model,
      preview: true,
      parent_key: object.parent_key,
      catalog_group: object.catalog_group ?? undefined,
      aliases: object.aliases ?? [],
      ra_deg: finiteOptionalNumber(astrometry.ra_deg),
      dec_deg: finiteOptionalNumber(astrometry.dec_deg),
      external_ids: object.external_ids ?? null,
      external_links: normalizeExternalLinks(object.external_links ?? []),
      source: object.source ?? null,
      facts: object.facts ?? null
    },
    stellar:
      objectType === "star"
        ? {
            distance_ly: finiteOptionalNumber(astrometry.distance_ly),
            parallax_mas: finiteOptionalNumber(facts.parallax_mas),
            apparent_magnitude: finiteOptionalNumber(astrometry.apparent_magnitude),
            absolute_magnitude: finiteOptionalNumber(astrometry.absolute_magnitude),
            bv_color_index: finiteOptionalNumber(facts.bv_color_index),
            stellar_radius_solar: finiteOptionalNumber(facts.stellar_radius_solar),
            stellar_teff_k: finiteOptionalNumber(facts.stellar_teff_k),
            spectral_type: stringFact(facts.spectral_type)
          }
        : null,
    deep_sky:
      isDeepSkyLike
        ? {
            aliases: object.aliases ?? [],
            deep_sky_type_label: stringFact(facts.deep_sky_type_label) ?? stringFact(facts.simbad_object_type_label),
            apparent_magnitude: finiteOptionalNumber(astrometry.apparent_magnitude),
            angular_size_arcmin: stringFact(facts.angular_size_arcmin),
            constellation: stringFact(facts.constellation),
            viewing_season: stringFact(facts.viewing_season),
            common_name: stringFact(facts.common_name),
            observing_equipment: stringFact(facts.observing_equipment),
            why_interesting: stringFact(facts.why_interesting),
            physical_diameter_ly: finiteOptionalNumber(facts.physical_diameter_ly),
            physical_minor_diameter_ly: finiteOptionalNumber(facts.physical_minor_diameter_ly),
            physical_size_note: stringFact(facts.physical_size_note) ?? stringFact(facts.distance_quality)
          }
        : null,
    exoplanet_system:
      object.catalog_group === "exoplanet_systems" || object.catalog_group === "nearby_exoplanet_systems" || object.catalog_group === "exoplanets"
        ? {
            confirmed_planet_count: object.catalog_group === "exoplanets" ? 1 : finiteOptionalNumber(facts.exoplanet_count) ?? finiteOptionalNumber(facts.system_planet_count),
            system_star_count: finiteOptionalNumber(facts.system_star_count),
            system_planet_count: finiteOptionalNumber(facts.system_planet_count),
            system_moon_count: finiteOptionalNumber(facts.system_moon_count),
            planets: object.catalog_group === "exoplanets" ? [catalogObjectToExoplanet(object)] : Array.isArray(facts.planets) ? (facts.planets as BodyExoplanet[]) : [],
            why_interesting: stringFact(facts.why_interesting)
          }
        : null,
    small_body: isSmallBodyLike
      ? {
          orbit_class: stringFact(facts.orbit_class),
          neo: booleanFact(facts.neo),
          pha: booleanFact(facts.pha),
          diameter_km: finiteOptionalNumber(facts.diameter_km),
          estimated_diameter_km: finiteOptionalNumber(facts.estimated_diameter_km),
          h_absolute_magnitude: finiteOptionalNumber(facts.h_absolute_magnitude),
          perihelion_au: finiteOptionalNumber(facts.perihelion_au),
          aphelion_au: finiteOptionalNumber(facts.aphelion_au),
          semi_major_axis_au: finiteOptionalNumber(facts.semi_major_axis_au),
          eccentricity: finiteOptionalNumber(facts.eccentricity),
          inclination_deg: finiteOptionalNumber(facts.inclination_deg),
          orbital_period_days: finiteOptionalNumber(facts.orbital_period_days),
          earth_moid_au: finiteOptionalNumber(facts.earth_moid_au)
        }
      : null,
    position: {
      x_au: xAu,
      y_au: yAu,
      z_au: zAu,
      x_km: xKm,
      y_km: yKm,
      z_km: zKm,
      heliocentric_distance_km: Math.hypot(xKm, yKm, zKm)
    },
    distance_from_earth_km: distanceFromEarthKm
  };
}

function catalogObjectToExoplanet(object: CatalogObjectPayload): BodyExoplanet {
  const facts = object.facts ?? {};
  return {
    name: object.name,
    radius_earth: finiteOptionalNumber(facts.radius_earth),
    mass_earth: finiteOptionalNumber(facts.mass_earth),
    period_days: finiteOptionalNumber(facts.period_days),
    semi_major_axis_au: finiteOptionalNumber(facts.semi_major_axis_au),
    discovery_method: stringFact(facts.discovery_method),
    discovery_year: finiteOptionalNumber(facts.discovery_year)
  };
}

function normalizeDestinationType(type: string | null | undefined): DestinationBodyType {
  const allowed = new Set<DestinationBodyType>([
    "star",
    "planet",
    "moon",
    "dwarf_planet",
    "galaxy",
    "quasar",
    "active_galaxy",
    "black_hole",
    "pulsar",
    "nebula",
    "star_cluster",
    "asterism",
    "milky_way_patch",
    "asteroid",
    "comet",
    "small_body",
    "unknown"
  ]);
  return allowed.has(type as DestinationBodyType) ? (type as DestinationBodyType) : "unknown";
}

function stringFact(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanFact(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function updateBodyPicker() {
  const config = bodyPickerConfig();
  if (!config) return;
  await updateSearchPicker(config);
}

function bodyPickerConfig(): PickerSearchConfig | null {
  if (!ephemeris) return null;
  return {
    state: catalogSearchState,
    input: bodySearch,
    picker: bodyPicker,
    filter: activeBodyFilterDefinition(),
    sourceBodies: exploreSourceBodies(),
    activeKey: selectedKey,
    currentTargetKey: selectedKey,
    guidedSet: activeGuidedSet(),
    emptyMessage: t("search.noObjects"),
    loadingMessage: t("search.loading"),
    fallbackMessage: t("search.fallback")
  };
}

function scheduleBodyPickerUpdate() {
  if (bodyPickerUpdateTimer !== null) window.clearTimeout(bodyPickerUpdateTimer);
  bodyPickerUpdateTimer = window.setTimeout(() => {
    bodyPickerUpdateTimer = null;
    void updateBodyPicker();
  }, SEARCH_INPUT_DEBOUNCE_MS);
}

function scheduleComparePickerUpdate() {
  if (comparePickerUpdateTimer !== null) window.clearTimeout(comparePickerUpdateTimer);
  comparePickerUpdateTimer = window.setTimeout(() => {
    comparePickerUpdateTimer = null;
    void updateComparePicker();
  }, SEARCH_INPUT_DEBOUNCE_MS);
}

function resetPickerSearchState(state: PickerSearchState, options: { preserveActiveOption?: boolean } = {}) {
  state.abortController?.abort();
  state.abortController = undefined;
  state.latestBodies = [];
  state.signature = undefined;
  state.total = undefined;
  state.nextOffset = undefined;
  state.hasMore = false;
  state.loadingMore = false;
  state.fallback = false;
  if (!options.preserveActiveOption) state.activeOptionKey = null;
}

async function updateSearchPicker(config: PickerSearchConfig) {
  if (!ephemeris) return;
  const requestId = ++config.state.requestId;
  config.state.abortController?.abort();
  config.state.abortController = undefined;
  const rawQuery = config.input.value.trim();
  const query = config.queryForSearch ? config.queryForSearch(rawQuery) : rawQuery;
  const guidedSet = config.guidedSet ?? null;
  const shouldUseCatalogSearch = !guidedSet && (query.length >= 3 || (query.length === 0 && config.filter.key !== "all"));
  const searchSignature = pickerSearchSignature(query, config.filter, config.excludeKeys);
  if (!shouldUseCatalogSearch || config.state.signature !== searchSignature) {
    config.state.latestBodies = [];
    config.state.total = undefined;
    config.state.nextOffset = undefined;
    config.state.hasMore = false;
    config.state.fallback = false;
  }
  config.state.signature = shouldUseCatalogSearch ? searchSignature : undefined;
  const abortController = shouldUseCatalogSearch ? new AbortController() : undefined;
  config.state.abortController = abortController;
  if (shouldUseCatalogSearch) {
    config.state.activeOptionKey = null;
    config.input.removeAttribute("aria-activedescendant");
    renderPickerStatus(config.picker, config.loadingMessage, "loading");
  }
  const catalogResult = shouldUseCatalogSearch ? await searchCatalog({ query, filter: config.filter, limit: query ? 80 : 120, signal: abortController?.signal }) : null;
  if (shouldUseCatalogSearch && !abortController?.signal.aborted) trackAnalytics("search", { query_length: query.length, filter: config.filter.key });
  if (config.state.abortController === abortController) config.state.abortController = undefined;
  if (requestId !== config.state.requestId) return;

  const excludeKeys = new Set(config.excludeKeys ?? []);
  config.state.latestBodies = (catalogResult?.bodies ?? []).filter((body) => !excludeKeys.has(body.key));
  config.state.total = catalogResult?.total;
  config.state.nextOffset = catalogResult?.nextOffset;
  config.state.hasMore = Boolean(catalogResult?.hasMore && catalogResult.source === "phoenix");
  config.state.fallback = Boolean(catalogResult?.fallback);

  const sourceBodies = (catalogResult?.bodies ?? config.sourceBodies).filter((body) => {
    if (excludeKeys.has(body.key)) return false;
    return Boolean(guidedSet) || bodyMatchesFilter(body, config.filter);
  });
  const includeTypes = guidedSet ? undefined : config.filter.types;
  const buildOptions = {
    query: catalogResult?.source === "phoenix" ? "" : query,
    selectedKey: config.activeKey,
    currentTargetKey: config.currentTargetKey,
    recentDestinations,
    excludeKeys: config.excludeKeys,
    includeTypes,
    auKm: auKm(),
    maxResults: query ? 80 : 240,
    maxFavorites: 8,
    maxFrequent: 8,
    maxRecent: 8,
    includeAllSection: true
  };

  if (guidedSet || config.filter.key !== "all" || query) {
    const items = buildDestinationPickerItems(sourceBodies, buildOptions);
    const label = query ? t("search.resultsLabel") : guidedSet ? t(guidedSet.labelKey) : t(config.filter.labelKey);
    renderPickerSections(config.picker, [{ label, items }], config.emptyMessage, config.activeKey, config.state.activeOptionKey);
  } else {
    const sections = buildDestinationPickerSections(sourceBodies, buildOptions);
    renderPickerSections(config.picker, sections.filter((section) => section.kind === "all"), config.emptyMessage, config.activeKey, config.state.activeOptionKey);
  }
  if (catalogResult?.fallback) {
    prependPickerStatus(config.picker, config.fallbackMessage, "fallback");
  }
  renderPickerLoadMore(config);
  syncActivePickerOption(config.state, config.input, config.picker);
  config.afterRender?.();
}

function pickerSearchSignature(query: string, filter: BodyFilterDefinition, excludeKeys: readonly string[] = []) {
  return [query, filter.key, filter.groups?.join(",") ?? "", filter.types?.join(",") ?? "", excludeKeys.join(",")].join("|");
}

async function loadMoreSearchResults(kind: "catalog" | "compare") {
  const config = kind === "catalog" ? bodyPickerConfig() : comparePickerConfig();
  if (!config || !ephemeris || config.state.loadingMore || !config.state.hasMore) return;

  const rawQuery = config.input.value.trim();
  const query = config.queryForSearch ? config.queryForSearch(rawQuery) : rawQuery;
  const signature = pickerSearchSignature(query, config.filter, config.excludeKeys);
  if (config.state.signature !== signature) {
    await updateSearchPicker(config);
    return;
  }

  config.state.loadingMore = true;
  renderPickerLoadMore(config);
  try {
    const result = await searchCatalog({
      query,
      filter: config.filter,
      limit: query ? 80 : 120,
      offset: config.state.nextOffset ?? config.state.latestBodies.length
    });
    if (config.state.signature !== signature) return;
    const excludeKeys = new Set(config.excludeKeys ?? []);
    config.state.latestBodies = mergeSearchBodies(config.state.latestBodies, result.bodies, Number.MAX_SAFE_INTEGER).filter((body) => !excludeKeys.has(body.key));
    config.state.total = result.total ?? config.state.total;
    config.state.nextOffset = result.nextOffset;
    config.state.hasMore = Boolean(result.hasMore && result.source === "phoenix");
    config.state.fallback = Boolean(result.fallback);
  } finally {
    config.state.loadingMore = false;
    await updateSearchPickerFromCachedResults(config);
  }
}

async function updateSearchPickerFromCachedResults(config: PickerSearchConfig) {
  if (!ephemeris) return;
  const query = (config.queryForSearch ? config.queryForSearch(config.input.value.trim()) : config.input.value.trim()).trim();
  const excludeKeys = new Set(config.excludeKeys ?? []);
  const sourceBodies = config.state.latestBodies.filter((body) => !excludeKeys.has(body.key));
  const includeTypes = config.filter.types;
  const items = buildDestinationPickerItems(sourceBodies, {
    query: "",
    selectedKey: config.activeKey,
    currentTargetKey: config.currentTargetKey,
    recentDestinations,
    excludeKeys: config.excludeKeys,
    includeTypes,
    auKm: auKm(),
    maxResults: Number.MAX_SAFE_INTEGER
  });
  renderPickerSections(config.picker, [{ label: query ? t("search.resultsLabel") : t(config.filter.labelKey), items }], config.emptyMessage, config.activeKey, config.state.activeOptionKey);
  if (config.state.fallback) prependPickerStatus(config.picker, config.fallbackMessage, "fallback");
  renderPickerLoadMore(config);
  syncActivePickerOption(config.state, config.input, config.picker);
  config.afterRender?.();
}

function renderPickerStatus(container: HTMLElement, message: string, tone: "loading" | "fallback" | "updating") {
  container.innerHTML = `<div class="picker-status picker-status--${tone}" role="status">${escapeHtml(message)}</div>`;
  container.scrollTop = 0;
}

function prependPickerStatus(container: HTMLElement, message: string, tone: "loading" | "fallback") {
  container.insertAdjacentHTML("afterbegin", `<div class="picker-status picker-status--${tone}" role="status">${escapeHtml(message)}</div>`);
}

function renderPickerSections(
  container: HTMLElement,
  sections: { label: string; items: DestinationPickerItem[] }[],
  emptyMessage: string,
  selectedKey: string | null,
  activeOptionKey: string | null
) {
  const previousScrollTop = container.scrollTop;
  container.innerHTML = sections
    .filter((section) => section.items.length > 0)
    .map(
      (section) => `
        <section class="destination-picker__section">
          <h3 class="destination-picker__section-title">${escapeHtml(section.label)}</h3>
          <div class="destination-picker__list" role="listbox" aria-label="${escapeHtml(section.label)}">${section.items.map((item) => renderPickerItem(item, selectedKey, activeOptionKey, container.id)).join("")}</div>
        </section>
      `
    )
    .join("");

  if (!container.innerHTML) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }
  container.scrollTop = activeOptionKey ? previousScrollTop : 0;
}

function renderPickerLoadMore(config: PickerSearchConfig) {
  const existing = config.picker.querySelector<HTMLElement>(".picker-load-more");
  existing?.remove();
  if (!config.state.hasMore && !config.state.loadingMore) return;

  const loaded = config.state.latestBodies.length;
  const total = config.state.total && config.state.total > loaded ? config.state.total : null;
  const detail = total
    ? t("search.loadedOfTotal", { loaded: formatCount(loaded), total: formatCount(total) })
    : t("search.loadedResults", { count: formatCount(loaded) });
  const label = config.state.loadingMore ? t("search.loadingMore") : t("search.loadMore");
  config.picker.insertAdjacentHTML(
    "beforeend",
    `
      <div class="picker-load-more" role="status">
        <span>${escapeHtml(detail)}</span>
        <button type="button" data-picker-load-more ${config.state.loadingMore ? "disabled" : ""}>${escapeHtml(label)}</button>
      </div>
    `
  );
}

function renderPickerItem(item: DestinationPickerItem, selectedKey: string | null = null, activeOptionKey: string | null = null, pickerId = "body-picker") {
  const style = destinationPickerColorStyle(item);
  const isSelected = item.key === selectedKey;
  const isActive = item.key === activeOptionKey;
  return `
    <button
      id="${escapeHtml(pickerOptionId(pickerId, item.key))}"
      type="button"
      role="option"
      class="destination-picker__item${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}"
      data-body-key="${escapeHtml(item.key)}"
      aria-label="${escapeHtml(item.ariaLabel)}"
      aria-selected="${isActive ? "true" : "false"}"
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

function pickerOptionId(pickerId: string, key: string) {
  return `${pickerId}-option-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function visiblePickerOptions(picker: HTMLElement) {
  return Array.from(picker.querySelectorAll<HTMLButtonElement>(".destination-picker__item[data-body-key]"));
}

function syncActivePickerOption(state: PickerSearchState, input: HTMLInputElement, picker: HTMLElement) {
  const options = visiblePickerOptions(picker);
  const activeButton = options.find((button) => button.dataset.bodyKey === state.activeOptionKey) ?? null;
  options.forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  if (activeButton) {
    state.activeOptionKey = activeButton.dataset.bodyKey ?? null;
    input.setAttribute("aria-activedescendant", activeButton.id);
    activeButton.scrollIntoView({ block: "nearest" });
  } else {
    state.activeOptionKey = null;
    input.removeAttribute("aria-activedescendant");
  }
}

function moveActivePickerOption(state: PickerSearchState, input: HTMLInputElement, picker: HTMLElement, destination: "next" | "previous" | "first" | "last") {
  const options = visiblePickerOptions(picker);
  if (options.length === 0) return false;
  const currentIndex = options.findIndex((button) => button.dataset.bodyKey === state.activeOptionKey);
  let nextIndex = 0;
  if (destination === "last") nextIndex = options.length - 1;
  else if (destination === "next") nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, options.length - 1);
  else if (destination === "previous") nextIndex = currentIndex < 0 ? options.length - 1 : Math.max(currentIndex - 1, 0);
  state.activeOptionKey = options[nextIndex]?.dataset.bodyKey ?? null;
  syncActivePickerOption(state, input, picker);
  return true;
}

function handlePickerKeyboard(
  event: KeyboardEvent,
  options: {
    state: PickerSearchState;
    input: HTMLInputElement;
    picker: HTMLElement;
    onSelect: (key: string) => void;
    onFallbackEnter: () => void;
    onEscapeClear: () => void;
  }
) {
  if (event.key === "ArrowDown") return moveActivePickerOption(options.state, options.input, options.picker, "next");
  if (event.key === "ArrowUp") return moveActivePickerOption(options.state, options.input, options.picker, "previous");
  if (event.key === "Enter") {
    const activeKey = options.state.activeOptionKey;
    if (activeKey) options.onSelect(activeKey);
    else options.onFallbackEnter();
    return true;
  }
  if (event.key === "Escape") {
    if (options.state.activeOptionKey) {
      options.state.activeOptionKey = null;
      syncActivePickerOption(options.state, options.input, options.picker);
    } else if (options.input.value) {
      options.input.value = "";
      options.state.latestBodies = [];
      options.onEscapeClear();
    } else {
      return false;
    }
    return true;
  }
  return false;
}

function updateGuidedSets() {
  guidedTours.innerHTML = GUIDED_SETS.map((tour) => {
    const available = tour.keys.map((key) => bodyByKey.get(key)).filter(isPresent);
    if (available.length === 0) return "";
    return `
      <button type="button" data-tour-id="${escapeHtml(tour.id)}" class="${tour.id === activeGuidedSetId ? "active" : ""}">
        <strong>${escapeHtml(t(tour.labelKey))}</strong>
        <span>${escapeHtml(t("search.objectsCount", { count: available.length }))}</span>
      </button>
    `;
  }).join("");
}

function activeGuidedSet() {
  return GUIDED_SETS.find((tour) => tour.id === activeGuidedSetId) ?? null;
}

function exploreSourceBodies() {
  const tour = activeGuidedSet();
  if (!tour) return ephemeris?.bodies ?? [];
  return tour.keys.map((key) => bodyByKey.get(key)).filter(isPresent);
}

function updateBodyInfo() {
  const body = selectedBody();
  if (!body) {
    bodyInfo.innerHTML = renderObjectEmptyState();
    return;
  }

  const classification = classifyBody(body);
  const positionModel = readablePositionModel(body.catalog?.position_model ?? body.catalog?.source_type ?? "");
  const parentBody = body.parent_key ? bodyByKey.get(body.parent_key) ?? null : null;
  const overviewRows = [
    [t("field.type"), classification.label],
    [t("field.radius"), body.radius_km > 0 ? formatDistance(body.radius_km) : t("value.unknown")],
    [t("field.parent"), parentBody?.name ?? body.parent_key ?? null],
    [t("field.catalogGroup"), readableCatalogGroup(body.catalog_group ?? body.catalog?.catalog_group)]
  ];
  const primaryStats = [
    [t("field.earthDistance"), formatDistance(body.distance_from_earth_km)],
    [t("field.diameter"), body.radius_km > 0 ? formatDistance(body.radius_km * 2) : t("value.unknown")],
    [t("field.heliocentric"), formatDistance(body.position.heliocentric_distance_km)]
  ];

  const positionRows = [
    [t("field.coordinateFrame"), ephemeris?.coordinate_frame ?? null],
    [t("field.positionModel"), positionModel],
    [t("field.rightAscension"), formatRightAscensionForBody(body)],
    [t("field.declination"), formatDeclinationForBody(body)],
    [t("field.raDecDecimal"), formatRaDecDecimal(body)],
    [t("field.galacticLongitude"), formatGalacticLongitude(body)],
    [t("field.galacticLatitude"), formatGalacticLatitude(body)],
    [t("field.eclipticLongitude"), formatEclipticLongitude(body)],
    [t("field.eclipticLatitude"), formatEclipticLatitude(body)],
    [t("field.eclipticRadius"), formatEclipticRadius(body)],
    [t("field.eclipticX"), formatAuCoordinate(body.position.x_au)],
    [t("field.eclipticY"), formatAuCoordinate(body.position.y_au)],
    [t("field.eclipticZ"), formatAuCoordinate(body.position.z_au)]
  ];

  const stateRows = body.state_vector
    ? [
        [t("field.parentRelativeSpeed"), `${formatNumber(body.state_vector.speed_km_s)} km/s`],
        [t("field.heliocentricSpeed"), `${formatNumber(body.state_vector.heliocentric_speed_km_s)} km/s`],
        [t("field.parentRelativeDistance"), formatDistance(body.state_vector.distance_km)]
      ]
    : [];

  const orbitRows = body.orbit
    ? [
        [t("field.orbitClass"), body.orbit.orbit_class],
        [t("field.semiMajorAxis"), nullableDistance(body.orbit.semi_major_axis_km)],
        [t("field.eccentricity"), nullableNumber(body.orbit.eccentricity, 4)],
        [t("field.inclination"), nullableDegrees(body.orbit.inclination_deg)],
        [t("field.periapsis"), nullableDistance(body.orbit.periapsis_km)],
        [t("field.apoapsis"), nullableDistance(body.orbit.apoapsis_km)],
        [t("field.ascendingNode"), nullableDegrees(body.orbit.longitude_of_ascending_node_deg)],
        [t("field.argumentOfPeriapsis"), nullableDegrees(body.orbit.argument_of_periapsis_deg)],
        [t("field.trueAnomaly"), nullableDegrees(body.orbit.true_anomaly_deg)],
        [t("field.period"), nullableDays(body.orbit.orbital_period_days)]
      ]
    : [];

  const stellarRows = body.stellar
    ? [
        ["HIP", body.stellar.hip ? `HIP ${body.stellar.hip}` : null],
        ["HD", body.stellar.hd ? `HD ${body.stellar.hd}` : null],
        [t("field.catalogDistance"), nullableLightYears(body.stellar.distance_ly)],
        [t("field.parallax"), body.stellar.parallax_mas ? `${formatNumber(body.stellar.parallax_mas)} mas` : null],
        [t("field.apparentMagnitude"), nullableNumber(body.stellar.apparent_magnitude, 2)],
        [t("field.absoluteMagnitude"), nullableNumber(body.stellar.absolute_magnitude, 2)],
        [t("field.bvColorIndex"), nullableNumber(body.stellar.bv_color_index, 3)],
        ...(body.stellar.exoplanet_count != null ? [[t("field.knownPlanets"), nullableNumber(body.stellar.exoplanet_count, 0)]] : []),
        ...(body.stellar.stellar_teff_k ? [[t("field.temperature"), `${formatNumber(body.stellar.stellar_teff_k)} K`]] : []),
        ...(body.stellar.stellar_mass_solar ? [[t("field.mass"), `${formatNumber(body.stellar.stellar_mass_solar)} ${t("value.solarMasses")}`]] : []),
        ...(body.stellar.stellar_radius_solar ? [[t("field.radius"), `${formatNumber(body.stellar.stellar_radius_solar)} ${t("value.solarRadii")}`]] : []),
        ...(body.stellar.spectral_type ? [[t("field.spectralType"), body.stellar.spectral_type]] : []),
        [t("field.radiusSource"), body.stellar.stellar_radius_source ?? null]
      ]
    : [];

  const exoplanetRows = body.exoplanet_system
    ? [
        [t("field.confirmedPlanets"), nullableNumber(body.exoplanet_system.confirmed_planet_count ?? body.exoplanet_system.planets?.length, 0)],
        [t("field.starsInSystem"), nullableNumber(body.exoplanet_system.system_star_count, 0)],
        [t("field.moonsInArchive"), nullableNumber(body.exoplanet_system.system_moon_count, 0)]
      ]
    : [];

  const deepSkyRows = body.deep_sky
    ? [
        [t("field.commonName"), body.deep_sky.common_name ?? null],
        [t("field.deepSkyType"), body.deep_sky.deep_sky_type_label ?? t("value.unknown")],
        [t("field.magnitude"), nullableNumber(body.deep_sky.apparent_magnitude, 1)],
        [t("field.constellation"), body.deep_sky.constellation ?? t("value.unknown")],
        [t("field.viewingSeason"), body.deep_sky.viewing_season ?? t("value.unknown")],
        [t("field.angularSize"), body.deep_sky.angular_size_arcmin ?? t("value.unknown")],
        [t("field.physicalDiameter"), body.deep_sky.physical_diameter_ly ? `${formatNumber(body.deep_sky.physical_diameter_ly)} ly` : t("value.unknown")],
        [t("field.minorDiameter"), body.deep_sky.physical_minor_diameter_ly ? `${formatNumber(body.deep_sky.physical_minor_diameter_ly)} ly` : null],
        [t("field.sizeNote"), body.deep_sky.physical_size_note ?? null],
        [t("field.equipment"), body.deep_sky.observing_equipment ?? null]
      ]
    : [];

  const smallBodyRows = body.small_body
    ? [
        [t("field.orbitClass"), body.small_body.orbit_class ?? t("value.unknown")],
        [t("field.nearEarthObject"), body.small_body.neo == null ? null : body.small_body.neo ? t("value.yes") : t("value.no")],
        [t("field.potentiallyHazardous"), body.small_body.pha == null ? null : body.small_body.pha ? t("value.yes") : t("value.no")],
        [t("field.diameter"), body.small_body.diameter_km ? formatDistance(body.small_body.diameter_km) : body.small_body.estimated_diameter_km ? `${formatDistance(body.small_body.estimated_diameter_km)} ${t("value.estimated")}` : null],
        [t("field.absoluteMagnitudeH"), nullableNumber(body.small_body.h_absolute_magnitude, 2)],
        [t("field.semiMajorAxis"), body.small_body.semi_major_axis_au ? `${formatNumber(body.small_body.semi_major_axis_au)} AU` : null],
        [t("field.perihelion"), body.small_body.perihelion_au ? `${formatNumber(body.small_body.perihelion_au)} AU` : null],
        [t("field.aphelion"), body.small_body.aphelion_au ? `${formatNumber(body.small_body.aphelion_au)} AU` : null],
        [t("field.eccentricity"), nullableNumber(body.small_body.eccentricity, 4)],
        [t("field.inclination"), nullableDegrees(body.small_body.inclination_deg)],
        [t("field.period"), nullableDays(body.small_body.orbital_period_days)],
        [t("field.earthMoid"), body.small_body.earth_moid_au ? `${formatNumber(body.small_body.earth_moid_au)} AU` : null]
      ]
    : [];

  bodyInfo.innerHTML = `
    <article class="selected-object selected-object--context" style="--body-color: ${escapeHtml(body.color)}">
      <section class="object-data-pane">
        ${renderObjectDetailState(body)}
        ${renderObjectSummaryCard(body, classification.label)}
        ${renderFactTiles(primaryStats)}
        ${renderUniverseSciencePanel(body)}
        ${renderObservePanel(body)}
        ${renderIdentifierSection(body)}
        ${renderMediaSection(body)}
        ${renderDataSection(t("section.overview"), overviewRows)}
        ${renderDataSection(t("section.position"), positionRows)}
        ${renderDataSection(t("section.motion"), stateRows)}
        ${renderDataSection(t("section.orbit"), orbitRows)}
        ${renderDataSection(t("section.stellarFacts"), stellarRows)}
        ${renderDataSection(t("section.confirmedExoplanets"), exoplanetRows, renderExoplanetList(body.exoplanet_system?.planets ?? []))}
        ${renderDataSection(t("section.deepSkyFacts"), deepSkyRows)}
        ${renderDataSection(t("section.smallBodyFacts"), smallBodyRows)}
        ${renderObjectNotes(body)}
        ${renderSourceSection(body)}
        ${renderRelatedObjects(body)}
      </section>
    </article>
  `;
}

function renderObservePanel(body: Body) {
  return `<section class="observe-panel" data-observe-key="${escapeHtml(body.key)}"><div class="section-heading"><span>${escapeHtml(t("launch.skyTonight"))}</span></div><p>${escapeHtml(t("launch.observeHelp"))}</p><div class="observe-fields"><label>${escapeHtml(t("launch.latitude"))} <input id="observe-lat" inputmode="decimal"></label><label>${escapeHtml(t("launch.longitude"))} <input id="observe-lon" inputmode="decimal"></label></div><button type="button" data-observe-location="manual">${escapeHtml(t("launch.calculate"))}</button> <button type="button" data-observe-location="browser">${escapeHtml(t("launch.useLocation"))}</button><p id="observe-result" role="status"></p></section>`;
}

async function requestObservation(useBrowser: boolean) {
  const panel=bodyInfo.querySelector<HTMLElement>("[data-observe-key]"); const result=panel?.querySelector<HTMLElement>("#observe-result"); if(!panel||!result)return; result.textContent=useBrowser?t("launch.requestingLocation"):t("launch.calculating");
  try {
    const latValue=panel.querySelector<HTMLInputElement>("#observe-lat")?.value.trim()??""; const lonValue=panel.querySelector<HTMLInputElement>("#observe-lon")?.value.trim()??""; let lat=latValue===""?Number.NaN:Number(latValue); let lon=lonValue===""?Number.NaN:Number(lonValue);
    if(useBrowser){const pos=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:10_000,maximumAge:300_000}));lat=pos.coords.latitude;lon=pos.coords.longitude;}
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)throw new Error(t("launch.invalidCoordinates"));
    const response=await fetch(`/api/observe?${new URLSearchParams({key:panel.dataset.observeKey??"",lat:String(lat),lon:String(lon)})}`);if(!response.ok)throw new Error(t("launch.observeUnavailable"));
    const p=await response.json() as {altitude_deg:number;azimuth_deg:number;summary:string;accuracy_note:string};result.textContent=t("launch.altAz",{summary:p.summary,altitude:p.altitude_deg.toFixed(1),azimuth:p.azimuth_deg.toFixed(1),note:p.accuracy_note});
  }catch(error){result.textContent=error instanceof Error?error.message:t("launch.observeFailed");}
}

async function loadNowEvents() {
  try {const response=await fetch("/api/now");if(!response.ok)throw new Error();const p=await response.json() as {stale:boolean;refreshed_at:string|null;events:{title:string;summary:string;starts_at:string;url:string;catalog_key:string|null}[]};nowStatus.textContent=p.stale?t("launch.eventsCached",{date:p.refreshed_at?new Date(p.refreshed_at).toLocaleString():t("launch.unknown")}):t("launch.eventsUpdated",{date:new Date(p.refreshed_at??Date.now()).toLocaleString()});nowEvents.innerHTML=p.events.slice(0,6).map(item=>`<li><a href="${escapeHtml(item.url)}" ${item.catalog_key?"":`target="_blank" rel="noopener noreferrer"`}>${escapeHtml(item.title)}</a><time datetime="${escapeHtml(item.starts_at)}">${escapeHtml(new Date(item.starts_at).toLocaleDateString())}</time><p>${escapeHtml(item.summary)}</p></li>`).join("");}catch{nowStatus.textContent=t("launch.eventsUnavailable");}
}

function renderObjectEmptyState() {
  return `
    <section class="object-empty-state">
      <h2>${escapeHtml(t("object.noSelectionTitle"))}</h2>
      <p>${escapeHtml(t("object.noSelectionBody"))}</p>
    </section>
  `;
}

function renderObjectDetailState(body: Body) {
  const hydrationState = objectDetailHydrationStates.get(body.key);
  if (hydrationState?.status === "loading") {
    return `
      <section class="object-detail-state object-detail-state--loading" aria-label="${escapeHtml(t("object.detailLoading"))}" role="status">
        <strong>${escapeHtml(t("object.detailLoading"))}</strong>
        <span>${escapeHtml(t("object.detailLoadingBody"))}</span>
      </section>
    `;
  }
  if (hydrationState?.status === "error") {
    return `
      <section class="object-detail-state object-detail-state--error" aria-label="${escapeHtml(t("object.detailError"))}" role="status">
        <strong>${escapeHtml(t("object.detailError"))}</strong>
        <span>${escapeHtml(hydrationState.message || t("object.detailErrorBody"))}</span>
      </section>
    `;
  }
  if (!body.catalog?.preview) return "";
  return `
    <section class="object-detail-state" aria-label="Object detail state">
      <strong>${escapeHtml(t("object.catalogPreview"))}</strong>
      <span>${escapeHtml(t("object.catalogPreviewBody"))}</span>
    </section>
  `;
}

function renderObjectSummaryCard(body: Body, typeLabel: string) {
  const summary = objectSummaryText(body, typeLabel);
  const contextItems = objectSummaryContext(body);
  return `
    <section class="object-summary-card" aria-label="${escapeHtml(t("object.whyThisMatters"))}">
      <div>
        <span>${escapeHtml(t("object.whyThisMatters"))}</span>
        <p>${escapeHtml(summary)}</p>
      </div>
      ${
        contextItems.length > 0
          ? `<ul>${contextItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
  `;
}

function renderUniverseSciencePanel(body: Body) {
  const distanceLy = body.distance_from_earth_km / 9_460_730_472_580.8;
  if (distanceLy < 100_000) return "";
  const shell = universeShellForRadius(distanceLy);
  const classification = classifyBody(body);
  const record = { position_model: body.catalog?.position_model, facts: body.catalog?.facts };
  const redshift = measuredRedshift(record);
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const chips = [
    [t("universe.context.distance"), formatLightYears(distanceLy)],
    ...(redshift == null ? [] : [["Catalog spectroscopic redshift", String(redshift)]]),
    ...(semantics?.cosmology && semantics.distance_kind
      ? [["Distance convention", `${semantics.distance_kind.replace(/_/g, " ")} · ${semantics.cosmology.name}`]]
      : []),
    [t("universe.context.shell"), t(shell.labelKey)]
  ];
  return `
    <section class="object-science-panel">
      <div class="object-science-panel__heading">
        <span>${escapeHtml(t("object.scienceContext"))}</span>
        <strong>${escapeHtml(t("object.cosmicTimeMachine"))}</strong>
      </div>
      <p>${escapeHtml(t("object.scienceContextBody", { name: body.name, type: classification.label.toLowerCase() }))}</p>
      <dl>${chips.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <p class="science-caveat">${escapeHtml(uncertaintySummary(record))}</p>
      <a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.readMethodology"))}</a>
    </section>
  `;
}

function objectSummaryText(body: Body, typeLabel: string) {
  const curated = firstText([body.exoplanet_system?.why_interesting, body.deep_sky?.why_interesting]);
  if (curated) return curated;
  const curatedSummary = CURATED_OBJECT_SUMMARIES[body.key.toLowerCase()] ?? curatedAliasSummary(body);
  if (curatedSummary) return curatedSummary;

  const name = body.name;
  switch (body.object_type) {
    case "planet":
      return t("summary.planet", { name });
    case "moon":
      return t("summary.moon", { name });
    case "star":
      return body.stellar?.exoplanet_count ? t("summary.exoplanetHost", { name, count: body.stellar.exoplanet_count }) : t("summary.star", { name });
    case "dwarf_planet":
      return t("summary.dwarfPlanet", { name });
    case "galaxy":
      return t("summary.galaxy", { name });
    case "quasar":
      return t("summary.quasar", { name });
    case "active_galaxy":
      return t("summary.activeGalaxy", { name });
    case "nebula":
      return t("summary.nebula", { name });
    case "star_cluster":
      return t("summary.starCluster", { name });
    case "asteroid":
    case "comet":
    case "small_body":
      return t("summary.smallBody", { name });
    default:
      if (body.exoplanet_system) return t("summary.exoplanetSystem", { name });
      return t("summary.generic", { name, type: typeLabel.toLowerCase() });
  }
}

function curatedAliasSummary(body: Body) {
  const aliases = [body.name, ...(body.aliases ?? []), ...(body.catalog?.aliases ?? []), ...(body.deep_sky?.aliases ?? []), body.deep_sky?.common_name ?? ""];
  for (const alias of aliases) {
    const key = alias.trim().toLowerCase();
    if (key === "great globular cluster in hercules" || key === "hercules globular cluster" || key === "ngc 6205") return CURATED_OBJECT_SUMMARIES.m13;
    if (key === "andromeda galaxy") return CURATED_OBJECT_SUMMARIES.m31;
    if (key === "orion nebula" || key === "great nebula in orion") return CURATED_OBJECT_SUMMARIES.m42;
    if (key === "pleiades" || key === "seven sisters") return CURATED_OBJECT_SUMMARIES.m45;
    if (key === "ring nebula") return CURATED_OBJECT_SUMMARIES.m57;
  }
  return null;
}

function objectSummaryContext(body: Body) {
  const items = [
    body.deep_sky?.constellation ? t("summary.contextConstellation", { value: body.deep_sky.constellation }) : null,
    body.deep_sky?.viewing_season ? t("summary.contextSeason", { value: body.deep_sky.viewing_season }) : null,
    body.exoplanet_system?.confirmed_planet_count != null
      ? t("summary.contextPlanets", { count: body.exoplanet_system.confirmed_planet_count })
      : null,
    body.stellar?.distance_ly != null ? t("summary.contextDistance", { value: formatNumber(body.stellar.distance_ly) }) : null,
    body.small_body?.neo ? t("summary.contextNeo") : null,
    body.catalog_group ? t("summary.contextCatalog", { value: readableCatalogGroup(body.catalog_group) ?? body.catalog_group }) : null
  ].filter(isPresent);
  return items.slice(0, 3);
}

function firstText(values: readonly (string | null | undefined)[]) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function renderIdentifierSection(body: Body) {
  const aliases = aliasesForBody(body);
  const identifiers = externalIdentifierEntries(body);
  if (aliases.length === 0 && identifiers.length === 0) return "";
  return `
    <section class="data-section object-identifiers">
      <h3>${escapeHtml(t("object.aliasesIds"))}</h3>
      ${aliases.length ? `<div class="identifier-chips">${aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("")}</div>` : ""}
      ${
        identifiers.length
          ? `<dl class="detail-grid">${identifiers
              .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
              .join("")}</dl>`
          : ""
      }
    </section>
  `;
}

function renderMediaSection(body: Body) {
  return `
    <section class="data-section object-media-section">
      <h3>${escapeHtml(t("object.media"))}</h3>
      ${renderObjectMedia(body)}
    </section>
  `;
}

function renderObjectNotes(body: Body) {
  const notes = [body.exoplanet_system?.why_interesting, body.deep_sky?.why_interesting, ...(body.orbit?.notes ?? [])].filter(isPresent);
  if (notes.length === 0) return "";
  return `
    <section class="data-section object-notes">
      <h3>${escapeHtml(t("object.scientificNotes"))}</h3>
      ${notes.map((note) => `<p class="object-note">${escapeHtml(note)}</p>`).join("")}
    </section>
  `;
}

function renderSourceSection(body: Body) {
  const links = externalLinksForBody(body);
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const sourceRows = [
    [t("field.catalogSource"), readableOptionalModel(body.catalog?.source_type)],
    [t("field.positionModel"), readableOptionalModel(body.catalog?.position_model)],
    [t("field.catalogGroup"), readableCatalogGroup(body.catalog_group ?? body.catalog?.catalog_group)],
    [t("field.atlasSource"), ephemeris?.data_source ?? null],
    [t("field.epoch"), ephemeris?.timestamp_utc ? formatFullDate(ephemeris.timestamp_utc) : null],
    ["Distance kind", semantics?.distance_kind?.replace(/_/g, " ") ?? null],
    ["Catalog epoch", semantics?.catalog_epoch ?? null],
    ["Position epoch", semantics?.position_epoch ?? null],
    ["Uncertainty", uncertaintySummary({ position_model: body.catalog?.position_model, facts: body.catalog?.facts })],
    ["Selection caveat", semantics?.selection_caveat ?? null]
  ];
  const rows = renderRows(sourceRows);
  if (!rows && links.length === 0) return "";
  return `
    <section class="data-section object-sources">
      <h3>${escapeHtml(t("object.sourceLinks"))}</h3>
      ${rows ? `<dl class="detail-grid">${rows}</dl>` : ""}
      <div class="science-actions"><a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.readMethodology"))}</a><button type="button" class="text-action" data-copy-citation="${escapeHtml(body.key)}">${escapeHtml(t("launch.copyCitation"))}</button></div>
      ${
        links.length
          ? `<div class="source-link-list">${links
              .map(
                (link) => `
                  <a href="${escapeHtml(link.url ?? "")}" target="_blank" rel="noreferrer">
                    <span>${escapeHtml(link.provider ?? t("object.source"))}</span>
                    <strong>${escapeHtml(link.label ?? t("object.openSourceRecord"))}</strong>
                  </a>
                `
              )
              .join("")}</div>`
          : ""
      }
    </section>
  `;
}

async function copyCitationDetails(body: Body, button: HTMLButtonElement) {
  const semantics = scienceSemanticsFor(body.catalog?.position_model);
  const identifiers = Object.entries(body.catalog?.external_ids ?? {})
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${value}`);
  const sourceDate = body.catalog?.source?.generated_at_utc ?? body.catalog?.source?.accessed_at_utc ?? body.catalog?.source?.build_date ?? "Not supplied";
  const citation = [
    `Cosmic Atlas object: ${body.name}`,
    `Stable atlas key: ${body.key}`,
    identifiers.length ? `Source identifiers: ${identifiers.join(", ")}` : "Source identifiers: Not supplied",
    `Source: ${semantics?.source.label ?? body.catalog?.source_type ?? "Not supplied"}`,
    `Source URL/DOI: ${semantics?.source.doi_url ?? semantics?.source.url ?? externalLinksForBody(body)[0]?.url ?? "Not supplied"}`,
    `Catalog release: ${semantics?.source.release ?? "Not supplied"}`,
    `Position model: ${body.catalog?.position_model ?? "Not supplied"}`,
    `Access/build date: ${String(sourceDate)}`,
    `Cosmic Atlas release: ${catalogPointTileManifest?.version ?? "application release not supplied"}`,
    `Sampling context: ${citationSamplingContext(body)}`
  ].join("\n");
  await navigator.clipboard.writeText(citation);
  const previous = button.textContent;
  button.textContent = t("launch.citationCopied");
  window.setTimeout(() => (button.textContent = previous), 1600);
  trackEvent("citation_copied", { source: body.catalog?.source_type ?? "unknown" });
}

function citationSamplingContext(body: Body) {
  const layer = catalogPointTileManifest?.layers.find((candidate) => candidate.groups.includes(body.catalog_group ?? ""));
  if (!layer) return "Selected named object; no static-layer sampling metadata applies.";
  const level = closestLayerLevel(layer);
  if (!level) return `${layer.id}; sampling metadata unavailable.`;
  const rate = level.raw_point_count && level.point_count != null ? level.point_count / level.raw_point_count : 1;
  return `${layer.id}, displayed ${formatCount(level.point_count ?? 0)} of ${formatCount(level.raw_point_count ?? level.point_count ?? 0)} at this LOD (${formatPercent(rate)}), release ${catalogPointTileManifest?.version}.`;
}

function closestLayerLevel(layer: CatalogPointTileManifestLayer) {
  const targetSpan = Math.max(1, currentViewWidthLy() * AU_PER_LIGHT_YEAR / 2);
  return [...layer.levels].sort((a, b) => Math.abs(Math.log2(a.span_au / targetSpan)) - Math.abs(Math.log2(b.span_au / targetSpan)))[0] ?? null;
}

function formatPercent(value: number) {
  return `${Math.min(100, Math.max(0, value * 100)).toLocaleString(undefined, { maximumFractionDigits: value < 0.01 ? 3 : 1 })}%`;
}

function updateScienceLayerDisclosure() {
  if (!catalogPointTileManifest) return;
  const rows = catalogPointTileManifest.layers.map((layer) => {
    const available = Object.values(layer.source_counts).reduce((sum, count) => sum + count, 0);
    const level = closestLayerLevel(layer);
    const displayed = level?.point_count ?? available;
    const raw = level?.raw_point_count ?? displayed;
    const rate = raw > 0 ? displayed / raw : 1;
    const context: Record<string, string> = {
      gaia_stars: "Gaia positive-parallax quality tiers; parallax and magnitude cuts vary by tier. Not a complete stellar census.",
      desi_dr1: "DESI DR1 successful spectroscopy and target/class cuts inside the DESI footprint.",
      quaia_g20: "Quaia G<20 quasar candidates with inferred redshifts; near-all-sky selection is not spectroscopic completeness.",
      deep_sky: "Named and literature-compiled catalogs with heterogeneous selection and coverage."
    };
    return `<section><strong>${escapeHtml(layer.id.replace(/_/g, " "))}</strong><dl><div><dt>${escapeHtml(t("launch.sourceObjects"))}</dt><dd>${escapeHtml(formatCount(available))}</dd></div><div><dt>${escapeHtml(t("launch.displayedAvailable"))}</dt><dd>${escapeHtml(formatCount(displayed))} / ${escapeHtml(formatCount(raw))}</dd></div><div><dt>${escapeHtml(t("launch.sampleRate"))}</dt><dd>${escapeHtml(formatPercent(rate))}</dd></div><div><dt>${escapeHtml(t("launch.release"))}</dt><dd>${escapeHtml(catalogPointTileManifest!.version)}</dd></div></dl><p>${escapeHtml(context[layer.id] ?? t("launch.methodologyCaveat"))}</p></section>`;
  });
  scienceLayerDisclosure.innerHTML = rows.join("");
}

function renderRelatedObjects(body: Body) {
  const sections = relatedObjectSections(body);
  if (sections.length === 0) return "";
  return `
    <section class="data-section object-related">
      <h3>${escapeHtml(t("object.relatedObjects"))}</h3>
      <div class="related-section-list">
        ${sections
          .map(
            (section) => `
              <section class="related-section">
                <h4>${escapeHtml(section.title)}</h4>
                <div class="related-object-grid">
                  ${section.bodies.map((related) => renderRelatedObjectButton(body, related)).join("")}
                </div>
              </section>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderObjectMedia(body: Body) {
  const media = objectMediaFor(body);
  if (!media) {
    const status = objectMediaStatusFor(body);
    return `
      <section class="object-media object-media--empty" aria-label="${escapeHtml(t("object.mediaStatus"))}">
        <div class="object-media__empty">
          <span class="object-media__badge">${escapeHtml(status.badge)}</span>
          <strong>${escapeHtml(status.title)}</strong>
          <p>${escapeHtml(status.description)}</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="object-media object-media--${escapeHtml(media.kind)}" aria-label="${escapeHtml(t("object.mediaLabel"))}">
      <div class="object-media__image">
        <img src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <span class="object-media__badge">${escapeHtml(media.badge)}</span>
      </div>
      <div class="object-media__caption">
        <strong>${escapeHtml(media.title)}</strong>
        ${media.description ? `<p>${escapeHtml(media.description)}</p>` : ""}
        <span>${escapeHtml(media.credit)}</span>
        <a href="${escapeHtml(media.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(media.license)}</a>
      </div>
    </section>
  `;
}

function aliasesForBody(body: Body) {
  return uniqueTextValues([...(body.aliases ?? []), ...(body.catalog?.aliases ?? []), ...(body.deep_sky?.aliases ?? []), body.deep_sky?.common_name ?? null])
    .filter((alias) => alias.toLowerCase() !== body.name.toLowerCase())
    .slice(0, 16);
}

function externalIdentifierEntries(body: Body): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(body.catalog?.external_ids ?? {})) {
    const formatted = identifierValue(value);
    if (formatted) entries.push([identifierLabel(key), formatted]);
  }
  if (body.stellar?.hip) entries.push(["HIP", `HIP ${body.stellar.hip}`]);
  if (body.stellar?.hd) entries.push(["HD", `HD ${body.stellar.hd}`]);
  return uniquePairs(entries).slice(0, 12);
}

function externalLinksForBody(body: Body) {
  const classification = classifyBody(body);
  const lookupName = body.deep_sky?.common_name || body.name;
  const generatedLinks: ExternalLink[] = [];

  if (["star", "star_cluster", "nebula", "galaxy", "quasar", "active_galaxy", "black_hole"].includes(classification.type)) {
    generatedLinks.push({
      provider: "SIMBAD",
      label: "SIMBAD object lookup",
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(lookupName)}`
    });
  }

  if (["galaxy", "quasar", "active_galaxy", "black_hole"].includes(classification.type)) {
    generatedLinks.push({
      provider: "NED",
      label: "NASA/IPAC Extragalactic Database lookup",
      url: `https://ned.ipac.caltech.edu/byname?objname=${encodeURIComponent(lookupName)}`
    });
  }

  if (body.catalog?.source_type === "jpl_sbdb_query" || body.key.startsWith("jpl-sbdb-")) {
    const spkId = identifierValue(body.catalog?.external_ids?.jpl_spkid) ?? body.name;
    generatedLinks.push({
      provider: "NASA/JPL SBDB",
      label: "Small-Body Database lookup",
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(spkId)}`
    });
  }

  return normalizeExternalLinks([...(body.catalog?.external_links ?? []), ...generatedLinks]);
}

function relatedObjectSections(body: Body): { title: string; bodies: Body[] }[] {
  const sections: { title: string; bodies: Body[] }[] = [];
  const seen = new Set([body.key]);
  const append = (title: string, bodies: Body[]) => {
    const uniqueBodies = bodies.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
    if (uniqueBodies.length > 0) sections.push({ title, bodies: uniqueBodies });
  };

  const parent = body.parent_key ? bodyByKey.get(body.parent_key) ?? null : null;
  append(t("object.parentBody"), parent ? [parent] : []);
  append(t("object.moonsChildren"), childrenForBody(body).slice(0, 8));
  append(t("object.nearbyInView"), nearbyVisibleBodies(body).slice(0, 6));
  append(t("object.sameCatalog"), sameCatalogNeighbors(body).slice(0, 6));

  return sections;
}

function renderRelatedObjectButton(source: Body, related: Body) {
  const classification = classifyBody(related);
  const distanceLabel = formatDistance(bodyDistanceKm(source, related));
  return `
    <button type="button" class="related-object" data-related-key="${escapeHtml(related.key)}" style="--body-color: ${escapeHtml(related.color)}">
      <span class="body-orb"></span>
      <span>
        <strong>${escapeHtml(shortBodyName(related.name))}</strong>
        <small>${escapeHtml(classification.label)} · ${escapeHtml(distanceLabel)} ${escapeHtml(t("object.fromSource", { name: shortBodyName(source.name) }))}</small>
      </span>
    </button>
  `;
}

function childrenForBody(body: Body) {
  return (ephemeris?.bodies ?? [])
    .filter((candidate) => candidate.parent_key === body.key)
    .sort((a, b) => a.distance_from_earth_km - b.distance_from_earth_km);
}

function nearbyVisibleBodies(body: Body) {
  const viewport = usableViewportRect();
  return (ephemeris?.bodies ?? [])
    .filter((candidate) => {
      if (candidate.key === body.key) return false;
      const screen = worldToScreen(candidate.position.x_au, candidate.position.y_au);
      return pointInRect(screen, viewport);
    })
    .sort((a, b) => bodyDistanceKm(body, a) - bodyDistanceKm(body, b));
}

function sameCatalogNeighbors(body: Body) {
  const catalogGroup = body.catalog_group ?? body.catalog?.catalog_group;
  if (!catalogGroup) return [];
  return (ephemeris?.bodies ?? [])
    .filter((candidate) => candidate.key !== body.key && (candidate.catalog_group ?? candidate.catalog?.catalog_group) === catalogGroup)
    .sort((a, b) => bodyDistanceKm(body, a) - bodyDistanceKm(body, b));
}

function renderExoplanetList(planets: BodyExoplanet[]) {
  if (planets.length === 0) return "";
  const visiblePlanets = planets.slice(0, 8);
  const hiddenCount = Math.max(0, planets.length - visiblePlanets.length);
  return `
    <ol class="planet-list">
      ${visiblePlanets
        .map((planet) => {
          const facts = [
            planet.semi_major_axis_au ? `${formatNumber(planet.semi_major_axis_au)} AU` : null,
            planet.period_days ? `${formatNumber(planet.period_days)} d` : null,
            planet.radius_earth ? `${formatNumber(planet.radius_earth)} Earth radii` : null,
            planet.discovery_year ? String(planet.discovery_year) : null
          ].filter(isPresent);
          return `<li><strong>${escapeHtml(planet.name)}</strong><span>${escapeHtml(facts.join(" · ") || t("object.planetParametersIncomplete"))}</span></li>`;
        })
        .join("")}
    </ol>
    ${hiddenCount ? `<p class="object-note">${escapeHtml(t("object.moreConfirmedPlanets", { count: hiddenCount, planetWord: t(hiddenCount === 1 ? "object.planetSingular" : "object.planetPlural") }))}</p>` : ""}
  `;
}

function renderFactTiles(rows: (string | number | null | undefined)[][]) {
  const tiles = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return `
    <dl class="fact-tiles">
      ${tiles.map(([label, value]) => `<div><dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}
    </dl>
  `;
}

function renderDataSection(title: string, rows: (string | number | null | undefined)[][], extra = "") {
  const values = renderRows(rows);
  if (!values && !extra) return "";
  return `
    <section class="data-section">
      <h3>${escapeHtml(title)}</h3>
      ${values ? `<dl class="detail-grid">${values}</dl>` : ""}
      ${extra}
    </section>
  `;
}

function renderRows(rows: (string | number | null | undefined)[][]) {
  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `<dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value ?? t("value.unknown")))}</dd>`)
    .join("");
}

function normalizeExternalLinks(links: readonly ExternalLink[]) {
  const seen = new Set<string>();
  return links
    .map((link) => ({
      provider: typeof link.provider === "string" && link.provider.trim() ? link.provider.trim() : t("object.source"),
      label: typeof link.label === "string" && link.label.trim() ? link.label.trim() : t("object.openSourceRecord"),
      url: typeof link.url === "string" ? link.url.trim() : ""
    }))
    .filter((link) => {
      if (!isSafeExternalUrl(link.url) || seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
}

function isSafeExternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function updateCompareUi() {
  ensureCompareTarget();
  void updateComparePicker();
  updateComparePanel();
}

async function updateComparePicker() {
  const config = comparePickerConfig();
  if (!config) {
    compareSearchState.latestBodies = [];
    comparePicker.innerHTML = "";
    updateSelectedPanelMetrics();
    return;
  }
  await updateSearchPicker(config);
}

function comparePickerConfig(): PickerSearchConfig | null {
  if (!ephemeris) return null;
  const selected = selectedBody();
  if (!selected) return null;
  const target = compareTarget();
  return {
    state: compareSearchState,
    input: compareSearch,
    picker: comparePicker,
    filter: activeCompareFilterDefinition(),
    sourceBodies: ephemeris.bodies,
    activeKey: compareTargetKey,
    currentTargetKey: selected?.key ?? null,
    excludeKeys: [selected.key],
    emptyMessage: t("compare.noMatches"),
    loadingMessage: t("search.loading"),
    fallbackMessage: t("search.fallback"),
    queryForSearch: (query) => (target && query.toLowerCase() === target.name.toLowerCase() ? "" : query),
    afterRender: updateSelectedPanelMetrics
  };
}

function updateComparePanel() {
  const selected = selectedBody();
  const target = compareTarget();
  if (!selected) {
    compareHeading.textContent = t("compare.heading");
    comparePanel.innerHTML = "";
    updateSelectedPanelMetrics();
    return;
  }

  compareHeading.textContent = t("compare.compareObject", { name: selected.name });
  if (!target) {
    comparePanel.innerHTML = `
      <section class="compare-card compare-card--empty">
        <div class="compare-pair">
          ${renderCompareObject(selected, "A")}
          <article class="compare-object compare-object--empty">
            <span>B</span>
            <div>
              <strong>${escapeHtml(t("compare.chooseObjectB"))}</strong>
              <small>${escapeHtml(t("compare.searchToCompare"))}</small>
            </div>
          </article>
        </div>
      </section>
    `;
    updateSelectedPanelMetrics();
    return;
  }

  const distanceKm = bodyDistanceKm(selected, target);
  const comparisons = educationalComparisons(distanceKm, { auKm: auKm(), includeMissionComparisons: false }).slice(0, 4);
  const sizeComparison = sizeComparisonModel(selected, target);
  comparePanel.innerHTML = `
    <section class="compare-card">
      <div class="compare-distance compare-distance--hero">
        <span>${escapeHtml(t("compare.currentDistance"))}</span>
        <strong>${escapeHtml(formatDistance(distanceKm))}</strong>
        <small>${escapeHtml(formatNumber(distanceKm / auKm()))} AU</small>
      </div>
      <div class="compare-pair">
        ${renderCompareObject(selected, "A")}
        ${renderCompareObject(target, "B")}
      </div>
      <dl class="comparison-list">
        ${comparisons.map((comparison) => `<dt>${escapeHtml(comparison.label)}</dt><dd>${escapeHtml(comparison.displayValue)}</dd>`).join("")}
      </dl>
      <a href="/methodology" data-analytics-event="methodology">${escapeHtml(t("launch.distanceMethodology"))}</a>
    </section>
    <section class="size-compare-card">
      <div class="panel-head compact">
        <div>
          <p class="eyebrow">${escapeHtml(t("compare.trueDiameterRatio"))}</p>
          <h3>${escapeHtml(sizeComparison.ratioLabel)}</h3>
          <small>${escapeHtml(sizeComparison.scaleLabel)}</small>
        </div>
      </div>
      <div class="size-stage">
        ${renderSizeDisk(selected, sizeComparison.a)}
        ${renderSizeDisk(target, sizeComparison.b)}
      </div>
    </section>
  `;
  updateSelectedPanelMetrics();
}

function renderCompareObject(body: Body, label: string) {
  const classification = classifyBody(body);
  const radiusLabel = body.radius_km > 0 ? `${formatDistance(body.radius_km)} ${t("picker.radius")}` : t("compare.radiusUnknown");
  return `
    <article class="compare-object" style="--body-color: ${escapeHtml(body.color)}">
      <span>${label}</span>
      <div>
        <strong>${escapeHtml(body.name)}</strong>
        <small>${escapeHtml(classification.label)} · ${escapeHtml(radiusLabel)}</small>
        <small>${escapeHtml(uncertaintySummary({ position_model: body.catalog?.position_model, facts: body.catalog?.facts }))}</small>
      </div>
    </article>
  `;
}

function renderSizeDisk(body: Body, visual: SizeVisual) {
  const diskMarkup = visual.isSubpixel
    ? `<span class="size-arrow" aria-hidden="true"></span>`
    : `<span class="size-visual size-visual--${escapeHtml(visual.visualType)}" aria-hidden="true"></span>`;
  return `
    <figure class="size-disk-wrap ${visual.isSubpixel ? "is-subpixel" : ""}" data-object-type="${escapeHtml(visual.visualType)}" style="--disk-size: ${visual.diameterPx.toFixed(2)}px; --body-color: ${escapeHtml(body.color)}">
      <div class="size-disk-slot">
        ${diskMarkup}
      </div>
      <figcaption>
        <strong>${escapeHtml(body.name)}</strong>
        <span>${escapeHtml(formatDistance(body.radius_km * 2))} ${escapeHtml(t("field.diameter"))}</span>
        ${visual.isSubpixel ? `<span class="size-subpixel-note">${escapeHtml(t("compare.subpixel"))}</span>` : ""}
      </figcaption>
    </figure>
  `;
}

function updateTimeSummary() {
  if (!ephemeris) return;
  timeSummary.textContent = formatFullDate(ephemeris.timestamp_utc);
}

function updateTimeStepUi() {
  const step = currentTimeStep();
  timeStepLabel.textContent = t(step.labelKey);
}

function currentTimeStep() {
  const index = clamp(Math.round(Number(timeStepSlider.value)), 0, TIME_STEPS.length - 1);
  return TIME_STEPS[index] ?? TIME_STEPS[2];
}

function stepTime(direction: -1 | 1) {
  const current = dateFromInput() ?? new Date(ephemeris?.timestamp_utc ?? Date.now());
  const next = new Date(current.getTime() + direction * currentTimeStep().days * 86_400_000);
  timeInput.value = toDatetimeLocalValue(next);
  void loadAtlas(next.toISOString());
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
  diagnosticsToggle.checked = perfEnabled;
}

function updateContextModeStatus() {
  const viewWidthLy = currentViewWidthLy();
  const parts = [
    viewWidthLy < 250_000 ? t("contextMode.gaia") : t("contextMode.gaiaQuiet"),
    displayLayers.milkyWay ? t("contextMode.milkyWay") : t("contextMode.milkyWayOff"),
    viewWidthLy >= 1_000_000 ? t("contextMode.extragalactic") : t("contextMode.extragalacticQuiet")
  ];
  contextModeStatus.textContent = parts.join(" · ");
}

function updateScaleUi() {
  const scaleAu = currentViewWidthAu();
  const zoomLevel = zoomToSliderValue(camera.pxPerAu);
  const pixelScale = formatDistance(auKm() / camera.pxPerAu);
  const viewScale = formatDistance(scaleAu * auKm());
  zoomScaleSlider.value = String(zoomLevel);
  zoomScaleSlider.title = t("scale.pixelEquals", { value: pixelScale });
  zoomScaleSlider.setAttribute("aria-valuetext", t("scale.perPixel", { value: pixelScale }));
  zoomScaleLabel.textContent = `${zoomLevel} / ${ZOOM_SLIDER_STEPS}`;
  zoomPixelScale.textContent = t("scale.pixelEquals", { value: pixelScale });
  zoomViewScale.textContent = t("scale.viewEquals", { value: viewScale });
  updateContextModeStatus();
}

function universeShellForRadius(radiusLy: number) {
  return UNIVERSE_SHELLS.find((shell) => radiusLy <= shell.radiusLy) ?? UNIVERSE_SHELLS[UNIVERSE_SHELLS.length - 1];
}

function formatLightYears(value: number) {
  if (value >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000)} Gly`;
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} Mly`;
  if (value >= 1_000) return `${formatNumber(value / 1_000)} kly`;
  return `${formatNumber(value)} ly`;
}

function currentViewWidthAu() {
  return Math.max(0.000001, usableViewportRect().width / camera.pxPerAu);
}

function currentViewWidthLy() {
  return currentViewWidthAu() / AU_PER_LIGHT_YEAR;
}

async function focusSearchResult() {
  if (!ephemeris) return;
  const query = bodySearch.value.trim();
  const sourceBodies = catalogSearchState.latestBodies.length > 0 ? catalogSearchState.latestBodies : exploreSourceBodies();
  const body = (query ? findDestinationBody(sourceBodies, query) : null) ?? visiblePickerFirstMatch();
  if (!body) return;
  await selectBodyByKey(body.key, { center: true, zoom: "local" });
}

function visiblePickerFirstMatch() {
  if (!ephemeris) return null;
  if (catalogSearchState.latestBodies.length > 0) return catalogSearchState.latestBodies[0] ?? null;
  const filter = activeBodyFilterDefinition();
  const includeTypes = activeGuidedSet() ? undefined : filter.types;
  const sourceBodies = activeGuidedSet() ? exploreSourceBodies() : exploreSourceBodies().filter((body) => bodyMatchesFilter(body, filter));
  const sections = buildDestinationPickerSections(sourceBodies, {
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

async function focusCompareResult() {
  if (!ephemeris) return;
  const query = compareSearch.value.trim();
  const filter = activeCompareFilterDefinition();
  const sourceBodies = (compareSearchState.latestBodies.length > 0 ? compareSearchState.latestBodies : ephemeris.bodies).filter(
    (body) => body.key !== selectedKey && bodyMatchesFilter(body, filter)
  );
  const body = findDestinationBody(sourceBodies, query) ?? visibleCompareFirstMatch();
  if (!body || body.key === selectedKey) return;
  await setCompareTargetByKey(body.key);
}

function visibleCompareFirstMatch() {
  if (!ephemeris) return null;
  const searchMatch = compareSearchState.latestBodies.find((body) => body.key !== selectedKey);
  if (searchMatch) return searchMatch;
  const selected = selectedBody();
  const filter = activeCompareFilterDefinition();
  const sourceBodies = ephemeris.bodies.filter((body) => body.key !== selectedKey && bodyMatchesFilter(body, filter));
  const sections = buildDestinationPickerSections(sourceBodies, {
    query: compareSearch.value,
    selectedKey: compareTargetKey,
    currentTargetKey: selected?.key ?? null,
    recentDestinations,
    excludeKeys: selected ? [selected.key] : [],
    includeTypes: filter.types,
    maxResults: 1,
    auKm: auKm()
  });
  const key = sections[0]?.items[0]?.key;
  return key ? bodyByKey.get(key) ?? null : null;
}

async function setCompareTargetByKey(key: string) {
  const body = await ensureHydratedBody(key);
  if (!body) return;
  setCompareTarget(body.key);
}

function setCompareTarget(key: string) {
  const body = bodyByKey.get(key);
  if (!body || body.key === selectedKey) return;
  compareTargetKey = body.key;
  trackAnalytics("compare", { object_type: classifyBody(body).type });
  compareSearch.value = body.name;
  compareSearchState.activeOptionKey = null;
  recentDestinations = recordRecentDestination(body.key, { distanceFromEarthKm: body.distance_from_earth_km });
  updateCompareUi();
  requestRender();
  pushCurrentViewState();
}

async function selectBodyByKey(key: string, options: SelectBodyOptions = {}) {
  const body = bodyByKey.get(key) ?? [...catalogSearchState.latestBodies, ...compareSearchState.latestBodies].find((candidate) => candidate.key === key) ?? null;
  if (body) {
    if (!bodyByKey.has(body.key)) mergeBodies([body]);
    selectBody(body.key, options);
    return;
  }

  const hydrated = await hydrateBodiesByKey([key]);
  if (hydrated.length > 0) selectBody(hydrated[0].key, options);
}

function selectBody(key: string, options: SelectBodyOptions = {}) {
  const body = bodyByKey.get(key);
  if (!body) return;
  const previousSelectedKey = selectedKey;
  const selectionChanged = selectedKey !== body.key;
  const isTransient = options.transient === true || body.key === transientSelectedKey;
  if (selectionChanged && previousSelectedKey) cleanupTransientCatalogPreview(previousSelectedKey);
  selectedKey = body.key;
  transientSelectedKey = isTransient ? body.key : null;
  if (!isTransient) cancelMapDetailSelection();
  if (selectionChanged && !isTransient) {
    trackAnalytics("object", { object_type: classifyBody(body).type, source: body.catalog_group ?? "ephemeris" });
  }
  if (selectionChanged) {
    compareTargetKey = null;
    compareSearch.value = "";
    compareSearchState.latestBodies = [];
    compareSearchState.activeOptionKey = null;
  }
  ensureCompareTarget();
  activeTab = "object";
  if (!isTransient) recentDestinations = recordRecentDestination(body.key, { distanceFromEarthKm: body.distance_from_earth_km });
  bodySearch.value = body.name;
  catalogSearchState.activeOptionKey = null;
  updateAllUi();
  if (options.center) centerOnBody(body, options.zoom === "local", options.animate ?? false);
  requestRender({ data: Boolean(options.center && !options.animate) });
  if (selectionChanged && !isTransient) pushCurrentViewState();
  if (!isTransient && body.catalog?.preview && objectDetailHydrationStates.get(body.key)?.status !== "loading") void hydrateSelectedBody(body.key);
}

function clearSelectedObject(options: { openSearch?: boolean; preserveMapDetailRequest?: boolean } = {}) {
  if (!options.preserveMapDetailRequest) cancelMapDetailSelection();
  cleanupTransientCatalogPreview(selectedKey);
  selectedKey = "";
  transientSelectedKey = null;
  compareTargetKey = null;
  compareSearch.value = "";
  compareSearchState.latestBodies = [];
  compareSearchState.activeOptionKey = null;
  if (options.openSearch) {
    activeGuidedSetId = null;
    bodySearch.value = "";
    activeTab = "catalog";
  } else if (activeTab === "object") activeTab = null;
  updateAllUi();
  requestRender({ data: true });
  pushCurrentViewState();
}

async function ensureHydratedBody(key: string): Promise<Body | null> {
  const existing = bodyByKey.get(key);
  if (existing && !existing.catalog?.preview) return existing;

  const searchBody = [...catalogSearchState.latestBodies, ...compareSearchState.latestBodies].find((body) => body.key === key);
  const hydrated = await hydrateBodiesByKey([key]);
  if (hydrated.length > 0) return hydrated[0] ?? null;
  if (existing) return existing;

  if (searchBody) {
    mergeBodies([searchBody]);
    return searchBody;
  }

  return null;
}

async function hydrateSelectedBody(key: string) {
  const requestId = ++objectDetailHydrationRequestId;
  objectDetailHydrationStates.set(key, { status: "loading", requestId });
  if (selectedKey === key) updateBodyInfo();

  const hydrated = await hydrateBodiesByKey([key]);
  const isCurrentRequest = objectDetailHydrationStates.get(key)?.requestId === requestId;
  if (!isCurrentRequest) return;

  const hydratedBody = hydrated[0] ?? null;
  if (hydratedBody && !hydratedBody.catalog?.preview) {
    objectDetailHydrationStates.delete(key);
  } else {
    objectDetailHydrationStates.set(key, { status: "error", requestId, message: t("object.detailErrorBody") });
  }
  if (selectedKey === key) {
    updateAllUi();
    requestRender({ data: false });
  }
}

async function hydrateBodiesByKey(keys: readonly string[]): Promise<Body[]> {
  const detailKeys = keys.filter((key) => {
    const existing = bodyByKey.get(key);
    return !existing || existing.catalog?.preview;
  });
  if (!ephemeris || detailKeys.length === 0) return [];

  const catalogFirstKeys = detailKeys.filter((key) => {
    const existing = bodyByKey.get(key);
    return key === serverBootObjectKey || Boolean(existing?.catalog?.source_type && existing.catalog.source_type !== "test_catalog");
  });
  const catalogResults = await Promise.all(
    catalogFirstKeys.map(async (key) => {
      try {
        const response = await fetch(`/api/objects/${encodeURIComponent(key)}`);
        if (!response.ok) return null;
        const payload = (await response.json()) as { object?: CatalogObjectPayload };
        if (!payload.object) return null;
        const body = catalogObjectToBody(payload.object);
        if (body.catalog) body.catalog.preview = false;
        return body;
      } catch {
        return null;
      }
    })
  );
  const catalogBodies = catalogResults.filter(isPresent);
  if (catalogBodies.length > 0) mergeBodies(catalogBodies);
  const hydratedKeys = new Set(catalogBodies.map((body) => body.key));
  const ephemerisKeys = detailKeys.filter((key) => !hydratedKeys.has(key));
  if (ephemerisKeys.length === 0) return catalogBodies;

  const params = new URLSearchParams();
  params.set("groups", "");
  params.set("keys", ephemerisKeys.join(","));
  if (ephemeris.timestamp_utc) params.set("timestamp", ephemeris.timestamp_utc);

  try {
    const response = await fetch(`/api/ephemeris?${params.toString()}`);
    if (!response.ok) return catalogBodies;
    const payload = (await response.json()) as Ephemeris;
    mergeBodies(payload.bodies);
    return [...catalogBodies, ...payload.bodies];
  } catch (error) {
    console.warn("Unable to hydrate catalog object from Python ephemeris.", error);
    return catalogBodies;
  }
}

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

function centerOnBody(body: Body, zoom: boolean, animate = false) {
  const target = zoom ? localCameraForBody(body) : { ...camera, xAu: body.position.x_au, yAu: body.position.y_au };
  activeZoomPreset = null;
  updateZoomPresetButtons();
  if (animate) {
    animateCameraTo(target);
  } else {
    cancelCameraAnimation();
    camera = target;
    updateScaleUi();
  }
}

function localCameraForBody(body: Body): Camera {
  const classification = classifyBody(body);
  const rect = usableViewportRect();
  const diameterAu = Math.max((body.radius_km * 2) / auKm(), 1e-9);
  const targetDiameterPx = classification.type === "moon" || classification.type === "planet" || classification.type === "dwarf_planet" ? LOCAL_ZOOM_DIAMETER_PX : LOCAL_ZOOM_DIAMETER_PX * 0.72;
  const targetPxPerAu =
    body.catalog?.source_type === "deep_sky_catalog"
      ? clamp(rect.width / Math.max(body.distance_from_earth_km / auKm() / 40, 1000), MIN_ZOOM, MAX_ZOOM)
      : clamp(targetDiameterPx / diameterAu, MIN_ZOOM, MAX_ZOOM);

  return {
    xAu: body.position.x_au,
    yAu: body.position.y_au,
    pxPerAu: targetPxPerAu
  };
}

function animateCameraTo(target: Camera, durationMs = LOCAL_ZOOM_DURATION_MS, onComplete?: () => void) {
  cancelCameraAnimation();
  cameraAnimationComplete = onComplete ?? null;
  const start = { ...camera };
  const startedAt = performance.now();
  const startZoom = Math.log(Math.max(start.pxPerAu, MIN_ZOOM));
  const targetZoom = Math.log(Math.max(target.pxPerAu, MIN_ZOOM));

  const tick = (now: number) => {
    const progress = clamp((now - startedAt) / durationMs, 0, 1);
    const eased = easeInOutCubic(progress);
    camera = {
      xAu: lerp(start.xAu, target.xAu, eased),
      yAu: lerp(start.yAu, target.yAu, eased),
      pxPerAu: Math.exp(lerp(startZoom, targetZoom, eased))
    };
    updateScaleUi();
    requestRender({ data: progress === 1 });
    if (progress < 1) {
      cameraAnimationFrame = requestAnimationFrame(tick);
    } else {
      cameraAnimationFrame = null;
      cameraAnimationComplete?.(); cameraAnimationComplete = null;
    }
  };

  cameraAnimationFrame = requestAnimationFrame(tick);
}

function cancelCameraAnimation() {
  if (cameraAnimationFrame === null) return;
  cancelAnimationFrame(cameraAnimationFrame);
  cameraAnimationFrame = null;
  cameraAnimationComplete?.(); cameraAnimationComplete = null;
}

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
    const bodies = presetBodies(preset);
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
  if (preset === "galaxy" || preset === "localGroup" || preset === "cosmicWeb") {
    return [];
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
  cancelCameraAnimation();
  const xs = bodies.map((body) => body.position.x_au);
  const ys = bodies.map((body) => body.position.y_au);
  fitWorldBounds(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), paddingRatio);
}

function fitMilkyWayModel(paddingRatio: number) {
  cancelCameraAnimation();
  const bounds = MILKY_WAY_MODEL.bounds;
  fitWorldBounds(bounds.minXAu, bounds.maxXAu, bounds.minYAu, bounds.maxYAu, paddingRatio);
}

function fitPhysicalScale(widthLy: number, paddingRatio: number) {
  cancelCameraAnimation();
  const halfWidthAu = lightYearsToAu(widthLy) / 2;
  fitWorldBounds(-halfWidthAu, halfWidthAu, -halfWidthAu, halfWidthAu, paddingRatio);
}

function fitWorldBounds(minX: number, maxX: number, minY: number, maxY: number, paddingRatio: number) {
  const rect = usableViewportRect();
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

function zoomViewportCenter(factor: number) {
  const rect = usableViewportRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor, true);
}

function setZoomFromSlider() {
  const rect = usableViewportRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const before = screenToWorld(centerX, centerY);
  cancelCameraAnimation();
  camera.pxPerAu = sliderValueToZoom(Number(zoomScaleSlider.value));
  const after = screenToWorld(centerX, centerY);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  activeZoomPreset = null;
  updateZoomPresetButtons();
  updateScaleUi();
  requestRender();
  scheduleCatalogPointLoad({ immediate: true });
  scheduleCameraDataRefresh();
}

function zoomToSliderValue(pxPerAu: number) {
  const minLog = Math.log(MIN_ZOOM);
  const maxLog = Math.log(MAX_ZOOM);
  const zoomLog = Math.log(clamp(pxPerAu, MIN_ZOOM, MAX_ZOOM));
  return Math.round(clamp((zoomLog - minLog) / (maxLog - minLog), 0, 1) * ZOOM_SLIDER_STEPS);
}

function sliderValueToZoom(value: number) {
  const minLog = Math.log(MIN_ZOOM);
  const maxLog = Math.log(MAX_ZOOM);
  const t = clamp(value / ZOOM_SLIDER_STEPS, 0, 1);
  return Math.exp(minLog + (maxLog - minLog) * t);
}

function zoomAt(x: number, y: number, factor: number, clearPreset = false, dataMode: "immediate" | "deferred" | "none" = "immediate") {
  cancelCameraAnimation();
  const before = screenToWorld(x, y);
  camera.pxPerAu = clamp(camera.pxPerAu * factor, MIN_ZOOM, MAX_ZOOM);
  const after = screenToWorld(x, y);
  camera.xAu += before.xAu - after.xAu;
  camera.yAu += before.yAu - after.yAu;
  if (clearPreset) {
    activeZoomPreset = null;
    updateZoomPresetButtons();
  }
  updateScaleUi();
  if (dataMode === "immediate") {
    requestRender();
    requestDataRefresh({ immediate: true });
  } else {
    requestRender();
    if (dataMode === "deferred") {
      scheduleCatalogPointLoad({ immediate: true });
      scheduleCameraDataRefresh();
    }
  }
}

async function handleMapClick(point: ScreenPoint) {
  cancelMapDetailSelection();
  const edgeReference = edgeReferenceAt(point.x, point.y);
  if (edgeReference) {
    selectBody(edgeReference.body.key, { center: true, zoom: "local", animate: true });
    return;
  }

  const nearest = nearestBodyAt(point.x, point.y);
  if (!nearest) {
    const detailController = new AbortController();
    mapDetailSelectionController = detailController;
    const nearestQuery = catalogNearestQueryAt(point);
    const tileHit = nearestCatalogTilePointAt(point.x, point.y);
    const tilePreview = tileHit ? catalogTilePointPreview(tileHit) : null;
    if (tileHit && tilePreview) {
      const requestId = ++objectDetailHydrationRequestId;
      objectDetailHydrationStates.set(tilePreview.key, { status: "loading", requestId });
      mergeBodies([tilePreview]);
      selectBody(tilePreview.key, { center: true, animate: true, transient: true });

      const catalogPoint = (await hydrateCatalogTilePoint(tileHit, detailController.signal)) ?? await nearestCatalogPointFromApi(nearestQuery, detailController.signal);
      if (detailController.signal.aborted) {
        cleanupOwnedTransientCatalogPreview(tilePreview.key, requestId);
        return;
      }
      const hydrationState = objectDetailHydrationStates.get(tilePreview.key);
      if (selectedKey !== tilePreview.key || hydrationState?.requestId !== requestId) {
        if (hydrationState?.requestId === requestId) {
          objectDetailHydrationStates.delete(tilePreview.key);
          removeMergedBody(tilePreview.key);
        }
        if (mapDetailSelectionController === detailController) mapDetailSelectionController = null;
        return;
      }
      objectDetailHydrationStates.delete(tilePreview.key);
      if (!catalogPoint) {
        objectDetailHydrationStates.set(tilePreview.key, { status: "error", requestId, message: t("object.detailErrorBody") });
        updateBodyInfo();
        if (mapDetailSelectionController === detailController) mapDetailSelectionController = null;
        return;
      }

      mergeBodies([catalogPoint]);
      if (mapDetailSelectionController === detailController) mapDetailSelectionController = null;
      selectBody(catalogPoint.key);
      return;
    }

    const catalogPoint = await nearestCatalogPointAt(point, detailController.signal, nearestQuery);
    if (detailController.signal.aborted) return;
    if (mapDetailSelectionController === detailController) mapDetailSelectionController = null;
    if (catalogPoint) {
      mergeBodies([catalogPoint]);
      selectBody(catalogPoint.key, { center: true, animate: true });
      return;
    }
    return;
  }
  selectBody(nearest.body.key, { center: true, animate: true });
}

function catalogTilePointPreview(hit: CatalogPointHitEntry): Body | null {
  const payload = hit.tile.payload;
  const layerId = hit.tile.request.staticLayerId;
  if (!payload || payload.format !== "SMP3" || (payload.flags & 1) === 0 || hit.pointIndex >= payload.declared || !layerId) return null;
  if (layerId !== "gaia_stars" && layerId !== "desi_dr1" && layerId !== "quaia_g20") return null;

  const strideFloats = catalogPointVertexStrideFloats(payload);
  const strideBytes = catalogPointVertexStrideBytes(payload);
  const floatOffset = hit.pointIndex * strideFloats;
  const byteOffset = hit.pointIndex * strideBytes;
  const bytes = new Uint8Array(payload.vertices.buffer, payload.vertices.byteOffset, payload.vertices.byteLength);
  const typeCode = bytes[byteOffset + 11] ?? 0;
  const objectType = layerId === "gaia_stars" ? "star" : layerId === "quaia_g20" || typeCode === 3 ? "quasar" : "galaxy";
  const catalogGroup = layerId === "gaia_stars" ? "gaia_dr3_bulk" : layerId === "quaia_g20" ? "quaia_g20_quasars" : objectType === "quasar" ? "desi_dr1_quasars" : "desi_dr1_galaxies";
  const sourceType = layerId === "gaia_stars" ? "gaia_dr3_bulk_tile" : layerId === "quaia_g20" ? "quaia_g20_tile" : "desi_dr1_tile";
  const positionModel = layerId === "gaia_stars" ? "catalog_astrometry" : layerId === "quaia_g20" ? "catalog_inferred_redshift_comoving" : "catalog_redshift_comoving";
  const name = layerId === "gaia_stars" ? "Gaia DR3 star" : layerId === "quaia_g20" ? "Quaia G<20 quasar" : `DESI DR1 ${objectType}`;
  const magnitudeByte = bytes[byteOffset + 12] ?? 255;
  const red = bytes[byteOffset + 8] ?? 224;
  const green = bytes[byteOffset + 9] ?? 196;
  const blue = bytes[byteOffset + 10] ?? 128;
  const body = catalogObjectToBody({
    key: `catalog-tile-preview:${hit.tile.request.key}:${hit.pointIndex}`,
    name,
    object_type: objectType,
    catalog_group: catalogGroup,
    source_type: sourceType,
    position_model: positionModel,
    color: `#${[red, green, blue].map((component) => component.toString(16).padStart(2, "0")).join("")}`,
    astrometry: { apparent_magnitude: magnitudeByte === 255 ? null : magnitudeByte / 10 - 2 },
    position: {
      x_au: payload.origin.x + (payload.vertices[floatOffset] ?? 0),
      y_au: payload.origin.y + (payload.vertices[floatOffset + 1] ?? 0),
      z_au: 0
    }
  });
  if (body.catalog) body.catalog.preview = true;
  return body;
}

function removeMergedBody(key: string) {
  if (ephemeris) ephemeris = { ...ephemeris, bodies: ephemeris.bodies.filter((body) => body.key !== key) };
  bodyByKey.delete(key);
  visibleBodiesFrameCache = null;
  bodyPointLayerCache = null;
  bodyHitGridValid = false;
  requestRender();
}

function cleanupTransientCatalogPreview(key: string | null) {
  if (!key || key !== transientSelectedKey) return;
  objectDetailHydrationStates.delete(key);
  removeMergedBody(key);
  transientSelectedKey = null;
}

function cleanupOwnedTransientCatalogPreview(key: string, requestId: number) {
  if (objectDetailHydrationStates.get(key)?.requestId !== requestId) return;
  if (selectedKey === key) {
    clearSelectedObject({ preserveMapDetailRequest: true });
    return;
  }
  objectDetailHydrationStates.delete(key);
  if (key === transientSelectedKey) transientSelectedKey = null;
  removeMergedBody(key);
}

function cancelMapDetailSelection() {
  mapDetailSelectionController?.abort();
  mapDetailSelectionController = null;
}

function catalogNearestQueryAt(point: ScreenPoint): CatalogNearestQuery {
  const world = screenToWorld(point.x, point.y);
  const filterParams = catalogPointFilterParams();
  return {
    xAu: world.xAu,
    yAu: world.yAu,
    radiusAu: clamp(8 / Math.max(camera.pxPerAu, MIN_ZOOM), 0.000001, 10_000_000),
    groups: [...(filterParams?.groups ?? [])],
    types: [...(filterParams?.types ?? [])]
  };
}

async function nearestCatalogPointAt(point: ScreenPoint, signal?: AbortSignal, nearestQuery = catalogNearestQueryAt(point)): Promise<Body | null> {
  const filterParams = catalogPointFilterParams();
  if (!filterParams || !hasActiveCatalogPointLayer() || !shouldUseCatalogPoints(currentViewWidthLy(), filterParams)) return null;
  const tileHit = nearestCatalogTilePointAt(point.x, point.y);
  if (tileHit) {
    const exactTilePoint = await hydrateCatalogTilePoint(tileHit, signal);
    if (exactTilePoint) return exactTilePoint;
  }
  return nearestCatalogPointFromApi(nearestQuery, signal);
}

async function nearestCatalogPointFromApi(query: CatalogNearestQuery, signal?: AbortSignal): Promise<Body | null> {
  if (query.groups.length === 0) return null;
  const params = new URLSearchParams();
  params.set("x_au", String(query.xAu));
  params.set("y_au", String(query.yAu));
  params.set("radius_au", String(query.radiusAu));
  params.set("groups", query.groups.join(","));
  if (query.types.length > 0) params.set("types", query.types.join(","));

  try {
    const response = await fetch(`/api/catalog/nearest?${params.toString()}`, { signal });
    if (!response.ok) throw new Error(`Catalog nearest failed with ${response.status}`);
    const payload = (await response.json()) as CatalogNearestPayload;
    return payload.object ? catalogObjectToBody(payload.object) : null;
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Unable to select catalog point.", error);
    return null;
  }
}

async function hydrateCatalogTilePoint(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
  if (hit.tile.request.staticLayerId === "gaia_stars") return hydrateGaiaCatalogTilePoint(hit, signal);
  if (hit.tile.request.staticLayerId === "desi_dr1") return hydrateDesiCatalogTilePoint(hit, signal);
  if (hit.tile.request.staticLayerId === "quaia_g20") return hydrateQuaiaCatalogTilePoint(hit, signal);
  return null;
}

async function hydrateGaiaCatalogTilePoint(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
  const { payload, request } = hit.tile;
  if (
    request.staticLayerId !== "gaia_stars" ||
    !payload ||
    payload.format !== "SMP3" ||
    (payload.flags & 1) === 0 ||
    hit.pointIndex >= payload.declared ||
    !request.staticUrl ||
    !request.staticRange
  ) return null;

  let sourceId: string | null;
  try {
    sourceId = await sourceIdForCatalogTilePoint(hit, signal);
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Unable to read the Gaia source ID from its tile.", error);
    return null;
  }
  if (!sourceId) return null;

  const preview = gaiaCatalogTilePointPreview(hit, sourceId);
  try {
    const detailResponse = await fetch(`/api/objects/gaia/${sourceId}`, { signal });
    if (!detailResponse.ok) return preview;
    return catalogObjectToBody((await detailResponse.json()) as CatalogObjectPayload);
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Unable to hydrate Gaia tile point details; using its local tile record.", error);
    return preview;
  }
}

async function sourceIdForCatalogTilePoint(hit: CatalogPointHitEntry, signal?: AbortSignal) {
  const { payload, request } = hit.tile;
  if (!payload || !request.staticUrl || !request.staticRange) return null;
  const sourceRange = smp3SourceIdRange(
    request.staticRange.offset,
    request.staticRange.length,
    payload.declared,
    hit.pointIndex,
    payload.flags
  );
  if (!sourceRange) return null;
  const response = await fetch(request.staticUrl, {
    headers: { Range: `bytes=${sourceRange.offset}-${sourceRange.offset + sourceRange.length - 1}` },
    signal
  });
  if (!response.ok) throw new Error(`Catalog source ID Range failed with ${response.status}`);
  let buffer = await response.arrayBuffer();
  if (response.status === 200) buffer = buffer.slice(sourceRange.offset, sourceRange.offset + sourceRange.length);
  return decodeSmp3SourceId(buffer);
}

async function hydrateDesiCatalogTilePoint(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
  const payload = hit.tile.payload;
  const request = hit.tile.request;
  if (
    !payload ||
    payload.format !== "SMP3" ||
    (payload.flags & 1) === 0 ||
    hit.pointIndex >= payload.declared ||
    !request.staticUrl ||
    !request.staticRange
  ) return null;

  let targetId: string | null;
  try {
    targetId = await sourceIdForCatalogTilePoint(hit, signal);
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Unable to read the DESI TARGETID from its tile.", error);
    return null;
  }
  if (!targetId) return null;

  const strideFloats = catalogPointVertexStrideFloats(payload);
  const strideBytes = catalogPointVertexStrideBytes(payload);
  const floatOffset = hit.pointIndex * strideFloats;
  const byteOffset = hit.pointIndex * strideBytes;
  const bytes = new Uint8Array(payload.vertices.buffer, payload.vertices.byteOffset, payload.vertices.byteLength);
  const typeCode = bytes[byteOffset + 11] ?? 1;
  const objectType = typeCode === 3 ? "quasar" : "galaxy";
  const magnitudeByte = bytes[byteOffset + 12] ?? 255;
  const red = bytes[byteOffset + 8] ?? 224;
  const green = bytes[byteOffset + 9] ?? 196;
  const blue = bytes[byteOffset + 10] ?? 128;
  const body = catalogObjectToBody({
    key: `desi-dr1-${targetId}`,
    name: `DESI DR1 ${objectType} ${targetId}`,
    object_type: objectType,
    catalog_group: objectType === "quasar" ? "desi_dr1_quasars" : "desi_dr1_galaxies",
    source_type: "desi_dr1_tile",
    position_model: "catalog_redshift_comoving",
    color: `#${[red, green, blue].map((component) => component.toString(16).padStart(2, "0")).join("")}`,
    external_ids: { desi_targetid: targetId },
    external_links: [{
      provider: "DESI",
      label: "DESI DR1 catalog documentation",
      url: "https://data.desi.lbl.gov/doc/releases/dr1/"
    }],
    source: { catalog: "DESI DR1 zcatalog v1 physical tile", source_id: targetId },
    astrometry: { apparent_magnitude: magnitudeByte === 255 ? null : magnitudeByte / 10 - 2 },
    position: {
      x_au: payload.origin.x + (payload.vertices[floatOffset] ?? 0),
      y_au: payload.origin.y + (payload.vertices[floatOffset + 1] ?? 0),
      z_au: 0
    }
  });
  if (body.catalog) body.catalog.preview = false;
  return body;
}

async function hydrateQuaiaCatalogTilePoint(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
  const payload = hit.tile.payload;
  const request = hit.tile.request;
  if (
    request.staticLayerId !== "quaia_g20" ||
    !payload ||
    payload.format !== "SMP3" ||
    (payload.flags & 1) === 0 ||
    hit.pointIndex >= payload.declared ||
    !request.staticUrl ||
    !request.staticRange
  ) return null;

  let sourceId: string | null;
  try {
    sourceId = await sourceIdForCatalogTilePoint(hit, signal);
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("Unable to read the Quaia Gaia source ID from its tile.", error);
    return null;
  }
  if (!sourceId) return null;

  const strideFloats = catalogPointVertexStrideFloats(payload);
  const strideBytes = catalogPointVertexStrideBytes(payload);
  const floatOffset = hit.pointIndex * strideFloats;
  const byteOffset = hit.pointIndex * strideBytes;
  const bytes = new Uint8Array(payload.vertices.buffer, payload.vertices.byteOffset, payload.vertices.byteLength);
  const magnitudeByte = bytes[byteOffset + 12] ?? 255;
  const red = bytes[byteOffset + 8] ?? 224;
  const green = bytes[byteOffset + 9] ?? 196;
  const blue = bytes[byteOffset + 10] ?? 128;
  const body = catalogObjectToBody({
    key: `quaia-g20-${sourceId}`,
    name: `Quaia G<20 quasar ${sourceId}`,
    object_type: "quasar",
    catalog_group: "quaia_g20_quasars",
    source_type: "quaia_g20_tile",
    position_model: "catalog_inferred_redshift_comoving",
    color: `#${[red, green, blue].map((component) => component.toString(16).padStart(2, "0")).join("")}`,
    external_ids: { gaia_dr3_source_id: sourceId },
    external_links: [
      {
        provider: "Quaia",
        label: "Quaia G<20 published catalog",
        url: "https://zenodo.org/records/10403370"
      },
      {
        provider: "Gaia Archive",
        label: "Gaia DR3 source",
        url: `https://gea.esac.esa.int/archive/?ACTION=PUBLIC_DATALINK&ID=Gaia%20DR3%20${encodeURIComponent(sourceId)}`
      }
    ],
    source: { catalog: "Quaia G<20 physical tile; inferred spectrophotometric/ML redshift", source_id: sourceId },
    astrometry: { apparent_magnitude: magnitudeByte === 255 ? null : magnitudeByte / 10 - 2 },
    position: {
      x_au: payload.origin.x + (payload.vertices[floatOffset] ?? 0),
      y_au: payload.origin.y + (payload.vertices[floatOffset + 1] ?? 0),
      z_au: 0
    }
  });
  if (body.catalog) body.catalog.preview = false;
  return body;
}

function gaiaCatalogTilePointPreview(hit: CatalogPointHitEntry, sourceId: string): Body {
  const payload = hit.tile.payload;
  if (!payload) throw new Error("Gaia tile point payload is unavailable");
  const strideFloats = catalogPointVertexStrideFloats(payload);
  const strideBytes = catalogPointVertexStrideBytes(payload);
  const floatOffset = hit.pointIndex * strideFloats;
  const byteOffset = hit.pointIndex * strideBytes;
  const bytes = new Uint8Array(payload.vertices.buffer, payload.vertices.byteOffset, payload.vertices.byteLength);
  const magnitudeByte = bytes[byteOffset + 12] ?? 255;
  const red = bytes[byteOffset + 8] ?? 224;
  const green = bytes[byteOffset + 9] ?? 196;
  const blue = bytes[byteOffset + 10] ?? 128;
  const body = catalogObjectToBody({
    key: `gaia_dr3_${sourceId}`,
    name: `Gaia DR3 ${sourceId}`,
    object_type: "star",
    catalog_group: "gaia_dr3_bulk",
    source_type: "gaia_dr3_bulk_tile",
    position_model: "catalog_astrometry",
    color: `#${[red, green, blue].map((component) => component.toString(16).padStart(2, "0")).join("")}`,
    external_ids: { gaia_dr3_source_id: sourceId },
    external_links: [{
      provider: "Gaia Archive",
      label: "Gaia DR3 source",
      url: `https://gea.esac.esa.int/archive/?ACTION=PUBLIC_DATALINK&ID=Gaia%20DR3%20${encodeURIComponent(sourceId)}`
    }],
    source: { catalog: "Gaia DR3 T2 physical tile", source_id: sourceId },
    astrometry: { apparent_magnitude: magnitudeByte === 255 ? null : magnitudeByte / 10 - 2 },
    position: {
      x_au: payload.origin.x + (payload.vertices[floatOffset] ?? 0),
      y_au: payload.origin.y + (payload.vertices[floatOffset + 1] ?? 0),
      z_au: 0
    }
  });
  if (body.catalog) body.catalog.preview = false;
  return body;
}

function nearestBodyAt(x: number, y: number) {
  const startedAt = performance.now();
  if (!bodyHitGridValid) rebuildBodyHitGrid();
  let nearest: { body: Body; distancePx: number } | null = null;
  const cellX = Math.floor(x / BODY_HIT_GRID_CELL_PX);
  const cellY = Math.floor(y / BODY_HIT_GRID_CELL_PX);
  const seen = new Set<string>();
  for (let gx = cellX - 1; gx <= cellX + 1; gx += 1) {
    for (let gy = cellY - 1; gy <= cellY + 1; gy += 1) {
      for (const entry of bodyHitGrid.get(`${gx}:${gy}`) ?? []) {
        if (entry.body.key === transientSelectedKey) continue;
        if (seen.has(entry.body.key)) continue;
        seen.add(entry.body.key);
        const distancePx = Math.hypot(entry.x - x, entry.y - y);
        if (distancePx <= entry.radius && (!nearest || distancePx < nearest.distancePx)) {
          nearest = { body: entry.body, distancePx };
        }
      }
    }
  }
  perfHitTestMs = performance.now() - startedAt;
  return nearest;
}

function nearestCatalogTilePointAt(x: number, y: number): CatalogPointHitEntry | null {
  if (!hasActiveCatalogPointLayer()) return null;
  if (!catalogPointHitGridValid) rebuildCatalogPointHitGrid();
  let nearest: (CatalogPointHitEntry & { distancePx: number }) | null = null;
  const cellX = Math.floor(x / CATALOG_POINT_HIT_GRID_CELL_PX);
  const cellY = Math.floor(y / CATALOG_POINT_HIT_GRID_CELL_PX);
  const searchRadius = Math.ceil(CATALOG_POINT_HIT_RADIUS_PX / CATALOG_POINT_HIT_GRID_CELL_PX);
  for (let gx = cellX - searchRadius; gx <= cellX + searchRadius; gx += 1) {
    for (let gy = cellY - searchRadius; gy <= cellY + searchRadius; gy += 1) {
      const entry = catalogPointHitGrid.get(`${gx}:${gy}`);
      if (!entry) continue;
      const distancePx = Math.hypot(entry.x - x, entry.y - y);
      if (distancePx <= entry.radius && (!nearest || distancePx < nearest.distancePx)) {
        nearest = { ...entry, distancePx };
      }
    }
  }
  return nearest;
}

function rebuildCatalogPointHitGrid() {
  catalogPointHitGrid = new Map();
  const previousRectCache = usableViewportRectCache;
  usableViewportRectCache = previousRectCache ?? computeUsableViewportRect();
  const rect = expandedRect(usableViewportRect(), 12);
  for (const tile of activeCatalogPointTiles()) {
    const payload = tile.payload;
    if (!payload || payload.returned === 0) continue;
    const originX = payload.origin.x;
    const originY = payload.origin.y;
    const strideFloats = catalogPointVertexStrideFloats(payload);
    for (let index = 0; index < payload.returned; index += 1) {
      const offset = index * strideFloats;
      const screen = worldToScreen(originX + (payload.vertices[offset] ?? 0), originY + (payload.vertices[offset + 1] ?? 0));
      if (!pointInRect(screen, rect)) continue;
      const cellX = Math.floor(screen.x / CATALOG_POINT_HIT_GRID_CELL_PX);
      const cellY = Math.floor(screen.y / CATALOG_POINT_HIT_GRID_CELL_PX);
      const key = `${cellX}:${cellY}`;
      const existing = catalogPointHitGrid.get(key);
      if (existing) {
        const centerX = (cellX + 0.5) * CATALOG_POINT_HIT_GRID_CELL_PX;
        const centerY = (cellY + 0.5) * CATALOG_POINT_HIT_GRID_CELL_PX;
        if (Math.hypot(existing.x - centerX, existing.y - centerY) <= Math.hypot(screen.x - centerX, screen.y - centerY)) continue;
      }
      catalogPointHitGrid.set(key, { x: screen.x, y: screen.y, radius: CATALOG_POINT_HIT_RADIUS_PX, tile, pointIndex: index });
    }
  }
  usableViewportRectCache = previousRectCache;
  catalogPointHitGridValid = true;
}

function showCatalogPointHover(entry: CatalogPointHitEntry) {
  catalogPointHover.style.setProperty("--hover-x", `${entry.x}px`);
  catalogPointHover.style.setProperty("--hover-y", `${entry.y}px`);
  catalogPointHover.dataset.visible = "true";
}

function hideCatalogPointHover() {
  delete catalogPointHover.dataset.visible;
}

function rebuildBodyHitGrid() {
  bodyHitGrid = new Map();
  for (const body of visibleBodies()) {
    const screen = bodyToScreen(body);
    const radius = bodyHitRadius(body);
    const minCellX = Math.floor((screen.x - radius) / BODY_HIT_GRID_CELL_PX);
    const maxCellX = Math.floor((screen.x + radius) / BODY_HIT_GRID_CELL_PX);
    const minCellY = Math.floor((screen.y - radius) / BODY_HIT_GRID_CELL_PX);
    const maxCellY = Math.floor((screen.y + radius) / BODY_HIT_GRID_CELL_PX);
    const entry = { body, x: screen.x, y: screen.y, radius };
    for (let gx = minCellX; gx <= maxCellX; gx += 1) {
      for (let gy = minCellY; gy <= maxCellY; gy += 1) {
        const key = `${gx}:${gy}`;
        const bucket = bodyHitGrid.get(key);
        if (bucket) bucket.push(entry);
        else bodyHitGrid.set(key, [entry]);
      }
    }
  }
  bodyHitGridValid = true;
}

function edgeReferenceAt(x: number, y: number) {
  return edgeReferenceHitRegions.find((region) => x >= region.rect.left && x <= region.rect.right && y >= region.rect.top && y <= region.rect.bottom) ?? null;
}

function visibleBodies() {
  if (visibleBodiesFrameCache) return visibleBodiesFrameCache;
  const rect = expandedRect(usableViewportRect(), 80);
  visibleBodiesFrameCache = (ephemeris?.bodies ?? []).filter((body) => {
    const isPinnedContext = body.key === selectedKey || body.key === compareTargetKey || body.key === hoverKey;
    if (!isPinnedContext && !bodyMatchesActiveFilter(body)) return false;
    if (!shouldRenderBodyAtScale(body)) return false;
    const screen = worldToScreen(body.position.x_au, body.position.y_au);
    return screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom;
  });
  return visibleBodiesFrameCache;
}

function shouldRenderBodyAtScale(body: Body) {
  const viewWidthLy = currentViewWidthLy();
  if (body.key === selectedKey || body.key === hoverKey || FEATURED_KEYS.includes(body.key)) return true;
  if (body.catalog_group === "jpl_small_bodies" && viewWidthLy > 2) return false;
  if ((body.catalog_group === "gaia_local_stars" || body.catalog_group === "gaia_500pc_stars" || body.catalog_group === "gaia_10kpc_bright_stars") && viewWidthLy >= 6_000) return false;
  if (body.catalog_group === "simbad_extragalactic" && viewWidthLy < 15_000) return false;
  if (viewWidthLy >= 6_000 && isSolarSystemBody(body) && body.key !== selectedKey && body.key !== hoverKey && body.key !== "sun") return false;
  if (viewWidthLy >= 20_000 && body.catalog_group === "bright_stars") return false;
  if (isSolarSystemBody(body)) return true;
  if (viewWidthLy >= 6_000 && (body.catalog_group === "exoplanet_systems" || body.catalog_group === "nearby_exoplanet_systems")) return false;
  return true;
}

function prioritizedLabelBodies() {
  const selected = selectedBody();
  const visible = visibleBodies();
  return visible
    .filter((body) => body.key === selected?.key || body.key === hoverKey || isMajorBody(body) || camera.pxPerAu > 12)
    .sort((a, b) => labelPriority(b) - labelPriority(a))
    .slice(0, 40);
}

function edgeReferenceBodies() {
  const rect = usableViewportRect();
  const selected = selectedBody();
  const viewWidthLy = currentViewWidthLy();
  return (ephemeris?.bodies ?? [])
    .filter((body) => {
      if (body.key === selectedKey) return false;
      if (!bodyMatchesActiveFilter(body) || !shouldRenderBodyAtScale(body)) return false;
      if (viewWidthLy >= 6_000 && !isMajorBody(body) && !FEATURED_KEYS.includes(body.key)) return false;
      return true;
    })
    .map((body) => {
      const screen = bodyToScreen(body);
      const selectedDistanceKm = selected ? bodyDistanceKm(selected, body) : body.distance_from_earth_km;
      return { body, screen, selectedDistanceKm };
    })
    .filter(({ screen }) => screen.x < rect.left || screen.x > rect.right || screen.y < rect.top || screen.y > rect.bottom)
    .sort((a, b) => a.selectedDistanceKm - b.selectedDistanceKm);
}

function bodyHitRadius(body: Body) {
  return Math.max(bodyDisplayRadiusPx(body) + 6, body.key === selectedKey || body.key === hoverKey ? 12 : 7);
}

function bodyDisplayRadiusPx(body: Body) {
  const physicalRadiusPx = bodyRadiusAu(body) * camera.pxPerAu;
  return Math.max(MAP_POINT_RADIUS_PX, physicalRadiusPx);
}

function bodyRadiusAu(body: Body) {
  if (!Number.isFinite(body.radius_km) || body.radius_km <= 0) return 0;
  return body.radius_km / auKm();
}

function isPointLayerDuplicateBody(body: Body) {
  return Boolean(body.catalog_group && POINT_LAYER_GROUP_SET.has(body.catalog_group));
}

function labelPriority(body: Body) {
  if (body.key === selectedKey) return 100;
  if (body.key === hoverKey) return 90;
  const classification = classifyBody(body);
  if (body.key === "sun") return 80;
  if (classification.type === "planet") return 70;
  if (classification.type === "moon") return 42;
  if (classification.type === "star") return 36;
  if (classification.type === "quasar" || classification.type === "active_galaxy") return 34;
  return 20;
}

function isMajorBody(body: Body) {
  const type = classifyBody(body).type;
  return (
    type === "planet" ||
    type === "galaxy" ||
    type === "quasar" ||
    type === "active_galaxy" ||
    body.key === selectedKey ||
    FEATURED_KEYS.includes(body.key) ||
    (type === "star" && body.catalog_group === "nearby_exoplanet_systems") ||
    (type === "star" && body.catalog_group === "bright_stars" && (body.stellar?.apparent_magnitude ?? 99) <= 1.5)
  );
}

function isSolarSystemBody(body: Body) {
  return body.catalog_group === "core" || body.catalog_group?.endsWith("_moons");
}

function countBodies(bodies: Body[]) {
  return bodies.reduce(
    (counts, body) => {
      const type = classifyBody(body).type;
      if (isSolarSystemBody(body) || type === "planet" || type === "moon") counts.solar += 1;
      if (type === "asteroid" || type === "comet" || type === "small_body") counts.smallBodies += 1;
      if (type === "star" && body.catalog_group !== "core") counts.stars += 1;
      if (body.catalog_group === "exoplanet_systems" || body.catalog_group === "nearby_exoplanet_systems") counts.exoplanetSystems += 1;
      if (body.catalog_group === "messier_deep_sky" || body.catalog_group === "simbad_extragalactic") counts.deepSky += 1;
      return counts;
    },
    { solar: 0, stars: 0, smallBodies: 0, exoplanetSystems: 0, deepSky: 0 }
  );
}

function selectedBody() {
  return bodyByKey.get(selectedKey) ?? null;
}

function compareTarget() {
  if (!compareTargetKey || compareTargetKey === selectedKey) return null;
  return bodyByKey.get(compareTargetKey) ?? null;
}

function ensureCompareTarget() {
  if (!ephemeris || !selectedKey) {
    compareTargetKey = null;
    return;
  }
  if (compareTargetKey && compareTargetKey !== selectedKey && bodyByKey.has(compareTargetKey)) return;
  compareTargetKey = null;
}

function bodyDistanceKm(a: Body, b: Body) {
  return (
    Math.hypot(
      a.position.x_au - b.position.x_au,
      a.position.y_au - b.position.y_au,
      a.position.z_au - b.position.z_au
    ) * auKm()
  );
}

function sizeComparisonModel(a: Body, b: Body) {
  const aDiameter = Math.max(0, a.radius_km * 2);
  const bDiameter = Math.max(0, b.radius_km * 2);
  const maxDiameter = Math.max(aDiameter, bDiameter, 1);
  const visual = (body: Body, diameterKm: number): SizeVisual => {
    const diameterPx = (diameterKm / maxDiameter) * MAX_COMPARISON_DIAMETER_PX;
    return {
      diameterKm,
      diameterPx,
      isSubpixel: diameterKm > 0 && diameterPx < 1,
      visualType: classifyBody(body).type
    };
  };
  const ratio = bDiameter / Math.max(aDiameter, 1);
  const ratioLabel = ratio >= 1 ? `${b.name} is ${formatRatio(ratio)}x ${a.name}` : `${a.name} is ${formatRatio(1 / Math.max(ratio, 1e-9))}x ${b.name}`;
  return {
    a: visual(a, aDiameter),
    b: visual(b, bDiameter),
    ratioLabel,
    scaleLabel: `Scale: ${formatDistance(maxDiameter / MAX_COMPARISON_DIAMETER_PX)} per screen pixel`
  };
}

function worldToScreen(xAu: number, yAu: number): ScreenPoint {
  const rect = usableViewportRect();
  return {
    x: rect.left + rect.width / 2 + (xAu - camera.xAu) * camera.pxPerAu,
    y: rect.top + rect.height / 2 - (yAu - camera.yAu) * camera.pxPerAu
  };
}

function bodyToScreen(body: Body): ScreenPoint {
  return worldToScreen(body.position.x_au, body.position.y_au);
}

function screenToWorld(x: number, y: number) {
  const rect = usableViewportRect();
  return {
    xAu: camera.xAu + (x - (rect.left + rect.width / 2)) / camera.pxPerAu,
    yAu: camera.yAu - (y - (rect.top + rect.height / 2)) / camera.pxPerAu
  };
}

function usableViewportRect(): Rect {
  if (usableViewportRectCache) return usableViewportRectCache;
  return computeUsableViewportRect();
}

function computeUsableViewportRect(): Rect {
  const workspace = document.querySelector<HTMLElement>(".workspace-panel:not([hidden])");
  const bar = document.querySelector<HTMLElement>(".atlas-bar");
  const selection = document.querySelector<HTMLElement>(".selection-strip");
  const visibleModeRail = document.querySelector<HTMLElement>(".mode-rail:not([hidden])");
  const scaleRail = document.querySelector<HTMLElement>(".scale-rail");
  const workspaceRect = workspace?.getBoundingClientRect();
  const barRect = bar?.getBoundingClientRect();
  const selectionRect = selection?.getBoundingClientRect();
  const modeRailRect = visibleModeRail?.getBoundingClientRect();
  const scaleRailRect = scaleRail?.getBoundingClientRect();
  const isWide = window.innerWidth >= 900;
  const left = 0;
  const topBoundary = Math.max(barRect?.bottom ?? 0, !isWide ? modeRailRect?.bottom ?? 0 : 0, !isWide ? selectionRect?.bottom ?? 0 : 0);
  const top = Math.max(0, topBoundary + 8);
  const rightObstructions = [workspaceRect?.left, selectionRect && !selectedObjectPanel.hidden ? selectionRect.left : undefined].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const right = isWide && rightObstructions.length > 0 ? Math.max(240, Math.min(...rightObstructions) - 12) : window.innerWidth;
  const mobileObjectSheetTop = !isWide && activeTab === "object" ? workspaceRect?.top : undefined;
  const bottomBoundary = !isWide ? Math.min(scaleRailRect?.top ?? window.innerHeight, mobileObjectSheetTop ?? window.innerHeight) : window.innerHeight;
  const bottom = Math.max(top + 1, bottomBoundary - 10);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function edgeLabelRect(text: string, anchor: ScreenPoint, side: EdgeSide, bounds: Rect): Rect {
  const width = ctx.measureText(text).width + 12;
  const height = 22;
  let left = anchor.x + 10;
  let top = anchor.y - height / 2;

  if (side === "right") left = anchor.x - width - 10;
  if (side === "top") {
    left = anchor.x - width / 2;
    top = anchor.y + 10;
  }
  if (side === "bottom") {
    left = anchor.x - width / 2;
    top = anchor.y - height - 10;
  }

  left = clamp(left, bounds.left + 3, bounds.right - width - 3);
  top = clamp(top, bounds.top + 3, bounds.bottom - height - 3);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function eventToCanvasPoint(event: PointerEvent | WheelEvent): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function currentPinchGesture() {
  const [first, second] = Array.from(activeMapPointers.values());
  if (!first || !second) return null;
  return {
    midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y)
  };
}

function renderScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function resizeCanvas() {
  const dpr = renderScale();
  const cssWidth = Math.floor(window.innerWidth);
  const cssHeight = Math.floor(window.innerHeight);
  const deviceWidth = Math.floor(cssWidth * dpr);
  const deviceHeight = Math.floor(cssHeight * dpr);
  if (canvas.width === deviceWidth && canvas.height === deviceHeight) return;
  canvas.width = deviceWidth;
  canvas.height = deviceHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  pointRenderer.setSize(deviceWidth, deviceHeight);
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
  return typeof km === "number" && Number.isFinite(km) ? formatDistance(km) : t("value.unknown");
}

function nullableNumber(value: number | null | undefined, digits: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : t("value.unknown");
}

function nullableDegrees(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? t("value.degrees", { value: value.toFixed(2) }) : t("value.unknown");
}

function nullableDays(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return t("value.unknown");
  if (value >= 365) return t("value.years", { value: (value / 365.25).toFixed(2) });
  return t("value.days", { value: value.toFixed(2) });
}

function nullableLightYears(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${formatNumber(value)} ly` : t("value.unknown");
}

function equatorialCoordinatesForBody(body: Body) {
  const raDeg = finiteOptionalNumber(body.catalog?.ra_deg);
  const decDeg = finiteOptionalNumber(body.catalog?.dec_deg);
  if (raDeg == null || decDeg == null) return null;
  return { raDeg, decDeg };
}

function formatRightAscensionForBody(body: Body) {
  const coordinates = equatorialCoordinatesForBody(body);
  if (!coordinates) return null;
  return `${formatRightAscension(coordinates.raDeg)} (${formatDecimalDegrees(coordinates.raDeg)})`;
}

function formatDeclinationForBody(body: Body) {
  const coordinates = equatorialCoordinatesForBody(body);
  if (!coordinates) return null;
  return `${formatDeclination(coordinates.decDeg)} (${formatDecimalDegrees(coordinates.decDeg)})`;
}

function formatRaDecDecimal(body: Body) {
  const coordinates = equatorialCoordinatesForBody(body);
  if (!coordinates) return null;
  return `${formatDecimalDegrees(coordinates.raDeg)}, ${formatDecimalDegrees(coordinates.decDeg)}`;
}

function galacticCoordinatesForBody(body: Body) {
  const coordinates = equatorialCoordinatesForBody(body);
  return coordinates ? equatorialToGalactic(coordinates) : null;
}

function formatGalacticLongitude(body: Body) {
  const coordinates = galacticCoordinatesForBody(body);
  return coordinates ? formatDecimalDegrees(coordinates.longitudeDeg, 3) : null;
}

function formatGalacticLatitude(body: Body) {
  const coordinates = galacticCoordinatesForBody(body);
  return coordinates ? formatDecimalDegrees(coordinates.latitudeDeg, 3) : null;
}

function eclipticCoordinatesForBody(body: Body) {
  return eclipticCartesianToSpherical(body.position.x_au, body.position.y_au, body.position.z_au);
}

function formatEclipticLongitude(body: Body) {
  const coordinates = eclipticCoordinatesForBody(body);
  return coordinates ? formatDecimalDegrees(coordinates.longitudeDeg, 3) : null;
}

function formatEclipticLatitude(body: Body) {
  const coordinates = eclipticCoordinatesForBody(body);
  return coordinates ? formatDecimalDegrees(coordinates.latitudeDeg, 3) : null;
}

function formatEclipticRadius(body: Body) {
  const coordinates = eclipticCoordinatesForBody(body);
  return coordinates ? `${formatNumber(coordinates.radiusAu)} AU` : null;
}

function formatAuCoordinate(value: number) {
  return `${formatNumber(value)} AU`;
}

function readableOptionalModel(value: string | null | undefined) {
  return value ? readablePositionModel(value) : null;
}

function readableCatalogGroup(value: string | null | undefined) {
  return value ? readablePositionModel(value) : null;
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
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) || t("value.unknown");
}

function auKm() {
  return ephemeris?.au_km ?? AU_KM_FALLBACK;
}

function rectInCanvas(rect: Rect) {
  return rect.right >= 0 && rect.left <= window.innerWidth && rect.bottom >= 0 && rect.top <= window.innerHeight;
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
