import { AU_KM } from "./universeBodyGeometry.ts";
import { formatDistanceAu as formatQuantityDistanceAu, formatDuration as formatQuantityDuration, formatQuantity } from "../format/quantity.ts";

const AU_PER_LIGHT_YEAR = 63_241.077;

/** Speed of light in AU per second. */
export const LIGHT_SPEED_AU_S = 299_792.458 / AU_KM;
/** Decimal exponents at the two ends of the speed gauge, in AU per second. */
export const SPEED_GAUGE_MIN = -9;
export const SPEED_GAUGE_MAX = 16;

/** Significant digits of one coordinate of the flight position. */
const COORDINATE_DIGITS = 7;

export function formatNumber(value: number): string {
  return formatQuantity(value);
}

/** One coordinate of the flight position: AU near the Sun, light-years far from it. */
export function formatCoordinate(value: number): string {
  // A value below a millimetre is a rounding remainder, not a position.
  if (Math.abs(value) < 1e-14) return `0 AU`;
  // A position needs more digits than a measured value: a short flight near a planet must change the text.
  return Math.abs(value) < AU_PER_LIGHT_YEAR * 0.1
    ? `${formatQuantity(value, COORDINATE_DIGITS, COORDINATE_DIGITS)} AU`
    : `${formatQuantity(value / AU_PER_LIGHT_YEAR, COORDINATE_DIGITS, COORDINATE_DIGITS)} ly`;
}

export function formatDistanceAu(value: number): string {
  return formatQuantityDistanceAu(value, { auKm: AU_KM });
}

/** A speed as a multiple of the speed of light, e.g. "499 c" or "499 billion c". */
export function formatLightSpeeds(speedAuPerSecond: number): string {
  const ratio = speedAuPerSecond / LIGHT_SPEED_AU_S;
  if (!(ratio > 0)) return "0 c";
  return `${formatQuantity(ratio, 3)} c`;
}

/** Speed readout: physical units plus the multiple of light speed. */
export function formatSpeed(speedAuPerSecond: number): string {
  return `${formatDistanceAu(speedAuPerSecond)}/s · ${formatLightSpeeds(speedAuPerSecond)}`;
}

export function formatDuration(seconds: number): string {
  return formatQuantityDuration(seconds);
}

/** Position of a speed along the logarithmic gauge, from 0 (at rest or below
 * the scale) to 1. */
export function speedGaugeFraction(speedAuPerSecond: number): number {
  if (!(speedAuPerSecond > 0)) return 0;
  return Math.min(1, Math.max(0, (Math.log10(speedAuPerSecond) - SPEED_GAUGE_MIN) / (SPEED_GAUGE_MAX - SPEED_GAUGE_MIN)));
}
