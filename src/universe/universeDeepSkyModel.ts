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
export type CloudParticle = { x: number; y: number; z: number; color: string; opacity: number; size: number };

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

/** Stable particles in object-local 3D space; tilt/depth are illustrative, not measured. */
export function makeDeepSkyCloud(key: string, kind: DeepSkyKind): CloudParticle[] {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const count = kind === "open" ? 320 : kind === "globular" ? 1800 : kind === "active" ? 2200 : 2600;
  const particles: CloudParticle[] = [];
  const tilt = 0.35 + random() * 0.6;
  const spin = random() * Math.PI * 2;
  const lean = 0.65 + random() * 0.45;
  for (let index = 0; index < count; index += 1) {
    let x = 0, y = 0, z = 0;
    const u = random(), v = random(), w = random();
    if (kind === "spiral" || kind === "active") {
      if (kind === "active" && index > count * 0.95) {
        z = (random() < 0.5 ? -1 : 1) * (0.15 + random() * 0.85);
        x = (random() - 0.5) * (0.05 + Math.abs(z) * 0.12);
        y = (random() - 0.5) * (0.05 + Math.abs(z) * 0.12);
      } else {
        const bulge = u < 0.22;
        const radius = bulge ? Math.pow(v, 1.8) * 0.34 : Math.sqrt(v);
        const arm = index % 2;
        const angle = bulge ? random() * Math.PI * 2 : arm * Math.PI + radius * 5.0 + (random() - 0.5) * 0.8;
        x = radius * Math.cos(angle);
        y = radius * Math.sin(angle);
        z = (random() - 0.5) * (bulge ? 0.3 : 0.08);
      }
    } else if (kind === "ring") {
      const angle = u * Math.PI * 2;
      const tube = 0.13 * Math.sqrt(v);
      const cross = w * Math.PI * 2;
      x = (0.7 + tube * Math.cos(cross)) * Math.cos(angle);
      y = (0.7 + tube * Math.cos(cross)) * Math.sin(angle);
      z = tube * Math.sin(cross) * 1.4;
    } else {
      const angle = u * Math.PI * 2;
      const latitude = Math.acos(2 * v - 1);
      const radius = kind === "shell" ? 0.68 + (w - 0.5) * 0.32
        : kind === "globular" ? Math.pow(w, 2.1)
          : kind === "elliptical" ? Math.pow(w, 1.45)
            : kind === "open" ? Math.pow(w, 0.8) : Math.pow(w, 0.6);
      x = radius * Math.sin(latitude) * Math.cos(angle);
      y = radius * Math.sin(latitude) * Math.sin(angle);
      z = radius * Math.cos(latitude);
      if (kind === "elliptical") { y *= 0.75; z *= 0.55; }
      if (kind === "irregular" || kind === "diffuse") {
        x += 0.14 * Math.sin(y * 11 + seed * 0.000001);
        z *= 0.7;
      }
    }
    // A fixed object-local rotation makes parallax visible during a fly-around.
    const turnedX = x * Math.cos(spin) - y * Math.sin(spin);
    const turnedY = x * Math.sin(spin) + y * Math.cos(spin);
    const rotatedY = turnedY * Math.cos(tilt) - z * Math.sin(tilt);
    const rotatedZ = turnedY * Math.sin(tilt) + z * Math.cos(tilt);
    const palette = particlePalette(kind, index, random());
    particles.push({ x: turnedX * Math.cos(lean) + rotatedZ * Math.sin(lean), y: rotatedY,
      z: rotatedZ * Math.cos(lean) - turnedX * Math.sin(lean), ...palette });
  }
  return particles;
}

function particlePalette(kind: DeepSkyKind, index: number, variation: number): Pick<CloudParticle, "color" | "opacity" | "size"> {
  if (kind === "open") return { color: variation < 0.75 ? "rgb(155,202,255)" : "rgb(245,245,226)", opacity: 0.75, size: 2.8 };
  if (kind === "globular") return { color: variation < 0.75 ? "rgb(255,224,170)" : "rgb(176,201,255)", opacity: 0.35, size: 1.8 };
  if (kind === "ring") return { color: variation < 0.6 ? "rgb(96,233,204)" : "rgb(255,155,94)", opacity: 0.4, size: 2.7 };
  if (kind === "shell") return { color: variation < 0.65 ? "rgb(245,129,93)" : "rgb(112,195,243)", opacity: 0.25, size: 3.0 };
  if (kind === "diffuse") return { color: variation < 0.65 ? "rgb(242,111,188)" : "rgb(100,204,255)", opacity: 0.18, size: 4.2 };
  if (kind === "irregular") return { color: variation < 0.65 ? "rgb(232,193,155)" : "rgb(236,120,126)", opacity: 0.24, size: 2.6 };
  if (kind === "active" && index % 19 === 0) return { color: "rgb(151,203,255)", opacity: 0.7, size: 3.2 };
  return { color: variation < 0.7 ? "rgb(255,226,177)" : "rgb(161,197,255)", opacity: 0.24, size: 2.1 };
}
