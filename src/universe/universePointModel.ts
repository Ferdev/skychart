import type { Body } from "../atlas/contracts.ts";
import { orbitsHostStar } from "../catalog/exoplanetGroups.ts";
import { bodyCanObserveSky, bodyVector, isDynamicBody } from "../sky/skyBody.ts";
import type { Vector3 } from "../sky/skyProjection.ts";

export type CatalogUniversePoint = {
  key: string;
  name: string;
  object_type?: string | null;
  catalog_group?: string | null;
  source_type?: string | null;
  position_model?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  radius_km?: number | null;
  direction: Vector3;
  distance_au?: number | null;
};

export type UniversePoint = Omit<CatalogUniversePoint, "distance_au" | "direction"> & {
  position: Vector3;
  dynamic: boolean;
  absoluteMagnitudeH?: number | null;
  radiusKm?: number | null;
  temperatureK?: number | null;
  deepSkyType?: string | null;
  /** Position of the host star that lights an exoplanet. */
  lightSource?: Vector3 | null;
  /** An exoplanet with no calculated position. Its record is at the host star, so it has no sphere. */
  hostBound?: boolean;
};

/** The 3D catalog endpoint keeps each exoplanet and each planet candidate at its host star and sends no orbit facts. */
export function catalogPointIsHostBound(point: Pick<CatalogUniversePoint, "catalog_group">): boolean {
  return orbitsHostStar(point);
}

export function validCatalogPoint(point: CatalogUniversePoint): boolean {
  return Boolean(point?.key && point.name && point.direction &&
    [point.direction.x, point.direction.y, point.direction.z].every(Number.isFinite) &&
    typeof point.distance_au === "number" && Number.isFinite(point.distance_au) && point.distance_au > 0 &&
    point.position_model !== "catalog_sky_position_reference_shell");
}

export function sampleDuringFlight(points: UniversePoint[], nearbyCount: number, limit: number): UniversePoint[] {
  if (points.length <= limit) return points;
  const chosen = new Set<number>();
  const nearKeep = Math.min(500, nearbyCount, limit);
  for (let index = 0; index < nearKeep; index += 1) chosen.add(index);
  const brightKeep = Math.min(300, points.length - nearbyCount, limit - chosen.size);
  for (let index = nearbyCount; index < nearbyCount + brightKeep; index += 1) chosen.add(index);
  const remaining = limit - chosen.size;
  for (let slot = 0; slot < remaining; slot += 1) {
    chosen.add(Math.floor((slot + 0.5) * points.length / remaining));
  }
  for (let index = 0; chosen.size < limit && index < points.length; index += 1) chosen.add(index);
  return [...chosen].sort((left, right) => left - right).slice(0, limit).map((index) => points[index]!);
}

export function bodyToUniversePoint(body: Body | null): UniversePoint | null {
  if (!body || !bodyCanObserveSky(body) ||
    body.catalog?.position_model === "catalog_sky_position_reference_shell" ||
    body.catalog?.facts?.distance_unknown === true) return null;
  const host = body.exoplanet_orbit?.host_position;
  const hostBound = orbitsHostStar(body) && body.exoplanet_orbit?.display_state !== "position";
  return {
    key: body.key,
    name: body.name,
    object_type: body.object_type,
    catalog_group: body.catalog_group,
    source_type: body.catalog?.source_type,
    position_model: body.catalog?.position_model,
    color: body.color,
    apparent_magnitude: body.stellar?.apparent_magnitude ?? body.deep_sky?.apparent_magnitude,
    absoluteMagnitudeH: body.small_body?.h_absolute_magnitude
      ?? (typeof body.catalog?.facts?.h_absolute_magnitude === "number" ? body.catalog.facts.h_absolute_magnitude : null),
    position: bodyVector(body),
    radiusKm: hostBound ? null : body.radius_km,
    lightSource: host ? { x: host.x_au, y: host.y_au, z: host.z_au } : null,
    hostBound,
    deepSkyType: typeof body.catalog?.facts?.deep_sky_type === "string" ? body.catalog.facts.deep_sky_type : null,
    temperatureK: body.stellar?.stellar_teff_k,
    dynamic: isDynamicBody(body),
  };
}
