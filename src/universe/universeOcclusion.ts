import type { Vector3, SkyCamera } from "../sky/skyProjection.ts";
import { AU_KM, projectPhysicalBody, projectSphericalExtent, type PhysicalBody } from "./universeBodyGeometry.ts";
import { appearanceRotation, bodyAppearance } from "./universeAppearanceProfiles.ts";

export type BodyOccluder = { key: string; center: Vector3; radius: number; distance: number; angularSize: number; ringNormal?: Vector3 };

export function bodyOccluders(points: readonly PhysicalBody[], observer: Vector3, camera: SkyCamera,
  width: number, height: number): BodyOccluder[] {
  const result: BodyOccluder[] = [];
  for (const body of points) {
    const extent = projectPhysicalBody(body, observer, camera, width, height)
      ?? (body.key === "saturn" ? projectSphericalExtent(body.position, Number(body.radiusKm) / AU_KM * 2.32, observer, camera, width, height) : null);
    if (!extent || extent.radiusPx < 1.5) continue;
    const center = { x: body.position.x - observer.x, y: body.position.y - observer.y, z: body.position.z - observer.z };
    const rotation = body.key === "saturn" ? appearanceRotation(bodyAppearance(body)) : null;
    result.push({ key: body.key, center, radius: Number(body.radiusKm) / AU_KM,
      ringNormal: rotation ? { x: rotation[2]!, y: rotation[5]!, z: rotation[8]! } : undefined,
      distance: Math.hypot(center.x, center.y, center.z), angularSize: extent.radiusPx });
  }
  return result.sort((a, b) => b.angularSize - a.angularSize).slice(0, 8);
}

export function ringTransmission(relative: Vector3, occluders: readonly BodyOccluder[], ownKey?: string): number {
  const distance = Math.hypot(relative.x, relative.y, relative.z);
  if (!distance) return 1;
  let transmission = 1;
  for (const body of occluders) {
    if (!body.ringNormal || ownKey === body.key) continue;
    const n = body.ringNormal, c = body.center;
    const denominator = (relative.x*n.x + relative.y*n.y + relative.z*n.z) / distance;
    if (Math.abs(denominator) < 1e-8) continue;
    const t = (c.x*n.x + c.y*n.y + c.z*n.z) / denominator;
    if (t <= 0 || t >= distance) continue;
    const r = Math.hypot(relative.x*t/distance-c.x, relative.y*t/distance-c.y, relative.z*t/distance-c.z) / body.radius;
    transmission *= 1 - saturnRingOpacity(r);
  }
  return transmission;
}

export function saturnRingOpacity(radius: number): number {
  if (radius < 1.24 || radius > 2.32) return 0;
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
  const cRing = smooth(1.24,1.52,radius);
  const cassini = smooth(1.925,1.951,radius)*(1-smooth(2.015,2.035,radius));
  const encke = 1-.82*Math.exp(-(((radius-2.245)/.006)**2));
  return (.14+(.88-.14)*cRing)*(1-.96*cassini)*encke*(.88+.09*Math.sin(radius*193)+.03*Math.sin(radius*811));
}

/** Relative-coordinate ray test; foreground objects remain visible. */
export function occludedByBody(relative: Vector3, occluders: readonly BodyOccluder[], ownKey?: string): boolean {
  const distance = Math.hypot(relative.x, relative.y, relative.z);
  if (distance === 0) return false;
  const ray = { x: relative.x / distance, y: relative.y / distance, z: relative.z / distance };
  for (const body of occluders) {
    if (body.key === ownKey) continue;
    const along = ray.x * body.center.x + ray.y * body.center.y + ray.z * body.center.z;
    if (along + body.radius <= 0 || along - body.radius >= distance) continue;
    const discriminant = body.radius ** 2 - ((body.center.x - ray.x * along) ** 2
      + (body.center.y - ray.y * along) ** 2 + (body.center.z - ray.z * along) ** 2);
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    const hit = along - root > 0 ? along - root : along + root;
    if (hit > 0 && hit < distance) return true;
  }
  return false;
}
