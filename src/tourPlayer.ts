import { chipKey, factText, speechText, type FlightSource, type NarrationSentence } from "./community/flightNarration";
import { decodeViewState, type ViewState } from "./viewState";

export type TourStep = {
  viewState: string;
  title: string;
  body: string;
  holdMs?: number;
  /** An answer flight: the narration with a chip for each number and each object. */
  sentences?: NarrationSentence[];
  sources?: FlightSource[] | null;
};
export type Tour = { slug: string; title: string; description: string; steps: TourStep[]; author?: string; narrated?: boolean; flight?: string };
/** A tour of a community member: the slug is this prefix and the unlisted token of the tour. */
export const SHARED_TOUR_PREFIX = "shared-";
/** An answer flight: the slug is this prefix and the stable name of the flight. */
export const ANSWER_FLIGHT_PREFIX = "answer-";
/** Analytics never get the unlisted token of a shared tour, or the question behind a flight. */
const analyticsName = (slug: string) => (slug.startsWith(SHARED_TOUR_PREFIX) ? "shared" : slug.startsWith(ANSWER_FLIGHT_PREFIX) ? "answer" : slug);
const tourAddress = (slug: string) => {
  if (slug.startsWith(SHARED_TOUR_PREFIX)) return `/api/community/shared-tours/${encodeURIComponent(slug.slice(SHARED_TOUR_PREFIX.length))}`;
  if (slug.startsWith(ANSWER_FLIGHT_PREFIX)) return `/api/flights/${encodeURIComponent(slug.slice(ANSWER_FLIGHT_PREFIX.length))}`;
  return `/tours/${encodeURIComponent(slug)}.json`;
};
export type TourPlayerAdapter = {
  navigate(state: ViewState, options: { animate: boolean; slug: string; step: number; restoring: boolean; signal: AbortSignal }): Promise<void>;
  prewarm(state: ViewState): void;
  track(event: "tour_started" | "tour_completed", properties: Record<string, string>): void;
  /** Text of the player in the active language. The tour content itself stays in English. */
  translate(key: string, params?: Record<string, string | number>): string;
  /** The user closed the tour. */
  closed(): void;
  /** Opens the report form of a shared tour. */
  report?(slug: string): void;
  /** The language of the reader, for numbers and browser speech. */
  locale(): string;
  /** A chip opens its source record in the inspector. */
  openObject?(key: string): void;
};

/** Roles of the controls that use the arrow keys or Escape for their own work. */
const KEY_WIDGETS = "select, [contenteditable]:not([contenteditable='false']), [role='tab'], [role='tablist'], [role='slider'], [role='spinbutton'], [role='listbox'], [role='option'], [role='menu'], [role='menubar'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='radiogroup'], [role='radio'], [role='grid'], [role='tree'], [role='treegrid'], [role='combobox']";
const DIALOGS = "dialog, [role='dialog'], [role='alertdialog']";

/**
 * The arrow keys and Escape go to the tour only when no other control uses them: not in a text field,
 * a select, a tab, a slider, a list or a menu, and not in a dialog other than the tour card.
 */
export function tourOwnsKey(event: KeyboardEvent, plate: HTMLElement): boolean {
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false;
  if (target.closest(KEY_WIDGETS)) return false;
  const dialog = target.closest(DIALOGS);
  return !dialog || dialog === plate || plate.contains(dialog);
}

/** The card that shows one step of a guided tour and moves the atlas to the view of that step. */
export class TourPlayer {
  private tour: Tour | null = null;
  private index = 0;
  private timer: number | null = null;
  private transition: AbortController | null = null;
  private plate = document.createElement("section");
  /** A screen reader hears only the step number and the title of a new step, not the whole card. */
  private announcer = document.createElement("p");
  private announced = "";
  private speaking = false;
  private arrival: Promise<unknown> = Promise.resolve();
  private trackSession = true;
  private completed = false;

