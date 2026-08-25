import { trackAnalytics } from "../analytics";
import type { Body } from "../atlas/contracts";
import { GUIDED_SETS } from "../atlas/atlasDefinitions";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import type { DestinationSearchConfig, DestinationSearchState, DestinationSearchView } from "./destinationSearchView";
import type { ObjectInspectionView } from "../object/objectInspectionView";
import { t } from "../i18n";
import type { BodyFilter } from "../viewState";
import { atlasDom } from "../atlas/atlasDom";

type MutableDestinationState = {
  activeGuidedSetId: string | null;
  activeFilter: BodyFilter;
  activeCompareFilter: BodyFilter;
  activeTab: "catalog" | "object" | null;
  compareTargetKey: string | null;
};

type DestinationEventBindingsOptions = {
  state: MutableDestinationState;
  catalogSearchState: DestinationSearchState;
  compareSearchState: DestinationSearchState;
  searchView: DestinationSearchView;
  pointStream: CatalogPointStream;
  inspection: ObjectInspectionView;
  bodyByKey: () => ReadonlyMap<string, Body>;
  bodyPickerConfig: () => DestinationSearchConfig | null;
  comparePickerConfig: () => DestinationSearchConfig | null;
  scheduleBodyPickerUpdate: () => void;
  scheduleComparePickerUpdate: () => void;
  updateBodyPicker: () => void | Promise<void>;
  updateComparePicker: () => void | Promise<void>;
  updateExploreDomains: () => void;
  updateGuidedSets: () => void;
  updateBodyFilters: () => void;
  updateCompareFilters: () => void;
  updateStats: () => void;
  updateComparePanel: () => void;
  focusSearchResult: () => void | Promise<void>;
  focusCompareResult: () => void | Promise<void>;
  selectBodyByKey: (key: string, options?: { center?: boolean; animate?: boolean }) => void | Promise<void>;
  selectBody: (key: string, options?: { center?: boolean; zoom?: "local"; animate?: boolean }) => void;
  setCompareTargetByKey: (key: string) => void | Promise<void>;
  clearSelectedObject: () => void;
  setActiveTab: (tab: "catalog" | "object" | null) => void;
  focusMapFilter: (filter: BodyFilter) => void;
  applyExploreDomain: (id: string) => void | Promise<void>;
  fitBodies: (bodies: Body[], paddingRatio: number) => void;
  centerOnSelected: (zoom: boolean) => void;
  updateScale: () => void;
  requestRender: (withData?: boolean) => void;
  pushViewState: () => void;
};

