import type { Body, CatalogSummary, Ephemeris } from "./contracts";
import type { DisplayLayer } from "../viewState";

export function createDefaultDisplayLayers(): Record<DisplayLayer, boolean> {
  return {
    photos: false,
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

/** Reads the catalog counts from the semantic index. Returns null when the service is not available. */
export async function fetchCatalogSummary(): Promise<CatalogSummary | null> {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`Catalog summary failed with ${response.status}`);
    return (await response.json()) as CatalogSummary;
  } catch (error) {
    console.warn("Phoenix catalog summary unavailable.", error);
    return null;
  }
}

export function mergeBodyList(primaryBodies: readonly Body[], fallbackBodies: readonly Body[]): Body[] {
  const merged = new Map(primaryBodies.map((body) => [body.key, body]));
  for (const body of fallbackBodies) {
    const existing = merged.get(body.key);
    if (!existing || (existing.catalog?.preview && !body.catalog?.preview)) merged.set(body.key, body);
  }
  return Array.from(merged.values());
}

/** Replaces dated records while preserving the current list's stable ordering. */
export function replaceBodyList(currentBodies: readonly Body[], replacements: readonly Body[]): Body[] {
  const replaced = new Map(currentBodies.map((body) => [body.key, body]));
  for (const body of replacements) replaced.set(body.key, body);
  return Array.from(replaced.values());
}
