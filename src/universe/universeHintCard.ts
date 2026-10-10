type Translate = (key: string) => string;

export type HintCardOptions = {
  card: HTMLElement;
  text: HTMLElement;
  closeButton: HTMLButtonElement;
  translate: Translate;
  /** True when the main pointer is a finger. The card then shows the touch gestures. */
  coarsePointer?: () => boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

const SEEN_KEY = "cosmic-atlas:universe-hint-seen";

/**
 * The card that shows the flight controls at the first entry into the 3D view.
 * The user closes it one time, and it does not show again.
 */
export class UniverseHintCard {
  constructor(private readonly options: HintCardOptions) {
    options.closeButton.addEventListener("click", () => this.dismiss());
    window.addEventListener("cosmic-atlas:locale-change", () => this.setText());
  }

  showOnce(): void {
    if (this.seen()) return;
    this.setText();
    this.options.card.hidden = false;
  }

  hide(): void {
    this.options.card.hidden = true;
  }

  private dismiss(): void {
    this.hide();
    try { (this.options.storage ?? window.localStorage).setItem(SEEN_KEY, "1"); } catch { /* Private mode: the card shows again next time. */ }
  }

  private seen(): boolean {
    try { return (this.options.storage ?? window.localStorage).getItem(SEEN_KEY) === "1"; } catch { return false; }
  }

  private setText(): void {
    const coarse = this.options.coarsePointer?.() ?? window.matchMedia("(pointer: coarse)").matches;
    this.options.text.textContent = this.options.translate(coarse ? "universe3d.hintTouch" : "universe3d.hintKeys");
  }
}

const MINIMAP_KEY = "cosmic-atlas:universe-minimap";

/** The trip map has a button that hides its drawing. The choice stays for the next visit. */
export function bindMinimapToggle(panel: HTMLElement, button: HTMLButtonElement, translate: Translate): void {
  const read = () => { try { return window.localStorage.getItem(MINIMAP_KEY) === "collapsed"; } catch { return false; } };
  const show = (collapsed: boolean) => {
    panel.dataset.collapsed = String(collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    const label = translate(collapsed ? "universe3d.minimapShow" : "universe3d.minimapHide");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = collapsed ? "+" : "−";
  };
  button.addEventListener("click", () => {
    const collapsed = panel.dataset.collapsed !== "true";
    try { window.localStorage.setItem(MINIMAP_KEY, collapsed ? "collapsed" : "open"); } catch { /* The choice is for this visit only. */ }
    show(collapsed);
  });
  window.addEventListener("cosmic-atlas:locale-change", () => show(panel.dataset.collapsed === "true"));
  show(read());
}
