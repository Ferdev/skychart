import {
  buildDestinationPickerItems,
  buildDestinationPickerSections,
  classifyBody,
  findDestinationBody,
  type RecentDestination,
} from "../destinationPicker";
import {
  BODY_FILTERS,
  GUIDED_SETS,
  SOLAR_SYSTEM_COUNT_FILTERS,
  SOLAR_SYSTEM_COUNT_GROUPS,
} from "../atlas/atlasDefinitions";
import type { Body, BodyFilterDefinition, CatalogSummary } from "../atlas/contracts";
import type { BodyFilter } from "../viewState";
import type { DestinationSearchState } from "./destinationSearchView";

interface DestinationCatalogModelOptions {
  bodies: () => readonly Body[];
  bodyByKey: () => Map<string, Body>;
  selectedKey: () => string;
  compareTargetKey: () => string | null;
  activeFilter: () => BodyFilter;
  activeCompareFilter: () => BodyFilter;
  activeGuidedSetId: () => string | null;
  recentDestinations: () => RecentDestination[];
  auKm: () => number;
  catalogSummary: () => CatalogSummary | null;
  catalogSearchState: () => DestinationSearchState;
  compareSearchState: () => DestinationSearchState;
}

export class DestinationCatalogModel {
  constructor(private readonly options: DestinationCatalogModelOptions) {}

  activeFilter(): BodyFilterDefinition {
    return BODY_FILTERS.find((item) => item.key === this.options.activeFilter()) ?? BODY_FILTERS[0];
  }

  filterFor(key: BodyFilter): BodyFilterDefinition | null {
    return BODY_FILTERS.find((item) => item.key === key) ?? null;
  }

  activeCompareFilter(): BodyFilterDefinition {
    return BODY_FILTERS.find((item) => item.key === this.options.activeCompareFilter()) ?? BODY_FILTERS[0];
  }

  matches(body: Body, filter: BodyFilterDefinition): boolean {
    if (filter.key === "all") return true;
    const matchesGroup = !filter.groups || filter.groups.includes(body.catalog_group ?? "");
    const matchesType = !filter.types || filter.types.includes(classifyBody(body).type);
    return matchesGroup && matchesType;
  }

  activeGuidedSet() {
    return GUIDED_SETS.find((tour) => tour.id === this.options.activeGuidedSetId()) ?? null;
  }

  exploreBodies(): Body[] {
    const tour = this.activeGuidedSet();
    if (!tour) return [...this.options.bodies()];
    return tour.keys.map((key) => this.options.bodyByKey().get(key)).filter((body): body is Body => Boolean(body));
  }

  localSearch(search: { query: string; filter?: BodyFilterDefinition; limit: number }): Body[] {
    const bodies = this.options.bodies().filter((body) => !search.filter || this.matches(body, search.filter));
    return buildDestinationPickerItems(bodies, {
      query: search.query,
      selectedKey: this.options.selectedKey(),
      currentTargetKey: this.options.selectedKey(),
      recentDestinations: this.options.recentDestinations(),
      auKm: this.options.auKm(),
      maxResults: search.limit,
    })
      .map((item) => this.options.bodyByKey().get(item.key))
      .filter((body): body is Body => Boolean(body));
  }

  primaryFocusCandidate(query: string): Body | null {
    const searchState = this.options.catalogSearchState();
    const source = searchState.latestBodies.length > 0
      ? searchState.latestBodies
      : this.exploreBodies();
    return (query ? findDestinationBody(source, query) : null) ?? this.firstPrimaryPickerBody(query);
  }

  compareFocusCandidate(query: string): Body | null {
    const selectedKey = this.options.selectedKey();
    const filter = this.activeCompareFilter();
    const compareState = this.options.compareSearchState();
    const searchBodies = compareState.latestBodies.length > 0
      ? compareState.latestBodies
      : this.options.bodies();
    const source = searchBodies.filter((body) => body.key !== selectedKey && this.matches(body, filter));
    return findDestinationBody(source, query) ?? this.firstComparePickerBody(query);
  }

  objectTypeCount(filter: BodyFilterDefinition): number {
    const summary = this.options.catalogSummary();
    const indexedCount = (filter.types ?? []).reduce(
      (total, type) => total + (summary?.type_counts?.[type] ?? 0),
      0,
    );
    if (!SOLAR_SYSTEM_COUNT_FILTERS.has(filter.key)) {
      return indexedCount > 0 ? indexedCount : this.options.bodies().filter((body) => this.matches(body, filter)).length;
    }
    const ephemerisOnlyCount = this.options.bodies().filter(
      (body) => this.matches(body, filter) && SOLAR_SYSTEM_COUNT_GROUPS.has(body.catalog_group ?? ""),
    ).length;
    return indexedCount + ephemerisOnlyCount;
  }

  private firstPrimaryPickerBody(query: string): Body | null {
    const searchState = this.options.catalogSearchState();
    if (searchState.latestBodies[0]) return searchState.latestBodies[0];
    const filter = this.activeFilter();
    const includeTypes = this.activeGuidedSet() ? undefined : filter.types;
    const source = this.activeGuidedSet()
      ? this.exploreBodies()
      : this.exploreBodies().filter((body) => this.matches(body, filter));
    const sections = buildDestinationPickerSections(source, {
      query,
      selectedKey: this.options.selectedKey(),
      currentTargetKey: this.options.selectedKey(),
      recentDestinations: this.options.recentDestinations(),
      includeTypes,
      maxResults: 1,
      auKm: this.options.auKm(),
    });
    const key = sections[0]?.items[0]?.key;
    return key ? this.options.bodyByKey().get(key) ?? null : null;
  }

  private firstComparePickerBody(query: string): Body | null {
    const selectedKey = this.options.selectedKey();
    const searchMatch = this.options.compareSearchState().latestBodies.find((body) => body.key !== selectedKey);
    if (searchMatch) return searchMatch;
    const selected = this.options.bodyByKey().get(selectedKey) ?? null;
    const filter = this.activeCompareFilter();
    const source = this.options.bodies().filter((body) => body.key !== selectedKey && this.matches(body, filter));
    const sections = buildDestinationPickerSections(source, {
      query,
      selectedKey: this.options.compareTargetKey(),
      currentTargetKey: selected?.key ?? null,
      recentDestinations: this.options.recentDestinations(),
      excludeKeys: selected ? [selected.key] : [],
      includeTypes: filter.types,
      maxResults: 1,
      auKm: this.options.auKm(),
    });
    const key = sections[0]?.items[0]?.key;
    return key ? this.options.bodyByKey().get(key) ?? null : null;
  }
}
