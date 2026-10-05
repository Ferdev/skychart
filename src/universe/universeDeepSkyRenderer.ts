import type { SkyCamera, Vector3 } from "../sky/skyProjection";
import { createSkyProjector } from "../sky/skyProjection";
import { projectSphericalExtent } from "./universeBodyGeometry";
import { deepSkyModel, makeDeepSkyCloud, type CloudParticle, type DeepSkyPoint } from "./universeDeepSkyModel";
import { canonicalDeepSkyKey } from "./universeDeepSkyProfiles";
import { UniverseCloudRenderer, type CloudSplat } from "./universeCloudRenderer";
import { resolvedBodyWeight } from "./universeAppearanceProfiles";
import { occludedByBody, type BodyOccluder } from "./universeOcclusion";

/** CPU double precision projection, then sorted, soft 3D gas/dust/star splats. */
export class UniverseDeepSkyRenderer {
  private readonly renderer: UniverseCloudRenderer;
  private readonly clouds = new Map<string, CloudParticle[]>();

  constructor(private readonly canvas: HTMLCanvasElement, invalidate: () => void = () => {}) {
    this.renderer = new UniverseCloudRenderer(canvas, invalidate);
  }

  render(points: readonly DeepSkyPoint[], observer: Vector3, camera: SkyCamera,
    width: number, height: number, dpr: number, occluders: BodyOccluder[] = [], quality = 1, selectedKey?: string): Set<string> {
    const visibleKeys = new Set<string>(), drawn = new Set<string>();
    const projector = createSkyProjector(camera, width, height, Math.max(width, height) * .4);
    const focal = Math.min(width, height) / (2 * Math.tan(camera.fovDeg * Math.PI / 360));
    const screenPoints: CloudSplat[] = [];
    const candidates = points.flatMap((point) => {
      const model = deepSkyModel(point);
      const extent = model ? projectSphericalExtent(point.position, model.radiusAu, observer, camera, width, height) : null;
      return model && extent && extent.radiusPx > 1.5 ? [{ point, model, extent }] : [];
    }).sort((a, b) => Number(b.point.key === selectedKey) - Number(a.point.key === selectedKey) || b.extent.radiusPx - a.extent.radiusPx);
    // 0 is the reduced particle budget for a slow device or a narrow screen;
    // 1 is full detail, which a capable device keeps while it moves.
    const level = width < 600 ? 0 : Math.max(0, Math.min(1, (quality - .4) / .6));
    const budget = 12_000 + 12_000 * level;
    for (const { point, model, extent } of candidates) {
      const canonical = canonicalDeepSkyKey(point.key);
      if (drawn.has(canonical)) { visibleKeys.add(point.key); continue; }
      if (screenPoints.length >= budget) continue;
      drawn.add(canonical); visibleKeys.add(point.key);
      let particles = this.clouds.get(canonical);
      if (!particles) { particles = makeDeepSkyCloud(point.key, model.kind); this.clouds.set(canonical, particles); }
      // +z in model space faces the Sun; actual internal depth and orientation
      // remain illustrative. Flying around reveals stable, non-billboard depth.
      const length = Math.hypot(point.position.x, point.position.y, point.position.z) || 1;
      const normal = { x: -point.position.x / length, y: -point.position.y / length, z: -point.position.z / length };
      const horizontal = Math.hypot(normal.x, normal.y);
      const right = horizontal > 1e-12 ? { x: -normal.y / horizontal, y: normal.x / horizontal, z: 0 } : { x: 1, y: 0, z: 0 };
      const up = { x: -normal.z * right.y, y: normal.z * right.x, z: normal.x * right.y - normal.y * right.x };
      const center = { x: point.position.x - observer.x, y: point.position.y - observer.y, z: point.position.z - observer.z };
      const detail = Math.min(1, Math.max(.15, extent.radiusPx / 110)) * (.6 + .4 * level);
      const stride = Math.max(1, Math.ceil(1 / detail));
      const weight = resolvedBodyWeight(extent.radiusPx);
      for (let i = 0; i < particles.length && screenPoints.length < budget; i++) {
        if (i >= 7 && i % stride !== 0) continue;
        const p = particles[i]!;
        const delta = { x: center.x + (right.x*p.x + up.x*p.y + normal.x*p.z)*model.radiusAu,
          y: center.y + (right.y*p.x + up.y*p.y + normal.y*p.z)*model.radiusAu,
          z: center.z + (right.z*p.x + up.z*p.y + normal.z*p.z)*model.radiusAu };
        const projected = projector(delta);
        if (!projected || (!this.renderer.available && occludedByBody(delta, occluders))) continue;
        const distance = Math.hypot(delta.x, delta.y, delta.z);
        const size = Math.min(Math.max(width, height) * .4, Math.max(p.layer === "star" ? 1.3 : 2,
          focal * model.radiusAu * p.size / Math.max(distance, model.radiusAu * .005)));
        if (projected.x < -size || projected.x > width + size || projected.y < -size || projected.y > height + size) continue;
        const nearFade = Math.min(1, distance / (model.radiusAu * .04));
        screenPoints.push({ x: projected.x, y: projected.y, size,
          opacity: (1 - Math.pow(1 - p.opacity, stride)) * weight * nearFade, color: p.color, distance, star: p.layer === "star" });
      }
    }
    // A count budget alone cannot control overdraw inside a nebula: one nearby
    // gas splat can cover most of the screen. Bound rasterized area as well.
    const fillBudget = Math.min(width * height, 1_000_000) * (6 + 4 * Math.max(0, Math.min(1, (quality - .4) / .6))) / Math.max(1, dpr * dpr);
    const gasArea = screenPoints.reduce((sum, p) => sum + (p.star ? 0 : p.size * p.size), 0);
    const starArea = screenPoints.reduce((sum, p) => sum + (p.star ? p.size * p.size : 0), 0);
    const fillStride = Math.max(1, Math.ceil(gasArea / Math.max(1, fillBudget - starArea)));
    let usedArea = 0, gasIndex = 0;
    const bounded = screenPoints.filter((p) => {
      if (!p.star && gasIndex++ % fillStride !== 0) return false;
      if (usedArea + p.size * p.size > fillBudget) return false;
      usedArea += p.size * p.size;
      if (!p.star) p.opacity = 1 - Math.pow(1 - p.opacity, fillStride);
      return true;
    });
    this.canvas.dataset.visibleObjects = [...visibleKeys].join(",");
    this.canvas.dataset.particleCount = String(bounded.length);
    this.canvas.dataset.splatPixelArea = String(Math.round(usedArea));
    this.renderer.render(bounded, width, height, dpr, camera, occluders);
    return visibleKeys;
  }

  release(): void { this.clouds.clear(); this.renderer.release(); }
}
