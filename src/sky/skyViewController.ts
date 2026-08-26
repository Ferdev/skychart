import type { Body, Ephemeris } from "../atlas/contracts";
import type { atlasDom } from "../atlas/atlasDom";
import type { SkyViewState } from "../viewState";
import {
  cameraForDirection,
  directionFromEcliptic,
  normalizeCamera,
  projectDirection,
  relativeDirection,
  type SkyCamera,
  type Vector3,
} from "./skyProjection";

type CatalogSkyPoint = {
  key: string;
  name: string;
  object_type?: string | null;
  catalog_group?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  direction: Vector3;
};

type SkyPoint = CatalogSkyPoint & { dynamic: boolean };

type SkyPayload = {
  returned?: number;
  points?: CatalogSkyPoint[];
};

type RenderedHit = {
  point: SkyPoint;
  x: number;
  y: number;
  radius: number;
};

type SkyViewControllerOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  title: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement;
  tooltip: HTMLElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  bodyByKey: () => ReadonlyMap<string, Body>;
  ephemeris: () => Ephemeris | null;
  translate: (key: string, params?: Record<string, string | number>) => string;
  selectBody: (key: string) => Promise<void>;
  stateChanged: (mode: "push" | "replace") => void;
  resolveObserver: (key: string) => Promise<Body | null>;
};

type SkyViewIntegrationOptions = Pick<SkyViewControllerOptions,
  "bodyByKey" | "ephemeris" | "translate" | "selectBody" | "stateChanged" | "resolveObserver">;

const DEFAULT_FOV_DEG = 72;
const MAX_LABELS = 28;
const SKY_POINT_LIMIT = 12_000;

/** Owns the horizonless, object-centered celestial-sphere overlay. */
export class SkyViewController {
  private observer: Body | null = null;
  private camera: SkyCamera = { yawDeg: 0, pitchDeg: 0, fovDeg: DEFAULT_FOV_DEG };
  private catalogPoints: CatalogSkyPoint[] = [];
  private renderedHits: RenderedHit[] = [];
  private requestId = 0;
  private renderFrame: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPointer: { x: number; y: number } | null = null;
  private dragMoved = false;
  private pinch: { distance: number; fovDeg: number } | null = null;

  constructor(private readonly options: SkyViewControllerOptions) {
    options.closeButton.addEventListener("click", () => this.close());
    options.resetButton.addEventListener("click", () => this.resetOrientation());
    options.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    options.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    options.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    options.canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    options.canvas.addEventListener("keydown", (event) => this.keyDown(event));
    window.addEventListener("resize", () => this.requestRender());
    window.addEventListener("cosmic-atlas:locale-change", () => this.updateLocale());
  }

  get active(): boolean {
    return !this.options.root.hidden && this.observer !== null;
  }

  state(): SkyViewState | undefined {
    if (!this.active || !this.observer) return undefined;
    return { observerKey: this.observer.key, ...normalizeCamera(this.camera) };
  }

  observerBody(): Body | null {
    return this.currentObserver();
  }

  async open(observer: Body, restoredCamera?: Omit<SkyViewState, "observerKey">): Promise<void> {
    if (!bodyCanObserveSky(observer)) return;
    this.observer = observer;
    this.catalogPoints = [];
    this.camera = restoredCamera ? normalizeCamera(restoredCamera) : this.initialCamera(observer);
    this.options.root.hidden = false;
    document.body.dataset.skyView = "true";
    this.updateChrome();
    this.options.status.textContent = this.options.translate("sky.loading");
    this.requestRender();
    this.options.canvas.focus({ preventScroll: true });
    this.options.stateChanged(restoredCamera ? "replace" : "push");
    await this.loadCatalog();
  }

  async restore(state: SkyViewState | undefined): Promise<void> {
    if (!state) {
      this.close({ updateHistory: false });
      return;
    }
    const observer = await this.options.resolveObserver(state.observerKey);
    if (!observer || !bodyCanObserveSky(observer)) {
      this.close({ updateHistory: false });
      return;
    }
    await this.open(observer, state);
  }

  close(options: { updateHistory?: boolean } = {}): void {
    if (!this.active) return;
    this.requestId += 1;
    this.options.root.hidden = true;
    delete document.body.dataset.skyView;
    this.hideTooltip();
    this.renderedHits = [];
    this.catalogPoints = [];
    this.observer = null;
    if (options.updateHistory !== false) this.options.stateChanged("push");
  }

  async refreshForTime(): Promise<void> {
    if (!this.active || !this.observer) return;
    this.observer = this.options.bodyByKey().get(this.observer.key) ?? this.observer;
    this.updateChrome();
    this.options.status.textContent = this.options.translate("sky.updating");
    this.requestRender();
    await this.loadCatalog();
  }

