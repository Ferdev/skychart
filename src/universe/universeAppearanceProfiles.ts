import type { PhysicalBody } from "./universeBodyGeometry.ts";

export type BodyAppearance = {
  material: number; map?: string; detail?: string; tilt: number; phase: number;
  atmosphere: number; relief: number; color: [number, number, number];
};

const MAPS = new Set(["mercury", "venus", "earth", "mars", "saturn", "uranus", "neptune",
  "moon", "io", "europa", "ganymede", "callisto", "phobos", "deimos", "mimas", "enceladus", "tethys", "dione", "rhea", "iapetus"]);
// Approximate obliquities only. Pole longitude and texture phase are illustrative,
// fixed in this ecliptic frame; these are not a rotational ephemeris.
const TILTS: Record<string, number> = { earth: 23.44, mars: 25.19, jupiter: 3.13,
  saturn: 26.73, uranus: 97.77, neptune: 28.32, venus: 177.36, moon: 1.54 };
const COLORS: Record<string, string> = { sun: "#fff0d2", earth: "#34649c", mars: "#b07654",
  jupiter: "#ceae8b", saturn: "#c8b888", venus: "#e2cda2", uranus: "#9dcacd", neptune: "#7696bc" };
const ROOT = "/textures/universe/";
/** One neutral matte material for each exoplanet. No surface is selected from the mass or the temperature. */
export const EXOPLANET_MATERIAL = 9;
export const EXOPLANET_COLOR = "#8f8f8f";

export function bodyAppearance(body: PhysicalBody): BodyAppearance {
  // The rule is by catalog group. A key, a color, or a temperature gives an exoplanet no surface.
  if (body.catalog_group === "exoplanets") {
    return { material: EXOPLANET_MATERIAL, tilt: 0, phase: 0, atmosphere: 0, relief: 0, color: parseBodyColor(EXOPLANET_COLOR) };
  }
  const star = body.key === "sun" || body.object_type === "star";
  const small = ["asteroid", "small_body", "comet"].includes(body.object_type ?? "") || ["phobos", "deimos"].includes(body.key);
  const material = star ? 0 : body.key === "jupiter" ? 1 : body.key === "saturn" ? 2
    : body.key === "earth" ? 3 : body.key === "mars" ? 4 : ["uranus", "neptune"].includes(body.key) ? 5
      : body.key === "venus" || body.key === "titan" ? 6 : small ? 8 : 7;
  const color = star && body.key !== "sun" && Number.isFinite(body.temperatureK) && Number(body.temperatureK) > 0
    ? stellarDisplayColor(Number(body.temperatureK)) : parseBodyColor(COLORS[body.key] ?? body.color ?? (small ? "#82786d" : "#aaaaaa"));
  return { material, map: body.key === "jupiter" ? `${ROOT}jupiter.png` : MAPS.has(body.key) ? `${ROOT}${body.key}.jpg` : undefined,
    detail: body.key === "earth" ? `${ROOT}earth-clouds.jpg` : body.key === "moon" ? `${ROOT}moon-height.jpg` : undefined,
    tilt: TILTS[body.key] ?? 0, phase: body.key === "jupiter" ? 0.8 : body.key === "earth" ? 0.8 : 0,
    atmosphere: body.key === "earth" ? 1 : body.key === "venus" || body.key === "titan" ? 0.45 : body.key === "mars" ? 0.13 : 0,
    relief: body.key === "moon" ? 0.11 : material === 7 || material === 8 ? 0.13 : material === 4 ? 0.055 : 0, color };
}

/** A display tint from catalog temperature, not a spectral/exposure model. */
export function stellarDisplayColor(kelvin: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (Math.log(Math.max(1500, kelvin)) - Math.log(1500)) / Math.log(40000 / 1500)));
  const warm = [1, .58, .32], neutral = [1, .96, .88], cool = [.67, .8, 1];
  const split = Math.log(5800 / 1500) / Math.log(40000 / 1500);
  const a = t < split ? warm : neutral, b = t < split ? neutral : cool;
  const weight = t < split ? t / split : (t - split) / (1 - split);
  return a.map((value, i) => value + (b[i]! - value) * weight) as [number, number, number];
}

export function parseBodyColor(value: string): [number, number, number] {
  const rgb = /^#[0-9a-f]{6}$/i.test(value)
    ? [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
    : value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return rgb?.length === 3 ? rgb.map((channel) => Math.max(0, Math.min(255, channel)) / 255) as [number, number, number]
    : [0.67, 0.67, 0.67];
}

/** Column-major world-to-material rotation, shared by the GPU and fallback. */
export function appearanceRotation(profile: BodyAppearance): Float32Array {
  const a = profile.tilt * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const p = Math.cos(profile.phase), q = Math.sin(profile.phase);
  const azimuth = 1.1, ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  return new Float32Array([p*c*ca-q*sa, -q*c*ca-p*sa, s*ca,
    p*c*sa+q*ca, -q*c*sa+p*ca, s*sa, -p*s, q*s, c]);
}

/** Continuous marker/model transition, with complementary opacity. */
export function resolvedBodyWeight(radiusPx: number): number {
  const t = Math.max(0, Math.min(1, (radiusPx - 1.5) / 4.5));
  return t * t * (3 - 2 * t);
}
