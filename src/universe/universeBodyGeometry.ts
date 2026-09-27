import type { Vector3, SkyCamera } from "../sky/skyProjection.ts";
import { universeCameraBasis } from "../navigation/universeNavigation.ts";
import type { Body } from "../atlas/contracts.ts";

export const AU_KM = 149_597_870.7;

export type PhysicalBody = {
  key: string;
  object_type?: string | null;
  color?: string | null;
  position: Vector3;
  radiusKm?: number | null;
  temperatureK?: number | null;
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
