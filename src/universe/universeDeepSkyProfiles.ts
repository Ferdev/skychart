export type Morphology = { arms: number; winding: number; bulge: number; inclination: number; angle: number;
  tint: [number, number, number]; lobes: number; dust: number };

export const canonicalDeepSkyKey = (key: string): string => key === "simbad-m-87" ? "m87" : key;

// Visual reconstructions, not fits to a measured 3D density field. Angles set
// an Earth-facing presentation only; source notes are in universe-appearance.md.
const PROFILES: Record<string, Partial<Morphology>> = {
  m31: { arms: 2, winding: 6.4, bulge: .4, inclination: 1.17, angle: .65, dust: .8 },
  m33: { arms: 4, winding: 5.2, bulge: .12, inclination: .5, angle: -.4, dust: .3 },
  m51: { arms: 2, winding: 4.4, bulge: .25, inclination: .3, angle: .3, dust: .8 },
  m81: { arms: 2, winding: 6, bulge: .48, inclination: .85, angle: -.6, dust: .6 },
  m77: { arms: 3, winding: 8, bulge: .46, inclination: .55, angle: .2, dust: .8 },
  m82: { inclination: 1.35, angle: .6, tint: [238, 163, 139], dust: 1 },
  m87: { inclination: .4, angle: -.55, tint: [255, 218, 170], dust: 0 },
  m1: { inclination: .55, angle: -.5, tint: [242, 132, 101], lobes: 9 },
  m8: { tint: [229, 117, 144], angle: -.3, lobes: 3, dust: .7 },
  m16: { tint: [211, 155, 106], angle: -.2, lobes: 5, dust: 1 },
  m17: { tint: [241, 145, 157], angle: .2, lobes: 2, dust: .85 },
  m20: { tint: [220, 126, 167], angle: -.4, lobes: 3, dust: 1 },
  m42: { tint: [237, 149, 166], angle: .4, lobes: 4, dust: .8 },
  m57: { inclination: .3, angle: .2, tint: [111, 215, 198], dust: 0 },
  m13: { tint: [255, 224, 182], dust: 0 },
  m45: { tint: [142, 181, 238], inclination: .3, dust: .35 },
  "simbad-3c-273": { inclination: .45, angle: -.4, bulge: .7, dust: .2 },
  "simbad-3c-279": { inclination: .15, angle: .8, bulge: .8, dust: .2 },
};

export function deepSkyAppearance(key: string): Morphology {
  return { arms: 2, winding: 5, bulge: .25, inclination: .4, angle: 0,
    tint: [240, 200, 157], lobes: 3, dust: .5, ...PROFILES[canonicalDeepSkyKey(key)] };
}
