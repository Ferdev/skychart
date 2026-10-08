import type { Vector3, SkyCamera } from "../sky/skyProjection.ts";
import { universeCameraBasis } from "../navigation/universeNavigation.ts";
import type { Body } from "../atlas/contracts.ts";

export const AU_KM = 149_597_870.7;

export type PhysicalBody = {
  key: string;
  object_type?: string | null;
  catalog_group?: string | null;
  color?: string | null;
  position: Vector3;
  radiusKm?: number | null;
  temperatureK?: number | null;
  /** Position of the star that lights this body. The Sun at the origin when absent. */
  lightSource?: Vector3 | null;
};

export type ProjectedBody = {
  x: number;
  y: number;
  radiusPx: number;
  distanceAu: number;
  inside: boolean;
  centerVisible: boolean;
};

/** Only measured solid radii get geometric disks; galaxies remain catalog symbols. */
export function hasRenderableRadius(body: PhysicalBody): boolean {
  return typeof body.radiusKm === "number" && Number.isFinite(body.radiusKm) && body.radiusKm > 0 &&
    (body.key === "sun" || ["star", "planet", "moon", "dwarf_planet", "asteroid", "small_body", "comet"].includes(body.object_type ?? ""));
}

const LIGHT_YEAR_AU = 63_241.077;
/** Share of the shorter view side that an approached object spans. Stars get
 * less because their glow extends well beyond the disk. */
const STAR_FRAME = 0.22;
const SOLID_FRAME = 0.3;
const VOLUME_FRAME = 0.5;
/** Approach distances in AU for records with no size, by object type: about
 * 1,000 km for small bodies, 150,000 km for planets, and typical object
 * scales for deep-sky records. Anything else is treated like a star, at 1 AU. */
const NOMINAL_APPROACH_AU: Record<string, number> = {
  planet: 1e-3, moon: 6.7e-6, dwarf_planet: 6.7e-6, asteroid: 6.7e-6, small_body: 6.7e-6, comet: 6.7e-6, spacecraft: 6.7e-6,
  nebula: 30 * LIGHT_YEAR_AU, star_cluster: 100 * LIGHT_YEAR_AU, deep_sky_object: 100 * LIGHT_YEAR_AU,
  asterism: 100 * LIGHT_YEAR_AU, milky_way_patch: 100 * LIGHT_YEAR_AU,
  galaxy: 150_000 * LIGHT_YEAR_AU, active_galaxy: 150_000 * LIGHT_YEAR_AU, quasar: 150_000 * LIGHT_YEAR_AU,
};

/** Distance from which a sphere spans the given share of the shorter view side. */
export function framingDistance(radiusAu: number, fovDeg: number, frame: number): number {
  const halfExtent = frame * Math.tan(Math.min(110, Math.max(20, fovDeg)) * Math.PI / 360);
  return radiusAu * Math.sqrt(1 + 1 / (halfExtent * halfExtent));
}

/** Where "Go to object" and autopilot stop. The distance depends only on the
 * object and the field of view, so every star, planet or nebula arrives at the
 * same apparent size, from any start point. `volumeRadiusAu` is the enclosing
 * radius of a deep-sky form, when the object has one. */
export function approachDistance(body: PhysicalBody, volumeRadiusAu: number | null, fovDeg: number): number {
  if (volumeRadiusAu && volumeRadiusAu > 0) return framingDistance(volumeRadiusAu, fovDeg, VOLUME_FRAME);
  const radiusAu = typeof body.radiusKm === "number" && Number.isFinite(body.radiusKm) && body.radiusKm > 0 ? body.radiusKm / AU_KM : 0;
  if (hasRenderableRadius(body)) {
    return framingDistance(radiusAu, fovDeg, body.key === "sun" || body.object_type === "star" ? STAR_FRAME : SOLID_FRAME);
  }
  // A sized galaxy or nebula without a 3D form is still framed by its extent.
  return radiusAu > 0 ? framingDistance(radiusAu, fovDeg, VOLUME_FRAME) : NOMINAL_APPROACH_AU[body.object_type ?? ""] ?? 1;
}

/** Fresh 2D→3D entries must not start inside the Sun or a selected planet. */
export function safeUniverseEntryPosition(position: Vector3, camera: SkyCamera, bodies: Iterable<Body>): Vector3 {
  for (const body of bodies) {
    const solid = { key: body.key, object_type: body.object_type, position: {
      x: body.position.x_au, y: body.position.y_au, z: body.position.z_au,
    }, radiusKm: body.radius_km };
    if (!hasRenderableRadius(solid)) continue;
    const radiusAu = Number(body.radius_km) / AU_KM;
    if (Math.hypot(position.x - solid.position.x, position.y - solid.position.y, position.z - solid.position.z) >= radiusAu * 1.5) continue;
    const forward = universeCameraBasis(camera.yawDeg, camera.pitchDeg).forward;
    return { x: solid.position.x - forward.x * radiusAu * 3,
      y: solid.position.y - forward.y * radiusAu * 3, z: solid.position.z - forward.z * radiusAu * 3 };
  }
  return position;
}

export function projectPhysicalBody(body: PhysicalBody, observer: Vector3, camera: SkyCamera,
  width: number, height: number): ProjectedBody | null {
  if (!hasRenderableRadius(body) || width <= 0 || height <= 0) return null;
  return projectSphericalExtent(body.position, Number(body.radiusKm) / AU_KM, observer, camera, width, height);
}

/** Project an enclosing extent without claiming the enclosed object has a solid surface. */
export function projectSphericalExtent(position: Vector3, radiusAu: number, observer: Vector3, camera: SkyCamera,
  width: number, height: number): ProjectedBody | null {
  if (!Number.isFinite(radiusAu) || radiusAu <= 0 || width <= 0 || height <= 0) return null;
  const delta = { x: position.x - observer.x, y: position.y - observer.y, z: position.z - observer.z };
  const distanceAu = Math.hypot(delta.x, delta.y, delta.z);
  if (!Number.isFinite(distanceAu)) return null;
  const basis = universeCameraBasis(camera.yawDeg, camera.pitchDeg);
  const focal = Math.min(width, height) / (2 * Math.tan(camera.fovDeg * Math.PI / 360));
  const inside = distanceAu <= radiusAu;
  if (inside) return { x: width / 2, y: height / 2, radiusPx: Math.max(width, height) * 4,
    distanceAu, inside: true, centerVisible: true };
  const depth = (delta.x * basis.forward.x + delta.y * basis.forward.y + delta.z * basis.forward.z) / distanceAu;
  const angularRadius = Math.asin(Math.min(1, radiusAu / distanceAu));
  const angularOffset = Math.acos(Math.max(-1, Math.min(1, depth)));
  const diagonalHalfFov = Math.atan(Math.hypot(width, height) / (2 * focal));
  if (angularOffset - angularRadius > diagonalHalfFov) return null;
  const radiusPx = Math.min(Math.max(width, height) * 4,
    focal * radiusAu / Math.sqrt(Math.max(distanceAu * distanceAu - radiusAu * radiusAu, Number.MIN_VALUE)));
  const centerVisible = depth > 1e-4;
  const x = centerVisible ? width / 2 + focal * (delta.x * basis.right.x + delta.y * basis.right.y + delta.z * basis.right.z) / (distanceAu * depth) : width / 2;
  const y = centerVisible ? height / 2 - focal * (delta.x * basis.up.x + delta.y * basis.up.y + delta.z * basis.up.z) / (distanceAu * depth) : height / 2;
  return { x, y, radiusPx, distanceAu, inside: false, centerVisible };
}
