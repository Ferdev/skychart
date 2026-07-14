import { EXPLORE_DOMAINS, MAP_FILTER_ZOOM_PRESETS } from "../atlas/atlasDefinitions";
import type { AtlasControlView } from "../atlas/atlasControlView";
import type { ActiveAtlasTab, Body, CatalogSummary, ZoomPreset } from "../atlas/contracts";
import type { CatalogPointStream } from "../catalog/catalogPointStream";
import type { ObjectComparisonView } from "../object/objectComparisonView";
import type { BodyFilter } from "../viewState";
import type { DestinationSearchConfig, DestinationSearchState, DestinationSearchView } from "./destinationSearchView";
import type { DestinationCatalogModel } from "./destinationCatalogModel";

interface DestinationCatalogState {
  activeFilter: BodyFilter;
  activeCompareFilter: BodyFilter;
  activeGuidedSetId: string | null;
  selectedKey: string;
  compareTargetKey: string | null;
}

interface DestinationCatalogControllerOptions {
  state: DestinationCatalogState;
  model: DestinationCatalogModel;
  controlView: AtlasControlView;
  searchView: DestinationSearchView;
  pointStream: CatalogPointStream;
  comparisonView: ObjectComparisonView;
  catalogSearchState: DestinationSearchState;
  compareSearchState: DestinationSearchState;
  bodySearch: HTMLInputElement;
  bodyPicker: HTMLElement;
  compareSearch: HTMLInputElement;
  comparePicker: HTMLElement;
  bodies: () => readonly Body[];
  bodyByKey: () => Map<string, Body>;
  hydrateBodies: (keys: readonly string[]) => Promise<Body[]>;
  catalogSummary: () => CatalogSummary | null;
  selectedBody: () => Body | null;
  compareTarget: () => Body | null;
  ensureCompareTarget: () => void;
  selectBodyByKey: (key: string, options: { center: boolean; zoom?: "local" }) => Promise<void>;
  setCompareTargetByKey: (key: string) => Promise<void>;
  applyZoomPreset: (preset: ZoomPreset, update?: boolean) => void;
  setActiveTab: (tab: ActiveAtlasTab) => void;
  updateStats: () => void;
  updateSelectedPanelMetrics: () => void;
  requestRender: (withData?: boolean) => void;
  translate: (key: string) => string;
  searchDebounceMs: number;
}

export class DestinationCatalogController {
  private bodyPickerTimer: number | null = null;
  private comparePickerTimer: number | null = null;

  constructor(private readonly options: DestinationCatalogControllerOptions) {}

  updateBodyFilters(): void {
    this.options.controlView.updateFilters(this.options.state.activeFilter, (filter) => this.options.model.objectTypeCount(filter));
  }

  updateExploreDomains(): void {
    this.options.controlView.updateExploreDomains(
      [...this.options.bodies()],
      this.options.catalogSummary(),
      this.options.state.activeGuidedSetId,
      this.options.state.activeFilter,
    );
  }

  async applyExploreDomain(domainId: string): Promise<void> {
    const domain = EXPLORE_DOMAINS.find((item) => item.id === domainId);
    if (!domain) return;
    this.options.state.activeFilter = domain.filterKey;
    this.options.state.activeGuidedSetId = domain.guidedSetId;
    this.options.bodySearch.value = "";
    this.options.catalogSearchState.latestBodies = [];
    this.options.catalogSearchState.activeOptionKey = null;
    this.options.pointStream.cancel();
    this.options.pointStream.clear(false);
    this.updateExploreDomains();
    this.updateBodyFilters();
    this.updateGuidedSets();
    void this.updateBodyPicker();
    this.options.applyZoomPreset(domain.zoomPreset);
    this.options.setActiveTab("catalog");
    this.options.requestRender(true);
    const guidedSet = this.options.model.activeGuidedSet();
    if (guidedSet) await this.options.hydrateBodies(guidedSet.keys);
    this.updateGuidedSets();
    await this.updateBodyPicker();
    this.options.updateStats();
    this.options.requestRender();
  }

