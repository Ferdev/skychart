import { trackEvent } from "../analytics";
import { locale, t } from "../i18n";
import { CommunityApi, errorText } from "./api";
import { h } from "./communityUi";
import { POLL_INTERVAL_MS, pollStep, type FlightState } from "./flightNarration";

/** The `Ask` form of the search panel: a question gives a flight in the tour player, or a refusal. */
export class AnswerFlights {
  private request = 0;

  constructor(
    private readonly api: CommunityApi,
    private readonly startTour: (slug: string) => void,
  ) {}

  /** The form stays hidden with no model key, so a visitor never meets a form that cannot work. */
  mount() {
    const section = document.querySelector<HTMLElement>("#ask-section");
    const form = section?.querySelector<HTMLFormElement>("form");
    if (!section || !form) return;
    section.hidden = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.ask(section, form);
    });
  }

  private status(section: HTMLElement, text: string, busy = false) {
    const line = section.querySelector<HTMLElement>("[data-ask-status]")!;
    line.textContent = text;
    line.parentElement!.setAttribute("aria-busy", String(busy));
  }

  private async ask(section: HTMLElement, form: HTMLFormElement) {
    const generation = ++this.request;
    const question = new FormData(form).get("question")?.toString() ?? "";
    const button = form.querySelector("button")!;
    section.querySelector("[data-ask-tour]")?.remove();
    button.disabled = true;
    this.status(section, t("ask.queued"), true);
    try {
      let state = await this.api.request<FlightState>("/api/flights", "POST", { question, locale: locale() });
      trackEvent("answer_flight");
      const started = Date.now();
      for (;;) {
        if (generation !== this.request) return;
        const step = pollStep(state.status, Date.now() - started);
        if (step !== "wait") return this.finish(section, form, state, step);
        this.status(section, t(state.status === "running" ? "ask.running" : "ask.queued"), true);
        await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        state = await this.api.request<FlightState>(`/api/flights/${encodeURIComponent(state.flight)}`);
      }
    } catch (error) {
      if (generation === this.request) this.status(section, errorText(error));
    } finally {
      if (generation === this.request) button.disabled = false;
    }
  }

  private finish(section: HTMLElement, form: HTMLFormElement, state: FlightState, step: string) {
    if (step === "play") {
      this.status(section, "");
      this.startTour(state.slug);
      return;
    }
    if (step === "timeout") return this.status(section, t("ask.timeout"));
    if (step === "fail") return this.status(section, t(state.refusal === "daily_limit" ? "community.error.flights_daily_limit" : "ask.failed"));
    this.status(section, t(state.refusal === "off_topic" ? "ask.refused.offTopic" : "ask.refused.unsupported"));
    const tour = state.suggested_tour;
    if (!tour) return;
    const offer = document.createElement("p");
    offer.dataset.askTour = "";
    offer.innerHTML = `${h(t("ask.refused.try"))} <a href="/?tour=${h(tour.slug)}">${h(tour.title)}</a>`;
    offer.querySelector("a")!.onclick = (event) => {
      event.preventDefault();
      this.startTour(tour.slug);
    };
    form.after(offer);
  }
}
