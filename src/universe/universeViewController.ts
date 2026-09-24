import type { Body } from "../atlas/contracts";
import type { atlasDom } from "../atlas/atlasDom";
import { trackEvent } from "../analytics";
import { moveUniversePosition, type UniverseMove } from "../navigation/universeNavigation";
import { bodyCanObserveSky, bodyVector, isDynamicBody } from "../sky/skyBody";
import { skyPointAppearance } from "../sky/skyPointAppearance";
import {
  directionFromEcliptic,
  normalizeCamera,
  projectDirection,
  relativeDirection,
  type SkyCamera,
  type Vector3,
} from "../sky/skyProjection";
import { normalizeUniverseViewState, type UniverseViewState } from "../viewState";

type CatalogUniversePoint = {
  key: string;
  name: string;
  object_type?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  direction: Vector3;
  distance_au?: number | null;
};

type UniversePoint = Omit<CatalogUniversePoint, "distance_au"> & {
  position?: Vector3;
  dynamic: boolean;
};

type RenderedHit = { point: UniversePoint; x: number; y: number; radius: number };

type UniverseViewOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  toggleButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  positionLabel: HTMLElement;
  speedLabel: HTMLOutputElement;
  status: HTMLElement;
  tooltip: HTMLElement;
  bodyByKey: () => ReadonlyMap<string, Body>;
  translate: (key: string, params?: Record<string, string | number>) => string;
  selectBody: (key: string) => Promise<void>;
  stateChanged: (mode: "push" | "replace") => void;
  closeSky: () => void;
  initialState: () => UniverseViewState;
};

type UniverseIntegrationOptions = Pick<UniverseViewOptions,
  "bodyByKey" | "translate" | "selectBody" | "stateChanged" | "closeSky" | "initialState">;

const DEFAULT_CAMERA: SkyCamera = { yawDeg: 180, pitchDeg: 0, fovDeg: 72 };
const CATALOG_LIMIT = 12_000;
const MAX_LABELS = 30;
const MIN_MOVE_STEP_AU = 1e-12;
const MAX_MOVE_STEP_AU = 1e18;

