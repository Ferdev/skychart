import { AU_PER_LIGHT_YEAR } from "../galacticModel";
import type {
  BodyFilterDefinition,
  Camera,
  CatalogPointContainerIndex,
  CatalogPointTileManifestLayer,
  CatalogPointTileManifestLevel,
  CatalogPointTileRequest,
} from "../atlas/contracts";
import type { DestinationBodyType } from "../destinationPicker";
import type { CatalogPointManifestRepository } from "./catalogPointManifest";

const POINT_LAYER_MAX_WIDTH_LY = 250_000;
const POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY = 30_000_000_000;
const POINT_LAYER_QUASAR_MAX_WIDTH_LY = 30_000_000_000;
const VIEWPORT_PADDING = 0.35;
const TARGET_VIEW_DIVISIONS = 2;
const TARGET_VIEW_DIVISIONS_WIDE = 1;
const MAX_ACTIVE = 28;
const MAX_ACTIVE_WIDE = 8;
const MAX_ACTIVE_UNIVERSE = 6;
const MAX_ACTIVE_UNIVERSE_DENSE = 192;
// A cosmological LOD represents the whole source, not just one viewport. Keep
// its retained sample below the renderer's practical density ceiling so a
// partial survey footprint cannot turn individual spatial bins into opaque
// rectangles. The same global sample remains scientifically comparable across
// every tile in the selected level.
const MAX_UNIVERSE_LEVEL_POINTS = 2_000_000;
const MAX_POINTS = 24_000;
const MAX_POINTS_WIDE = 12_000;
const MAX_POINTS_UNIVERSE = 7_500;
const PREFETCH_LEVEL_RADIUS = 1;
const PREFETCH_MAX_REQUESTS = 12;
const SAMPLE_BUCKET_COUNT = 1_024;
const POINT_LAYER_GROUPS = ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"];
const DEEP_SKY_POINT_GROUPS = [
  "messier_deep_sky",
  "ngc_ic_deep_sky",
  "simbad_extragalactic",
  "simbad_compact_objects",
  "bass_dr2_black_holes",
  "curated_extragalactic_survey",
  "desi_dr1_galaxies",
  "desi_dr1_quasars",
  "quaia_g20_quasars",
  "erosita_dr2_xray",
  "erosita_dr2_extended",
  "sdss_spiders_dr20",
];
const DENSE_UNIVERSE_LAYER_IDS = new Set(["desi_dr1", "quaia_g20"]);
const POINT_LAYER_GROUP_SET = new Set(POINT_LAYER_GROUPS);
// JPL small bodies are bounded semantic objects with stable identities and
// precise coordinates. Serving them through the dense SMP3 path discards both
// properties: the survey-oriented tile spans quantize Solar-System positions
// and non-bulk tiles do not carry hydratable source IDs. Keep them on the
// viewport-object path even when an older manifest still advertises JPL tiles.
const OBJECT_ONLY_CATALOG_GROUPS = new Set(["jpl_small_bodies"]);

export type CatalogPointWorldBounds = {
  minXAu: number;
  maxXAu: number;
  minYAu: number;
  maxYAu: number;
};

export type CatalogPointViewport = {
  camera: Camera;
  viewportWidthPx: number;
  viewportHeightPx: number;
  viewWidthLy: number;
  visibleBounds: CatalogPointWorldBounds;
  filter: BodyFilterDefinition;
  embed: boolean;
};

export type CatalogPointFilter = {
  groups: string[];
  types: DestinationBodyType[];
};

type RequestContext = {
  viewport: CatalogPointViewport;
  bounds: CatalogPointWorldBounds;
  filterParams: CatalogPointFilter;
  staticLayer: CatalogPointTileManifestLayer | null;
  staticLayers: CatalogPointTileManifestLayer[];
};

/** Converts one atlas viewport into deterministic active and prefetch tiles. */
export class CatalogPointPlanner {
  private readonly manifest: CatalogPointManifestRepository;

  constructor(manifest: CatalogPointManifestRepository) {
    this.manifest = manifest;
  }

  filter(viewport: CatalogPointViewport): CatalogPointFilter | null {
    return this.filterParams(viewport.filter);
  }

