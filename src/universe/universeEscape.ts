/** Time in which a second Escape press exits 3D mode. */
export const EXIT_CONFIRM_WINDOW_MS = 2_000;

export type UniverseEscapeState = {
  /** The object inspector is open on top of the 3D view. */
  inspectorOpen: boolean;
  /** The autopilot is on, a move key is held, or the observer coasts. */
  flying: boolean;
};

export type UniverseEscapeAction = "close-inspector" | "stop-flight" | "confirm-exit";

/**
 * What one Escape press does in 3D mode. The order is: close the inspector, stop the flight,
 * then ask for a second press before the exit. (An open dialog takes the key before this rule.)
 */
export function universeEscapeAction(state: UniverseEscapeState): UniverseEscapeAction {
  if (state.inspectorOpen) return "close-inspector";
  if (state.flying) return "stop-flight";
  return "confirm-exit";
}

/** The exit needs two presses in a short time, so that one press during a flight does not close 3D mode. */
export class ExitConfirmation {
  private armedAt: number | null = null;

  constructor(
    private readonly windowMs = EXIT_CONFIRM_WINDOW_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Returns true when this press is the second press in the time window. */
  press(): boolean {
    const now = this.now();
    if (this.armedAt !== null && now - this.armedAt <= this.windowMs) {
      this.armedAt = null;
      return true;
    }
    this.armedAt = now;
    return false;
  }

  get armed(): boolean {
    return this.armedAt !== null && this.now() - this.armedAt <= this.windowMs;
  }

  reset(): void {
    this.armedAt = null;
  }
}
