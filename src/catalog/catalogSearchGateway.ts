import type {
  Body,
  BodyFilterDefinition,
  CatalogObjectPayload,
  CatalogSearchPayload,
  CatalogSearchResult,
} from "../atlas/contracts";
import type { CatalogObjectMapper } from "./catalogObjectMapper";

export type CatalogSearchOptions = {
  query: string;
  filter?: BodyFilterDefinition;
  limit: number;
  offset?: number;
  signal?: AbortSignal;
};

/** Adapts catalog search transport, Gaia lookup, paging, and local fallback. */
export class CatalogSearchGateway {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly mapper: CatalogObjectMapper,
    private readonly localSearch: (options: CatalogSearchOptions) => Body[],
    fetcher?: typeof fetch,
  ) {
    this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async search(options: CatalogSearchOptions): Promise<CatalogSearchResult> {
    const params = new URLSearchParams();
    const query = options.query.trim();
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    if (query) params.set("q", query);
    if (options.filter?.groups) params.set("groups", options.filter.groups.join(","));
    if (options.filter?.types) params.set("types", options.filter.types.join(","));
    params.set("limit", String(options.limit));
    if (offset > 0) params.set("offset", String(offset));

    try {
      const gaiaSourceId = /^Gaia\s+DR3\s+(\d+)$/i.exec(query)?.[1];
      if (gaiaSourceId && offset === 0) return this.gaiaResult(gaiaSourceId, options.signal);
      const response = await this.fetcher(`/api/catalog/search?${params.toString()}`, { signal: options.signal });
      if (!response.ok) throw new Error(`Catalog search failed with ${response.status}`);
      const payload = await response.json() as CatalogSearchPayload;
      const bodies = Array.isArray(payload.bodies) && payload.bodies.length > 0
        ? payload.bodies
        : (payload.objects ?? []).map((object) => this.mapper.map(object));
      const returnedCount = payload.bodies?.length ?? payload.objects?.length ?? bodies.length;
      const nextOffset = payload.has_more && returnedCount === 0
        ? payload.offset + payload.limit
        : Math.max(offset + returnedCount, payload.offset + returnedCount);
      return {
        bodies: offset === 0 ? mergeCatalogSearchBodies(this.localSearch(options), bodies, options.limit) : bodies.slice(0, options.limit),
        source: "phoenix",
        total: payload.total,
        hasMore: payload.has_more,
        nextOffset,
      };
    } catch (error) {
      if (options.signal?.aborted) return { bodies: [], source: "local" };
      console.warn("Phoenix catalog search unavailable; using loaded ephemeris catalog.", error);
      return { bodies: this.localSearch(options), source: "local", fallback: true };
    }
  }

  private async gaiaResult(sourceId: string, signal?: AbortSignal): Promise<CatalogSearchResult> {
    const response = await this.fetcher(`/api/objects/gaia/${sourceId}`, { signal });
    if (response.ok) {
      const body = this.mapper.map(await response.json() as CatalogObjectPayload);
      return { bodies: [body], source: "phoenix", total: 1, hasMore: false, nextOffset: 1 };
    }
    if (response.status !== 404) throw new Error(`Gaia hydration failed with ${response.status}`);
    return { bodies: [], source: "phoenix", total: 0, hasMore: false, nextOffset: 0 };
  }
}

export function mergeCatalogSearchBodies(primary: readonly Body[], fallback: readonly Body[], limit: number): Body[] {
  const seen = new Set<string>();
  const merged: Body[] = [];
  for (const body of [...primary, ...fallback]) {
    if (seen.has(body.key)) continue;
    seen.add(body.key);
    merged.push(body);
    if (merged.length >= limit) break;
  }
  return merged;
}
