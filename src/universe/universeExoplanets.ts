import { isExoplanetHostStar } from "../catalog/exoplanetGroups.ts";
import type { Vector3 } from "../sky/skyProjection";
import type { UniversePoint } from "./universePointModel";

type HostPosition = { x_au: number; y_au: number; z_au: number };

// Planets load for the nearest host stars inside this distance. From farther
// away an orbit is less than one pixel wide and the star represents the system.
const SYSTEM_LOAD_DISTANCE_AU = 50_000;
const MAX_SYSTEMS_PER_UPDATE = 3;

/**
 * Loads the planets and the planet candidates of the host stars near the 3D observer. The 3D catalog
 * endpoint keeps each planet at its host star; the loaded bodies carry the
 * orbit offset for the atlas time and replace those points.
 */
export class UniverseExoplanetSystems {
  private readonly requested = new Set<string>();
  private readonly load: (host: HostPosition) => Promise<void>;
  private readonly afterLoad: () => void;

  constructor(load: (host: HostPosition) => Promise<void>, afterLoad: () => void) {
    this.load = load;
    this.afterLoad = afterLoad;
  }

  /** Forgets the loaded systems. A time change drops the planet bodies. */
  reset(): void {
    this.requested.clear();
  }

  update(points: readonly UniversePoint[], observer: Vector3): void {
    const hosts = points
      .filter((point) => isExoplanetHostStar(point))
      .map((point) => ({ point, distance: Math.hypot(point.position.x - observer.x, point.position.y - observer.y, point.position.z - observer.z) }))
      .filter(({ distance }) => distance <= SYSTEM_LOAD_DISTANCE_AU)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, MAX_SYSTEMS_PER_UPDATE);
    for (const { point } of hosts) {
      // A curated host and its archive record are at one position: one request serves the two.
      const signature = `${point.position.x.toFixed(2)}:${point.position.y.toFixed(2)}:${point.position.z.toFixed(2)}`;
      if (this.requested.has(signature)) continue;
      this.requested.add(signature);
      void this.load({ x_au: point.position.x, y_au: point.position.y, z_au: point.position.z })
        .then(this.afterLoad)
        .catch(() => { this.requested.delete(signature); });
    }
  }
}

/** Light direction for a body: toward its host star when it has one, else toward the Sun at the origin. */
export function lightDirection(body: { position: Vector3; lightSource?: Vector3 | null }): Vector3 {
  const source = body.lightSource ?? { x: 0, y: 0, z: 0 };
  const direction = { x: source.x - body.position.x, y: source.y - body.position.y, z: source.z - body.position.z };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  return length > 0 ? { x: direction.x / length, y: direction.y / length, z: direction.z / length } : { x: 1, y: 0, z: 0 };
}