  updateLocale(): void {
    if (!this.active) return;
    this.updateChrome();
    this.options.status.textContent = this.options.translate("sky.ready", { count: this.catalogPoints.length });
    this.requestRender();
  }

  private async loadCatalog(): Promise<void> {
    const observer = this.currentObserver();
    if (!observer) return;
    const requestId = ++this.requestId;
    const position = observer.position;
    const params = new URLSearchParams({
      observer_key: observer.key,
      observer_x_au: String(position.x_au),
      observer_y_au: String(position.y_au),
      observer_z_au: String(position.z_au),
      limit: String(SKY_POINT_LIMIT),
    });

    try {
      const response = await fetch(`/api/catalog/sky?${params.toString()}`);
      if (!response.ok) throw new Error(`sky catalog returned ${response.status}`);
      const payload = await response.json() as SkyPayload;
      if (requestId !== this.requestId || !this.active) return;
      this.catalogPoints = (payload.points ?? []).filter(validCatalogPoint);
      this.options.status.textContent = this.options.translate("sky.ready", { count: this.catalogPoints.length });
    } catch {
      if (requestId !== this.requestId || !this.active) return;
      this.catalogPoints = [];
      this.options.status.textContent = this.options.translate("sky.catalogUnavailable");
    }
    this.requestRender();
  }

  private initialCamera(observer: Body): SkyCamera {
    const targetKey = observer.key === "sun" ? "earth" : "sun";
    const target = this.options.bodyByKey().get(targetKey);
    const direction = target
      ? relativeDirection(bodyVector(observer), bodyVector(target))
      : relativeDirection(bodyVector(observer), { x: 0, y: 0, z: 0 });
    return cameraForDirection(direction ?? { x: 1, y: 0, z: 0 }, DEFAULT_FOV_DEG);
  }

  private resetOrientation(): void {
    const observer = this.currentObserver();
    if (!observer) return;
    this.camera = this.initialCamera(observer);
    this.options.stateChanged("replace");
    this.requestRender();
  }

  private currentObserver(): Body | null {
    if (!this.observer) return null;
    return this.options.bodyByKey().get(this.observer.key) ?? this.observer;
  }

