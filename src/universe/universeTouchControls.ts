import type { UniverseMove } from "../navigation/universeNavigation";

/**
 * Flight controls for a touch screen: a joystick for forward, back, left, and right.
 * The up and down buttons next to it are ordinary move buttons (`data-universe-move`).
 * The style sheet shows these controls only for a coarse pointer, where the key pad is hidden.
 */

/** A push of the knob below this part of the radius is no move. */
const DEAD_ZONE = 0.3;

/** The moves that a knob position gives. `x` and `y` are from -1 to 1, and `y` is positive downward. */
export function joystickMoves(x: number, y: number): UniverseMove[] {
  const moves: UniverseMove[] = [];
  if (y <= -DEAD_ZONE) moves.push("forward");
  if (y >= DEAD_ZONE) moves.push("back");
  if (x <= -DEAD_ZONE) moves.push("left");
  if (x >= DEAD_ZONE) moves.push("right");
  return moves;
}

export type TouchControlsOptions = {
  joystick: HTMLElement;
  knob: HTMLElement;
  /** The user holds this move. */
  press: (move: UniverseMove) => void;
  release: (move: UniverseMove) => void;
};

export class UniverseTouchControls {
  private pointerId: number | null = null;
  private held = new Set<UniverseMove>();

  constructor(private readonly options: TouchControlsOptions) {
    const { joystick } = options;
    joystick.addEventListener("pointerdown", (event) => {
      if (this.pointerId !== null) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      try { joystick.setPointerCapture(event.pointerId); } catch { /* A synthetic pointer has no capture. */ }
      this.move(event);
    });
    joystick.addEventListener("pointermove", (event) => { if (event.pointerId === this.pointerId) this.move(event); });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      joystick.addEventListener(type, (event) => { if (event.pointerId === this.pointerId) this.end(); });
    }
    window.addEventListener("blur", () => this.end());
  }

  private move(event: PointerEvent): void {
    const rect = this.options.joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    this.options.knob.style.transform = `translate(${(x * radius * 0.6).toFixed(1)}px, ${(y * radius * 0.6).toFixed(1)}px)`;
    this.apply(new Set(joystickMoves(x, y)));
  }

  private end(): void {
    this.pointerId = null;
    this.options.knob.style.transform = "";
    this.apply(new Set());
  }

  private apply(next: Set<UniverseMove>): void {
    for (const move of this.held) if (!next.has(move)) this.options.release(move);
    for (const move of next) if (!this.held.has(move)) this.options.press(move);
    this.held = next;
  }
}

/** A change of the finger distance below this number of pixels is no step. */
const PINCH_STEP_PX = 6;

/** Two fingers that move apart go forward, and two fingers that move together go back. */
export class UniversePinch {
  private lastDistance: number | null = null;

  /** Gives the move for the new finger positions, or null when the distance did not change enough. */
  update(points: readonly { x: number; y: number }[]): { move: UniverseMove; multiplier: number } | null {
    if (points.length < 2) { this.lastDistance = null; return null; }
    const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
    if (this.lastDistance === null) { this.lastDistance = distance; return null; }
    const change = distance - this.lastDistance;
    if (Math.abs(change) < PINCH_STEP_PX) return null;
    this.lastDistance = distance;
    return { move: change > 0 ? "forward" : "back", multiplier: Math.min(4, Math.abs(change) / 24) };
  }

  reset(): void {
    this.lastDistance = null;
  }
}
