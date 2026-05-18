import { t } from "./i18n";
const DEFAULT_AU_KM = 149_597_870.7;
const LIGHT_YEAR_KM = 9_460_730_472_580.8;
const DEFAULT_COLOR = "#d9b86f";
const RECENT_DESTINATION_VERSION = 1;

export const DESTINATION_PICKER_STORAGE_KEY = "cosmic-atlas:destination-picker:recent";
export const DEFAULT_FAVORITE_BODY_KEYS = ["moon", "mars", "jupiter", "saturn"] as const;
export const DESTINATION_PICKER_CLASSES = {
  root: "destination-picker",
  search: "destination-picker__search",
  section: "destination-picker__section",
  sectionTitle: "destination-picker__section-title",
  list: "destination-picker__list",
  item: "destination-picker__item",
  orb: "destination-picker__orb",
  copy: "destination-picker__copy",
  name: "destination-picker__name",
  meta: "destination-picker__meta",
  distance: "destination-picker__distance",
  badges: "destination-picker__badges",
  badge: "destination-picker__badge"
} as const;

export type DestinationBodyPosition = {
  x_au: number;
  y_au: number;
  z_au: number;
  x_km: number;
  y_km: number;
  z_km: number;
  heliocentric_distance_km: number;
};

export type DestinationBody = {
  key: string;
  name: string;
  radius_km: number;
  color: string;
  object_type?: DestinationBodyType;
  parent_key?: string | null;
  catalog_group?: string;
  aliases?: readonly string[];
  catalog?: { aliases?: readonly string[] } | null;
  stellar?: DestinationStellarInfo | null;
  deep_sky?: DestinationDeepSkyInfo | null;
  exoplanet_system?: DestinationExoplanetSystemInfo | null;
  position: DestinationBodyPosition;
  distance_from_earth_km: number;
};

export type DestinationStellarInfo = {
  hip?: number | null;
  hd?: number | null;
  apparent_magnitude?: number | null;
  spectral_type?: string | null;
};

export type DestinationDeepSkyInfo = {
  aliases?: readonly string[];
  deep_sky_type_label?: string | null;
  apparent_magnitude?: number | null;
  angular_size_arcmin?: string | null;
  constellation?: string | null;
  viewing_season?: string | null;
  common_name?: string | null;
  observing_equipment?: string | null;
};

export type DestinationExoplanetSystemInfo = {
  confirmed_planet_count?: number | null;
  system_star_count?: number | null;
  planets?: readonly { name?: string | null; discovery_method?: string | null; discovery_year?: number | null }[];
  why_interesting?: string | null;
};

export type DestinationBodyType =
  | "star"
  | "planet"
  | "moon"
  | "dwarf_planet"
  | "galaxy"
  | "quasar"
  | "active_galaxy"
  | "black_hole"
  | "pulsar"
  | "nebula"
  | "star_cluster"
  | "asterism"
  | "milky_way_patch"
  | "asteroid"
  | "comet"
  | "small_body"
  | "unknown";

export type DestinationIconKey =
  | "sun"
  | "planet"
  | "moon"
  | "dwarf"
  | "galaxy"
  | "quasar"
  | "black_hole"
  | "pulsar"
  | "nebula"
  | "cluster"
  | "asteroid"
  | "comet"
  | "target";

export type BodyClassification = {
  type: DestinationBodyType;
  label: string;
  icon: DestinationIconKey;
  sortGroup: number;
};

export type DestinationPickerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type RecentDestination = {
  key: string;
  count: number;
  firstSelectedAtUtc: string;
  lastSelectedAtUtc: string;
  lastDistanceFromEarthKm?: number;
};

export type DestinationPickerBadgeKind = "target" | "selected" | "favorite" | "frequent" | "recent";

export type DestinationPickerBadge = {
  kind: DestinationPickerBadgeKind;
  label: string;
};

export type DestinationPickerItem = {
  key: string;
  name: string;
  searchLabel: string;
  type: DestinationBodyType;
  typeLabel: string;
  icon: DestinationIconKey;
  color: string;
  radiusKm: number;
  radiusLabel: string;
  metaLabel: string;
  distanceFromEarthKm: number;
  distanceLabel: string;
  heliocentricDistanceKm: number;
  heliocentricDistanceLabel: string;
  ariaLabel: string;
  badges: DestinationPickerBadge[];
  isCurrentTarget: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  isFrequent: boolean;
  isRecent: boolean;
  frequencyCount: number;
  lastSelectedAtUtc: string | null;
  searchTokens: string[];
  sortRank: number;
};

