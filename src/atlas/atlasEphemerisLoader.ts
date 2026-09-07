import { STARTUP_EPHEMERIS_GROUPS } from "./atlasDefinitions";
import { mergeBodyList } from "./atlasState";
import type { Body, Ephemeris } from "./contracts";
import { resolveSmallBodyPosition } from "../catalog/smallBodyPropagation";
import { spacecraftBodies } from "../catalog/spacecraftCatalog";

export async function loadAtlasEphemeris(
  timestampIso: string | undefined,
  preservedBodies: readonly Body[],
  onParse: () => void,
): Promise<{ payload: Ephemeris; bodies: Body[] }> {
  const query = new URLSearchParams();
  query.set("groups", STARTUP_EPHEMERIS_GROUPS.join(","));
  if (timestampIso) query.set("timestamp", timestampIso);
  const response = await fetch(`/api/ephemeris?${query.toString()}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  onParse();
  const payload = (await response.json()) as Ephemeris;
  const earth = payload.bodies.find((body) => body.key === "earth");
  // Spacecraft start with fresh dated metadata; the progressive loader supplies
  // their positions. Carrying a previous position across dates would be invalid.
  const propagatedBodies = await Promise.all(preservedBodies
    .filter((body) => body.object_type !== "spacecraft")
    .map((body) => resolveSmallBodyPosition(body, payload.timestamp_utc, payload.au_km, earth)));
  const bodies = mergeBodyList([...payload.bodies, ...spacecraftBodies(payload.timestamp_utc)], propagatedBodies);
  return { payload, bodies };
}
