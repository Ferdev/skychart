import { community } from "../community/communityController";
import { GUIDED_DEEP_SKY_KEYS } from "../atlas/atlasDefinitions";
import { trackEvent } from "../analytics";
import type { UniverseMove } from "../navigation/universeNavigation";
import { autopilotTravel, thrustScale, turnCameraToward, UniverseFlight } from "../navigation/universeFlight";
import { gravityBodies, planTransfer, playbackTimeFraction, transferPosition, transferSpeed, TRANSFER_PLAYBACK_SECONDS, type TransferResult } from "../navigation/universeTransfer";
import { formatCount } from "../format/quantity";
import { drawOrientationGrid, drawReticle, drawUniverseLabels, type DrawnUniverseLabel, type RenderedHit, type RenderedLabel } from "./universeBackdrop";
import { autopilotControlState, isAtTarget, isAtViewingDistance, StatusMessageHold } from "./universeFlightStatus";
import { UniversePinch } from "./universeTouchControls";
import { formatCoordinate, formatDistanceAu, formatDuration } from "./universeFormat";
import { UniverseRenderQuality } from "./universeRenderQuality";
import { UniverseSpeedGauge } from "./universeSpeedGauge";
import { UniverseMinimap } from "./universeMinimap";
import { bodyCanObserveSky } from "../sky/skyBody";
import { skyPointAppearance } from "../sky/skyPointAppearance";
import { SkySelectionConnectorView } from "../sky/skySelectionConnectorView";
import {
  cameraForDirection,
  createSkyProjector,
  normalizeCamera,
  relativeDirection,
  type SkyCamera,
  type Vector3,
} from "../sky/skyProjection";
import { normalizeUniverseViewState, type UniverseViewState } from "../viewState";
import { UniversePointRenderer, type UniverseScreenPoint } from "./universePointRenderer";
import { observerApparentMagnitude } from "./universePhotometry";
import { UniverseDestinationSearch } from "./universeDestinationSearch";
import { approachDistance, hasRenderableRadius, projectPhysicalBody, projectSphericalExtent, safeUniverseEntryPosition } from "./universeBodyGeometry";
import { bodyOccluders, occludedByBody, ringTransmission, type BodyOccluder } from "./universeOcclusion";
import { resolvedBodyWeight } from "./universeAppearanceProfiles";
import { UniverseBodyRenderer } from "./universeBodyRenderer";
import { deepSkyModel } from "./universeDeepSkyModel";
import { UniverseDeepSkyRenderer } from "./universeDeepSkyRenderer";
import { bodyToUniversePoint, catalogPointIsHostBound, sampleDuringFlight, validCatalogPoint, type CatalogUniversePoint, type UniversePoint } from "./universePointModel";
import { UniverseExoplanetSystems } from "./universeExoplanets";
import { universeTargetCardText } from "./universeTargetCard";
import { UniverseCameraTurn } from "./universeCameraTurn";
import { EXIT_CONFIRM_WINDOW_MS, ExitConfirmation, universeEscapeAction } from "./universeEscape";
import { bindViewEscapeKey } from "../atlas/viewEscapeKey";
import type { Body } from "../atlas/contracts";
import type { UniverseViewOptions } from "./universeViewOptions";

type Projector = ReturnType<typeof createSkyProjector>;

