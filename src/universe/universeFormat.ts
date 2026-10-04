import { AU_KM } from "./universeBodyGeometry.ts";

/** Speed of light in AU per second. */
export const LIGHT_SPEED_AU_S = 299_792.458 / AU_KM;
/** Decimal exponents at the two ends of the speed gauge, in AU per second. */
export const SPEED_GAUGE_MIN = -9;
export const SPEED_GAUGE_MAX = 16;

const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

export function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
}

export function formatCoordinate(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0 AU";
  if (magnitude < 1e4) return `${formatNumber(value)} AU`;
  return `${formatNumber(value / 63_241.077)} ly`;
}

export function formatDistanceAu(value: number): string {
  if (value < 0.01) return `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value * AU_KM)} km`;
  if (value < 10_000) return `${formatNumber(value)} AU`;
  const lightYears = value / 63_241.077;
  if (Math.abs(lightYears) < 1e3) return `${formatNumber(lightYears)} ly`;
  if (Math.abs(lightYears) < 1e6) return `${formatNumber(lightYears / 1e3)} kly`;
  if (Math.abs(lightYears) < 1e9) return `${formatNumber(lightYears / 1e6)} Mly`;
  return `${formatNumber(lightYears / 1e9)} Gly`;
}

/** A speed as a multiple of the speed of light, e.g. "499 c" or "3.2×10⁸ c". */
export function formatLightSpeeds(speedAuPerSecond: number): string {
  const ratio = speedAuPerSecond / LIGHT_SPEED_AU_S;
  if (!(ratio > 0)) return "0 c";
  if (ratio >= 1e-3 && ratio < 1e6) return `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(ratio)} c`;
  // toExponential rounds the mantissa and carries into the exponent together.
  const [mantissa, exponent] = ratio.toExponential(1).split("e") as [string, string];
  const digits = [...exponent.replace(/[+-]/, "")].map((digit) => SUPERSCRIPTS[Number(digit)]).join("");
  return `${mantissa}×10${exponent.startsWith("-") ? "⁻" : ""}${digits} c`;
}

/** Speed readout: physical units plus the multiple of light speed. */
export function formatSpeed(speedAuPerSecond: number): string {
  return `${formatDistanceAu(speedAuPerSecond)}/s · ${formatLightSpeeds(speedAuPerSecond)}`;
}

export function formatDuration(seconds: number): string {
  const format = (value: number, unit: string) => `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value)} ${unit}`;
  if (seconds < 3_600) return format(seconds / 60, "min");
  if (seconds < 172_800) return format(seconds / 3_600, "h");
  const days = seconds / 86_400;
  if (days < 730) return format(days, "d");
  const years = days / 365.25;
  if (years < 1e4) return format(years, "yr");
  return years < 1e7 ? format(years / 1e3, "kyr") : format(years / 1e6, "Myr");
}

/** Position of a speed along the logarithmic gauge, from 0 (at rest or below
 * the scale) to 1. */
export function speedGaugeFraction(speedAuPerSecond: number): number {
  if (!(speedAuPerSecond > 0)) return 0;
  return Math.min(1, Math.max(0, (Math.log10(speedAuPerSecond) - SPEED_GAUGE_MIN) / (SPEED_GAUGE_MAX - SPEED_GAUGE_MIN)));
}
