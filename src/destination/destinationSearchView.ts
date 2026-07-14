import { trackAnalytics } from "../analytics";
import { formatCount } from "../atlasFormatting";
import type { Body, BodyFilterDefinition } from "../atlas/contracts";
import { CatalogSearchGateway, mergeCatalogSearchBodies } from "../catalog/catalogSearchGateway";
import {
  buildDestinationPickerItems,
  buildDestinationPickerSections,
  destinationPickerColorStyle,
  type DestinationPickerItem,
  type RecentDestination,
} from "../destinationPicker";
import { escapeHtml } from "../atlasFormatting";
import { t } from "../i18n";

export type DestinationSearchState = {
  requestId: number;
  latestBodies: Body[];
  activeOptionKey: string | null;
  signature?: string;
  total?: number;
  nextOffset?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  fallback?: boolean;
  abortController?: AbortController;
};

export type DestinationSearchConfig = {
  state: DestinationSearchState;
  input: HTMLInputElement;
  picker: HTMLElement;
  filter: BodyFilterDefinition;
  sourceBodies: Body[];
  activeKey: string | null;
  currentTargetKey: string | null;
  emptyMessage: string;
  loadingMessage: string;
  fallbackMessage: string;
  guidedSet?: { labelKey: string } | null;
  excludeKeys?: string[];
  queryForSearch?: (query: string) => string;
  afterRender?: () => void;
};

type DestinationSearchViewOptions = {
  gateway: CatalogSearchGateway;
  getRecentDestinations: () => readonly RecentDestination[];
  getAuKm: () => number;
  matchesFilter: (body: Body, filter: BodyFilterDefinition) => boolean;
};

type PickerKeyboardOptions = {
  state: DestinationSearchState;
  input: HTMLInputElement;
  picker: HTMLElement;
  onSelect: (key: string) => void;
  onFallbackEnter: () => void;
  onEscapeClear: () => void;
};

/** Owns the complete asynchronous search and keyboard lifecycle for a destination picker. */
export class DestinationSearchView {
  constructor(private readonly options: DestinationSearchViewOptions) {}

  reset(state: DestinationSearchState, options: { preserveActiveOption?: boolean } = {}) {
    state.abortController?.abort();
    state.abortController = undefined;
    state.latestBodies = [];
    state.signature = undefined;
    state.total = undefined;
    state.nextOffset = undefined;
    state.hasMore = false;
    state.loadingMore = false;
    state.fallback = false;
    if (!options.preserveActiveOption) state.activeOptionKey = null;
  }

  renderStatus(container: HTMLElement, message: string, tone: "loading" | "fallback" | "updating") {
    container.innerHTML = `<div class="picker-status picker-status--${tone}" role="status">${escapeHtml(message)}</div>`;
    container.scrollTop = 0;
  }

  async update(config: DestinationSearchConfig) {
    const requestId = ++config.state.requestId;
    config.state.abortController?.abort();
    config.state.abortController = undefined;
    const rawQuery = config.input.value.trim();
    const query = config.queryForSearch ? config.queryForSearch(rawQuery) : rawQuery;
    const guidedSet = config.guidedSet ?? null;
    const useCatalog = !guidedSet && (query.length >= 3 || (query.length === 0 && config.filter.key !== "all"));
    const signature = searchSignature(query, config.filter, config.excludeKeys);
    if (!useCatalog || config.state.signature !== signature) this.clearResultPage(config.state);
    config.state.signature = useCatalog ? signature : undefined;

    const abortController = useCatalog ? new AbortController() : undefined;
    config.state.abortController = abortController;
    if (useCatalog) {
      config.state.activeOptionKey = null;
      config.input.removeAttribute("aria-activedescendant");
      this.renderStatus(config.picker, config.loadingMessage, "loading");
    }

    const catalogResult = useCatalog
      ? await this.options.gateway.search({ query, filter: config.filter, limit: query ? 80 : 120, signal: abortController?.signal })
      : null;
    if (useCatalog && !abortController?.signal.aborted) trackAnalytics("search", { query_length: query.length, filter: config.filter.key });
    if (config.state.abortController === abortController) config.state.abortController = undefined;
    if (requestId !== config.state.requestId) return;

    const excludeKeys = new Set(config.excludeKeys ?? []);
    config.state.latestBodies = (catalogResult?.bodies ?? []).filter((body) => !excludeKeys.has(body.key));
    config.state.total = catalogResult?.total;
    config.state.nextOffset = catalogResult?.nextOffset;
    config.state.hasMore = Boolean(catalogResult?.hasMore && catalogResult.source === "phoenix");
    config.state.fallback = Boolean(catalogResult?.fallback);

    const sourceBodies = (catalogResult?.bodies ?? config.sourceBodies).filter((body) => {
      if (excludeKeys.has(body.key)) return false;
      return Boolean(guidedSet) || this.options.matchesFilter(body, config.filter);
    });
    const buildOptions = {
      query: catalogResult?.source === "phoenix" ? "" : query,
      selectedKey: config.activeKey,
      currentTargetKey: config.currentTargetKey,
      recentDestinations: this.options.getRecentDestinations(),
      excludeKeys: config.excludeKeys,
      includeTypes: guidedSet ? undefined : config.filter.types,
      auKm: this.options.getAuKm(),
      maxResults: query ? 80 : 240,
      maxFavorites: 8,
      maxFrequent: 8,
      maxRecent: 8,
      includeAllSection: true,
    };

    if (guidedSet || config.filter.key !== "all" || query) {
      const items = buildDestinationPickerItems(sourceBodies, buildOptions);
      const label = query ? t("search.resultsLabel") : guidedSet ? t(guidedSet.labelKey) : t(config.filter.labelKey);
      this.renderSections(config, [{ label, items }]);
    } else {
      const sections = buildDestinationPickerSections(sourceBodies, buildOptions).filter((section) => section.kind === "all");
      this.renderSections(config, sections);
    }
    if (catalogResult?.fallback) this.prependStatus(config.picker, config.fallbackMessage, "fallback");
    this.renderLoadMore(config);
    this.syncActiveOption(config.state, config.input, config.picker);
    config.afterRender?.();
  }

