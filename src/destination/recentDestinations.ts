const STORAGE_VERSION = 1;

export const DESTINATION_PICKER_STORAGE_KEY = "cosmic-atlas:destination-picker:recent";

export type DestinationPickerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type RecentDestination = {
  key: string;
  count: number;
  firstSelectedAtUtc: string;
  lastSelectedAtUtc: string;
  lastDistanceFromEarthKm?: number;
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
  version: typeof STORAGE_VERSION;
  destinations: RecentDestination[];
};

/** Reads the best-effort browser history used to rank frequently visited destinations. */
export function loadRecentDestinations(options: RecentDestinationOptions = {}): RecentDestination[] {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return [];
  try {
    const raw = storage.getItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY);
    if (!raw) return [];
    return normalizeRecentDestinations(parseStoredRecentDestinations(JSON.parse(raw) as unknown), options.maxEntries);
  } catch {
    return [];
  }
}

export const readRecentDestinations = loadRecentDestinations;

export function saveRecentDestinations(destinations: readonly RecentDestination[], options: RecentDestinationOptions = {}) {
  const normalized = normalizeRecentDestinations(destinations, options.maxEntries);
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return normalized;
  const payload: StoredRecentDestinations = { version: STORAGE_VERSION, destinations: normalized };
  try {
    storage.setItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return normalized;
  }
  return normalized;
}

export const writeRecentDestinations = saveRecentDestinations;

export function recordRecentDestination(key: string, options: RecordDestinationOptions = {}) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return loadRecentDestinations(options);
  const now = toUtcIso(options.now ?? new Date());
  const existing = loadRecentDestinations(options);
  const previous = existing.find((destination) => normalizeKey(destination.key) === normalizedKey);
  const next: RecentDestination = {
    key: normalizedKey,
    count: (previous?.count ?? 0) + 1,
    firstSelectedAtUtc: previous?.firstSelectedAtUtc ?? now,
    lastSelectedAtUtc: now,
    lastDistanceFromEarthKm: finiteOptionalNumber(options.distanceFromEarthKm),
  };
  return saveRecentDestinations([next, ...existing.filter((destination) => normalizeKey(destination.key) !== normalizedKey)], options);
}

export function clearRecentDestinations(options: RecentDestinationOptions = {}) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return;
  try {
    storage.removeItem(options.storageKey ?? DESTINATION_PICKER_STORAGE_KEY);
  } catch {
    // Browser storage is optional and may be unavailable in privacy modes.
  }
}

export function getRecentDestinationKeys(destinations: readonly RecentDestination[], options: { maxEntries?: number } = {}) {
  return normalizeRecentDestinations(destinations, options.maxEntries).map((destination) => destination.key);
}

export function getFrequentDestinationKeys(
  destinations: readonly RecentDestination[],
  options: { threshold?: number; maxEntries?: number } = {},
) {
  const threshold = options.threshold ?? 2;
  return normalizeRecentDestinations(destinations)
    .filter((destination) => destination.count >= threshold)
    .sort((left, right) => right.count - left.count || compareRecentDateDesc(left.lastSelectedAtUtc, right.lastSelectedAtUtc))
    .slice(0, options.maxEntries ?? Number.POSITIVE_INFINITY)
    .map((destination) => destination.key);
}

export function normalizeRecentDestinations(destinations: readonly RecentDestination[], maxEntries = 12) {
  const byKey = new Map<string, RecentDestination>();
  for (const destination of destinations) {
    const key = normalizeKey(destination.key);
    if (!key) continue;
    const count = Math.max(1, Math.floor(Number.isFinite(destination.count) ? destination.count : 1));
    const firstSelectedAtUtc = validIsoDate(destination.firstSelectedAtUtc) ?? validIsoDate(destination.lastSelectedAtUtc) ?? toUtcIso(new Date());
    const lastSelectedAtUtc = validIsoDate(destination.lastSelectedAtUtc) ?? firstSelectedAtUtc;
    const previous = byKey.get(key);
    byKey.set(key, {
      key,
      count: count + (previous?.count ?? 0),
      firstSelectedAtUtc: minIsoDate(previous?.firstSelectedAtUtc, firstSelectedAtUtc),
      lastSelectedAtUtc: maxIsoDate(previous?.lastSelectedAtUtc, lastSelectedAtUtc),
      lastDistanceFromEarthKm: finiteOptionalNumber(destination.lastDistanceFromEarthKm ?? previous?.lastDistanceFromEarthKm),
    });
  }
  return Array.from(byKey.values())
    .sort((left, right) => compareRecentDateDesc(left.lastSelectedAtUtc, right.lastSelectedAtUtc))
    .slice(0, Math.max(0, maxEntries));
}

export function compareRecentDateDesc(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function parseStoredRecentDestinations(value: unknown): RecentDestination[] {
  if (Array.isArray(value)) return value.filter(isRecentDestination);
  if (!isRecord(value) || (value.version !== STORAGE_VERSION && value.version !== undefined)) return [];
  return Array.isArray(value.destinations) ? value.destinations.filter(isRecentDestination) : [];
}

function isRecentDestination(value: unknown): value is RecentDestination {
  return isRecord(value) && typeof value.key === "string" && typeof value.count === "number" &&
    typeof value.firstSelectedAtUtc === "string" && typeof value.lastSelectedAtUtc === "string";
}

function defaultStorage(): DestinationPickerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function finiteOptionalNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toUtcIso(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function validIsoDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function minIsoDate(left: string | undefined, right: string) {
  return !left || Date.parse(left) > Date.parse(right) ? right : left;
}

function maxIsoDate(left: string | undefined, right: string) {
  return !left || Date.parse(left) < Date.parse(right) ? right : left;
}
