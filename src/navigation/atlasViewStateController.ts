import { DISPLAY_LAYERS, encodeViewState, type BodyFilter, type DisplayLayer, type ViewState } from "../viewState";
import type { Camera, SelectBodyOptions, ZoomPreset } from "../atlas/contracts";
import type { CatalogPointManifestRepository } from "../catalog/catalogPointManifest";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import { clamp } from "../geometry";

export interface AtlasViewStateAccess {
  camera: Camera;
  viewTime: "now" | string;
  activeZoomPreset: ZoomPreset | null;
  displayLayers: Record<DisplayLayer, boolean>;
  activeFilter: BodyFilter;
  activeCompareFilter: BodyFilter;
  selectedKey: string;
  compareTargetKey: string | null;
}

interface AtlasViewStateControllerOptions {
  state: AtlasViewStateAccess;
  manifest: CatalogPointManifestRepository;
  pointStream: CatalogPointStream;
  minimumZoom: number;
  maximumZoom: number;
  localZoomDurationMs: number;
  isEmbedMode: boolean;
  hasEphemeris: () => boolean;
  transientSelectedKey: () => string | null;
  selectBodyByKey: (key: string, options?: SelectBodyOptions) => Promise<void>;
  setCompareTargetByKey: (key: string) => Promise<void>;
  updateAllUi: () => void;
  updateScale: () => void;
  requestRender: (withData?: boolean) => void;
  requestDataRefresh: () => void;
  loadAtlas: (timestampIso?: string) => Promise<void>;
  animateCameraTo: (target: Camera, durationMs: number, onComplete: () => void) => void;
}

export interface TourNavigationOptions {
  animate: boolean;
  slug: string;
  step: number;
  restoring: boolean;
  signal: AbortSignal;
}

export class AtlasViewStateController {
  private requestedCatalogRelease: string | undefined;
  private historyRestoreInProgress = false;
  private replaceTimer: number | null = null;
  private pendingSelectionState: ViewState | null;

  constructor(private readonly options: AtlasViewStateControllerOptions, bootState: ViewState | null) {
    this.pendingSelectionState = bootState;
  }

  get restoring(): boolean {
    return this.historyRestoreInProgress;
  }

  get hasPendingSelection(): boolean {
    return this.pendingSelectionState !== null;
  }

  takePendingSelection(): ViewState | null {
    const pending = this.pendingSelectionState;
    this.pendingSelectionState = null;
    return pending;
  }

  applyFields(view: ViewState): void {
    const state = this.options.state;
    state.camera = {
      xAu: view.center.x,
      yAu: view.center.y,
      pxPerAu: clamp(view.zoom, this.options.minimumZoom, this.options.maximumZoom),
    };
    state.viewTime = view.time;
    this.requestedCatalogRelease = view.catalogRelease;
    state.activeZoomPreset = null;
    for (const layer of DISPLAY_LAYERS) {
      if (view.layers[layer] !== undefined) state.displayLayers[layer] = view.layers[layer];
    }
    if (view.filters) {
      state.activeFilter = view.filters.primary;
      state.activeCompareFilter = view.filters.compare;
    }
    state.selectedKey = view.compare?.[0] ?? view.objectKey ?? "";
    state.compareTargetKey = view.compare?.[1] ?? null;
  }

  current(): ViewState {
    const state = this.options.state;
    const stableSelectedKey = state.selectedKey && state.selectedKey !== this.options.transientSelectedKey()
      ? state.selectedKey
      : "";
    return {
      center: { x: state.camera.xAu, y: state.camera.yAu },
      zoom: state.camera.pxPerAu,
      time: state.viewTime,
      objectKey: stableSelectedKey || undefined,
      compare: stableSelectedKey && state.compareTargetKey
        ? [stableSelectedKey, state.compareTargetKey]
        : undefined,
      catalogRelease: this.options.manifest.value?.version ?? this.requestedCatalogRelease,
      layers: { ...state.displayLayers },
      filters: { primary: state.activeFilter, compare: state.activeCompareFilter },
    };
  }

