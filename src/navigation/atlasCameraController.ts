import type { Body, Camera } from "../atlas/contracts";
import { classifyBody } from "../destinationPicker";
import { clamp, easeInOutCubic, lerp, type Rect } from "../geometry";
import { lightYearsToAu } from "../galacticModel";

type AtlasCameraControllerOptions = {
  camera: () => Camera;
  setCamera: (camera: Camera) => void;
  viewport: () => Rect;
  auKm: () => number;
  clearPreset: () => void;
  updateScale: () => void;
  requestRender: (withData?: boolean) => void;
  requestDataRefresh: () => void;
  schedulePointRefresh: () => void;
  scheduleCameraRefresh: () => void;
};

const MIN_ZOOM = 1e-14;
const MAX_ZOOM = 50_000_000;
const SLIDER_STEPS = 1000;
const LOCAL_DIAMETER_PX = 170;
const ANIMATION_MS = 1100;

/** Owns camera fitting, cursor-anchored zoom, slider mapping, and animation. */
export class AtlasCameraController {
  private animationFrame: number | null = null;
  private animationComplete: (() => void) | null = null;

  constructor(private readonly options: AtlasCameraControllerOptions) {}

  centerOnBody(body: Body, zoom: boolean, animate = false) {
    const current = this.options.camera();
    const target = zoom ? this.localCamera(body) : { ...current, xAu: body.position.x_au, yAu: body.position.y_au };
    this.options.clearPreset();
    if (animate) this.animateTo(target);
    else {
      this.cancelAnimation();
      this.options.setCamera(target);
      this.options.updateScale();
    }
  }

  localCamera(body: Body): Camera {
    const classification = classifyBody(body);
    const rect = this.options.viewport();
    const diameterAu = Math.max((body.radius_km * 2) / this.options.auKm(), 1e-9);
    const targetDiameterPx = ["moon", "planet", "dwarf_planet"].includes(classification.type) ? LOCAL_DIAMETER_PX : LOCAL_DIAMETER_PX * 0.72;
    const pxPerAu = body.catalog?.source_type === "deep_sky_catalog"
      ? clamp(rect.width / Math.max(body.distance_from_earth_km / this.options.auKm() / 40, 1000), MIN_ZOOM, MAX_ZOOM)
      : clamp(targetDiameterPx / diameterAu, MIN_ZOOM, MAX_ZOOM);
    return { xAu: body.position.x_au, yAu: body.position.y_au, pxPerAu };
  }

  animateTo(target: Camera, durationMs = ANIMATION_MS, onComplete?: () => void) {
    this.cancelAnimation();
    this.animationComplete = onComplete ?? null;
    const start = { ...this.options.camera() };
    const startedAt = performance.now();
    const startZoom = Math.log(Math.max(start.pxPerAu, MIN_ZOOM));
    const targetZoom = Math.log(Math.max(target.pxPerAu, MIN_ZOOM));
    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / durationMs, 0, 1);
      const eased = easeInOutCubic(progress);
      this.options.setCamera({
        xAu: lerp(start.xAu, target.xAu, eased), yAu: lerp(start.yAu, target.yAu, eased),
        pxPerAu: Math.exp(lerp(startZoom, targetZoom, eased)),
      });
      this.options.updateScale();
      this.options.requestRender(progress === 1);
      if (progress < 1) this.animationFrame = requestAnimationFrame(tick);
      else {
        this.animationFrame = null;
        this.finishAnimation();
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  cancelAnimation() {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.finishAnimation();
  }

  fitBodies(bodies: Body[], paddingRatio: number) {
    this.cancelAnimation();
    this.fitWorldBounds(
      Math.min(...bodies.map((body) => body.position.x_au)), Math.max(...bodies.map((body) => body.position.x_au)),
      Math.min(...bodies.map((body) => body.position.y_au)), Math.max(...bodies.map((body) => body.position.y_au)), paddingRatio,
    );
  }

  fitPhysicalScale(widthLy: number, paddingRatio: number) {
    this.cancelAnimation();
    const halfWidthAu = lightYearsToAu(widthLy) / 2;
    this.fitWorldBounds(-halfWidthAu, halfWidthAu, -halfWidthAu, halfWidthAu, paddingRatio);
  }

  fitWorldBounds(minX: number, maxX: number, minY: number, maxY: number, paddingRatio: number) {
    const rect = this.options.viewport();
    const paddedWidthAu = Math.max(0.001, maxX - minX) * (1 + paddingRatio * 2);
    const paddedHeightAu = Math.max(0.001, maxY - minY) * (1 + paddingRatio * 2);
    this.options.setCamera({
      xAu: (minX + maxX) / 2, yAu: (minY + maxY) / 2,
      pxPerAu: clamp(Math.min(rect.width / paddedWidthAu, rect.height / paddedHeightAu), MIN_ZOOM, MAX_ZOOM),
    });
    this.options.updateScale();
  }

  zoomViewportCenter(factor: number) {
    const rect = this.options.viewport();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor, true);
  }