  canRender(viewport: CatalogPointViewport): boolean {
    const filter = this.filter(viewport);
    return Boolean(filter && shouldUseCatalogPoints(viewport.viewWidthLy, filter));
  }

  countableLayers(): CatalogPointTileManifestLayer[] {
    const layers = this.manifest.value?.layers ?? [];
    return layers.filter(
      (layer) => !isObjectOnlyLayer(layer) && !isCoveredByPreferredAggregate(layer, layers, []),
    );
  }

  ownsCatalogGroup(group: string): boolean {
    if (OBJECT_ONLY_CATALOG_GROUPS.has(group)) return false;
    return POINT_LAYER_GROUP_SET.has(group) || this.manifestGroups().includes(group);
  }

  plan(viewport: CatalogPointViewport): CatalogPointTileRequest[] {
    const requestContext = this.requestContext(viewport);
    if (!requestContext) return [];

    const maxRequests = maxActiveTiles(viewport.viewWidthLy);
    const staticLayers = requestContext.staticLayers.length > 0
      ? requestContext.staticLayers
      : [requestContext.staticLayer];
    const requestsByLayer = staticLayers.map((staticLayer) => {
      const layerContext = { ...requestContext, staticLayer };
      const tileSpanAu = this.tileSpanAu(layerContext.bounds, viewport.viewWidthLy, staticLayer);
      const defaultLevel = this.levelForSpan(tileSpanAu, staticLayer);
      const staticLevel = densestRenderableUniverseLevel(
        layerContext.bounds,
        viewport.viewWidthLy,
        staticLayer,
        defaultLevel,
      );
      const selectedSpanAu = staticLevel?.span_au ?? tileSpanAu;
      const layerMaxRequests = staticLevel && isDenseUniverseLayer(staticLayer) && viewport.viewWidthLy > 450_000_000
        ? Math.min(MAX_ACTIVE_UNIVERSE_DENSE, tileCountForBounds(layerContext.bounds, selectedSpanAu))
        : maxRequests;
      return this.requestsForLevel(layerContext, selectedSpanAu, staticLevel, layerMaxRequests);
    });

    const [primaryRequests, ...secondaryLayerRequests] = requestsByLayer;
    const completeSecondary = secondaryLayerRequests.flatMap((requests, index) =>
      isDenseUniverseLayer(staticLayers[index + 1]) && viewport.viewWidthLy > 450_000_000 ? requests : [],
    );
    const sharedSecondary = secondaryLayerRequests.flatMap((requests, index) =>
      isDenseUniverseLayer(staticLayers[index + 1]) && viewport.viewWidthLy > 450_000_000 ? [] : requests,
    );
    const secondaryRequests = sharedSecondary
      .sort((left, right) => this.compare(left, right, viewport))
      .slice(0, maxRequests);
    const requests = viewport.viewWidthLy > 450_000_000
      ? [...(primaryRequests ?? []), ...completeSecondary, ...secondaryRequests]
      : [
          ...(primaryRequests ?? []).slice(0, maxRequests),
          ...secondaryRequests.slice(0, Math.max(0, maxRequests - (primaryRequests?.length ?? 0))),
        ];
    return viewport.embed ? requests.slice(0, Math.max(1, Math.floor(requests.length / 2))) : requests;
  }

