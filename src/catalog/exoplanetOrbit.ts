import type { Body, BodyExoplanetOrbit, ExoplanetOrbitConvention } from "../atlas/contracts";
import { solveKepler, type SmallBodyPosition } from "./smallBodyPropagation.ts";

const JULIAN_DAY_UNIX_EPOCH = 2_440_587.5;
const MILLISECONDS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;
const FULL_TURN = Math.PI * 2;
const EXOPLANET_GROUP = "exoplanets";

/*
 * Display conventions for host-relative exoplanet orbits. No other file
 * contains these values. The NASA Exoplanet Archive gives the orbit size and
 * the timing; it gives no node angle, and for many planets no inclination and
 * no orbit shape. Each convention below stands in for one absent value and is
 * reported in `BodyExoplanetOrbit.conventions`.
 */

/** Node angle: the line of nodes is at 90 degrees to the line of sight and parallel to this plane normal. */
export const NODE_REFERENCE_NORMAL: Vector3 = { x: 0, y: 0, z: 1 };
/** Node direction for a host at an ecliptic pole, where the rule above gives no direction. */
export const POLE_NODE_DIRECTION: Vector3 = { x: 1, y: 0, z: 0 };
/** Inclination to the sky plane when the archive gives none or only a limit: an edge-on orbit. */
export const ASSUMED_INCLINATION_DEG = 90;
/** Eccentricity when the archive gives none, only a limit, or no argument of periastron: a circle. */
export const ASSUMED_ECCENTRICITY = 0;
/** Angle from the node at conjunction, where the planet is between the Sun and the host. */
export const CONJUNCTION_ANGLE_FROM_NODE_RAD = Math.PI / 2;
/** 1-sigma phase uncertainty, in orbits, from which the planet marker is hollow. */
export const HOLLOW_MARKER_PHASE_UNCERTAINTY_ORBITS = 0.05;
/** 1-sigma phase uncertainty, in orbits, above which the atlas draws no planet marker. */
export const MAX_MARKER_PHASE_UNCERTAINTY_ORBITS = 0.25;
/** On-screen orbit width from which a planet has its own marker. Below it the host star represents the system. */
export const RESOLVED_ORBIT_MIN_WIDTH_PX = 4;
/** TT - UTC since 2017. The atlas adds it for reference times in TDB or TT. */
export const DYNAMICAL_TIME_MINUS_UTC_SECONDS = 69.184;

export type Vector3 = { x: number; y: number; z: number };

/** Unit vectors at the host star: `s` from the Sun to the host, `n` along the node, `m = s x n`. */
export type HostFrame = { n: Vector3; m: Vector3; s: Vector3 };

export type ExoplanetEphemeris = {
  referenceType: "conjunction" | "periastron";
  referenceTimeJd: number;
  referenceTimeSigmaDays: number | null;
  periodDays: number;
  periodSigmaDays: number | null;
  dynamicalTime: boolean;
  mixedReferences: boolean;
};

export type ExoplanetOrbitElements = {
  semiMajorAxisAu: number;
  eccentricity: number;
  argumentOfPeriastronRad: number;
  inclinationRad: number;
  conventions: ExoplanetOrbitConvention[];
  ephemeris: ExoplanetEphemeris | null;
};

export type ExoplanetOrbitState = {
  displayState: "position" | "orbit_only";
  displayReason: "calculated" | "no_timing" | "phase_uncertainty";
  marker: "solid" | "hollow" | "none";
  phaseUncertaintyOrbits: number | null;
  meanAnomalyRad: number | null;
};

/**
 * Reads and checks the orbit facts of one planet. Returns null when the
 * record has no drawable orbit; the planet then stays a fact on its host star.
 */
