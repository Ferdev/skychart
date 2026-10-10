import type { ScreenPoint } from "../geometry";

/** Time that the mark stays on the screen after the map centre changes. */
const VISIBLE_AFTER_MOVE_MS = 2_000;

/**
 * The `3D` mark shows where 3D mode starts: at the map centre.
 * It shows only when the user needs it: while the 3D button has hover or focus, and for 2 s after the map
 * centre changes. It does not show on top of a selected object at the centre.
 * It is a page element, not canvas ink, so image exports stay clean.
 */
export class UniverseEntryMarker {
  private buttonActive = false;
  private lastCenterKey: string | null = null;
  private visibleUntil = 0;
  private hideTimer: number | null = null;
  private selectedAtCenter = false;

  constructor(private readonly marker: HTMLElement, button: HTMLElement) {
    const setActive = (active: boolean) => {
      this.buttonActive = active;
      this.apply();
    };
    button.addEventListener("pointerenter", () => setActive(true));
    button.addEventListener("pointerleave", () => setActive(button.matches(":focus-visible")));
    button.addEventListener("focus", () => setActive(true));
    button.addEventListener("blur", () => setActive(false));
  }

  /** Call for each frame with the screen position of the map centre. `centerKey` changes when the map centre changes. */
  place(center: ScreenPoint, centerKey: string, selectedAtCenter: boolean): void {
    this.marker.style.transform = `translate(${center.x - 22}px, ${center.y - 22}px)`;
    this.selectedAtCenter = selectedAtCenter;
    if (this.lastCenterKey !== null && this.lastCenterKey !== centerKey) {
      this.visibleUntil = performance.now() + VISIBLE_AFTER_MOVE_MS;
      if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = null;
        this.apply();
      }, VISIBLE_AFTER_MOVE_MS + 20);
    }
    this.lastCenterKey = centerKey;
    this.apply();
  }

  private apply(): void {
    const visible = !this.selectedAtCenter && (this.buttonActive || performance.now() < this.visibleUntil);
    if (this.marker.hidden === visible) this.marker.hidden = !visible;
  }
}
