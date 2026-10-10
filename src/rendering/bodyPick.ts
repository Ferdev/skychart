/** Two markers nearer than this on the screen are one marker for the user. */
export const UNRESOLVED_SEPARATION_PX = 6;

export type BodyPickHit = {
  key: string;
  /** Key of the body that this body orbits, if there is one. */
  parentKey: string | null | undefined;
  x: number;
  y: number;
  /** Distance from the pointer to the marker centre. */
  distancePx: number;
  /** Rank of the object type. A planet is above its moons, and a star is above a catalog object. */
  priority: number;
};

/** True when two screen positions are too near to show as two markers. */
export function isUnresolvedSeparation(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < UNRESOLVED_SEPARATION_PX;
}

/**
 * Selects one body from all bodies below the pointer.
 *
 * A body that is not resolved from one of its ancestors (a moon on top of its planet) gives way to that ancestor.
 * From the bodies that stay, the higher type rank is first, and then the nearer marker.
 */
export function pickBody<T extends BodyPickHit>(hits: readonly T[]): T | null {
  if (hits.length === 0) return null;
  const byKey = new Map(hits.map((hit) => [hit.key, hit]));
  const resolved = hits.filter((hit) => !hasUnresolvedAncestor(hit, byKey));
  let best: T | null = null;
  for (const hit of resolved) {
    if (!best || hit.priority > best.priority || (hit.priority === best.priority && hit.distancePx < best.distancePx)) best = hit;
  }
  return best;
}

function hasUnresolvedAncestor<T extends BodyPickHit>(hit: T, byKey: ReadonlyMap<string, T>): boolean {
  const seen = new Set<string>([hit.key]);
  let parentKey = hit.parentKey;
  while (parentKey && !seen.has(parentKey)) {
    seen.add(parentKey);
    const ancestor = byKey.get(parentKey);
    if (!ancestor) return false;
    if (isUnresolvedSeparation(hit, ancestor)) return true;
    parentKey = ancestor.parentKey;
  }
  return false;
}

/** A pointer this near to the centre of a marker is directly on that marker. */
export const DIRECT_HIT_PX = 6;

export type MapPickInput<T> = {
  /** The body from `pickBody`, with the distance from the pointer to its marker centre. */
  marker: { body: T; distancePx: number } | null;
  /** The object of the label below the pointer. */
  labelled: T | null;
  /** Distance to the nearest catalog point below the pointer, or null when there is none. */
  catalogPointDistancePx: number | null;
};

/**
 * What the pointer selects on the 2D map, from the marker, the label, and the catalog point below it:
 *
 * 1. the marker, when the pointer is directly on it (a label of a different object can cover a marker);
 * 2. the object of the label below the pointer;
 * 3. nothing, when a catalog point is nearer to the pointer than the marker: the caller then selects that point;
 * 4. the marker.
 */
export function pickMapTarget<T>(input: MapPickInput<T>): { body: T; distancePx: number } | null {
  const { marker, labelled, catalogPointDistancePx } = input;
  if (marker && marker.distancePx <= DIRECT_HIT_PX) return marker;
  if (labelled) return { body: labelled, distancePx: 0 };
  if (marker && catalogPointDistancePx !== null && catalogPointDistancePx < marker.distancePx) return null;
  return marker;
}