export function readExoplanetOrbit(facts: Record<string, unknown> | null | undefined): ExoplanetOrbitElements | null {
  if (!facts || (facts.orbit_display_state !== "position" && facts.orbit_display_state !== "orbit_only")) return null;
  const semiMajorAxisAu = finiteFact(facts.semi_major_axis_au);
  if (semiMajorAxisAu === null || semiMajorAxisAu <= 0) return null;

  const conventions: ExoplanetOrbitConvention[] = ["node_angle"];
  const ephemeris = facts.orbit_display_state === "position" ? readEphemeris(facts) : null;

  const inclinationDeg = measuredFact(facts, "inclination_deg");
  const inclinationMeasured = inclinationDeg !== null && inclinationDeg >= 0 && inclinationDeg <= 180;
  if (!inclinationMeasured) conventions.push("edge_on_inclination");

  // A periastron time is tied to the argument of periastron of its own
  // solution, so that value also orients the ellipse.
  const argumentDeg = ephemeris?.referenceType === "periastron"
    ? finiteFact(facts.ephemeris_argument_of_periastron_deg)
    : measuredFact(facts, "argument_of_periastron_deg");
  const measuredEccentricity = measuredFact(facts, "eccentricity");
  const shapeMeasured = measuredEccentricity !== null && measuredEccentricity >= 0 && measuredEccentricity < 1
    && (measuredEccentricity === 0 || argumentDeg !== null);
  if (!shapeMeasured) conventions.push("circular_orbit");
  const eccentricity = shapeMeasured ? measuredEccentricity : ASSUMED_ECCENTRICITY;
  const argumentUsed = argumentDeg !== null && (eccentricity > 0 || ephemeris?.referenceType === "periastron");

  return {
    semiMajorAxisAu,
    eccentricity,
    argumentOfPeriastronRad: argumentUsed ? degreesToRadians(argumentDeg) : 0,
    inclinationRad: degreesToRadians(inclinationMeasured ? inclinationDeg : ASSUMED_INCLINATION_DEG),
    conventions,
    ephemeris,
  };
}

/** Makes the frame at the host star from its heliocentric ecliptic position. */
export function hostFrame(host: Vector3): HostFrame {
  const s = unit(host) ?? POLE_NODE_DIRECTION;
  const n = unit(cross(NODE_REFERENCE_NORMAL, s)) ?? unit(cross(s, cross(POLE_NODE_DIRECTION, s))) ?? POLE_NODE_DIRECTION;
  return { n, m: cross(s, n), s };
}

/**
 * Calculates where the planet is on its orbit at a timestamp, and how well
 * that is known. The phase is the phase that an observer in the Solar System
 * sees at that time; the light travel time is not removed.
 */
export function exoplanetOrbitStateAt(elements: ExoplanetOrbitElements, timestamp: string): ExoplanetOrbitState {
  const ephemeris = elements.ephemeris;
  const milliseconds = Date.parse(timestamp);
  if (!ephemeris || !Number.isFinite(milliseconds)) {
    return { displayState: "orbit_only", displayReason: "no_timing", marker: "none", phaseUncertaintyOrbits: null, meanAnomalyRad: null };
  }
  const julianDay = milliseconds / MILLISECONDS_PER_DAY + JULIAN_DAY_UNIX_EPOCH
    + (ephemeris.dynamicalTime ? DYNAMICAL_TIME_MINUS_UTC_SECONDS / SECONDS_PER_DAY : 0);
  const orbits = (julianDay - ephemeris.referenceTimeJd) / ephemeris.periodDays;
  const phaseUncertaintyOrbits = ephemeris.referenceTimeSigmaDays === null || ephemeris.periodSigmaDays === null
    ? null
    : Math.hypot(ephemeris.referenceTimeSigmaDays, orbits * ephemeris.periodSigmaDays) / ephemeris.periodDays;
  if (phaseUncertaintyOrbits !== null && phaseUncertaintyOrbits > MAX_MARKER_PHASE_UNCERTAINTY_ORBITS) {
    return { displayState: "orbit_only", displayReason: "phase_uncertainty", marker: "none", phaseUncertaintyOrbits, meanAnomalyRad: null };
  }

  const meanAnomalyAtReference = ephemeris.referenceType === "conjunction"
    ? meanAnomalyAtTrueAnomaly(CONJUNCTION_ANGLE_FROM_NODE_RAD - elements.argumentOfPeriastronRad, elements.eccentricity)
    : 0;
  const hollow = phaseUncertaintyOrbits === null
    || phaseUncertaintyOrbits >= HOLLOW_MARKER_PHASE_UNCERTAINTY_ORBITS
    || ephemeris.mixedReferences;
  return {
    displayState: "position",
    displayReason: "calculated",
    marker: hollow ? "hollow" : "solid",
    phaseUncertaintyOrbits,
    meanAnomalyRad: normalizeRadians(meanAnomalyAtReference + FULL_TURN * (orbits - Math.floor(orbits))),
  };
}

