import type { Body } from "./atlas/contracts";
import { formatCount as formatQuantityCount, formatLightYears as formatQuantityLightYears, formatQuantity } from "./format/quantity.ts";

export function uniqueTextValues(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}

export function uniquePairs(entries: readonly [string, string][]) {
  const seen = new Set<string>();
  return entries.filter(([label, value]) => {
    const key = `${label.toLowerCase()}:${value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Words that catalogs write in capitals. The inspector shows them this way in source names and identifier names. */
const CATALOG_ACRONYMS = [
  "SPICE", "SPK", "JPL", "NAIF", "SIMBAD", "NGC", "IC", "DESI", "SDSS", "ESA", "NASA", "SBDB", "TAP", "NED", "CDS",
  "HEASARC", "IPAC", "SPIDERS", "BOSS", "TESS", "TOI", "KOI", "TIC", "HIP", "HD", "XMM", "ID", "OID", "RA", "UTC", "TDB",
];
const CATALOG_ACRONYM_PATTERN = new RegExp(`\\b(${CATALOG_ACRONYMS.join("|")})\\b`, "gi");

/**
 * Changes a catalog code such as `spice_spk` or `desi_dr1_tile` into words: `SPICE SPK`, `DESI DR1 Tile`.
 * Data release and ephemeris numbers keep their capitals (`DR3`, `DE440s`).
 */
export function readableCatalogWords(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(CATALOG_ACRONYM_PATTERN, (word) => word.toUpperCase())
    .replace(/\b(Dr|De)(\d+)/g, (_match, prefix: string, digits: string) => `${prefix.toUpperCase()}${digits}`);
}

export function identifierLabel(key: string) {
  return readableCatalogWords(key.replace(/spkid/gi, "spk-id"));
}

export function identifierValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A measured value with no unit. See `format/quantity.ts` for the number rule. */
export function formatNumber(value: number) { return formatQuantity(value); }

export function formatLightYears(value: number) { return formatQuantityLightYears(value); }

/** A count for a small space: all digits below 100,000, and the short form ("2.33M") above. */
export function formatCount(value: number) {
  return formatQuantityCount(value, { compact: value >= 100_000, maximumFractionDigits: value >= 1_000_000 ? 2 : 1 });
}

export function formatInteger(value: number) { return formatQuantityCount(value); }

export function formatRatio(value: number) { return formatQuantity(value); }

export function bodyDistanceKm(left: Body, right: Body, auKm: number) {
  return Math.hypot(
    left.position.x_au - right.position.x_au,
    left.position.y_au - right.position.y_au,
    left.position.z_au - right.position.z_au,
  ) * auKm;
}

export function shortBodyName(name: string) { return name.replace(/^M(\d+)\s+/, "M$1 "); }

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
