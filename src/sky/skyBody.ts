import type { Body } from "../atlas/contracts";
import { estimateMinorBodyApparentMagnitude } from "./skyPointAppearance";
import type { Vector3 } from "./skyProjection";

export function bodyCanObserveSky(body: Body): boolean {
  const position = body.position;
  if (![position.x_au, position.y_au, position.z_au].every(Number.isFinite)) return false;
  if (body.key === "sun") return true;
  return Math.hypot(position.x_au, position.y_au, position.z_au) > 1e-12;
}

export function isDynamicBody(body: Body): boolean {
  return Boolean(body.state_vector || body.catalog?.dynamic_position || [
    "core", "mars_moons", "jupiter_major_moons", "saturn_major_moons", "jpl_small_bodies",
  ].includes(body.catalog_group ?? ""));
}

export function observerRelativeMinorBodyMagnitude(body: Body, observer: Body): number | null {
  if (!["asteroid", "comet", "small_body", "dwarf_planet"].includes(body.object_type ?? "")) return null;
  const catalogMagnitude = body.catalog?.facts?.h_absolute_magnitude;
  const absoluteMagnitude = body.small_body?.h_absolute_magnitude
    ?? (typeof catalogMagnitude === "number" ? catalogMagnitude : null);
  return estimateMinorBodyApparentMagnitude({
    absoluteMagnitude,
    heliocentricDistanceAu: Math.hypot(body.position.x_au, body.position.y_au, body.position.z_au),
    observerDistanceAu: Math.hypot(
      body.position.x_au - observer.position.x_au,
      body.position.y_au - observer.position.y_au,
      body.position.z_au - observer.position.z_au,
    ),
  });
}

export function bodyVector(body: Body): Vector3 {
  return { x: body.position.x_au, y: body.position.y_au, z: body.position.z_au };
}
