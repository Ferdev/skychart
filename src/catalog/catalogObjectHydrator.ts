import type { Body, CatalogObjectPayload, Ephemeris, ObjectDetailHydrationState } from "../atlas/contracts";
import type { CatalogObjectMapper } from "./catalogObjectMapper";
import { resolveSmallBodyPosition } from "./smallBodyPropagation";

type CatalogObjectHydratorOptions = {
  mapper: CatalogObjectMapper;
  states: Map<string, ObjectDetailHydrationState>;
  ephemeris: () => Ephemeris | null;
  body: (key: string) => Body | undefined;
  searchBodies: () => readonly Body[];
  selectedKey: () => string;
  serverBootKey?: string;
  mergeBodies: (bodies: readonly Body[]) => void;
  updateInspection: () => void;
  updateSelectedView: () => void;
  detailError: () => string;
};

/** Resolves preview objects into full catalog or ephemeris records and tracks request state. */
export class CatalogObjectHydrator {
  private requestId = 0;

  constructor(private readonly options: CatalogObjectHydratorOptions) {}

  async ensure(key: string) {
    const existing = this.options.body(key);
    if (existing && !existing.catalog?.preview) return existing;
    const searchBody = this.options.searchBodies().find((body) => body.key === key);
    const hydrated = await this.hydrateMany([key]);
    if (hydrated.length > 0) return hydrated[0] ?? null;
    if (existing) return existing;
    if (searchBody) {
      this.options.mergeBodies([searchBody]);
      return searchBody;
    }
    return null;
  }

  async hydrateSelected(key: string) {
    const requestId = ++this.requestId;
    this.options.states.set(key, { status: "loading", requestId });
    if (this.options.selectedKey() === key) this.options.updateInspection();
    const hydrated = await this.hydrateMany([key]);
    if (this.options.states.get(key)?.requestId !== requestId) return;
    const body = hydrated[0] ?? null;
    if (body && !body.catalog?.preview) this.options.states.delete(key);
    else this.options.states.set(key, { status: "error", requestId, message: this.options.detailError() });
    if (this.options.selectedKey() === key) this.options.updateSelectedView();
  }

  async hydrateCatalogKeys(keys: readonly string[]): Promise<Body[]> {
    const unresolved = [...new Set(keys)].filter((key) => !this.options.body(key));
    const results = await Promise.all(unresolved.map((key) => this.loadCatalogObject(key)));
    const bodies = results.filter((body): body is Body => body !== null);
    if (bodies.length > 0) this.options.mergeBodies(bodies);
    return bodies;
  }

  async hydrateMany(keys: readonly string[]): Promise<Body[]> {
    const detailKeys = keys.filter((key) => {
      const existing = this.options.body(key);
      return !existing || existing.catalog?.preview;
    });
    const ephemeris = this.options.ephemeris();
    if (!ephemeris || detailKeys.length === 0) return [];

    const catalogFirstKeys = detailKeys.filter((key) => {
      const existing = this.options.body(key);
      // Keys with no local body (cold URL restore) must try the catalog
      // semantic index first: the Python ephemeris only knows its static
      // bodies and rejects catalog-only keys such as jpl-sbdb-*.
      return key === this.options.serverBootKey || !existing || Boolean(existing?.catalog?.source_type && existing.catalog.source_type !== "test_catalog");
    });
    const catalogResults = await Promise.all(catalogFirstKeys.map((key) => this.loadCatalogObject(key)));
    const catalogBodies = catalogResults.filter((body): body is Body => body !== null);
    if (catalogBodies.length > 0) this.options.mergeBodies(catalogBodies);
    const hydratedKeys = new Set(catalogBodies.map((body) => body.key));
    const ephemerisKeys = detailKeys.filter((key) => !hydratedKeys.has(key));
    if (ephemerisKeys.length === 0) return catalogBodies;

    const params = new URLSearchParams({ groups: "", keys: ephemerisKeys.join(",") });
    if (ephemeris.timestamp_utc) params.set("timestamp", ephemeris.timestamp_utc);
    try {
      const response = await fetch(`/api/ephemeris?${params.toString()}`);
      if (!response.ok) return catalogBodies;
      const payload = (await response.json()) as Ephemeris;
      this.options.mergeBodies(payload.bodies);
      return [...catalogBodies, ...payload.bodies];
    } catch (error) {
      console.warn("Unable to hydrate catalog object from Python ephemeris.", error);
      return catalogBodies;
    }
  }

  private async loadCatalogObject(key: string) {
    try {
      const response = await fetch(`/api/objects/${encodeURIComponent(key)}`);
      if (!response.ok) return null;
      const payload = (await response.json()) as { object?: CatalogObjectPayload };
      if (!payload.object) return null;
      let body = this.options.mapper.map(payload.object);
      const ephemeris = this.options.ephemeris();
      if (ephemeris) {
        body = await resolveSmallBodyPosition(
          body,
          ephemeris.timestamp_utc,
          ephemeris.au_km,
          ephemeris.bodies.find((candidate) => candidate.key === "earth"),
        );
      }
      if (body.catalog) body.catalog.preview = false;
      return body;
    } catch {
      return null;
    }
  }
}