  prefetch(
    viewport: CatalogPointViewport,
    activeRequests: readonly CatalogPointTileRequest[],
    eligible: (request: CatalogPointTileRequest) => boolean,
  ): CatalogPointTileRequest[] {
    const requestContext = this.requestContext(viewport);
    if (!requestContext || this.manifest.state !== "ready" || !this.manifest.value) return [];
    if (viewport.viewWidthLy > 70_000) return [];

    const activeKeys = new Set(activeRequests.map((request) => request.key));
    const requests: CatalogPointTileRequest[] = [];
    const staticLayers = requestContext.staticLayers.length > 0
      ? requestContext.staticLayers
      : [requestContext.staticLayer].filter(isPresent);

    for (const staticLayer of staticLayers) {
      const layerContext = { ...requestContext, staticLayer };
      const activeSpanAu = this.tileSpanAu(layerContext.bounds, viewport.viewWidthLy, staticLayer);
      const activeLevel = this.levelForSpan(activeSpanAu, staticLayer);
      if (!activeLevel) continue;
      const activeLevelIndex = staticLayer.levels.findIndex((level) => level.span_au === activeLevel.span_au);
      if (activeLevelIndex < 0) continue;

      const firstLevelIndex = Math.max(0, activeLevelIndex - PREFETCH_LEVEL_RADIUS);
      const lastLevelIndex = Math.min(staticLayer.levels.length - 1, activeLevelIndex + PREFETCH_LEVEL_RADIUS);
      for (let levelIndex = firstLevelIndex; levelIndex <= lastLevelIndex; levelIndex += 1) {
        if (levelIndex === activeLevelIndex) continue;
        const level = staticLayer.levels[levelIndex];
        const prefetchContext = this.contextForTileSpan(layerContext, level.span_au);
        requests.push(...this.requestsForLevel(
          prefetchContext,
          level.span_au,
          level,
          maxActiveTiles(prefetchContext.viewport.viewWidthLy),
        ));
      }
    }

    return requests
      .filter((request) => !activeKeys.has(request.key) && eligible(request))
      .sort((left, right) => this.compare(left, right, viewport))
      .slice(0, PREFETCH_MAX_REQUESTS);
  }

  prioritize(requests: readonly CatalogPointTileRequest[]): CatalogPointTileRequest[] {
    return [...requests].sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
  }

  prewarm(requests: readonly CatalogPointTileRequest[]): CatalogPointTileRequest[] {
    return this.prioritize(requests).slice(0, PREFETCH_MAX_REQUESTS);
  }

  private requestContext(viewport: CatalogPointViewport): RequestContext | null {
    const filterParams = this.filterParams(viewport.filter);
    if (!filterParams || !shouldUseCatalogPoints(viewport.viewWidthLy, filterParams)) return null;
    if (this.manifest.state === "loading") return null;
    if (this.manifest.state === "missing" && !this.manifest.allowDynamicFallback) return null;
    const staticLayers = this.prioritizedLayers(
      this.staticLayersForFilter(filterParams),
      viewport.viewWidthLy,
      viewport.filter.key === "all",
    );
    const staticLayer = staticLayers[0] ?? null;
    if (this.manifest.state === "ready" && staticLayers.length === 0 && !this.manifest.allowDynamicFallback) {
      return null;
    }
    return {
      viewport,
      bounds: paddedBounds(viewport.visibleBounds, VIEWPORT_PADDING),
      filterParams,
      staticLayer,
      staticLayers,
    };
  }

  private contextForTileSpan(requestContext: RequestContext, tileSpanAu: number): RequestContext {
    const normalViewWidthLy = tileSpanAu * TARGET_VIEW_DIVISIONS / AU_PER_LIGHT_YEAR;
    const divisions = tileViewDivisions(normalViewWidthLy);
    const viewWidthAu = tileSpanAu * divisions;
    const viewport = {
      ...requestContext.viewport,
      viewWidthLy: viewWidthAu / AU_PER_LIGHT_YEAR,
    };
    return {
      ...requestContext,
      viewport,
      bounds: viewportBounds(viewport, VIEWPORT_PADDING),
    };
  }

