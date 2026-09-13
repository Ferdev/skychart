import { ConstellationRenderer, type ConstellationRendererOptions } from "../rendering/constellationRenderer";
import { MAP_CONSTELLATIONS, normalizeHiddenConstellations } from "./constellationStyles";
import { t } from "../i18n";

/** Owns the main-map figure selection and its matching color key. */
export class ConstellationOverlay {
  private hiddenIds = new Set<string>();
  private renderer: ConstellationRenderer;
  private rows: { name: string; label: HTMLLabelElement; input: HTMLInputElement }[] = [];
  private search = document.querySelector<HTMLInputElement>("#constellation-search")!;

  constructor(private readonly options: ConstellationRendererOptions & { stateChanged: () => void }) {
    this.renderer = new ConstellationRenderer({ ...options, hiddenConstellations: () => this.hiddenIds });
    const list = document.querySelector<HTMLElement>("#constellation-list")!;
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
      label.append(input, swatch, document.createTextNode(figure.name));
      list.append(label);
      this.rows.push({ name: figure.name, label, input });
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
    let matches = 0;
    for (const row of this.rows) {
      row.input.checked = !this.hiddenIds.has(row.input.dataset.constellation!);
      row.label.hidden = !normalize(row.name).includes(query);
      if (!row.label.hidden) matches += 1;
    }
    document.querySelector("#constellation-count")!.textContent = t("constellations.count", {
      selected: MAP_CONSTELLATIONS.length - this.hiddenIds.size, total: MAP_CONSTELLATIONS.length,
    });
    (document.querySelector("#constellation-empty") as HTMLElement).hidden = matches > 0;
  }
}
