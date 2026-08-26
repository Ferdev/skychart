export const VIEW_STATE_VERSION = 1;

export const DISPLAY_LAYERS = ["labels", "orbits", "grid", "milkyWay", "milkyWayArms", "milkyWayDust", "milkyWayGuides", "references"] as const;
export type DisplayLayer = typeof DISPLAY_LAYERS[number];

export const BODY_FILTERS = ["all", "solar_system", "planet", "moon", "star", "bright_star", "gaia_star", "exoplanet_system", "dwarf_planet", "small_body", "asteroid", "comet", "deep_sky", "galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster", "xray"] as const;
export type BodyFilter = typeof BODY_FILTERS[number];
export type ViewFilters = { primary: BodyFilter; compare: BodyFilter };

export const SKY_SHARE_VERSION = 1;
export const SKY_CAMERA_QUANTUM_DEG = 0.1;
export const SKY_OBJECT_TYPES = [
  "star", "planet", "moon", "dwarf_planet", "asteroid", "comet", "small_body",
  "galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula",
  "star_cluster", "xray_source", "xray_extended", "asterism", "milky_way_patch", "unknown",
] as const;
export type SkyObjectType = typeof SKY_OBJECT_TYPES[number];

export const SKY_SHARE_LOCALES = ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"] as const;
export type SkyShareLocale = typeof SKY_SHARE_LOCALES[number];

export type SkyViewState = {
  observerKey: string;
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
  constellations: boolean;
  hiddenObjectTypes: SkyObjectType[];
};

export type SkyPermalinkState = SkyViewState & {
  epochUtc: string;
  catalogRelease?: string;
  locale: SkyShareLocale;
};

export type ViewState = {
  center: { x: number; y: number }; zoom: number; time: "now" | string;
  objectKey?: string; compare?: readonly [string, string]; catalogRelease?: string;
  layers: Partial<Record<DisplayLayer, boolean>>; filters?: ViewFilters; sky?: SkyViewState; tour?: string; step?: number;
};

const finite = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const compactNumber = (value: number) => value.toPrecision(15).replace(/(?:\.0+|(?:(\.\d*?)0+))(e|$)/, "$1$2");

const displayLayerSet = new Set<string>(DISPLAY_LAYERS);
const bodyFilterSet = new Set<string>(BODY_FILTERS);
const skyObjectTypeSet = new Set<string>(SKY_OBJECT_TYPES);
const skyShareLocaleSet = new Set<string>(SKY_SHARE_LOCALES);
const isDisplayLayer = (value: string): value is DisplayLayer => displayLayerSet.has(value);
const isBodyFilter = (value: string): value is BodyFilter => bodyFilterSet.has(value);
const isSkyObjectType = (value: string): value is SkyObjectType => skyObjectTypeSet.has(value);

export function encodeLayerFlags(layers: Partial<Record<DisplayLayer, boolean>>): string {
  return DISPLAY_LAYERS.filter((layer) => layers[layer] !== undefined).sort().map((layer) => `${encodeURIComponent(layer)}.${layers[layer] ? "1" : "0"}`).join("~");
}

export function decodeLayerFlags(value: string | null): Partial<Record<DisplayLayer, boolean>> {
  if (!value) return {};
  const result: Partial<Record<DisplayLayer, boolean>> = {};
  for (const flag of value.split("~")) {
    const separator = flag.lastIndexOf(".");
    const encoded = flag.slice(separator + 1);
    if (separator <= 0 || (encoded !== "0" && encoded !== "1")) continue;
    try { const layer = decodeURIComponent(flag.slice(0, separator)); if (isDisplayLayer(layer)) result[layer] = flag.slice(separator + 1) === "1"; } catch { /* forward-compatible malformed flag */ }
  }
  return result;
}

function encodeFilters(filters: ViewFilters): string { return `${filters.primary}.${filters.compare}`; }
function decodeFilters(value: string | null): ViewFilters | undefined {
  const [primary, compare, extra] = value?.split(".") ?? [];
  return !extra && primary && compare && isBodyFilter(primary) && isBodyFilter(compare) ? { primary, compare } : undefined;
}

export function encodeViewState(state: ViewState): string {
  const params = new URLSearchParams();
  params.set("v", String(VIEW_STATE_VERSION));
  params.set("c", `${compactNumber(state.center.x)},${compactNumber(state.center.y)}`);
  params.set("z", compactNumber(state.zoom)); params.set("t", state.time);
  if (state.objectKey) params.set("o", state.objectKey);
  if (state.compare) params.set("cmp", `${state.compare[0]},${state.compare[1]}`);
  if (state.catalogRelease) params.set("r", state.catalogRelease);
  params.set("L", encodeLayerFlags(state.layers));
  if (state.filters) params.set("F", encodeFilters(state.filters));
  if (state.sky) {
    const sky = normalizeSkyViewState(state.sky);
    if (sky) {
      params.set("sky", sky.observerKey);
      params.set("sc", encodeSkyCamera(sky));
      if (!sky.constellations) params.set("sl", "0");
      if (sky.hiddenObjectTypes.length > 0) params.set("sf", sky.hiddenObjectTypes.join(","));
    }
  }
  if (state.tour) params.set("tour", state.tour);
  if (state.step !== undefined) params.set("step", String(state.step));
  return params.toString();
}

