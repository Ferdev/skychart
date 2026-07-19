import { decodeSmp3SourceId, smp3SourceIdRange } from "../smp3SourceIds";
import { clamp } from "../geometry";
import type { ScreenPoint } from "../geometry";
import type {
  Body,
  CatalogNearestPayload,
  CatalogNearestQuery,
  CatalogObjectPayload,
  CatalogPointHitEntry,
  CatalogPointPayload,
} from "../atlas/contracts";
import type { CatalogObjectMapper } from "./catalogObjectMapper";
import type { CatalogPointPlanner, CatalogPointViewport } from "./catalogPointPlanner";
import type { CatalogPointStream } from "./catalogPointStream";

const SMP2_VERTEX_STRIDE_FLOATS = 3;

export type CatalogPointSelectorOptions = {
  mapper: CatalogObjectMapper;
  stream: CatalogPointStream;
  planner: CatalogPointPlanner;
  viewport: () => CatalogPointViewport;
  screenToWorld: (point: ScreenPoint) => { xAu: number; yAu: number };
  pixelsPerAu: () => number;
  hitTest: (point: ScreenPoint) => CatalogPointHitEntry | null;
  fetcher?: typeof fetch;
  minimumZoom: number;
};

/** Resolves anonymous rendered points into stable, source-specific objects. */
export class CatalogPointSelector {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: CatalogPointSelectorOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  preview(hit: CatalogPointHitEntry): Body | null {
    const payload = hit.tile.payload;
    const layerId = hit.tile.request.staticLayerId;
    if (!validSourcePoint(hit) || !payload || !layerId) return null;
    if (!["gaia_stars", "desi_dr1", "quaia_g20"].includes(layerId)) return null;
    const point = decodedPoint(payload, hit.pointIndex);
    const objectType = layerId === "gaia_stars" ? "star" : layerId === "quaia_g20" || point.typeCode === 3 ? "quasar" : "galaxy";
    const body = this.options.mapper.map({
      key: `catalog-tile-preview:${hit.tile.request.key}:${hit.pointIndex}`,
      name: layerId === "gaia_stars" ? "Gaia DR3 star" : layerId === "quaia_g20" ? "Quaia G<20 quasar" : `DESI DR1 ${objectType}`,
      object_type: objectType,
      catalog_group: layerId === "gaia_stars"
        ? "gaia_dr3_bulk"
        : layerId === "quaia_g20"
          ? "quaia_g20_quasars"
          : objectType === "quasar" ? "desi_dr1_quasars" : "desi_dr1_galaxies",
      source_type: layerId === "gaia_stars" ? "gaia_dr3_bulk_tile" : layerId === "quaia_g20" ? "quaia_g20_tile" : "desi_dr1_tile",
      position_model: layerId === "gaia_stars" ? "catalog_astrometry" : layerId === "quaia_g20" ? "catalog_inferred_redshift_comoving" : "catalog_redshift_comoving",
      color: point.color,
      astrometry: { apparent_magnitude: point.magnitude },
      position: point.position,
    });
    if (body.catalog) body.catalog.preview = true;
    return body;
  }

  nearestQuery(point: ScreenPoint): CatalogNearestQuery {
    const world = this.options.screenToWorld(point);
    const filter = this.options.planner.filter(this.options.viewport());
    return {
      xAu: world.xAu,
      yAu: world.yAu,
      radiusAu: clamp(8 / Math.max(this.options.pixelsPerAu(), this.options.minimumZoom), 0.000001, 10_000_000),
      groups: [...(filter?.groups ?? [])],
      types: [...(filter?.types ?? [])],
    };
  }

  async nearest(
    point: ScreenPoint,
    signal?: AbortSignal,
    query = this.nearestQuery(point),
  ): Promise<Body | null> {
    if (!this.options.stream.hasActiveLayer() || !this.options.planner.canRender(this.options.viewport())) return null;
    const tileHit = this.options.hitTest(point);
    if (tileHit) {
      const exact = await this.hydrate(tileHit, signal);
      if (exact) return exact;
    }
    return this.nearestFromApi(query, signal);
  }

