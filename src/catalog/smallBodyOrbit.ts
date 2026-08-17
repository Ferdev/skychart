import type { Body } from "../atlas/contracts";
import { smallBodyDesignation, smallBodyOrbitPath, type SmallBodyPosition } from "./smallBodyPropagation.ts";

const DAYS_PER_JULIAN_YEAR = 365.2568983;
const ORBIT_PATH_SAMPLES = 181;

type SmallBodyOrbitPayload = {
  points?: { x_au: number; y_au: number; z_au: number }[] | null;
};

type FetchSmallBodyOrbit = (input: string) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

const orbitCache = new Map<string, SmallBodyPosition[] | null>();
const pendingOrbitKeys = new Set<string>();

/**
 * Resolves the drawn orbit for a small body. Returns the two-body fallback
 * immediately and swaps in the JPL Horizons vector series once it arrives, so
 * the orbit line always agrees with the rendered marker near close approaches.
 */
export function smallBodyOrbitPathForBody(
  body: Body,
  timestamp: string,
  onReady: () => void,
  fetchOrbit: FetchSmallBodyOrbit = fetch,
): SmallBodyPosition[] | null {
  const facts = body.catalog?.facts;
  const fallback = facts ? smallBodyOrbitPath(facts, ORBIT_PATH_SAMPLES) : null;
  const designation = smallBodyDesignation(body);
  const periodDays = facts ? orbitalPeriodDays(facts) : null;
  if (!designation || periodDays === null || body.catalog_group !== "jpl_small_bodies" || body.parent_key !== "sun") {
    return fallback;
  }

  const key = `${designation}@${timestamp.slice(0, 10)}@${periodDays.toFixed(3)}`;
  const cached = orbitCache.get(key);
  if (cached !== undefined) return cached ?? fallback;
  if (pendingOrbitKeys.has(key)) return fallback;

  pendingOrbitKeys.add(key);
  const params = new URLSearchParams({ designation, period_days: periodDays.toFixed(3), around: timestamp });
  void fetchOrbit(`/api/small-body-orbit?${params.toString()}`)
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as SmallBodyOrbitPayload;
      return isPointSeries(payload.points) ? payload.points.map((point) => ({ xAu: point.x_au, yAu: point.y_au, zAu: point.z_au })) : null;
    })
    .catch((error) => {
      console.warn(`JPL Horizons orbit unavailable for ${body.name}; using orbital elements.`, error);
      return null;
    })
    .then((points) => {
      orbitCache.set(key, points);
      pendingOrbitKeys.delete(key);
      onReady();
    });
  return fallback;
}

function orbitalPeriodDays(facts: Record<string, unknown>): number | null {
  const semiMajorAxisAu = facts.semi_major_axis_au;
  if (typeof semiMajorAxisAu !== "number" || !Number.isFinite(semiMajorAxisAu) || semiMajorAxisAu <= 0) return null;
  return DAYS_PER_JULIAN_YEAR * semiMajorAxisAu ** 1.5;
}

function isPointSeries(points: SmallBodyOrbitPayload["points"]): points is { x_au: number; y_au: number; z_au: number }[] {
  return Array.isArray(points) && points.length > 1 && points.every((point) => (
    Number.isFinite(point?.x_au) && Number.isFinite(point?.y_au) && Number.isFinite(point?.z_au)
  ));
}
