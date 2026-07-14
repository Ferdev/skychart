import type { Camera } from "../atlas/contracts";
import type { DisplayLayer } from "../viewState";
import { clamp, expandedRect, pointInRect, pointRect, rectsOverlap, type Rect, type ScreenPoint } from "../geometry";
import { lightYearsToAu, MILKY_WAY_MODEL, type GalacticModelFeature, type GalacticModelPoint } from "../galacticModel";

type HazeCache = {
  screenBlend: HTMLCanvasElement;
  sourceBlend: HTMLCanvasElement;
  cameraXAu: number;
  cameraYAu: number;
  pxPerAu: number;
  centerX: number;
  centerY: number;
  marginX: number;
  marginY: number;
  cssWidth: number;
  cssHeight: number;
  layerAlphaBucket: number;
  detailAlphaBucket: number;
  arms: boolean;
  dust: boolean;
};

type MilkyWayRendererOptions = {
  context: CanvasRenderingContext2D;
  camera: () => Camera;
  displayLayers: () => Record<DisplayLayer, boolean>;
  currentViewWidthLy: () => number;
  usableViewport: () => Rect;
  worldToScreen: (xAu: number, yAu: number) => ScreenPoint;
  drawLabel: (text: string, x: number, y: number, color: string) => void;
};

const HAZE_MARGIN_RATIO = 0.25;
const CACHED_ZOOM_DRIFT_LOG2 = Math.log2(1.2);
const DETAIL_BUDGET_MS = 6;
const SOFT_STROKE_PASSES: [number, number][] = [
  [1.7, 0.3],
  [0.85, 0.35],
  [0, 0.45],
];

/** Draws and caches the Milky Way model, including haze, arms, dust, guides, and labels. */
export class MilkyWayRenderer {
  private hazeCache: HazeCache | null = null;

  constructor(private readonly options: MilkyWayRendererOptions) {}

  draw(previousFrameMs: number) {
    const startedAt = performance.now();
    const viewWidthLy = this.options.currentViewWidthLy();
    if (viewWidthLy < 500) return previousFrameMs;
    const rect = expandedRect(this.options.usableViewport(), 220);
    const layerAlpha = clamp((Math.log10(viewWidthLy) - 2.7) / 1.1, 0, 1);
    const detailAlpha = previousFrameMs > DETAIL_BUDGET_MS ? 0 : clamp((Math.log10(viewWidthLy) - 3.55) / 0.9, 0, 1);
    if (layerAlpha <= 0) return previousFrameMs;

    const rebuiltHaze = this.ensureHazeCache(layerAlpha, detailAlpha);
    this.blitHaze();
    const occupiedLabels: Rect[] = [];
    const ctx = this.options.context;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (this.options.displayLayers().milkyWayGuides) this.drawReferenceGuides(layerAlpha, detailAlpha, rect, occupiedLabels);

    if (detailAlpha > 0.45) {
      for (const marker of MILKY_WAY_MODEL.markers) {
        const screen = this.pointToScreen(marker.point);
        if (!pointInRect(screen, rect)) continue;
        ctx.globalAlpha = detailAlpha;
        ctx.setLineDash([]);
        ctx.fillStyle = marker.color;
        ctx.strokeStyle = "rgba(8, 10, 9, 0.72)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.drawLabel(marker.label, screen.x + 12, screen.y - 10, "rgba(248, 218, 136, 0.92)", occupiedLabels);
      }
    }
    ctx.restore();
    return rebuiltHaze ? previousFrameMs : performance.now() - startedAt;
  }

  invalidate() {
    this.hazeCache = null;
  }

