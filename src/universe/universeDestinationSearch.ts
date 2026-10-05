import type { Body } from "../atlas/contracts";

type DestinationSearchOptions = {
  findButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeButton: HTMLButtonElement;
  input: HTMLInputElement;
  results: HTMLElement;
  active: () => boolean;
  translate: (key: string) => string;
  search: (query: string, signal: AbortSignal) => Promise<Body[]>;
  eligible: (body: Body) => boolean;
  choose: (body: Body) => void;
};

/** Search the shared atlas catalog for destinations with usable 3D depth. */
export class UniverseDestinationSearch {
  private abort: AbortController | null = null;
  private timer: number | null = null;

  constructor(private readonly options: DestinationSearchOptions) {
    options.findButton.addEventListener("click", () => this.open());
    options.closeButton.addEventListener("click", () => options.dialog.close());
    options.dialog.addEventListener("close", () => this.cancel());
    options.input.addEventListener("input", () => this.schedule());
  }

  close(): void {
    if (this.options.dialog.open) this.options.dialog.close();
    this.cancel();
  }

  private open(): void {
    if (!this.options.active()) return;
    this.options.input.value = "";
    this.options.results.textContent = this.options.translate("universe3d.searchHint");
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
    this.options.results.textContent = this.options.translate(query ? "universe3d.searching" : "universe3d.searchHint");
    if (!query) return;
    const abort = new AbortController();
    this.abort = abort;
    this.timer = window.setTimeout(() => { this.timer = null; void this.search(query, abort); }, 180);
  }

  private async search(query: string, abort: AbortController): Promise<void> {
    let bodies: Body[];
    try { bodies = await this.options.search(query, abort.signal); }
    catch {
      if (!abort.signal.aborted) this.options.results.textContent = this.options.translate("universe3d.searchEmpty");
      return;
    }
    if (abort.signal.aborted || !this.options.dialog.open) return;
    this.options.results.replaceChildren();
    for (const body of bodies) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${body.name} · ${(body.object_type ?? "Object").replace(/_/g, " ")}`;
      button.disabled = !this.options.eligible(body);
      if (button.disabled) button.title = this.options.translate("universe3d.searchUnplaced");
      else button.addEventListener("click", () => this.options.choose(body));
      this.options.results.append(button);
    }
    if (!bodies.length) this.options.results.textContent = this.options.translate("universe3d.searchEmpty");
  }
}
