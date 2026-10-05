import type { Vector3 } from "../sky/skyProjection.ts";

const AU_KM = 149_597_870.7;
const TAU = Math.PI * 2;
const SAMPLES = 128;
/** Beyond this heliocentric distance the Sun no longer dominates the motion. */
export const SOLAR_REACH_AU = 100_000;
/** Playback seconds for one transfer at normal pace. */
export const TRANSFER_PLAYBACK_SECONDS = 14;
const PLAYBACK_RAMP = 0.12;

/** Gravitational parameters in km³/s², matching backend/catalog_sources.py. */
const MU_KM3_S2: Record<string, number> = {
  sun: 132_712_440_018, mercury: 22_031.78, venus: 324_858.592, earth: 398_600.4418,
  mars: 42_828.375214, jupiter: 126_686_534, saturn: 37_931_187, uranus: 5_793_939, neptune: 6_836_529,
};

export type GravityBody = { key: string; name: string; position: Vector3; muAu3S2: number; radiusAu: number };

export type TransferPlan = {
  center: GravityBody;
  /** Positions along the arc, evenly spaced in eccentric anomaly. */
  points: Vector3[];
  /** Real seconds since departure at each point. */
  times: number[];
  durationSeconds: number;
  semiMajorAu: number;
  eccentricity: number;
  prograde: boolean;
};

export type TransferResult = { plan: TransferPlan } | { unavailable: "range" | "radial" | "collision" };

type GravitySource = { key: string; name: string; radius_km?: number | null; position: { x_au: number; y_au: number; z_au?: number | null } };

/** The Sun and major planets among the loaded atlas bodies. */
export function gravityBodies(bodies: Iterable<GravitySource>): GravityBody[] {
  const found: GravityBody[] = [];
  for (const body of bodies) {
    const mu = MU_KM3_S2[body.key];
    if (!mu) continue;
    found.push({
      key: body.key, name: body.name, muAu3S2: mu / AU_KM ** 3, radiusAu: (body.radius_km ?? 0) / AU_KM,
      position: { x: body.position.x_au, y: body.position.y_au, z: body.position.z_au ?? 0 },
    });
  }
  return found;
}

/** The body whose gravity governs both ends of a leg: a planet when both lie
 * inside its sphere of influence, otherwise the Sun. */
export function centralBody(start: Vector3, end: Vector3, bodies: readonly GravityBody[]): GravityBody | null {
  const sun = bodies.find((body) => body.key === "sun");
  if (!sun) return null;
  let center = sun;
  let reach = Number.POSITIVE_INFINITY;
  for (const body of bodies) {
    if (body === sun) continue;
    const influence = length(subtract(body.position, sun.position)) * (body.muAu3S2 / sun.muAu3S2) ** 0.4;
    if (influence < reach && length(subtract(start, body.position)) < influence && length(subtract(end, body.position)) < influence) {
      center = body;
      reach = influence;
    }
  }
  return center;
}

/** Plan an unpowered coast between two points: the minimum-energy Kepler
 * ellipse about the governing body, flown prograde unless that arc would dip
 * into the body. Bodies are held at their positions for the displayed epoch. */
