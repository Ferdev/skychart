import type { Body, Ephemeris } from "../atlas/contracts";
import type { atlasDom } from "../atlas/atlasDom";
import { trackEvent } from "../analytics";
import {
  buildSkyPermalink,
  normalizeSkyViewState,
  SKY_OBJECT_TYPES,
  type SkyObjectType,
  type SkyPermalinkState,
  type SkyShareLocale,
  type SkyViewState,
} from "../viewState";
import { CONSTELLATIONS } from "./constellations";
import {
  cameraForDirection,
  directionFromEcliptic,
  normalizeCamera,
  projectDirection,
  relativeDirection,
  type SkyCamera,
  type Vector3,
} from "./skyProjection";
import { skyPointAppearance } from "./skyPointAppearance";

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
  layerControls: HTMLDetailsElement;
  objectTypeFilters: HTMLElement;
  constellationsToggle: HTMLInputElement;
  shareButton: HTMLButtonElement;
  sharePopover: HTMLElement;
  shareCloseButton: HTMLButtonElement;
  sharePreview: HTMLCanvasElement;
  copyLinkButton: HTMLButtonElement;
  nativeShareButton: HTMLButtonElement;
  downloadCardButton: HTMLButtonElement;
  shareStatus: HTMLElement;
  errorPanel: HTMLElement;
  errorTitle: HTMLElement;
  errorMessage: HTMLElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  workspacePanel: HTMLElement;
  selectedObjectPanel: HTMLElement;
  bodyByKey: () => ReadonlyMap<string, Body>;
  ephemeris: () => Ephemeris | null;
  translate: (key: string, params?: Record<string, string | number>) => string;
  selectBody: (key: string) => Promise<void>;
  stateChanged: (mode: "push" | "replace") => void;
  resolveObserver: (key: string) => Promise<Body | null>;
  catalogRelease: () => string | undefined;
  locale: () => SkyShareLocale;
};

type SkyViewIntegrationOptions = Pick<SkyViewControllerOptions,
  "bodyByKey" | "ephemeris" | "translate" | "selectBody" | "stateChanged" | "resolveObserver" | "catalogRelease" | "locale">;

const DEFAULT_FOV_DEG = 72;
const MAX_LABELS = 28;
const SKY_POINT_LIMIT = 12_000;
const SKY_OBJECT_TYPE_ORDER = new Map<string, number>(SKY_OBJECT_TYPES.map((type, index) => [type, index]));
const OBJECT_TYPE_LABEL_KEYS: Readonly<Record<string, string>> = {
  star: "type.star",
  planet: "type.planet",
  moon: "type.moon",
  dwarf_planet: "type.dwarfPlanet",
  galaxy: "type.galaxy",
  quasar: "type.quasar",
  active_galaxy: "type.activeGalaxy",
  black_hole: "type.blackHole",
  pulsar: "type.pulsar",
  nebula: "type.nebula",
  star_cluster: "type.starCluster",
  xray_source: "type.xraySource",
  xray_extended: "type.xrayExtended",
  asterism: "type.asterism",
  milky_way_patch: "type.milkyWayPatch",
  asteroid: "type.asteroid",
  comet: "type.comet",
  small_body: "type.smallBody",
  unknown: "type.object",
};

