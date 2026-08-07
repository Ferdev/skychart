import type {
  CatalogPointTileManifest,
  CatalogPointTileManifestLayer,
  CatalogPointTileManifestState,
} from "../atlas/contracts";
import type { DestinationBodyType } from "../destinationPicker";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const DESTINATION_BODY_TYPES = new Set<DestinationBodyType>([
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
  "xray_source",
  "xray_extended",
  "asterism",
  "milky_way_patch",
  "asteroid",
  "comet",
  "small_body",
  "unknown",
]);

export type CatalogPointManifestOptions = {
  manifestUrl: string;
  allowDynamicFallback: boolean;
  fetcher?: Fetcher;
};

/** Owns manifest validation, immutable container indexes, and load state. */
export class CatalogPointManifestRepository {
  readonly manifestUrl: string;
  readonly allowDynamicFallback: boolean;
  private readonly fetcher: Fetcher;
  private loadPromise: Promise<void> | null = null;

  value: CatalogPointTileManifest | null = null;
  state: CatalogPointTileManifestState = "loading";

  constructor(options: CatalogPointManifestOptions) {
    this.manifestUrl = options.manifestUrl;
    this.allowDynamicFallback = options.allowDynamicFallback;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  static fromBrowser(): CatalogPointManifestRepository {
    return new CatalogPointManifestRepository({
      manifestUrl: configuredManifestUrl(document),
      allowDynamicFallback: configuredDynamicFallback(window),
    });
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadOnce();
    return this.loadPromise;
  }

  private async loadOnce(): Promise<void> {
    try {
      // The browser-facing URL is versionless. Versioned containers remain
      // immutable, but the selected release must never come from stale cache.
      const response = await this.fetcher(this.manifestUrl, { cache: "no-store" });
      if (response.status === 404) {
        this.state = "missing";
        return;
      }
      if (!response.ok) throw new Error(`Static catalog tile manifest failed with ${response.status}`);

      const manifest = parseManifest(await response.json());
      if (!manifest) throw new Error("Static catalog tile manifest had an invalid shape.");
      if (manifest.format === "SMP3") await this.loadContainerIndexes(manifest);
      this.value = manifest;
      this.state = "ready";
    } catch (error) {
      this.value = null;
      this.state = "missing";
      console.warn("Static catalog point tiles unavailable.", error);
    }
  }

  private async loadContainerIndexes(manifest: CatalogPointTileManifest): Promise<void> {
    await Promise.all(manifest.layers.map(async (layer) => {
      if (!layer.container) return;
      const headerResponse = await this.fetcher(layer.container, {
        headers: { Range: "bytes=0-15" },
        cache: "force-cache",
      });
      if (!headerResponse.ok) throw new Error(`SMPK1 header failed with ${headerResponse.status}`);
      const header = new DataView(await headerResponse.arrayBuffer());
      if (header.byteLength < 16 || readAscii(header, 0, 5) !== "SMPK1") {
        throw new Error("Catalog container had an invalid SMPK1 header.");
      }

      const count = header.getUint32(12, true);
      const indexEnd = 16 + count * 24 - 1;
      const indexResponse = await this.fetcher(layer.container, {
        headers: { Range: `bytes=16-${indexEnd}` },
        cache: "force-cache",
      });
      if (!indexResponse.ok) throw new Error(`SMPK1 index failed with ${indexResponse.status}`);
      let indexBuffer = await indexResponse.arrayBuffer();
      if (indexResponse.status === 200) indexBuffer = indexBuffer.slice(16, indexEnd + 1);
      const index = new DataView(indexBuffer);
      if (index.byteLength < count * 24) throw new Error("Catalog container index was truncated.");

      // Preserve the compact sorted binary index. A Map multiplies memory use
      // for multi-million-entry catalogs through strings and object overhead.
      layer.containerIndex = { view: index, count };
    }));
  }
}

export function parseManifest(value: unknown): CatalogPointTileManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== "SMP2" && manifest.format !== "SMP3") return null;

  const rawLayers = Array.isArray(manifest.layers)
    ? manifest.layers
    : [{
        id: "default",
        tile_url_template: manifest.tile_url_template,
        groups: manifest.groups,
        types: [],
        levels: manifest.levels,
      }];
  const layers = rawLayers.map(parseManifestLayer).filter(isPresent);
  if (layers.length === 0) return null;

  return {
    version: String(manifest.version ?? "v1"),
    format: manifest.format,
    color_lut: Array.isArray(manifest.color_lut)
      ? manifest.color_lut
          .filter((color): color is number[] => Array.isArray(color) && color.length >= 3)
          .map((color) => color.slice(0, 3).map(Number))
      : [],
    source_counts: parseCountRecord(manifest.source_counts),
    layers,
  };
}

function parseManifestLayer(value: unknown): CatalogPointTileManifestLayer | null {
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
        raw_point_count: optionalNumber(rawLevel.raw_point_count),
      };
    })
    .filter(isPresent)
    .filter((level) => Number.isFinite(level.span_log2) && Number.isFinite(level.span_au) && level.span_au > 0)
    .sort((left, right) => left.span_au - right.span_au);

  if (levels.length === 0) return null;
  return {
    id: typeof layer.id === "string" && layer.id ? layer.id : "default",
    tile_url_template: tileUrlTemplate,
    container,
    groups: layer.groups.filter((group): group is string => typeof group === "string" && group.length > 0),
    types: Array.isArray(layer.types) ? layer.types.filter(isDestinationBodyType) : [],
    source_counts: parseCountRecord(layer.source_counts),
    levels,
  };
}

function parseCountRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [key, Number(count)] as const)
      .filter(([, count]) => Number.isFinite(count) && count >= 0),
  );
}

function configuredManifestUrl(currentDocument: Document): string {
  return currentDocument
    .querySelector<HTMLMetaElement>('meta[name="catalog-tile-manifest-url"]')
    ?.content.trim() || "/catalog-tiles/v1/manifest.json";
}

function configuredDynamicFallback(currentWindow: Window): boolean {
  const queryValue = new URLSearchParams(currentWindow.location.search).get("dynamicPointFallback");
  if (queryValue === "1" || queryValue === "true") return true;
  if (queryValue === "0" || queryValue === "false") return false;
  return currentWindow.localStorage.getItem("starsmap:dynamic-point-fallback") === "1";
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

function isDestinationBodyType(value: unknown): value is DestinationBodyType {
  return typeof value === "string" && DESTINATION_BODY_TYPES.has(value as DestinationBodyType);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