  private ensureHazeCache(layerAlpha: number, detailAlpha: number) {
    const camera = this.options.camera();
    const layers = this.options.displayLayers();
    const cssWidth = Math.floor(window.innerWidth);
    const cssHeight = Math.floor(window.innerHeight);
    const marginX = Math.ceil(cssWidth * HAZE_MARGIN_RATIO);
    const marginY = Math.ceil(cssHeight * HAZE_MARGIN_RATIO);
    const layerAlphaBucket = Math.round(layerAlpha * 12);
    const detailAlphaBucket = Math.round(detailAlpha * 12);
    const cache = this.hazeCache;
    if (cache) {
      const zoomDrift = Math.abs(Math.log2(camera.pxPerAu / cache.pxPerAu));
      const panXPx = Math.abs(cache.cameraXAu - camera.xAu) * camera.pxPerAu;
      const panYPx = Math.abs(cache.cameraYAu - camera.yAu) * camera.pxPerAu;
      if (
        cache.cssWidth === cssWidth && cache.cssHeight === cssHeight && cache.arms === layers.milkyWayArms && cache.dust === layers.milkyWayDust &&
        cache.layerAlphaBucket === layerAlphaBucket && cache.detailAlphaBucket === detailAlphaBucket &&
        zoomDrift <= CACHED_ZOOM_DRIFT_LOG2 && panXPx <= marginX * 0.6 && panYPx <= marginY * 0.6
      ) return false;
    }

    const fullWidth = cssWidth + marginX * 2;
    const fullHeight = cssHeight + marginY * 2;
    const screenBlend = cache?.screenBlend ?? document.createElement("canvas");
    const sourceBlend = cache?.sourceBlend ?? document.createElement("canvas");
    screenBlend.width = fullWidth;
    screenBlend.height = fullHeight;
    sourceBlend.width = fullWidth;
    sourceBlend.height = fullHeight;
    const screenCtx = screenBlend.getContext("2d");
    const sourceCtx = sourceBlend.getContext("2d");
    if (!screenCtx || !sourceCtx) {
      this.hazeCache = null;
      return false;
    }

    const hazeRect: Rect = { left: -marginX, top: -marginY, right: cssWidth + marginX, bottom: cssHeight + marginY, width: fullWidth, height: fullHeight };
    screenCtx.setTransform(1, 0, 0, 1, marginX, marginY);
    sourceCtx.setTransform(1, 0, 0, 1, marginX, marginY);
    screenCtx.lineJoin = "round";
    screenCtx.lineCap = "round";
    this.drawDisk(screenCtx, layerAlpha);
    this.drawCore(screenCtx, layerAlpha);
    if (layers.milkyWayArms) this.drawArmGlow(screenCtx, detailAlpha, hazeRect);
    if (layers.milkyWayDust) this.drawDustClouds(sourceCtx, detailAlpha, hazeRect);

    const viewport = this.options.usableViewport();
    this.hazeCache = {
      screenBlend, sourceBlend, cameraXAu: camera.xAu, cameraYAu: camera.yAu, pxPerAu: camera.pxPerAu,
      centerX: viewport.left + viewport.width / 2, centerY: viewport.top + viewport.height / 2,
      marginX, marginY, cssWidth, cssHeight, layerAlphaBucket, detailAlphaBucket,
      arms: layers.milkyWayArms, dust: layers.milkyWayDust,
    };
    return true;
  }

  private blitHaze() {
    const cache = this.hazeCache;
    if (!cache) return;
    const camera = this.options.camera();
    const viewport = this.options.usableViewport();
    const centerX = viewport.left + viewport.width / 2;
    const centerY = viewport.top + viewport.height / 2;
    const scale = camera.pxPerAu / cache.pxPerAu;
    const destX = centerX + (-cache.marginX - cache.centerX) * scale + (cache.cameraXAu - camera.xAu) * camera.pxPerAu;
    const destY = centerY + (-cache.marginY - cache.centerY) * scale + (camera.yAu - cache.cameraYAu) * camera.pxPerAu;
    const destWidth = (cache.cssWidth + cache.marginX * 2) * scale;
    const destHeight = (cache.cssHeight + cache.marginY * 2) * scale;
    const ctx = this.options.context;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(cache.screenBlend, destX, destY, destWidth, destHeight);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(cache.sourceBlend, destX, destY, destWidth, destHeight);
    ctx.restore();
  }

  private drawDisk(target: CanvasRenderingContext2D, alpha: number) {
    const disk = MILKY_WAY_MODEL.features.find((feature) => feature.kind === "disk");
    if (!disk) return;
    target.save();
    target.globalAlpha = alpha;
    target.globalCompositeOperation = "screen";
    this.tracePath(disk.points.map((point) => this.pointToScreen(point)), true, target);
    target.fillStyle = "rgba(213, 190, 139, 0.035)";
    target.fill();
    target.restore();
  }

  private drawCore(target: CanvasRenderingContext2D, alpha: number) {
    const marker = MILKY_WAY_MODEL.markers.find((item) => item.key === "galactic-center");
    if (!marker) return;
    const screen = this.pointToScreen(marker.point);
    const radius = this.lightYearsToPixels(10_000);
    if (radius < 1) return;
    const gradient = target.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
    gradient.addColorStop(0, `rgba(248, 218, 136, ${0.34 * alpha})`);
    gradient.addColorStop(0.28, `rgba(236, 183, 89, ${0.16 * alpha})`);
    gradient.addColorStop(0.68, `rgba(189, 101, 73, ${0.055 * alpha})`);
    gradient.addColorStop(1, "rgba(236, 183, 89, 0)");
    target.save();
    target.globalCompositeOperation = "screen";
    target.fillStyle = gradient;
    target.beginPath();
    target.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    target.fill();
    target.restore();
  }

