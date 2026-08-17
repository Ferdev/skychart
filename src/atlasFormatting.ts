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

export function identifierLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\bdr3\b/gi, "DR3").replace(/\bid\b/gi, "ID").replace(/\boid\b/gi, "OID").replace(/\bspkid\b/gi, "SPK-ID").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function identifierValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: "compact" }).format(value);
  if (abs >= 10_000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  if (abs >= 100) return Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  if (abs >= 1) return Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value);
}

export function formatLightYears(value: number) {
  if (value >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000)} Gly`;
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} Mly`;
  if (value >= 1_000) return `${formatNumber(value / 1_000)} kly`;
  return `${formatNumber(value)} ly`;
}

export function formatCount(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 1_000_000 ? 2 : 1, notation: value >= 100_000 ? "compact" : "standard" }).format(value);
}

export function formatInteger(value: number) { return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }

export function formatRatio(value: number) {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 1_000_000) return value.toExponential(2);
  if (value >= 1000) return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  if (value >= 100) return value.toFixed(1);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

export function shortBodyName(name: string) { return name.replace(/^M(\d+)\s+/, "M$1 "); }

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