  private updateChrome(): void {
    const observer = this.currentObserver();
    const ephemeris = this.options.ephemeris();
    if (!observer) return;
    this.options.title.textContent = this.options.translate("sky.title", { name: observer.name });
    const timestamp = ephemeris?.timestamp_utc
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(ephemeris.timestamp_utc))
      : this.options.translate("sky.unknownTime");
    this.options.meta.textContent = this.options.translate("sky.meta", { date: timestamp });
  }

  private requestRender(): void {
    if (!this.active || this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private render(): void {
    const observer = this.currentObserver();
    if (!observer || !this.active) return;
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
    const background = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.72);
    background.addColorStop(0, "#0c1519");
    background.addColorStop(0.5, "#080d11");
    background.addColorStop(1, "#030506");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    this.drawGrid(context, width, height);
    this.drawPoints(context, observer, width, height);
    this.drawReticle(context, width, height);
  }

  private drawGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.save();
    context.lineWidth = 1;
    for (let longitude = 0; longitude < 360; longitude += 30) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 73 }, (_, index) =>
        directionFromEcliptic(longitude, -90 + index * 2.5)), longitude % 90 === 0 ? 0.2 : 0.1);
    }
    for (const latitude of [-60, -30, 0, 30, 60]) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 145 }, (_, index) =>
        directionFromEcliptic(index * 2.5, latitude)), latitude === 0 ? 0.28 : 0.12);
    }
    context.restore();
  }

  private drawDirectionLine(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    directions: Vector3[],
    opacity: number,
  ): void {
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

  private drawPoints(context: CanvasRenderingContext2D, observer: Body, width: number, height: number): void {
    const points = this.mergedPoints(observer);
    const hits: RenderedHit[] = [];
    const labelCandidates: RenderedHit[] = [];
    for (const point of points) {
      const projected = projectDirection(point.direction, this.camera, width, height);
      if (!projected) continue;
      const radius = pointRadius(point);
      const color = validColor(point.color) ? point.color! : "#d8e8ff";
      context.globalAlpha = point.dynamic ? 0.98 : starOpacity(point.apparent_magnitude);
      if (radius >= 2.5) {
        context.beginPath();
        context.fillStyle = `${color}24`;
        context.arc(projected.x, projected.y, radius * 3, 0, Math.PI * 2);
        context.fill();
      }
      context.beginPath();
      context.fillStyle = color;
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
      const hit = { point, x: projected.x, y: projected.y, radius: Math.max(7, radius + 4) };
      hits.push(hit);
      if (point.dynamic || (Number.isFinite(point.apparent_magnitude) && Number(point.apparent_magnitude) <= 4.5)) labelCandidates.push(hit);
    }
    context.globalAlpha = 1;
    this.renderedHits = hits;
    labelCandidates.sort((a, b) => Number(b.point.dynamic) - Number(a.point.dynamic) ||
      numericMagnitude(a.point.apparent_magnitude) - numericMagnitude(b.point.apparent_magnitude));
    this.drawLabels(context, labelCandidates.slice(0, MAX_LABELS), width, height);
  }

  private drawLabels(context: CanvasRenderingContext2D, candidates: RenderedHit[], width: number, height: number): void {
    const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    context.font = "600 12px system-ui, sans-serif";
    context.textBaseline = "middle";
    for (const hit of candidates) {
      const labelWidth = context.measureText(hit.point.name).width + 14;
      const rect = { left: hit.x + 8, top: hit.y - 10, right: hit.x + 8 + labelWidth, bottom: hit.y + 10 };
      if (rect.right > width - 8 || rect.left < 8 || rect.top < 72 || rect.bottom > height - 48) continue;
      if (occupied.some((item) => overlaps(item, rect))) continue;
      occupied.push(rect);
      context.fillStyle = "rgba(3, 6, 7, 0.68)";
      context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      context.fillStyle = "rgba(238, 242, 234, 0.86)";
      context.fillText(hit.point.name, hit.x + 14, hit.y);
    }
  }

  private drawReticle(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.save();
    context.strokeStyle = "rgba(248, 203, 101, 0.34)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(width / 2 - 8, height / 2);
    context.lineTo(width / 2 + 8, height / 2);
    context.moveTo(width / 2, height / 2 - 8);
    context.lineTo(width / 2, height / 2 + 8);
    context.stroke();
    context.restore();
  }

  private mergedPoints(observer: Body): SkyPoint[] {
    const merged = new Map<string, SkyPoint>();
    for (const point of this.catalogPoints) merged.set(point.key, { ...point, dynamic: false });
    for (const body of this.options.bodyByKey().values()) {
      if (body.key === observer.key || !bodyCanObserveSky(body)) continue;
      const direction = relativeDirection(bodyVector(observer), bodyVector(body));
      if (!direction) continue;
      merged.set(body.key, {
        key: body.key,
        name: body.name,
        object_type: body.object_type,
        catalog_group: body.catalog_group,
        color: body.color,
        apparent_magnitude: body.stellar?.apparent_magnitude ?? body.deep_sky?.apparent_magnitude,
        direction,
        dynamic: isDynamicBody(body),
      });
    }
    merged.delete(observer.key);
    return [...merged.values()].sort((a, b) => Number(a.dynamic) - Number(b.dynamic));
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.active) return;
    const point = this.canvasPoint(event);
    this.pointers.set(event.pointerId, point);
    try { this.options.canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic events may not own capture. */ }
    this.dragMoved = false;
    this.lastPointer = point;
    if (this.pointers.size >= 2) {
      this.pinch = { distance: pointerDistance(this.pointers), fovDeg: this.camera.fovDeg };
      this.dragMoved = true;
    }
    this.options.canvas.style.cursor = "grabbing";
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2 && this.pinch) {
      const distance = pointerDistance(this.pointers);
      if (distance > 0) this.camera = normalizeCamera({ ...this.camera, fovDeg: this.pinch.fovDeg * this.pinch.distance / distance });
      this.hideTooltip();
      this.requestRender();
      event.preventDefault();
      return;
    }
    if (this.pointers.size === 1 && this.lastPointer) {
      const dx = point.x - this.lastPointer.x;
      const dy = point.y - this.lastPointer.y;
      if (Math.hypot(dx, dy) > 1) this.dragMoved = true;
      const degreesPerPixel = this.camera.fovDeg / Math.max(240, Math.min(this.options.canvas.clientWidth, this.options.canvas.clientHeight));
      this.camera = normalizeCamera({
        ...this.camera,
        yawDeg: this.camera.yawDeg - dx * degreesPerPixel,
        pitchDeg: this.camera.pitchDeg + dy * degreesPerPixel,
      });
      this.lastPointer = point;
      this.hideTooltip();
      this.requestRender();
      return;
    }
    this.showTooltipAt(point);
  }

  private pointerUp(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    const wasActive = this.pointers.delete(event.pointerId);
    try { this.options.canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be gone. */ }
    if (!wasActive) return;
    if (this.pointers.size === 1) this.lastPointer = [...this.pointers.values()][0] ?? null;
    else if (this.pointers.size === 0) {
      if (!this.dragMoved && event.type === "pointerup") void this.selectAt(point);
      this.lastPointer = null;
      this.pinch = null;
      this.options.canvas.style.cursor = "grab";
      this.options.stateChanged("replace");
    }
  }

  private wheel(event: WheelEvent): void {
    if (!this.active) return;
    event.preventDefault();
    this.camera = normalizeCamera({ ...this.camera, fovDeg: this.camera.fovDeg * Math.exp(event.deltaY * 0.0015) });
    this.options.stateChanged("replace");
    this.requestRender();
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.active) return;
    const step = event.shiftKey ? 10 : 3;
    if (event.key === "Escape") { this.close(); return; }
    if (event.key === "ArrowLeft") this.camera.yawDeg -= step;
    else if (event.key === "ArrowRight") this.camera.yawDeg += step;
    else if (event.key === "ArrowUp") this.camera.pitchDeg += step;
    else if (event.key === "ArrowDown") this.camera.pitchDeg -= step;
    else if (event.key === "+" || event.key === "=") this.camera.fovDeg -= step;
    else if (event.key === "-" || event.key === "_") this.camera.fovDeg += step;
    else return;
    event.preventDefault();
    this.camera = normalizeCamera(this.camera);
    this.options.stateChanged("replace");
    this.requestRender();
  }

  private async selectAt(point: { x: number; y: number }): Promise<void> {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) return;
    this.options.status.textContent = this.options.translate("sky.selecting", { name: hit.point.name });
    await this.options.selectBody(hit.point.key);
    if (this.active) this.options.status.textContent = this.options.translate("sky.ready", { count: this.catalogPoints.length });
  }

  private showTooltipAt(point: { x: number; y: number }): void {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) { this.hideTooltip(); return; }
    this.options.tooltip.textContent = hit.point.name;
    this.options.tooltip.style.setProperty("--sky-tooltip-x", `${hit.x}px`);
    this.options.tooltip.style.setProperty("--sky-tooltip-y", `${hit.y}px`);
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