export function planTransfer(start: Vector3, end: Vector3, bodies: readonly GravityBody[]): TransferResult {
  const center = centralBody(start, end, bodies);
  const sun = bodies.find((body) => body.key === "sun");
  if (!center || !sun || Math.max(length(subtract(start, sun.position)), length(subtract(end, sun.position))) > SOLAR_REACH_AU) {
    return { unavailable: "range" };
  }
  const r1 = subtract(start, center.position);
  const r2 = subtract(end, center.position);
  const r1m = length(r1);
  const r2m = length(r2);
  const chord = length(subtract(r2, r1));
  if (!(chord > 0) || !(r1m > 0) || !(r2m > 0)) return { unavailable: "radial" };
  // Minimum-energy ellipse: 2a is half the triangle perimeter and the vacant
  // focus lies on the chord, (2a - r1) from the start.
  const a = (r1m + r2m + chord) / 4;
  const vacant = add(r1, scale(subtract(r2, r1), (2 * a - r1m) / chord));
  const eccentricity = length(vacant) / (2 * a);
  let normal = cross(r1, r2);
  if (length(normal) < 1e-9 * r1m * r2m) {
    if (dot(r1, r2) > 0) return { unavailable: "radial" };
    // Opposite sides of the body (a Hohmann-like half orbit): any plane holds
    // the chord, so use the one closest to the ecliptic.
    const radial = scale(r1, 1 / r1m);
    normal = subtract({ x: 0, y: 0, z: 1 }, scale(radial, radial.z));
    if (length(normal) < 1e-6) normal = subtract({ x: 1, y: 0, z: 0 }, scale(radial, radial.x));
  }
  normal = scale(normal, (normal.z < 0 ? -1 : 1) / length(normal));
  const periapsisAxis = eccentricity > 1e-9 ? scale(vacant, -1 / length(vacant)) : scale(r1, 1 / r1m);
  const sideAxis = cross(normal, periapsisAxis);
  const b = a * Math.sqrt(Math.max(0, 1 - eccentricity ** 2));
  if (b < a * 1e-6) return { unavailable: "radial" };
  const anomaly = (r: Vector3) => Math.atan2(dot(r, sideAxis) / b, dot(r, periapsisAxis) / a + eccentricity);
  const startAnomaly = anomaly(r1);
  let sweep = ((anomaly(r2) - startAnomaly) % TAU + TAU) % TAU || TAU;
  // The prograde arc contains periapsis when it crosses a multiple of 2π.
  const crossesPeriapsis = (startAnomaly < 0 && startAnomaly + sweep > 0) || startAnomaly + sweep > TAU;
  const prograde = !(crossesPeriapsis && a * (1 - eccentricity) < center.radiusAu * 1.5);
  if (!prograde) sweep -= TAU;
  if (!prograde && Math.min(r1m, r2m) < center.radiusAu * 1.5) return { unavailable: "collision" };
  const meanMotion = Math.sqrt(center.muAu3S2 / a ** 3);
  const meanAnomaly = (value: number) => value - eccentricity * Math.sin(value);
  const points: Vector3[] = [];
  const times: number[] = [];
  for (let index = 0; index <= SAMPLES; index += 1) {
    const value = startAnomaly + sweep * index / SAMPLES;
    points.push(add(center.position, add(scale(periapsisAxis, a * (Math.cos(value) - eccentricity)), scale(sideAxis, b * Math.sin(value)))));
    times.push(Math.abs(meanAnomaly(value) - meanAnomaly(startAnomaly)) / meanMotion);
  }
  points[0] = { ...start };
  points[SAMPLES] = { ...end };
  return { plan: { center, points, times, durationSeconds: times[SAMPLES]!, semiMajorAu: a, eccentricity, prograde } };
}

/** Position after a fraction of the real transfer time. */
export function transferPosition(plan: TransferPlan, timeFraction: number): Vector3 {
  const time = Math.min(1, Math.max(0, timeFraction)) * plan.durationSeconds;
  let low = 0;
  let high = plan.times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (plan.times[middle]! <= time) low = middle; else high = middle;
  }
  const span = plan.times[high]! - plan.times[low]!;
  const blend = span > 0 ? (time - plan.times[low]!) / span : 0;
  return add(plan.points[low]!, scale(subtract(plan.points[high]!, plan.points[low]!), blend));
}

/** Orbital speed in AU/s at a position on the transfer (vis-viva). */
export function transferSpeed(plan: TransferPlan, position: Vector3): number {
  const radius = length(subtract(position, plan.center.position));
  return Math.sqrt(Math.max(0, plan.center.muAu3S2 * (2 / radius - 1 / plan.semiMajorAu)));
}

/** Time fraction shown after a fraction of the playback: the time compression
 * eases in and out so the view does not jerk, while the path stays the orbit. */
export function playbackTimeFraction(playback: number): number {
  const t = Math.min(1, Math.max(0, playback));
  const cruise = 1 - PLAYBACK_RAMP;
  if (t < PLAYBACK_RAMP) return t * t / (2 * PLAYBACK_RAMP) / cruise;
  if (t > cruise) return 1 - (1 - t) ** 2 / (2 * PLAYBACK_RAMP) / cruise;
  return (t - PLAYBACK_RAMP / 2) / cruise;
}

function add(a: Vector3, b: Vector3): Vector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(a: Vector3, factor: number): Vector3 { return { x: a.x * factor, y: a.y * factor, z: a.z * factor }; }
function dot(a: Vector3, b: Vector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(a: Vector3): number { return Math.hypot(a.x, a.y, a.z); }
function cross(a: Vector3, b: Vector3): Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
