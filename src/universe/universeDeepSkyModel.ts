import { GUIDED_DEEP_SKY_KEYS } from "../atlas/atlasDefinitions";
import type { Vector3 } from "../sky/skyProjection";
import { AU_KM } from "./universeBodyGeometry";

export type DeepSkyPoint = {
  key: string;
  object_type?: string | null;
  position: Vector3;
  radiusKm?: number | null;
};

export type DeepSkyKind = "spiral" | "elliptical" | "irregular" | "diffuse" | "shell" | "ring" | "globular" | "open" | "active";
export type DeepSkyModel = { kind: DeepSkyKind; radiusAu: number; schematicSize: boolean };
export { makeDeepSkyCloud } from "./universeCloudGeometry";
export type { CloudParticle } from "./universeCloudGeometry";

const GUIDED_KEYS = new Set(GUIDED_DEEP_SKY_KEYS);
const LY_KM = 9_460_730_472_580.8;
const SCHEMATIC_ACTIVE_GALAXY_RADIUS_KM = 50_000 * LY_KM;

/** Only guided, distance-qualified objects get illustrative structure. */
export function deepSkyModel(point: DeepSkyPoint): DeepSkyModel | null {
  if (!GUIDED_KEYS.has(point.key)) return null;
  const kind = modelKind(point);
  if (!kind) return null;
  const measured = typeof point.radiusKm === "number" && Number.isFinite(point.radiusKm) && point.radiusKm > 0;
  if (!measured && kind !== "active") return null;
  return { kind, radiusAu: (measured ? point.radiusKm! : SCHEMATIC_ACTIVE_GALAXY_RADIUS_KM) / AU_KM,
    schematicSize: !measured };
}

function modelKind(point: DeepSkyPoint): DeepSkyKind | null {
  if (point.key === "m1") return "shell";
  if (point.key === "m57") return "ring";
  if (point.key === "m13") return "globular";
  if (point.key === "m45") return "open";
  if (point.key === "m16") return "diffuse";
  if (point.key === "m82") return "irregular";
  if (point.key === "m87" || point.key === "simbad-m-87") return "elliptical";
  if (point.key === "m77" || point.object_type === "active_galaxy") return "active";
  if (point.object_type === "galaxy") return "spiral";
  if (point.object_type === "nebula") return "diffuse";
  if (point.object_type === "star_cluster") return "open";
  return null;
}
