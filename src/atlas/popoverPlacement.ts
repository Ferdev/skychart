/**
 * Puts an open popover next to the control that opened it, and keeps it inside the window.
 * The popover must have `position: fixed` and `inset: auto`.
 */
export function placePopoverNear(popover: HTMLElement, anchor: HTMLElement, preferred: "below" | "above" = "below"): void {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const maximumLeft = Math.max(margin, window.innerWidth - width - margin);
  const left = Math.min(maximumLeft, Math.max(margin, rect.left + rect.width / 2 - width / 2));
  const below = rect.bottom + margin;
  const above = rect.top - height - margin;
  const fitsBelow = below + height <= window.innerHeight - margin;
  const fitsAbove = above >= margin;
  const top = preferred === "below"
    ? fitsBelow || !fitsAbove ? below : above
    : fitsAbove || !fitsBelow ? above : below;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(Math.max(margin, Math.min(top, window.innerHeight - height - margin)))}px`;
}

/** Places the popover each time it opens, and again when the window size changes while it is open. */
export function keepPopoverNear(popover: HTMLElement, anchor: () => HTMLElement, preferred: () => "below" | "above"): void {
  const place = () => {
    if (popover.matches(":popover-open")) placePopoverNear(popover, anchor(), preferred());
  };
  popover.addEventListener("toggle", place);
  window.addEventListener("resize", place);
}
