import type { Body } from "../atlas/contracts";
import type { atlasDom } from "../atlas/atlasDom";
import { trackEvent } from "../analytics";
import { moveUniversePosition, universeEntryState, type UniverseMove } from "../navigation/universeNavigation";
import { bodyCanObserveSky, bodyVector, isDynamicBody } from "../sky/skyBody";
import { skyPointAppearance } from "../sky/skyPointAppearance";
import { SkySelectionConnectorView } from "../sky/skySelectionConnectorView";
import {
  cameraForDirection,
  createSkyProjector,
  directionFromEcliptic,
  normalizeCamera,
  relativeDirection,
  type SkyCamera,
  type Vector3,
} from "../sky/skyProjection";
import { normalizeUniverseViewState, type UniverseViewState } from "../viewState";
import { UniversePointRenderer, type UniverseScreenPoint } from "./universePointRenderer";
import { observerApparentMagnitude, rankUniverseLabels } from "./universePhotometry";
import { UniverseDestinationSearch } from "./universeDestinationSearch";
import { AU_KM, projectPhysicalBody, safeUniverseEntryPosition } from "./universeBodyGeometry";
import { UniverseBodyRenderer } from "./universeBodyRenderer";

type CatalogUniversePoint = {
  key: string;
  name: string;
  object_type?: string | null;
  catalog_group?: string | null;
  source_type?: string | null;
  position_model?: string | null;
  color?: string | null;
  apparent_magnitude?: number | null;
  direction: Vector3;
  distance_au?: number | null;
};

type UniversePoint = Omit<CatalogUniversePoint, "distance_au" | "direction"> & {
  position: Vector3;
  dynamic: boolean;
  absoluteMagnitudeH?: number | null;
  radiusKm?: number | null;
};

type RenderedHit = { point: UniversePoint; x: number; y: number; radius: number };
type RenderedLabel = RenderedHit & { magnitude: number | null; distance: number };
type Projector = ReturnType<typeof createSkyProjector>;

type UniverseViewOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  pointsCanvas: HTMLCanvasElement;
  bodiesCanvas: HTMLCanvasElement;
  toggleButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  findButton: HTMLButtonElement;
  searchDialog: HTMLDialogElement;
  searchCloseButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  searchResults: HTMLElement;
  positionLabel: HTMLElement;
  selectionSummary: HTMLElement;
  speedLabel: HTMLOutputElement;
  speedInput: HTMLInputElement;
  autopilotButton: HTMLButtonElement;
  selectionConnector: SVGSVGElement;
  workspacePanel: HTMLElement;
  selectedObjectPanel: HTMLElement;
  status: HTMLElement;
  tooltip: HTMLElement;
  targetPanel: HTMLElement;
  targetName: HTMLElement;
  targetMeta: HTMLElement;
  targetMagnitude: HTMLElement;
  focusButton: HTMLButtonElement;
  inspectButton: HTMLButtonElement;
  skyButton: HTMLButtonElement;
  bodyByKey: () => ReadonlyMap<string, Body>;
  selectedBody: () => Body | null;
  translate: (key: string, params?: Record<string, string | number>) => string;
  selectBody: (key: string) => Promise<void>;
  inspectInAtlas: (key: string) => void;
  searchDestinations: (query: string, signal: AbortSignal) => Promise<Body[]>;
  openSky: (body: Body) => Promise<void>;
  stateChanged: (mode: "push" | "replace") => void;
  closeSky: () => void;
  resumeAtlas: () => void;
  initialState: () => UniverseViewState;
};

type UniverseIntegrationOptions = Pick<UniverseViewOptions,
  "bodyByKey" | "selectedBody" | "translate" | "selectBody" | "inspectInAtlas" | "searchDestinations" | "openSky" | "stateChanged" | "closeSky" | "resumeAtlas" | "initialState">;

