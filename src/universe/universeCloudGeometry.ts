import { canonicalDeepSkyKey, deepSkyAppearance } from "./universeDeepSkyProfiles.ts";

export type DeepSkyKind = "spiral" | "elliptical" | "irregular" | "diffuse" | "shell" | "ring" | "globular" | "open" | "active";
export type CloudParticle = { x: number; y: number; z: number; color: string; opacity: number; size: number; layer: "star" | "gas" | "dust" };

/** Stable nested detail: drawing fewer particles doesn't regenerate a nebula. */
export function makeDeepSkyCloud(recordKey: string, kind: DeepSkyKind): CloudParticle[] {
  const key = canonicalDeepSkyKey(recordKey), profile = deepSkyAppearance(key);
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  const normal = () => (random() + random() + random() + random() - 2) * .8;
  const particles: CloudParticle[] = [];
  const count = kind === "open" ? 2200 : kind === "globular" ? 6500 : 5600;
  const isDisk = kind === "spiral" || kind === "active";
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0;
    let layer: CloudParticle["layer"] = "star";
    let color = profile.tint, opacity = .8, size = .004;
    const a = random() * Math.PI * 2, u = random(), v = random();
    if (isDisk) {
      const bulge = u < profile.bulge;
      const radius = bulge ? Math.pow(v, 1.6) * .35 : Math.sqrt(v) * .94;
      const arm = (i % profile.arms) * Math.PI * 2 / profile.arms;
      const angle = bulge || i % 4 === 0 ? a : arm + radius * profile.winding + normal() * .55;
      x = radius * Math.cos(angle); y = radius * Math.sin(angle); z = normal() * (bulge ? .16 : .025);
      opacity = .28;
      if (i % 5 < 2 || i % 4 === 0) { layer = "gas"; size = bulge ? .14 : .16; opacity = bulge ? .13 : .065; }
      if (!bulge) color = i % 9 === 0 ? [226, 125, 153] : [157, 190, 231];
      if (!bulge && i % 7 === 0) { layer = "dust"; opacity = .09 * profile.dust; size = .09; z += .026; color = [25, 18, 15]; }
      // Whirlpool's companion and connecting stream remain part of this one
      // illustrative distribution, not an extra positioned catalog record.
      if (key === "m51" && i % 9 === 1) {
        x = .68 + normal() * .12; y = .5 + normal() * .12; z = normal() * .06;
        color = [255, 222, 166]; layer = "gas"; size = .065; opacity = .15;
      }
      if (kind === "active" && key !== "m77" && i % 6 === 0) {
        z = (i % 12 === 0 ? 1 : -1) * Math.pow(v, .6);
        x = normal() * (.009 + Math.abs(z) * .025); y = normal() * .02;
        layer = "gas"; color = [145, 200, 245]; size = .03; opacity = .16;
      }
    } else if (kind === "globular" || kind === "elliptical") {
      const radius = Math.pow(v, kind === "globular" ? 1.6 : 2.0);
      const polar = 2 * u - 1, equator = Math.sqrt(1 - polar * polar);
      x = radius * equator * Math.cos(a); y = radius * equator * Math.sin(a); z = radius * polar;
      if (kind === "elliptical") { y *= .8; z *= .65; layer = i % 4 ? "gas" : "star"; size = .09; opacity = .07; }
      else { color = i % 7 === 0 ? [156, 185, 237] : profile.tint; size = .003 + random() * .003; }
      if (kind === "elliptical" && i % 13 === 0) {
        x = .07 + v * .75; y = x * .22 + normal() * .016; z = x * .35;
        layer = "gas"; color = [135, 186, 244]; size = .024; opacity = .32;
      }
    } else if (kind === "ring" || kind === "shell") {
      // M57 is a bright equatorial rim around an elongated, filled shell.
      const polar = u * 2 - 1, equator = Math.sqrt(1 - polar * polar);
      const radius = kind === "ring" ? .64 + normal() * .06 : .7 + normal() * .10;
      x = radius * equator * Math.cos(a); y = radius * equator * Math.sin(a);
      z = radius * polar * (kind === "ring" ? 1.25 : .8);
      layer = "gas"; size = kind === "shell" ? .025 : .06;
      opacity = kind === "ring" ? .04 + .18 * Math.pow(1 - Math.abs(polar), 6) : .12;
      if (kind === "ring") color = Math.abs(polar) < .19 ? [235, 144, 92] : [98, 195, 197];
      else {
        const filament = Math.sin(a * 11 + polar * 7) + Math.sin(a * 7 - polar * 13);
        x *= 1 + filament * .055; y *= 1 + filament * .055;
        color = i % 3 ? [244, 138, 101] : [112, 164, 195];
        if (i % 4 === 0) { x *= .6; y *= .6; z *= .6; size = .12; opacity = .035; color = [129, 176, 213]; }
      }
    } else if (kind === "open") {
      // Seven bright members embedded in irregular reflection wisps.
      const member = i % 7, angle = member * 2.4, spread = .28 + (member % 3) * .17;
      const cx = Math.cos(angle) * spread, cy = Math.sin(angle) * spread;
      x = cx + normal() * .17; y = cy + normal() * .15; z = normal() * .24;
      color = [129, 171, 229]; layer = "gas"; size = .065; opacity = .047;
      if (i < 7) { x = cx; y = cy; z = (member % 3 - 1) * .16; layer = "star"; size = .035; opacity = 1; color = [211, 229, 255]; }
      else if (i % 17 === 0) { layer = "star"; opacity = .55; size = .003; }
    } else if (kind === "irregular") {
      x = normal() * .76; y = normal() * .18; z = normal() * .14;
      layer = "gas"; opacity = .09; size = .06;
      if (i % 5 === 0) { y = normal() * .06; layer = "dust"; color = [28, 20, 18]; opacity = .3; }
      if (i % 4 === 0) { z = (i % 8 ? 1 : -1) * v; x = normal() * (.08 + v * .35); color = [220, 94, 117]; opacity = .05; }
    } else {
      const lobe = i % profile.lobes, angle = lobe * 2 * Math.PI / profile.lobes;
      x = Math.cos(angle) * .34 + normal() * .34; y = Math.sin(angle) * .3 + normal() * .29; z = normal() * .33;
      layer = "gas"; size = .14 + random() * .065; opacity = .055;
      if (key === "m42") {
        y = y*.65 + Math.abs(x)*.45;
        if (i % 3 === 0) { x = normal()*.13; y = normal()*.12; z = normal()*.13; }
      }
      const cavity = Math.hypot(x, y + .08, z * .7);
      if (cavity < .19) { color = key === "m42" ? [190, 213, 218] : [138, 187, 205]; opacity = key === "m42" ? .10 : .035; }
      if (key === "m17") { x = Math.cos(a * .72) * (.5 + normal() * .12); y = Math.sin(a * .72) * .35 + normal() * .12; }
      if (key === "m16" && i % 5 < 2) {
        const pillar = i % 3; y = v * .9 - .6; x = (pillar - 1) * .22 + y * .14 + normal() * .04;
        z = .12 + normal() * .09; layer = "dust"; color = [30, 24, 19]; opacity = .2; size = .055;
      } else if ((key === "m20" && Math.abs(Math.sin(Math.atan2(y, x) * 1.5)) < .18)
        || (key !== "m16" && Math.abs(y - .14 * Math.sin(x * 7)) < .07 && i % 3 === 0)) {
        layer = "dust"; color = [23, 20, 25]; opacity = .09 * profile.dust; size = .12; z += .12;
      }
      if (i % 31 === 0) { layer = "star"; color = [219, 229, 249]; opacity = .8; size = .004; }
    }
    const tiltedY = y * Math.cos(profile.inclination) - z * Math.sin(profile.inclination);
    const tiltedZ = y * Math.sin(profile.inclination) + z * Math.cos(profile.inclination);
    particles.push({ x: x * Math.cos(profile.angle) - tiltedY * Math.sin(profile.angle),
      y: x * Math.sin(profile.angle) + tiltedY * Math.cos(profile.angle), z: tiltedZ,
      color: `rgb(${color.join(",")})`, opacity, size, layer });
  }
  return particles;
}
