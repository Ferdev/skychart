import { footprintDirections, type Wcs } from "./photoFootprint.ts";
type Point = { x: number; y: number };
type Vector = Point & { z: number };
/** A photographic plane at a catalog distance. It is an appearance annotation. */
export function planeCorners(
  wcs: Wcs,
  distance: number,
  origin: Vector,
  observer: Vector,
  project: (point: Vector) => Point | null,
): Point[] {
  if (!Number.isFinite(distance) || distance <= 0) return [];
  // FITS image y increases upwards; DOM image y increases downwards.
  const rays = footprintDirections(wcs);
  return [3, 2, 1, 0]
    .map((i) => rays[i])
    .map((ray) =>
      ray
        ? project({
            x: origin.x + ray.x * distance - observer.x,
            y: origin.y + ray.y * distance - observer.y,
            z: origin.z + ray.z * distance - observer.z,
          })
        : null,
    )
    .filter((p): p is Point => p !== null);
}
/** Homography for a unit square, using all four perspective-projected corners. */
export function planeTransform(p: Point[]): string | null {
  if (
    p.length !== 4 ||
    !p.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  const [a, b, c, d] = p,
    dx1 = b.x - c.x,
    dx2 = d.x - c.x,
    dy1 = b.y - c.y,
    dy2 = d.y - c.y;
  const sx = a.x - b.x + c.x - d.x,
    sy = a.y - b.y + c.y - d.y,
    det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 0.01) return null;
  const g = (sx * dy2 - dx2 * sy) / det,
    k = (dx1 * sy - sx * dy1) / det;
  const h = [
    b.x - a.x + g * b.x,
    d.x - a.x + k * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + k * d.y,
    a.y,
    g,
    k,
    1,
  ];
  if (!h.every(Number.isFinite) || g <= -1 || k <= -1 || g + k <= -1)
    return null;
  return `matrix3d(${[h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].join(",")})`;
}
