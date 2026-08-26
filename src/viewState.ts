export const VIEW_STATE_VERSION = 1;

export const DISPLAY_LAYERS = ["labels", "orbits", "grid", "milkyWay", "milkyWayArms", "milkyWayDust", "milkyWayGuides", "references"] as const;
export type DisplayLayer = typeof DISPLAY_LAYERS[number];

export const BODY_FILTERS = ["all", "solar_system", "planet", "moon", "star", "bright_star", "gaia_star", "exoplanet_system", "dwarf_planet", "small_body", "asteroid", "comet", "deep_sky", "galaxy", "quasar", "active_galaxy", "black_hole", "pulsar", "nebula", "star_cluster", "xray"] as const;
export type BodyFilter = typeof BODY_FILTERS[number];
export type ViewFilters = { primary: BodyFilter; compare: BodyFilter };

export type SkyViewState = {
  observerKey: string;
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
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
const isDisplayLayer = (value: string): value is DisplayLayer => displayLayerSet.has(value);
const isBodyFilter = (value: string): value is BodyFilter => bodyFilterSet.has(value);

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
    params.set("sky", state.sky.observerKey);
    params.set("sc", [state.sky.yawDeg, state.sky.pitchDeg, state.sky.fovDeg].map(compactNumber).join(","));
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
  const observerKey = params.get("sky")?.trim();
  if (!observerKey) return undefined;
  const values = params.get("sc")?.split(",") ?? [];
  const yawDeg = finite(values[0] ?? null);
  const pitchDeg = finite(values[1] ?? null);
  const fovDeg = finite(values[2] ?? null);
  if (yawDeg === null || pitchDeg === null || fovDeg === null) return undefined;
  if (pitchDeg < -89.5 || pitchDeg > 89.5 || fovDeg < 20 || fovDeg > 110) return undefined;
  return { observerKey, yawDeg, pitchDeg, fovDeg };
}