  currentUrl(): string {
    const params = new URLSearchParams(encodeViewState(this.current()));
    const existing = new URLSearchParams(window.location.search);
    for (const name of ["perf", "dynamicPointFallback"]) {
      const value = existing.get(name);
      if (value !== null) params.set(name, value);
    }
    return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  }

  replace(): void {
    if (!this.historyRestoreInProgress && this.options.hasEphemeris() && !this.isTourUrl()) {
      history.replaceState(null, "", this.currentUrl());
    }
  }

  scheduleReplace(): void {
    if (this.historyRestoreInProgress || this.isTourUrl()) return;
    if (this.replaceTimer !== null) window.clearTimeout(this.replaceTimer);
    this.replaceTimer = window.setTimeout(() => {
      this.replaceTimer = null;
      this.replace();
    }, 300);
  }

  push(): void {
    if (this.historyRestoreInProgress || !this.options.hasEphemeris()) return;
    if (this.replaceTimer !== null) window.clearTimeout(this.replaceTimer);
    this.replaceTimer = null;
    history.pushState(null, "", this.currentUrl());
  }

  async restoreSelection(view: ViewState): Promise<void> {
    const selected = view.compare?.[0] ?? view.objectKey;
    if (selected) await this.options.selectBodyByKey(selected);
    if (view.compare?.[1]) await this.options.setCompareTargetByKey(view.compare[1]);
  }

  async restore(view: ViewState): Promise<void> {
    this.historyRestoreInProgress = true;
    this.clearReplaceTimer();
    const oldTime = this.options.state.viewTime;
    this.applyFields(view);
    this.pendingSelectionState = view;
    this.options.updateAllUi();
    this.options.requestRender(true);
    if (oldTime !== view.time) await this.options.loadAtlas(view.time === "now" ? undefined : view.time);
    else {
      this.pendingSelectionState = null;
      await this.restoreSelection(view);
    }
    this.historyRestoreInProgress = false;
  }

  async navigateTour(view: ViewState, navigation: TourNavigationOptions): Promise<void> {
    if (navigation.restoring) this.historyRestoreInProgress = true;
    const start = { ...this.options.state.camera };
    this.applyFields(view);
    const target = { ...this.options.state.camera };
    if (navigation.animate) {
      this.options.state.camera = start;
      await new Promise<void>((resolve) => this.options.animateCameraTo(target, this.options.localZoomDurationMs, resolve));
    } else {
      this.options.state.camera = target;
      this.options.updateScale();
      this.options.requestRender(true);
    }
    if (navigation.signal.aborted) return this.finishTourRestore(navigation);
    await this.restoreSelection(view);
    if (navigation.signal.aborted) return this.finishTourRestore(navigation);
    const params = new URLSearchParams(encodeViewState({ ...view, tour: navigation.slug, step: navigation.step }));
    const perf = new URLSearchParams(window.location.search).get("perf");
    if (perf !== null) params.set("perf", perf);
    const url = `${window.location.pathname}?${params.toString()}`;
    if (navigation.restoring) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    this.options.requestDataRefresh();
    this.finishTourRestore(navigation);
  }

  prewarmTour(view: ViewState): void {
    if (!this.options.hasEphemeris() || this.options.manifest.state !== "ready" || this.options.isEmbedMode) return;
    const previous = this.options.state.camera;
    this.options.state.camera = {
      xAu: view.center.x,
      yAu: view.center.y,
      pxPerAu: clamp(view.zoom, this.options.minimumZoom, this.options.maximumZoom),
    };
    this.options.pointStream.prewarm();
    this.options.state.camera = previous;
  }

  private finishTourRestore(navigation: TourNavigationOptions): void {
    if (navigation.restoring) this.historyRestoreInProgress = false;
  }

  private clearReplaceTimer(): void {
    if (this.replaceTimer !== null) window.clearTimeout(this.replaceTimer);
    this.replaceTimer = null;
  }

  private isTourUrl(): boolean {
    return new URLSearchParams(window.location.search).has("tour");
  }
}
