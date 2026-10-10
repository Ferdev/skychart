import { ConstellationRenderer, type ConstellationRendererOptions } from "../rendering/constellationRenderer";
import { MAP_CONSTELLATIONS, normalizeHiddenConstellations } from "./constellationStyles";
import { locale, t } from "../i18n";
import { constellationName } from "../i18n/constellationNames";

/** Owns the main-map figure selection and its matching color key. */
export class ConstellationOverlay {
  private hiddenIds = new Set<string>();
  private renderer: ConstellationRenderer;
  private rows: { latinName: string; name: string; text: Text; label: HTMLLabelElement; input: HTMLInputElement }[] = [];
  private list = document.querySelector<HTMLElement>("#constellation-list")!;
  private namesLocale = "";
  private search = document.querySelector<HTMLInputElement>("#constellation-search")!;

  constructor(private readonly options: ConstellationRendererOptions & { stateChanged: () => void }) {
    this.renderer = new ConstellationRenderer({ ...options, hiddenConstellations: () => this.hiddenIds, figureName: (latinName) => constellationName(latinName, locale()) });
    const list = this.list;
    for (const figure of [...MAP_CONSTELLATIONS].sort((a, b) => a.name.localeCompare(b.name))) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.constellation = figure.id;
      input.checked = true;
      const swatch = document.createElement("span");
      swatch.className = "constellation-swatch";
      swatch.style.backgroundColor = figure.color;
      swatch.setAttribute("aria-hidden", "true");
      const text = document.createTextNode(figure.name);
      label.append(input, swatch, text);
      list.append(label);
      this.rows.push({ latinName: figure.name, name: figure.name, text, label, input });
      input.addEventListener("change", () => {
        if (input.checked) this.hiddenIds.delete(figure.id);
        else this.hiddenIds.add(figure.id);
        this.changed(input.checked);
      });
    }
    this.search.addEventListener("input", () => this.update());
    document.querySelector("#constellations-show-all")!.addEventListener("click", () => {
      this.hiddenIds.clear();
      this.changed(true);
    });
    document.querySelector("#constellations-hide-all")!.addEventListener("click", () => {
      this.hiddenIds = new Set(MAP_CONSTELLATIONS.map((figure) => figure.id));
      this.changed(false);
    });
    window.addEventListener("cosmic-atlas:locale-change", () => this.update());
    this.update();
  }

  get hidden(): string[] { return [...this.hiddenIds].sort(); }
  set hidden(values: string[]) {
    this.hiddenIds = new Set(normalizeHiddenConstellations(values));
    this.update();
  }

  draw(showLabels: boolean): void { this.renderer.draw(showLabels); }

  private changed(enableLayer: boolean): void {
    // Selecting a figure should immediately show it, even if the master was off.
    const master = document.querySelector<HTMLInputElement>('.toolbar-quick-layers input[data-layer="constellations"]')!;
    if (enableLayer && !master.checked) {
      master.checked = true;
      master.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.update();
    this.options.requestRender();
    this.options.stateChanged();
  }

  private update(): void {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const query = normalize(this.search.value.trim());
    this.updateNames();
    let matches = 0;
    for (const row of this.rows) {
      row.input.checked = !this.hiddenIds.has(row.input.dataset.constellation!);
      // A search finds the name in the application language and the IAU name.
      row.label.hidden = !normalize(row.name).includes(query) && !normalize(row.latinName).includes(query);
      if (!row.label.hidden) matches += 1;
    }
    document.querySelector("#constellation-count")!.textContent = t("constellations.count", {
      selected: MAP_CONSTELLATIONS.length - this.hiddenIds.size, total: MAP_CONSTELLATIONS.length,
    });
    (document.querySelector("#constellation-empty") as HTMLElement).hidden = matches > 0;
  }

  /** Shows the names of the application language, in the order of that language. */
  private updateNames(): void {
    const code = locale();
    if (code === this.namesLocale) return;
    this.namesLocale = code;
    for (const row of this.rows) {
      row.name = constellationName(row.latinName, code);
      row.text.data = row.name;
    }
    this.rows.sort((a, b) => a.name.localeCompare(b.name, code));
    this.list.append(...this.rows.map((row) => row.label));
  }
}