const DEFAULT_CAMERA: SkyCamera = { yawDeg: 180, pitchDeg: 0, fovDeg: 72 };
const CATALOG_LIMIT = 12_000;
const MAX_FLIGHT_POINTS = 1_500;
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
  private landmarkPoints: UniversePoint[] = [];
  private landmarksLoaded = false;
  private flightCatalogPoints: UniversePoint[] = [];
  private target: UniversePoint | null = null;
  private targetKey: string | null = null;
  private renderedHits: RenderedHit[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPointer: { x: number; y: number } | null = null;
  private dragMoved = false;
  private renderFrame: number | null = null;
  private backdropCanvas: HTMLCanvasElement | null = null;
  private backdropKey = "";
  private baseRenderKey = "";
  private pointRenderer: UniversePointRenderer;
  private bodyRenderer: UniverseBodyRenderer;
  private readonly collectPerformance = new URLSearchParams(window.location.search).has("perf");
  private requestId = 0;
  private catalogAbort: AbortController | null = null;
  private readonly destinationSearch: UniverseDestinationSearch;
  private reloadTimer: number | null = null;
  private heldMoves = new Set<UniverseMove>();
  private flightFrame: number | null = null;
  private flightStartedAt = 0;
  private lastFlightAt = 0;
  private lastFlightUiAt = 0;
  private shiftHeld = false;
  private controlPointer: number | null = null;
  private pointerMovement: UniverseMove | null = null;
  private autopilot = false;
  private autopilotStandoffAu = 0;
  private readonly selectionConnector: SkySelectionConnectorView;

  constructor(private readonly options: UniverseViewOptions) {
    this.pointRenderer = new UniversePointRenderer(options.pointsCanvas);
    this.bodyRenderer = new UniverseBodyRenderer(options.bodiesCanvas);
    this.selectionConnector = new SkySelectionConnectorView({
      element: options.selectionConnector, canvas: options.canvas, workspacePanel: options.workspacePanel,
    });
    options.toggleButton.addEventListener("click", () => this.open(options.initialState()));
    options.closeButton.addEventListener("click", () => this.close());
    options.resetButton.addEventListener("click", () => this.reset());
    this.destinationSearch = new UniverseDestinationSearch({
      findButton: options.findButton, dialog: options.searchDialog, closeButton: options.searchCloseButton,
      input: options.searchInput, results: options.searchResults, active: () => this.active,
      translate: options.translate, search: options.searchDestinations,
      eligible: (body) => bodyToUniversePoint(body) !== null,
      choose: (body) => { const point = bodyToUniversePoint(body); if (point) void this.chooseDestination(point); },
    });
    options.focusButton.addEventListener("click", () => this.focusTarget());
    options.inspectButton.addEventListener("click", () => this.inspectInAtlas());
    options.skyButton.addEventListener("click", () => this.skyFromTarget());
    options.autopilotButton.addEventListener("click", () => this.toggleAutopilot());
    options.speedInput.addEventListener("change", () => this.setSpeedFromInput());
    options.root.addEventListener("click", (event) => this.controlClick(event));
    options.root.addEventListener("pointerdown", (event) => this.controlPointerDown(event));
    options.root.addEventListener("pointerup", (event) => this.controlPointerUp(event));
    options.root.addEventListener("pointercancel", (event) => this.controlPointerUp(event));
    options.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    options.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    options.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
    options.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    options.canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    options.canvas.addEventListener("keydown", (event) => this.keyDown(event));
    window.addEventListener("keyup", (event) => this.keyUp(event));
    window.addEventListener("blur", () => this.stopFlight());
    window.addEventListener("resize", () => this.requestRender());
    new MutationObserver(() => {
      if (options.workspacePanel.hidden) this.hideObjectInspector();
    }).observe(options.workspacePanel, { attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("cosmic-atlas:locale-change", () => this.updateChrome());
  }

  get active(): boolean { return !this.options.root.hidden; }

  state(): UniverseViewState | undefined {
    if (!this.active) return undefined;
    return normalizeUniverseViewState({
      positionAu: { ...this.position },
      ...normalizeCamera(this.camera),
      moveStepAu: this.moveStepAu,
      ...(this.targetKey ? { targetKey: this.targetKey } : {}),
    }) ?? undefined;
  }

  open(state: UniverseViewState, historyMode: "push" | "replace" = "push"): void {
    const normalized = normalizeUniverseViewState(state);
    if (!normalized) return;
    this.options.closeSky();
    this.position = historyMode === "push"
      ? safeUniverseEntryPosition(normalized.positionAu, normalized, this.options.bodyByKey().values())
      : { ...normalized.positionAu };
    this.camera = normalizeCamera(normalized);
    this.moveStepAu = Math.max(normalized.moveStepAu, positionPrecisionStep(this.position));
    const selected = this.options.selectedBody();
    this.targetKey = normalized.targetKey ?? selected?.key ?? null;
    this.target = bodyToUniversePoint(this.targetKey
      ? this.options.bodyByKey().get(this.targetKey) ?? (selected?.key === this.targetKey ? selected : null)
      : null);
    this.autopilot = false;
    this.landmarkPoints = [];
    this.landmarksLoaded = false;
    if (this.target && !this.options.selectedObjectPanel.hidden) this.options.root.dataset.objectInspector = "true";
    else delete this.options.root.dataset.objectInspector;
    this.initialState = { ...normalized, positionAu: { ...this.position } };
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
    this.catalogAbort?.abort();
    this.destinationSearch.close();
    this.catalogAbort = null;
    this.stopFlight();
    this.hideObjectInspector();
    if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.options.root.hidden = true;
    this.baseRenderKey = "";
    delete document.body.dataset.universeView;
    this.hideTooltip();
    this.catalogPoints = [];
    this.landmarkPoints = [];
    this.landmarksLoaded = false;
    this.flightCatalogPoints = [];
    this.target = null;
    this.targetKey = null;
    this.options.targetPanel.hidden = true;
    this.renderedHits = [];
    this.initialState = null;
    if (options.updateHistory !== false) this.options.stateChanged("push");
    this.options.resumeAtlas();
  }

  refreshForTime(): void {
    if (!this.active) return;
    if (this.target?.dynamic) this.target = bodyToUniversePoint(this.options.bodyByKey().get(this.target.key) ?? null);
    this.requestRender();
    void this.loadCatalog();
  }

  private reset(): void {
    if (!this.initialState) return;
    this.stopFlight();
    this.position = { ...this.initialState.positionAu };
    this.camera = normalizeCamera(this.initialState);
    this.moveStepAu = Math.max(this.initialState.moveStepAu, positionPrecisionStep(this.position));
    this.afterNavigation();
    void this.loadCatalog();
  }

  private async loadCatalog(): Promise<void> {
    if (!this.active) return;
    const requestPosition = { ...this.position };
    const localOnly = this.landmarksLoaded;
    const requestId = ++this.requestId;
    this.catalogAbort?.abort();
    const abort = new AbortController();
    this.catalogAbort = abort;
    const params = new URLSearchParams({
      observer_x_au: String(requestPosition.x),
      observer_y_au: String(requestPosition.y),
      observer_z_au: String(requestPosition.z),
      limit: String(localOnly ? 2_000 : CATALOG_LIMIT),
      near_radius_au: String(clamp(this.moveStepAu * 200, 1e7, 1e11)),
      physical_only: "1",
      ...(localOnly ? { local_only: "1" } : {}),
    });
    try {
      const response = await fetch(`/api/catalog/sky?${params.toString()}`, { signal: abort.signal });
      if (!response.ok) throw new Error(`3D catalog returned ${response.status}`);
      const payload = await response.json() as { points?: CatalogUniversePoint[]; nearby_returned?: number };
      if (requestId !== this.requestId || !this.active) return;
      const loaded = (payload.points ?? []).filter(validCatalogPoint).map((point) => ({
        ...point,
        position: {
          x: requestPosition.x + point.direction.x * Number(point.distance_au),
          y: requestPosition.y + point.direction.y * Number(point.distance_au),
          z: requestPosition.z + point.direction.z * Number(point.distance_au),
        },
        dynamic: false,
      }));
      const nearbyCount = Math.min(loaded.length, Math.max(0, payload.nearby_returned ?? loaded.length));
      if (!localOnly) {
        this.landmarkPoints = loaded.slice(nearbyCount);
        this.landmarksLoaded = true;
      }
      const merged = new Map<string, UniversePoint>();
      for (const point of [...loaded.slice(0, nearbyCount), ...this.landmarkPoints]) merged.set(point.key, point);
      this.catalogPoints = [...merged.values()].slice(0, CATALOG_LIMIT);
      this.flightCatalogPoints = sampleDuringFlight(this.catalogPoints,
        nearbyCount, MAX_FLIGHT_POINTS);
      if (this.targetKey) this.target = this.options.bodyByKey().has(this.targetKey)
        ? bodyToUniversePoint(this.options.bodyByKey().get(this.targetKey) ?? null)
        : this.catalogPoints.find((point) => point.key === this.targetKey) ?? null;
      this.options.status.textContent = this.targetKey && !this.target
        ? this.options.translate("universe3d.targetUnavailable", { key: this.targetKey })
        : this.options.translate("universe3d.ready", { count: this.catalogPoints.length });
    } catch {
      if (abort.signal.aborted) return;
      if (requestId !== this.requestId || !this.active) return;
      this.options.status.textContent = this.options.translate("universe3d.catalogUnavailable");
    }
    if (this.catalogAbort === abort) this.catalogAbort = null;
    this.baseRenderKey = "";
    this.updateTarget();
    this.requestRender();
  }

  private points(): UniversePoint[] {
    const catalog = this.heldMoves.size > 0 || this.autopilot ? this.flightCatalogPoints : this.catalogPoints;
    const points = new Map<string, UniversePoint>(catalog.map((point) => [point.key, point]));
    if (this.target) points.set(this.target.key, this.target);
    for (const body of this.options.bodyByKey().values()) {
      const point = bodyToUniversePoint(body);
      if (point) points.set(body.key, point);
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
    const renderStarted = performance.now();
    const canvas = this.options.canvas;
    const width = Math.max(1, this.options.root.clientWidth);
    const height = Math.max(1, this.options.root.clientHeight);
    const useWebgl = this.pointRenderer.available;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (!useWebgl && this.heldMoves.size > 0 ? 0.5 : 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const project = createSkyProjector(this.camera, width, height);
    const backdropKey = `${pixelWidth}:${pixelHeight}:${this.camera.yawDeg}:${this.camera.pitchDeg}:${this.camera.fovDeg}`;
    if (this.backdropKey !== backdropKey) {
      const backdrop = this.backdropCanvas ?? document.createElement("canvas");
      backdrop.width = pixelWidth;
      backdrop.height = pixelHeight;
      const backdropContext = backdrop.getContext("2d");
      if (!backdropContext) return;
      backdropContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      const background = backdropContext.createRadialGradient(width * 0.5, height * 0.45, 0,
        width * 0.5, height * 0.45, Math.max(width, height) * 0.75);
      background.addColorStop(0, "#0b1519");
      background.addColorStop(0.52, "#070c10");
      background.addColorStop(1, "#020405");
      backdropContext.fillStyle = background;
      backdropContext.fillRect(0, 0, width, height);
      this.drawOrientationGrid(backdropContext, width, height, project);
      this.backdropCanvas = backdrop;
      this.backdropKey = backdropKey;
    }
    const moving = this.heldMoves.size > 0 || this.autopilot;
    const baseKey = `${backdropKey}:${useWebgl ? moving ? "flight" : `${this.position.x},${this.position.y},${this.position.z}` : "fallback"}`;
    const redrawBase = moving || !useWebgl || this.baseRenderKey !== baseKey;
    if (redrawBase) context.drawImage(this.backdropCanvas!, 0, 0, width, height);
    const baseDone = performance.now();
    const framePoints = this.points();
    const labels = this.drawPoints(context, framePoints, width, height, project, useWebgl, dpr);
    this.bodyRenderer.render(framePoints, this.position, this.camera, width, height, dpr);
    const pointsDone = performance.now();
    if (redrawBase) {
      this.drawLabels(context, labels, width, height);
      drawReticle(context, width, height);
      this.baseRenderKey = baseKey;
    }
    this.updateSelectionConnector();
    if (this.collectPerformance) {
      const debug = window as Window & { __universePerf?: Array<{ base: number; points: number; labels: number; webgl: boolean }> };
      const samples = debug.__universePerf ??= [];
      samples.push({ base: baseDone - renderStarted,
        points: pointsDone - baseDone, labels: performance.now() - pointsDone, webgl: useWebgl });
      if (samples.length > 120) samples.shift();
    }
  }

  private drawOrientationGrid(context: CanvasRenderingContext2D, width: number, height: number, project: Projector): void {
    context.save();
    context.lineWidth = 1;
    for (let longitude = 0; longitude < 360; longitude += 30) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 49 }, (_, index) =>
        directionFromEcliptic(longitude, -90 + index * 3.75)), longitude % 90 === 0 ? 0.2 : 0.08, project);
    }
    for (const latitude of [-60, -30, 0, 30, 60]) {
      this.drawDirectionLine(context, width, height, Array.from({ length: 97 }, (_, index) =>
        directionFromEcliptic(index * 3.75, latitude)), latitude === 0 ? 0.24 : 0.1, project);
    }
    context.restore();
  }

  private drawDirectionLine(context: CanvasRenderingContext2D, width: number, height: number, directions: Vector3[], opacity: number, project: Projector): void {
    context.beginPath();
    context.strokeStyle = `rgba(116, 184, 183, ${opacity})`;
    let previous: { x: number; y: number } | null = null;
    for (const direction of directions) {
      const projected = project(direction);
      if (!projected || (previous && Math.hypot(projected.x - previous.x, projected.y - previous.y) > width * 0.3)) {
        previous = null;
        continue;
      }
      if (previous) context.lineTo(projected.x, projected.y); else context.moveTo(projected.x, projected.y);
      previous = projected;
    }
    context.stroke();
  }

  private drawPoints(context: CanvasRenderingContext2D, points: UniversePoint[], width: number, height: number,
    project: Projector, useWebgl: boolean, dpr: number): RenderedLabel[] {
    const hits: RenderedHit[] = [];
    const labels: RenderedLabel[] = [];
    const screenPoints: UniverseScreenPoint[] = [];
    if (!useWebgl) { context.save(); context.globalCompositeOperation = "lighter"; }
    let lastColor = "";
    let lastOpacity = -1;
    for (const point of points) {
      const projected = project({
        x: point.position.x - this.position.x,
        y: point.position.y - this.position.y,
        z: point.position.z - this.position.z,
      });
      if (!projected) continue;
      const magnitude = observerApparentMagnitude(point, this.position);
      const appearance = skyPointAppearance({ ...point, apparent_magnitude: magnitude });
      const bodyRadius = projectPhysicalBody(point, this.position, this.camera, width, height)?.radiusPx ?? 0;
      if (bodyRadius >= 2.5) { /* A physically sized body is rendered on the sphere layer. */ }
      else if (useWebgl) {
        screenPoints.push({ x: projected.x, y: projected.y, size: appearance.coreRadius * 4,
          opacity: appearance.opacity, color: appearance.color });
      } else {
        if (appearance.glowRadius > 0 && magnitude !== null && magnitude <= 4.5) {
          context.globalAlpha = 1;
          const glow = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, appearance.glowRadius);
          glow.addColorStop(0, appearance.glowColors.inner);
          glow.addColorStop(0.28, appearance.glowColors.middle);
          glow.addColorStop(1, appearance.glowColors.outer);
          context.fillStyle = glow;
          context.beginPath();
          context.arc(projected.x, projected.y, appearance.glowRadius, 0, Math.PI * 2);
          context.fill();
          lastColor = "";
          lastOpacity = -1;
        }
        if (lastOpacity !== appearance.opacity) { context.globalAlpha = appearance.opacity; lastOpacity = appearance.opacity; }
        if (lastColor !== appearance.color) { context.fillStyle = appearance.color; lastColor = appearance.color; }
        if (appearance.coreRadius < 1) {
          context.fillRect(projected.x - 0.5, projected.y - 0.5, 1, 1);
        } else {
          context.beginPath();
          context.arc(projected.x, projected.y, appearance.coreRadius, 0, Math.PI * 2);
          context.fill();
        }
      }
      const hit = { point, x: projected.x, y: projected.y, radius: Math.max(7, appearance.coreRadius + 4, bodyRadius) };
      hits.push(hit);
      labels.push({ ...hit, magnitude, distance: Math.hypot(
        point.position.x - this.position.x, point.position.y - this.position.y, point.position.z - this.position.z,
      ) });
    }
    if (!useWebgl) context.restore();
    this.renderedHits = hits;
    if (useWebgl) this.pointRenderer.render(screenPoints, width, height, dpr);
    return labels;
  }

  private drawLabels(context: CanvasRenderingContext2D, candidates: RenderedLabel[], width: number, height: number): void {
    const selectedKey = this.target?.key;
    const labels = rankUniverseLabels(candidates, this.position, selectedKey);
    const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    context.save();
    context.font = "600 12px system-ui, sans-serif";
    for (const hit of labels) {
      if (occupied.length >= MAX_LABELS) break;
      const label = hit.magnitude === null ? hit.point.name : `${hit.point.name} · ${hit.magnitude.toFixed(1)}`;
      const labelWidth = context.measureText(label).width + 12;
      const rect = { left: hit.x + 8, top: hit.y - 10, right: hit.x + 8 + labelWidth, bottom: hit.y + 10 };
      if (rect.left < 8 || rect.right > width - 8 || rect.top < 72 || rect.bottom > height - 60) continue;
      if (occupied.some((item) => overlaps(item, rect))) continue;
      occupied.push(rect);
      context.fillStyle = "rgba(3, 7, 8, 0.72)";
      context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      context.fillStyle = "rgba(238, 242, 234, 0.84)";
      context.fillText(label, hit.x + 14, hit.y + 4);
    }
    const selected = this.renderedHits.find((hit) => hit.point.key === selectedKey);
    if (selected) {
      context.beginPath();
      context.arc(selected.x, selected.y, Math.max(11, selected.radius + 3), 0, Math.PI * 2);
      context.strokeStyle = "#f8cb65";
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.restore();
  }

  private move(movement: UniverseMove, multiplier = 1): void {
    this.moveStepAu = Math.max(this.moveStepAu, positionPrecisionStep(this.position));
    this.position = moveUniversePosition(this.position, this.camera.yawDeg, this.camera.pitchDeg, movement, this.moveStepAu * multiplier);
    this.afterNavigation(true);
  }

  private afterNavigation(reload = false, historyMode: "push" | "replace" = "replace"): void {
    this.updateChrome();
    this.hideTooltip();
    this.options.stateChanged(historyMode);
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
    this.options.speedLabel.textContent = `${formatDistanceAu(this.moveStepAu)}/s`;
    if (document.activeElement !== this.options.speedInput) this.options.speedInput.value = formatSpeedInput(this.moveStepAu);
    this.options.autopilotButton.setAttribute("aria-pressed", String(this.autopilot));
    this.options.autopilotButton.textContent = this.options.translate(this.autopilot ? "universe3d.autopilotStop" : "universe3d.autopilotStart");
    this.updateTarget();
  }

  private updateTarget(): void {
    const target = this.target;
    this.options.targetPanel.hidden = !target;
    if (!target) { this.options.selectionSummary.textContent = ""; return; }
    const distance = Math.hypot(
      target.position.x - this.position.x,
      target.position.y - this.position.y,
      target.position.z - this.position.z,
    );
    this.options.targetName.textContent = target.name;
    const surface = target.radiusKm && target.radiusKm > 0
      ? distance <= target.radiusKm / AU_KM
        ? this.options.translate("universe3d.insideSurface")
        : this.options.translate("universe3d.aboveSurface", { distance: formatDistanceAu(distance - target.radiusKm / AU_KM) })
      : "";
    this.options.targetMeta.textContent = this.options.translate("universe3d.targetMeta", {
      type: (target.object_type ?? "Object").replace(/_/g, " "), distance: formatDistanceAu(distance), surface,
    });
    const magnitude = observerApparentMagnitude(target, this.position);
    this.options.targetMagnitude.textContent = magnitude === null
      ? this.options.translate("universe3d.unknownMagnitude")
      : this.options.translate("universe3d.estimatedMagnitude", { magnitude: magnitude.toFixed(1) });
    this.options.selectionSummary.textContent = this.options.translate("universe3d.selectionSummary", {
      name: target.name, distance: formatDistanceAu(distance), magnitude: this.options.targetMagnitude.textContent,
    });
    const body = this.options.bodyByKey().get(target.key) ?? this.options.selectedBody();
    this.options.skyButton.disabled = !body || body.key !== target.key || !bodyCanObserveSky(body);
    this.options.focusButton.disabled = distance <= 1e-12;
  }

  private focusTarget(): void {
    const target = this.target;
    if (!target) return;
    this.stopFlight();
    const direction = relativeDirection(this.position, target.position);
    if (!direction) return;
    const distance = Math.hypot(
      target.position.x - this.position.x,
      target.position.y - this.position.y,
      target.position.z - this.position.z,
    );
    const standoff = Math.min(Math.max(distance * 0.02, Math.min(this.moveStepAu * 0.1, distance * 0.5),
      (target.radiusKm ?? 0) / AU_KM * 3), 1e11);
    this.position = {
      x: target.position.x - direction.x * standoff,
      y: target.position.y - direction.y * standoff,
      z: target.position.z - direction.z * standoff,
    };
    this.camera = cameraForDirection(direction, this.camera.fovDeg);
    this.moveStepAu = clamp(Math.max(standoff * 0.25, positionPrecisionStep(this.position)), MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.afterNavigation(true, "push");
    this.options.canvas.focus({ preventScroll: true });
  }

  private async chooseDestination(point: UniversePoint): Promise<void> {
    this.options.searchDialog.close();
    this.target = point;
    this.targetKey = point.key;
    this.updateTarget();
    this.focusTarget();
    try {
      await this.options.selectBody(point.key);
      if (this.active && !this.options.selectedObjectPanel.hidden && this.options.selectedObjectPanel.dataset.selectedKey === point.key) {
        this.options.root.dataset.objectInspector = "true";
        this.updateSelectionConnector();
      }
    } catch {
      if (this.active) this.options.status.textContent = this.options.translate("universe3d.detailsUnavailable");
    }
  }

  private inspectInAtlas(): void {
    const key = this.target?.key;
    this.close({ updateHistory: false });
    if (key) this.options.inspectInAtlas(key);
    this.options.stateChanged("push");
  }

  private toggleAutopilot(): void {
    if (this.autopilot) {
      this.autopilot = false;
      if (this.heldMoves.size === 0) this.endFlight();
    } else {
      this.autopilot = true;
      this.autopilotStandoffAu = this.target ? Math.max(
        (this.options.bodyByKey().get(this.target.key)?.radius_km ?? 0) / 149_597_870.7 * 3,
        Math.min(this.moveStepAu * 0.1, Math.hypot(
          this.target.position.x - this.position.x,
          this.target.position.y - this.position.y,
          this.target.position.z - this.position.z,
        ) * 0.001),
      ) : 0;
      this.startFlight();
    }
    this.updateChrome();
    this.options.stateChanged("replace");
    this.options.canvas.focus({ preventScroll: true });
  }

  private skyFromTarget(): void {
    if (!this.target) return;
    const body = this.options.bodyByKey().get(this.target.key) ?? this.options.selectedBody();
    if (!body || body.key !== this.target.key || !bodyCanObserveSky(body)) return;
    this.close({ updateHistory: false });
    void this.options.openSky(body);
  }

  private controlClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const moveButton = target.closest<HTMLButtonElement>("[data-universe-move]");
    if (moveButton) {
      if (event.detail === 0) this.move(moveButton.dataset.universeMove as UniverseMove);
      this.options.canvas.focus({ preventScroll: true });
      return;
    }
    const speedButton = target.closest<HTMLButtonElement>("[data-universe-speed]");
    if (!speedButton) return;
    const factor = speedButton.dataset.universeSpeed === "faster" ? 10 : 0.1;
    this.moveStepAu = clamp(Math.max(this.moveStepAu * factor, positionPrecisionStep(this.position)), MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.afterNavigation(true);
    this.options.canvas.focus({ preventScroll: true });
  }

  private setSpeedFromInput(): void {
    const requested = Number(this.options.speedInput.value);
    if (Number.isFinite(requested) && requested >= MIN_MOVE_STEP_AU && requested <= MAX_MOVE_STEP_AU) {
      this.moveStepAu = Math.max(requested, positionPrecisionStep(this.position));
      this.afterNavigation(true);
    }
    this.options.speedInput.value = formatSpeedInput(this.moveStepAu);
  }

  private controlPointerDown(event: PointerEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-universe-move]");
    if (!button || !this.active) return;
    event.preventDefault();
    this.controlPointer = event.pointerId;
    this.pointerMovement = button.dataset.universeMove as UniverseMove;
    this.move(this.pointerMovement);
    this.heldMoves.add(this.pointerMovement);
    this.startFlight();
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not own capture. */ }
  }

  private controlPointerUp(event: PointerEvent): void {
    if (this.controlPointer !== event.pointerId) return;
    if (this.pointerMovement) this.heldMoves.delete(this.pointerMovement);
    this.controlPointer = null;
    this.pointerMovement = null;
    if (this.heldMoves.size === 0 && !this.autopilot) this.endFlight();
  }

  private startFlight(): void {
    if (this.flightFrame !== null) return;
    this.flightStartedAt = performance.now();
    this.lastFlightAt = this.flightStartedAt;
    this.lastFlightUiAt = this.flightStartedAt;
    this.flightFrame = requestAnimationFrame((now) => this.flightTick(now));
  }

  private flightTick(now: number): void {
    this.flightFrame = null;
    if (!this.active || this.heldMoves.size === 0 && !this.autopilot) return;
    const seconds = Math.min((now - this.lastFlightAt) / 1000, 0.1);
    this.lastFlightAt = now;
    if (now - this.flightStartedAt >= 160 && seconds > 0) {
      for (const movement of this.heldMoves) {
        this.moveStepAu = Math.max(this.moveStepAu, positionPrecisionStep(this.position));
        this.position = moveUniversePosition(this.position, this.camera.yawDeg, this.camera.pitchDeg,
          movement, this.moveStepAu * seconds * (this.shiftHeld ? 10 : 1) * 3);
      }
      if (this.autopilot) {
        const direction = this.target ? relativeDirection(this.position, this.target.position) : null;
        const distance = this.target ? Math.hypot(
          this.target.position.x - this.position.x,
          this.target.position.y - this.position.y,
          this.target.position.z - this.position.z,
        ) : Number.POSITIVE_INFINITY;
        const travel = Math.min(this.moveStepAu * seconds, Math.max(0, distance - this.autopilotStandoffAu));
        if (this.target && (travel <= positionPrecisionStep(this.position) * 0.5 || !direction)) {
          this.autopilot = false;
          this.options.status.textContent = this.options.translate("universe3d.autopilotArrived", { name: this.target.name });
          this.updateChrome();
          if (this.heldMoves.size === 0) { this.endFlight(); return; }
        } else {
          if (direction) this.camera = cameraForDirection(direction, this.camera.fovDeg);
          this.position = moveUniversePosition(this.position, this.camera.yawDeg, this.camera.pitchDeg, "forward", travel);
        }
      }
      this.requestRender();
      if (now - this.lastFlightUiAt >= 100) {
        this.lastFlightUiAt = now;
        this.updateChrome();
        if (this.autopilot) this.options.status.textContent = this.options.translate(
          this.target ? "universe3d.autopilotToTarget" : "universe3d.autopilotForward",
          { name: this.target?.name ?? "", speed: formatDistanceAu(this.moveStepAu) });
        this.options.stateChanged("replace");
      }
    }
    this.flightFrame = requestAnimationFrame((time) => this.flightTick(time));
  }

  private endFlight(): void {
    if (this.flightFrame !== null) cancelAnimationFrame(this.flightFrame);
    this.flightFrame = null;
    if (this.active) this.afterNavigation(true);
  }

  private stopFlight(): void {
    this.autopilot = false;
    this.heldMoves.clear();
    this.pointerMovement = null;
    this.controlPointer = null;
    this.shiftHeld = false;
    this.endFlight();
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
    if (event.key === "Shift") { this.shiftHeld = true; return; }
    const key = event.key.toLowerCase();
    const multiplier = event.shiftKey ? 10 : 1;
    const movement = keyMovement(key);
    if (movement) {
      if (!this.heldMoves.has(movement)) this.move(movement, multiplier);
      this.heldMoves.add(movement);
      this.startFlight();
    }
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void this.selectAt({ x: this.options.canvas.clientWidth / 2, y: this.options.canvas.clientHeight / 2 });
      return;
    }
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

  private keyUp(event: KeyboardEvent): void {
    if (event.key === "Shift") this.shiftHeld = false;
    const movement = keyMovement(event.key.toLowerCase());
    if (movement && this.heldMoves.delete(movement) && this.heldMoves.size === 0 && !this.autopilot) this.endFlight();
  }

  private async selectAt(point: { x: number; y: number }): Promise<void> {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) return;
    this.target = hit.point;
    this.targetKey = hit.point.key;
    this.autopilotStandoffAu = 0;
    this.baseRenderKey = "";
    this.requestRender();
    this.updateTarget();
    this.options.status.textContent = this.options.translate("universe3d.selecting", { name: hit.point.name });
    try { await this.options.selectBody(hit.point.key); }
    catch {
      if (this.active) this.options.status.textContent = this.options.translate("universe3d.detailsUnavailable");
      return;
    }
    if (this.active) {
      if (!this.options.selectedObjectPanel.hidden && this.options.selectedObjectPanel.dataset.selectedKey === hit.point.key) {
        this.options.root.dataset.objectInspector = "true";
        this.updateSelectionConnector();
      }
      this.options.status.textContent = this.options.translate("universe3d.selected", { name: hit.point.name });
      this.updateTarget();
    }
  }

  private hideObjectInspector(): void {
    this.selectionConnector.hide();
    delete this.options.root.dataset.objectInspector;
  }

  private updateSelectionConnector(): void {
    if (this.options.root.dataset.objectInspector !== "true") { this.selectionConnector.hide(); return; }
    const hit = this.renderedHits.find((candidate) => candidate.point.key === this.target?.key);
    this.options.selectionConnector.dataset.sphere = String((hit?.radius ?? 0) > 24);
    this.selectionConnector.update(hit ? { key: hit.point.key, x: hit.x, y: hit.y } : null);
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
    pointsCanvas: dom.universePoints,
    bodiesCanvas: dom.universeBodies,
    toggleButton: dom.universeToggle,
    closeButton: dom.universeClose,
    resetButton: dom.universeReset,
    findButton: dom.universeFind,
    searchDialog: dom.universeSearchDialog,
    searchCloseButton: dom.universeSearchClose,
    searchInput: dom.universeSearchInput,
    searchResults: dom.universeSearchResults,
    positionLabel: dom.universePosition,
    selectionSummary: dom.universeSelectionSummary,
    speedLabel: dom.universeSpeed,
    speedInput: dom.universeSpeedInput,
    autopilotButton: dom.universeAutopilot,
    selectionConnector: dom.universeSelectionConnector,
    workspacePanel: dom.workspacePanel,
    selectedObjectPanel: dom.selectedObjectPanel,
    status: dom.universeStatus,
    tooltip: dom.universeTooltip,
    targetPanel: dom.universeTarget,
    targetName: dom.universeTargetName,
    targetMeta: dom.universeTargetMeta,
    targetMagnitude: dom.universeTargetMagnitude,
    focusButton: dom.universeFocus,
    inspectButton: dom.universeInspect,
    skyButton: dom.universeSky,
  });
}