/** Offset of the planet from its host star, in AU, or null when no position is calculated. */
export function exoplanetOffsetAu(elements: ExoplanetOrbitElements, frame: HostFrame, state: ExoplanetOrbitState): Vector3 | null {
  if (state.meanAnomalyRad === null) return null;
  return offsetAtEccentricAnomaly(elements, frame, solveKepler(state.meanAnomalyRad, elements.eccentricity));
}

/** Samples the closed orbit ring as offsets from the host star, in AU. */
export function exoplanetOrbitRingAu(elements: ExoplanetOrbitElements, frame: HostFrame, samples = 180): Vector3[] {
  const points: Vector3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push(offsetAtEccentricAnomaly(elements, frame, (index / samples) * FULL_TURN));
  }
  return points;
}

/** Samples the 1-sigma phase interval around the planet as offsets from the host star, in AU. */
export function exoplanetUncertaintyArcAu(
  elements: ExoplanetOrbitElements,
  frame: HostFrame,
  state: ExoplanetOrbitState,
  samplesPerOrbit = 180,
): Vector3[] | null {
  if (state.meanAnomalyRad === null || state.phaseUncertaintyOrbits === null || state.phaseUncertaintyOrbits <= 0) return null;
  const halfWidth = Math.min(0.5, state.phaseUncertaintyOrbits) * FULL_TURN;
  const samples = Math.max(2, Math.ceil((halfWidth / Math.PI) * samplesPerOrbit));
  const points: Vector3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const meanAnomaly = state.meanAnomalyRad - halfWidth + (index / samples) * halfWidth * 2;
    points.push(offsetAtEccentricAnomaly(elements, frame, solveKepler(normalizeRadians(meanAnomaly), elements.eccentricity)));
  }
  return points;
}

/**
 * Returns a copy of an exoplanet at the atlas time: host position plus the
 * orbit offset. A body that is not an exoplanet, or has no orbit facts, comes
 * back unchanged.
 */
export function positionExoplanet(body: Body, timestamp: string, auKm: number, earth?: Body): Body {
  if (body.catalog_group !== EXOPLANET_GROUP) return body;
  const facts = body.catalog?.facts;
  const host = body.exoplanet_orbit?.host_position
    ?? { x_au: body.position.x_au, y_au: body.position.y_au, z_au: body.position.z_au };
  const elements = readExoplanetOrbit(facts);
  if (!elements) {
    if (facts?.orbit_display_state !== "none") return body;
    return {
      ...body,
      exoplanet_orbit: {
        host_position: host, display_state: "none", display_reason: "no_orbit_size", marker: "none",
        semi_major_axis_au: null, mean_anomaly_rad: null, phase_uncertainty_orbits: null, conventions: [],
      },
    };
  }

  const state = exoplanetOrbitStateAt(elements, timestamp);
  const offset = exoplanetOffsetAu(elements, hostFrame({ x: host.x_au, y: host.y_au, z: host.z_au }), state);
  const xAu = host.x_au + (offset?.x ?? 0);
  const yAu = host.y_au + (offset?.y ?? 0);
  const zAu = host.z_au + (offset?.z ?? 0);
  const earthPosition = earth?.position;
  return {
    ...body,
    catalog: body.catalog ? { ...body.catalog, dynamic_position: offset !== null } : body.catalog,
    exoplanet_orbit: {
      host_position: host,
      display_state: state.displayState,
      display_reason: state.displayReason,
      marker: state.marker,
      semi_major_axis_au: elements.semiMajorAxisAu,
      mean_anomaly_rad: state.meanAnomalyRad,
      phase_uncertainty_orbits: state.phaseUncertaintyOrbits,
      conventions: elements.conventions,
    },
    position: {
      x_au: xAu,
      y_au: yAu,
      z_au: zAu,
      x_km: xAu * auKm,
      y_km: yAu * auKm,
      z_km: zAu * auKm,
      heliocentric_distance_km: Math.hypot(xAu, yAu, zAu) * auKm,
    },
    distance_from_earth_km: earthPosition
      ? Math.hypot(xAu - earthPosition.x_au, yAu - earthPosition.y_au, zAu - earthPosition.z_au) * auKm
      : Math.hypot(xAu, yAu, zAu) * auKm,
  };
}