  async nearestFromApi(query: CatalogNearestQuery, signal?: AbortSignal): Promise<Body | null> {
    if (query.groups.length === 0) return null;
    const params = new URLSearchParams({
      x_au: String(query.xAu),
      y_au: String(query.yAu),
      radius_au: String(query.radiusAu),
      groups: query.groups.join(","),
    });
    if (query.types.length > 0) params.set("types", query.types.join(","));
    try {
      const response = await this.fetcher(`/api/catalog/nearest?${params.toString()}`, { signal });
      if (!response.ok) throw new Error(`Catalog nearest failed with ${response.status}`);
      const payload = await response.json() as CatalogNearestPayload;
      return payload.object ? this.options.mapper.map(payload.object) : null;
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn("Unable to select catalog point.", error);
      return null;
    }
  }

  async hydrate(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
    switch (hit.tile.request.staticLayerId) {
      case "gaia_stars": return this.hydrateGaia(hit, signal);
      case "desi_dr1": return this.hydrateDesi(hit, signal);
      case "quaia_g20": return this.hydrateQuaia(hit, signal);
      default: return null;
    }
  }

  private async hydrateGaia(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
    if (!validSourcePoint(hit) || hit.tile.request.staticLayerId !== "gaia_stars") return null;
    const sourceId = await this.readSourceId(hit, "Gaia source ID", signal);
    if (!sourceId) return null;
    const preview = this.gaiaPreview(hit, sourceId);
    try {
      const response = await this.fetcher(`/api/objects/gaia/${sourceId}`, { signal });
      if (!response.ok) return preview;
      const body = this.options.mapper.map(await response.json() as CatalogObjectPayload);
      if (body.catalog) body.catalog.preview = false;
      return body;
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn("Unable to hydrate Gaia tile point details; using its local tile record.", error);
      return preview;
    }
  }

  private async hydrateDesi(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
    if (!validSourcePoint(hit)) return null;
    const targetId = await this.readSourceId(hit, "DESI TARGETID", signal);
    if (!targetId || !hit.tile.payload) return null;
    const point = decodedPoint(hit.tile.payload, hit.pointIndex);
    const objectType = point.typeCode === 3 ? "quasar" : "galaxy";
    const body = this.options.mapper.map({
      key: `desi-dr1-${targetId}`,
      name: `DESI DR1 ${objectType} ${targetId}`,
      object_type: objectType,
      catalog_group: objectType === "quasar" ? "desi_dr1_quasars" : "desi_dr1_galaxies",
      source_type: "desi_dr1_tile",
      position_model: "catalog_redshift_comoving",
      color: point.color,
      external_ids: { desi_targetid: targetId },
      external_links: [{ provider: "DESI", label: "DESI DR1 catalog documentation", url: "https://data.desi.lbl.gov/doc/releases/dr1/" }],
      source: { catalog: "DESI DR1 zcatalog v1 physical tile", source_id: targetId },
      astrometry: { apparent_magnitude: point.magnitude },
      position: point.position,
    });
    if (body.catalog) body.catalog.preview = false;
    return body;
  }

  private async hydrateQuaia(hit: CatalogPointHitEntry, signal?: AbortSignal): Promise<Body | null> {
    if (!validSourcePoint(hit) || hit.tile.request.staticLayerId !== "quaia_g20") return null;
    const sourceId = await this.readSourceId(hit, "Quaia Gaia source ID", signal);
    if (!sourceId || !hit.tile.payload) return null;
    const point = decodedPoint(hit.tile.payload, hit.pointIndex);
    const body = this.options.mapper.map({
      key: `quaia-g20-${sourceId}`,
      name: `Quaia G<20 quasar ${sourceId}`,
      object_type: "quasar",
      catalog_group: "quaia_g20_quasars",
      source_type: "quaia_g20_tile",
      position_model: "catalog_inferred_redshift_comoving",
      color: point.color,
      external_ids: { gaia_dr3_source_id: sourceId },
      external_links: [
        { provider: "Quaia", label: "Quaia G<20 published catalog", url: "https://zenodo.org/records/10403370" },
        { provider: "Gaia Archive", label: "Gaia DR3 source", url: gaiaArchiveUrl(sourceId) },
      ],
      source: { catalog: "Quaia G<20 physical tile; inferred spectrophotometric/ML redshift", source_id: sourceId },
      astrometry: { apparent_magnitude: point.magnitude },
      position: point.position,
    });
    if (body.catalog) body.catalog.preview = false;
    return body;
  }