  private requestsForLevel(
    requestContext: RequestContext,
    tileSpanAu: number,
    staticLevel: CatalogPointTileManifestLevel | null,
    maxRequests: number,
  ): CatalogPointTileRequest[] {
    const { bounds, filterParams, viewport } = requestContext;
    const minTileX = Math.floor(bounds.minXAu / tileSpanAu);
    const maxTileX = Math.floor(bounds.maxXAu / tileSpanAu);
    const minTileY = Math.floor(bounds.minYAu / tileSpanAu);
    const maxTileY = Math.floor(bounds.maxYAu / tileSpanAu);
    const requests: CatalogPointTileRequest[] = [];
    const configuredLimit = staticLevel?.max_points_per_tile ?? tileLimit(viewport.viewWidthLy);
    const limit = this.manifest.value?.format === "SMP3"
      ? configuredLimit
      : Math.min(configuredLimit, legacySmp2TileLimit(viewport.viewWidthLy));
    const sampleBuckets = staticLevel?.sample_buckets ?? sampleBucketsForView(viewport.viewWidthLy);
    const groupSignature = filterParams.groups.join("+");
    const typeSignature = filterParams.types.join("+");

    const indexedCoordinates = staticLevel && requestContext.staticLayer?.containerIndex
      ? containerTileCoordinates(
          requestContext.staticLayer.containerIndex,
          staticLevel.span_log2,
          minTileX,
          maxTileX,
          minTileY,
          maxTileY,
        )
      : null;
    const addRequest = (tileX: number, tileY: number) => {
      const tileBounds = {
        min_x_au: tileX * tileSpanAu,
        max_x_au: (tileX + 1) * tileSpanAu,
        min_y_au: tileY * tileSpanAu,
        max_y_au: (tileY + 1) * tileSpanAu,
      };
      const tileKey = `layer${requestContext.staticLayer?.id ?? "api"}:z${Math.round(Math.log2(tileSpanAu) * 100) / 100}:x${tileX}:y${tileY}:g${groupSignature}:t${typeSignature}:l${limit}:s${sampleBuckets}:m${staticLevel ? "static" : "api"}`;
      const params = new URLSearchParams({
        min_x_au: String(tileBounds.min_x_au),
        max_x_au: String(tileBounds.max_x_au),
        min_y_au: String(tileBounds.min_y_au),
        max_y_au: String(tileBounds.max_y_au),
        groups: filterParams.groups.join(","),
        limit: String(limit),
      });
      if (filterParams.types.length > 0) params.set("types", filterParams.types.join(","));
      if (sampleBuckets < SAMPLE_BUCKET_COUNT) params.set("sample_buckets", String(sampleBuckets));
      const staticLocation = staticLevel && requestContext.staticLayer
        ? staticTileLocation(requestContext.staticLayer, staticLevel, tileX, tileY)
        : undefined;
      if (staticLevel && requestContext.staticLayer && !staticLocation) return;
      requests.push({
        key: tileKey,
        layerId: `catalog:${tileKey}`,
        signature: `points:${tileKey}`,
        params,
        staticUrl: staticLocation?.url,
        staticRange: staticLocation?.range,
        staticLayerId: requestContext.staticLayer?.id,
        priority: boundsDistanceToCamera(tileBounds, viewport.camera),
        phase: "active",
        bounds: tileBounds,
        groups: filterParams.groups,
        types: filterParams.types,
        limit,
      });
    };
    if (indexedCoordinates) {
      for (const coordinate of indexedCoordinates) addRequest(coordinate.x, coordinate.y);
    } else {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) addRequest(tileX, tileY);
      }
    }
    return requests.sort((left, right) => left.priority - right.priority).slice(0, maxRequests);
  }

  private filterParams(filter: BodyFilterDefinition): CatalogPointFilter | null {
    const sourceGroups = filter.key === "all" || !filter.groups ? this.manifestGroups() : filter.groups;
    const manifestGroups = new Set(this.manifestGroups());
    const groups = sourceGroups.filter(
      (group) => !OBJECT_ONLY_CATALOG_GROUPS.has(group)
        && (POINT_LAYER_GROUP_SET.has(group) || manifestGroups.has(group)),
    );
    if (groups.length === 0) return null;
    return { groups: uniqueStrings(groups), types: filter.types ?? [] };
  }

  private manifestGroups(): string[] {
    if (this.manifest.state !== "ready" || !this.manifest.value) return POINT_LAYER_GROUPS;
    return uniqueStrings(this.manifest.value.layers.flatMap((layer) => layer.groups));
  }

  private staticLayersForFilter(filter: CatalogPointFilter): CatalogPointTileManifestLayer[] {
    if (this.manifest.state !== "ready" || !this.manifest.value) return [];
    const requestedGroups = new Set(filter.groups);
    const matchingLayers = this.manifest.value.layers.filter(
      (layer) => !isObjectOnlyLayer(layer)
        && layer.groups.some((group) => requestedGroups.has(group))
        && layerCoversAnyType(layer, filter.types),
    );
    if (filter.types.length === 1) {
      const requestedType = filter.types[0];
      return matchingLayers.filter(
        (layer) => layer.types.length > 0 && layer.types.every((type) => type === requestedType),
      );
    }
    return matchingLayers.filter(
      (layer) => !isCoveredByPreferredAggregate(layer, matchingLayers, filter.types),
    );
  }

  private prioritizedLayers(
    layers: CatalogPointTileManifestLayer[],
    viewWidthLy: number,
    defaultFilter: boolean,
  ): CatalogPointTileManifestLayer[] {
    const visibleLayers = defaultFilter && viewWidthLy > 70_000
      ? layers.filter((layer) => ![
          "exoplanet_systems",
          "small_bodies",
          "exoplanet_stars",
          "planets",
          "asteroids",
          "comets",
          "dwarf_planets",
        ].includes(layer.id))
      : layers;
    return [...visibleLayers].sort(
      (left, right) => layerPriority(left.id, viewWidthLy) - layerPriority(right.id, viewWidthLy),
    );
  }

  private tileSpanAu(
    bounds: CatalogPointWorldBounds,
    viewWidthLy: number,
    staticLayer: CatalogPointTileManifestLayer | null,
  ): number {
    const spanAu = Math.max(bounds.maxXAu - bounds.minXAu, bounds.maxYAu - bounds.minYAu, 1);
    const rawSpan = spanAu / tileViewDivisions(viewWidthLy);
    const dynamicSpan = Math.pow(2, Math.max(0, Math.round(Math.log2(rawSpan))));
    return this.levelNearest(dynamicSpan, staticLayer)?.span_au ?? dynamicSpan;
  }

  private levelNearest(
    spanAu: number,
    staticLayer: CatalogPointTileManifestLayer | null,
  ): CatalogPointTileManifestLevel | null {
    if (this.manifest.state !== "ready" || !staticLayer) return null;
    return staticLayer.levels.reduce<CatalogPointTileManifestLevel | null>((best, level) => {
      if (!best) return level;
      return Math.abs(Math.log2(level.span_au / spanAu)) < Math.abs(Math.log2(best.span_au / spanAu))
        ? level
        : best;
    }, null);
  }

  private levelForSpan(
    spanAu: number,
    staticLayer: CatalogPointTileManifestLayer | null,
  ): CatalogPointTileManifestLevel | null {
    if (this.manifest.state !== "ready" || !staticLayer) return null;
    return staticLayer.levels.find((level) => level.span_au === spanAu) ?? null;
  }

  private compare(
    left: CatalogPointTileRequest,
    right: CatalogPointTileRequest,
    viewport: CatalogPointViewport,
  ): number {
    const distanceDelta = boundsDistanceToCamera(left.bounds, viewport.camera)
      - boundsDistanceToCamera(right.bounds, viewport.camera);
    if (Math.abs(distanceDelta) > 1) return distanceDelta;
    const priorityDelta = layerPriority(left.staticLayerId, viewport.viewWidthLy)
      - layerPriority(right.staticLayerId, viewport.viewWidthLy);
    return priorityDelta !== 0 ? priorityDelta : distanceDelta;
  }
}

