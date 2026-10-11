import type { Camera } from "../atlas/contracts";
import { isCompactWindow } from "../atlas/windowLayout";
import type { Rect, ScreenPoint } from "../geometry";
import type { WebglPointRenderer } from "../webglPointRenderer";

interface AtlasViewportOptions {
  canvas: HTMLCanvasElement;
  pointRenderer: WebglPointRenderer;
  camera: () => Camera;
  activeTab: () => string | null;
}

export class AtlasViewport {
  private frameRect: Rect | null = null;
  private frameScaleBarOrigin: ScreenPoint | null = null;

  constructor(private readonly options: AtlasViewportOptions) {}

  beginFrame(): void {
    this.frameRect = this.computeRect();
    this.frameScaleBarOrigin = null;
  }

  endFrame(): void {
    this.frameRect = null;
    this.frameScaleBarOrigin = null;
  }

  rect(): Rect {
    return this.frameRect ?? this.computeRect();
  }

  /**
   * The left end of the scale bar line. The bar is in the bottom left corner of the map area.
   * When the toolbar covers that corner, the bar is above the toolbar.
   */
  scaleBarOrigin(): ScreenPoint {
    if (this.frameScaleBarOrigin) return this.frameScaleBarOrigin;
    const rect = this.rect();
    const toolbar = document.querySelector<HTMLElement>(".scale-rail")?.getBoundingClientRect();
    const covered = toolbar && toolbar.width > 0 && toolbar.top < rect.bottom && toolbar.left < rect.left + 220;
    const origin = { x: rect.left + 24, y: (covered ? toolbar.top + 10 : rect.bottom) - 34 };
    if (this.frameRect) this.frameScaleBarOrigin = origin;
    return origin;
  }

  /** Rendering extends beside desktop controls; centering still uses rect(). */
  renderRect(): Rect {
    const rect = this.rect();
    if (isCompactWindow()) return rect;
    const bottom = Math.max(rect.bottom, window.innerHeight - 10);
    return { ...rect, bottom, height: bottom - rect.top };
  }

  worldToScreen(xAu: number, yAu: number): ScreenPoint {
    const rect = this.rect();
    const camera = this.options.camera();
    return {
      x: rect.left + rect.width / 2 + (xAu - camera.xAu) * camera.pxPerAu,
      y: rect.top + rect.height / 2 - (yAu - camera.yAu) * camera.pxPerAu,
    };
  }

  screenToWorld(x: number, y: number): { xAu: number; yAu: number } {
    const rect = this.rect();
    const camera = this.options.camera();
    return {
      xAu: camera.xAu + (x - (rect.left + rect.width / 2)) / camera.pxPerAu,
      yAu: camera.yAu - (y - (rect.top + rect.height / 2)) / camera.pxPerAu,
    };
  }

  worldBounds(paddingRatio: number) {
    const rect = this.renderRect();
    const leftTop = this.screenToWorld(rect.left, rect.top);
    const rightBottom = this.screenToWorld(rect.right, rect.bottom);
    const minXAu = Math.min(leftTop.xAu, rightBottom.xAu);
    const maxXAu = Math.max(leftTop.xAu, rightBottom.xAu);
    const minYAu = Math.min(leftTop.yAu, rightBottom.yAu);
    const maxYAu = Math.max(leftTop.yAu, rightBottom.yAu);
    const paddingXAu = (maxXAu - minXAu) * paddingRatio;
    const paddingYAu = (maxYAu - minYAu) * paddingRatio;
    return { minXAu: minXAu - paddingXAu, maxXAu: maxXAu + paddingXAu, minYAu: minYAu - paddingYAu, maxYAu: maxYAu + paddingYAu };
  }

  renderScale(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  resize(): void {
    const dpr = this.renderScale();
    const cssWidth = Math.floor(window.innerWidth);
    const cssHeight = Math.floor(window.innerHeight);
    const width = Math.floor(cssWidth * dpr);
    const height = Math.floor(cssHeight * dpr);
    if (this.options.canvas.width === width && this.options.canvas.height === height) return;
    this.options.canvas.width = width;
    this.options.canvas.height = height;
    this.options.canvas.style.width = `${cssWidth}px`;
    this.options.canvas.style.height = `${cssHeight}px`;
    this.options.pointRenderer.setSize(width, height);
  }

  private computeRect(): Rect {
    const workspace = document.querySelector<HTMLElement>(".workspace-panel:not([hidden])");
    const bar = document.querySelector<HTMLElement>(".atlas-bar");
    const scaleRail = document.querySelector<HTMLElement>(".scale-rail");
    const workspaceRect = workspace?.getBoundingClientRect();
    const barRect = bar?.getBoundingClientRect();
    const scaleRailRect = scaleRail?.getBoundingClientRect();
    const compact = isCompactWindow();
    const topBoundary = barRect?.bottom ?? 0;
    // A panel that is not as wide as the window is at the side of the map. A panel as wide as the window is a bottom sheet.
    const sidePanelLeft = workspaceRect && workspaceRect.left > 0 && workspaceRect.width < window.innerWidth - 40
      ? workspaceRect.left
      : undefined;
    const right = typeof sidePanelLeft === "number" && Number.isFinite(sidePanelLeft)
      ? Math.max(240, sidePanelLeft - 12)
      : window.innerWidth;
    const top = Math.max(0, topBoundary + 8);
    const objectSheetTop = compact && sidePanelLeft === undefined && this.options.activeTab() === "object" ? workspaceRect?.top : undefined;
    const desktopObjectBottom = !compact && this.options.activeTab() === "object"
      ? scaleRailRect?.top
      : undefined;
    const bottomBoundary = compact
      ? Math.min(scaleRailRect?.top ?? window.innerHeight, objectSheetTop ?? window.innerHeight)
      : desktopObjectBottom ?? window.innerHeight;
    const bottom = Math.max(top + 1, bottomBoundary - 10);
    return {
      left: 0,
      top,
      right,
      bottom,
      width: Math.max(1, right),
      height: Math.max(1, bottom - top),
    };
  }
}