  private drawDustClouds(target: CanvasRenderingContext2D, alpha: number, rect: Rect) {
    if (alpha <= 0) return;
    target.save();
    target.globalCompositeOperation = "source-over";
    for (const cloud of MILKY_WAY_MODEL.clouds) {
      const screen = this.pointToScreen(cloud.point);
      const radius = clamp(this.lightYearsToPixels(cloud.radiusLy), 1.8, 58);
      if (!rectsOverlap(pointRect(screen, radius * 2), rect)) continue;
      const cloudAlpha = alpha * cloud.alpha;
      const gradient = target.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
      gradient.addColorStop(0, `rgba(${cloud.color}, ${cloudAlpha})`);
      gradient.addColorStop(0.55, `rgba(${cloud.color}, ${cloudAlpha * 0.46})`);
      gradient.addColorStop(1, `rgba(${cloud.color}, 0)`);
      target.fillStyle = gradient;
      target.beginPath();
      target.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      target.fill();
    }
    target.restore();
  }

  private drawArmGlow(target: CanvasRenderingContext2D, alpha: number, rect: Rect) {
    if (alpha <= 0) return;
    target.save();
    target.globalCompositeOperation = "screen";
    for (const feature of MILKY_WAY_MODEL.features.filter((item) => item.kind === "arm")) {
      const screens = feature.points.map((point) => this.pointToScreen(point));
      if (!this.pathNearRect(screens, rect)) continue;
      const broadWidth = clamp(this.lightYearsToPixels(3_100), 4, 34);
      const spreadPx = clamp(this.lightYearsToPixels(1_000), 1.5, 7);
      target.setLineDash([]);
      target.strokeStyle = feature.color;
      for (const [widthScale, alphaScale] of SOFT_STROKE_PASSES) {
        target.globalAlpha = alpha * 0.11 * alphaScale;
        target.lineWidth = broadWidth + spreadPx * 2 * widthScale;
        this.tracePath(screens, false, target);
        target.stroke();
      }
    }
    target.restore();
  }

  private drawReferenceGuides(alpha: number, detailAlpha: number, rect: Rect, occupiedLabels: Rect[]) {
    const viewWidthLy = this.options.currentViewWidthLy();
    if (viewWidthLy > 105_000) return;
    const ctx = this.options.context;
    ctx.save();
    for (const feature of MILKY_WAY_MODEL.features) {
      if (feature.kind !== "ring") continue;
      const screens = feature.points.map((point) => this.pointToScreen(point));
      if (!this.pathNearRect(screens, rect)) continue;
      ctx.globalAlpha = Math.min(alpha * 0.28, 0.2);
      ctx.strokeStyle = feature.color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash(feature.dash ? [...feature.dash] : []);
      this.tracePath(screens, true, ctx);
      ctx.stroke();
    }
    if (detailAlpha > 0.78 && viewWidthLy < 65_000) {
      for (const feature of MILKY_WAY_MODEL.features) if (feature.kind === "arm") this.drawFeatureLabel(feature, occupiedLabels);
    }
    ctx.restore();
  }

  private drawFeatureLabel(feature: GalacticModelFeature, occupiedLabels: Rect[]) {
    if (!feature.labelPoint) return;
    const screen = this.pointToScreen(feature.labelPoint);
    this.drawLabel(feature.label, screen.x + 8, screen.y - 8, "rgba(239, 233, 213, 0.68)", occupiedLabels);
  }

  private drawLabel(text: string, x: number, y: number, color: string, occupiedLabels: Rect[]) {
    const ctx = this.options.context;
    ctx.save();
    ctx.font = "11px Inter, system-ui, sans-serif";
    const width = ctx.measureText(text).width + 12;
    const rect = { left: x - 6, top: y - 15, right: x - 6 + width, bottom: y + 7, width, height: 22 };
    if (!pointInRect({ x, y }, this.options.usableViewport()) || occupiedLabels.some((item) => rectsOverlap(item, rect))) {
      ctx.restore();
      return;
    }
    occupiedLabels.push(rect);
    this.options.drawLabel(text, x, y, color);
    ctx.restore();
  }

  private pointToScreen(point: GalacticModelPoint) {
    return this.options.worldToScreen(point.xAu, point.yAu);
  }

  private lightYearsToPixels(valueLy: number) {
    return lightYearsToAu(valueLy) * this.options.camera().pxPerAu;
  }

  private tracePath(points: ScreenPoint[], closePath: boolean, target: CanvasRenderingContext2D) {
    target.beginPath();
    points.forEach((point, index) => index === 0 ? target.moveTo(point.x, point.y) : target.lineTo(point.x, point.y));
    if (closePath) target.closePath();
  }

  private pathNearRect(points: ScreenPoint[], rect: Rect) {
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (pointInRect(point, rect)) return true;
      const next = points[index + 1];
      if (!next) continue;
      if (Math.max(point.x, next.x) >= rect.left && Math.min(point.x, next.x) <= rect.right && Math.max(point.y, next.y) >= rect.top && Math.min(point.y, next.y) <= rect.bottom) return true;
    }
    return false;
  }
}