  private gaiaPreview(hit: CatalogPointHitEntry, sourceId: string): Body {
    if (!hit.tile.payload) throw new Error("Gaia tile point payload is unavailable");
    const point = decodedPoint(hit.tile.payload, hit.pointIndex);
    const body = this.options.mapper.map({
      key: `gaia_dr3_${sourceId}`,
      name: `Gaia DR3 ${sourceId}`,
      object_type: "star",
      catalog_group: "gaia_dr3_bulk",
      source_type: "gaia_dr3_bulk_tile",
      position_model: "catalog_astrometry",
      color: point.color,
      external_ids: { gaia_dr3_source_id: sourceId },
      external_links: [{ provider: "Gaia Archive", label: "Gaia DR3 source", url: gaiaArchiveUrl(sourceId) }],
      source: { catalog: "Gaia DR3 T2 physical tile", source_id: sourceId },
      astrometry: { apparent_magnitude: point.magnitude },
      position: point.position,
    });
    if (body.catalog) body.catalog.preview = false;
    return body;
  }

  private async readSourceId(
    hit: CatalogPointHitEntry,
    label: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      const payload = hit.tile.payload;
      const request = hit.tile.request;
      if (!payload || !request.staticUrl || !request.staticRange) return null;
      const range = smp3SourceIdRange(
        request.staticRange.offset,
        request.staticRange.length,
        payload.declared,
        hit.pointIndex,
        payload.flags,
      );
      if (!range) return null;
      const response = await this.fetcher(request.staticUrl, {
        headers: { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` },
        signal,
      });
      if (!response.ok) throw new Error(`Catalog source ID Range failed with ${response.status}`);
      let buffer = await response.arrayBuffer();
      if (response.status === 200) buffer = buffer.slice(range.offset, range.offset + range.length);
      return decodeSmp3SourceId(buffer);
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn(`Unable to read the ${label} from its tile.`, error);
      return null;
    }
  }
}

export function catalogPointVertexStrideFloats(payload: CatalogPointPayload): number {
  return payload.format === "SMP3" ? 4 : SMP2_VERTEX_STRIDE_FLOATS;
}

export function catalogPointVertexStrideBytes(payload: CatalogPointPayload): number {
  return catalogPointVertexStrideFloats(payload) * Float32Array.BYTES_PER_ELEMENT;
}

function validSourcePoint(hit: CatalogPointHitEntry): boolean {
  const payload = hit.tile.payload;
  const request = hit.tile.request;
  return Boolean(
    payload && payload.format === "SMP3" && (payload.flags & 1) !== 0
      && hit.pointIndex < payload.declared && request.staticUrl && request.staticRange,
  );
}

function decodedPoint(payload: CatalogPointPayload, pointIndex: number) {
  const strideFloats = catalogPointVertexStrideFloats(payload);
  const strideBytes = catalogPointVertexStrideBytes(payload);
  const floatOffset = pointIndex * strideFloats;
  const byteOffset = pointIndex * strideBytes;
  const bytes = new Uint8Array(payload.vertices.buffer, payload.vertices.byteOffset, payload.vertices.byteLength);
  const color = `#${[bytes[byteOffset + 8] ?? 224, bytes[byteOffset + 9] ?? 196, bytes[byteOffset + 10] ?? 128]
    .map((component) => component.toString(16).padStart(2, "0")).join("")}`;
  const magnitudeByte = bytes[byteOffset + 12] ?? 255;
  return {
    typeCode: bytes[byteOffset + 11] ?? 0,
    color,
    magnitude: magnitudeByte === 255 ? null : magnitudeByte / 10 - 2,
    position: {
      x_au: payload.origin.x + (payload.vertices[floatOffset] ?? 0),
      y_au: payload.origin.y + (payload.vertices[floatOffset + 1] ?? 0),
      z_au: 0,
    },
  };
}

function gaiaArchiveUrl(sourceId: string): string {
  return `https://gea.esac.esa.int/archive/?ACTION=PUBLIC_DATALINK&ID=Gaia%20DR3%20${encodeURIComponent(sourceId)}`;
}
