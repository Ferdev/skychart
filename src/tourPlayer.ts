import { decodeViewState, type ViewState } from "./viewState";

export type TourStep = { viewState: string; title: string; body: string; holdMs?: number };
export type Tour = { slug: string; title: string; description: string; steps: TourStep[] };
export type TourPlayerAdapter = {
  navigate(state: ViewState, options: { animate: boolean; slug: string; step: number; restoring: boolean; signal: AbortSignal }): Promise<void>;
  prewarm(state: ViewState): void;
  track(event: "tour_started" | "tour_completed", properties: Record<string, string>): void;
  /** Text of the player in the active language. The tour content itself stays in English. */
  translate(key: string, params?: Record<string, string | number>): string;
  /** The user closed the tour. */
  closed(): void;
};

/** The card that shows one step of a guided tour and moves the atlas to the view of that step. */
export class TourPlayer {
  private tour: Tour | null = null;
  private index = 0;
  private timer: number | null = null;
  private transition: AbortController | null = null;
  private plate = document.createElement("section");

  constructor(private adapter: TourPlayerAdapter) {
    Object.assign(this.plate, { id: "tour-player", className: "tour-player", hidden: true });
    this.plate.setAttribute("aria-live", "polite");
    document.querySelector("#app")?.append(this.plate);
    this.plate.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLButtonElement>("[data-tour-action]")?.dataset.tourAction;
      if (action === "next") void this.go(this.index + 1);
      if (action === "previous") void this.go(this.index - 1);
      if (action === "close") this.close();
      const dot = target.closest<HTMLButtonElement>("[data-tour-step]");
      if (dot) void this.go(Number(dot.dataset.tourStep));
    });
    window.addEventListener("keydown", (event) => {
      if (this.plate.hidden || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight") { event.preventDefault(); void this.go(this.index + 1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); void this.go(this.index - 1); }
      if (event.key === "Escape") this.close();
    });
    window.addEventListener("cosmic-atlas:locale-change", () => this.refreshText());
  }

  get active(): boolean {
    return !this.plate.hidden;
  }

  async start(slug: string, step = 0) {
    const t = this.adapter.translate;
    const transition = this.beginTransition();
    this.plate.setAttribute("aria-label", t("tour.label"));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return this.error(t("tour.invalidAddress"));
    this.plate.hidden = false;
    this.plate.innerHTML = `<p role="status">${escapeHtml(t("tour.loading"))}</p>`;
    try {
      const response = await fetch(`/tours/${encodeURIComponent(slug)}.json`, { signal: transition.signal });
      if (!response.ok) throw new Error("Tour unavailable");
      const tour = await response.json() as Tour;
      if (transition.signal.aborted) return;
      if (tour.slug !== slug || !Array.isArray(tour.steps) || !tour.steps.length || tour.steps.some((item) => !decodeViewState(item.viewState))) throw new Error("Tour data is invalid");
      this.tour = tour;
      this.adapter.track("tour_started", { tour: slug });
      await this.go(Math.min(Math.max(step, 0), tour.steps.length - 1), true);
      if (!this.transition?.signal.aborted) this.plate.querySelector<HTMLButtonElement>("[data-tour-action='next']")?.focus();
    } catch {
      if (!transition.signal.aborted) this.error(t("tour.unavailable"));
    }
  }

  async restoreStep(step: number) {
    if (this.tour) await this.go(step, true);
  }

  /** Shows the card again in the active language. */
  private refreshText(): void {
    if (this.active && this.tour) this.render();
  }

  private async go(index: number, restoring = false) {
    if (!this.tour || index < 0 || index >= this.tour.steps.length) return;
    const transition = this.beginTransition();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.index = index;
    const step = this.tour.steps[index]!;
    const state = decodeViewState(step.viewState)!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.plate.dataset.motion = reduced ? "cut" : "flight";
    if (restoring) this.render();
    await this.adapter.navigate(state, { animate: !reduced, slug: this.tour.slug, step: index, restoring, signal: transition.signal });
    if (transition.signal.aborted) return;
    if (!restoring) this.render();
    const next = this.tour.steps[index + 1];
    if (next) this.adapter.prewarm(decodeViewState(next.viewState)!);
    if (!restoring && step.holdMs && next) this.timer = window.setTimeout(() => void this.go(index + 1), step.holdMs);
    if (index === this.tour.steps.length - 1) this.adapter.track("tour_completed", { tour: this.tour.slug });
  }

  private beginTransition() {
    this.transition?.abort();
    this.transition = new AbortController();
    return this.transition;
  }

  private render() {
    const t = this.adapter.translate;
    const tour = this.tour!;
    const step = tour.steps[this.index]!;
    const total = tour.steps.length;
    // A done step and the current step have a fill. The current step is larger.
    const dots = tour.steps.map((_, i) =>
      `<button type="button" data-tour-step="${i}" data-tour-dot="${i < this.index ? "done" : i === this.index ? "current" : "next"}" aria-label="${escapeHtml(t("tour.goToStep", { step: i + 1 }))}" aria-current="${i === this.index ? "step" : "false"}"></button>`).join("");
    this.plate.setAttribute("aria-label", t("tour.label"));
    this.plate.innerHTML = `
      <div class="tour-player__head">
        <p>${escapeHtml(tour.title)}</p>
        <button type="button" class="text-action" data-tour-action="close" aria-label="${escapeHtml(t("tour.closeLabel"))}">${escapeHtml(t("tour.close"))}</button>
      </div>
      <p class="tour-player__progress">${escapeHtml(t("tour.stepOf", { step: this.index + 1, total }))}</p>
      <h2 tabindex="-1">${escapeHtml(step.title)}</h2>
      <p class="tour-player__body">${escapeHtml(step.body)}</p>
      <div class="tour-player__dots" role="group" aria-label="${escapeHtml(t("tour.progress"))}">${dots}</div>
      <div class="tour-player__actions">
        <button type="button" class="secondary-action" data-tour-action="previous" ${this.index === 0 ? "disabled" : ""}>${escapeHtml(t("tour.previous"))}</button>
        <button type="button" class="primary-action" data-tour-action="next" ${this.index === total - 1 ? "disabled" : ""}>${escapeHtml(t("tour.next"))}</button>
      </div>`;
  }

  private error(message: string) {
    this.plate.hidden = false;
    this.plate.innerHTML = `<p role="alert">${escapeHtml(message)}</p><button type="button" class="secondary-action" data-tour-action="close">${escapeHtml(this.adapter.translate("tour.close"))}</button>`;
  }

  close() {
    const wasActive = this.active;
    this.transition?.abort();
    this.transition = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.tour = null;
    this.plate.hidden = true;
    if (wasActive) this.adapter.closed();
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