/** Full-screen free-flight view over real heliocentric 3D catalog positions. */
export class UniverseViewController {
  private position: Vector3 = { x: 0, y: 0, z: 0 };
  private camera: SkyCamera = { ...DEFAULT_CAMERA };
  private moveStepAu = 1;
  private initialState: UniverseViewState | null = null;
  private catalogPoints: UniversePoint[] = [];
  private renderedHits: RenderedHit[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPointer: { x: number; y: number } | null = null;
  private dragMoved = false;
  private renderFrame: number | null = null;
  private requestId = 0;
  private reloadTimer: number | null = null;

  constructor(private readonly options: UniverseViewOptions) {
    options.toggleButton.addEventListener("click", () => this.open(options.initialState()));
    options.closeButton.addEventListener("click", () => this.close());
    options.resetButton.addEventListener("click", () => this.reset());
    options.root.addEventListener("click", (event) => this.controlClick(event));
    options.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    options.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    options.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    options.canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    options.canvas.addEventListener("keydown", (event) => this.keyDown(event));
    window.addEventListener("resize", () => this.requestRender());
    window.addEventListener("cosmic-atlas:locale-change", () => this.updateChrome());
  }

  get active(): boolean { return !this.options.root.hidden; }

  state(): UniverseViewState | undefined {
    if (!this.active) return undefined;
    return normalizeUniverseViewState({
      positionAu: { ...this.position },
      ...normalizeCamera(this.camera),
      moveStepAu: this.moveStepAu,
    }) ?? undefined;
  }

  open(state: UniverseViewState, historyMode: "push" | "replace" = "push"): void {
    const normalized = normalizeUniverseViewState(state);
    if (!normalized) return;
    this.options.closeSky();
    this.position = { ...normalized.positionAu };
    this.camera = normalizeCamera(normalized);
    this.moveStepAu = normalized.moveStepAu;
    this.initialState = { ...normalized, positionAu: { ...normalized.positionAu } };
    this.options.root.hidden = false;
    document.body.dataset.universeView = "true";
    this.updateChrome();
    this.options.status.textContent = this.options.translate("universe3d.loading");
    this.options.canvas.focus({ preventScroll: true });
    this.requestRender();
    this.options.stateChanged(historyMode);
    trackEvent("universe_3d_opened", { source: historyMode === "push" ? "atlas" : "history" });
    void this.loadCatalog();
  }

  restore(state: UniverseViewState | undefined): void {
    if (!state) {
      this.close({ updateHistory: false });
      return;
    }
    this.open(state, "replace");
  }

  close(options: { updateHistory?: boolean } = {}): void {
    if (!this.active) return;
    this.requestId += 1;
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.options.root.hidden = true;
    delete document.body.dataset.universeView;
    this.hideTooltip();
    this.catalogPoints = [];
    this.renderedHits = [];
    this.initialState = null;
    if (options.updateHistory !== false) this.options.stateChanged("push");
  }

  refreshForTime(): void {
    if (this.active) void this.loadCatalog();
  }

  private reset(): void {
    if (!this.initialState) return;
    this.position = { ...this.initialState.positionAu };
    this.camera = normalizeCamera(this.initialState);
    this.moveStepAu = this.initialState.moveStepAu;
    this.afterNavigation();
    void this.loadCatalog();
  }

  private async loadCatalog(): Promise<void> {
    if (!this.active) return;
    const requestPosition = { ...this.position };
    const requestId = ++this.requestId;
    const params = new URLSearchParams({
      observer_x_au: String(requestPosition.x),
      observer_y_au: String(requestPosition.y),
      observer_z_au: String(requestPosition.z),
      limit: String(CATALOG_LIMIT),
    });
    try {
      const response = await fetch(`/api/catalog/sky?${params.toString()}`);
      if (!response.ok) throw new Error(`3D catalog returned ${response.status}`);
      const payload = await response.json() as { points?: CatalogUniversePoint[] };
      if (requestId !== this.requestId || !this.active) return;
      this.catalogPoints = (payload.points ?? []).filter(validCatalogPoint).map((point) => ({
        ...point,
        position: Number.isFinite(point.distance_au) && Number(point.distance_au) > 0
          ? {
              x: requestPosition.x + point.direction.x * Number(point.distance_au),
              y: requestPosition.y + point.direction.y * Number(point.distance_au),
              z: requestPosition.z + point.direction.z * Number(point.distance_au),
            }
          : undefined,
        dynamic: false,
      }));
      this.options.status.textContent = this.options.translate("universe3d.ready", { count: this.catalogPoints.length });
    } catch {
      if (requestId !== this.requestId || !this.active) return;
      this.catalogPoints = [];
      this.options.status.textContent = this.options.translate("universe3d.catalogUnavailable");
    }
    this.requestRender();
  }

  private points(): UniversePoint[] {
    const points = new Map<string, UniversePoint>(this.catalogPoints.map((point) => [point.key, point]));
    for (const body of this.options.bodyByKey().values()) {
      if (!bodyCanObserveSky(body)) continue;
      const target = bodyVector(body);
      const direction = relativeDirection(this.position, target);
      if (!direction) continue;
      points.set(body.key, {
        key: body.key,
        name: body.name,
        object_type: body.object_type,
        color: body.color,
        apparent_magnitude: body.stellar?.apparent_magnitude ?? body.deep_sky?.apparent_magnitude,
        position: target,
        direction,
        dynamic: isDynamicBody(body),
      });
    }
    return [...points.values()];
  }

  private requestRender(): void {
    if (!this.active || this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private render(): void {
    if (!this.active) return;
    const canvas = this.options.canvas;
    const width = Math.max(1, this.options.root.clientWidth);
    const height = Math.max(1, this.options.root.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const background = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.75);
    background.addColorStop(0, "#0b1519");
    background.addColorStop(0.52, "#070c10");
    background.addColorStop(1, "#020405");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    this.drawOrientationGrid(context, width, height);
    this.drawPoints(context, this.points(), width, height);
    drawReticle(context, width, height);
  }

  private drawOrientationGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.save();
    context.lineWidth = 1;
    for (let longitude = 0; longitude < 360; longitude += 30) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 49 }, (_, index) =>
        directionFromEcliptic(longitude, -90 + index * 3.75)), longitude % 90 === 0 ? 0.2 : 0.08);
    }
    for (const latitude of [-60, -30, 0, 30, 60]) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 97 }, (_, index) =>
        directionFromEcliptic(index * 3.75, latitude)), latitude === 0 ? 0.24 : 0.1);
    }
    context.restore();
  }

  private drawDirectionLine(context: CanvasRenderingContext2D, width: number, height: number, directions: Vector3[], opacity: number): void {
    context.beginPath();
    context.strokeStyle = `rgba(116, 184, 183, ${opacity})`;
    let previous: { x: number; y: number } | null = null;
    for (const direction of directions) {
      const projected = projectDirection(direction, this.camera, width, height);
      if (!projected || (previous && Math.hypot(projected.x - previous.x, projected.y - previous.y) > width * 0.3)) {
        previous = null;
        continue;
      }
      if (previous) context.lineTo(projected.x, projected.y); else context.moveTo(projected.x, projected.y);
      previous = projected;
    }
    context.stroke();
  }

  private drawPoints(context: CanvasRenderingContext2D, points: UniversePoint[], width: number, height: number): void {
    const hits: RenderedHit[] = [];
    const labels: RenderedHit[] = [];
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const point of points) {
      const direction = point.position ? relativeDirection(this.position, point.position) : point.direction;
      if (!direction) continue;
      const projected = projectDirection(direction, this.camera, width, height);
      if (!projected) continue;
      const appearance = skyPointAppearance(point);
      if (appearance.glowRadius > 0) {
        const glow = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, appearance.glowRadius);
        glow.addColorStop(0, appearance.glowColors.inner);
        glow.addColorStop(0.28, appearance.glowColors.middle);
        glow.addColorStop(1, appearance.glowColors.outer);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(projected.x, projected.y, appearance.glowRadius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = appearance.opacity;
      context.fillStyle = appearance.color;
      context.beginPath();
      context.arc(projected.x, projected.y, appearance.coreRadius, 0, Math.PI * 2);
      context.fill();
      const hit = { point, x: projected.x, y: projected.y, radius: Math.max(7, appearance.coreRadius + 4) };
      hits.push(hit);
      if (point.dynamic || (Number.isFinite(point.apparent_magnitude) && Number(point.apparent_magnitude) <= 4.5)) labels.push(hit);
    }
    context.restore();
    this.renderedHits = hits;
    this.drawLabels(context, labels.slice(0, MAX_LABELS), width, height);
  }

  private drawLabels(context: CanvasRenderingContext2D, labels: RenderedHit[], width: number, height: number): void {
    const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    context.save();
    context.font = "600 12px system-ui, sans-serif";
    for (const hit of labels) {
      const labelWidth = context.measureText(hit.point.name).width + 12;
      const rect = { left: hit.x + 8, top: hit.y - 10, right: hit.x + 8 + labelWidth, bottom: hit.y + 10 };
      if (rect.left < 8 || rect.right > width - 8 || rect.top < 72 || rect.bottom > height - 60) continue;
      if (occupied.some((item) => overlaps(item, rect))) continue;
      occupied.push(rect);
      context.fillStyle = "rgba(3, 7, 8, 0.72)";
      context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      context.fillStyle = "rgba(238, 242, 234, 0.84)";
      context.fillText(hit.point.name, hit.x + 14, hit.y + 4);
    }
    context.restore();
  }

  private move(movement: UniverseMove, multiplier = 1): void {
    this.position = moveUniversePosition(this.position, this.camera.yawDeg, this.camera.pitchDeg, movement, this.moveStepAu * multiplier);
    this.afterNavigation(true);
  }

  private afterNavigation(reload = false): void {
    this.updateChrome();
    this.hideTooltip();
    this.options.stateChanged("replace");
    this.requestRender();
    if (reload) this.scheduleCatalogReload();
  }

  private scheduleCatalogReload(): void {
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      this.reloadTimer = null;
      void this.loadCatalog();
    }, 420);
  }

  private updateChrome(): void {
    this.options.positionLabel.textContent = this.options.translate("universe3d.position", {
      x: formatCoordinate(this.position.x), y: formatCoordinate(this.position.y), z: formatCoordinate(this.position.z),
    });
    this.options.speedLabel.textContent = formatDistanceAu(this.moveStepAu);
  }

  private controlClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const moveButton = target.closest<HTMLButtonElement>("[data-universe-move]");
    if (moveButton) {
      this.move(moveButton.dataset.universeMove as UniverseMove);
      this.options.canvas.focus({ preventScroll: true });
      return;
    }
    const speedButton = target.closest<HTMLButtonElement>("[data-universe-speed]");
    if (!speedButton) return;
    const factor = speedButton.dataset.universeSpeed === "faster" ? 10 : 0.1;
    this.moveStepAu = clamp(this.moveStepAu * factor, MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.afterNavigation();
    this.options.canvas.focus({ preventScroll: true });
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.active) return;
    const point = this.canvasPoint(event);
    this.pointers.set(event.pointerId, point);
    this.lastPointer = point;
    this.dragMoved = false;
    try { this.options.canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not own capture. */ }
    this.options.canvas.style.cursor = "grabbing";
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    if (!this.pointers.has(event.pointerId) || !this.lastPointer) {
      this.showTooltip(point);
      return;
    }
    const dx = point.x - this.lastPointer.x;
    const dy = point.y - this.lastPointer.y;
    if (Math.hypot(dx, dy) > 1) this.dragMoved = true;
    const degreesPerPixel = this.camera.fovDeg / Math.max(240, Math.min(this.options.canvas.clientWidth, this.options.canvas.clientHeight));
    this.camera = normalizeCamera({ ...this.camera, yawDeg: this.camera.yawDeg - dx * degreesPerPixel, pitchDeg: this.camera.pitchDeg + dy * degreesPerPixel });
    this.lastPointer = point;
    this.afterNavigation();
  }

  private pointerUp(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    const wasActive = this.pointers.delete(event.pointerId);
    try { this.options.canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be gone. */ }
    if (!wasActive) return;
    if (!this.dragMoved && event.type === "pointerup") void this.selectAt(point);
    this.lastPointer = null;
    this.options.canvas.style.cursor = "grab";
  }

  private wheel(event: WheelEvent): void {
    if (!this.active) return;
    event.preventDefault();
    const multiplier = clamp(Math.abs(event.deltaY) / 100, 0.15, 4);
    this.move(event.deltaY < 0 ? "forward" : "back", multiplier);
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.active) return;
    const key = event.key.toLowerCase();
    const multiplier = event.shiftKey ? 10 : 1;
    const movement: UniverseMove | undefined = key === "w" ? "forward" : key === "s" ? "back"
      : key === "a" ? "left" : key === "d" ? "right" : key === "e" ? "up" : key === "q" ? "down" : undefined;
    if (movement) this.move(movement, multiplier);
    else if (event.key === "ArrowLeft") this.camera.yawDeg -= event.shiftKey ? 10 : 3;
    else if (event.key === "ArrowRight") this.camera.yawDeg += event.shiftKey ? 10 : 3;
    else if (event.key === "ArrowUp") this.camera.pitchDeg += event.shiftKey ? 10 : 3;
    else if (event.key === "ArrowDown") this.camera.pitchDeg -= event.shiftKey ? 10 : 3;
    else if (event.key === "Escape") { this.close(); return; }
    else return;
    event.preventDefault();
    if (!movement) {
      this.camera = normalizeCamera(this.camera);
      this.afterNavigation();
    }
  }

  private async selectAt(point: { x: number; y: number }): Promise<void> {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) return;
    this.options.status.textContent = this.options.translate("universe3d.selecting", { name: hit.point.name });
    await this.options.selectBody(hit.point.key);
    if (this.active) this.options.status.textContent = this.options.translate("universe3d.selected", { name: hit.point.name });
  }

  private showTooltip(point: { x: number; y: number }): void {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) { this.hideTooltip(); return; }
    this.options.tooltip.textContent = hit.point.name;
    this.options.tooltip.style.setProperty("--universe-tooltip-x", `${hit.x}px`);
    this.options.tooltip.style.setProperty("--universe-tooltip-y", `${hit.y}px`);
    this.options.tooltip.hidden = false;
    this.options.canvas.style.cursor = "pointer";
  }

  private hideTooltip(): void {
    this.options.tooltip.hidden = true;
    if (this.pointers.size === 0) this.options.canvas.style.cursor = "grab";
  }

  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}