export type DestinationPickerSectionKind = "results" | "favorites" | "frequent" | "recent" | "all";

export type DestinationPickerSection = {
  kind: DestinationPickerSectionKind;
  label: string;
  items: DestinationPickerItem[];
};

export type DestinationPickerBuildOptions = {
  query?: string;
  selectedKey?: string | null;
  currentTargetKey?: string | null;
  favoriteKeys?: readonly string[];
  recentDestinations?: readonly RecentDestination[];
  includeTypes?: readonly DestinationBodyType[];
  excludeKeys?: readonly string[];
  maxResults?: number;
  frequentThreshold?: number;
  auKm?: number;
};

export type DestinationPickerSectionsOptions = DestinationPickerBuildOptions & {
  maxFavorites?: number;
  maxFrequent?: number;
  maxRecent?: number;
  includeAllSection?: boolean;
};

export type RecentDestinationOptions = {
  storage?: DestinationPickerStorage | null;
  storageKey?: string;
  maxEntries?: number;
  now?: Date | string | number;
};

export type RecordDestinationOptions = RecentDestinationOptions & {
  distanceFromEarthKm?: number;
};

type StoredRecentDestinations = {
  version: typeof RECENT_DESTINATION_VERSION;
  destinations: RecentDestination[];
};

const PLANET_KEYS = new Set(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]);
const MOON_KEYS = new Set([
  "moon",
  "luna",
  "phobos",
  "deimos",
  "charon",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "titan",
  "enceladus",
  "iapetus",
  "mimas",
  "rhea",
  "dione",
  "tethys",
  "triton",
  "miranda",
  "ariel",
  "umbriel",
  "titania",
  "oberon"
]);
const DWARF_PLANET_KEYS = new Set(["pluto", "ceres", "eris", "haumea", "makemake"]);
const ASTEROID_KEYS = new Set(["vesta", "pallas", "hygiea", "psyche", "bennu", "ryugu", "eros", "ida", "gaspra"]);
const COMET_KEYS = new Set(["halley", "borrelly", "tempel", "churyumov", "gerasimenko"]);
const SOLAR_ORDER = new Map<string, number>([
  ["sun", 0],
  ["mercury", 10],
  ["venus", 20],
  ["earth", 30],
  ["moon", 31],
  ["mars", 40],
  ["phobos", 41],
  ["deimos", 42],
  ["ceres", 45],
  ["jupiter", 50],
  ["io", 51],
  ["europa", 52],
  ["ganymede", 53],
  ["callisto", 54],
  ["saturn", 60],
  ["mimas", 61],
  ["enceladus", 62],
  ["tethys", 63],
  ["dione", 64],
  ["rhea", 65],
  ["titan", 66],
  ["iapetus", 67],
  ["uranus", 70],
  ["neptune", 80],
  ["pluto", 90],
  ["charon", 91]
]);

const TYPE_LABEL_KEYS: Record<DestinationBodyType, string> = {
  star: "type.star",
  planet: "type.planet",
  moon: "type.moon",
  dwarf_planet: "type.dwarfPlanet",
  galaxy: "type.galaxy",
  quasar: "type.quasar",
  active_galaxy: "type.activeGalaxy",
  black_hole: "type.blackHole",
  pulsar: "type.pulsar",
  nebula: "type.nebula",
  star_cluster: "type.starCluster",
  asterism: "type.asterism",
  milky_way_patch: "type.milkyWayPatch",
  asteroid: "type.asteroid",
  comet: "type.comet",
  small_body: "type.smallBody",
  unknown: "type.object"
};

const TYPE_ICONS: Record<DestinationBodyType, DestinationIconKey> = {
  star: "sun",
  planet: "planet",
  moon: "moon",
  dwarf_planet: "dwarf",
  galaxy: "galaxy",
  quasar: "quasar",
  active_galaxy: "galaxy",
  black_hole: "black_hole",
  pulsar: "pulsar",
  nebula: "nebula",
  star_cluster: "cluster",
  asterism: "cluster",
  milky_way_patch: "cluster",
  asteroid: "asteroid",
  comet: "comet",
  small_body: "asteroid",
  unknown: "target"
};

