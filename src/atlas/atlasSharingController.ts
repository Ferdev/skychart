import { trackEvent } from "../analytics";
import type { Body, Camera, Ephemeris } from "./contracts";
import type { CatalogPointManifestRepository } from "../catalog/catalogPointManifest";
import { composeAtlasPng } from "../exportCompositor";
import { t } from "../i18n";
import { encodeViewState, type ViewState } from "../viewState";
import type { WebglPointRenderer } from "../webglPointRenderer";
import { atlasDom } from "./atlasDom";

type AtlasSharingControllerOptions = {
  isEmbedMode: boolean;
  viewState: () => ViewState;
  selectedBody: () => Body | null;
  camera: () => Camera;
  ephemeris: () => Ephemeris | null;
  pointRenderer: WebglPointRenderer;
  manifest: CatalogPointManifestRepository;
  preparePointLayers: () => void;
  replaceViewState: () => void;
  requestRender: () => void;
};

/** Owns canonical links, embed markup, native/clipboard sharing, and PNG export. */
export class AtlasSharingController {
  constructor(private readonly options: AtlasSharingControllerOptions) {}

  canonicalViewUrl() {
    const url = new URL("/", window.location.origin);
    url.search = encodeViewState(this.options.viewState());
    return url.toString();
  }

  updateEmbedAttribution() {
    if (!this.options.isEmbedMode) return;
    const selected = this.options.selectedBody();
    atlasDom.embedViewName.textContent = selected?.name ?? t("launch.openFullAtlas");
    if (selected) {
      const url = new URL(`/o/${encodeURIComponent(selected.key)}`, window.location.origin);
      url.search = encodeViewState(this.options.viewState());
      atlasDom.embedCanonicalLink.href = url.toString();
    } else {
      atlasDom.embedCanonicalLink.href = this.canonicalViewUrl();
    }
  }

  async copyEmbedSnippet() {
    const url = new URL("/embed", window.location.origin);
    url.search = encodeViewState(this.options.viewState());
    const selected = this.options.selectedBody();
    const title = selected ? `Cosmic Atlas · ${selected.name}` : t("launch.iframeTitle");
    const snippet = `<iframe src="${escapeAttribute(url.toString())}" width="960" height="600" loading="lazy" title="${escapeAttribute(title)}"></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      atlasDom.embedFeedback.textContent = t("launch.iframeCopied");
      trackEvent("share", { method: "embed" });
    } catch {
      atlasDom.embedFeedback.textContent = t("launch.iframeCopyFailed");
    }
    window.setTimeout(() => { atlasDom.embedFeedback.textContent = ""; }, 2500);
  }

  async share(preferNative: boolean) {
    this.options.replaceViewState();
    try {
      if (preferNative && navigator.share) {
        await navigator.share({ title: document.title, url: window.location.href });
        atlasDom.shareFeedback.textContent = t("launch.linkShared");
        trackEvent("share", { method: "native" });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        atlasDom.shareFeedback.textContent = t("launch.linkCopied");
        trackEvent("share", { method: "clipboard" });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      atlasDom.shareFeedback.textContent = t("launch.shareFailed");
    }
    window.setTimeout(() => { atlasDom.shareFeedback.textContent = ""; }, 2500);
  }

  async exportCurrentView() {
    const limits = this.options.pointRenderer.getExportLimits();
    if (!limits) {
      atlasDom.exportStatus.textContent = t("launch.webglRequired");
      return;
    }
    const tier = atlasDom.exportResolution.value;
    const requestedWidth = tier === "8k" ? 8000 : tier === "4k" ? 3840 : atlasDom.canvas.width;
    atlasDom.exportButton.disabled = true;
    atlasDom.exportResolution.disabled = true;
    atlasDom.exportStatus.textContent = t("launch.preparingImage");
    try {
      this.options.preparePointLayers();
      const camera = this.options.camera();
      const ephemeris = this.options.ephemeris();
      const blob = await composeAtlasPng({
        width: requestedWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        maxTileSize: limits.maxTileSize,
        overlay: atlasDom.canvas,
        provenance: {
          centerXAu: camera.xAu, centerYAu: camera.yAu, pxPerAu: camera.pxPerAu,
          epoch: ephemeris?.timestamp_utc ?? "unknown",
          catalogVersion: this.options.manifest.value?.version ?? "unknown",
          attribution: "Catalog data: ESA/Gaia/DPAC · DESI DR1 · Quaia · NASA/JPL · SIMBAD/CDS",
        },
        renderPoints: (tile) => this.options.pointRenderer.exportPixels({
          camera: tile.camera, centerX: tile.width / (2 * tile.scale), centerY: tile.height / (2 * tile.scale),
          width: tile.width, height: tile.height, dpr: tile.scale,
          clip: { left: 0, top: 0, right: tile.width / tile.scale, bottom: tile.height / tile.scale },
        }),
        onProgress: (complete, total) => { atlasDom.exportStatus.textContent = t("launch.renderingImage", { percent: Math.round(complete / total * 100) }); },
      });
      atlasDom.exportStatus.dataset.provenance = `${this.options.manifest.value?.version ?? "unknown"}|${ephemeris?.timestamp_utc ?? "unknown"}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cosmic-atlas-${tier}-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      atlasDom.exportStatus.textContent = t("launch.pngDownloaded");
      trackEvent("export", { resolution_tier: tier });
    } catch (error) {
      atlasDom.exportStatus.textContent = error instanceof Error ? error.message : t("launch.exportFailed");
    } finally {
      atlasDom.exportButton.disabled = false;
      atlasDom.exportResolution.disabled = false;
      this.options.requestRender();
    }
  }
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
