/**
 * What the autopilot controls of the 3D view tell the user.
 *
 * The autopilot always says what it does: it flies to the target, it cruises forward when there is
 * no target, or it has nothing to do because the craft is at the target.
 */

/** The craft is at the target when the distance is not more than the standoff distance, with a small margin. */
export const AT_TARGET_MARGIN = 1.001;

export function isAtTarget(distanceAu: number, standoffAu: number): boolean {
  return Number.isFinite(distanceAu) && standoffAu > 0 && distanceAu <= standoffAu * AT_TARGET_MARGIN;
}

/**
 * True when the craft is at the distance where `Jump there` puts it. Inside that distance (for example in
 * the volume of a galaxy) the jump still has a use: it moves the craft out to the distance that shows the object.
 */
export function isAtViewingDistance(distanceAu: number, standoffAu: number): boolean {
  return Number.isFinite(distanceAu) && standoffAu > 0 && Math.abs(distanceAu - standoffAu) <= standoffAu * (AT_TARGET_MARGIN - 1);
}

export type AutopilotControlInput = {
  hasTarget: boolean;
  /** The autopilot is on. */
  active: boolean;
  atTarget: boolean;
};

export type AutopilotControlState = {
  /** Translation key of the button text. */
  labelKey: string;
  /** The autopilot button, `Fly there`, and `Jump there` have nothing to do at the target. */
  disabled: boolean;
  /** Translation key of the status line next to the speed panel, or null for no line. */
  noteKey: string | null;
};

export function autopilotControlState(input: AutopilotControlInput): AutopilotControlState {
  if (input.active) {
    return {
      labelKey: "universe3d.autopilotStop",
      disabled: false,
      noteKey: input.hasTarget ? null : "universe3d.cruisingNoDestination",
    };
  }
  if (!input.hasTarget) return { labelKey: "universe3d.cruiseForward", disabled: false, noteKey: null };
  if (input.atTarget) return { labelKey: "universe3d.autopilotStart", disabled: true, noteKey: null };
  return { labelKey: "universe3d.autopilotStart", disabled: false, noteKey: null };
}

/** How long an arrival message stays before a less important message can replace it. */
export const ARRIVAL_MESSAGE_HOLD_MS = 4_000;

/** Keeps an important status message for a time: a catalog load that ends soon after an arrival does not hide it. */
export class StatusMessageHold {
  private heldUntil = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Call when an important message is shown. */
  hold(durationMs = ARRIVAL_MESSAGE_HOLD_MS): void {
    this.heldUntil = this.now() + durationMs;
  }

  /** True when a routine message can replace the text. */
  canReplace(): boolean {
    return this.now() >= this.heldUntil;
  }

  release(): void {
    this.heldUntil = 0;
  }
}
