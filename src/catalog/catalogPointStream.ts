import type { PointLayerSource } from "../webglPointRenderer";
import type {
  CatalogPointPayload,
  CatalogPointTile,
  CatalogPointTileRequest,
  DataRefreshOptions,
} from "../atlas/contracts";
import type { CatalogPointDecoder } from "./catalogPointDecoder";
import type { CatalogPointManifestRepository } from "./catalogPointManifest";
import type { CatalogPointPlanner, CatalogPointViewport } from "./catalogPointPlanner";

const TILE_CACHE_LIMIT = 256;
const FETCH_CONCURRENCY = 12;
const PREFETCH_DELAY_MS = 350;
const RETRY_BASE_MS = 1_200;
const RETRY_MAX_MS = 8_000;
const LOAD_DEBOUNCE_MS = 90;

export type CatalogPointStreamStats = {
  activeTileCount: number;
  loadedTileCount: number;
  loadingTileCount: number;
  cachedTileCount: number;
  requestedPointCount: number;
  queued: number;
  activeInFlight: number;
  prefetchInFlight: number;
  loadedRequests: number;
  abortedRequests: number;
  lastLoadMs: number;
  pointsInViewport: number | null;
};

export type CatalogPointStreamOptions = {
  manifest: CatalogPointManifestRepository;
  planner: CatalogPointPlanner;
  decoder: CatalogPointDecoder;
  viewport: () => CatalogPointViewport;
  canLoad: () => boolean;
  isEmbed: () => boolean;
  fetcher?: typeof fetch;
  setLayer: (id: string, source: PointLayerSource | null) => void;
  onChange: () => void;
  requestRender: () => void;
};

/** Owns the complete lifecycle of planned catalog-point tiles. */
export class CatalogPointStream {
  private readonly fetcher: typeof fetch;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private signature = "";
  private prefetchSignature = "";
  private tiles = new Map<string, CatalogPointTile>();
  private activeKeys = new Set<string>();
  private renderedLayerIds = new Set<string>();
  private viewportMeasurePending = true;
  private counters = {
    queued: 0,
    activeInFlight: 0,
    prefetchInFlight: 0,
    loadedRequests: 0,
    abortedRequests: 0,
    lastLoadMs: 0,
    pointsInViewport: null as number | null,
  };

