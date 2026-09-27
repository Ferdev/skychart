import type { SkyCamera, Vector3 } from "../sky/skyProjection";
import { createSkyProjector } from "../sky/skyProjection";
import { projectSphericalExtent } from "./universeBodyGeometry";
import { deepSkyModel, makeDeepSkyCloud, type CloudParticle, type DeepSkyPoint, type DeepSkyModel } from "./universeDeepSkyModel";
import { UniversePointRenderer, type UniverseScreenPoint } from "./universePointRenderer";

type VisibleModel = { point: DeepSkyPoint; model: DeepSkyModel; particles: CloudParticle[] };

/** Project stable object-local 3D particle volumes into the flight camera. */
export class UniverseDeepSkyRenderer {
  private readonly pointRenderer: UniversePointRenderer;
  private readonly fallback: CanvasRenderingContext2D | null;
  private readonly clouds = new Map<string, CloudParticle[]>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.pointRenderer = new UniversePointRenderer(canvas);
    this.fallback = this.pointRenderer.available ? null : canvas.getContext("2d");
  }

  render(points: readonly DeepSkyPoint[], observer: Vector3, camera: SkyCamera,
    width: number, height: number, dpr: number): Set<string> {
    const visible: VisibleModel[] = [];
    for (const point of points) {
      const model = deepSkyModel(point);
      if (!model) continue;
      const extent = projectSphericalExtent(point.position, model.radiusAu, observer, camera, width, height);
      if (!extent || extent.radiusPx < 2.5) continue;
      let particles = this.clouds.get(point.key);
      if (!particles) {
        particles = makeDeepSkyCloud(point.key, model.kind);
        this.clouds.set(point.key, particles);
      }
      visible.push({ point, model, particles });
    }
    const visibleKeys = new Set(visible.map(({ point }) => point.key));
    this.canvas.dataset.visibleObjects = [...visibleKeys].join(",");
    const projector = createSkyProjector(camera, width, height);
    const focal = Math.min(width, height) / (2 * Math.tan(camera.fovDeg * Math.PI / 360));
    const screenPoints: UniverseScreenPoint[] = [];
    for (const { point, model, particles } of visible) {
      const center = { x: point.position.x - observer.x, y: point.position.y - observer.y, z: point.position.z - observer.z };
      for (const particle of particles) {
        const projected = projector({ x: center.x + particle.x * model.radiusAu,
          y: center.y + particle.y * model.radiusAu, z: center.z + particle.z * model.radiusAu });
        if (!projected || projected.x < -12 || projected.x > width + 12 || projected.y < -12 || projected.y > height + 12) continue;
        const distance = Math.hypot(center.x + particle.x * model.radiusAu,
          center.y + particle.y * model.radiusAu, center.z + particle.z * model.radiusAu);
        const apparentSize = Math.min(7, Math.max(particle.size, focal * model.radiusAu / Math.max(distance, 1e-12) * 0.018));
        screenPoints.push({ x: projected.x, y: projected.y, size: apparentSize,
          opacity: particle.opacity, color: particle.color });
      }
    }
    this.canvas.dataset.particleCount = String(screenPoints.length);
    if (this.pointRenderer.available) this.pointRenderer.render(screenPoints, width, height, dpr);
    else this.renderFallback(screenPoints, width, height, dpr);
    return visibleKeys;
  }

  private renderFallback(points: UniverseScreenPoint[], width: number, height: number, dpr: number): void {
    const context = this.fallback;
    if (!context) return;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (const point of points) {
      context.globalAlpha = point.opacity;
      context.fillStyle = point.color;
      context.beginPath();
      context.arc(point.x, point.y, point.size * 0.5, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }
}