export function initialUniverseState(center: { x: number; y: number }, moveStepAu: number, selected: Body | null): UniverseViewState {
  return universeEntryState(center, moveStepAu, bodyToUniversePoint(selected)?.position);
}

function validCatalogPoint(point: CatalogUniversePoint): boolean {
  return Boolean(point?.key && point.name && point.direction &&
    [point.direction.x, point.direction.y, point.direction.z].every(Number.isFinite) &&
    typeof point.distance_au === "number" && Number.isFinite(point.distance_au) && point.distance_au > 0 &&
    point.position_model !== "catalog_sky_position_reference_shell");
}

function sampleDuringFlight(points: UniversePoint[], nearbyCount: number, limit: number): UniversePoint[] {
  if (points.length <= limit) return points;
  const chosen = new Set<number>();
  const nearKeep = Math.min(500, nearbyCount, limit);
  for (let index = 0; index < nearKeep; index += 1) chosen.add(index);
  const brightKeep = Math.min(300, points.length - nearbyCount, limit - chosen.size);
  for (let index = nearbyCount; index < nearbyCount + brightKeep; index += 1) chosen.add(index);
  const remaining = limit - chosen.size;
  for (let slot = 0; slot < remaining; slot += 1) {
    chosen.add(Math.floor((slot + 0.5) * points.length / remaining));
  }
  for (let index = 0; chosen.size < limit && index < points.length; index += 1) chosen.add(index);
  return [...chosen].sort((left, right) => left - right).slice(0, limit).map((index) => points[index]!);
}

