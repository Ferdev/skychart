import type { DataRefreshOptions, RenderRequestOptions } from "./contracts";

type RefreshTarget = { schedule(options?: DataRefreshOptions): void };

export type AtlasRefreshSchedulerOptions = {
  /** False while the 2D map must not draw: 3D mode is open, or the embed is not in view. */
  canRender: () => boolean;
  /** False while the embed is not in view. Data loads then wait. */
  canLoadData: () => boolean;
  render: () => void;
  invalidate: () => void;
  viewportLoader: RefreshTarget;
  pointStream: RefreshTarget;
  viewStateChanged: () => void;
  cameraDebounceMs: number;
};

/** Owns the animation frame and the debounce timer that redraw the 2D map and reload its data. */
export class AtlasRefreshScheduler {
  private frameId: number | null = null;
  private cameraTimer: number | null = null;

  constructor(private readonly options: AtlasRefreshSchedulerOptions) {}

  requestRender(request: RenderRequestOptions = {}): void {
    if (!this.options.canRender()) return;
    this.options.invalidate();
    if (request.data) this.requestDataRefresh();
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.options.render();
    });
  }

  requestDataRefresh(request: DataRefreshOptions = {}): void {
    if (!this.options.canLoadData()) return;
    this.clearCameraTimer();
    this.options.viewportLoader.schedule(request);
    this.options.pointStream.schedule(request);
  }

  /** Reloads data a short time after the last camera change, so that a drag does not start a request for each frame. */
  scheduleCameraDataRefresh(): void {
    this.clearCameraTimer();
    this.cameraTimer = window.setTimeout(() => {
      this.cameraTimer = null;
      this.requestDataRefresh();
    }, this.options.cameraDebounceMs);
    this.options.viewStateChanged();
  }

  suspend(): void {
    this.clearCameraTimer();
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private clearCameraTimer(): void {
    if (this.cameraTimer !== null) window.clearTimeout(this.cameraTimer);
    this.cameraTimer = null;
  }
}
