import { universeCameraBasis } from "../navigation/universeNavigation";
import type { SkyCamera, Vector3 } from "../sky/skyProjection";
import { AU_KM, type PhysicalBody, type ProjectedBody } from "./universeBodyGeometry";
import { appearanceRotation, bodyAppearance, resolvedBodyWeight } from "./universeAppearanceProfiles";
import type { UniverseTextureCache } from "./universeTextureCache";

const pixels = new WeakMap<HTMLImageElement, ImageData>();
const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const rotate = (m: Float32Array, v: number[]) => [0, 1, 2].map((i) => m[i]! * v[0]! + m[i + 3]! * v[1]! + m[i + 6]! * v[2]!);

/** Reduced-resolution ray casting retains perspective and the surface at 30 km
 * even without WebGL. Same local maps; relief/atmosphere use the GPU path only. */
export function renderBodyFallback(context: CanvasRenderingContext2D,
  bodies: Array<{ body: PhysicalBody; projected: ProjectedBody }>, observer: Vector3, camera: SkyCamera,
  width: number, height: number, dpr: number, cache: UniverseTextureCache): void {
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
  if (!bodies.length) return;
  const scale = Math.min(1, 400 / width, 300 / height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const basis = universeCameraBasis(camera.yawDeg, camera.pitchDeg);
  const focal = Math.min(w, h) / (2 * Math.tan(camera.fovDeg * Math.PI / 360));
  for (const { body, projected } of bodies) {
    const profile = bodyAppearance(body), m = appearanceRotation(profile), r = Number(body.radiusKm) / AU_KM;
    const center = rotate(m, [(body.position.x - observer.x) / r, (body.position.y - observer.y) / r, (body.position.z - observer.z) / r]);
    const sun = rotate(m, norm([-body.position.x, -body.position.y, -body.position.z]));
    const entry = projected.radiusPx >= 12 ? cache.get(profile.map) : null;
    let map = entry ? pixels.get(entry.image) : undefined;
    if (entry && !map) {
      const texture = document.createElement("canvas"); texture.width = 1024; texture.height = 512;
      const tc = texture.getContext("2d", { willReadFrequently: true })!;
      tc.drawImage(entry.image, 0, 0, 1024, 512); map = tc.getImageData(0, 0, 1024, 512); pixels.set(entry.image, map);
    }
    const image = ctx.createImageData(w, h), weight = resolvedBodyWeight(projected.radiusPx);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = (x + .5 - w / 2) / focal, sy = (h / 2 - y - .5) / focal;
      const ray = rotate(m, norm([basis.forward.x + basis.right.x * sx + basis.up.x * sy,
        basis.forward.y + basis.right.y * sx + basis.up.y * sy, basis.forward.z + basis.right.z * sx + basis.up.z * sy]));
      const along = dot(ray, center), d = along * along - dot(center, center) + 1;
      let t = d >= 0 ? along - Math.sqrt(d) : -1;
      if (t < 0 && d >= 0) t = along + Math.sqrt(d);
      let color = [0, 0, 0], alpha = 0;
      if (t > 0) {
        const n = norm(ray.map((a, i) => a * t - center[i]!));
        let base = profile.color;
        if (map) {
          const u = ((Math.atan2(n[1]!, n[0]!) / (2 * Math.PI) + .5) % 1 + 1) % 1;
          const v = Math.acos(Math.max(-1, Math.min(1, n[2]!))) / Math.PI;
          const offset = (Math.min(map.height - 1, Math.floor(v * map.height)) * map.width + Math.floor(u * map.width)) * 4;
          base = [map.data[offset]! / 255, map.data[offset + 1]! / 255, map.data[offset + 2]! / 255];
          if (body.key === "jupiter" && Math.abs(n[2]!) > .98) base = profile.color;
        }
        const light = profile.material === 0 ? .4 + .6 * Math.max(0, -dot(n, ray)) : .009 + Math.max(0, dot(n, sun));
        color = base.map((c) => Math.pow(Math.pow(c, 2.2) * light, 1 / 2.2)); alpha = 1;
      }
      if (body.key === "saturn" && Math.abs(ray[2]!) > .00001) {
        const rt = center[2]! / ray[2]!, hit = ray.map((a, i) => a * rt - center[i]!);
        const radius = Math.hypot(...hit);
        if (rt > 0 && (t < 0 || rt < t) && radius > 1.24 && radius < 2.32) {
          const opacity = radius > 1.94 && radius < 2.03 ? .04 : radius < 1.52 ? .2 : .8;
          const out = opacity + alpha * (1 - opacity);
          color = [.7, .65, .54].map((c, i) => (c * opacity + color[i]! * alpha * (1 - opacity)) / out); alpha = out;
        }
      }
      const offset = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) image.data[offset + k] = Math.min(255, color[k]! * 255);
      image.data[offset + 3] = alpha * weight * 255;
    }
    ctx.putImageData(image, 0, 0); context.drawImage(canvas, 0, 0, width, height);
  }
}
