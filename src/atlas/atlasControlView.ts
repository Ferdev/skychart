import { hasBodyPosition } from "../catalog/spacecraftCatalog";
import { escapeHtml, formatCount, formatInteger, shortBodyName } from "../atlasFormatting";
import type { ActiveAtlasTab, Body, BodyFilterDefinition, CatalogSummary, SizeMode, ZoomPreset } from "./contracts";
import { BODY_FILTERS, EXPLORE_DOMAINS, FEATURED_KEYS, GUIDED_SETS, MAP_OBJECT_TYPE_FILTER_KEYS } from "./atlasDefinitions";
import { classifyBody } from "../destinationPicker";
import { t } from "../i18n";
import type { BodyFilter, DisplayLayer } from "../viewState";
import { atlasDom } from "./atlasDom";

const WORKSPACE_LABEL_KEYS = { catalog: "workspace.searchCatalog", object: "workspace.selectedObject" } as const;

/** Renders the atlas controls, workspace chrome, domain cards, and selected summary. */
export class AtlasControlView {
  updateSelectedSummary(body: Body | null, formatDistance: (kilometers: number) => string, canViewSky: (body: Body) => boolean) {
    if (!body) {
      atlasDom.selectedObjectPanel.hidden = true;
      atlasDom.selectedSummaryName.textContent = "";
      atlasDom.selectedSummaryMeta.textContent = "";
      atlasDom.selectedSummaryOrb.style.setProperty("--body-color", "#d8a23f");
      atlasDom.centerSelected.disabled = true;
      atlasDom.zoomSelected.disabled = true;
      atlasDom.viewSkySelected.disabled = true;
      this.setComparisonMode(false);
      delete atlasDom.selectedObjectPanel.dataset.selectedKey;
      return;
    }
    if (atlasDom.selectedObjectPanel.dataset.selectedKey !== body.key) this.setComparisonMode(false);
    atlasDom.selectedObjectPanel.dataset.selectedKey = body.key;
    atlasDom.selectedObjectPanel.hidden = false;
    atlasDom.selectedSummaryName.textContent = body.name;
    // The subtitle is one line. Its full text is in the title, for a narrow panel.
    const meta = Number.isFinite(body.distance_from_earth_km)
      ? `${classifyBody(body).label} · ${formatDistance(body.distance_from_earth_km)} ${t("object.fromEarth")}`
      : classifyBody(body).label;
    atlasDom.selectedSummaryMeta.textContent = meta;
    atlasDom.selectedSummaryMeta.title = meta;
    atlasDom.selectedSummaryOrb.style.setProperty("--body-color", body.color || "#d8a23f");
    atlasDom.centerSelected.disabled = !hasBodyPosition(body);
    atlasDom.zoomSelected.disabled = !hasBodyPosition(body);
    atlasDom.viewSkySelected.disabled = !canViewSky(body);
    if (atlasDom.viewSkySelected.disabled) atlasDom.viewSkySelected.title = t("sky.positionUnavailable");
    else atlasDom.viewSkySelected.removeAttribute("title");
    this.updateComparisonToggle();
  }

  /** Shows the comparison tool in place of the object details, or the details again. */
  setComparisonMode(open: boolean) {
    atlasDom.bodyInfo.hidden = open;
    atlasDom.selectionCompare.hidden = !open;
    atlasDom.selectedObjectPanel.classList.toggle("is-comparing", open);
    atlasDom.compareSelected.setAttribute("aria-expanded", String(open));
    this.updateComparisonToggle();
  }

  /** The footer button tells the user where it goes: to the comparison, or back to the details. */
  updateComparisonToggle() {
    atlasDom.compareSelectedLabel.textContent = t(atlasDom.selectionCompare.hidden ? "compare.eyebrow" : "compare.backToDetails");
  }

  updateQuickFocus(bodyByKey: ReadonlyMap<string, Body>) {
    atlasDom.quickFocusButtons.innerHTML = FEATURED_KEYS.map((key) => bodyByKey.get(key)).filter((body): body is Body => Boolean(body))
      .map((body) => `<button type="button" data-focus-key="${escapeHtml(body.key)}" style="--body-color: ${escapeHtml(body.color)}"><span class="body-orb"></span>${escapeHtml(shortBodyName(body.name))}</button>`).join("");
  }

