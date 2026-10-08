import type { BodyFilterDefinition, CatalogViewportPayload } from "../atlas/contracts";
import type { CatalogObjectMapper } from "./catalogObjectMapper";

type Bounds = { minXAu: number; maxXAu: number; minYAu: number; maxYAu: number };

type ViewportCatalogLoaderOptions = {
  mapper: CatalogObjectMapper;
  canLoad: () => boolean;
  viewWidthLy: () => number;
  filter: () => BodyFilterDefinition;
  worldBounds: (paddingRatio: number) => Bounds;
  hasBody: (key: string) => boolean;
  mergeBodies: (bodies: ReturnType<CatalogObjectMapper["map"]>[]) => void;
  afterMerge: () => void;
  recordLoad: (milliseconds: number) => void;
};

const MAX_WIDTH_LY = 120_000_000;
const DEBOUNCE_MS = 90;

/** Loads the bounded catalog objects needed for the current camera viewport. */
export class ViewportCatalogLoader {
  private timer: number | null = null;
  private requestId = 0;
  private loadedSignature = "";
  private inFlightSignature = "";
  private abortController: AbortController | null = null;

  constructor(private readonly options: ViewportCatalogLoaderOptions) {}

  reset() {
    this.cancel();
    this.loadedSignature = "";
  }

  cancel() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.requestId += 1;
    this.inFlightSignature = "";
  }

  bounds(paddingRatio: number) {
    return this.options.worldBounds(paddingRatio);
  }

  schedule(options: { immediate?: boolean } = {}) {
    if (!this.options.canLoad()) return;
    const request = this.request();
    if (!request || request.signature === this.loadedSignature || request.signature === this.inFlightSignature) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (options.immediate) {
      this.timer = null;
      void this.load(request);
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.load(request);
    }, DEBOUNCE_MS);
  }

  private async load(request: { signature: string; params: URLSearchParams }) {
    if (request.signature === this.loadedSignature || request.signature === this.inFlightSignature) return;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    const requestId = ++this.requestId;
    this.inFlightSignature = request.signature;
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/catalog/viewport?${request.params.toString()}`, { signal: abortController.signal });
      if (!response.ok) throw new Error(`Viewport catalog load failed with ${response.status}`);
      const payload = (await response.json()) as CatalogViewportPayload;
      if (requestId !== this.requestId) return;
      const bodies = payload.objects.map((object) => this.options.mapper.map(object));
      const newBodies = bodies.filter((body) => !this.options.hasBody(body.key));
      this.loadedSignature = request.signature;
      this.inFlightSignature = "";
      if (newBodies.length === 0) return;
      this.options.mergeBodies(newBodies);
      this.options.afterMerge();
    } catch (error) {
      if (requestId === this.requestId) this.inFlightSignature = "";
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("Unable to load viewport catalog objects.", error);
    } finally {
      if (this.abortController === abortController) this.abortController = null;
      if (requestId === this.requestId) this.options.recordLoad(performance.now() - startedAt);
    }
  }

  private request() {
    const width = this.options.viewWidthLy();
    if (!Number.isFinite(width) || width > MAX_WIDTH_LY) return null;
    const bounds = this.options.worldBounds(0.35);
    const filter = this.options.filter();
    const groups = filter.key === "all" || !filter.groups ? catalogGroups(width, bounds) : filter.groups;
    const types = filter.key === "all" ? [] : (filter.types ?? []);
    const limit = catalogLimit(width);
    const params = new URLSearchParams({
      min_x_au: String(bounds.minXAu), max_x_au: String(bounds.maxXAu),
      min_y_au: String(bounds.minYAu), max_y_au: String(bounds.maxYAu),
      groups: groups.join(","), limit: String(limit),
    });
    if (types.length > 0) params.set("types", types.join(","));
    return { params, signature: catalogSignature(bounds, groups, types, limit) };
  }
}

// The map is a top-down projection, so a host star near an ecliptic pole can
// be near the Sun on the map. Inside the Solar System radius a view has small
// bodies only: no host star projects there. Outside the small-body reach a
// view has no small bodies (no star is that near: Proxima Centauri is at
// 268,000 AU).
const SOLAR_SYSTEM_RADIUS_AU = 2_000;
const SMALL_BODY_REACH_AU = 200_000;

function catalogGroups(viewWidthLy: number, bounds: Bounds) {
  if (viewWidthLy < 0.08) {
    // Exoplanet orbits are visible only at this scale, so the hosts and their planets load here.
    const sunDistanceAu = Math.hypot(distanceFromZero(bounds.minXAu, bounds.maxXAu), distanceFromZero(bounds.minYAu, bounds.maxYAu));
    if (sunDistanceAu < SOLAR_SYSTEM_RADIUS_AU) return ["jpl_small_bodies"];
    if (sunDistanceAu < SMALL_BODY_REACH_AU) return ["jpl_small_bodies", "exoplanet_systems", "exoplanets"];
    return ["exoplanet_systems", "exoplanets"];
  }
  if (viewWidthLy < 40) return ["jpl_small_bodies", "bright_stars", "gaia_local_stars", "exoplanet_systems", "exoplanets"];
  if (viewWidthLy < 6_000) return ["bright_stars", "gaia_local_stars", "gaia_500pc_stars", "exoplanet_systems", "exoplanets", "simbad_compact_objects"];
  if (viewWidthLy < 25_000) return ["bright_stars", "simbad_compact_objects"];
  return ["simbad_extragalactic", "simbad_compact_objects", "messier_deep_sky"];
}

/** Distance from zero to the nearest value of an interval. */
function distanceFromZero(minimum: number, maximum: number) {
  return minimum <= 0 && maximum >= 0 ? 0 : Math.min(Math.abs(minimum), Math.abs(maximum));
}

function catalogLimit(viewWidthLy: number) {
  if (viewWidthLy < 0.08) return 1_400;
  if (viewWidthLy < 40) return 1_100;
  if (viewWidthLy >= 25_000) return 450;
  if (viewWidthLy < 100) return 900;
  if (viewWidthLy < 1_000) return 700;
  if (viewWidthLy < 6_000) return 500;
  return 350;
}

function catalogSignature(bounds: Bounds, groups: readonly string[], types: readonly string[], limit: number) {
  const spanAu = Math.max(1, bounds.maxXAu - bounds.minXAu, bounds.maxYAu - bounds.minYAu);
  const cellAu = Math.max(1, spanAu / 3);
  const scaleBucket = Math.round(Math.log10(spanAu) * 8) / 8;
  const centerX = Math.round(((bounds.minXAu + bounds.maxXAu) / 2) / cellAu);
  const centerY = Math.round(((bounds.minYAu + bounds.maxYAu) / 2) / cellAu);
  return `${groups.join("+")}:${types.join("+")}:${limit}:${scaleBucket}:${centerX}:${centerY}`;
}
