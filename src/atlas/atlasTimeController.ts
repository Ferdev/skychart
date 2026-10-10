import { clamp } from "../geometry";
import { AtlasTimeBar, type TimeBarIds, type TimeBarStep } from "./atlasTimeBar";
import type { Ephemeris } from "./contracts";
import { keepPopoverNear } from "./popoverPlacement";
import { TimePlayback, type TimePlaybackState } from "./timePlayback";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface AtlasTimeControllerOptions {
  /** One host element for each time bar: the 2D header, the Sky header, and the 3D header. */
  bars: readonly { root: HTMLElement; ids?: TimeBarIds }[];
  /** The popover with the date and time field. */
  popover: HTMLElement;
  timeSummary: HTMLElement;
  timeInput: HTMLInputElement;
  applyButton: HTMLButtonElement;
  /** Step size and play controls of the popover. A compact time bar does not show its own. */
  popoverStepSize: HTMLSelectElement;
  popoverPlay: HTMLButtonElement;
  /** A compact bar has no Now button. The popover has one. */
  popoverNow: HTMLButtonElement;
  steps: readonly TimeBarStep[];
  defaultStepIndex: number;
  ephemeris: () => Ephemeris | null;
  /** True while the atlas follows the current time. */
  isNow: () => boolean;
  formatDate: (timestamp: string) => string;
  formatBarDate: (timestamp: string, timeZone: "UTC" | undefined) => string;
  toLocalInput: (date: Date) => string;
  translate: Translate;
  /** Loads the atlas for a time. With no time, the atlas follows the current time again. */
  loadAtlas: (timestamp?: string) => void;
  /** Play started or stopped. At a stop the owner loads the data that play does not load for each step. */
  playbackChanged: (state: TimePlaybackState) => void;
}

/** Owns the atlas time controls: the time bars, the date and time popover, the step size, and play. */
export class AtlasTimeController {
  private readonly bars: AtlasTimeBar[];
  private readonly playback: TimePlayback;
  private stepIndexValue: number;
  private busy = false;

  constructor(private readonly options: AtlasTimeControllerOptions) {
    this.stepIndexValue = clamp(options.defaultStepIndex, 0, options.steps.length - 1);
    this.playback = new TimePlayback({
      step: () => this.step(1),
      onChange: (state) => {
        this.update();
        options.playbackChanged(state);
      },
    });
    this.bars = options.bars.map((bar) => new AtlasTimeBar({
      root: bar.root,
      ids: bar.ids,
      steps: options.steps,
      popoverId: options.popover.id,
      translate: options.translate,
      onStep: (direction) => {
        this.playback.pause();
        this.step(direction);
      },
      onStepSize: (index) => this.setStepIndex(index),
      onNow: () => this.now(),
      onTogglePlay: () => this.playback.toggle(),
    }));
    // The popover opens below the date button that the user selected.
    let opener: HTMLElement = this.bars[0]!.dateButton;
    for (const bar of this.bars) bar.dateButton.addEventListener("click", () => { opener = bar.dateButton; });
    keepPopoverNear(options.popover, () => opener, () => "below");
    options.applyButton.addEventListener("click", () => {
      const date = this.dateFromInput();
      if (!date) return;
      this.playback.pause();
      options.popover.hidePopover();
      options.loadAtlas(date.toISOString());
    });
    options.popoverStepSize.addEventListener("change", () => this.setStepIndex(Number(options.popoverStepSize.value)));
    options.popoverPlay.addEventListener("click", () => {
      this.playback.toggle();
      if (this.playing) options.popover.hidePopover();
    });
    options.popoverNow.addEventListener("click", () => {
      options.popover.hidePopover();
      this.now();
    });
    options.timeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") options.applyButton.click();
    });
    document.addEventListener("visibilitychange", () => this.playback.visibilityChanged(document.hidden));
    window.addEventListener("cosmic-atlas:locale-change", () => this.update());
  }

  get stepIndex(): number {
    return this.stepIndexValue;
  }

  /** The step that the step buttons and play use. */
  get currentStep(): TimeBarStep {
    return this.options.steps[this.stepIndexValue] ?? this.options.steps[0]!;
  }

  get playing(): boolean {
    return this.playback.state.playing;
  }

  setStepIndex(index: number): void {
    this.stepIndexValue = clamp(Math.round(index), 0, this.options.steps.length - 1);
    this.update();
  }

  /** Shows the atlas time, the step, and the play state in all time bars and in the popover. */
  update(): void {
    const timestamp = this.options.ephemeris()?.timestamp_utc ?? null;
    if (timestamp) this.options.timeSummary.textContent = this.options.formatDate(timestamp);
    const state = {
      dateText: timestamp ? `${this.options.formatBarDate(timestamp, "UTC")} UTC` : this.options.translate("time.currentUtc"),
      localText: timestamp ? this.options.formatBarDate(timestamp, undefined) : "",
      isNow: this.options.isNow(),
      stepIndex: this.stepIndexValue,
      playing: this.playing,
      busy: this.busy,
    };
    for (const bar of this.bars) bar.update(state);
    const { popoverStepSize, popoverPlay, steps, translate } = this.options;
    popoverStepSize.replaceChildren(...steps.map((step, index) => new Option(translate(step.labelKey), String(index))));
    popoverStepSize.value = String(this.stepIndexValue);
    popoverPlay.textContent = translate(state.playing ? "timeBar.pause" : "timeBar.play");
    popoverPlay.setAttribute("aria-pressed", String(state.playing));
  }

  step(direction: -1 | 1): void {
    const current = new Date(this.options.ephemeris()?.timestamp_utc ?? Date.now());
    const next = new Date(current.getTime() + direction * this.currentStep.days * 86_400_000);
    this.options.timeInput.value = this.options.toLocalInput(next);
    this.options.loadAtlas(next.toISOString());
  }

  /** The atlas follows the current time again. */
  now(): void {
    this.playback.pause();
    this.options.timeInput.value = this.options.toLocalInput(new Date());
    this.options.loadAtlas();
  }

  play(): void {
    this.playback.play();
  }

  pause(): void {
    this.playback.pause();
  }

  /** Call when an atlas load is complete, so that play can start its next step. */
  loadCompleted(): void {
    this.playback.loadCompleted();
  }

  /** Call when an atlas load failed. Play stops. */
  loadFailed(): void {
    this.playback.loadFailed();
  }

  dateFromInput(): Date | null {
    if (!this.options.timeInput.value) return null;
    const date = new Date(`${this.options.timeInput.value}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.options.applyButton.disabled = busy;
    this.update();
  }
}
