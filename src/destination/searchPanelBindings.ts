import type { BodyFilter } from "../viewState";
import type { DestinationSearchConfig } from "./destinationSearchView";

type SearchPanelBindingsOptions = {
  filterButtons: HTMLElement;
  picker: HTMLElement;
  searchField: HTMLInputElement;
  guidedTourList: HTMLElement;
  applyFilter: (filter: BodyFilter) => void;
  pickerConfig: () => DestinationSearchConfig | null;
  /** Starts a guided tour in the page, with no page load. */
  startTour: (slug: string) => void;
};

/** Controls of the Search panel that are not a result row: the `More types` menu, the empty result, and the tours. */
export function bindSearchPanel(options: SearchPanelBindingsOptions): void {
  options.filterButtons.addEventListener("change", (event) => {
    const menu = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-body-filter-menu]");
    if (menu?.value) options.applyFilter(menu.value as BodyFilter);
  });

  options.picker.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-search-clear-filters]")) {
      options.pickerConfig()?.clearFilters?.();
      return;
    }
    const example = target.closest<HTMLElement>("[data-search-example]");
    if (!example) return;
    options.searchField.value = example.dataset.searchExample ?? "";
    options.searchField.dispatchEvent(new Event("input", { bubbles: true }));
    options.searchField.focus();
  });

  options.guidedTourList.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-tour-slug]");
    // A click with a modifier key opens the tour in a new tab, as for each link.
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    options.startTour(link.dataset.tourSlug ?? "");
  });
}