export function decodeViewState(input: URLSearchParams | string): ViewState | null {
  const params = typeof input === "string" ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input) : input;
  if (params.get("v") !== String(VIEW_STATE_VERSION)) return null;
  const center = params.get("c")?.split(",") ?? [];
  const x = finite(center[0] ?? null), y = finite(center[1] ?? null), zoom = finite(params.get("z"));
  const rawTime = params.get("t");
  if (x === null || y === null || zoom === null || zoom <= 0 || !rawTime) return null;
  if (rawTime !== "now" && Number.isNaN(Date.parse(rawTime))) return null;
  const compare = params.get("cmp")?.split(",").filter(Boolean) ?? [];
  const rawStep = params.get("step"), step = rawStep === null ? undefined : Number(rawStep);
  if (step !== undefined && (!Number.isSafeInteger(step) || step < 0)) return null;
  const sky = decodeSkyState(params);
  return {
    center: { x, y }, zoom, time: rawTime === "now" ? "now" : new Date(rawTime).toISOString(),
    objectKey: params.get("o") || undefined,
    compare: compare.length === 2 ? [compare[0]!, compare[1]!] : undefined,
    catalogRelease: params.get("r") || undefined, layers: decodeLayerFlags(params.get("L")),
    filters: decodeFilters(params.get("F")), ...(sky ? { sky } : {}), tour: params.get("tour") || undefined, step
  };
}

function decodeSkyState(params: URLSearchParams): SkyViewState | undefined {
  const observerKey = normalizeObserverKey(params.get("sky"));
  if (!observerKey) return undefined;
  const values = params.get("sc")?.split(",") ?? [];
  if (values.length !== 3) return undefined;
  const yawDeg = finite(values[0] ?? null);
  const pitchDeg = finite(values[1] ?? null);
  const fovDeg = finite(values[2] ?? null);
  if (yawDeg === null || pitchDeg === null || fovDeg === null) return undefined;
  if (pitchDeg < -89.5 || pitchDeg > 89.5 || fovDeg < 20 || fovDeg > 110) return undefined;
  const constellations = decodeConstellations(params.get("sl"));
  const hiddenObjectTypes = decodeHiddenObjectTypes(params.get("sf"));
  if (constellations === null || hiddenObjectTypes === null) return undefined;
  return normalizeSkyViewState({ observerKey, yawDeg, pitchDeg, fovDeg, constellations, hiddenObjectTypes }) ?? undefined;
}

export function normalizeObserverKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9:._-]{0,179}$/.test(normalized) ? normalized : null;
}