export function createUniverseViewController(dom: typeof atlasDom, options: UniverseIntegrationOptions): UniverseViewController {
  return new UniverseViewController({
    ...options,
    root: dom.universeView,
    canvas: dom.universeCanvas,
    toggleButton: dom.universeToggle,
    closeButton: dom.universeClose,
    resetButton: dom.universeReset,
    positionLabel: dom.universePosition,
    speedLabel: dom.universeSpeed,
    status: dom.universeStatus,
    tooltip: dom.universeTooltip,
  });
}

function validCatalogPoint(point: CatalogUniversePoint): boolean {
  return Boolean(point?.key && point.name && point.direction &&
    [point.direction.x, point.direction.y, point.direction.z].every(Number.isFinite));
}

function drawReticle(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.strokeStyle = "rgba(248, 203, 101, 0.4)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width / 2 - 9, height / 2);
  context.lineTo(width / 2 + 9, height / 2);
  context.moveTo(width / 2, height / 2 - 9);
  context.lineTo(width / 2, height / 2 + 9);
  context.stroke();
  context.restore();
}

function nearestHit(hits: RenderedHit[], point: { x: number; y: number }): RenderedHit | null {
  let nearest: RenderedHit | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const nextDistance = Math.hypot(hit.x - point.x, hit.y - point.y);
    if (nextDistance <= hit.radius && nextDistance < distance) { nearest = hit; distance = nextDistance; }
  }
  return nearest;
}

function overlaps(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function formatCoordinate(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0 AU";
  if (magnitude < 1e4) return `${formatNumber(value)} AU`;
  const lightYears = value / 63_241.077;
  return `${formatNumber(lightYears)} ly`;
}

function formatDistanceAu(value: number): string {
  if (value < 0.01) return `${formatNumber(value * 149_597_870.7)} km`;
  if (value < 10_000) return `${formatNumber(value)} AU`;
  const lightYears = value / 63_241.077;
  if (Math.abs(lightYears) < 1e3) return `${formatNumber(lightYears)} ly`;
  if (Math.abs(lightYears) < 1e6) return `${formatNumber(lightYears / 1e3)} kly`;
  if (Math.abs(lightYears) < 1e9) return `${formatNumber(lightYears / 1e6)} Mly`;
  return `${formatNumber(lightYears / 1e9)} Gly`;
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
