import contract from "../backend_phoenix/priv/catalog_coordinate_contract.json" with { type: "json" };
const DEG_PER_HOUR = 15;
const RA_HOURS_PER_CIRCLE = 24;
const FULL_CIRCLE_DEG = 360;
const J2000_NORTH_GALACTIC_POLE_RA_DEG = 192.85948;
const J2000_NORTH_GALACTIC_POLE_DEC_DEG = 27.12825;
const J2000_GALACTIC_ASCENDING_NODE_DEG = 32.93192;
const J2000_MEAN_OBLIQUITY_DEG = contract.obliquity_deg;

export type EquatorialCoordinates = {
  raDeg: number;
  decDeg: number;
};

export type GalacticCoordinates = {
  longitudeDeg: number;
  latitudeDeg: number;
};

export type EclipticSphericalCoordinates = {
  longitudeDeg: number;
  latitudeDeg: number;
  radiusAu: number;
};

/** Unit direction only: this vector has no physical distance or parallax. */
export function equatorialToEclipticDirection(raDeg: number | null | undefined, decDeg: number | null | undefined) {
  if (typeof raDeg !== "number" || typeof decDeg !== "number"
    || !Number.isFinite(raDeg) || !Number.isFinite(decDeg)
    || raDeg < 0 || raDeg >= 360 || decDeg < -90 || decDeg > 90) return null;
  const ra = toRadians(raDeg), dec = toRadians(decDeg);
  const e = toRadians(J2000_MEAN_OBLIQUITY_DEG);
  const y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  return { x: Math.cos(dec) * Math.cos(ra), y: y * Math.cos(e) + z * Math.sin(e), z: -y * Math.sin(e) + z * Math.cos(e) };
}

export function formatRightAscension(raDeg: number): string {
  if (!Number.isFinite(raDeg)) return "";
  const totalSeconds = Math.round((normalizeDegrees(raDeg) / DEG_PER_HOUR) * 3600);
  const hours = Math.floor(totalSeconds / 3600) % RA_HOURS_PER_CIRCLE;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function formatDeclination(decDeg: number): string {
  if (!Number.isFinite(decDeg)) return "";
  const sign = decDeg < 0 ? "−" : "+";
  const absoluteDegrees = Math.abs(decDeg);
  const totalSeconds = Math.round(absoluteDegrees * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${pad(degrees)}° ${pad(minutes)}′ ${pad(seconds)}″`;
}

export function formatDecimalDegrees(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return "";
  return `${value.toFixed(digits)}°`;
}

export function equatorialToGalactic({ raDeg, decDeg }: EquatorialCoordinates): GalacticCoordinates | null {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;

  const ra = toRadians(normalizeDegrees(raDeg));
  const dec = toRadians(decDeg);
  const poleRa = toRadians(J2000_NORTH_GALACTIC_POLE_RA_DEG);
  const poleDec = toRadians(J2000_NORTH_GALACTIC_POLE_DEC_DEG);
  const ascendingNode = J2000_GALACTIC_ASCENDING_NODE_DEG;

  const sinB = Math.sin(dec) * Math.sin(poleDec) + Math.cos(dec) * Math.cos(poleDec) * Math.cos(ra - poleRa);
  const latitudeDeg = toDegrees(Math.asin(clamp(sinB, -1, 1)));

  const y = Math.sin(dec) * Math.cos(poleDec) - Math.cos(dec) * Math.sin(poleDec) * Math.cos(ra - poleRa);
  const x = Math.cos(dec) * Math.sin(ra - poleRa);
  const longitudeDeg = normalizeDegrees(ascendingNode + toDegrees(Math.atan2(y, x)));

  return { longitudeDeg, latitudeDeg };
}

export function eclipticCartesianToSpherical(xAu: number, yAu: number, zAu: number): EclipticSphericalCoordinates | null {
  if (!Number.isFinite(xAu) || !Number.isFinite(yAu) || !Number.isFinite(zAu)) return null;
  const radiusAu = Math.hypot(xAu, yAu, zAu);
  if (radiusAu <= 0) return null;
  return {
    longitudeDeg: normalizeDegrees(toDegrees(Math.atan2(yAu, xAu))),
    latitudeDeg: toDegrees(Math.asin(clamp(zAu / radiusAu, -1, 1))),
    radiusAu
  };
}

export function eclipticCartesianToEquatorial(xAu: number, yAu: number, zAu: number): EquatorialCoordinates | null {
  if (!Number.isFinite(xAu) || !Number.isFinite(yAu) || !Number.isFinite(zAu)) return null;
  const radiusAu = Math.hypot(xAu, yAu, zAu);
  if (radiusAu <= 0) return null;

  const obliquity = toRadians(J2000_MEAN_OBLIQUITY_DEG);
  const equatorialY = yAu * Math.cos(obliquity) - zAu * Math.sin(obliquity);
  const equatorialZ = yAu * Math.sin(obliquity) + zAu * Math.cos(obliquity);
  return {
    raDeg: normalizeDegrees(toDegrees(Math.atan2(equatorialY, xAu))),
    decDeg: toDegrees(Math.asin(clamp(equatorialZ / radiusAu, -1, 1)))
  };
}

export function normalizeDegrees(value: number): number {
  return ((value % FULL_CIRCLE_DEG) + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
