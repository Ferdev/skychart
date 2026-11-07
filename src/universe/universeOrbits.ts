import type { Body } from "../atlas/contracts.ts";
import { exoplanetOrbitPathAu } from "../catalog/exoplanetOrbit.ts";
import { isPlanetCandidate, orbitsHostStar } from "../catalog/exoplanetGroups.ts";
import type { Vector3 } from "../sky/skyProjection.ts";
import { AU_KM } from "./universeBodyGeometry.ts";

type Projector = (direction: Vector3) => { x: number; y: number } | null;

export type UniverseOrbitKind = "planet" | "exoplanet" | "candidate";
export type UniverseOrbit = { key: string; kind: UniverseOrbitKind; points: Vector3[] };

// An orbit is a closed ellipse. This is enough samples for a smooth line at
// every zoom the 3D view reaches, and a planet has only one ring.
const ORBIT_SAMPLES = 240;
const PLANET_ORBIT_COLOR = "rgba(136, 189, 166, 0.5)";
const EXOPLANET_ORBIT_COLOR = "rgba(137, 214, 255, 0.55)";
const CANDIDATE_ORBIT_COLOR = "rgba(201, 184, 255, 0.62)";
const EXOPLANET_ORBIT_DASH = [6, 5];
const CANDIDATE_ORBIT_DASH = [1.5, 5];
// A projected line that jumps this much crosses the camera or a frame edge.
const MAX_SCREEN_JUMP_FRACTION = 0.35;

/** True for a planet or dwarf planet: the bodies whose orbit the 3D view draws. */
export function isOrbitPlanet(body: Body): boolean {
  return orbitsHostStar(body) || body.object_type === "planet" || body.object_type === "dwarf_planet";
}

/** The orbit of one planet in heliocentric ecliptic coordinates, or null when it has none. */
export function universeOrbitForBody(body: Body, parent: Body | null): UniverseOrbit | null {
  if (!isOrbitPlanet(body)) return null;
  if (orbitsHostStar(body)) {
    const path = exoplanetOrbitPathAu(body, ORBIT_SAMPLES);
    if (!path || path.length < 2) return null;
    return {
      key: body.key,
      kind: isPlanetCandidate(body) ? "candidate" : "exoplanet",
      points: path.map((point) => ({ x: point.xAu, y: point.yAu, z: point.zAu })),
    };
  }
  const points = solarSystemOrbitPoints(body, parent);
  return points ? { key: body.key, kind: "planet", points } : null;
}

/** The orbits of every loaded planet, in the order of the body map. */
export function universeOrbits(bodies: Iterable<Body>, bodyByKey: ReadonlyMap<string, Body>): UniverseOrbit[] {
  const orbits: UniverseOrbit[] = [];
  for (const body of bodies) {
    const orbit = universeOrbitForBody(body, bodyByKey.get(body.parent_key ?? "") ?? null);
    if (orbit) orbits.push(orbit);
  }
  return orbits;
}

/** The Orbits switch of the 3D view and the rings it controls. */
export class UniverseOrbitOverlay {
  private visible = true;
  private readonly button: HTMLButtonElement;
  private readonly onChange: () => void;

  constructor(button: HTMLButtonElement, onChange: () => void) {
    this.button = button;
    this.onChange = onChange;
    button.setAttribute("aria-pressed", "true");
    button.addEventListener("click", () => this.toggle());
  }

  toggle(): void {
    this.visible = !this.visible;
    this.button.setAttribute("aria-pressed", String(this.visible));
    this.onChange();
  }

  draw(context: CanvasRenderingContext2D, bodies: Iterable<Body>, bodyByKey: ReadonlyMap<string, Body>,
    observer: Vector3, project: Projector, width: number, selectedKey?: string): void {
    if (!this.visible) return;
    drawUniverseOrbits(context, universeOrbits(bodies, bodyByKey), observer, project, width, selectedKey);
  }
}