  updateCompareFilters(): void {
    this.options.controlView.updateCompareFilters(this.options.state.activeCompareFilter);
  }

  focusMapFilter(filterKey: BodyFilter): void {
    const filter = this.options.model.filterFor(filterKey);
    if (!filter || filter.key === "all" || this.options.bodies().length === 0) return;
    const preset = MAP_FILTER_ZOOM_PRESETS[filterKey];
    if (preset) this.options.applyZoomPreset(preset, false);
  }

  async updateBodyPicker(): Promise<void> {
    const config = this.bodyPickerConfig();
    if (config) await this.options.searchView.update(config);
  }

  bodyPickerConfig(): DestinationSearchConfig | null {
    if (this.options.bodies().length === 0) return null;
    return {
      state: this.options.catalogSearchState,
      input: this.options.bodySearch,
      picker: this.options.bodyPicker,
      filter: this.options.model.activeFilter(),
      sourceBodies: this.options.model.exploreBodies(),
      activeKey: this.options.state.selectedKey,
      currentTargetKey: this.options.state.selectedKey,
      guidedSet: this.options.model.activeGuidedSet(),
      emptyMessage: this.options.translate("search.noObjects"),
      loadingMessage: this.options.translate("search.loading"),
      fallbackMessage: this.options.translate("search.fallback"),
    };
  }

  scheduleBodyPicker(): void {
    if (this.bodyPickerTimer !== null) window.clearTimeout(this.bodyPickerTimer);
    this.bodyPickerTimer = window.setTimeout(() => {
      this.bodyPickerTimer = null;
      void this.updateBodyPicker();
    }, this.options.searchDebounceMs);
  }

  scheduleComparePicker(): void {
    if (this.comparePickerTimer !== null) window.clearTimeout(this.comparePickerTimer);
    this.comparePickerTimer = window.setTimeout(() => {
      this.comparePickerTimer = null;
      void this.updateComparePicker();
    }, this.options.searchDebounceMs);
  }

  updateGuidedSets(): void {
    this.options.controlView.updateGuidedSets(this.options.bodyByKey(), this.options.state.activeGuidedSetId);
  }

  updateCompareUi(): void {
    this.options.ensureCompareTarget();
    void this.updateComparePicker();
    this.updateComparePanel();
  }

  async updateComparePicker(): Promise<void> {
    const config = this.comparePickerConfig();
    if (!config) {
      this.options.compareSearchState.latestBodies = [];
      this.options.comparePicker.innerHTML = "";
      this.options.updateSelectedPanelMetrics();
      return;
    }
    await this.options.searchView.update(config);
  }

  comparePickerConfig(): DestinationSearchConfig | null {
    const selected = this.options.selectedBody();
    if (!selected) return null;
    const target = this.options.compareTarget();
    return {
      state: this.options.compareSearchState,
      input: this.options.compareSearch,
      picker: this.options.comparePicker,
      filter: this.options.model.activeCompareFilter(),
      sourceBodies: [...this.options.bodies()],
      activeKey: this.options.state.compareTargetKey,
      currentTargetKey: selected.key,
      excludeKeys: [selected.key],
      emptyMessage: this.options.translate("compare.noMatches"),
      loadingMessage: this.options.translate("search.loading"),
      fallbackMessage: this.options.translate("search.fallback"),
      queryForSearch: (query) => target && query.toLowerCase() === target.name.toLowerCase() ? "" : query,
      afterRender: this.options.updateSelectedPanelMetrics,
    };
  }

  updateComparePanel(): void {
    this.options.comparisonView.update(this.options.selectedBody(), this.options.compareTarget());
  }

  async focusPrimaryResult(): Promise<void> {
    const body = this.options.model.primaryFocusCandidate(this.options.bodySearch.value.trim());
    if (body) await this.options.selectBodyByKey(body.key, { center: true, zoom: "local" });
  }

  async focusCompareResult(): Promise<void> {
    const body = this.options.model.compareFocusCandidate(this.options.compareSearch.value.trim());
    if (body && body.key !== this.options.state.selectedKey) await this.options.setCompareTargetByKey(body.key);
  }
}