  updateTabs(activeTab: ActiveAtlasTab, hasSelectedBody: boolean) {
    const tab = !hasSelectedBody && activeTab === "object" ? null : activeTab;
    const objectWorkspace = tab === "object" && hasSelectedBody;
    atlasDom.workspacePanel.hidden = tab === null;
    atlasDom.mapHud.classList.toggle("workspace-open", tab !== null);
    if (tab) atlasDom.mapHud.dataset.workspaceTab = tab; else delete atlasDom.mapHud.dataset.workspaceTab;
    atlasDom.workspaceSearchLink.hidden = tab !== "object" || !hasSelectedBody;
    atlasDom.workspaceLabel.hidden = tab === "object" && hasSelectedBody;
    atlasDom.workspaceLabel.textContent = tab ? t(WORKSPACE_LABEL_KEYS[tab]) : t("workspace.title");
    atlasDom.closePanel.textContent = objectWorkspace ? "×" : t("workspace.close");
    atlasDom.closePanel.classList.toggle("workspace-close-icon", objectWorkspace);
    atlasDom.closePanel.setAttribute("aria-label", objectWorkspace ? t("workspace.deselectCurrent") : t("workspace.close"));
    if (objectWorkspace) atlasDom.closePanel.setAttribute("title", t("workspace.deselectCurrent")); else atlasDom.closePanel.removeAttribute("title");
    for (const button of atlasDom.tabButtons) {
      button.classList.toggle("active", button.dataset.tab === tab);
      // The header search field opens a panel, so it has an expanded state. A tab button has a pressed state.
      button.setAttribute(button instanceof HTMLInputElement ? "aria-expanded" : "aria-pressed", String(button.dataset.tab === tab));
    }
    for (const panel of atlasDom.tabPanels) panel.hidden = tab === null || panel.dataset.tabPanel !== tab;
    return tab;
  }

  /** The Search panel shows its discovery blocks while the user browses, and the result list in other cases. */
  showSearchDiscovery(browsing: boolean) {
    atlasDom.searchDiscovery.hidden = !browsing;
    atlasDom.searchResults.hidden = browsing;
  }

  updateFilters(active: BodyFilter, mapCount: (filter: BodyFilterDefinition) => number) {
    atlasDom.bodyFilterButtons.innerHTML = searchFilterChips(active);
    atlasDom.mapFilterButtons.innerHTML = MAP_OBJECT_TYPE_FILTER_KEYS.map((key) => BODY_FILTERS.find((filter) => filter.key === key))
      .filter((filter): filter is BodyFilterDefinition => Boolean(filter))
      .map((filter) => {
        const count = filter.key === "all" ? null : mapCount(filter);
        const label = filter.key === "all" ? t("filters.allTypes") : t(filter.labelKey);
        const countLabel = count === null ? "" : formatInteger(count);
        const accessible = count === null ? label : `${label}, ${t("filters.availableObjects", { count: countLabel })}`;
        return `<button type="button" data-body-filter="${filter.key}"${count === null ? "" : ` data-available-count="${count}"`} class="${filter.key === active ? "active" : ""}" aria-pressed="${filter.key === active}" aria-label="${escapeHtml(accessible)}"><span class="map-filter-label">${escapeHtml(label)}</span>${count === null ? "" : `<span class="map-filter-count" aria-hidden="true">${escapeHtml(countLabel)}</span>`}</button>`;
      }).join("");
  }

  updateCompareFilters(active: BodyFilter) {
    atlasDom.compareFilterButtons.innerHTML = searchFilterChips(active);
  }

  updateExploreDomains(bodies: Body[], summary: CatalogSummary | null, activeGuidedSetId: string | null, activeFilter: BodyFilter) {
    atlasDom.exploreDomains.innerHTML = EXPLORE_DOMAINS.map((domain) => {
      const count = domain.count(summary, bodies);
      const active = activeGuidedSetId === domain.guidedSetId && activeFilter === domain.filterKey;
      return `<button type="button" class="explore-domain-card${active ? " active" : ""}" data-explore-domain="${escapeHtml(domain.id)}" aria-pressed="${active}"><span class="explore-domain-card__copy"><strong>${escapeHtml(t(domain.titleKey))}</strong><small>${escapeHtml(t(domain.descriptionKey))}</small></span>${count === null ? "" : `<span class="explore-domain-card__count">${escapeHtml(t("explore.count", { count: formatCount(count) }))}</span>`}</button>`;
    }).join("");
  }

  updateGuidedSets(bodyByKey: ReadonlyMap<string, Body>, activeId: string | null) {
    atlasDom.guidedTours.innerHTML = GUIDED_SETS.map((tour) => {
      const available = tour.keys.map((key) => bodyByKey.get(key)).filter(Boolean);
      return available.length === 0 ? "" : `<button type="button" data-tour-id="${escapeHtml(tour.id)}" class="${tour.id === activeId ? "active" : ""}" aria-pressed="${tour.id === activeId}"><strong>${escapeHtml(t(tour.labelKey))}</strong><span>${escapeHtml(t("search.objectsCount", { count: available.length }))}</span></button>`;
    }).join("");
  }

