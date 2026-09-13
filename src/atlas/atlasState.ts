import type { Body, CatalogSummary, Ephemeris } from "./contracts";
import type { DisplayLayer } from "../viewState";

export function createDefaultDisplayLayers(): Record<DisplayLayer, boolean> {
  return {
    labels: true,
    orbits: true,
    grid: true,
    constellations: false,
    milkyWay: true,
    milkyWayArms: true,
    milkyWayDust: true,
    milkyWayGuides: true,
    references: true,
  };
}

export function catalogSummaryFromEphemeris(payload: Ephemeris): CatalogSummary | null {
  if (!payload.catalog?.object_count) return null;
  return {
    object_count: payload.catalog.object_count,
    group_counts: payload.catalog.group_counts,
  };
}

export function mergeBodyList(primaryBodies: readonly Body[], fallbackBodies: readonly Body[]): Body[] {
  const merged = new Map(primaryBodies.map((body) => [body.key, body]));
  for (const body of fallbackBodies) {
    const existing = merged.get(body.key);
    if (!existing || (existing.catalog?.preview && !body.catalog?.preview)) merged.set(body.key, body);
  }
  return Array.from(merged.values());
}