/** Orbit ring of a positioned exoplanet in heliocentric ecliptic coordinates, or null when it has no orbit. */
export function exoplanetOrbitPathAu(body: Body, samples = 180): SmallBodyPosition[] | null {
  const orbit = drawableOrbit(body);
  if (!orbit) return null;
  return exoplanetOrbitRingAu(orbit.elements, orbit.frame, samples).map((offset) => worldPosition(orbit.host, offset));
}

/** 1-sigma uncertainty arc of a positioned exoplanet in heliocentric ecliptic coordinates. */
export function exoplanetUncertaintyPathAu(body: Body, samplesPerOrbit = 180): SmallBodyPosition[] | null {
  const orbit = drawableOrbit(body);
  const summary = body.exoplanet_orbit;
  if (!orbit || !summary || summary.display_state !== "position") return null;
  const arc = exoplanetUncertaintyArcAu(orbit.elements, orbit.frame, {
    displayState: "position",
    displayReason: "calculated",
    marker: summary.marker,
    phaseUncertaintyOrbits: summary.phase_uncertainty_orbits,
    meanAnomalyRad: summary.mean_anomaly_rad,
  }, samplesPerOrbit);
  return arc?.map((offset) => worldPosition(orbit.host, offset)) ?? null;
}

/** Largest distance from the host star that the orbit reaches, in AU. Null when there is no orbit. */
export function exoplanetOrbitReachAu(body: Body): number | null {
  const elements = body.exoplanet_orbit ? readExoplanetOrbit(body.catalog?.facts) : null;
  return elements ? elements.semiMajorAxisAu * (1 + elements.eccentricity) : null;
}

/** True for an exoplanet that the orbit module has positioned. The Canvas overlay draws its marker. */
export function isPositionedExoplanet(body: Body): boolean {
  return body.catalog_group === EXOPLANET_GROUP && Boolean(body.exoplanet_orbit);
}

/** True when the orbit is wide enough on screen for the planet to have its own marker. */
export function isExoplanetOrbitResolved(body: Body, pxPerAu: number): boolean {
  const semiMajorAxisAu = body.exoplanet_orbit?.semi_major_axis_au;
  return typeof semiMajorAxisAu === "number" && semiMajorAxisAu * 2 * pxPerAu >= RESOLVED_ORBIT_MIN_WIDTH_PX;
}

/** True when the atlas draws a marker for this exoplanet: a calculated position on a resolved orbit. */
export function hasResolvedExoplanetMarker(body: Body, pxPerAu: number): boolean {
  return body.exoplanet_orbit?.display_state === "position" && isExoplanetOrbitResolved(body, pxPerAu);
}

/** True for a planet with no calculated position on a resolved orbit: it has a ring and no marker. */
export function isRingOnlyExoplanet(body: Body, pxPerAu: number): boolean {
  return isPositionedExoplanet(body) && body.exoplanet_orbit?.marker === "none" && isExoplanetOrbitResolved(body, pxPerAu);
}

function drawableOrbit(body: Body) {
  const summary = body.exoplanet_orbit;
  if (!summary || summary.display_state === "none") return null;
  const elements = readExoplanetOrbit(body.catalog?.facts);
  if (!elements) return null;
  const host = { x: summary.host_position.x_au, y: summary.host_position.y_au, z: summary.host_position.z_au };
  return { elements, host, frame: hostFrame(host) };
}

