import type { Camera } from "../atlas/contracts";
import type { Rect, ScreenPoint } from "../geometry";
import type { WebglPointRenderer } from "../webglPointRenderer";

interface AtlasViewportOptions {
  canvas: HTMLCanvasElement;
  pointRenderer: WebglPointRenderer;
  camera: () => Camera;
  activeTab: () => string | null;
  selectedObjectPanel: HTMLElement;
}

export class AtlasViewport {
  private frameRect: Rect | null = null;

  constructor(private readonly options: AtlasViewportOptions) {}

  beginFrame(): void {
    this.frameRect = this.computeRect();
  }

  endFrame(): void {
    this.frameRect = null;
  }

  rect(): Rect {
    return this.frameRect ?? this.computeRect();
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
    const selection = document.querySelector<HTMLElement>(".selection-strip");
    const modeRail = document.querySelector<HTMLElement>(".mode-rail:not([hidden])");
    const scaleRail = document.querySelector<HTMLElement>(".scale-rail");
    const workspaceRect = workspace?.getBoundingClientRect();
    const barRect = bar?.getBoundingClientRect();
    const selectionRect = selection?.getBoundingClientRect();
    const modeRailRect = modeRail?.getBoundingClientRect();
    const scaleRailRect = scaleRail?.getBoundingClientRect();
    const isWide = window.innerWidth >= 900;
    const topBoundary = Math.max(
      barRect?.bottom ?? 0,
      !isWide ? modeRailRect?.bottom ?? 0 : 0,
      !isWide ? selectionRect?.bottom ?? 0 : 0,
    );
    const rightObstructions = [
      workspaceRect?.left,
      selectionRect && !this.options.selectedObjectPanel.hidden ? selectionRect.left : undefined,
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    const right = isWide && rightObstructions.length > 0
      ? Math.max(240, Math.min(...rightObstructions) - 12)
      : window.innerWidth;
    const top = Math.max(0, topBoundary + 8);
    const mobileObjectSheetTop = !isWide && this.options.activeTab() === "object" ? workspaceRect?.top : undefined;
    const desktopObjectBottom = isWide && this.options.activeTab() === "object"
      ? scaleRailRect?.top
      : undefined;
    const bottomBoundary = !isWide
      ? Math.min(scaleRailRect?.top ?? window.innerHeight, mobileObjectSheetTop ?? window.innerHeight)
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
