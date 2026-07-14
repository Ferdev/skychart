import { classifyBody, recordRecentDestination, type RecentDestination } from "../destinationPicker";
import { trackAnalytics } from "../analytics";
import type { CatalogObjectHydrator } from "../catalog/catalogObjectHydrator";
import type { DestinationSearchState } from "../destination/destinationSearchView";
import type { ActiveAtlasTab, Body, ObjectDetailHydrationState, SelectBodyOptions } from "../atlas/contracts";

export interface ObjectSelectionState {
  selectedKey: string;
  compareTargetKey: string | null;
  activeTab: ActiveAtlasTab;
  activeGuidedSetId: string | null;
  recentDestinations: RecentDestination[];
}

interface ObjectSelectionControllerOptions {
  state: ObjectSelectionState;
  bodyByKey: () => Map<string, Body>;
  catalogSearchState: DestinationSearchState;
  compareSearchState: DestinationSearchState;
  bodySearch: HTMLInputElement;
  compareSearch: HTMLInputElement;
  hydrator: CatalogObjectHydrator;
  hydrationStates: Map<string, ObjectDetailHydrationState>;
  mergeBody: (body: Body) => void;
  transientKey: () => string | null;
  setTransientKey: (key: string | null) => void;
  cleanupTransient: (key: string | null) => void;
  cancelMapSelection: () => void;
  updateAllUi: () => void;
  updateCompareUi: () => void;
  centerOnBody: (body: Body, zoom: boolean, animate: boolean) => void;
  requestRender: (withData: boolean) => void;
  pushViewState: () => void;
}

export class ObjectSelectionController {
  constructor(private readonly options: ObjectSelectionControllerOptions) {}

  selectedBody(): Body | null {
    return this.options.bodyByKey().get(this.options.state.selectedKey) ?? null;
  }

  compareTarget(): Body | null {
    const { compareTargetKey, selectedKey } = this.options.state;
    if (!compareTargetKey || compareTargetKey === selectedKey) return null;
    return this.options.bodyByKey().get(compareTargetKey) ?? null;
  }

  async setCompareTargetByKey(key: string): Promise<void> {
    const body = await this.options.hydrator.ensure(key);
    if (body) this.setCompareTarget(body.key);
  }

  setCompareTarget(key: string): void {
    const body = this.options.bodyByKey().get(key);
    if (!body || body.key === this.options.state.selectedKey) return;
    this.options.state.compareTargetKey = body.key;
    trackAnalytics("compare", { object_type: classifyBody(body).type });
    this.options.compareSearch.value = body.name;
    this.options.compareSearchState.activeOptionKey = null;
    this.recordRecent(body);
    this.options.updateCompareUi();
    this.options.requestRender(false);
    this.options.pushViewState();
  }

  async selectByKey(key: string, selection: SelectBodyOptions = {}): Promise<void> {
    const body = this.options.bodyByKey().get(key)
      ?? [...this.options.catalogSearchState.latestBodies, ...this.options.compareSearchState.latestBodies]
        .find((candidate) => candidate.key === key)
      ?? null;
    if (body) {
      if (!this.options.bodyByKey().has(body.key)) this.options.mergeBody(body);
      this.select(body.key, selection);
      return;
    }
    const hydrated = await this.options.hydrator.hydrateMany([key]);
    if (hydrated[0]) this.select(hydrated[0].key, selection);
  }

  select(key: string, selection: SelectBodyOptions = {}): void {
    const body = this.options.bodyByKey().get(key);
    if (!body) return;
    const previousKey = this.options.state.selectedKey;
    const changed = previousKey !== body.key;
    const transient = selection.transient === true || body.key === this.options.transientKey();
    if (changed && previousKey) this.options.cleanupTransient(previousKey);
    this.options.state.selectedKey = body.key;
    this.options.setTransientKey(transient ? body.key : null);
    if (!transient) this.options.cancelMapSelection();
    if (changed && !transient) {
      trackAnalytics("object", { object_type: classifyBody(body).type, source: body.catalog_group ?? "ephemeris" });
    }
    if (changed) this.clearComparison();
    this.ensureCompareTarget();
    this.options.state.activeTab = "object";
    if (!transient) this.recordRecent(body);
    this.options.bodySearch.value = body.name;
    this.options.catalogSearchState.activeOptionKey = null;
    this.options.updateAllUi();
    if (selection.center) this.options.centerOnBody(body, selection.zoom === "local", selection.animate ?? false);
    this.options.requestRender(Boolean(selection.center && !selection.animate));
    if (changed && !transient) this.options.pushViewState();
    if (!transient && body.catalog?.preview && this.options.hydrationStates.get(body.key)?.status !== "loading") {
      void this.options.hydrator.hydrateSelected(body.key);
    }
  }

  clear(clearOptions: { openSearch?: boolean; preserveMapDetailRequest?: boolean } = {}): void {
    if (!clearOptions.preserveMapDetailRequest) this.options.cancelMapSelection();
    this.options.cleanupTransient(this.options.state.selectedKey);
    this.options.state.selectedKey = "";
    this.options.setTransientKey(null);
    this.clearComparison();
    if (clearOptions.openSearch) {
      this.options.state.activeGuidedSetId = null;
      this.options.bodySearch.value = "";
      this.options.state.activeTab = "catalog";
    } else if (this.options.state.activeTab === "object") {
      this.options.state.activeTab = null;
    }
    this.options.updateAllUi();
    this.options.requestRender(true);
    this.options.pushViewState();
  }

  ensureCompareTarget(): void {
    const { state } = this.options;
    if (!state.selectedKey) {
      state.compareTargetKey = null;
      return;
    }
    if (state.compareTargetKey && state.compareTargetKey !== state.selectedKey && this.options.bodyByKey().has(state.compareTargetKey)) return;
    state.compareTargetKey = null;
  }

  private clearComparison(): void {
    this.options.state.compareTargetKey = null;
    this.options.compareSearch.value = "";
    this.options.compareSearchState.latestBodies = [];
    this.options.compareSearchState.activeOptionKey = null;
  }

  private recordRecent(body: Body): void {
    this.options.state.recentDestinations = recordRecentDestination(body.key, {
      distanceFromEarthKm: body.distance_from_earth_km,
    });
  }
}