export function createSkyViewController(dom: typeof atlasDom, options: SkyViewIntegrationOptions): SkyViewController {
  return new SkyViewController({
    ...options,
    root: dom.skyView,
    canvas: dom.skyCanvas,
    title: dom.skyTitle,
    meta: dom.skyMeta,
    status: dom.skyStatus,
    tooltip: dom.skyTooltip,
    closeButton: dom.skyClose,
    resetButton: dom.skyReset,
  });
}

export function bodyCanObserveSky(body: Body): boolean {
  const position = body.position;
  if (![position.x_au, position.y_au, position.z_au].every(Number.isFinite)) return false;
  if (body.key === "sun") return true;
  return Math.hypot(position.x_au, position.y_au, position.z_au) > 1e-12;
}

function isDynamicBody(body: Body): boolean {
  return Boolean(body.state_vector || body.catalog?.dynamic_position || [
    "core", "mars_moons", "jupiter_major_moons", "saturn_major_moons", "jpl_small_bodies",
  ].includes(body.catalog_group ?? ""));
}

function bodyVector(body: Body): Vector3 {
  return { x: body.position.x_au, y: body.position.y_au, z: body.position.z_au };
}

function validCatalogPoint(point: CatalogSkyPoint): boolean {
  return Boolean(point && point.key && point.name && point.direction &&
    [point.direction.x, point.direction.y, point.direction.z].every(Number.isFinite));
}

function validColor(value: string | null | undefined): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function pointRadius(point: SkyPoint): number {
  if (point.dynamic) return point.object_type === "star" ? 5 : 4;
  const magnitude = point.apparent_magnitude;
  if (!Number.isFinite(magnitude)) return 1.15;
  return Math.max(0.7, Math.min(4.5, 3.2 - Number(magnitude) * 0.18));
}

function starOpacity(magnitude: number | null | undefined): number {
  if (!Number.isFinite(magnitude)) return 0.72;
  return Math.max(0.38, Math.min(1, 1.08 - Number(magnitude) * 0.025));
}

function numericMagnitude(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;
}

function pointerDistance(pointers: ReadonlyMap<number, { x: number; y: number }>): number {
  const [first, second] = [...pointers.values()];
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
}

function nearestHit(hits: RenderedHit[], point: { x: number; y: number }): RenderedHit | null {
  let nearest: RenderedHit | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const nextDistance = Math.hypot(hit.x - point.x, hit.y - point.y);
    if (nextDistance <= hit.radius && nextDistance < distance) {
      nearest = hit;
      distance = nextDistance;
    }
  }
  return nearest;
}

function overlaps(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
