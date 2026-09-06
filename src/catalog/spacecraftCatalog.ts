import manifest from "../../backend_phoenix/priv/spacecraft.json" with { type: "json" };
import type { Body } from "../atlas/contracts";

export type SpacecraftMetadata = {
  key: string; name: string; horizons_id: string; aliases: string[];
  coverage_start_tdb: string; coverage_end_tdb: string;
  source_url: string; source_revision: string | null;
  launch_date: string | null; agency: string | null;
  description?: string; mission_url?: string; end_utc?: string;
  availability: "loading" | "available" | "out_of_coverage" | "temporarily_unavailable";
  position_epoch: string; audited_at: string;
  heliocentric_speed_km_s?: number;
};

// The wire uses null for absent coordinates. Internally NaN preserves the
// existing numeric Body contract without inventing a location at the Sun.
export function missingSpacecraftPosition(): Body["position"] {
  return { x_au: NaN, y_au: NaN, z_au: NaN, x_km: NaN, y_km: NaN, z_km: NaN, heliocentric_distance_km: NaN };
}
export function hasBodyPosition(body: Body): boolean {
  return [body.position?.x_au, body.position?.y_au, body.position?.z_au].every(Number.isFinite);
}
export function spacecraftBodies(timestamp: string): Body[] {
  return manifest.spacecraft.map((entry) => {
    const mission = entry as Omit<SpacecraftMetadata, "availability" | "position_epoch" | "audited_at">;
    return {
      key: mission.key, name: mission.name, object_type: "spacecraft", radius_km: NaN,
      color: "#77d9d0", parent_key: "sun", catalog_group: "spacecraft", aliases: mission.aliases,
      position: missingSpacecraftPosition(), distance_from_earth_km: NaN,
      spacecraft: { ...mission, availability: "loading", position_epoch: timestamp, audited_at: manifest.retrieved_at },
      catalog: { source_type: "spacecraft", position_model: "jpl_spacecraft_vectors", dynamic_position: true,
        aliases: mission.aliases, external_ids: { horizons_id: mission.horizons_id },
        external_links: [{ provider: "NASA/JPL", label: "Trajectory and coverage", url: mission.source_url },
          ...(mission.mission_url ? [{ provider: mission.agency, label: "Mission", url: mission.mission_url }] : [])] },
    };
  });
}
export function normalizeSpacecraftBody(body: Body): Body {
  const available = body.spacecraft?.availability === "available" && hasBodyPosition(body);
  return { ...body, radius_km: NaN, position: available ? body.position : missingSpacecraftPosition(),
    distance_from_earth_km: available && typeof body.distance_from_earth_km === "number" ? body.distance_from_earth_km : NaN };
}

/** One poll stream per epoch; late responses cannot revive an obsolete marker. */
export class SpacecraftLoader {
  private generation = 0;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly apply: (bodies: Body[]) => void;
  private readonly selected: () => string;
  private readonly fetcher: typeof fetch;
  constructor(apply: (bodies: Body[]) => void, selected: () => string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.apply = apply;
    this.selected = selected;
    this.fetcher = fetcher;
  }
  stop() {
    this.generation++;
    this.abort?.abort();
    clearTimeout(this.timer);
  }
  start(timestamp: string) {
    this.stop();
    const generation = this.generation;
    const poll = async () => {
      this.abort = new AbortController();
      const params = new URLSearchParams({ timestamp });
      if (this.selected().startsWith("spacecraft-")) params.set("key", this.selected());
      try {
        const response = await this.fetcher(`/api/spacecraft?${params}`, { signal: this.abort.signal });
        if (!response.ok) throw new Error("Spacecraft unavailable");
        const payload = await response.json() as { timestamp_utc: string; bodies: Body[] };
        if (generation !== this.generation || Date.parse(payload.timestamp_utc) !== Date.parse(timestamp)) return;
        const bodies = payload.bodies.map(normalizeSpacecraftBody);
        this.apply(bodies);
        if (bodies.some((body) => body.spacecraft?.availability === "loading")) this.timer = setTimeout(poll, 2000);
        else if (bodies.some((body) => body.spacecraft?.availability === "temporarily_unavailable")) this.timer = setTimeout(poll, 60000);
      } catch {
        if (generation !== this.generation) return;
        this.apply(spacecraftBodies(timestamp).map((body) => ({ ...body,
          spacecraft: { ...body.spacecraft!, availability: "temporarily_unavailable" } })));
        this.timer = setTimeout(poll, 15000);
      }
    };
    void poll();
  }
}
