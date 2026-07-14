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

  constructor(private readonly options: ViewportCatalogLoaderOptions) {}

  reset() {
    this.cancel();
    this.loadedSignature = "";
  }

  cancel() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
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
    const requestId = ++this.requestId;
    this.inFlightSignature = request.signature;
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/catalog/viewport?${request.params.toString()}`);
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
      console.warn("Unable to load viewport catalog objects.", error);
    } finally {
      if (requestId === this.requestId) this.options.recordLoad(performance.now() - startedAt);
    }
  }

  private request() {
    const width = this.options.viewWidthLy();
    if (!Number.isFinite(width) || width > MAX_WIDTH_LY) return null;
    const bounds = this.options.worldBounds(0.35);
    const filter = this.options.filter();
    const groups = filter.key === "all" || !filter.groups ? catalogGroups(width) : filter.groups;
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

function catalogGroups(viewWidthLy: number) {
  if (viewWidthLy < 0.08) return ["jpl_small_bodies"];
  if (viewWidthLy < 40) return ["jpl_small_bodies", "bright_stars", "gaia_local_stars", "exoplanet_systems", "exoplanets"];
  if (viewWidthLy < 6_000) return ["bright_stars", "gaia_local_stars", "gaia_500pc_stars", "exoplanet_systems", "exoplanets", "simbad_compact_objects"];
  if (viewWidthLy < 25_000) return ["bright_stars", "simbad_compact_objects"];
  return ["simbad_extragalactic", "simbad_compact_objects", "messier_deep_sky"];
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
