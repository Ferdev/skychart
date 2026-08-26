import { escapeHtml, formatCount, shortBodyName } from "../atlasFormatting";
import type { ActiveAtlasTab, Body, BodyFilterDefinition, CatalogSummary, SizeMode, ZoomPreset } from "./contracts";
import { BODY_FILTERS, EXPLORE_DOMAINS, FEATURED_KEYS, GUIDED_SETS, MAP_OBJECT_TYPE_FILTER_KEYS } from "./atlasDefinitions";
import { classifyBody } from "../destinationPicker";
import { locale, t } from "../i18n";
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
    atlasDom.selectedSummaryMeta.textContent = `${classifyBody(body).label} · ${formatDistance(body.distance_from_earth_km)} ${t("object.fromEarth")}`;
    atlasDom.selectedSummaryOrb.style.setProperty("--body-color", body.color || "#d8a23f");
    atlasDom.centerSelected.disabled = false;
    atlasDom.zoomSelected.disabled = false;
    atlasDom.viewSkySelected.disabled = !canViewSky(body);
    if (atlasDom.viewSkySelected.disabled) atlasDom.viewSkySelected.title = t("sky.positionUnavailable");
    else atlasDom.viewSkySelected.removeAttribute("title");
  }

  private setComparisonMode(open: boolean) {
    atlasDom.bodyInfo.hidden = open;
    atlasDom.selectionCompare.hidden = !open;
    atlasDom.selectedObjectPanel.classList.toggle("is-comparing", open);
    atlasDom.compareSelected.setAttribute("aria-expanded", String(open));
  }

  updateQuickFocus(bodyByKey: ReadonlyMap<string, Body>) {
    atlasDom.quickFocusButtons.innerHTML = FEATURED_KEYS.map((key) => bodyByKey.get(key)).filter((body): body is Body => Boolean(body))
      .map((body) => `<button type="button" data-focus-key="${escapeHtml(body.key)}" style="--body-color: ${escapeHtml(body.color)}"><span class="body-orb"></span>${escapeHtml(shortBodyName(body.name))}</button>`).join("");
  }

  updateTabs(activeTab: ActiveAtlasTab, hasSelectedBody: boolean) {
    const tab = !hasSelectedBody && activeTab === "object" ? null : activeTab;
    const objectWorkspace = tab === "object" && hasSelectedBody;
    atlasDom.modeRail.hidden = hasSelectedBody;
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
      button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
    }
    for (const panel of atlasDom.tabPanels) panel.hidden = tab === null || panel.dataset.tabPanel !== tab;
    return tab;
  }

  updateFilters(active: BodyFilter, mapCount: (filter: BodyFilterDefinition) => number) {
    atlasDom.bodyFilterButtons.innerHTML = filterButtons(active);
    atlasDom.mapFilterButtons.innerHTML = MAP_OBJECT_TYPE_FILTER_KEYS.map((key) => BODY_FILTERS.find((filter) => filter.key === key))
      .filter((filter): filter is BodyFilterDefinition => Boolean(filter))
      .map((filter) => {
        const count = filter.key === "all" ? null : mapCount(filter);
        const label = filter.key === "all" ? t("filters.allTypes") : t(filter.labelKey);
        const countLabel = count === null ? "" : Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(count);
        const accessible = count === null ? label : `${label}, ${t("filters.availableObjects", { count: countLabel })}`;
        return `<button type="button" data-body-filter="${filter.key}"${count === null ? "" : ` data-available-count="${count}"`} class="${filter.key === active ? "active" : ""}" aria-pressed="${filter.key === active}" aria-label="${escapeHtml(accessible)}"><span class="map-filter-label">${escapeHtml(label)}</span>${count === null ? "" : `<span class="map-filter-count" aria-hidden="true">${escapeHtml(countLabel)}</span>`}</button>`;
      }).join("");
  }

  updateCompareFilters(active: BodyFilter) {
    atlasDom.compareFilterButtons.innerHTML = filterButtons(active);
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
      return available.length === 0 ? "" : `<button type="button" data-tour-id="${escapeHtml(tour.id)}" class="${tour.id === activeId ? "active" : ""}"><strong>${escapeHtml(t(tour.labelKey))}</strong><span>${escapeHtml(t("search.objectsCount", { count: available.length }))}</span></button>`;
    }).join("");
  }

  updateSizeModes(sizeMode: SizeMode) {
    for (const button of atlasDom.sizeModeButtons.querySelectorAll<HTMLButtonElement>("[data-size-mode]")) button.classList.toggle("active", button.dataset.sizeMode === sizeMode);
  }

  updateDisplayToggles(displayLayers: Record<DisplayLayer, boolean>, perfEnabled: boolean) {
    for (const input of atlasDom.displayToggles.querySelectorAll<HTMLInputElement>("input[data-layer]")) input.checked = displayLayers[input.dataset.layer as DisplayLayer] ?? false;
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
    atlasDom.zoomViewScale.textContent = t("scale.viewEquals", { value: viewScale });
    const parts = [options.viewWidthLy < 250_000 ? t("contextMode.gaia") : t("contextMode.gaiaQuiet"), options.displayLayers.milkyWay ? t("contextMode.milkyWay") : t("contextMode.milkyWayOff"), options.viewWidthLy >= 1_000_000 ? t("contextMode.extragalactic") : t("contextMode.extragalacticQuiet")];
    atlasDom.contextModeStatus.textContent = parts.join(" · ");
  }

  updateZoomPresets(activePreset: ZoomPreset | null) {
    for (const button of atlasDom.zoomPresets.querySelectorAll<HTMLButtonElement>("[data-zoom-preset]")) button.classList.toggle("active", button.dataset.zoomPreset === activePreset);
  }
}

function filterButtons(active: BodyFilter) {
  return BODY_FILTERS.map((filter) => `<button type="button" data-body-filter="${filter.key}" class="${filter.key === active ? "active" : ""}" aria-pressed="${filter.key === active}">${escapeHtml(t(filter.labelKey))}</button>`).join("");
}
