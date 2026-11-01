/**
 * The geometry of the depth flight. The camera starts at Earth and moves along the axis of the
 * photo. Each source has its true direction and distance, so at the start each one is
 * at its place in the photo. This module must not import `i18n.ts`, so that node tests can import it.
 */
export type DepthSource = {
  key: string;
  name: string;
  x: number;
  y: number;
  cell: [number, number];
  distance_ly: number;
  distance_method: "parallax" | "catalog";
};
export type DepthLayers = {
  photo_id: string;
  width: number;
  height: number;
  cell: number;
  detected: number;
  plane_distance_ly: number;
  sources: DepthSource[];
  base_url: string;
  sprites_url: string;
  credit: { name: string; handle: string; licence: string; title: string };
};
export type Placement = { x: number; y: number; scale: number; alpha: number };

/** A sprite grows near the camera and leaves the frame at this scale. */
const FADE_START = 5;
const FADE_END = 20;

/** The camera distance at a position of the flight from 0 to 1, at a logarithmic pace. It is 0 at the start. */
export function cameraDistance(progress: number, nearest: number, farthest: number): number {
  const start = nearest / 2;
  const end = farthest * 1.05;
  return start * (end / start) ** Math.min(1, Math.max(0, progress)) - start;
}

/** The apparent size of a thing at `distance` for a camera at `camera`, relative to the view from Earth. */
export function apparentScale(distance: number, camera: number): number | null {
  return camera < distance ? distance / (distance - camera) : null;
}

function fade(scale: number): number {
  return Math.min(1, Math.max(0, (FADE_END - scale) / (FADE_END - FADE_START)));
}

/** A point of the photo seen from the camera. `x` and `y` are fractions of the view. */
export function place(x: number, y: number, distance: number, camera: number): Placement | null {
  const scale = apparentScale(distance, camera);
  if (scale === null) return null;
  const alpha = fade(scale);
  return alpha > 0 ? { x: 0.5 + (x - 0.5) * scale, y: 0.5 + (y - 0.5) * scale, scale, alpha } : null;
}

export function depthSpan(layers: Pick<DepthLayers, "sources" | "plane_distance_ly">): { nearest: DepthSource; farthest: DepthSource; low: number; high: number } {
  const sorted = [...layers.sources].sort((a, b) => a.distance_ly - b.distance_ly);
  const nearest = sorted[0]!;
  const farthest = sorted[sorted.length - 1]!;
  return { nearest, farthest, low: Math.min(nearest.distance_ly, layers.plane_distance_ly), high: Math.max(farthest.distance_ly, layers.plane_distance_ly) };
}

/** The nearest source to a point of the view, for a click. A faded source cannot be selected. */
export function sourceAt(sources: readonly DepthSource[], camera: number, x: number, y: number, reach: number): DepthSource | null {
  let best: DepthSource | null = null;
  let distance = reach;
  for (const source of sources) {
    const point = place(source.x, source.y, source.distance_ly, camera);
    if (!point) continue;
    const separation = Math.hypot(point.x - x, point.y - y);
    if (separation <= distance) {
      best = source;
      distance = separation;
    }
  }
  return best;
}