const DEFAULT_CAMERA: SkyCamera = { yawDeg: 180, pitchDeg: 0, fovDeg: 72 };
const CATALOG_LIMIT = 12_000;
const MAX_FLIGHT_POINTS = 1_500;
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
  private drawnLabels: DrawnUniverseLabel[] = [];
  private readonly statusHold = new StatusMessageHold();
  private readonly pinch = new UniversePinch();
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPointer: { x: number; y: number } | null = null;
  private dragMoved = false;
  private renderFrame: number | null = null;
  private backdropCanvas: HTMLCanvasElement | null = null;
  private backdropKey = "";
  private baseRenderKey = "";
  private pointRenderer: UniversePointRenderer;
  private bodyRenderer: UniverseBodyRenderer;
  private deepSkyRenderer: UniverseDeepSkyRenderer;
  private readonly collectPerformance = new URLSearchParams(window.location.search).has("perf");
  private requestId = 0;
  private catalogAbort: AbortController | null = null;
  private catalogRequestedAt = 0;
  private readonly destinationSearch: UniverseDestinationSearch;
  private reloadTimer: number | null = null;
  private heldMoves = new Set<UniverseMove>();
  private readonly flight = new UniverseFlight();
  private flightFrame: number | null = null;
  private speedAu = 0;
  private lastFlightAt = 0;
  private lastFlightUiAt = 0;
  private shiftHeld = false;
  private controlPointer: number | null = null;
  private pointerMovement: UniverseMove | null = null;
  private autopilot = false;
  private autopilotStandoffAu = 0;
  private autopilotLegAu = 0;
  private gravityRoute = false;
  private transfer: Extract<TransferResult, { plan: unknown }>["plan"] | null = null;
  private transferPlayback = 0;
  private readonly minimap: UniverseMinimap;
  private readonly speedGauge: UniverseSpeedGauge;
  private readonly quality: UniverseRenderQuality;
  private readonly selectionConnector: SkySelectionConnectorView;
  private readonly exoplanetSystems: UniverseExoplanetSystems;
  private readonly cameraTurn: UniverseCameraTurn;
  private readonly exitConfirmation = new ExitConfirmation();

  constructor(private readonly options: UniverseViewOptions) {
    this.exoplanetSystems = new UniverseExoplanetSystems(options.loadPlanetarySystem, () => {
      const targetKey = this.target?.key ?? this.targetKey;
      if (targetKey) this.target = bodyToUniversePoint(options.bodyByKey().get(targetKey) ?? null) ?? this.target;
      this.baseRenderKey = "";
      this.updateTarget();
      this.requestRender();
    });
    this.pointRenderer = new UniversePointRenderer(options.pointsCanvas, () => this.requestRender());
    this.quality = new UniverseRenderQuality(this.pointRenderer.software);
    this.bodyRenderer = new UniverseBodyRenderer(options.bodiesCanvas, () => this.requestRender());
    this.deepSkyRenderer = new UniverseDeepSkyRenderer(options.deepSkyCanvas, () => this.requestRender());
    this.minimap = new UniverseMinimap(options.minimapCanvas);
    this.speedGauge = new UniverseSpeedGauge(options.speedGauge, options.speedLabel);
    options.gravityButton.addEventListener("click", () => {
      this.gravityRoute = !this.gravityRoute;
      this.stopFlight();
      options.canvas.focus({ preventScroll: true });
    });
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
      suggestions: () => {
        const placed = (bodies: Body[]) => bodies.filter((body) => bodyToUniversePoint(body) !== null);
        const { suggested, recent } = options.destinationSuggestions();
        return { suggested: placed(suggested), recent: placed(recent) };
      },
      eligible: (body) => bodyToUniversePoint(body) !== null,
      choose: (body) => { const point = bodyToUniversePoint(body); if (point) this.chooseDestination(point); },
    });
    this.cameraTurn = new UniverseCameraTurn({
      camera: () => this.camera,
      setCamera: (camera) => { this.camera = camera; },
      direction: () => this.active && this.target ? relativeDirection(this.position, this.target.position) : null,
      afterFrame: () => this.afterNavigation(),
    });
    options.flyButton.addEventListener("click", () => this.flyToSelectedTarget());
    options.focusButton.addEventListener("click", () => this.focusTarget());
    options.inspectButton.addEventListener("click", () => void this.inspectInAtlas());
    options.detailsButton.addEventListener("click", () => void this.showDetails());
    options.skyButton.addEventListener("click", () => void this.skyFromTarget());
    options.autopilotButton.addEventListener("click", () => this.toggleAutopilot());
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
    bindViewEscapeKey({ active: () => this.active, canvas: options.canvas, escape: () => this.escape() });
    window.addEventListener("keyup", (event) => this.keyUp(event));
    window.addEventListener("blur", () => this.stopFlight());
    window.addEventListener("resize", () => this.requestRender());
    new MutationObserver(() => {
      if (options.workspacePanel.hidden) this.hideObjectInspector();
    }).observe(options.workspacePanel, { attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("cosmic-atlas:locale-change", () => {
      this.updateChrome();
      // The status line is text of a past event. Show the usual line in the new language.
      if (this.active && !this.catalogAbort) this.options.status.textContent = options.translate("universe3d.ready", { count: formatCount(this.catalogPoints.length) });
    });
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
    // The 3D view starts with the target card only. `Details` opens the inspector.
    this.hideObjectInspector();
    this.options.closeInspector();
    this.statusHold.release();
    this.initialState = { ...normalized, positionAu: { ...this.position } };
    this.minimap.restart(this.position);
    this.options.root.hidden = false;
    document.body.dataset.universeView = "true";
    this.updateChrome();
    this.options.status.textContent = this.options.translate("universe3d.loading");
    this.options.canvas.focus({ preventScroll: true });
    this.options.hintCard.showOnce();
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
    this.bodyRenderer.release(); this.deepSkyRenderer.release();
    this.catalogAbort = null;
    this.stopFlight();
    this.hideObjectInspector();
    this.options.hintCard.hide();
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
    this.exoplanetSystems.reset();
    this.requestRender();
    void this.loadCatalog();
  }

  private reset(): void {
    if (!this.initialState) return;
    this.stopFlight();
    this.position = { ...this.initialState.positionAu };
    this.camera = normalizeCamera(this.initialState);
    this.moveStepAu = Math.max(this.initialState.moveStepAu, positionPrecisionStep(this.position));
    this.minimap.restart(this.position);
    this.afterNavigation();
    void this.loadCatalog();
  }

  private async loadCatalog(): Promise<void> {
    if (!this.active) return;
    this.catalogRequestedAt = performance.now();
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
      ...(!localOnly ? { featured_keys: GUIDED_DEEP_SKY_KEYS.join(",") } : {}),
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
        // A planet record from this endpoint is at its host star: no sphere at the star center.
        radiusKm: catalogPointIsHostBound(point) ? null : point.radius_km,
        hostBound: catalogPointIsHostBound(point),
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
      // An arrival message stays for some seconds: a routine load message does not replace it.
      if (this.targetKey && !this.target) this.options.status.textContent = this.options.translate("universe3d.targetUnavailable", { key: this.targetKey });
      else if (this.statusHold.canReplace()) this.options.status.textContent = this.options.translate("universe3d.ready", { count: formatCount(this.catalogPoints.length) });
    } catch {
      if (abort.signal.aborted) return;
      if (requestId !== this.requestId || !this.active) return;
      this.options.status.textContent = this.options.translate("universe3d.catalogUnavailable");
    }
    if (this.catalogAbort === abort) this.catalogAbort = null;
    this.baseRenderKey = "";
    this.updateTarget();
    this.requestRender();
    this.exoplanetSystems.update(this.points(), this.position);
  }

  /**
   * Catalog points, then the target, then the loaded bodies: a loaded body
   * replaces the catalog point with the same key. A planet with no calculated
   * position is at its host star, so only a selected one stays in the list.
   */
  private points(): UniversePoint[] {
    const catalog = this.flying ? this.flightCatalogPoints : this.catalogPoints;
    const points = new Map<string, UniversePoint>(catalog.filter((point) => !point.hostBound).map((point) => [point.key, point]));
    if (this.target) points.set(this.target.key, this.target);
    for (const body of this.options.bodyByKey().values()) {
      const point = bodyToUniversePoint(body);
      if (point && (!point.hostBound || point.key === this.target?.key)) points.set(body.key, point);
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (!useWebgl && this.flying ? 0.5 : 1);
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
      drawOrientationGrid(backdropContext, width, height, project);
      this.backdropCanvas = backdrop;
      this.backdropKey = backdropKey;
    }
    const moving = this.flying;
    const quality = this.quality.frame(renderStarted, moving);
    const baseKey = `${backdropKey}:${useWebgl ? moving ? "flight" : `${this.position.x},${this.position.y},${this.position.z}` : "fallback"}`;
    const redrawBase = moving || !useWebgl || this.baseRenderKey !== baseKey;
    if (redrawBase) context.drawImage(this.backdropCanvas!, 0, 0, width, height);
    const baseDone = performance.now();
    const framePoints = this.points();
    const occluders = bodyOccluders(framePoints, this.position, this.camera, width, height);
    const modeled = this.deepSkyRenderer.render(framePoints, this.position, this.camera, width, height, dpr, occluders, quality, this.target?.key);
    const labels = this.drawPoints(context, framePoints, width, height, project, useWebgl, dpr, modeled, occluders);
    this.bodyRenderer.render(framePoints, this.position, this.camera, width, height, dpr, quality);
    const pointsDone = performance.now();
    if (redrawBase) {
      this.drawnLabels = drawUniverseLabels(context, labels, this.renderedHits, this.position, this.target?.key, this.options.labelAreas.get());
      drawReticle(context, width, height);
      this.baseRenderKey = baseKey;
    }
    this.updateSelectionConnector();
    community.render("universe", this.options.root, this.renderedHits.map(h => ({key: h.point.key, x: h.x, y: h.y})), community.showMarkers && !this.flying);
    community.renderPlane(this.options.root, this.target, framePoints.find(p => p.key === "earth")?.position ?? {x:0,y:0,z:0}, this.position, project, this.flying);
    if (this.collectPerformance) {
      const debug = window as Window & { __universePerf?: Array<{ base: number; points: number; labels: number; webgl: boolean }> };
      const samples = debug.__universePerf ??= [];
      samples.push({ base: baseDone - renderStarted,
        points: pointsDone - baseDone, labels: performance.now() - pointsDone, webgl: useWebgl });
      if (samples.length > 120) samples.shift();
    }
  }

  private drawPoints(context: CanvasRenderingContext2D, points: UniversePoint[], width: number, height: number,
    project: Projector, useWebgl: boolean, dpr: number, modeled: ReadonlySet<string>, occluders: BodyOccluder[]): RenderedLabel[] {
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
      if (!projected || occludedByBody({ x: point.position.x - this.position.x, y: point.position.y - this.position.y, z: point.position.z - this.position.z }, occluders, point.key)) continue;
      const magnitude = observerApparentMagnitude(point, this.position);
      const appearance = skyPointAppearance({ ...point, apparent_magnitude: magnitude });
      const deepSky = deepSkyModel(point);
      const bodyRadius = projectPhysicalBody(point, this.position, this.camera, width, height)?.radiusPx
        ?? (deepSky ? projectSphericalExtent(point.position, deepSky.radiusAu, this.position, this.camera, width, height)?.radiusPx : 0) ?? 0;
      const modelWeight = hasRenderableRadius(point) || modeled.has(point.key) ? resolvedBodyWeight(bodyRadius) : 0;
      appearance.opacity *= (1 - modelWeight) * ringTransmission({ x: point.position.x - this.position.x, y: point.position.y - this.position.y, z: point.position.z - this.position.z }, occluders, point.key);
      if (modelWeight >= 1) { /* Geometric layer renders this object. */ }
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

  private get flying(): boolean { return this.heldMoves.size > 0 || this.autopilot || this.flight.moving; }

  /** Thruster reference speed; never below what the position can resolve. */
  private baseSpeed(): number {
    this.moveStepAu = Math.max(this.moveStepAu, positionPrecisionStep(this.position));
    return this.moveStepAu * (this.shiftHeld ? 10 : 1);
  }

  /** From rest, match the thrusters to the surroundings; there is no manual scale. */
  private rescaleThrust(): void {
    if (!this.flying) this.moveStepAu = clamp(thrustScale(this.position, this.points(), this.moveStepAu),
      positionPrecisionStep(this.position), MAX_MOVE_STEP_AU);
  }

  /** A tap, wheel notch, or keyboard click is an impulse that glides to rest. */
  private nudge(movement: UniverseMove, multiplier = 1): void {
    this.rescaleThrust();
    if (this.autopilot && this.target && (movement === "forward" || movement === "back")) {
      this.flight.adjustThrottle((movement === "forward" ? 0.25 : -0.25) * multiplier);
    } else this.flight.kick(movement, this.baseSpeed() * multiplier);
    if (!this.autopilot) this.transfer = null;
    this.startFlight();
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
    this.speedGauge.show(this.flying ? this.speedAu : 0);
    this.speedGauge.localize(this.options.translate);
    this.options.gravityButton.setAttribute("aria-pressed", String(this.gravityRoute));
    const control = autopilotControlState({ hasTarget: this.target !== null, active: this.autopilot, atTarget: this.atTarget() });
    this.options.autopilotButton.setAttribute("aria-pressed", String(this.autopilot));
    this.options.autopilotButton.textContent = this.options.translate(control.labelKey);
    this.options.autopilotButton.disabled = control.disabled;
    this.options.flightNote.textContent = control.noteKey ? this.options.translate(control.noteKey) : "";
    this.updateTarget();
  }

  /** True when the craft is at the standoff distance of the target: the flight buttons have nothing to do. */
  private atTarget(): boolean {
    const target = this.target;
    return target !== null && isAtTarget(Math.hypot(target.position.x - this.position.x, target.position.y - this.position.y,
      target.position.z - this.position.z), this.autopilotStandoff());
  }

  /** Plan the gravity route, if enabled, from here to the selected object. */
  private planRoute(): TransferResult | null {
    const target = this.target;
    const direction = target && this.gravityRoute ? relativeDirection(this.position, target.position) : null;
    const standoff = this.autopilot ? this.autopilotStandoffAu : this.autopilotStandoff();
    // Nothing to plan once the craft is already at the standoff distance.
    if (!target || !direction || Math.hypot(target.position.x - this.position.x, target.position.y - this.position.y,
      target.position.z - this.position.z) <= standoff * 1.001) return null;
    return planTransfer(this.position, { x: target.position.x - direction.x * standoff, y: target.position.y - direction.y * standoff,
      z: target.position.z - direction.z * standoff }, gravityBodies(this.options.bodyByKey().values()));
  }

  /** Redraw the trip map with the flown path and the planned route. */
  private updateRoute(): void {
    const result = this.transfer ? { plan: this.transfer } : this.planRoute();
    this.options.routeLabel.textContent = !result ? this.options.translate("universe3d.minimap")
      : "plan" in result ? this.options.translate("universe3d.routeGravity", { center: result.plan.center.name, duration: formatDuration(result.plan.durationSeconds) })
      : this.options.translate(result.unavailable === "range" ? "universe3d.routeRange" : "universe3d.routeRadial");
    const bodies = [...this.options.bodyByKey().values()].flatMap((body) => bodyToUniversePoint(body) ?? []);
    this.minimap.setScene({ target: this.target, bodies, route: result && "plan" in result ? result.plan.points : null,
      catalog: this.flightCatalogPoints, minimumSpanAu: this.moveStepAu * 4 });
    this.minimap.draw(this.position, this.camera.yawDeg);
  }

  private updateTarget(): void {
    this.updateRoute();
    const target = this.target;
    this.options.targetPanel.hidden = !target;
    if (!target) return;
    const arrived = this.atTarget() && !this.autopilot;
    const card = universeTargetCardText(target, this.position, this.options.bodyByKey().get(target.key), this.options.translate, arrived);
    this.options.targetName.textContent = target.name;
    this.options.targetMeta.textContent = card.meta;
    this.options.targetMagnitude.textContent = card.magnitude;
    // The body of a catalog point loads with `Details` or `Sky from object`. Before that, Sky is not ruled out.
    const body = this.options.bodyByKey().get(target.key);
    this.options.skyButton.disabled = body ? !bodyCanObserveSky(body) : false;
    // Inside the standoff distance a jump moves the craft out to the distance that shows the object.
    this.options.focusButton.disabled = card.distanceAu <= 1e-12 || isAtViewingDistance(card.distanceAu, this.autopilotStandoff());
    this.options.flyButton.disabled = arrived;
  }

  private focusTarget(): void {
    const target = this.target;
    if (!target) return;
    this.stopFlight();
    const direction = relativeDirection(this.position, target.position);
    if (!direction) return;
    const standoff = this.autopilotStandoff();
    this.position = {
      x: target.position.x - direction.x * standoff,
      y: target.position.y - direction.y * standoff,
      z: target.position.z - direction.z * standoff,
    };
    this.camera = cameraForDirection(direction, this.camera.fovDeg);
    this.moveStepAu = clamp(Math.max(standoff * 0.25, positionPrecisionStep(this.position)), MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.minimap.restart(this.position);
    this.afterNavigation(true, "push");
    this.options.canvas.focus({ preventScroll: true });
  }

  /** A destination from the search becomes the target, and the camera turns to it. The position does not change. */
  private chooseDestination(point: UniversePoint): void {
    this.options.searchDialog.close();
    this.stopFlight();
    this.target = point;
    this.targetKey = point.key;
    this.autopilotStandoffAu = this.autopilotStandoff();
    this.baseRenderKey = "";
    this.updateTarget();
    // A new target shows the target card only, as a selection does.
    this.hideObjectInspector(); this.options.closeInspector();
    this.cameraTurn.start();
    this.options.stateChanged("push");
    this.options.canvas.focus({ preventScroll: true });
  }

  /** `Details`: opens the object inspector for the target. The target card stays. */
  private async showDetails(): Promise<void> {
    const key = this.target?.key;
    if (!key) return;
    try {
      await this.options.selectBody(key);
      if (this.active && !this.options.selectedObjectPanel.hidden && this.options.selectedObjectPanel.dataset.selectedKey === key) {
        this.options.root.dataset.objectInspector = "true";
        this.options.labelAreas.invalidate();
        this.updateSelectionConnector();
      }
    } catch {
      if (this.active) this.options.status.textContent = this.options.translate("universe3d.detailsUnavailable");
    }
  }

  /** `Fly there`: the autopilot flies to the target. */
  private flyToSelectedTarget(): void {
    if (!this.target) return;
    if (!this.autopilot) this.toggleAutopilot();
  }

  private async inspectInAtlas(): Promise<void> {
    const key = this.target?.key;
    // The 2D map shows the object in the inspector, so the object must be the selection.
    if (key) await this.options.selectBody(key).catch(() => undefined);
    this.close({ updateHistory: false });
    if (key) this.options.inspectInAtlas(key);
    this.options.stateChanged("push");
  }

  private toggleAutopilot(): void {
    if (this.autopilot) {
      this.autopilot = false;
      if (this.target && !this.transfer) this.flight.velocity.forward = this.speedAu;
      this.transfer = null;
    } else {
      this.flight.throttle = 1;
      this.autopilotLegAu = 0;
      this.autopilotStandoffAu = this.autopilotStandoff();
      const route = this.planRoute();
      this.transfer = route && "plan" in route ? route.plan : null;
      this.transferPlayback = 0;
      this.rescaleThrust();
      this.autopilot = true;
      this.startFlight();
    }
    this.updateChrome();
    this.options.stateChanged("replace");
    this.options.canvas.focus({ preventScroll: true });
  }

  /** Distance from the target's center at which autopilot stops. */
  private autopilotStandoff(): number {
    const target = this.target;
    if (!target) return 0;
    return Math.max(approachDistance(target, deepSkyModel(target)?.radiusAu ?? null, this.camera.fovDeg),
      positionPrecisionStep(target.position) * 10);
  }

  private async skyFromTarget(): Promise<void> {
    const key = this.target?.key;
    if (!key) return;
    // A catalog point has no loaded body before the first `Details`: load it now.
    if (!this.options.bodyByKey().has(key)) {
      await this.options.selectBody(key).catch(() => undefined);
      this.options.closeInspector();
    }
    const body = this.options.bodyByKey().get(key) ?? this.options.selectedBody();
    if (!this.active || !body || body.key !== key || !bodyCanObserveSky(body)) {
      if (this.active) this.options.status.textContent = this.options.translate("universe3d.detailsUnavailable");
      return;
    }
    const origin = this.state();
    this.close({ updateHistory: false });
    void this.options.openSky(body, origin);
  }

  private controlClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const moveButton = target.closest<HTMLButtonElement>("[data-universe-move]");
    if (moveButton) {
      if (event.detail === 0) this.nudge(moveButton.dataset.universeMove as UniverseMove);
      this.options.canvas.focus({ preventScroll: true });
      return;
    }
  }

  private controlPointerDown(event: PointerEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-universe-move]");
    if (!button || !this.active) return;
    event.preventDefault();
    this.controlPointer = event.pointerId;
    this.pointerMovement = button.dataset.universeMove as UniverseMove;
    this.nudge(this.pointerMovement);
    this.heldMoves.add(this.pointerMovement);
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not own capture. */ }
  }

  private controlPointerUp(event: PointerEvent): void {
    if (this.controlPointer !== event.pointerId) return;
    if (this.pointerMovement) this.heldMoves.delete(this.pointerMovement);
    this.controlPointer = null;
    this.pointerMovement = null;
  }

  private startFlight(): void {
    if (this.flightFrame !== null) return;
    this.lastFlightAt = performance.now();
    this.lastFlightUiAt = this.lastFlightAt;
    this.flightFrame = requestAnimationFrame((now) => this.flightTick(now));
  }

  private flightTick(now: number): void {
    this.flightFrame = null;
    if (!this.active) return;
    const seconds = Math.min((now - this.lastFlightAt) / 1000, 0.1);
    this.lastFlightAt = now;
    if (seconds > 0) {
      const from = this.position;
      const tracking = this.autopilot && this.target !== null;
      const autopilotSpeed = tracking ? this.speedAu : 0;
      this.flight.thrust(this.heldMoves, this.baseSpeed(), seconds, { cruise: this.autopilot, tracking });
      this.position = this.flight.advance(this.position, this.camera, seconds);
      if (tracking && this.transfer) this.flyTransfer(seconds);
      else if (tracking) this.flyToTarget(autopilotSpeed, seconds);
      // A gravity route reports the real orbital speed, not the time-compressed playback.
      this.speedAu = tracking && this.transfer ? transferSpeed(this.transfer, this.position)
        : Math.hypot(this.position.x - from.x, this.position.y - from.y, this.position.z - from.z) / seconds;
      this.requestRender();
      this.minimap.draw(this.position, this.camera.yawDeg);
      if (!this.flying) { this.endFlight(); return; }
      if (now - this.lastFlightUiAt >= 100) {
        this.lastFlightUiAt = now;
        this.updateChrome();
        // Keep discovering nearby objects during held flight without cancelling
        // a slow request or repeating the initial global landmark query.
        if (this.landmarksLoaded && !this.catalogAbort && this.reloadTimer === null &&
          now - this.catalogRequestedAt >= 1500) void this.loadCatalog();
        if (this.autopilot && this.transfer) this.options.status.textContent = this.options.translate("universe3d.transferStatus", {
          name: this.target?.name ?? "", elapsed: formatDuration(playbackTimeFraction(this.transferPlayback) * this.transfer.durationSeconds),
          duration: formatDuration(this.transfer.durationSeconds),
          rate: formatDuration(this.transfer.durationSeconds / TRANSFER_PLAYBACK_SECONDS * this.flight.throttle) });
        else if (this.autopilot) this.options.status.textContent = this.options.translate(
          this.target ? "universe3d.autopilotToTarget" : "universe3d.autopilotForward",
          { name: this.target?.name ?? "", speed: formatDistanceAu(this.speedAu) });
        this.options.stateChanged("replace");
      }
    }
    this.flightFrame = requestAnimationFrame((time) => this.flightTick(time));
  }

  /** One frame of a gravity route: coast along the planned orbit in compressed
   * time while the camera keeps the destination in view. */
  private flyTransfer(seconds: number): void {
    const plan = this.transfer!;
    this.transferPlayback += seconds * this.flight.throttle / TRANSFER_PLAYBACK_SECONDS;
    this.position = transferPosition(plan, playbackTimeFraction(this.transferPlayback));
    const direction = relativeDirection(this.position, this.target!.position);
    if (direction) this.camera = turnCameraToward(this.camera, direction, seconds);
    if (this.transferPlayback < 1) return;
    this.endAutopilot();
    this.moveStepAu = clamp(Math.max(this.autopilotStandoffAu * 0.25, positionPrecisionStep(this.position)), MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.options.status.textContent = this.options.translate("universe3d.transferArrived", {
      name: this.target!.name, duration: formatDuration(plan.durationSeconds), center: plan.center.name });
    this.statusHold.hold();
  }

  /** Arrival: a forward or back control still held to set the pace must be
   * pressed again before it thrusts, so the craft does not shoot past. */
  private endAutopilot(): void {
    this.autopilot = false;
    for (const movement of ["forward", "back"] as const) this.heldMoves.delete(movement);
  }

  /** One autopilot frame toward the target: turn, accelerate, then slow to a
   * stop at the standoff distance. */
  private flyToTarget(speed: number, seconds: number): void {
    const target = this.target!;
    const direction = relativeDirection(this.position, target.position);
    const remaining = Math.hypot(target.position.x - this.position.x, target.position.y - this.position.y,
      target.position.z - this.position.z) - this.autopilotStandoffAu;
    const precision = positionPrecisionStep(this.position);
    if (direction && remaining > precision) {
      this.autopilotLegAu ||= remaining;
      const travel = autopilotTravel(speed, remaining, Math.max(this.autopilotStandoffAu * 0.03, precision * 60), seconds,
        this.flight.throttle, this.autopilotLegAu);
      this.camera = turnCameraToward(this.camera, direction, seconds);
      this.position = { x: this.position.x + direction.x * travel, y: this.position.y + direction.y * travel, z: this.position.z + direction.z * travel };
      if (travel < remaining) return;
    }
    this.endAutopilot();
    if (direction) this.camera = cameraForDirection(direction, this.camera.fovDeg);
    // Leave the thrusters scaled to the destination, as "Jump there" does.
    this.moveStepAu = clamp(Math.max(this.autopilotStandoffAu * 0.25, precision), MIN_MOVE_STEP_AU, MAX_MOVE_STEP_AU);
    this.options.status.textContent = this.options.translate("universe3d.autopilotArrived", { name: target.name });
    this.statusHold.hold();
  }

  private endFlight(): void {
    if (this.flightFrame !== null) cancelAnimationFrame(this.flightFrame);
    this.flightFrame = null;
    this.speedAu = 0;
    if (this.active) this.afterNavigation(true);
  }

  private stopFlight(): void {
    this.autopilot = false;
    this.transfer = null;
    this.flight.stop();
    this.heldMoves.clear();
    this.pointerMovement = null;
    this.controlPointer = null;
    this.shiftHeld = false;
    this.endFlight();
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.active) return;
    const point = this.canvasPoint(event);
    this.cameraTurn.cancel();
    this.exitConfirmation.reset();
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
    if (this.pointers.size >= 2) {
      // Two fingers: a pinch goes forward or back, and the view does not turn.
      this.pointers.set(event.pointerId, point);
      const step = this.pinch.update([...this.pointers.values()]);
      if (step) this.nudge(step.move, step.multiplier);
      this.dragMoved = true;
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
    this.pinch.reset();
    try { this.options.canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be gone. */ }
    if (!wasActive) return;
    if (!this.dragMoved && event.type === "pointerup") this.selectAt(point);
    this.lastPointer = null;
    this.options.canvas.style.cursor = "grab";
  }

  private wheel(event: WheelEvent): void {
    if (!this.active) return;
    event.preventDefault();
    this.nudge(event.deltaY < 0 ? "forward" : "back", clamp(Math.abs(event.deltaY) / 100, 0.15, 4) * 2);
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.active) return;
    if (event.key === "Shift") { this.shiftHeld = true; return; }
    const key = event.key.toLowerCase();
    const movement = keyMovement(key);
    if (movement) {
      if (!event.repeat && !this.heldMoves.has(movement)) this.nudge(movement);
      if (!event.repeat) this.heldMoves.add(movement);
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
    else if (event.key === "Escape") { event.preventDefault(); this.escape(); return; }
    else return;
    event.preventDefault();
    this.exitConfirmation.reset();
    if (!movement) {
      this.cameraTurn.cancel();
      this.camera = normalizeCamera(this.camera);
      this.afterNavigation();
    }
  }

  /** One Escape press closes the inspector or stops the flight. The exit needs a second press in 2 s. */
  private escape(): void {
    const action = universeEscapeAction({ inspectorOpen: !this.options.workspacePanel.hidden, flying: this.flying });
    if (action === "close-inspector") {
      this.exitConfirmation.reset();
      this.options.closeInspector();
      this.options.canvas.focus({ preventScroll: true });
    } else if (action === "stop-flight") {
      this.exitConfirmation.reset();
      this.stopFlight();
      this.updateChrome();
    } else if (this.exitConfirmation.press()) {
      this.close();
    } else {
      this.options.status.textContent = this.options.translate("universe3d.escapeAgain");
      window.setTimeout(() => {
        if (this.active && !this.exitConfirmation.armed && this.options.status.textContent === this.options.translate("universe3d.escapeAgain")) this.options.status.textContent = "";
      }, EXIT_CONFIRM_WINDOW_MS + 50);
    }
  }

  private keyUp(event: KeyboardEvent): void {
    if (event.key === "Shift") this.shiftHeld = false;
    const movement = keyMovement(event.key.toLowerCase());
    if (movement) this.heldMoves.delete(movement);
  }

  private selectAt(point: { x: number; y: number }): void {
    const hit = nearestHit(this.renderedHits, point);
    if (!hit) return;
    this.target = hit.point;
    this.targetKey = hit.point.key;
    this.autopilotStandoffAu = this.autopilotStandoff(); this.transfer = null; this.autopilotLegAu = 0;
    this.baseRenderKey = "";
    this.requestRender();
    this.updateTarget();
    // A selection shows the target card only, so that no panel covers the object. `Details` opens the inspector.
    this.hideObjectInspector();
    this.options.closeInspector();
    this.options.status.textContent = this.options.translate("universe3d.selected", { name: hit.point.name });
    this.options.stateChanged("push");
  }

  /** The touch joystick holds a move, as a held key does. */
  holdMove(movement: UniverseMove): void {
    if (!this.active) return;
    this.nudge(movement);
    this.heldMoves.add(movement);
  }

  releaseMove(movement: UniverseMove): void {
    this.heldMoves.delete(movement);
  }

  /** The labels of the last frame. Tests read this list. */
  labels(): readonly DrawnUniverseLabel[] {
    return this.drawnLabels;
  }

  private hideObjectInspector(): void {
    this.selectionConnector.hide();
    delete this.options.root.dataset.objectInspector;
  }

  private updateSelectionConnector(): void {
    const hit = this.renderedHits.find((candidate) => candidate.point.key === this.target?.key);
    this.options.selectionConnector.dataset.sphere = String((hit?.radius ?? 0) > 24);
    // The ring of the connector shows with the inspector. The target card has the ring that the canvas draws.
    if (this.options.root.dataset.objectInspector !== "true") { this.selectionConnector.hide(); return; }
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

function keyMovement(key: string): UniverseMove | undefined {
  return key === "w" ? "forward" : key === "s" ? "back"
    : key === "a" ? "left" : key === "d" ? "right"
      : key === "e" ? "up" : key === "q" ? "down" : undefined;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function positionPrecisionStep(position: Vector3): number {
  return Math.max(MIN_MOVE_STEP_AU,
    Math.max(Math.abs(position.x), Math.abs(position.y), Math.abs(position.z)) * Number.EPSILON * 16);
}