const TYPE_SORT_GROUPS: Record<DestinationBodyType, number> = {
  star: 0,
  planet: 1,
  moon: 2,
  dwarf_planet: 3,
  galaxy: 4,
  quasar: 5,
  active_galaxy: 5,
  black_hole: 5,
  pulsar: 5,
  nebula: 5,
  star_cluster: 6,
  asterism: 7,
  milky_way_patch: 8,
  asteroid: 9,
  comet: 10,
  small_body: 11,
  unknown: 12
};

export function classifyBody(body: Pick<DestinationBody, "key" | "name" | "radius_km" | "object_type">): BodyClassification {
  const key = normalizeBodyKey(body.key);
  const name = normalizeText(body.name);
  const type = body.object_type ?? inferBodyType(key, name, body.radius_km);

  return {
    type,
    label: t(TYPE_LABEL_KEYS[type]),
    icon: TYPE_ICONS[type],
    sortGroup: TYPE_SORT_GROUPS[type]
  };
}

export function buildDestinationPickerItems(
  bodies: readonly DestinationBody[],
  options: DestinationPickerBuildOptions = {}
): DestinationPickerItem[] {
  const favoriteKeys = normalizeKeySet(options.favoriteKeys ?? DEFAULT_FAVORITE_BODY_KEYS);
  const excludedKeys = normalizeKeySet(options.excludeKeys ?? []);
  const allowedTypes = options.includeTypes ? new Set(options.includeTypes) : null;
  const recentByKey = recentDestinationMap(options.recentDestinations ?? []);
  const frequentKeys = frequentDestinationKeySet(options.recentDestinations ?? [], {
    threshold: options.frequentThreshold
  });
  const query = normalizeText(options.query ?? "");

  const items = bodies
    .filter((body) => !excludedKeys.has(normalizeBodyKey(body.key)))
    .map((body) => {
      const classification = classifyBody(body);
      if (allowedTypes && !allowedTypes.has(classification.type)) return null;

      const item = createDestinationPickerItem(body, {
        classification,
        selectedKey: options.selectedKey,
        currentTargetKey: options.currentTargetKey,
        isFavorite: favoriteKeys.has(normalizeBodyKey(body.key)),
        recent: recentByKey.get(normalizeBodyKey(body.key)),
        isFrequent: frequentKeys.has(normalizeBodyKey(body.key)),
        favoriteIndex: favoriteIndex(options.favoriteKeys ?? DEFAULT_FAVORITE_BODY_KEYS, body.key),
        auKm: options.auKm
      });
      const searchScore = query ? scoreItemForQuery(item, query) : 0;
      if (query && searchScore === null) return null;
      return { item, searchScore: searchScore ?? 0 };
    })
    .filter(isPresent)
    .sort((a, b) => compareScoredItems(a, b));

  const trimmed = typeof options.maxResults === "number" ? items.slice(0, Math.max(0, options.maxResults)) : items;
  return trimmed.map(({ item }) => item);
}

export function buildDestinationPickerSections(
  bodies: readonly DestinationBody[],
  options: DestinationPickerSectionsOptions = {}
): DestinationPickerSection[] {
  const items = buildDestinationPickerItems(bodies, options);
  const query = normalizeText(options.query ?? "");

  if (query) {
    return [{ kind: "results", label: t("picker.results"), items }];
  }

  const sections: DestinationPickerSection[] = [];
  const maxFavorites = options.maxFavorites ?? 4;
  const maxFrequent = options.maxFrequent ?? 4;
  const maxRecent = options.maxRecent ?? 4;

  const favoriteItems = items.filter((item) => item.isFavorite).slice(0, maxFavorites);
  if (favoriteItems.length > 0) {
    sections.push({ kind: "favorites", label: t("picker.favorites"), items: favoriteItems });
  }

  const promotedKeys = new Set(favoriteItems.map((item) => normalizeBodyKey(item.key)));
  const frequentItems = items
    .filter((item) => item.isFrequent && !promotedKeys.has(normalizeBodyKey(item.key)))
    .sort((a, b) => b.frequencyCount - a.frequencyCount || compareNullableDateDesc(a.lastSelectedAtUtc, b.lastSelectedAtUtc))
    .slice(0, maxFrequent);
  if (frequentItems.length > 0) {
    sections.push({ kind: "frequent", label: t("picker.frequent"), items: frequentItems });
  }
  for (const item of frequentItems) promotedKeys.add(normalizeBodyKey(item.key));

  const recentItems = items
    .filter((item) => item.isRecent && !promotedKeys.has(normalizeBodyKey(item.key)))
    .sort((a, b) => compareNullableDateDesc(a.lastSelectedAtUtc, b.lastSelectedAtUtc))
    .slice(0, maxRecent);
  if (recentItems.length > 0) {
    sections.push({ kind: "recent", label: t("picker.recent"), items: recentItems });
  }

  if (options.includeAllSection ?? true) {
    sections.push({ kind: "all", label: t("picker.allBodies"), items });
  }

  return sections;
}