/** Draws the orbits under the catalog points. A ring behind the camera is split. */
export function drawUniverseOrbits(
  context: CanvasRenderingContext2D,
  orbits: readonly UniverseOrbit[],
  observer: Vector3,
  project: Projector,
  width: number,
  selectedKey?: string,
): void {
  if (orbits.length === 0) return;
  context.save();
  context.lineCap = "round";
  for (const orbit of orbits) {
    const highlighted = orbit.key === selectedKey;
    context.setLineDash(orbit.kind === "planet" ? [] : orbit.kind === "candidate" ? CANDIDATE_ORBIT_DASH : EXOPLANET_ORBIT_DASH);
    context.strokeStyle = highlighted
      ? "rgba(248, 218, 136, 0.78)"
      : orbit.kind === "candidate" ? CANDIDATE_ORBIT_COLOR : orbit.kind === "exoplanet" ? EXOPLANET_ORBIT_COLOR : PLANET_ORBIT_COLOR;
    context.lineWidth = highlighted ? 1.8 : 1.1;
    context.beginPath();
    let previous: { x: number; y: number } | null = null;
    for (const point of orbit.points) {
      const projected = project({ x: point.x - observer.x, y: point.y - observer.y, z: point.z - observer.z });
      if (!projected || (previous && Math.hypot(projected.x - previous.x, projected.y - previous.y) > width * MAX_SCREEN_JUMP_FRACTION)) {
        previous = null;
        continue;
      }
      if (previous) context.lineTo(projected.x, projected.y);
      else context.moveTo(projected.x, projected.y);
      previous = projected;
    }
    context.stroke();
  }
  context.restore();
}

/**
 * The measured osculating ellipse of a Solar System planet. The elements are
 * parent-relative, so the ring is placed at the parent body's position.
 */
function solarSystemOrbitPoints(body: Body, parent: Body | null): Vector3[] | null {
  const orbit = body.orbit;
  if (!orbit?.semi_major_axis_km || orbit.semi_major_axis_km <= 0) return null;
  const semiMajorAxisAu = orbit.semi_major_axis_km / AU_KM;
  const eccentricity = clamp(orbit.eccentricity ?? 0, 0, 0.98);
  const semiLatusRectumAu = semiMajorAxisAu * (1 - eccentricity * eccentricity);
  const argumentOfPeriapsis = degreesToRadians(orbit.argument_of_periapsis_deg ?? 0);
  const inclination = degreesToRadians(orbit.inclination_deg ?? 0);
  const ascendingNode = degreesToRadians(orbit.longitude_of_ascending_node_deg ?? 0);
  const origin = parent?.position ?? { x_au: 0, y_au: 0, z_au: 0 };
  const cosNode = Math.cos(ascendingNode);
  const sinNode = Math.sin(ascendingNode);
  const cosPeriapsis = Math.cos(argumentOfPeriapsis);
  const sinPeriapsis = Math.sin(argumentOfPeriapsis);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const points: Vector3[] = [];
  for (let index = 0; index <= ORBIT_SAMPLES; index += 1) {
    const trueAnomaly = (index / ORBIT_SAMPLES) * Math.PI * 2;
    const radiusAu = semiLatusRectumAu / Math.max(0.02, 1 + eccentricity * Math.cos(trueAnomaly));
    const orbitalX = radiusAu * Math.cos(trueAnomaly);
    const orbitalY = radiusAu * Math.sin(trueAnomaly);
    const perpendicularX = cosPeriapsis * orbitalX - sinPeriapsis * orbitalY;
    const perpendicularY = sinPeriapsis * orbitalX + cosPeriapsis * orbitalY;
    points.push({
      x: origin.x_au + cosNode * perpendicularX - sinNode * cosInclination * perpendicularY,
      y: origin.y_au + sinNode * perpendicularX + cosNode * cosInclination * perpendicularY,
      z: origin.z_au + sinInclination * perpendicularY,
    });
  }
  return points;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
