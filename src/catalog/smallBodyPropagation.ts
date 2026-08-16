import type { Body } from "../atlas/contracts";

const JULIAN_DAY_UNIX_EPOCH = 2_440_587.5;
const MILLISECONDS_PER_DAY = 86_400_000;

export type SmallBodyPosition = {
  xAu: number;
  yAu: number;
  zAu: number;
};

/**
 * Propagates a heliocentric small body from its JPL osculating elements.
 *
 * This intentionally matches the two-body model used to generate the catalog:
 * it makes time travel responsive without implying mission-grade N-body accuracy.
 */
export function smallBodyPositionAt(
  facts: Record<string, unknown>,
  timestamp: string,
): SmallBodyPosition | null {
  const targetMilliseconds = Date.parse(timestamp);
  if (!Number.isFinite(targetMilliseconds)) return null;

  const eccentricity = finiteFact(facts.eccentricity);
  const semiMajorAxisAu = finiteFact(facts.semi_major_axis_au);
  const epochJulianDay = finiteFact(facts.epoch_jd_tdb);
  const meanAnomalyDegrees = finiteFact(facts.mean_anomaly_deg);
  const meanMotionDegreesPerDay = finiteFact(facts.mean_motion_deg_day);
  const inclinationDegrees = finiteFact(facts.inclination_deg);
  const ascendingNodeDegrees = finiteFact(facts.ascending_node_deg);
  const argumentOfPerihelionDegrees = finiteFact(facts.argument_of_perihelion_deg);

  if (
    eccentricity === null || semiMajorAxisAu === null || epochJulianDay === null
    || meanAnomalyDegrees === null || meanMotionDegreesPerDay === null
    || inclinationDegrees === null || ascendingNodeDegrees === null
    || argumentOfPerihelionDegrees === null
    || eccentricity < 0 || eccentricity >= 1 || semiMajorAxisAu <= 0
  ) return null;

  const targetJulianDay = targetMilliseconds / MILLISECONDS_PER_DAY + JULIAN_DAY_UNIX_EPOCH;
  const meanAnomaly = normalizeRadians(degreesToRadians(
    meanAnomalyDegrees + meanMotionDegreesPerDay * (targetJulianDay - epochJulianDay),
  ));
  const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity);
  const orbitalX = semiMajorAxisAu * (Math.cos(eccentricAnomaly) - eccentricity);
  const orbitalY = semiMajorAxisAu
    * Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity))
    * Math.sin(eccentricAnomaly);

  const ascendingNode = degreesToRadians(ascendingNodeDegrees);
  const perihelion = degreesToRadians(argumentOfPerihelionDegrees);
  const inclination = degreesToRadians(inclinationDegrees);
  const cosNode = Math.cos(ascendingNode);
  const sinNode = Math.sin(ascendingNode);
  const cosPerihelion = Math.cos(perihelion);
  const sinPerihelion = Math.sin(perihelion);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);

  return {
    xAu:
      (cosNode * cosPerihelion - sinNode * sinPerihelion * cosInclination) * orbitalX
      + (-cosNode * sinPerihelion - sinNode * cosPerihelion * cosInclination) * orbitalY,
    yAu:
      (sinNode * cosPerihelion + cosNode * sinPerihelion * cosInclination) * orbitalX
      + (-sinNode * sinPerihelion + cosNode * cosPerihelion * cosInclination) * orbitalY,
    zAu: sinPerihelion * sinInclination * orbitalX
      + cosPerihelion * sinInclination * orbitalY,
  };
}

/** Returns a copy at the requested epoch when a body has usable heliocentric elements. */
export function propagateSmallBody(
  body: Body,
  timestamp: string,
  auKm: number,
  earth?: Body,
): Body {
  if (body.catalog_group !== "jpl_small_bodies" || body.parent_key !== "sun") return body;
  const facts = body.catalog?.facts;
  if (!facts) return body;
  const propagated = smallBodyPositionAt(facts, timestamp);
  if (!propagated) return body;

  const xKm = propagated.xAu * auKm;
  const yKm = propagated.yAu * auKm;
  const zKm = propagated.zAu * auKm;
  const earthPosition = earth?.position;

  return {
    ...body,
    catalog: body.catalog ? { ...body.catalog, dynamic_position: true } : body.catalog,
    position: {
      x_au: propagated.xAu,
      y_au: propagated.yAu,
      z_au: propagated.zAu,
      x_km: xKm,
      y_km: yKm,
      z_km: zKm,
      heliocentric_distance_km: Math.hypot(xKm, yKm, zKm),
    },
    distance_from_earth_km: earthPosition
      ? Math.hypot(
          propagated.xAu - earthPosition.x_au,
          propagated.yAu - earthPosition.y_au,
          propagated.zAu - earthPosition.z_au,
        ) * auKm
      : body.distance_from_earth_km,
  };
}

function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const delta = (
      eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly
    ) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return eccentricAnomaly;
}

function normalizeRadians(value: number): number {
  const fullTurn = 2 * Math.PI;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function finiteFact(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