export function filterDestinationBodies<T extends DestinationBody>(
  bodies: readonly T[],
  query: string,
  options: Omit<DestinationPickerBuildOptions, "query"> = {}
): T[] {
  const bodyByKey = new Map(bodies.map((body) => [normalizeBodyKey(body.key), body]));
  return buildDestinationPickerItems(bodies, { ...options, query })
    .map((item) => bodyByKey.get(normalizeBodyKey(item.key)))
    .filter(isPresent);
}

export function orderDestinationBodies<T extends DestinationBody>(
  bodies: readonly T[],
  options: Omit<DestinationPickerBuildOptions, "query" | "maxResults"> = {}
): T[] {
  const bodyByKey = new Map(bodies.map((body) => [normalizeBodyKey(body.key), body]));
  return buildDestinationPickerItems(bodies, options)
    .map((item) => bodyByKey.get(normalizeBodyKey(item.key)))
    .filter(isPresent);
}

export function findDestinationBody<T extends DestinationBody>(bodies: readonly T[], value: string): T | null {
  const query = normalizeText(value);
  if (!query) return null;

  const bracketedKey = value.match(/\[([^\]]+)]\s*$/)?.[1];
  if (bracketedKey) {
    const keyedBody = findByNormalizedKey(bodies, bracketedKey);
    if (keyedBody) return keyedBody;
  }

  return (
    bodies.find((body) => {
      const item = createDestinationPickerItem(body);
      return (
        normalizeBodyKey(body.key) === normalizeBodyKey(value) ||
        normalizeText(body.name) === query ||
        normalizeText(item.searchLabel) === query ||
        bodyAliases(body).some((alias) => normalizeText(alias) === query || normalizeBodyKey(alias) === normalizeBodyKey(value))
      );
    }) ?? null
  );
}

export function createDestinationPickerItem(
  body: DestinationBody,
  options: {
    classification?: BodyClassification;
    selectedKey?: string | null;
    currentTargetKey?: string | null;
    isFavorite?: boolean;
    isFrequent?: boolean;
    favoriteIndex?: number;
    recent?: RecentDestination;
    auKm?: number;
  } = {}
): DestinationPickerItem {
  const classification = options.classification ?? classifyBody(body);
  const key = normalizeBodyKey(body.key);
  const distanceLabel = formatPickerDistance(body.distance_from_earth_km, options.auKm);
  const radiusLabel = formatPickerDistance(body.radius_km, options.auKm, { preferCompact: false });
  const metaLabel = destinationMetaLabel(body, classification, radiusLabel);
  const heliocentricDistanceLabel = formatPickerDistance(body.position.heliocentric_distance_km, options.auKm);
  const selectedKey = options.selectedKey ? normalizeBodyKey(options.selectedKey) : null;
  const currentTargetKey = options.currentTargetKey ? normalizeBodyKey(options.currentTargetKey) : null;
  const frequencyCount = Math.max(0, options.recent?.count ?? 0);
  const isSelected = selectedKey === key;
  const isCurrentTarget = currentTargetKey === key;
  const isFavorite = options.isFavorite ?? false;
  const isFrequent = options.isFrequent ?? frequencyCount >= 2;
  const isRecent = Boolean(options.recent);
  const badges = destinationBadges({ isCurrentTarget, isSelected, isFavorite, isFrequent, isRecent });
  const searchLabel = body.name;
  const searchTokens = destinationSearchTokens(body, classification);
  const sortRank = destinationSortRank(body, classification, {
    isCurrentTarget,
    isSelected,
    isFavorite,
    isFrequent,
    isRecent,
    frequencyCount,
    lastSelectedAtUtc: options.recent?.lastSelectedAtUtc ?? null,
    favoriteIndex: options.favoriteIndex ?? -1
  });

  return {
    key: body.key,
    name: body.name,
    searchLabel,
    type: classification.type,
    typeLabel: classification.label,
    icon: classification.icon,
    color: safeCssColor(body.color),
    radiusKm: finiteNumber(body.radius_km, 0),
    radiusLabel,
    metaLabel,
    distanceFromEarthKm: finiteNumber(body.distance_from_earth_km, 0),
    distanceLabel,
    heliocentricDistanceKm: finiteNumber(body.position.heliocentric_distance_km, 0),
    heliocentricDistanceLabel,
    ariaLabel: destinationAriaLabel(body.name, classification.label, distanceLabel, badges),
    badges,
    isCurrentTarget,
    isSelected,
    isFavorite,
    isFrequent,
    isRecent,
    frequencyCount,
    lastSelectedAtUtc: options.recent?.lastSelectedAtUtc ?? null,
    searchTokens,
    sortRank
  };
}