  constructor(private adapter: TourPlayerAdapter) {
    Object.assign(this.plate, { id: "tour-player", className: "tour-player", hidden: true });
    Object.assign(this.announcer, { id: "tour-player-status", className: "sr-only" });
    this.announcer.setAttribute("aria-live", "polite");
    this.announcer.setAttribute("aria-atomic", "true");
    document.querySelector("#app")?.append(this.plate, this.announcer);
    this.plate.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLButtonElement>("[data-tour-action]")?.dataset.tourAction;
      if (action === "next") void this.go(this.index + 1);
      if (action === "previous") void this.go(this.index - 1);
      if (action === "close") this.close();
      if (action === "report" && this.tour) this.adapter.report?.(this.tour.slug);
      if (action === "speak") this.toggleSpeech();
      const chip = target.closest<HTMLButtonElement>("[data-tour-object]");
      // The view of the step replaces the selection, so a click during the flight waits for its end.
      if (chip) void this.arrival.then(() => this.adapter.openObject?.(chip.dataset.tourObject!));
      const dot = target.closest<HTMLButtonElement>("[data-tour-step]");
      if (dot) void this.go(Number(dot.dataset.tourStep));
    });
    window.addEventListener("keydown", (event) => {
      if (this.plate.hidden || !tourOwnsKey(event, this.plate)) return;
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
      const response = await fetch(tourAddress(slug), { signal: transition.signal });
      if (!response.ok) throw new Error("Tour unavailable");
      const tour = await response.json() as Tour;
      if (transition.signal.aborted) return;
      if (tour.slug !== slug) throw new Error("Tour data is invalid");
      await this.begin(tour, step);
    } catch {
      if (!transition.signal.aborted) this.error(t("tour.unavailable"));
    }
  }

  /** Plays a tour from memory: the preview of the tour builder. */
  async preview(tour: Tour) {
    const transition = this.beginTransition();
    this.plate.setAttribute("aria-label", this.adapter.translate("tour.label"));
    this.plate.hidden = false;
    try {
      await this.begin(tour, 0, false);
    } catch {
      if (!transition.signal.aborted) this.error(this.adapter.translate("tour.unavailable"));
    }
  }

  private async begin(tour: Tour, step: number, trackSession = true) {
    if (!Array.isArray(tour.steps) || !tour.steps.length || tour.steps.some((item) => !decodeViewState(item.viewState))) throw new Error("Tour data is invalid");
    this.tour = tour;
    this.trackSession = trackSession;
    this.completed = false;
    if (trackSession) this.adapter.track("tour_started", { tour: analyticsName(tour.slug) });
    await this.go(Math.min(Math.max(step, 0), tour.steps.length - 1), true);
    if (!this.transition?.signal.aborted) this.plate.querySelector<HTMLButtonElement>("[data-tour-action='next']")?.focus();
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
    this.stopVoice();
    const step = this.tour.steps[index]!;
    const state = decodeViewState(step.viewState)!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.plate.dataset.motion = reduced ? "cut" : "flight";
    if (restoring) this.render();
    const flight = this.adapter.navigate(state, { animate: !reduced, slug: this.tour.slug, step: index, restoring, signal: transition.signal });
    this.arrival = flight.catch(() => undefined);
    await flight;
    if (transition.signal.aborted) return;
    if (!restoring) this.render();
    const next = this.tour.steps[index + 1];
    if (next) this.adapter.prewarm(decodeViewState(next.viewState)!);
    if (!restoring && step.holdMs && next) this.timer = window.setTimeout(() => void this.go(index + 1), step.holdMs);
    if (this.trackSession && !this.completed && index === this.tour.steps.length - 1) {
      this.completed = true;
      this.adapter.track("tour_completed", { tour: analyticsName(this.tour.slug) });
    }
    if (this.speaking) this.speak();
  }

  private unit = (unit: string) => this.adapter.translate(`ask.unit.${unit}`);

  private get canSpeak() {
    return Boolean(this.tour?.narrated) && "speechSynthesis" in window;
  }

  /** Browser speech reads the step in the language of the reader. The button keeps it on for the next step. */
  private toggleSpeech() {
    this.speaking = !this.speaking;
    if (this.speaking) this.speak();
    else this.stopVoice();
    this.render();
  }

  private speak() {
    const step = this.tour?.steps[this.index];
    if (!step?.sentences || !this.canSpeak) return;
    const locale = this.adapter.locale();
    const speech = new SpeechSynthesisUtterance(speechText(step.title, step.sentences, locale, this.unit));
    speech.lang = locale;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  }

  private stopVoice() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  /** The narration: each number and each object is a button that opens its record. */
  private narration(sentences: NarrationSentence[]): string {
    const locale = this.adapter.locale();
    const t = this.adapter.translate;
    return sentences
      .map(
        (sentence) =>
          `<p class="tour-player__body">${sentence
            .map((segment) => {
              if (segment.kind === "text") return escapeHtml(segment.text);
              const text = segment.kind === "fact" ? factText(segment, locale, this.unit) : segment.text;
              const key = chipKey(segment);
              const chipClass = segment.kind === "fact" ? "tour-player__chip tour-player__chip--fact" : "tour-player__chip";
              if (!key) return `<span class="${chipClass}">${escapeHtml(text)}</span>`;
              const asOf = segment.kind === "fact" && segment.as_of ? ` ${t("ask.asOf", { date: segment.as_of.slice(0, 10) })}` : "";
              return `<button type="button" class="${chipClass}" data-tour-object="${escapeHtml(key)}" title="${escapeHtml(`${t("ask.openRecord")}${asOf}`)}">${escapeHtml(text)}</button>`;
            })
            .join("")}</p>`,
      )
      .join("");
  }

  private sources(sources: FlightSource[]): string {
    const t = this.adapter.translate;
    return `<div class="tour-player__sources"><h3>${escapeHtml(t("ask.sources"))}</h3><ul>${sources
      .map((source) => `<li><button type="button" class="text-action" data-tour-object="${escapeHtml(source.key)}">${escapeHtml(source.name)}</button>${source.catalog ? ` <span>${escapeHtml(source.catalog)}</span>` : ""}</li>`)
      .join("")}</ul></div>`;
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
    // The new card replaces the old buttons. The focus goes back to the same control of the new card.
    const focused = document.activeElement as HTMLElement | null;
    const focusTarget = focused && this.plate.contains(focused)
      ? focused.dataset.tourAction ? `[data-tour-action="${focused.dataset.tourAction}"]`
        : focused.dataset.tourStep ? `[data-tour-step="${focused.dataset.tourStep}"]` : "h2"
      : null;
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
      <div class="tour-player__content">
        ${step.sentences?.length ? this.narration(step.sentences) : `<p class="tour-player__body">${escapeHtml(step.body)}</p>`}
        ${step.sources?.length ? this.sources(step.sources) : ""}
        ${tour.author ? `<p class="tour-player__progress">${escapeHtml(t("tour.sharedBy", { name: tour.author }))}</p>` : ""}
      </div>
      <div class="tour-player__dots" role="group" aria-label="${escapeHtml(t("tour.progress"))}">${dots}</div>
      <div class="tour-player__actions">
        <button type="button" class="secondary-action" data-tour-action="previous" ${this.index === 0 ? "disabled" : ""}>${escapeHtml(t("tour.previous"))}</button>
        <button type="button" class="primary-action" data-tour-action="next" ${this.index === total - 1 ? "disabled" : ""}>${escapeHtml(t("tour.next"))}</button>
        ${this.canSpeak ? `<button type="button" class="secondary-action" data-tour-action="speak" aria-pressed="${this.speaking}">${escapeHtml(t(this.speaking ? "ask.stop" : "ask.listen"))}</button>` : ""}
        ${tour.flight ? `<a class="text-action" href="/flights/${escapeHtml(tour.flight)}">${escapeHtml(t("ask.page"))}</a>` : ""}
        ${tour.slug.startsWith(SHARED_TOUR_PREFIX) && this.adapter.report ? `<button type="button" class="text-action" data-tour-action="report">${escapeHtml(t("tour.report"))}</button>` : ""}
      </div>`;
    if (focusTarget) {
      // A disabled button cannot have the focus (Next on the last step): the title of the step gets it.
      const control = this.plate.querySelector<HTMLElement>(`${focusTarget}:not(:disabled)`) ?? this.plate.querySelector<HTMLElement>("h2");
      control?.focus({ preventScroll: true });
    }
    this.announce(`${t("tour.stepOf", { step: this.index + 1, total })}: ${step.title}`);
  }

  /** The text changes only for a new step, so the speech button and a new language are not read again. */
  private announce(text: string) {
    const key = `${this.tour?.slug}#${this.index}`;
    if (key === this.announced) return;
    this.announced = key;
    this.announcer.textContent = text;
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
    this.speaking = false;
    this.stopVoice();
    this.plate.hidden = true;
    this.announced = "";
    this.announcer.textContent = "";
    if (wasActive) this.adapter.closed();
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