  constructor(private readonly options: CatalogPointStreamOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  schedule(refresh: DataRefreshOptions = {}): void {
    if (!this.options.canLoad()) return;
    const requests = this.options.planner.plan(this.options.viewport());
    if (requests.length === 0) {
      this.cancel();
      this.clear();
      this.counters.queued = 0;
      this.changed();
      return;
    }

    const signature = requests.map((request) => request.key).join("|");
    this.counters.pointsInViewport = null;
    this.viewportMeasurePending = true;
    const previousActiveKeys = this.activeKeys;
    this.activeKeys = new Set(requests.map((request) => request.key));
    this.signature = signature;

    for (const tile of this.tiles.values()) {
      if (!this.activeKeys.has(tile.request.key)) this.abortTile(tile);
    }
    for (const request of requests) {
      const existing = this.tiles.get(request.key);
      if (existing) {
        existing.lastUsedAt = performance.now();
        existing.request = request;
      } else {
        this.tiles.set(request.key, { request, lastUsedAt: performance.now() });
      }
    }
    if (!sameKeys(previousActiveKeys, this.activeKeys)) this.options.requestRender();

    this.evict();
    const now = performance.now();
    const missing = requests.filter((request) => {
      const tile = this.tiles.get(request.key);
      return tile && !tile.source && !tile.abortController && this.canRetry(tile, now);
    });
    const prioritized = this.options.planner.prioritize(missing);
    this.counters.queued = prioritized.length;
    this.changed();
    this.options.requestRender();
    const schedulePrefetch = () => this.schedulePrefetch(requests, signature);
    if (prioritized.length === 0) {
      schedulePrefetch();
      return;
    }

    this.clearLoadTimer();
    if (refresh.immediate) {
      void this.loadActiveTiles(prioritized, signature).then(schedulePrefetch);
      return;
    }
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      void this.loadActiveTiles(prioritized, signature).then(schedulePrefetch);
    }, LOAD_DEBOUNCE_MS);
  }

  prewarm(): void {
    if (this.options.manifest.state !== "ready" || !this.signature || this.options.isEmbed()) return;
    const target = this.options.planner.prewarm(this.options.planner.plan(this.options.viewport()));
    if (target.length === 0) return;
    const signature = `${this.signature}::prefetch::tour::${target.map((request) => request.key).join("|")}`;
    this.prefetchSignature = signature;
    void this.loadPrefetchTiles(target, signature);
  }

  cancel(): void {
    this.clearLoadTimer();
    this.clearPrefetchTimer();
    this.prefetchSignature = "";
    for (const tile of this.tiles.values()) this.abortTile(tile);
    this.requestId += 1;
    this.changed();
  }

  clear(notify = true): void {
    if (this.tiles.size === 0 && this.activeKeys.size === 0 && this.renderedLayerIds.size === 0 && !this.signature) return;
    for (const tile of this.tiles.values()) this.abortTile(tile);
    for (const layerId of this.renderedLayerIds) this.options.setLayer(layerId, null);
    this.tiles.clear();
    this.activeKeys.clear();
    this.renderedLayerIds.clear();
    this.signature = "";
    this.prefetchSignature = "";
    this.counters.pointsInViewport = 0;
    this.viewportMeasurePending = false;
    if (notify) this.changed();
  }

  activeTiles(): CatalogPointTile[] {
    const now = performance.now();
    const active: CatalogPointTile[] = [];
    for (const key of this.activeKeys) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      tile.lastUsedAt = now;
      if (tile.source) active.push(tile);
    }
    return active;
  }

  activePointCount(): number {
    return this.activeTiles().reduce((sum, tile) => sum + (tile.payload?.returned ?? 0), 0);
  }

  hasActiveLayer(): boolean {
    return this.activeTiles().some((tile) => (tile.payload?.returned ?? 0) > 0);
  }

  syncRenderedLayers(): void {
    const nextLayerIds = new Set<string>();
    for (const tile of this.activeTiles()) {
      if (!tile.source) continue;
      this.options.setLayer(tile.request.layerId, tile.source);
      nextLayerIds.add(tile.request.layerId);
    }
    for (const layerId of this.renderedLayerIds) {
      if (!nextLayerIds.has(layerId)) this.options.setLayer(layerId, null);
    }
    this.renderedLayerIds = nextLayerIds;
  }

  needsViewportMeasurement(): boolean {
    return this.viewportMeasurePending;
  }

  recordViewportMeasurement(points: number): void {
    this.viewportMeasurePending = false;
    this.counters.pointsInViewport = Math.max(0, points);
    this.changed();
  }

  stats(): CatalogPointStreamStats {
    const activeTiles = [...this.activeKeys].map((key) => this.tiles.get(key)).filter(isPresent);
    return {
      activeTileCount: this.activeKeys.size,
      loadedTileCount: activeTiles.filter((tile) => tile.source).length,
      loadingTileCount: activeTiles.filter((tile) => tile.abortController).length,
      cachedTileCount: this.tiles.size,
      requestedPointCount: activeTiles.reduce((sum, tile) => sum + tile.request.limit, 0),
      ...this.counters,
    };
  }

  private schedulePrefetch(activeRequests: CatalogPointTileRequest[], activeSignature: string): void {
    this.clearPrefetchTimer();
    if (this.options.isEmbed() || this.options.manifest.state !== "ready" || activeRequests.length === 0 || activeSignature !== this.signature) return;
    const now = performance.now();
    const requests = this.options.planner.prefetch(this.options.viewport(), activeRequests, (request) => {
      const tile = this.tiles.get(request.key);
      return !tile || (!tile.source && !tile.abortController && this.canRetry(tile, now));
    });
    if (requests.length === 0) return;
    const signature = `${activeSignature}::prefetch::${requests.map((request) => request.key).join("|")}`;
    if (signature === this.prefetchSignature) return;
    this.prefetchSignature = signature;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      void this.loadPrefetchTiles(requests, signature);
    }, PREFETCH_DELAY_MS);
  }

  private async loadPrefetchTiles(requests: CatalogPointTileRequest[], signature: string): Promise<void> {
    if (signature !== this.prefetchSignature || !signature.startsWith(`${this.signature}::prefetch::`)) return;
    const requestId = this.requestId;
    const queue = [...requests];
    while (queue.length > 0 && requestId === this.requestId && signature === this.prefetchSignature) {
      const request = queue.shift();
      if (!request) continue;
      const tile = this.tiles.get(request.key);
      if (tile?.source || tile?.abortController) continue;
      await this.loadTile({ ...request, phase: "prefetch" }, requestId);
    }
    this.evict();
    if (this.prefetchSignature === signature) this.prefetchSignature = "";
  }

  private async loadActiveTiles(requests: CatalogPointTileRequest[], signature: string): Promise<void> {
    if (signature !== this.signature) return;
    const requestId = ++this.requestId;
    const startedAt = performance.now();
    const queue = this.options.planner.prioritize(requests);
    this.counters.queued = queue.length;
    this.changed();
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && requestId === this.requestId) {
        const request = queue.shift();
        if (request) await this.loadTile(request, requestId);
      }
    });
    await Promise.all(workers);
    if (requestId === this.requestId) {
      this.counters.queued = 0;
      this.viewportMeasurePending = true;
    }
    this.counters.lastLoadMs = performance.now() - startedAt;
    this.scheduleRetry(requestId);
    this.changed();
    this.options.requestRender();
  }

  private async loadTile(request: CatalogPointTileRequest, requestId: number): Promise<void> {
    let tile = this.tiles.get(request.key);
    if (!tile) {
      tile = { request, lastUsedAt: performance.now() };
      this.tiles.set(request.key, tile);
    }
    if (tile.source || tile.abortController) return;
    const abortController = new AbortController();
    tile.abortController = abortController;
    if (request.phase === "prefetch") this.counters.prefetchInFlight += 1;
    else this.counters.activeInFlight += 1;
    this.changed();

    try {
      if (request.phase === "prefetch" && !this.prefetchSignature) return abortController.abort();
      if (request.phase === "active" && !this.activeKeys.has(request.key)) return abortController.abort();
      const requestUrl = request.staticUrl ?? `/api/catalog/points.bin?${request.params.toString()}`;
      const rangeStart = request.staticRange?.offset;
      const rangeEnd = request.staticRange
        ? Math.min(request.staticRange.offset + request.staticRange.length - 1, request.staticRange.offset + 32 + request.limit * 8 - 1)
        : undefined;
      const response = await this.fetcher(requestUrl, {
        signal: abortController.signal,
        headers: rangeStart !== undefined && rangeEnd !== undefined ? { Range: `bytes=${rangeStart}-${rangeEnd}` } : undefined,
      });
      if (request.staticUrl && (response.status === 403 || response.status === 404)) {
        if (abortController.signal.aborted) return;
        this.commitTile(tile, emptyPayload(request));
        return;
      }
      if (!response.ok) throw new Error(`Catalog points failed with ${response.status}`);
      let buffer = await response.arrayBuffer();
      if (request.staticRange && response.status === 200) {
        const end = Math.min(buffer.byteLength, (rangeEnd ?? request.staticRange.offset) + 1);
        buffer = buffer.slice(request.staticRange.offset, end);
      }
      const payload = await this.options.decoder.decode(buffer, {
        bounds: request.bounds,
        groups: request.groups,
        types: request.types,
        limit: request.limit,
        total: Number(response.headers.get("x-starsmap-total")) || undefined,
        colorLut: this.options.manifest.value?.color_lut ?? [],
      });
      if (abortController.signal.aborted || requestId !== this.requestId) return;
      this.commitTile(tile, payload);
      this.counters.loadedRequests += 1;
    } catch (error) {
      if (!abortController.signal.aborted) {
        tile.failedAt = performance.now();
        tile.retryCount = (tile.retryCount ?? 0) + 1;
        console.warn("Unable to load catalog point tile.", error);
      }
    } finally {
      if (abortController.signal.aborted) this.counters.abortedRequests += 1;
      if (request.phase === "prefetch") this.counters.prefetchInFlight = Math.max(0, this.counters.prefetchInFlight - 1);
      else this.counters.activeInFlight = Math.max(0, this.counters.activeInFlight - 1);
      if (tile.abortController === abortController) tile.abortController = undefined;
      this.changed();
    }
  }

  private commitTile(tile: CatalogPointTile, payload: CatalogPointPayload): void {
    tile.payload = payload;
    tile.source = pointLayer(payload, tile.request.signature);
    tile.loadedAt = performance.now();
    tile.failedAt = undefined;
    tile.retryCount = 0;
    tile.lastUsedAt = tile.loadedAt;
    if (this.activeKeys.has(tile.request.key)) this.options.requestRender();
  }

  private canRetry(tile: CatalogPointTile, now: number): boolean {
    if (!tile.failedAt) return true;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, (tile.retryCount ?? 1) - 1));
    return now - tile.failedAt >= delay;
  }

  private scheduleRetry(requestId: number): void {
    if (requestId !== this.requestId || this.loadTimer !== null) return;
    const now = performance.now();
    let retryDelay = Number.POSITIVE_INFINITY;
    for (const key of this.activeKeys) {
      const tile = this.tiles.get(key);
      if (!tile || tile.source || tile.abortController || !tile.failedAt) continue;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, (tile.retryCount ?? 1) - 1));
      retryDelay = Math.min(retryDelay, Math.max(0, tile.failedAt + delay - now));
    }
    if (!Number.isFinite(retryDelay)) return;
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      this.schedule();
    }, retryDelay);
  }

  private abortTile(tile: CatalogPointTile): void {
    if (tile.abortController) this.counters.abortedRequests += 1;
    tile.abortController?.abort();
    tile.abortController = undefined;
  }

  private evict(): void {
    if (this.tiles.size <= TILE_CACHE_LIMIT) return;
    const evictable = [...this.tiles.values()]
      .filter((tile) => !this.activeKeys.has(tile.request.key) && !tile.abortController)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const tile of evictable.slice(0, Math.max(0, this.tiles.size - TILE_CACHE_LIMIT))) {
      this.options.setLayer(tile.request.layerId, null);
      this.tiles.delete(tile.request.key);
      this.renderedLayerIds.delete(tile.request.layerId);
    }
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private clearPrefetchTimer(): void {
    if (this.prefetchTimer !== null) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
  }

  private changed(): void {
    this.options.onChange();
  }
}

function emptyPayload(request: CatalogPointTileRequest): CatalogPointPayload {
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
    flags: 0,
  };
}

function pointLayer(payload: CatalogPointPayload, signature: string): PointLayerSource {
  return {
    kind: "compact",
    signature,
    vertices: payload.vertices,
    count: payload.returned,
    origin: payload.origin,
    format: payload.format,
    blend: "source-over",
  };
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