  setFromSlider(value: number) {
    const rect = this.options.viewport();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const before = this.screenToWorld(center.x, center.y);
    this.cancelAnimation();
    const camera = { ...this.options.camera(), pxPerAu: this.sliderValueToZoom(value) };
    this.options.setCamera(camera);
    const after = this.screenToWorld(center.x, center.y);
    this.options.setCamera({ ...camera, xAu: camera.xAu + before.xAu - after.xAu, yAu: camera.yAu + before.yAu - after.yAu });
    this.options.clearPreset();
    this.options.updateScale();
    this.options.requestRender();
    this.options.schedulePointRefresh();
    this.options.scheduleCameraRefresh();
  }

  zoomToSliderValue(pxPerAu: number) {
    const minLog = Math.log(MIN_ZOOM);
    const maxLog = Math.log(MAX_ZOOM);
    return Math.round(clamp((Math.log(clamp(pxPerAu, MIN_ZOOM, MAX_ZOOM)) - minLog) / (maxLog - minLog), 0, 1) * SLIDER_STEPS);
  }

  zoomAt(x: number, y: number, factor: number, clearPreset = false, dataMode: "immediate" | "deferred" | "none" = "immediate") {
    this.cancelAnimation();
    const before = this.screenToWorld(x, y);
    const current = this.options.camera();
    this.options.setCamera({ ...current, pxPerAu: clamp(current.pxPerAu * factor, MIN_ZOOM, MAX_ZOOM) });
    const after = this.screenToWorld(x, y);
    const zoomed = this.options.camera();
    this.options.setCamera({ ...zoomed, xAu: zoomed.xAu + before.xAu - after.xAu, yAu: zoomed.yAu + before.yAu - after.yAu });
    if (clearPreset) this.options.clearPreset();
    this.options.updateScale();
    this.options.requestRender();
    if (dataMode === "immediate") this.options.requestDataRefresh();
    else if (dataMode === "deferred") {
      this.options.schedulePointRefresh();
      this.options.scheduleCameraRefresh();
    }
  }

  private sliderValueToZoom(value: number) {
    const minLog = Math.log(MIN_ZOOM);
    const maxLog = Math.log(MAX_ZOOM);
    return Math.exp(minLog + (maxLog - minLog) * clamp(value / SLIDER_STEPS, 0, 1));
  }

  private screenToWorld(x: number, y: number) {
    const camera = this.options.camera();
    const rect = this.options.viewport();
    return { xAu: camera.xAu + (x - (rect.left + rect.width / 2)) / camera.pxPerAu, yAu: camera.yAu - (y - (rect.top + rect.height / 2)) / camera.pxPerAu };
  }

  private finishAnimation() {
    this.animationComplete?.();
    this.animationComplete = null;
  }
}