function worldPosition(host: Vector3, offset: Vector3): SmallBodyPosition {
  return { xAu: host.x + offset.x, yAu: host.y + offset.y, zAu: host.z + offset.z };
}

function readEphemeris(facts: Record<string, unknown>): ExoplanetEphemeris | null {
  const referenceType = facts.ephemeris_reference_type;
  if (referenceType !== "conjunction" && referenceType !== "periastron") return null;
  const referenceTimeJd = finiteFact(facts.ephemeris_reference_time_jd);
  const periodDays = finiteFact(facts.ephemeris_period_days);
  if (referenceTimeJd === null || periodDays === null || periodDays <= 0) return null;
  if (referenceType === "periastron" && finiteFact(facts.ephemeris_argument_of_periastron_deg) === null) return null;
  return {
    referenceType,
    referenceTimeJd,
    referenceTimeSigmaDays: symmetricSigma(facts, "ephemeris_reference_time_jd"),
    periodDays,
    periodSigmaDays: symmetricSigma(facts, "ephemeris_period_days"),
    dynamicalTime: typeof facts.ephemeris_time_system === "string" && /TDB|TT/i.test(facts.ephemeris_time_system),
    mixedReferences: facts.ephemeris_mixed_references === true,
  };
}

/** The larger of the two published uncertainties, or null when the archive gives none. */
function symmetricSigma(facts: Record<string, unknown>, key: string): number | null {
  const sigmas = [finiteFact(facts[`${key}_err_plus`]), finiteFact(facts[`${key}_err_minus`])]
    .filter((value): value is number => value !== null)
    .map(Math.abs);
  return sigmas.length > 0 ? Math.max(...sigmas) : null;
}

/** A value that the archive measured: present, finite, and not an upper or lower limit. */
function measuredFact(facts: Record<string, unknown>, key: string): number | null {
  const limit = finiteFact(facts[`${key}_limit`]);
  return limit !== null && limit !== 0 ? null : finiteFact(facts[key]);
}

function meanAnomalyAtTrueAnomaly(trueAnomaly: number, eccentricity: number): number {
  const eccentricAnomaly = 2 * Math.atan2(
    Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
    Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2),
  );
  return eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
}

function offsetAtEccentricAnomaly(elements: ExoplanetOrbitElements, frame: HostFrame, eccentricAnomaly: number): Vector3 {
  const towardPeriastron = elements.semiMajorAxisAu * (Math.cos(eccentricAnomaly) - elements.eccentricity);
  const alongMotion = elements.semiMajorAxisAu
    * Math.sqrt(Math.max(0, 1 - elements.eccentricity * elements.eccentricity))
    * Math.sin(eccentricAnomaly);
  const periastron = orbitDirection(elements, frame, elements.argumentOfPeriastronRad);
  const quadrature = orbitDirection(elements, frame, elements.argumentOfPeriastronRad + Math.PI / 2);
  return {
    x: towardPeriastron * periastron.x + alongMotion * quadrature.x,
    y: towardPeriastron * periastron.y + alongMotion * quadrature.y,
    z: towardPeriastron * periastron.z + alongMotion * quadrature.z,
  };
}

/** Unit vector in the orbit plane at an angle from the node: `cos(u) n + sin(u) (cos(i) m - sin(i) s)`. */
function orbitDirection(elements: ExoplanetOrbitElements, frame: HostFrame, angleFromNode: number): Vector3 {
  const alongNode = Math.cos(angleFromNode);
  const acrossNode = Math.sin(angleFromNode);
  const inSky = acrossNode * Math.cos(elements.inclinationRad);
  const towardSun = acrossNode * Math.sin(elements.inclinationRad);
  return {
    x: alongNode * frame.n.x + inSky * frame.m.x - towardSun * frame.s.x,
    y: alongNode * frame.n.y + inSky * frame.m.y - towardSun * frame.s.y,
    z: alongNode * frame.n.z + inSky * frame.m.z - towardSun * frame.s.z,
  };
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function unit(vector: Vector3): Vector3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function normalizeRadians(value: number): number {
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function finiteFact(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
