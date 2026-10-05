import type { Vector3 } from "../sky/skyProjection";

export type PhotometricPoint = {
  key: string;
  object_type?: string | null;
  position: Vector3;
  apparent_magnitude?: number | null;
  absoluteMagnitudeH?: number | null;
};

// JPL Solar System Dynamics V(1,0) visual magnitudes (1 AU from Sun and observer,
// zero phase): https://ssd.jpl.nasa.gov/planets/phys_par.html
const PLANET_V10: Readonly<Record<string, number>> = {
  mercury: -0.60, venus: -4.47, earth: -3.86, mars: -1.52,
  jupiter: -9.40, saturn: -8.88, uranus: -7.19, neptune: -6.87,
  pluto: -1.0,
};

export function observerApparentMagnitude(point: PhotometricPoint, observer: Vector3): number | null {
  const delta = Math.hypot(point.position.x - observer.x, point.position.y - observer.y, point.position.z - observer.z);
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const radius = Math.hypot(point.position.x, point.position.y, point.position.z);
  if (point.key === "sun") return -26.74 + 5 * Math.log10(delta);

  const v10 = PLANET_V10[point.key];
  const h = v10 ?? point.absoluteMagnitudeH;
  if (typeof h === "number" && Number.isFinite(h) && radius > 0) {
    // Lambertian phase is an approximation; Saturn's rings and atmospheric
    // scattering are not modeled. H for minor bodies also uses this estimate.
    const dot = (-point.position.x * (observer.x - point.position.x)
      - point.position.y * (observer.y - point.position.y)
      - point.position.z * (observer.z - point.position.z)) / (radius * delta);
    const phase = Math.acos(Math.max(-1, Math.min(1, dot)));
    const illuminated = Math.max(1e-6, (Math.sin(phase) + (Math.PI - phase) * Math.cos(phase)) / Math.PI);
    return h + 5 * Math.log10(radius * delta) - 2.5 * Math.log10(illuminated);
  }

  const catalogMagnitude = point.apparent_magnitude;
  if (typeof catalogMagnitude !== "number" || !Number.isFinite(catalogMagnitude) || radius <= 0) return null;
  // Catalog magnitudes are Earth-based; the Sun is an adequate reference for
  // sources beyond the Solar System at this map's geometric precision.
  return catalogMagnitude + 5 * Math.log10(delta / radius);
}

export function isMajorSolarBody(point: PhotometricPoint): boolean {
  return point.key === "sun" || Object.prototype.hasOwnProperty.call(PLANET_V10, point.key);
}

export function rankUniverseLabels<T extends { point: PhotometricPoint; magnitude: number | null; distance: number }>(
  candidates: T[], observer: Vector3, selectedKey?: string,
): T[] {
  const solarSystem = Math.hypot(observer.x, observer.y, observer.z) <= 100;
  const nearestKeys = new Set<string>();
  if (solarSystem) {
    for (const [type, count] of [["star", 4], ["galaxy", 2]] as const) {
      const nearest = candidates.filter((hit) => type === "galaxy"
        ? ["galaxy", "active_galaxy"].includes(hit.point.object_type ?? "")
        : hit.point.object_type === type)
        .sort((left, right) => left.distance - right.distance).slice(0, count);
      for (const hit of nearest) nearestKeys.add(hit.point.key);
    }
  }
  const labels = candidates.filter((hit) => hit.point.key === selectedKey
    || solarSystem && (isMajorSolarBody(hit.point) || nearestKeys.has(hit.point.key))
    || hit.magnitude !== null && hit.magnitude <= 4.5);
  const priority = (hit: T) => hit.point.key === selectedKey ? 0
    : solarSystem && isMajorSolarBody(hit.point) ? 1
      : solarSystem && nearestKeys.has(hit.point.key) ? 2 : 3;
  return labels.sort((left, right) => priority(left) - priority(right)
    || (left.magnitude ?? 99) - (right.magnitude ?? 99) || left.distance - right.distance);
}
