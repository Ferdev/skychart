import { GUIDED_DEEP_SKY_KEYS } from "../atlas/atlasDefinitions";
import type { Vector3 } from "../sky/skyProjection";
import { AU_KM } from "./universeBodyGeometry";
import { messierTypeCode } from "./universeDeepSkyProfiles";

export type DeepSkyPoint = {
  key: string;
  object_type?: string | null;
  position: Vector3;
  radiusKm?: number | null;
  /** Catalog morphology code, e.g. "Gc" (Messier) or "GCl" (OpenNGC). */
  deepSkyType?: string | null;
};

export type DeepSkyKind = "spiral" | "elliptical" | "irregular" | "diffuse" | "shell" | "ring" | "globular" | "open" | "active";
export type DeepSkyModel = { kind: DeepSkyKind; radiusAu: number; schematicSize: boolean };
export { makeDeepSkyCloud } from "./universeCloudGeometry";
export type { CloudParticle } from "./universeCloudGeometry";

const GUIDED_KEYS = new Set(GUIDED_DEEP_SKY_KEYS);
const LY_KM = 9_460_730_472_580.8;
const SCHEMATIC_ACTIVE_GALAXY_RADIUS_KM = 50_000 * LY_KM;

/** Catalog morphology codes (Messier and OpenNGC) with an illustrative form.
 * Pairs, groups, asterisms and unclassified records stay catalog symbols. */
const TYPE_KINDS: Record<string, DeepSkyKind> = {
  Gc: "globular", GCl: "globular", Oc: "open", OCl: "open", Sp: "spiral", Ba: "spiral", El: "elliptical", Ln: "elliptical",
  Ir: "irregular", Di: "diffuse", Neb: "diffuse", HII: "diffuse", RfN: "diffuse", EmN: "diffuse", "Cl+N": "diffuse",
  Pl: "ring", PN: "ring", Sn: "shell", SNR: "shell",
};

/** Deep-sky objects with a catalog morphology and a size derived from their
 * angular extent and distance get illustrative structure. Guided highlights
 * also fall back to their broad object type, and guided active galaxies
 * without a reported size use a schematic radius. */
export function deepSkyModel(point: DeepSkyPoint): DeepSkyModel | null {
  const guided = GUIDED_KEYS.has(point.key);
  const kind = modelKind(point, guided);
  if (!kind) return null;
  const measured = typeof point.radiusKm === "number" && Number.isFinite(point.radiusKm) && point.radiusKm > 0;
  if (!measured && !(guided && kind === "active")) return null;
  return { kind, radiusAu: (measured ? point.radiusKm! : SCHEMATIC_ACTIVE_GALAXY_RADIUS_KM) / AU_KM,
    schematicSize: !measured };
}

function modelKind(point: DeepSkyPoint, guided: boolean): DeepSkyKind | null {
  if (point.key === "m1") return "shell";
  if (point.key === "m57") return "ring";
  if (point.key === "m13") return "globular";
  if (point.key === "m45") return "open";
  if (point.key === "m16") return "diffuse";
  if (point.key === "m82") return "irregular";
  if (point.key === "m87" || point.key === "simbad-m-87") return "elliptical";
  if (point.key === "m77") return "active";
  const typed = TYPE_KINDS[point.deepSkyType || messierTypeCode(point.key) || ""];
  if (typed) return typed;
  if (!guided) return null;
  if (point.object_type === "active_galaxy") return "active";
  if (point.object_type === "galaxy") return "spiral";
  if (point.object_type === "nebula") return "diffuse";
  if (point.object_type === "star_cluster") return "open";
  return null;
}
