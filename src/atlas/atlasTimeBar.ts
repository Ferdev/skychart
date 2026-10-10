type Translate = (key: string, params?: Record<string, string | number>) => string;

export type TimeBarStep = { days: number; labelKey: string };

/** Element ids of the controls of one time bar. Tests and other code find the controls by these ids. */
export type TimeBarIds = Partial<Record<"back" | "forward" | "date" | "stepSize" | "play" | "now" | "busy", string>>;

export type TimeBarState = {
  /** Text of the atlas time, in UTC. */
  dateText: string;
  /** The same instant in the local time of the browser, for the tooltip. */
  localText: string;
  /** True while the atlas follows the current time. */
  isNow: boolean;
  stepIndex: number;
  playing: boolean;
  busy: boolean;
};

export type TimeBarOptions = {
  root: HTMLElement;
  ids?: TimeBarIds;
  steps: readonly TimeBarStep[];
  /** Id of the popover that has the date and time field. */
  popoverId: string;
  translate: Translate;
  onStep: (direction: -1 | 1) => void;
  onStepSize: (index: number) => void;
  onNow: () => void;
  onTogglePlay: () => void;
};

/**
 * The time bar shows the atlas time and its controls: step back, date, step forward, step size, play, and Now.
 * The 2D header, the Sky header, and the 3D header each have one. All bars show the one global atlas time.
 */
export class AtlasTimeBar {
  private readonly back: HTMLButtonElement;
  private readonly forward: HTMLButtonElement;
  private readonly date: HTMLButtonElement;
  private readonly dateText: HTMLSpanElement;
  private readonly stepNote: HTMLSpanElement;
  private readonly stepSize: HTMLSelectElement;
  private readonly play: HTMLButtonElement;
  private readonly now: HTMLButtonElement;
  private readonly busy: HTMLSpanElement;
  private readonly busyText: HTMLSpanElement;
  private state: TimeBarState | null = null;

  constructor(private readonly options: TimeBarOptions) {
    const { root, ids = {} } = options;
    root.classList.add("time-bar");
    root.setAttribute("role", "group");
    this.back = this.button("time-bar__step", ids.back);
    this.date = this.button("time-bar__date", ids.date);
    this.date.setAttribute("popovertarget", options.popoverId);
    this.date.setAttribute("aria-haspopup", "dialog");
    this.dateText = document.createElement("span");
    this.dateText.className = "time-bar__date-text";
    // The step size shows here when the bar is compact and the step buttons have no text.
    this.stepNote = document.createElement("span");
    this.stepNote.className = "time-bar__step-note";
    // The space keeps the two texts apart in the text of the button, as they are in its accessible name.
    this.date.append(this.dateText, " ", this.stepNote);
    this.forward = this.button("time-bar__step", ids.forward);
    this.stepSize = document.createElement("select");
    this.stepSize.className = "time-bar__size";
    if (ids.stepSize) this.stepSize.id = ids.stepSize;
    this.play = this.button("time-bar__play", ids.play);
    this.now = this.button("time-bar__now", ids.now);
    this.busy = document.createElement("span");
    this.busy.className = "time-bar__busy";
    if (ids.busy) this.busy.id = ids.busy;
    this.busy.setAttribute("role", "status");
    this.busy.setAttribute("aria-live", "polite");
    this.busy.hidden = true;
    const spinner = document.createElement("span");
    spinner.className = "time-busy__spinner";
    spinner.setAttribute("aria-hidden", "true");
    this.busyText = document.createElement("span");
    this.busyText.className = "sr-only";
    this.busy.append(spinner, this.busyText);
    root.replaceChildren(this.back, this.date, this.forward, this.stepSize, this.play, this.now, this.busy);

    this.back.addEventListener("click", () => options.onStep(-1));
    this.forward.addEventListener("click", () => options.onStep(1));
    this.now.addEventListener("click", () => options.onNow());
    this.play.addEventListener("click", () => options.onTogglePlay());
    this.stepSize.addEventListener("change", () => options.onStepSize(Number(this.stepSize.value)));
  }

  /** The button that opens the date and time popover. The popover is placed below it. */
  get dateButton(): HTMLButtonElement {
    return this.date;
  }

  update(state: TimeBarState): void {
    this.state = state;
    const { root, steps, translate } = this.options;
    const step = steps[state.stepIndex] ?? steps[0]!;
    const stepLabel = translate(step.labelKey);
    root.setAttribute("aria-label", translate("timeBar.label"));
    root.dataset.timeState = state.isNow ? "now" : "not-now";
    root.dataset.playing = String(state.playing);

    this.setStepText(this.back, "−", stepLabel, translate("timeBar.stepBack", { step: stepLabel }));
    this.setStepText(this.forward, "+", stepLabel, translate("timeBar.stepForward", { step: stepLabel }));

    this.dateText.textContent = state.dateText;
    this.stepNote.textContent = translate("timeBar.stepNote", { step: stepLabel });
    this.date.title = translate("timeBar.localTime", { date: state.localText });
    // The name has the text that the button shows: the date, and the step size on a compact bar.
    const visibleText = `${state.dateText} ${translate("timeBar.stepNote", { step: stepLabel })}`;
    this.date.setAttribute("aria-label", translate(state.isNow ? "timeBar.dateNow" : "timeBar.dateNotNow", { date: visibleText }));

    if (this.stepSize.options.length !== steps.length || this.stepSize.dataset.locale !== translate("time.stepSize")) {
      this.stepSize.replaceChildren(...steps.map((item, index) => new Option(translate(item.labelKey), String(index))));
      this.stepSize.dataset.locale = translate("time.stepSize");
    }
    this.stepSize.value = String(state.stepIndex);
    this.stepSize.setAttribute("aria-label", translate("time.stepSize"));

    this.play.textContent = translate(state.playing ? "timeBar.pause" : "timeBar.play");
    this.play.setAttribute("aria-pressed", String(state.playing));
    this.play.title = translate("timeBar.playHelp");

    this.now.textContent = translate("time.now");
    this.now.title = translate(state.isNow ? "timeBar.isNow" : "timeBar.returnToNow");
    this.now.setAttribute("aria-pressed", String(state.isNow));

    this.busy.hidden = !state.busy;
    this.busyText.textContent = translate("time.updating");
    // A load is in progress: the next step must wait for it. Pause stays available.
    for (const control of [this.back, this.forward, this.now, this.stepSize]) control.disabled = state.busy;
  }

  /** Shows the text again in the new language. */
  updateLocale(): void {
    if (this.state) this.update(this.state);
  }

  private setStepText(button: HTMLButtonElement, sign: string, stepLabel: string, name: string): void {
    const signText = document.createElement("span");
    signText.className = "time-bar__step-sign";
    signText.textContent = sign;
    const label = document.createElement("span");
    label.className = "time-bar__step-label";
    label.textContent = stepLabel;
    button.replaceChildren(signText, label);
    button.setAttribute("aria-label", name);
    button.title = name;
  }

  private button(className: string, id?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    if (id) button.id = id;
    return button;
  }
}
