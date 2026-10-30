/**
 * The browser side of the night planner: the site, the request, and the geometry of a result row.
 * The site stays in this browser and in the body of the request. It is not in an address or an analytics event.
 * This module must not import `i18n.ts`, so that node tests can import it.
 */
import { directionFromEquatorial } from "../coordinates.ts";
import type { Vector3 } from "./skyProjection.ts";

export const PLANNER_SITE_KEY = "cosmic-atlas:planner-site";

export type PlannerSite = { latitude: number; longitude: number };
export type PlannerFilters = {
  type: string;
  minAltitude: number;
  maxMagnitude: number | null;
  minSize: number | null;
  maxSize: number | null;
};
export type PlanWindow = { start_utc: string; end_utc: string };
export type PlanTarget = {
  key: string;
  name: string;
  object_type: string;
  constellation: string | null;
  catalog: string;
  ra_deg: number;
  dec_deg: number;
  magnitude: number | null;
  size_arcmin: number | null;
  minutes_above: number;
  windows: PlanWindow[];
  best_utc: string;
  best_altitude_deg: number;
  moon_separation_deg: number;
};
export type NightPlan = {
  date: string;
  min_altitude_deg: number;
  darkness: "astronomical" | "nautical" | "civil" | "sunset" | "none";
  window: PlanWindow | null;
  moon: { illuminated_fraction: number; windows: PlanWindow[] } | null;
  total: number;
  targets: PlanTarget[];
  accuracy_note: string;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A decimal number with a point or a comma. An empty field is not a number. */
export function parseCoordinate(value: string): number {
  const text = value.trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

export function validSite(site: PlannerSite): boolean {
  return Number.isFinite(site.latitude) && Math.abs(site.latitude) <= 90
    && Number.isFinite(site.longitude) && Math.abs(site.longitude) <= 180;
}

export function readSite(store: Store): PlannerSite | null {
  try {
    const site = JSON.parse(store.getItem(PLANNER_SITE_KEY) ?? "null") as PlannerSite | null;
    return site && validSite(site) ? { latitude: site.latitude, longitude: site.longitude } : null;
  } catch {
    return null;
  }
}

export function writeSite(store: Store, site: PlannerSite): void {
  try { store.setItem(PLANNER_SITE_KEY, JSON.stringify(site)); } catch { /* Private windows can refuse storage. */ }
}

export function forgetSite(store: Store): void {
  try { store.removeItem(PLANNER_SITE_KEY); } catch { /* Private windows can refuse storage. */ }
}

/** The calendar date of the evening: before noon the night that is in progress began on the day before. */
export function defaultNight(now: Date): string {
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < 12 ? 1 : 0));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(evening.getFullYear()).padStart(4, "0")}-${pad(evening.getMonth() + 1)}-${pad(evening.getDate())}`;
}

export function planRequest(site: PlannerSite, date: string, filters: PlannerFilters): Record<string, unknown> {
  return {
    latitude_deg: site.latitude,
    longitude_deg: site.longitude,
    date,
    min_altitude_deg: filters.minAltitude,
    ...(filters.type ? { types: [filters.type] } : {}),
    ...(filters.maxMagnitude === null ? {} : { max_magnitude: filters.maxMagnitude }),
    ...(filters.minSize === null ? {} : { min_size_arcmin: filters.minSize }),
    ...(filters.maxSize === null ? {} : { max_size_arcmin: filters.maxSize }),
  };
}

/** The place of a time window on the bar of the night, in percent of the night. */
export function barSegments(night: PlanWindow, windows: readonly PlanWindow[]): { left: number; width: number }[] {
  const start = Date.parse(night.start_utc);
  const length = Date.parse(night.end_utc) - start;
  if (!(length > 0)) return [];
  return windows.map((window) => {
    const left = (Date.parse(window.start_utc) - start) / length * 100;
    return { left, width: (Date.parse(window.end_utc) - start) / length * 100 - left };
  });
}

/** The Sky view direction of a J2000 catalog position. */
export function targetDirection(target: Pick<PlanTarget, "ra_deg" | "dec_deg">): Vector3 {
  return directionFromEquatorial(target.ra_deg, target.dec_deg);
}
