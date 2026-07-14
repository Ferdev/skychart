import type {
  DestinationBody,
  DestinationBodyType,
} from "../destinationPicker";
import type { PointLayerSource } from "../webglPointRenderer";
import type { BodyFilter } from "../viewState";
import type { Rect } from "../geometry";


export type AtlasTab = "catalog" | "object";

export type ActiveAtlasTab = AtlasTab | null;

export type SizeMode = "readable" | "hybrid" | "true";

export type ZoomPreset = "inner" | "solar" | "nearby" | "galaxy" | "localGroup" | "messier" | "cosmicWeb" | "all";

export type UniverseShell = {
  id: string;
  labelKey: string;
  radiusLy: number;
  noteKey: string;
};

export type ExternalLink = {
  provider?: string | null;
  label?: string | null;
  url?: string | null;
};

export type VectorComponents = {
  x: number;
  y: number;
  z: number;
};

export type BodyCatalog = {
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

export type BodyStateVector = {
  position_km: VectorComponents;
  velocity_km_s: VectorComponents;
  distance_km: number;
  speed_km_s: number;
  heliocentric_distance_km: number;
  heliocentric_speed_km_s: number;
};

export type BodyOrbit = {
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

export type BodyStellar = {
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

export type BodyExoplanet = {
  name: string;
  radius_earth?: number | null;
  mass_earth?: number | null;
  period_days?: number | null;
  semi_major_axis_au?: number | null;
  discovery_method?: string | null;
  discovery_year?: number | null;
};

export type BodyExoplanetSystem = {
  source?: string | null;
  system_star_count?: number | null;
  system_planet_count?: number | null;
  system_moon_count?: number | null;
  confirmed_planet_count?: number | null;
  planets?: BodyExoplanet[];
  why_interesting?: string | null;
};

export type BodyDeepSky = {
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

export type BodySmallBody = {
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

export type Body = DestinationBody & {
  catalog?: BodyCatalog | null;
  state_vector?: BodyStateVector | null;
  orbit?: BodyOrbit | null;
  stellar?: BodyStellar | null;
  exoplanet_system?: BodyExoplanetSystem | null;
  deep_sky?: BodyDeepSky | null;
  small_body?: BodySmallBody | null;
};

export type Ephemeris = {
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

export type CatalogSummary = {
  object_count: number;
  group_counts?: Record<string, number>;
  type_counts?: Record<string, number>;
  available_groups?: { key: string; label: string; description?: string }[];
};

export type CatalogSearchPayload = {
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

export type CatalogViewportPayload = {
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

export type CatalogDensityPayload = {
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

export type CatalogDensityCell = {
  x_bin: number;
  y_bin: number;
  count: number;
  min_magnitude?: number | null;
  avg_magnitude?: number | null;
};

export type CatalogPointPayload = {
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

export type CatalogPointTileRequest = {
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

export type CatalogPointTile = {
  request: CatalogPointTileRequest;
  payload?: CatalogPointPayload;
  source?: PointLayerSource;
  abortController?: AbortController;
  loadedAt?: number;
  failedAt?: number;
  retryCount?: number;
  lastUsedAt: number;
};

export type CatalogPointTileManifestLevel = {
  span_log2: number;
  span_au: number;
  sample_buckets?: number;
  max_points_per_tile?: number;
  tile_count?: number;
  point_count?: number;
  raw_point_count?: number;
};

export type CatalogPointContainerIndex = {
  view: DataView;
  count: number;
};

export type CatalogPointTileManifestLayer = {
  id: string;
  tile_url_template?: string;
  container?: string;
  containerIndex?: CatalogPointContainerIndex;
  groups: string[];
  types: DestinationBodyType[];
  source_counts: Record<string, number>;
  levels: CatalogPointTileManifestLevel[];
};

export type CatalogPointTileManifest = {
  version: string;
  format: "SMP2" | "SMP3";
  color_lut: number[][];
  source_counts: Record<string, number>;
  layers: CatalogPointTileManifestLayer[];
};

export type CatalogPointTileManifestState = "loading" | "ready" | "missing";

export type ObjectDetailHydrationStatus = "loading" | "error";

export type ObjectDetailHydrationState = {
  status: ObjectDetailHydrationStatus;
  message?: string;
  requestId: number;
};

export type CatalogNearestPayload = {
  object?: CatalogObjectPayload | null;
};

export type CatalogObjectPayload = {
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

export type CatalogSearchResult = {
  bodies: Body[];
  source: "phoenix" | "local";
  fallback?: boolean;
  total?: number;
  hasMore?: boolean;
  nextOffset?: number;
};

export type Camera = {
  xAu: number;
  yAu: number;
  pxPerAu: number;
};

export type LoadingStep = "api" | "download" | "parse" | "render";

export type EdgeReferenceHitRegion = {
  body: Body;
  rect: Rect;
};

export type SizeVisual = {
  diameterKm: number;
  diameterPx: number;
  isSubpixel: boolean;
  visualType: DestinationBodyType;
};

export type RenderRequestOptions = {
  data?: boolean;
};

export type SelectBodyOptions = {
  center?: boolean;
  zoom?: "local";
  animate?: boolean;
  transient?: boolean;
};

export type CatalogNearestQuery = {
  xAu: number;
  yAu: number;
  radiusAu: number;
  groups: string[];
  types: DestinationBodyType[];
};

export type DataRefreshOptions = {
  immediate?: boolean;
};

export type BodyHitEntry = {
  body: Body;
  x: number;
  y: number;
  radius: number;
};

export type CatalogPointHitEntry = {
  x: number;
  y: number;
  radius: number;
  tile: CatalogPointTile;
  pointIndex: number;
};

export type CatalogPointDecoded = {
  returned: number;
  declared: number;
  flags: number;
  vertices: Float32Array;
  format: "SMP2" | "SMP3";
  originX: number;
  originY: number;
};

export type BodyFilterDefinition = { key: BodyFilter; labelKey: string; types?: DestinationBodyType[]; groups?: string[] };

export type ExploreDomainDefinition = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  filterKey: BodyFilter;
  guidedSetId: string;
  zoomPreset: ZoomPreset;
  count: (summary: CatalogSummary | null, bodies: Body[]) => number | null;
};