export function normalizeSkyViewState(value: Partial<SkyViewState>): SkyViewState | null {
  const observerKey = normalizeObserverKey(value.observerKey);
  if (!observerKey || ![value.yawDeg, value.pitchDeg, value.fovDeg].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const pitchDeg = Number(value.pitchDeg);
  const fovDeg = Number(value.fovDeg);
  if (pitchDeg < -89.5 || pitchDeg > 89.5 || fovDeg < 20 || fovDeg > 110) return null;
  const hiddenObjectTypes = normalizeHiddenObjectTypes(value.hiddenObjectTypes ?? []);
  if (!hiddenObjectTypes) return null;
  return {
    observerKey,
    yawDeg: normalizeDegrees(quantizeDegrees(normalizeDegrees(Number(value.yawDeg)))),
    pitchDeg: quantizeDegrees(pitchDeg),
    fovDeg: quantizeDegrees(fovDeg),
    constellations: value.constellations !== false,
    hiddenObjectTypes,
  };
}

export function buildSkyPermalink(state: SkyPermalinkState): string {
  const normalized = normalizeSkyPermalinkState(state);
  if (!normalized) throw new TypeError("Invalid Sky permalink state");
  const params = encodeSkyPermalinkParams(normalized);
  return `/sky/${encodeURIComponent(normalized.observerKey)}?${params.toString()}`;
}

export function buildSkyCardPath(state: SkyPermalinkState): string {
  const normalized = normalizeSkyPermalinkState(state);
  if (!normalized) throw new TypeError("Invalid Sky permalink state");
  const params = encodeSkyPermalinkParams(normalized);
  return `/sky/${encodeURIComponent(normalized.observerKey)}/card.png?${params.toString()}`;
}

export function decodeSkyPermalink(pathname: string, input: URLSearchParams | string, now: Date = new Date()): SkyPermalinkState | null {
  const match = /^\/sky\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let observerKey: string | null = null;
  try { observerKey = normalizeObserverKey(decodeURIComponent(match[1] ?? "")); } catch { return null; }
  if (!observerKey) return null;
  const rawQuery = typeof input === "string" ? (input.startsWith("?") ? input.slice(1) : input) : input.toString();
  if (rawQuery.length > 1_500) return null;
  const params = typeof input === "string" ? new URLSearchParams(rawQuery) : input;
  if (duplicateKnownSkyParams(params)) return null;
  if (params.has("v") && params.get("v") !== String(SKY_SHARE_VERSION)) return null;
  const epochUtc = normalizeEpoch(params.get("t") ?? now.toISOString());
  if (!epochUtc || params.get("t") === "now") return null;
  const cameraValues = (params.get("sc") ?? "0,0,72").split(",");
  if (cameraValues.length !== 3) return null;
  const yawDeg = finite(cameraValues[0] ?? null);
  const pitchDeg = finite(cameraValues[1] ?? null);
  const fovDeg = finite(cameraValues[2] ?? null);
  if (yawDeg === null || pitchDeg === null || fovDeg === null) return null;
  const constellations = decodeConstellations(params.get("sl"));
  const hiddenObjectTypes = decodeHiddenObjectTypes(params.get("sf"));
  const catalogRelease = normalizeCatalogRelease(params.get("r"));
  if (constellations === null || hiddenObjectTypes === null || (params.has("r") && !catalogRelease)) return null;
  const locale = normalizeSkyShareLocale(params.get("lang")) ?? "en";
  return normalizeSkyPermalinkState({
    observerKey, yawDeg, pitchDeg, fovDeg, constellations, hiddenObjectTypes,
    epochUtc, ...(catalogRelease ? { catalogRelease } : {}), locale,
  });
}

export function skyPermalinkToViewState(state: SkyPermalinkState): ViewState {
  return {
    center: { x: 0, y: 0 },
    zoom: 24,
    time: state.epochUtc,
    catalogRelease: state.catalogRelease,
    layers: {},
    sky: {
      observerKey: state.observerKey,
      yawDeg: state.yawDeg,
      pitchDeg: state.pitchDeg,
      fovDeg: state.fovDeg,
      constellations: state.constellations,
      hiddenObjectTypes: [...state.hiddenObjectTypes],
    },
  };
}

export function normalizeSkyShareLocale(value: unknown): SkyShareLocale | null {
  if (typeof value !== "string") return null;
  const match = SKY_SHARE_LOCALES.find((locale) => locale.toLowerCase() === value.trim().toLowerCase());
  return match && skyShareLocaleSet.has(match) ? match : null;
}

function normalizeSkyPermalinkState(state: SkyPermalinkState): SkyPermalinkState | null {
  const sky = normalizeSkyViewState(state);
  const epochUtc = normalizeEpoch(state.epochUtc);
  const catalogRelease = normalizeCatalogRelease(state.catalogRelease ?? null);
  const locale = normalizeSkyShareLocale(state.locale) ?? "en";
  if (!sky || !epochUtc || (state.catalogRelease !== undefined && !catalogRelease)) return null;
  return { ...sky, epochUtc, ...(catalogRelease ? { catalogRelease } : {}), locale };
}

function encodeSkyPermalinkParams(state: SkyPermalinkState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("v", String(SKY_SHARE_VERSION));
  params.set("t", state.epochUtc);
  params.set("sc", encodeSkyCamera(state));
  if (!state.constellations) params.set("sl", "0");
  if (state.hiddenObjectTypes.length > 0) params.set("sf", state.hiddenObjectTypes.join(","));
  if (state.catalogRelease) params.set("r", state.catalogRelease);
  params.set("lang", state.locale);
  return params;
}

function encodeSkyCamera(state: Pick<SkyViewState, "yawDeg" | "pitchDeg" | "fovDeg">): string {
  return [state.yawDeg, state.pitchDeg, state.fovDeg].map(compactNumber).join(",");
}

function decodeConstellations(value: string | null): boolean | null {
  if (value === null || value === "1") return true;
  if (value === "0") return false;
  return null;
}

function decodeHiddenObjectTypes(value: string | null): SkyObjectType[] | null {
  if (!value) return [];
  return normalizeHiddenObjectTypes(value.split(","));
}

function normalizeHiddenObjectTypes(values: readonly unknown[]): SkyObjectType[] | null {
  if (!Array.isArray(values) || values.length > SKY_OBJECT_TYPES.length) return null;
  const normalized: SkyObjectType[] = [];
  for (const value of values) {
    if (typeof value !== "string") return null;
    const type = value.trim().toLowerCase();
    if (!isSkyObjectType(type)) return null;
    normalized.push(type);
  }
  return [...new Set(normalized)].sort();
}

function normalizeCatalogRelease(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function normalizeEpoch(value: string): string | null {
  if (!value || value === "now") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

function duplicateKnownSkyParams(params: URLSearchParams): boolean {
  return ["v", "t", "sc", "sl", "sf", "r", "lang"].some((name) => params.getAll(name).length > 1);
}

function quantizeDegrees(value: number): number {
  const quantized = Math.round((value + Number.EPSILON) / SKY_CAMERA_QUANTUM_DEG) * SKY_CAMERA_QUANTUM_DEG;
  return Object.is(quantized, -0) ? 0 : Number(quantized.toFixed(1));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