  async loadMore(config: DestinationSearchConfig) {
    if (config.state.loadingMore || !config.state.hasMore) return;
    const rawQuery = config.input.value.trim();
    const query = config.queryForSearch ? config.queryForSearch(rawQuery) : rawQuery;
    const signature = searchSignature(query, config.filter, config.excludeKeys);
    if (config.state.signature !== signature) {
      await this.update(config);
      return;
    }

    config.state.loadingMore = true;
    this.renderLoadMore(config);
    try {
      const result = await this.options.gateway.search({
        query,
        filter: config.filter,
        limit: query ? 80 : 120,
        offset: config.state.nextOffset ?? config.state.latestBodies.length,
      });
      if (config.state.signature !== signature) return;
      const excludeKeys = new Set(config.excludeKeys ?? []);
      config.state.latestBodies = mergeCatalogSearchBodies(config.state.latestBodies, result.bodies, Number.MAX_SAFE_INTEGER)
        .filter((body) => !excludeKeys.has(body.key));
      config.state.total = result.total ?? config.state.total;
      config.state.nextOffset = result.nextOffset;
      config.state.hasMore = Boolean(result.hasMore && result.source === "phoenix");
      config.state.fallback = Boolean(result.fallback);
    } finally {
      config.state.loadingMore = false;
      this.updateFromCachedResults(config);
    }
  }

  handleKeyboard(event: KeyboardEvent, options: PickerKeyboardOptions) {
    if (event.key === "ArrowDown") return this.moveActiveOption(options, "next");
    if (event.key === "ArrowUp") return this.moveActiveOption(options, "previous");
    if (event.key === "Enter") {
      const activeKey = options.state.activeOptionKey;
      if (activeKey) options.onSelect(activeKey);
      else options.onFallbackEnter();
      return true;
    }
    if (event.key !== "Escape") return false;
    if (options.state.activeOptionKey) {
      options.state.activeOptionKey = null;
      this.syncActiveOption(options.state, options.input, options.picker);
    } else if (options.input.value) {
      options.input.value = "";
      options.state.latestBodies = [];
      options.onEscapeClear();
    } else {
      return false;
    }
    return true;
  }

  private clearResultPage(state: DestinationSearchState) {
    state.latestBodies = [];
    state.total = undefined;
    state.nextOffset = undefined;
    state.hasMore = false;
    state.fallback = false;
  }

  private updateFromCachedResults(config: DestinationSearchConfig) {
    const query = (config.queryForSearch ? config.queryForSearch(config.input.value.trim()) : config.input.value.trim()).trim();
    const excludeKeys = new Set(config.excludeKeys ?? []);
    const sourceBodies = config.state.latestBodies.filter((body) => !excludeKeys.has(body.key));
    const items = buildDestinationPickerItems(sourceBodies, {
      query: "",
      selectedKey: config.activeKey,
      currentTargetKey: config.currentTargetKey,
      recentDestinations: this.options.getRecentDestinations(),
      excludeKeys: config.excludeKeys,
      includeTypes: config.filter.types,
      auKm: this.options.getAuKm(),
      maxResults: Number.MAX_SAFE_INTEGER,
    });
    this.renderSections(config, [{ label: query ? t("search.resultsLabel") : t(config.filter.labelKey), items }]);
    if (config.state.fallback) this.prependStatus(config.picker, config.fallbackMessage, "fallback");
    this.renderLoadMore(config);
    this.syncActiveOption(config.state, config.input, config.picker);
    config.afterRender?.();
  }