function viewportBounds(viewport: CatalogPointViewport, paddingRatio: number): CatalogPointWorldBounds {
  const viewWidthAu = viewport.viewWidthLy * AU_PER_LIGHT_YEAR;
  const viewHeightAu = viewWidthAu * viewport.viewportHeightPx / Math.max(1, viewport.viewportWidthPx);
  return {
    minXAu: viewport.camera.xAu - viewWidthAu * (0.5 + paddingRatio),
    maxXAu: viewport.camera.xAu + viewWidthAu * (0.5 + paddingRatio),
    minYAu: viewport.camera.yAu - viewHeightAu * (0.5 + paddingRatio),
    maxYAu: viewport.camera.yAu + viewHeightAu * (0.5 + paddingRatio),
  };
}

function paddedBounds(bounds: CatalogPointWorldBounds, paddingRatio: number): CatalogPointWorldBounds {
  const width = bounds.maxXAu - bounds.minXAu;
  const height = bounds.maxYAu - bounds.minYAu;
  return {
    minXAu: bounds.minXAu - width * paddingRatio,
    maxXAu: bounds.maxXAu + width * paddingRatio,
    minYAu: bounds.minYAu - height * paddingRatio,
    maxYAu: bounds.maxYAu + height * paddingRatio,
  };
}