  updateSizeModes(sizeMode: SizeMode) {
    for (const button of atlasDom.sizeModeButtons.querySelectorAll<HTMLButtonElement>("[data-size-mode]")) {
      button.classList.toggle("active", button.dataset.sizeMode === sizeMode);
      button.setAttribute("aria-pressed", String(button.dataset.sizeMode === sizeMode));
    }
  }

  updateDisplayToggles(displayLayers: Record<DisplayLayer, boolean>, perfEnabled: boolean) {
    for (const input of atlasDom.mapHud.querySelectorAll<HTMLInputElement>("input[data-layer]")) input.checked = displayLayers[input.dataset.layer as DisplayLayer] ?? false;
    atlasDom.diagnosticsToggle.checked = perfEnabled;
  }

  updateScale(options: { viewWidthAu: number; viewWidthLy: number; pxPerAu: number; auKm: number; zoomLevel: number; sliderSteps: number; formatDistance: (kilometers: number) => string; displayLayers: Record<DisplayLayer, boolean> }) {
    const pixelScale = options.formatDistance(options.auKm / options.pxPerAu);
    const viewScale = options.formatDistance(options.viewWidthAu * options.auKm);
    atlasDom.zoomScaleSlider.value = String(options.zoomLevel);
    atlasDom.zoomScaleSlider.title = t("scale.pixelEquals", { value: pixelScale });
    atlasDom.zoomScaleSlider.setAttribute("aria-valuetext", t("scale.perPixel", { value: pixelScale }));
    atlasDom.zoomScaleLabel.textContent = `${options.zoomLevel} / ${options.sliderSteps}`;
    atlasDom.zoomPixelScale.textContent = t("scale.pixelEquals", { value: pixelScale });
    setZoomViewText(atlasDom.zoomViewScale, t("scale.viewEquals", { value: "\u0001" }), viewScale);
    const parts = [options.viewWidthLy < 250_000 ? t("contextMode.gaia") : t("contextMode.gaiaQuiet"), options.displayLayers.milkyWay ? t("contextMode.milkyWay") : t("contextMode.milkyWayOff"), options.viewWidthLy >= 1_000_000 ? t("contextMode.extragalactic") : t("contextMode.extragalacticQuiet")];
    atlasDom.contextModeStatus.textContent = parts.join(" · ");
  }

  updateZoomPresets(activePreset: ZoomPreset | null) {
    for (const button of atlasDom.zoomPresets.querySelectorAll<HTMLButtonElement>("[data-zoom-preset]")) {
      button.classList.toggle("active", button.dataset.zoomPreset === activePreset);
      button.setAttribute("aria-pressed", String(button.dataset.zoomPreset === activePreset));
    }
  }
}

/** The type filters that the Search panel shows as chips. The others are in the `More types` menu. */
const MAIN_SEARCH_FILTER_KEYS: readonly BodyFilter[] = ["all", "planet", "moon", "star", "exoplanet_system", "galaxy", "nebula", "star_cluster", "small_body"];

/**
 * One row of chips for the main types, and a menu for the other types.
 * A filter from the menu (or from an Explore card) shows as an active chip in the row.
 */
function searchFilterChips(active: BodyFilter) {
  const chip = (filter: BodyFilterDefinition) => `<button type="button" data-body-filter="${filter.key}" class="${filter.key === active ? "active" : ""}" aria-pressed="${filter.key === active}">${escapeHtml(t(filter.labelKey))}</button>`;
  const main = BODY_FILTERS.filter((filter) => MAIN_SEARCH_FILTER_KEYS.includes(filter.key) || filter.key === active);
  const more = BODY_FILTERS.filter((filter) => !MAIN_SEARCH_FILTER_KEYS.includes(filter.key));
  const options = more.map((filter) => `<option value="${filter.key}"${filter.key === active ? " selected" : ""}>${escapeHtml(t(filter.labelKey))}</option>`).join("");
  return `${main.map(chip).join("")}<select class="body-picker-filters__more" data-body-filter-menu aria-label="${escapeHtml(t("search.moreTypes"))}"><option value="">${escapeHtml(t("search.moreTypes"))}</option>${options}</select>`;
}

/**
 * Shows "View = 44 AU" as three parts, so that a narrow toolbar can show the value only.
 * The text of the element stays the full sentence.
 */
function setZoomViewText(target: HTMLElement, pattern: string, value: string): void {
  const text = pattern.replace("\u0001", value);
  if (target.dataset.text === text) return;
  target.dataset.text = text;
  const [before = "", after = ""] = pattern.split("\u0001");
  const part = (className: string, content: string) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = content;
    return span;
  };
  target.replaceChildren(part("zoom-view-words", before), part("zoom-view-value", value), part("zoom-view-words", after));
}
