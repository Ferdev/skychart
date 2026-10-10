/** Play of the atlas time has limits, because each step is one ephemeris request. */
export const PLAY_MIN_INTERVAL_MS = 1_000;
export const PLAY_MAX_STEPS = 120;

export type TimePlaybackPauseReason = "user" | "limit" | "hidden" | "error";

export type TimePlaybackState = {
  playing: boolean;
  /** Steps that completed since play started. */
  steps: number;
  /** Why play stopped. Null while it plays and before the first play. */
  pauseReason: TimePlaybackPauseReason | null;
};

export type TimePlaybackOptions = {
  /** Starts the load of the next time step. The owner calls `loadCompleted` or `loadFailed` when it ends. */
  step: () => void;
  onChange: (state: TimePlaybackState) => void;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Steps the atlas time again and again:
 * one step after each completed load, one step for each second maximum,
 * and an automatic pause after 120 steps, on a hidden tab, and on an error.
 */
export class TimePlayback {
  private playing = false;
  private steps = 0;
  private pauseReason: TimePlaybackPauseReason | null = null;
  private waitingForLoad = false;
  private lastStepAt = 0;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, milliseconds: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: TimePlaybackOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get state(): TimePlaybackState {
    return { playing: this.playing, steps: this.steps, pauseReason: this.pauseReason };
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.steps = 0;
    this.pauseReason = null;
    this.options.onChange(this.state);
    this.startStep();
  }

  pause(reason: TimePlaybackPauseReason = "user"): void {
    if (!this.playing) return;
    this.playing = false;
    this.waitingForLoad = false;
    this.pauseReason = reason;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.options.onChange(this.state);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** The load that `step` started is complete. Loads from other causes do not count. */
  loadCompleted(): void {
    if (!this.playing || !this.waitingForLoad) return;
    this.waitingForLoad = false;
    this.steps += 1;
    if (this.steps >= PLAY_MAX_STEPS) {
      this.pause("limit");
      return;
    }
    this.options.onChange(this.state);
    const wait = Math.max(0, PLAY_MIN_INTERVAL_MS - (this.now() - this.lastStepAt));
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.startStep();
    }, wait);
  }

  loadFailed(): void {
    this.pause("error");
  }

  /** Call when the page becomes hidden or visible. Play does not start again by itself. */
  visibilityChanged(hidden: boolean): void {
    if (hidden) this.pause("hidden");
  }

  private startStep(): void {
    if (!this.playing) return;
    this.waitingForLoad = true;
    this.lastStepAt = this.now();
    this.options.step();
  }
}
