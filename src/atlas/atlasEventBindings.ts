import { bindControlInfoTips, bindScaleDisclosures } from "../controlPanelInteractions";
import { decodeViewState, type DisplayLayer } from "../viewState";
import type { MapInteractionController } from "../navigation/mapInteractionController";
import type { SizeMode, ZoomPreset } from "./contracts";
import type { atlasDom } from "./atlasDom";

interface AtlasEventState {
  viewTime: "now" | string;
  sizeMode: SizeMode;
  displayLayers: Record<DisplayLayer, boolean>;
  performanceEnabled: boolean;
}

interface AtlasEventBindingsOptions {
  dom: typeof atlasDom;
  state: AtlasEventState;
  mapInteraction: MapInteractionController;
  bindDestinations: () => void;
  restoreTourStep: (step: number) => void;
  restoreViewState: (state: ReturnType<typeof decodeViewState> & {}) => void;
  exportCurrentView: () => void;
  shareCurrentView: (preferNative: boolean) => void;
  copyEmbedSnippet: () => void;
  activateEmbedInteraction: () => void;
  loadAtlas: (timestampIso?: string) => void;
  dateFromInput: () => Date | null;
  updateTimeSummary: () => void;
  updateTimeStepUi: () => void;
  stepTime: (direction: -1 | 1) => void;
  applyZoomPreset: (preset: ZoomPreset) => void;
  zoomViewportCenter: (factor: number) => void;
  setZoomFromSlider: () => void;
  updateSizeModes: () => void;
  updateDisplayToggles: () => void;
  updatePerformanceHud: () => void;
  updateAllUi: () => void;
  resizeCanvas: () => void;
  updateSelectedPanelMetrics: () => void;
  requestRender: (withData?: boolean) => void;
  scheduleViewStateReplace: () => void;
  translate: (key: string) => string;
}

export function bindAtlasEvents(options: AtlasEventBindingsOptions): void {
  const { dom, state } = options;
  bindScaleDisclosures();
  bindControlInfoTips(dom.controlInfoTooltip);
  dom.sharePopover.addEventListener("toggle", () => {
    dom.shareMenuButton.setAttribute("aria-expanded", String(dom.sharePopover.matches(":popover-open")));
  });
  dom.closeSharePopoverButton.addEventListener("click", () => dom.sharePopover.hidePopover());
  dom.exportButton.addEventListener("click", options.exportCurrentView);
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const tourStep = Number(params.get("step"));
    if (params.get("tour") && Number.isSafeInteger(tourStep) && tourStep >= 0) {
      options.restoreTourStep(tourStep);
      return;
    }
    const view = decodeViewState(window.location.search);
    if (view) options.restoreViewState(view);
  });
  dom.copyLinkButton.addEventListener("click", () => options.shareCurrentView(false));
  dom.shareCompareButton.addEventListener("click", () => options.shareCurrentView(false));
  dom.nativeShareButton.addEventListener("click", () => options.shareCurrentView(true));
  dom.nativeShareButton.hidden = typeof navigator.share !== "function";
  dom.copyEmbedButton.addEventListener("click", options.copyEmbedSnippet);
  dom.embedActivation.addEventListener("click", options.activateEmbedInteraction);
  window.addEventListener("cosmic-atlas:locale-change", () => {
    if (dom.loadingScreen.hidden) dom.loadState.textContent = dom.errorPanel.hidden
      ? options.translate("status.ready")
      : options.translate("status.error");
    options.updateAllUi();
    options.updateTimeSummary();
    options.updateTimeStepUi();
    options.requestRender(true);
    options.scheduleViewStateReplace();
  });
  window.addEventListener("resize", () => {
    options.resizeCanvas();
    options.updateSelectedPanelMetrics();
    options.requestRender(true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "p" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    state.performanceEnabled = !state.performanceEnabled;
    window.localStorage.setItem("starsmap:perf", state.performanceEnabled ? "1" : "0");
    dom.diagnosticsToggle.checked = state.performanceEnabled;
    options.updatePerformanceHud();
  });

  options.bindDestinations();
  dom.timeNow.addEventListener("click", () => {
    dom.timeInput.value = localDatetimeValue(new Date());
    state.viewTime = "now";
    options.loadAtlas();
  });
  dom.applyTime.addEventListener("click", () => {
    const date = options.dateFromInput();
    if (date) options.loadAtlas(date.toISOString());
  });
  dom.timeStepSlider.addEventListener("input", options.updateTimeStepUi);
  dom.timeStepBack.addEventListener("click", () => options.stepTime(-1));
  dom.timeStepForward.addEventListener("click", () => options.stepTime(1));
  dom.zoomPresets.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-zoom-preset]");
    if (button) options.applyZoomPreset((button.dataset.zoomPreset as ZoomPreset) ?? "solar");
  });
  dom.zoomOut.addEventListener("click", () => options.zoomViewportCenter(1 / 2.4));
  dom.zoomIn.addEventListener("click", () => options.zoomViewportCenter(2.4));
  dom.zoomScaleSlider.addEventListener("input", options.setZoomFromSlider);
  dom.sizeModeButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-size-mode]");
    if (!button) return;
    state.sizeMode = (button.dataset.sizeMode as SizeMode) ?? "hybrid";
    options.updateSizeModes();
    options.requestRender();
  });
  dom.displayToggles.addEventListener("change", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-layer]");
    if (!input) return;
    state.displayLayers = { ...state.displayLayers, [input.dataset.layer as DisplayLayer]: input.checked };
    options.updateDisplayToggles();
    options.requestRender();
    options.scheduleViewStateReplace();
  });
  dom.diagnosticsToggle.addEventListener("change", () => {
    state.performanceEnabled = dom.diagnosticsToggle.checked;
    window.localStorage.setItem("starsmap:perf", state.performanceEnabled ? "1" : "0");
    options.updatePerformanceHud();
  });
  options.mapInteraction.bind();
}

function localDatetimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