export function loadRecentDestinations(options: RecentDestinationOptions = {}): RecentDestination[] {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return [];

  try {
    const raw = storage.getItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const destinations = parseStoredRecentDestinations(parsed);
    return normalizeRecentDestinations(destinations, options.maxEntries);
  } catch {
    return [];
  }
}

export const readRecentDestinations = loadRecentDestinations;

export function saveRecentDestinations(
  destinations: readonly RecentDestination[],
  options: RecentDestinationOptions = {}
): RecentDestination[] {
  const normalized = normalizeRecentDestinations(destinations, options.maxEntries);
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return normalized;

  const payload: StoredRecentDestinations = {
    version: RECENT_DESTINATION_VERSION,
    destinations: normalized
  };

  try {
    storage.setItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return normalized;
  }

  return normalized;
}

export const writeRecentDestinations = saveRecentDestinations;

export function recordRecentDestination(key: string, options: RecordDestinationOptions = {}): RecentDestination[] {
  const normalizedKey = normalizeBodyKey(key);
  if (!normalizedKey) {
    return loadRecentDestinations(options);
  }

  const now = toUtcIso(options.now ?? new Date());
  const existing = loadRecentDestinations(options);
  const previous = existing.find((destination) => normalizeBodyKey(destination.key) === normalizedKey);
  const next: RecentDestination = {
    key: normalizedKey,
    count: (previous?.count ?? 0) + 1,
    firstSelectedAtUtc: previous?.firstSelectedAtUtc ?? now,
    lastSelectedAtUtc: now,
    lastDistanceFromEarthKm: finiteOptionalNumber(options.distanceFromEarthKm)
  };
  const merged = [next, ...existing.filter((destination) => normalizeBodyKey(destination.key) !== normalizedKey)];
  return saveRecentDestinations(merged, options);
}

export function clearRecentDestinations(options: RecentDestinationOptions = {}): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return;

  try {
    storage.removeItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY);
  } catch {
    // Storage is best-effort; callers should not need to special-case private mode.
  }
}

export function getRecentDestinationKeys(
  destinations: readonly RecentDestination[],
  options: { maxEntries?: number } = {}
): string[] {
  return normalizeRecentDestinations(destinations, options.maxEntries).map((destination) => destination.key);
}

export function getFrequentDestinationKeys(
  destinations: readonly RecentDestination[],
  options: { threshold?: number; maxEntries?: number } = {}
): string[] {
  const threshold = options.threshold ?? 2;
  return normalizeRecentDestinations(destinations)
    .filter((destination) => destination.count >= threshold)
    .sort((a, b) => b.count - a.count || compareDateDesc(a.lastSelectedAtUtc, b.lastSelectedAtUtc))
    .slice(0, options.maxEntries ?? Number.POSITIVE_INFINITY)
    .map((destination) => destination.key);
}

export function safeCssColor(color: string, fallback = DEFAULT_COLOR): string {
  const trimmed = color.trim();
  const shortHex = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHex) {
    return `#${shortHex[1]
      .split("")
      .map((char) => char + char)
      .join("")}`;
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback;
}

export function destinationPickerColorStyle(colorOrItem: string | Pick<DestinationPickerItem, "color">): Record<"--destination-color", string> {
  const color = typeof colorOrItem === "string" ? colorOrItem : colorOrItem.color;
  return { "--destination-color": safeCssColor(color) };
}

