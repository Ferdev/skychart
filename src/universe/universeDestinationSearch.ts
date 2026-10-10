import type { Body } from "../atlas/contracts";
import { isOptionListKey, nextOptionIndex } from "../destination/optionListKeyboard";
import { objectTypeLabel } from "../format/objectTypeLabel";
import { localObjectName } from "../i18n/objectNames";

type DestinationSearchOptions = {
  findButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeButton: HTMLButtonElement;
  input: HTMLInputElement;
  results: HTMLElement;
  active: () => boolean;
  translate: (key: string) => string;
  search: (query: string, signal: AbortSignal) => Promise<Body[]>;
  /** Suggested and recent destinations, shown while the field is empty. */
  suggestions: () => { suggested: Body[]; recent: Body[] };
  eligible: (body: Body) => boolean;
  choose: (body: Body) => void;
};

/** Search the shared atlas catalog for destinations with usable 3D depth. */
export class UniverseDestinationSearch {
  private abort: AbortController | null = null;
  private timer: number | null = null;
  private bodies = new Map<string, Body>();
  private activeKey: string | null = null;

  constructor(private readonly options: DestinationSearchOptions) {
    options.findButton.addEventListener("click", () => this.open());
    options.closeButton.addEventListener("click", () => options.dialog.close());
    options.dialog.addEventListener("close", () => this.cancel());
    options.input.addEventListener("input", () => this.schedule());
    options.input.addEventListener("keydown", (event) => this.keyDown(event));
    options.results.addEventListener("click", (event) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>("[data-destination-key]");
      if (option) this.chooseKey(option.dataset.destinationKey ?? "");
    });
    options.input.setAttribute("role", "combobox");
    options.input.setAttribute("aria-autocomplete", "list");
    options.input.setAttribute("aria-controls", options.results.id);
    options.input.setAttribute("aria-expanded", "false");
  }

  close(): void {
    if (this.options.dialog.open) this.options.dialog.close();
    this.cancel();
  }

  private open(): void {
    if (!this.options.active()) return;
    this.options.input.value = "";
    this.renderSuggestions();
    this.options.dialog.showModal();
    this.options.input.focus();
  }

  private cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
  }

  private schedule(): void {
    this.cancel();
    const query = this.options.input.value.trim();
    if (!query) {
      this.renderSuggestions();
      return;
    }
    this.renderMessage(this.options.translate("universe3d.searching"));
    const abort = new AbortController();
    this.abort = abort;
    this.timer = window.setTimeout(() => { this.timer = null; void this.search(query, abort); }, 180);
  }

  private async search(query: string, abort: AbortController): Promise<void> {
    let bodies: Body[];
    try { bodies = await this.options.search(query, abort.signal); }
    catch {
      if (!abort.signal.aborted) this.renderMessage(this.options.translate("universe3d.searchEmpty"));
      return;
    }
    if (abort.signal.aborted || !this.options.dialog.open) return;
    if (!bodies.length) this.renderMessage(this.options.translate("universe3d.searchEmpty"));
    else this.renderSections([{ title: null, bodies }]);
  }

  /** Arrow keys move the active option. Enter selects the active option, or the first result when no option is active. */
  private keyDown(event: KeyboardEvent): void {
    const choices = this.selectableOptions();
    if (isOptionListKey(event.key)) {
      // Home and End move the text cursor while no option is active.
      if ((event.key === "Home" || event.key === "End") && !this.activeKey) return;
      if (choices.length === 0) return;
      const index = nextOptionIndex(choices.length, choices.findIndex((option) => option.dataset.destinationKey === this.activeKey), event.key);
      this.setActive(choices[index]?.dataset.destinationKey ?? null);
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const key = this.activeKey ?? choices[0]?.dataset.destinationKey;
    if (key) this.chooseKey(key);
  }

  private chooseKey(key: string): void {
    const body = this.bodies.get(key);
    if (body && this.options.eligible(body)) this.options.choose(body);
  }

  private renderSuggestions(): void {
    const { suggested, recent } = this.options.suggestions();
    const recentKeys = new Set(recent.map((body) => body.key));
    const sections = [
      { title: this.options.translate("universe3d.searchRecent"), bodies: recent },
      { title: this.options.translate("universe3d.searchSuggestions"), bodies: suggested.filter((body) => !recentKeys.has(body.key)) },
    ].filter((section) => section.bodies.length > 0);
    if (sections.length === 0) this.renderMessage(this.options.translate("universe3d.searchHint"));
    else this.renderSections(sections);
  }

  private renderMessage(message: string): void {
    this.bodies.clear();
    this.activeKey = null;
    this.options.results.removeAttribute("role");
    this.options.results.textContent = message;
    this.syncActive();
  }

  private renderSections(sections: { title: string | null; bodies: Body[] }[]): void {
    this.bodies = new Map(sections.flatMap((section) => section.bodies).map((body) => [body.key, body]));
    this.activeKey = null;
    const results = this.options.results;
    results.setAttribute("role", "listbox");
    results.replaceChildren();
    for (const section of sections) {
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      if (section.title) {
        const title = document.createElement("p");
        title.className = "universe-view__search-section";
        title.textContent = section.title;
        title.id = `${results.id}-section-${results.childElementCount}`;
        group.setAttribute("aria-labelledby", title.id);
        group.append(title);
      }
      for (const body of section.bodies) group.append(this.renderOption(body));
      results.append(group);
    }
    this.syncActive();
  }

  private renderOption(body: Body): HTMLElement {
    const eligible = this.options.eligible(body);
    const option = document.createElement("button");
    option.type = "button";
    option.className = "universe-view__search-option";
    option.id = `${this.options.results.id}-option-${body.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.destinationKey = body.key;
    // The option cannot have the focus: the focus stays in the field, as in the main search.
    option.tabIndex = -1;
    const name = document.createElement("strong");
    // The row shows the name in the application language also, as the main search does.
    const localName = localObjectName(body.key, document.documentElement.lang, body.name);
    name.textContent = localName ? `${body.name} · ${localName}` : body.name;
    const type = document.createElement("span");
    type.textContent = objectTypeLabel(body.object_type);
    option.append(name, type);
    if (!eligible) {
      option.setAttribute("aria-disabled", "true");
      option.title = this.options.translate("universe3d.searchUnplaced");
    }
    return option;
  }

  private selectableOptions(): HTMLElement[] {
    return [...this.options.results.querySelectorAll<HTMLElement>("[data-destination-key]:not([aria-disabled=\"true\"])")];
  }

  private setActive(key: string | null): void {
    this.activeKey = key;
    this.syncActive();
  }

  private syncActive(): void {
    const input = this.options.input;
    let active: HTMLElement | null = null;
    for (const option of this.options.results.querySelectorAll<HTMLElement>("[data-destination-key]")) {
      const isActive = option.dataset.destinationKey === this.activeKey;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", String(isActive));
      if (isActive) active = option;
    }
    input.setAttribute("aria-expanded", String(this.bodies.size > 0));
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
}
