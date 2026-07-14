import { trackAnalytics } from "../analytics";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import type { ViewportCatalogLoader } from "../catalog/viewportCatalogLoader";

interface AtlasEmbedControllerOptions {
  enabled: boolean;
  canvas: HTMLCanvasElement;
  activation: HTMLButtonElement;
  attribution: HTMLElement;
  pointStream: CatalogPointStream;
  viewportLoader: ViewportCatalogLoader;
  updateAttribution: () => void;
  cancelCameraAnimation: () => void;
  suspendRendering: () => void;
  requestRender: () => void;
}

export class AtlasEmbedController {
  private activatedState: boolean;
  private visibleState = true;

  constructor(private readonly options: AtlasEmbedControllerOptions) {
    this.activatedState = !options.enabled;
  }

  get activated(): boolean {
    return this.activatedState;
  }

  get visible(): boolean {
    return this.visibleState;
  }

  initialize(): void {
    if (!this.options.enabled) return;
    document.body.dataset.atlasMode = "embed";
    document.body.dataset.embedActive = "false";
    this.options.canvas.tabIndex = 0;
    this.options.activation.hidden = false;
    this.options.attribution.hidden = false;
    this.options.updateAttribution();
    trackAnalytics("embed_loaded");
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      const visible = Boolean(entry?.isIntersecting);
      if (visible === this.visibleState) return;
      this.visibleState = visible;
      document.body.dataset.embedVisible = String(visible);
      if (!visible) {
        this.options.cancelCameraAnimation();
        this.options.pointStream.cancel();
        this.options.viewportLoader.cancel();
        this.options.suspendRendering();
      } else {
        this.options.requestRender();
      }
    }, { threshold: 0.01 });
    observer.observe(document.querySelector("#app")!);
  }

  activate(): void {
    if (!this.options.enabled || this.activatedState) return;
    this.activatedState = true;
    document.body.dataset.embedActive = "true";
    this.options.activation.hidden = true;
    this.options.activation.setAttribute("aria-pressed", "true");
    this.options.canvas.focus({ preventScroll: true });
  }
}