function shouldUseCatalogPoints(viewWidthLy: number, filter: CatalogPointFilter): boolean {
  if (!Number.isFinite(viewWidthLy) || viewWidthLy <= 0) return false;
  const quasarScale = filter.types.some((type) => type === "quasar" || type === "active_galaxy")
    || filter.groups.includes("simbad_extragalactic");
  const deepSkyScale = filter.groups.some((group) => DEEP_SKY_POINT_GROUPS.includes(group));
  const maxWidthLy = quasarScale
    ? POINT_LAYER_QUASAR_MAX_WIDTH_LY
    : deepSkyScale
      ? POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY
      : POINT_LAYER_MAX_WIDTH_LY;
  return viewWidthLy <= maxWidthLy;
}

function layerCoversAnyType(layer: CatalogPointTileManifestLayer, types: DestinationBodyType[]): boolean {
  if (types.length === 0) return true;
  return layer.types.length > 0 && layer.types.some((type) => types.includes(type));
}

function isObjectOnlyLayer(layer: CatalogPointTileManifestLayer): boolean {
  return layer.groups.some((group) => OBJECT_ONLY_CATALOG_GROUPS.has(group));
}

function isCoveredByPreferredAggregate(
  layer: CatalogPointTileManifestLayer,
  matchingLayers: CatalogPointTileManifestLayer[],
  requestedTypes: DestinationBodyType[],
): boolean {
  if (layer.types.length === 0) return false;
  return matchingLayers.some((aggregate) => {
    if (aggregate === layer || aggregate.types.length <= layer.types.length) return false;
    if (requestedTypes.length > 0 && !requestedTypes.every((type) => aggregate.types.includes(type))) return false;
    if (!layer.types.every((type) => aggregate.types.includes(type))) return false;
    return layer.groups.some((group) => aggregate.groups.includes(group));
  });
}

function densestRenderableUniverseLevel(
  bounds: CatalogPointWorldBounds,
  viewWidthLy: number,
  layer: CatalogPointTileManifestLayer | null,
  fallback: CatalogPointTileManifestLevel | null,
): CatalogPointTileManifestLevel | null {
  if (!layer || !isDenseUniverseLayer(layer) || viewWidthLy <= 450_000_000) return fallback;
  const fanoutCandidates = layer.levels.filter(
    (level) => tileCountForBounds(bounds, level.span_au) <= MAX_ACTIVE_UNIVERSE_DENSE,
  );
  if (fanoutCandidates.length === 0) return fallback;
  const densityCandidates = fanoutCandidates.filter(
    (level) => level.point_count === undefined || level.point_count <= MAX_UNIVERSE_LEVEL_POINTS,
  );
  const candidates = densityCandidates.length > 0 ? densityCandidates : fanoutCandidates;
  return candidates.reduce((best, level) => {
    const pointDelta = (level.point_count ?? 0) - (best.point_count ?? 0);
    return pointDelta > 0 || (pointDelta === 0 && level.span_au < best.span_au) ? level : best;
  });
}

function isDenseUniverseLayer(layer: CatalogPointTileManifestLayer | null | undefined): boolean {
  return Boolean(layer && DENSE_UNIVERSE_LAYER_IDS.has(layer.id));
}

function tileCountForBounds(bounds: CatalogPointWorldBounds, tileSpanAu: number): number {
  const columns = Math.floor(bounds.maxXAu / tileSpanAu) - Math.floor(bounds.minXAu / tileSpanAu) + 1;
  const rows = Math.floor(bounds.maxYAu / tileSpanAu) - Math.floor(bounds.minYAu / tileSpanAu) + 1;
  return Math.max(0, columns * rows);
}

function staticTileLocation(
  layer: CatalogPointTileManifestLayer,
  level: CatalogPointTileManifestLevel,
  tileX: number,
  tileY: number,
): { url: string; range?: { offset: number; length: number } } | undefined {
  if (layer.container && layer.containerIndex) {
    const entry = findContainerIndexEntry(layer.containerIndex, level.span_log2, tileX, tileY);
    return entry ? { url: layer.container, range: entry } : undefined;
  }
  if (!layer.tile_url_template) return undefined;
  return {
    url: layer.tile_url_template
      .replace(/\{span_log2\}/g, String(level.span_log2))
      .replace(/\{x\}/g, String(tileX))
      .replace(/\{y\}/g, String(tileY)),
  };
}

