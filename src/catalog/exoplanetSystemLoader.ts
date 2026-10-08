import type { CatalogObjectPayload, CatalogViewportPayload } from "../atlas/contracts";

// The catalog keeps each planet at the coordinates of its host star, so a
// small box around the host finds the planets of one system.
const SYSTEM_BOX_HALF_WIDTH_AU = 0.5;
const SYSTEM_PLANET_LIMIT = 60;
const HOST_MATCH_TOLERANCE_AU = 0.01;

type HostPosition = { x_au: number; y_au: number; z_au: number };

/** Loads the catalog rows of the planets that belong to the host star at this position. */
export async function loadExoplanetSystemObjects(
  host: HostPosition,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CatalogObjectPayload[]> {
  const params = new URLSearchParams({
    min_x_au: String(host.x_au - SYSTEM_BOX_HALF_WIDTH_AU),
    max_x_au: String(host.x_au + SYSTEM_BOX_HALF_WIDTH_AU),
    min_y_au: String(host.y_au - SYSTEM_BOX_HALF_WIDTH_AU),
    max_y_au: String(host.y_au + SYSTEM_BOX_HALF_WIDTH_AU),
    groups: "exoplanets",
    limit: String(SYSTEM_PLANET_LIMIT),
  });
  const response = await fetcher(`/api/catalog/viewport?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Exoplanet system load failed with ${response.status}`);
  const payload = (await response.json()) as CatalogViewportPayload;
  return payload.objects.filter((object) => isAtHost(object.position, host));
}

/** True when a stored position is the host position. The box above is in x and y only. */
export function isAtHost(
  position: { x_au?: number | null; y_au?: number | null; z_au?: number | null } | null | undefined,
  host: HostPosition,
): boolean {
  return [
    [position?.x_au, host.x_au],
    [position?.y_au, host.y_au],
    [position?.z_au, host.z_au],
  ].every(([value, expected]) => typeof value === "number" && Math.abs(value - (expected as number)) < HOST_MATCH_TOLERANCE_AU);
}
