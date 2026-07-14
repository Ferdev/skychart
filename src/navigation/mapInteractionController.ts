import type { Camera, CatalogPointHitEntry } from "../atlas/contracts";
import { clamp, type ScreenPoint } from "../geometry";

type MapInteractionControllerOptions = {
  canvas: HTMLCanvasElement;
  catalogPointHover: HTMLElement;
  isEnabled: () => boolean;
  camera: () => Camera;
  setCamera: (camera: Camera) => void;
  hoverKey: () => string | null;
  setHoverKey: (key: string | null) => void;
  cancelCameraAnimation: () => void;
  zoomAt: (x: number, y: number, factor: number, clearPreset: boolean, dataMode: "deferred" | "none") => void;
  edgeReferenceAt: (x: number, y: number) => { body: { key: string } } | null;
  nearestBodyAt: (x: number, y: number) => { body: { key: string } } | null;
  nearestCatalogPointAt: (x: number, y: number) => CatalogPointHitEntry | null;
  handleClick: (point: ScreenPoint) => void | Promise<void>;
  requestRender: (withData?: boolean) => void;
  scheduleViewStateReplace: () => void;
};

/** Owns pointer capture, pan, pinch, hover selection, click dispatch, and wheel zoom. */
export class MapInteractionController {
  private pointers = new Map<number, ScreenPoint>();
  private dragging = false;
  private dragMoved = false;
  private dragStart: ScreenPoint | null = null;
  private dragCameraStart: Camera | null = null;
  private pinch: { midpoint: ScreenPoint; distance: number } | null = null;
  private hadPinch = false;

  constructor(private readonly options: MapInteractionControllerOptions) {}

  bind() {
    const canvas = this.options.canvas;
    canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.finishPointer(event));
    canvas.addEventListener("pointercancel", (event) => this.finishPointer(event));
    canvas.addEventListener("lostpointercapture", (event) => this.finishPointer(event, false));
    canvas.addEventListener("pointerleave", () => this.hideCatalogPointHover());
    canvas.addEventListener("wheel", (event) => {
      if (!this.options.isEnabled()) return;
      event.preventDefault();
      const point = this.canvasPoint(event);
      this.options.zoomAt(point.x, point.y, clamp(Math.exp(-event.deltaY * 0.004), 0.32, 3.2), true, "deferred");
    }, { passive: false });
  }

  diagnostics() {
    return { activePointerIds: Array.from(this.pointers.keys()), hadPinch: this.hadPinch };
  }

  private pointerDown(event: PointerEvent) {
    if (!this.options.isEnabled()) return;
    this.options.cancelCameraAnimation();
    this.pointers.set(event.pointerId, this.canvasPoint(event));
    try { this.options.canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic events may not own capture. */ }
    if (this.pointers.size >= 2) {
      this.pinch = this.currentPinch();
      this.hadPinch = true;
      this.dragMoved = true;
      this.dragging = false;
      this.dragStart = null;
      this.dragCameraStart = null;
      this.options.setHoverKey(null);
      this.hideCatalogPointHover();
      this.options.canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    this.hadPinch = false;
    this.dragging = true;
    this.dragMoved = false;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.dragCameraStart = { ...this.options.camera() };
  }

  private pointerMove(event: PointerEvent) {
    const point = this.canvasPoint(event);
    const previousHoverKey = this.options.hoverKey();
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2) {
      const next = this.currentPinch();
      if (next && this.pinch) {
        const camera = this.options.camera();
        this.options.setCamera({ ...camera, xAu: camera.xAu - (next.midpoint.x - this.pinch.midpoint.x) / camera.pxPerAu, yAu: camera.yAu + (next.midpoint.y - this.pinch.midpoint.y) / camera.pxPerAu });
        const factor = next.distance / Math.max(0.001, this.pinch.distance);
        if (Number.isFinite(factor) && factor > 0) this.options.zoomAt(next.midpoint.x, next.midpoint.y, factor, true, "none");
      }
      this.pinch = next;
      this.hadPinch = true;
      this.dragMoved = true;
      this.options.setHoverKey(null);
      this.hideCatalogPointHover();
      this.options.canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    if (this.dragging && this.dragStart && this.dragCameraStart) {
      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      const camera = this.options.camera();
      this.options.setCamera({ ...camera, xAu: this.dragCameraStart.xAu - dx / camera.pxPerAu, yAu: this.dragCameraStart.yAu + dy / camera.pxPerAu });
      this.options.setHoverKey(null);
      this.hideCatalogPointHover();
      this.options.canvas.style.cursor = "grabbing";
      this.options.requestRender();
      return;
    }
    const edge = this.options.edgeReferenceAt(point.x, point.y);
    const nearest = edge ? null : this.options.nearestBodyAt(point.x, point.y);
    const catalogPoint = edge || nearest ? null : this.options.nearestCatalogPointAt(point.x, point.y);
    this.options.setHoverKey(edge?.body.key ?? nearest?.body.key ?? null);
    if (catalogPoint) this.showCatalogPointHover(catalogPoint); else this.hideCatalogPointHover();
    this.options.canvas.style.cursor = edge || nearest || catalogPoint ? "pointer" : "grab";
    if (previousHoverKey !== this.options.hoverKey()) this.options.requestRender();
  }

  private finishPointer(event: PointerEvent, releaseCapture = true) {
    const active = this.pointers.delete(event.pointerId);
    if (releaseCapture) try { this.options.canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be gone. */ }
    if (!active) return;
    if (this.pointers.size >= 2) { this.pinch = this.currentPinch(); return; }
    if (this.pointers.size === 1) {
      const remaining = this.pointers.values().next().value as ScreenPoint;
      this.pinch = null;
      this.dragging = true;
      this.dragStart = { ...remaining };
      this.dragCameraStart = { ...this.options.camera() };
      return;
    }
    const completedPinch = this.hadPinch;
    this.dragging = false;
    this.pinch = null;
    const point = this.canvasPoint(event);
    if (event.type === "pointerup" && !this.dragMoved && !completedPinch) void this.options.handleClick(point);
    else this.options.requestRender(true);
    this.options.canvas.style.cursor = this.options.hoverKey() || this.options.catalogPointHover.dataset.visible === "true" ? "pointer" : "grab";
    this.dragStart = null;
    this.dragCameraStart = null;
    this.hadPinch = false;
    this.options.scheduleViewStateReplace();
  }

  private currentPinch() {
    const [first, second] = Array.from(this.pointers.values());
    if (!first || !second) return null;
    return { midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.hypot(second.x - first.x, second.y - first.y) };
  }

  private canvasPoint(event: PointerEvent | WheelEvent) {
    const rect = this.options.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private showCatalogPointHover(entry: CatalogPointHitEntry) {
    this.options.catalogPointHover.style.setProperty("--hover-x", `${entry.x}px`);
    this.options.catalogPointHover.style.setProperty("--hover-y", `${entry.y}px`);
    this.options.catalogPointHover.dataset.visible = "true";
  }

  private hideCatalogPointHover() {
    delete this.options.catalogPointHover.dataset.visible;
  }
}