  private prependStatus(container: HTMLElement, message: string, tone: "loading" | "fallback") {
    container.insertAdjacentHTML("afterbegin", `<div class="picker-status picker-status--${tone}" role="status">${escapeHtml(message)}</div>`);
  }

  private renderSections(config: DestinationSearchConfig, sections: { label: string; items: DestinationPickerItem[] }[]) {
    const previousScrollTop = config.picker.scrollTop;
    config.picker.innerHTML = sections
      .filter((section) => section.items.length > 0)
      .map((section) => `
        <section class="destination-picker__section">
          <h3 class="destination-picker__section-title">${escapeHtml(section.label)}</h3>
          <div class="destination-picker__list" role="listbox" aria-label="${escapeHtml(section.label)}">${section.items
            .map((item) => renderPickerItem(item, config.activeKey, config.state.activeOptionKey, config.picker.id))
            .join("")}</div>
        </section>
      `)
      .join("");
    if (!config.picker.innerHTML) config.picker.innerHTML = `<div class="empty-state">${escapeHtml(config.emptyMessage)}</div>`;
    config.picker.scrollTop = config.state.activeOptionKey ? previousScrollTop : 0;
  }

  private renderLoadMore(config: DestinationSearchConfig) {
    config.picker.querySelector<HTMLElement>(".picker-load-more")?.remove();
    if (!config.state.hasMore && !config.state.loadingMore) return;
    const loaded = config.state.latestBodies.length;
    const total = config.state.total && config.state.total > loaded ? config.state.total : null;
    const detail = total
      ? t("search.loadedOfTotal", { loaded: formatCount(loaded), total: formatCount(total) })
      : t("search.loadedResults", { count: formatCount(loaded) });
    const label = config.state.loadingMore ? t("search.loadingMore") : t("search.loadMore");
    config.picker.insertAdjacentHTML("beforeend", `
      <div class="picker-load-more" role="status">
        <span>${escapeHtml(detail)}</span>
        <button type="button" data-picker-load-more ${config.state.loadingMore ? "disabled" : ""}>${escapeHtml(label)}</button>
      </div>
    `);
  }

  private moveActiveOption(options: PickerKeyboardOptions, destination: "next" | "previous") {
    const choices = visibleOptions(options.picker);
    if (choices.length === 0) return false;
    const currentIndex = choices.findIndex((button) => button.dataset.bodyKey === options.state.activeOptionKey);
    const nextIndex = destination === "next"
      ? currentIndex < 0 ? 0 : Math.min(currentIndex + 1, choices.length - 1)
      : currentIndex < 0 ? choices.length - 1 : Math.max(currentIndex - 1, 0);
    options.state.activeOptionKey = choices[nextIndex]?.dataset.bodyKey ?? null;
    this.syncActiveOption(options.state, options.input, options.picker);
    return true;
  }

  private syncActiveOption(state: DestinationSearchState, input: HTMLInputElement, picker: HTMLElement) {
    const choices = visibleOptions(picker);
    const active = choices.find((button) => button.dataset.bodyKey === state.activeOptionKey) ?? null;
    choices.forEach((button) => {
      const isActive = button === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
    if (active) {
      state.activeOptionKey = active.dataset.bodyKey ?? null;
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      state.activeOptionKey = null;
      input.removeAttribute("aria-activedescendant");
    }
  }
}

function searchSignature(query: string, filter: BodyFilterDefinition, excludeKeys: readonly string[] = []) {
  return [query, filter.key, filter.groups?.join(",") ?? "", filter.types?.join(",") ?? "", excludeKeys.join(",")].join("|");
}

function visibleOptions(picker: HTMLElement) {
  return Array.from(picker.querySelectorAll<HTMLButtonElement>(".destination-picker__item[data-body-key]"));
}

function renderPickerItem(item: DestinationPickerItem, selectedKey: string | null, activeOptionKey: string | null, pickerId: string) {
  const style = destinationPickerColorStyle(item);
  const isSelected = item.key === selectedKey;
  const isActive = item.key === activeOptionKey;
  const optionId = `${pickerId}-option-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return `
    <button
      id="${escapeHtml(optionId)}"
      type="button"
      role="option"
      class="destination-picker__item${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}"
      data-body-key="${escapeHtml(item.key)}"
      aria-label="${escapeHtml(item.ariaLabel)}"
      aria-selected="${isActive ? "true" : "false"}"
      style="--destination-color: ${escapeHtml(style["--destination-color"])}"
    >
      <span class="destination-picker__orb" aria-hidden="true"></span>
      <span class="destination-picker__copy">
        <strong class="destination-picker__name">${escapeHtml(item.name)}</strong>
        <span class="destination-picker__meta">${escapeHtml(item.metaLabel)}</span>
      </span>
      <span class="destination-picker__distance">${escapeHtml(item.distanceLabel)}</span>
    </button>
  `;
}