export function formatPickerDistance(
  km: number,
  auKm = DEFAULT_AU_KM,
  options: { preferCompact?: boolean } = {}
): string {
  const value = finiteNumber(km, 0);
  const abs = Math.abs(value);
  const preferCompact = options.preferCompact ?? true;

  if (abs >= LIGHT_YEAR_KM * 0.1) {
    const lightYears = value / LIGHT_YEAR_KM;
    if (Math.abs(lightYears) >= 100) return `${formatWholeNumber(lightYears)} ly`;
    if (Math.abs(lightYears) >= 10) return `${lightYears.toFixed(1)} ly`;
    return `${lightYears.toFixed(2)} ly`;
  }
  if (abs >= auKm * 0.1) {
    const au = value / auKm;
    return preferCompact ? `${formatAu(au)} AU` : `${formatWholeNumber(value)} km (${formatAu(au)} AU)`;
  }
  if (preferCompact && abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}M km`;
  }
  if (preferCompact && abs >= 100_000) {
    return `${(value / 1_000).toFixed(0)}k km`;
  }
  return `${formatWholeNumber(value)} km`;
}

export function normalizeBodyKey(key: string): string {
  return key.trim().toLowerCase();
}

export function normalizeDestinationQuery(query: string): string {
  return normalizeText(query);
}

function inferBodyType(key: string, normalizedName: string, radiusKm: number): DestinationBodyType {
  if (key === "sun" || normalizedName === "sun") return "star";
  if (PLANET_KEYS.has(key)) return "planet";
  if (MOON_KEYS.has(key) || normalizedName === "moon") return "moon";
  if (DWARF_PLANET_KEYS.has(key)) return "dwarf_planet";
  if (normalizedName.includes("quasar")) return "quasar";
  if (normalizedName.includes("black hole")) return "black_hole";
  if (normalizedName.includes("pulsar") || normalizedName.includes("psr ")) return "pulsar";
  if (normalizedName.includes("agn") || normalizedName.includes("blazar") || normalizedName.includes("seyfert")) return "active_galaxy";
  if (normalizedName.includes("galaxy")) return "galaxy";
  if (normalizedName.includes("nebula")) return "nebula";
  if (normalizedName.includes("cluster")) return "star_cluster";
  if (ASTEROID_KEYS.has(key)) return "asteroid";
  if (COMET_KEYS.has(key) || normalizedName.includes("comet")) return "comet";
  if (radiusKm > 50_000) return "planet";
  if (radiusKm > 1_000) return "planet";
  if (radiusKm > 0) return "small_body";
  return "unknown";
}

function destinationMetaLabel(body: DestinationBody, classification: BodyClassification, radiusLabel: string): string {
  const exoplanetSystem = body.exoplanet_system;
  if (exoplanetSystem) {
    const planetCount = exoplanetSystem.confirmed_planet_count ?? exoplanetSystem.planets?.length ?? 0;
    const starCount = exoplanetSystem.system_star_count;
    const parts = [t("picker.exoplanetSystem"), t("picker.confirmedPlanets", { count: planetCount, planetWord: t(planetCount === 1 ? "object.planetSingular" : "object.planetPlural") })];
    if (starCount && starCount > 1) parts.push(t("picker.stars", { count: starCount }));
    return parts.join(" · ");
  }

  if (body.catalog_group === "bright_stars" && body.stellar) {
    const parts = [t("picker.brightStar")];
    if (typeof body.stellar.apparent_magnitude === "number") parts.push(`mag ${formatMagnitude(body.stellar.apparent_magnitude)}`);
    if (body.stellar.spectral_type) parts.push(body.stellar.spectral_type);
    if (body.stellar.hip) parts.push(`HIP ${body.stellar.hip}`);
    return parts.join(" · ");
  }

  const deepSky = body.deep_sky;
  if (!deepSky) return `${classification.label} · ${radiusLabel} ${t("picker.radius")}`;

  const parts = [deepSky.deep_sky_type_label || classification.label];
  if (typeof deepSky.apparent_magnitude === "number") parts.push(`mag ${formatMagnitude(deepSky.apparent_magnitude)}`);
  if (deepSky.constellation) parts.push(deepSky.constellation);
  if (deepSky.observing_equipment) parts.push(deepSky.observing_equipment);
  return parts.join(" · ");
}

function destinationSearchTokens(body: DestinationBody, classification: BodyClassification): string[] {
  return uniqueStrings([
    normalizeBodyKey(body.key),
    normalizeText(body.name),
    normalizeText(classification.type),
    normalizeText(classification.label),
    ...bodyAliases(body).map(normalizeText),
    normalizeText(body.deep_sky?.deep_sky_type_label ?? ""),
    normalizeText(body.deep_sky?.common_name ?? ""),
    normalizeText(body.deep_sky?.constellation ?? ""),
    normalizeText(body.stellar?.spectral_type ?? ""),
    normalizeText(body.exoplanet_system?.why_interesting ?? ""),
    ...(body.exoplanet_system?.planets ?? []).flatMap((planet) => [normalizeText(planet.name ?? ""), normalizeText(planet.discovery_method ?? "")]),
    ...splitWords(body.name),
    ...splitWords(body.key),
    ...bodyAliases(body).flatMap(splitWords)
  ]).filter(Boolean);
}

function bodyAliases(body: DestinationBody): string[] {
  return [
    ...(body.aliases ?? []),
    ...(body.catalog?.aliases ?? []),
    ...(body.deep_sky?.aliases ?? []),
    body.deep_sky?.common_name ?? ""
  ].filter(Boolean);
}

function scoreItemForQuery(item: DestinationPickerItem, query: string): number | null {
  const queryParts = splitWords(query);
  if (queryParts.length === 0) return 0;

  let total = 0;
  for (const part of queryParts) {
    const best = Math.max(...item.searchTokens.map((token) => scoreToken(token, part)));
    if (best <= 0) return null;
    total += best;
  }

  if (normalizeText(item.name) === query) total += 300;
  if (normalizeBodyKey(item.key) === query) total += 250;
  if (normalizeText(item.name).startsWith(query)) total += 120;
  if (normalizeBodyKey(item.key).startsWith(query)) total += 90;

  return total;
}

function scoreToken(token: string, query: string): number {
  if (token === query) return 100;
  if (token.startsWith(query)) return 75;
  if (token.includes(query)) return 35;
  return 0;
}

function compareScoredItems(
  a: { item: DestinationPickerItem; searchScore: number },
  b: { item: DestinationPickerItem; searchScore: number }
): number {
  return b.searchScore - a.searchScore || b.item.sortRank - a.item.sortRank || a.item.name.localeCompare(b.item.name);
}

function destinationSortRank(
  body: DestinationBody,
  classification: BodyClassification,
  flags: {
    isCurrentTarget: boolean;
    isSelected: boolean;
    isFavorite: boolean;
    isFrequent: boolean;
    isRecent: boolean;
    frequencyCount: number;
    lastSelectedAtUtc: string | null;
    favoriteIndex: number;
  }
): number {
  const key = normalizeBodyKey(body.key);
  const solarOrder = SOLAR_ORDER.get(key) ?? 500 + classification.sortGroup * 20;
  const favoriteRank = flags.favoriteIndex >= 0 ? Math.max(0, 20 - flags.favoriteIndex) : 0;
  const recencyRank = flags.lastSelectedAtUtc ? Date.parse(flags.lastSelectedAtUtc) / 1_000_000_000_000 : 0;

  return (
    (flags.isCurrentTarget ? 1_000_000 : 0) +
    (flags.isSelected ? 900_000 : 0) +
    (flags.isFavorite ? 700_000 + favoriteRank * 100 : 0) +
    (flags.isFrequent ? 500_000 + Math.min(flags.frequencyCount, 99) * 1_000 : 0) +
    (flags.isRecent ? 300_000 + recencyRank : 0) +
    Math.max(0, 10_000 - solarOrder)
  );
}

function destinationBadges(flags: {
  isCurrentTarget: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  isFrequent: boolean;
  isRecent: boolean;
}): DestinationPickerBadge[] {
  const badges: DestinationPickerBadge[] = [];
  if (flags.isCurrentTarget) badges.push({ kind: "target", label: t("picker.target") });
  if (flags.isSelected) badges.push({ kind: "selected", label: t("picker.selected") });
  if (flags.isFavorite) badges.push({ kind: "favorite", label: t("picker.favorite") });
  if (flags.isFrequent) badges.push({ kind: "frequent", label: t("picker.frequent") });
  if (flags.isRecent) badges.push({ kind: "recent", label: t("picker.recent") });
  return badges;
}

function destinationAriaLabel(
  name: string,
  typeLabel: string,
  distanceLabel: string,
  badges: readonly DestinationPickerBadge[]
): string {
  const badgeText = badges.length > 0 ? `, ${badges.map((badge) => badge.label).join(", ")}` : "";
  return `${name}, ${typeLabel}, ${distanceLabel} ${t("picker.fromEarth")}${badgeText}`;
}

function recentDestinationMap(destinations: readonly RecentDestination[]): Map<string, RecentDestination> {
  return new Map(normalizeRecentDestinations(destinations).map((destination) => [normalizeBodyKey(destination.key), destination]));
}

function frequentDestinationKeySet(
  destinations: readonly RecentDestination[],
  options: { threshold?: number } = {}
): Set<string> {
  return new Set(getFrequentDestinationKeys(destinations, { threshold: options.threshold }));
}

function normalizeRecentDestinations(destinations: readonly RecentDestination[], maxEntries = 12): RecentDestination[] {
  const byKey = new Map<string, RecentDestination>();

  for (const destination of destinations) {
    const key = normalizeBodyKey(destination.key);
    if (!key) continue;

    const count = Math.max(1, Math.floor(finiteNumber(destination.count, 1)));
    const firstSelectedAtUtc = validIsoDate(destination.firstSelectedAtUtc) ?? validIsoDate(destination.lastSelectedAtUtc) ?? toUtcIso(new Date());
    const lastSelectedAtUtc = validIsoDate(destination.lastSelectedAtUtc) ?? firstSelectedAtUtc;
    const previous = byKey.get(key);
    const normalized: RecentDestination = {
      key,
      count: count + (previous?.count ?? 0),
      firstSelectedAtUtc: minIsoDate(previous?.firstSelectedAtUtc, firstSelectedAtUtc),
      lastSelectedAtUtc: maxIsoDate(previous?.lastSelectedAtUtc, lastSelectedAtUtc),
      lastDistanceFromEarthKm: finiteOptionalNumber(destination.lastDistanceFromEarthKm ?? previous?.lastDistanceFromEarthKm)
    };
    byKey.set(key, normalized);
  }

  return Array.from(byKey.values())
    .sort((a, b) => compareDateDesc(a.lastSelectedAtUtc, b.lastSelectedAtUtc))
    .slice(0, Math.max(0, maxEntries));
}

function parseStoredRecentDestinations(value: unknown): RecentDestination[] {
  if (Array.isArray(value)) {
    return value.filter(isRecentDestination);
  }
  if (!isRecord(value)) return [];
  if (value.version !== RECENT_DESTINATION_VERSION && value.version !== undefined) return [];
  const destinations = value.destinations;
  return Array.isArray(destinations) ? destinations.filter(isRecentDestination) : [];
}

function isRecentDestination(value: unknown): value is RecentDestination {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    typeof value.count === "number" &&
    typeof value.firstSelectedAtUtc === "string" &&
    typeof value.lastSelectedAtUtc === "string"
  );
}

function findByNormalizedKey<T extends DestinationBody>(bodies: readonly T[], key: string): T | null {
  const normalized = normalizeBodyKey(key);
  return bodies.find((body) => normalizeBodyKey(body.key) === normalized) ?? null;
}

function favoriteIndex(favoriteKeys: readonly string[], key: string): number {
  const normalized = normalizeBodyKey(key);
  return favoriteKeys.findIndex((favoriteKey) => normalizeBodyKey(favoriteKey) === normalized);
}

function normalizeKeySet(keys: readonly string[]): Set<string> {
  return new Set(keys.map(normalizeBodyKey).filter(Boolean));
}

function defaultStorage(): DestinationPickerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function splitWords(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function formatMagnitude(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatAu(au: number): string {
  const abs = Math.abs(au);
  if (abs >= 10) return au.toFixed(1);
  if (abs >= 1) return au.toFixed(2);
  if (abs >= 0.01) return au.toFixed(3);
  return au.toExponential(2);
}

function toUtcIso(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function validIsoDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function minIsoDate(left: string | undefined, right: string): string {
  if (!left) return right;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxIsoDate(left: string | undefined, right: string): string {
  if (!left) return right;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function compareDateDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

function compareNullableDateDesc(left: string | null, right: string | null): number {
  if (left && right) return compareDateDesc(left, right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}