function bodyToUniversePoint(body: Body | null): UniversePoint | null {
  if (!body || !bodyCanObserveSky(body) ||
    body.catalog?.position_model === "catalog_sky_position_reference_shell" ||
    body.catalog?.facts?.distance_unknown === true) return null;
  return {
    key: body.key,
    name: body.name,
    object_type: body.object_type,
    catalog_group: body.catalog_group,
    source_type: body.catalog?.source_type,
    position_model: body.catalog?.position_model,
    color: body.color,
    apparent_magnitude: body.stellar?.apparent_magnitude ?? body.deep_sky?.apparent_magnitude,
    absoluteMagnitudeH: body.small_body?.h_absolute_magnitude
      ?? (typeof body.catalog?.facts?.h_absolute_magnitude === "number" ? body.catalog.facts.h_absolute_magnitude : null),
    position: bodyVector(body),
    radiusKm: body.radius_km,
    dynamic: isDynamicBody(body),
  };
}

function keyMovement(key: string): UniverseMove | undefined {
  return key === "w" ? "forward" : key === "s" ? "back"
    : key === "a" ? "left" : key === "d" ? "right"
      : key === "e" ? "up" : key === "q" ? "down" : undefined;
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
  if (value < 0.01) return `${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value * AU_KM)} km`;
  if (value < 10_000) return `${formatNumber(value)} AU`;
  const lightYears = value / 63_241.077;
  if (Math.abs(lightYears) < 1e3) return `${formatNumber(lightYears)} ly`;
  if (Math.abs(lightYears) < 1e6) return `${formatNumber(lightYears / 1e3)} kly`;
  if (Math.abs(lightYears) < 1e9) return `${formatNumber(lightYears / 1e6)} Mly`;
  return `${formatNumber(lightYears / 1e9)} Gly`;
}

function formatSpeedInput(value: number): string {
  return Number(value.toPrecision(6)).toString();
}

function formatNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function positionPrecisionStep(position: Vector3): number {
  return Math.max(MIN_MOVE_STEP_AU,
    Math.max(Math.abs(position.x), Math.abs(position.y), Math.abs(position.z)) * Number.EPSILON * 16);
}