function findContainerIndexEntry(
  index: CatalogPointContainerIndex,
  span: number,
  x: number,
  y: number,
): { offset: number; length: number } | undefined {
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
        length: index.view.getUint32(offset + 20, true),
      };
    }
  }
  return undefined;
}

function containerTileCoordinates(
  index: CatalogPointContainerIndex,
  span: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { x: number; y: number }[] {
  let low = 0;
  let high = index.count;
  while (low < high) {
    const entry = Math.floor((low + high) / 2);
    const offset = entry * 24;
    const comparison = index.view.getUint8(offset) - span
      || index.view.getInt32(offset + 4, true) - minX
      || index.view.getInt32(offset + 8, true) - (-2_147_483_648);
    if (comparison < 0) low = entry + 1;
    else high = entry;
  }

  const coordinates: { x: number; y: number }[] = [];
  for (let entry = low; entry < index.count; entry += 1) {
    const offset = entry * 24;
    const entrySpan = index.view.getUint8(offset);
    const x = index.view.getInt32(offset + 4, true);
    if (entrySpan !== span || x > maxX) break;
    const y = index.view.getInt32(offset + 8, true);
    if (x >= minX && y >= minY && y <= maxY) coordinates.push({ x, y });
  }
  return coordinates;
}

function layerPriority(layerId: string | undefined, viewWidthLy: number): number {
  if (!layerId) return 0;
  if (layerId === "desi_dr1" && viewWidthLy >= 1_000_000) return -1;
  if (layerId === "quaia_g20" && viewWidthLy >= 1_000_000) return 0;
  if (layerId === "gaia_stars") return 0;
  if (layerId === "deep_sky") return 1;
  if (layerId === "xray") return 1;
  if (["exoplanet_systems", "exoplanet_stars", "planets"].includes(layerId)) return 3;
  if (["small_bodies", "asteroids", "comets", "dwarf_planets"].includes(layerId)) return 4;
  return 2;
}

function tileViewDivisions(viewWidthLy: number): number {
  if (viewWidthLy > 450_000_000) return 0.5;
  if (viewWidthLy > 70_000) return TARGET_VIEW_DIVISIONS_WIDE;
  return TARGET_VIEW_DIVISIONS;
}

function tileLimit(viewWidthLy: number): number {
  if (viewWidthLy > 450_000_000) return MAX_POINTS_UNIVERSE;
  if (viewWidthLy > 70_000) return MAX_POINTS_WIDE;
  if (viewWidthLy < 80) return Math.min(MAX_POINTS, 18_000);
  if (viewWidthLy > 10_000) return Math.min(MAX_POINTS, 16_000);
  return MAX_POINTS;
}

function legacySmp2TileLimit(viewWidthLy: number): number {
  if (viewWidthLy < 500) return 18_000;
  if (viewWidthLy < 2_000) return 8_000;
  if (viewWidthLy < 15_000) return 2_500;
  if (viewWidthLy < 70_000) return 1_500;
  return 1_000;
}

function sampleBucketsForView(viewWidthLy: number): number {
  if (viewWidthLy < 120) return SAMPLE_BUCKET_COUNT;
  if (viewWidthLy < 2_000) return 5;
  if (viewWidthLy < 15_000) return 4;
  if (viewWidthLy < 70_000) return 3;
  if (viewWidthLy < 8_000_000) return 2;
  return 1;
}

function maxActiveTiles(viewWidthLy: number): number {
  if (viewWidthLy > 450_000_000) return MAX_ACTIVE_UNIVERSE;
  return viewWidthLy > 70_000 ? MAX_ACTIVE_WIDE : MAX_ACTIVE;
}

function boundsDistanceToCamera(
  bounds: CatalogPointTileRequest["bounds"],
  camera: Camera,
): number {
  const centerX = (bounds.min_x_au + bounds.max_x_au) / 2;
  const centerY = (bounds.min_y_au + bounds.max_y_au) / 2;
  return Math.hypot(centerX - camera.xAu, centerY - camera.yAu);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