type SkyShareSnapshot = {
  state: SkyPermalinkState;
  observer: Body;
  url: string;
  card: Blob | null;
};

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
  private readonly visibleObjectTypes = new Map<string, boolean>();
  private shareSnapshot: SkyShareSnapshot | null = null;
  private shareStatusTimer: number | null = null;

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
    options.constellationsToggle.addEventListener("change", () => {
      this.options.stateChanged("replace");
      this.requestRender();
    });
    options.objectTypeFilters.addEventListener("change", (event) => this.objectTypeFilterChanged(event));
    options.shareButton.addEventListener("click", () => void this.toggleSharePanel());
    options.shareCloseButton.addEventListener("click", () => this.closeSharePanel());
    options.copyLinkButton.addEventListener("click", () => void this.copyViewpointLink());
    options.nativeShareButton.addEventListener("click", () => void this.nativeShare());
    options.downloadCardButton.addEventListener("click", () => void this.downloadCard());
    options.sharePopover.addEventListener("toggle", () => {
      options.shareButton.setAttribute("aria-expanded", String(options.sharePopover.matches(":popover-open")));
    });
    new MutationObserver(() => {
      if (options.workspacePanel.hidden) this.hideObjectInspector();
    }).observe(options.workspacePanel, { attributes: true, attributeFilter: ["hidden"] });
    options.nativeShareButton.hidden = typeof navigator.share !== "function";
    window.addEventListener("resize", () => this.requestRender());
    window.addEventListener("cosmic-atlas:locale-change", () => this.updateLocale());
  }

  get active(): boolean {
    return !this.options.root.hidden && this.observer !== null;
  }

  state(): SkyViewState | undefined {
    if (!this.active || !this.observer) return undefined;
    return normalizeSkyViewState({
      observerKey: this.observer.key,
      ...normalizeCamera(this.camera),
      constellations: this.options.constellationsToggle.checked,
      hiddenObjectTypes: this.hiddenObjectTypes(),
    }) ?? undefined;
  }

  observerBody(): Body | null {
    return this.currentObserver();
  }

  async open(observer: Body, restoredCamera?: Omit<SkyViewState, "observerKey">): Promise<void> {
    if (!bodyCanObserveSky(observer)) {
      this.showUnavailable(this.options.translate("sky.positionUnavailable"));
      return;
    }
    this.observer = observer;
    this.catalogPoints = [];
    this.camera = restoredCamera ? normalizeCamera(restoredCamera) : this.initialCamera(observer);
    this.hideObjectInspector();
    this.options.layerControls.open = false;
    this.visibleObjectTypes.clear();
    for (const type of restoredCamera?.hiddenObjectTypes ?? []) this.visibleObjectTypes.set(type, false);
    this.options.constellationsToggle.checked = restoredCamera?.constellations ?? true;
    this.options.errorPanel.hidden = true;
    this.shareSnapshot = null;
    this.options.root.hidden = false;
    document.body.dataset.skyView = "true";
    this.updateChrome();
    this.updateFilterControls();
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
      this.showUnavailable(observer
        ? this.options.translate("sky.positionUnavailable")
        : this.options.translate("sky.observerUnavailable", { key: state.observerKey }));
      return;
    }
    await this.open(observer, state);
  }

  close(options: { updateHistory?: boolean } = {}): void {
    if (this.options.root.hidden) return;
    this.requestId += 1;
    this.closeSharePanel();
    this.options.root.hidden = true;
    this.hideObjectInspector();
    delete document.body.dataset.skyView;
    this.hideTooltip();
    this.renderedHits = [];
    this.catalogPoints = [];
    this.observer = null;
    this.shareSnapshot = null;
    if (options.updateHistory !== false) this.options.stateChanged("push");
  }

  closeForAtlasNavigation(navigate: () => void): void {
    const wasActive = this.active;
    this.close({ updateHistory: false });
    navigate();
    if (wasActive) this.options.stateChanged("push");
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
    this.updateFilterControls();
    this.options.status.textContent = this.options.translate("sky.ready", { count: this.catalogPoints.length });
    this.requestRender();
  }

  showUnavailable(message: string): void {
    this.requestId += 1;
    this.observer = null;
    this.catalogPoints = [];
    this.renderedHits = [];
    this.shareSnapshot = null;
    this.hideObjectInspector();
    this.options.root.hidden = false;
    this.options.errorPanel.hidden = false;
    this.options.errorTitle.textContent = this.options.translate("sky.unavailableTitle");
    this.options.errorMessage.textContent = message;
    document.body.dataset.skyView = "true";
    this.options.closeButton.focus({ preventScroll: true });
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
    this.updateFilterControls();
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
    this.renderScene(context, width, height, this.camera, true);
  }

  private renderScene(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    camera: SkyCamera,
    recordHits: boolean,
  ): void {
    const observer = this.currentObserver();
    if (!observer) return;
    const background = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.72);
    background.addColorStop(0, "#0c1519");
    background.addColorStop(0.5, "#080d11");
    background.addColorStop(1, "#030506");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    this.drawGrid(context, width, height, camera);
    const points = this.mergedPoints(observer);
    this.drawConstellations(context, points, width, height, camera);
    this.drawPoints(context, points, width, height, camera, recordHits);
    this.drawReticle(context, width, height);
  }

  private drawGrid(context: CanvasRenderingContext2D, width: number, height: number, camera: SkyCamera): void {
    context.save();
    context.lineWidth = 1;
    for (let longitude = 0; longitude < 360; longitude += 30) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 73 }, (_, index) =>
        directionFromEcliptic(longitude, -90 + index * 2.5)), longitude % 90 === 0 ? 0.2 : 0.1, camera);
    }
    for (const latitude of [-60, -30, 0, 30, 60]) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 145 }, (_, index) =>
        directionFromEcliptic(index * 2.5, latitude)), latitude === 0 ? 0.28 : 0.12, camera);
    }
    context.restore();
  }

  private drawDirectionLine(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    directions: Vector3[],
    opacity: number,
    camera: SkyCamera,
  ): void {
    context.beginPath();
    context.strokeStyle = `rgba(116, 184, 183, ${opacity})`;
    let previous: { x: number; y: number } | null = null;
    for (const direction of directions) {
      const projected = projectDirection(direction, camera, width, height);
      if (!projected || (previous && Math.hypot(projected.x - previous.x, projected.y - previous.y) > width * 0.3)) {
        previous = null;
        continue;
      }
      if (previous) context.lineTo(projected.x, projected.y); else context.moveTo(projected.x, projected.y);
      previous = projected;
    }
    context.stroke();
  }

  private drawConstellations(
    context: CanvasRenderingContext2D,
    points: SkyPoint[],
    width: number,
    height: number,
    camera: SkyCamera,
  ): void {
    if (!this.options.constellationsToggle.checked) return;
    const pointByKey = new Map(points.map((point) => [point.key, point]));
    const labels: Array<{ name: string; x: number; y: number }> = [];
    context.save();
    context.strokeStyle = "rgba(248, 203, 101, 0.48)";
    context.lineWidth = 1.15;
    context.lineJoin = "round";
    for (const constellation of CONSTELLATIONS) {
      const visibleEndpoints = new Map<string, { x: number; y: number }>();
      for (const polyline of constellation.polylines) {
        context.beginPath();
        let connected = false;
        for (const key of polyline) {
          const point = pointByKey.get(key);
          const projected = point ? projectDirection(point.direction, camera, width, height) : null;
          if (!projected) {
            connected = false;
            continue;
          }
          if (connected) context.lineTo(projected.x, projected.y);
          else context.moveTo(projected.x, projected.y);
          connected = true;
          visibleEndpoints.set(key, projected);
        }
        context.stroke();
      }
      if (visibleEndpoints.size >= 2) {
        const endpoints = [...visibleEndpoints.values()];
        labels.push({
          name: constellation.name,
          x: endpoints.reduce((sum, point) => sum + point.x, 0) / endpoints.length,
          y: endpoints.reduce((sum, point) => sum + point.y, 0) / endpoints.length,
        });
      }
    }
    context.restore();
    this.drawConstellationLabels(context, labels, width, height);
  }

  private drawConstellationLabels(
    context: CanvasRenderingContext2D,
    labels: Array<{ name: string; x: number; y: number }>,
    width: number,
    height: number,
  ): void {
    const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    context.save();
    context.font = "700 10px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const label of labels) {
      const labelWidth = context.measureText(label.name).width + 12;
      const rect = {
        left: label.x - labelWidth / 2,
        top: label.y - 10,
        right: label.x + labelWidth / 2,
        bottom: label.y + 10,
      };
      if (rect.left < 8 || rect.right > width - 8 || rect.top < 72 || rect.bottom > height - 48) continue;
      if (occupied.some((item) => overlaps(item, rect))) continue;
      occupied.push(rect);
      context.fillStyle = "rgba(3, 6, 7, 0.72)";
      context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      context.fillStyle = "rgba(248, 203, 101, 0.76)";
      context.fillText(label.name, label.x, label.y);
    }
    context.restore();
  }

  private drawPoints(
    context: CanvasRenderingContext2D,
    points: SkyPoint[],
    width: number,
    height: number,
    camera: SkyCamera,
    recordHits: boolean,
  ): void {
    const hits: RenderedHit[] = [];
    const labelCandidates: RenderedHit[] = [];
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const point of points) {
      if (!this.objectTypeVisible(point)) continue;
      const projected = projectDirection(point.direction, camera, width, height);
      if (!projected) continue;
      const appearance = skyPointAppearance(point);
      if (appearance.glowRadius > 0) {
        const glow = context.createRadialGradient(
          projected.x,
          projected.y,
          0,
          projected.x,
          projected.y,
          appearance.glowRadius,
        );
        glow.addColorStop(0, appearance.glowColors.inner);
        glow.addColorStop(0.28, appearance.glowColors.middle);
        glow.addColorStop(1, appearance.glowColors.outer);
        context.beginPath();
        context.fillStyle = glow;
        context.arc(projected.x, projected.y, appearance.glowRadius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = appearance.opacity;
      context.beginPath();
      context.fillStyle = appearance.color;
      context.arc(projected.x, projected.y, appearance.coreRadius, 0, Math.PI * 2);
      context.fill();
      if (appearance.brightCore) {
        context.globalAlpha = Math.min(1, appearance.opacity + 0.18);
        context.beginPath();
        context.fillStyle = "#fffef8";
        context.arc(projected.x, projected.y, Math.min(0.48, appearance.coreRadius * 0.38), 0, Math.PI * 2);
        context.fill();
      }
      const hit = { point, x: projected.x, y: projected.y, radius: Math.max(7, appearance.coreRadius + 4) };
      hits.push(hit);
      if (point.dynamic || (Number.isFinite(point.apparent_magnitude) && Number(point.apparent_magnitude) <= 4.5)) labelCandidates.push(hit);
    }
    context.restore();
    if (recordHits) this.renderedHits = hits;
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

  private updateFilterControls(): void {
    const observer = this.currentObserver();
    if (!observer) return;
    const counts = new Map<string, number>();
    for (const point of this.mergedPoints(observer)) {
      const type = skyObjectType(point);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const types = [...new Set<string>([...SKY_OBJECT_TYPES, ...counts.keys()])].sort((a, b) =>
      (SKY_OBJECT_TYPE_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (SKY_OBJECT_TYPE_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      this.objectTypeLabel(a).localeCompare(this.objectTypeLabel(b)));
    const fragment = document.createDocumentFragment();
    for (const type of types) {
      const label = document.createElement("label");
      label.className = "sky-view__filter";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "sky-object-type";
      input.value = type;
      input.dataset.skyObjectType = type;
      input.checked = this.visibleObjectTypes.get(type) !== false;
      const text = document.createElement("span");
      text.textContent = this.objectTypeLabel(type);
      const count = document.createElement("span");
      count.className = "sky-view__filter-count";
      count.textContent = String(counts.get(type) ?? 0);
      label.append(input, text, count);
      fragment.append(label);
    }
    this.options.objectTypeFilters.replaceChildren(fragment);
  }

  private objectTypeFilterChanged(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.skyObjectType) return;
    this.visibleObjectTypes.set(input.dataset.skyObjectType, input.checked);
    this.hideTooltip();
    this.options.stateChanged("replace");
    this.requestRender();
  }

  private hiddenObjectTypes(): SkyObjectType[] {
    return SKY_OBJECT_TYPES.filter((type) => this.visibleObjectTypes.get(type) === false).sort();
  }

  private async toggleSharePanel(): Promise<void> {
    if (this.options.sharePopover.matches(":popover-open")) {
      this.closeSharePanel();
      return;
    }
    const observer = this.currentObserver();
    const sky = this.state();
    const epochUtc = this.options.ephemeris()?.timestamp_utc;
    if (!observer || !sky || !epochUtc || Number.isNaN(Date.parse(epochUtc))) {
      this.setShareStatus(this.options.translate("sky.shareFailed"));
      return;
    }
    const state: SkyPermalinkState = {
      ...sky,
      epochUtc: new Date(epochUtc).toISOString(),
      catalogRelease: this.options.catalogRelease(),
      locale: this.options.locale(),
    };
    const url = new URL(buildSkyPermalink(state), window.location.origin).toString();
    this.shareSnapshot = { state, observer, url, card: null };
    this.renderShareCard(state, observer);
    this.options.sharePopover.showPopover();
    this.options.shareCloseButton.focus({ preventScroll: true });
  }

  private closeSharePanel(): void {
    if (this.options.sharePopover.matches(":popover-open")) this.options.sharePopover.hidePopover();
    this.options.shareButton.setAttribute("aria-expanded", "false");
  }

  private async copyViewpointLink(): Promise<void> {
    const snapshot = this.shareSnapshot;
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.url);
      this.setShareStatus(this.options.translate("sky.linkCopied"));
      trackEvent("share", { method: "sky_link" });
    } catch {
      this.setShareStatus(this.options.translate("sky.shareFailed"));
    }
  }

  private async nativeShare(): Promise<void> {
    const snapshot = this.shareSnapshot;
    if (!snapshot || !navigator.share) return;
    try {
      const blob = await this.shareCardBlob(snapshot);
      const file = new File([blob], this.cardFilename(snapshot), { type: "image/png" });
      const filePayload = { files: [file], title: this.options.translate("sky.cardTitle", { name: snapshot.observer.name }), text: this.options.translate("sky.shareDescription"), url: snapshot.url };
      if (navigator.canShare?.({ files: [file] })) await navigator.share(filePayload);
      else await navigator.share({ title: filePayload.title, text: filePayload.text, url: snapshot.url });
      this.setShareStatus(this.options.translate("sky.skyShared"));
      trackEvent("share", { method: "sky_native" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.setShareStatus(this.options.translate("sky.shareFailed"));
    }
  }

  private async downloadCard(): Promise<void> {
    const snapshot = this.shareSnapshot;
    if (!snapshot) return;
    this.options.downloadCardButton.disabled = true;
    this.setShareStatus(this.options.translate("sky.preparingCard"), false);
    try {
      const blob = await this.shareCardBlob(snapshot);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = this.cardFilename(snapshot);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      this.setShareStatus(this.options.translate("sky.cardDownloaded"));
      trackEvent("share", { method: "sky_card" });
    } catch {
      this.setShareStatus(this.options.translate("sky.shareFailed"));
    } finally {
      this.options.downloadCardButton.disabled = false;
    }
  }

  private renderShareCard(state: SkyPermalinkState, observer: Body): void {
    const canvas = this.options.sharePreview;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Sky share preview canvas unavailable");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    this.renderScene(context, canvas.width, canvas.height, state, false);

    const topShade = context.createLinearGradient(0, 0, 0, 250);
    topShade.addColorStop(0, "rgba(2, 5, 6, 0.96)");
    topShade.addColorStop(1, "rgba(2, 5, 6, 0)");
    context.fillStyle = topShade;
    context.fillRect(0, 0, canvas.width, 250);
    const bottomShade = context.createLinearGradient(0, 350, 0, canvas.height);
    bottomShade.addColorStop(0, "rgba(2, 5, 6, 0)");
    bottomShade.addColorStop(1, "rgba(2, 5, 6, 0.98)");
    context.fillStyle = bottomShade;
    context.fillRect(0, 350, canvas.width, canvas.height - 350);

    context.textBaseline = "top";
    context.fillStyle = "#82cbb3";
    context.font = "800 20px system-ui, sans-serif";
    context.fillText("COSMIC ATLAS · SKYCHART.ORG", 64, 46);
    context.fillStyle = "#f3eedf";
    drawFittedText(context, this.options.translate("sky.cardTitle", { name: observer.name }), 64, 86, 940, 54);
    context.fillStyle = "rgba(238, 242, 234, 0.86)";
    context.font = "650 23px system-ui, sans-serif";
    context.fillText(`UTC ${state.epochUtc}`, 64, 158);
    context.fillStyle = "rgba(248, 203, 101, 0.92)";
    context.font = "650 21px system-ui, sans-serif";
    context.fillText(this.distanceContext(observer), 64, 526);
    context.fillStyle = "rgba(238, 242, 234, 0.72)";
    context.font = "500 17px system-ui, sans-serif";
    context.fillText(this.options.translate("sky.cardDisclosure"), 64, 570, 1070);
  }

  private shareCardBlob(snapshot: SkyShareSnapshot): Promise<Blob> {
    if (snapshot.card) return Promise.resolve(snapshot.card);
    return new Promise<Blob>((resolve, reject) => {
      this.options.sharePreview.toBlob((blob) => {
        if (!blob) { reject(new Error("Unable to encode Sky share card")); return; }
        snapshot.card = blob;
        resolve(blob);
      }, "image/png");
    });
  }

  private distanceContext(observer: Body): string {
    const distanceKm = observer.distance_from_earth_km;
    if (!Number.isFinite(distanceKm) || Number(distanceKm) < 0) return this.options.translate("sky.distanceUnknown");
    if (Number(distanceKm) < 1) return this.options.translate("sky.distanceEarth");
    const distanceAu = Number(distanceKm) / 149_597_870.7;
    if (distanceAu < 100_000) return this.options.translate("sky.distanceAu", { distance: formatCardNumber(distanceAu) });
    return this.options.translate("sky.distanceLy", { distance: formatCardNumber(Number(distanceKm) / 9_460_730_472_580.8) });
  }

  private cardFilename(snapshot: SkyShareSnapshot): string {
    const slug = slugify(snapshot.observer.name) || slugify(snapshot.observer.key) || "observer";
    return `cosmic-atlas-sky-from-${slug}-${snapshot.state.epochUtc.slice(0, 10)}.png`;
  }

  private setShareStatus(message: string, clear = true): void {
    if (this.shareStatusTimer !== null) window.clearTimeout(this.shareStatusTimer);
    this.options.shareStatus.textContent = message;
    this.shareStatusTimer = clear ? window.setTimeout(() => {
      this.options.shareStatus.textContent = "";
      this.shareStatusTimer = null;
    }, 3_500) : null;
  }

  private objectTypeVisible(point: SkyPoint): boolean {
    return this.visibleObjectTypes.get(skyObjectType(point)) !== false;
  }

  private objectTypeLabel(type: string): string {
    const key = OBJECT_TYPE_LABEL_KEYS[type];
    if (key) return this.options.translate(key);
    return type.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    if (!this.active) return;
    if (!this.options.selectedObjectPanel.hidden && this.options.selectedObjectPanel.dataset.selectedKey === hit.point.key) {
      this.options.root.dataset.objectInspector = "true";
    }
    this.options.status.textContent = this.options.translate("sky.ready", { count: this.catalogPoints.length });
  }

  private hideObjectInspector(): void {
    delete this.options.root.dataset.objectInspector;
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
    layerControls: dom.skyLayerControls,
    objectTypeFilters: dom.skyObjectTypeFilters,
    constellationsToggle: dom.skyConstellationsToggle,
    shareButton: dom.skyShareButton,
    sharePopover: dom.skySharePopover,
    shareCloseButton: dom.skyShareClose,
    sharePreview: dom.skySharePreview,
    copyLinkButton: dom.skyCopyLink,
    nativeShareButton: dom.skyNativeShare,
    downloadCardButton: dom.skyDownloadCard,
    shareStatus: dom.skyShareStatus,
    errorPanel: dom.skyError,
    errorTitle: dom.skyErrorTitle,
    errorMessage: dom.skyErrorMessage,
    closeButton: dom.skyClose,
    resetButton: dom.skyReset,
    workspacePanel: dom.workspacePanel,
    selectedObjectPanel: dom.selectedObjectPanel,
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

function skyObjectType(point: Pick<SkyPoint, "object_type">): string {
  const type = point.object_type?.trim().toLowerCase();
  return type || "unknown";
}

function validCatalogPoint(point: CatalogSkyPoint): boolean {
  return Boolean(point && point.key && point.name && point.direction &&
    [point.direction.x, point.direction.y, point.direction.z].every(Number.isFinite));
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

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  initialSize: number,
): void {
  let size = initialSize;
  do {
    context.font = `750 ${size}px Georgia, serif`;
    if (context.measureText(text).width <= maxWidth || size <= 30) break;
    size -= 2;
  } while (size > 30);
  context.fillText(text, x, y, maxWidth);
}

function slugify(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function formatCardNumber(value: number): string {
  if (!Number.isFinite(value)) return "unknown";
  if (Math.abs(value) >= 10_000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value);
}