/** Binds all search, destination, comparison, and guided-set interactions. */
export function bindDestinationEvents(options: DestinationEventBindingsOptions) {
  const dom = atlasDom;
  dom.bodySearch.addEventListener("input", () => {
    options.state.activeGuidedSetId = null;
    options.searchView.reset(options.catalogSearchState);
    options.searchView.renderStatus(dom.bodyPicker, t("search.loading"), "updating");
    options.updateExploreDomains();
    options.updateGuidedSets();
    options.scheduleBodyPickerUpdate();
  });
  dom.bodySearch.addEventListener("keydown", (event) => {
    if (options.searchView.handleKeyboard(event, {
      state: options.catalogSearchState, input: dom.bodySearch, picker: dom.bodyPicker,
      onSelect: (key) => void options.selectBodyByKey(key, { center: true }),
      onFallbackEnter: () => void options.focusSearchResult(),
      onEscapeClear: () => { options.state.activeGuidedSetId = null; options.searchView.reset(options.catalogSearchState); void options.updateBodyPicker(); },
    })) event.preventDefault();
  });
  dom.focusBodyButton.addEventListener("click", () => void options.focusSearchResult());
  dom.quickFocusButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-focus-key]");
    if (button) options.selectBody(button.dataset.focusKey ?? "", { center: true, zoom: "local" });
  });
  dom.bodyInfo.addEventListener("click", (event) => {
    if (options.inspection.handleViewClick(event.target)) return;
    const observe = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-observe-location]");
    if (observe) { void options.inspection.requestObservation(observe.dataset.observeLocation === "browser"); return; }
    const citation = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy-citation]");
    if (citation) {
      const body = options.bodyByKey().get(citation.dataset.copyCitation ?? "");
      if (body) void options.inspection.copyCitationDetails(body, citation);
      return;
    }
    const related = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-related-key]");
    if (related) void options.selectBodyByKey(related.dataset.relatedKey ?? "", { center: true, animate: true });
  });
  dom.bodyInfo.addEventListener("keydown", (event) => {
    if (options.inspection.handleViewKeydown(event)) event.preventDefault();
  });
  dom.tabButtons.forEach((button) => button.addEventListener("click", () => {
    const tab = (button.dataset.tab as "catalog" | "object") ?? "catalog";
    options.setActiveTab(options.state.activeTab === tab && tab !== "catalog" ? null : tab);
  }));
  dom.closePanel.addEventListener("click", () => options.state.activeTab === "object" ? options.clearSelectedObject() : options.setActiveTab(null));
  dom.workspaceSearchLink.addEventListener("click", () => options.setActiveTab("catalog"));
  dom.mobileScaleToggle?.addEventListener("click", () => {
    const expanded = dom.mapHud.classList.toggle("scale-expanded");
    dom.mobileScaleToggle?.setAttribute("aria-expanded", String(expanded));
    dom.mobileScaleToggle?.setAttribute("aria-label", expanded ? t("scale.collapse") : t("scale.expand"));
  });

  const filterClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    if (!button) return;
    options.state.activeFilter = (button.dataset.bodyFilter as BodyFilter) ?? "all";
    const focusMap = event.currentTarget === dom.mapFilterButtons;
    trackAnalytics("filter", { filter: options.state.activeFilter });
    options.state.activeGuidedSetId = null;
    dom.bodySearch.value = "";
    options.searchView.reset(options.catalogSearchState, { preserveActiveOption: true });
    options.pointStream.cancel();
    options.pointStream.clear(false);
    options.updateExploreDomains(); options.updateBodyFilters(); options.updateGuidedSets(); options.updateStats();
    void options.updateBodyPicker();
    if (focusMap) options.focusMapFilter(options.state.activeFilter);
    options.requestRender(true);
    options.pushViewState();
  };
  dom.bodyFilterButtons.addEventListener("click", filterClick);
  dom.mapFilterButtons.addEventListener("click", filterClick);
  dom.exploreDomains.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-explore-domain]");
    if (button) void options.applyExploreDomain(button.dataset.exploreDomain ?? "");
  });
  dom.bodyPicker.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-picker-load-more]")) {
      const config = options.bodyPickerConfig(); if (config) void options.searchView.loadMore(config); return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-key]");
    if (button) void options.selectBodyByKey(button.dataset.bodyKey ?? "", { center: true });
  });
  dom.guidedTours.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tour-id]");
    const tour = GUIDED_SETS.find((item) => item.id === button?.dataset.tourId);
    if (!tour) return;
    trackAnalytics("tour_started", { tour: tour.id });
    const bodies = tour.keys.map((key) => options.bodyByKey().get(key)).filter((body): body is Body => Boolean(body));
    if (bodies.length === 0) return;
    options.state.activeGuidedSetId = tour.id;
    options.state.activeFilter = "all";
    dom.bodySearch.value = "";
    options.searchView.reset(options.catalogSearchState);
    options.fitBodies(bodies, 0.2);
    options.setActiveTab("catalog");
    options.updateExploreDomains(); options.updateBodyFilters(); options.updateGuidedSets();
    void options.updateBodyPicker(); options.updateScale(); options.requestRender(true);
  });
  dom.centerSelected.addEventListener("click", () => options.centerOnSelected(false));
  dom.zoomSelected.addEventListener("click", () => options.centerOnSelected(true));
  dom.compareSelected.addEventListener("click", () => {
    const open = dom.selectionCompare.hidden;
    dom.bodyInfo.hidden = open;
    dom.selectionCompare.hidden = !open;
    dom.selectedObjectPanel.classList.toggle("is-comparing", open);
    dom.compareSelected.setAttribute("aria-expanded", String(open));
    if (open) dom.compareSearch.focus();
    options.requestRender();
  });

  dom.compareSearch.addEventListener("input", () => {
    options.searchView.reset(options.compareSearchState);
    options.searchView.renderStatus(dom.comparePicker, t("search.loading"), "updating");
    options.scheduleComparePickerUpdate();
  });
  dom.compareSearch.addEventListener("keydown", (event) => {
    if (options.searchView.handleKeyboard(event, {
      state: options.compareSearchState, input: dom.compareSearch, picker: dom.comparePicker,
      onSelect: (key) => void options.setCompareTargetByKey(key), onFallbackEnter: () => void options.focusCompareResult(),
      onEscapeClear: () => void options.updateComparePicker(),
    })) event.preventDefault();
  });
  dom.compareFocus.addEventListener("click", () => void options.focusCompareResult());
  dom.compareFilterButtons.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-filter]");
    if (!button) return;
    options.state.activeCompareFilter = (button.dataset.bodyFilter as BodyFilter) ?? "all";
    trackAnalytics("filter", { filter: options.state.activeCompareFilter });
    dom.compareSearch.value = "";
    options.searchView.reset(options.compareSearchState, { preserveActiveOption: true });
    options.updateCompareFilters(); void options.updateComparePicker();
  });
  dom.comparePicker.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-picker-load-more]")) {
      const config = options.comparePickerConfig(); if (config) void options.searchView.loadMore(config); return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-body-key]");
    if (button) void options.setCompareTargetByKey(button.dataset.bodyKey ?? "");
  });
  dom.clearCompare.addEventListener("click", () => {
    options.state.compareTargetKey = null;
    dom.compareSearch.value = "";
    options.searchView.reset(options.compareSearchState);
    options.state.activeCompareFilter = "all";
    void options.updateComparePicker(); options.updateCompareFilters(); options.updateComparePanel(); options.requestRender(); options.pushViewState();
  });
}
