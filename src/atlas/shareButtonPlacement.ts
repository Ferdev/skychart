import { keepPopoverNear } from "./popoverPlacement";
import { compactWindowQuery } from "./windowLayout";

type ShareButtonPlacementOptions = {
  /** The element that holds the Share button. */
  control: HTMLElement;
  button: HTMLButtonElement;
  popover: HTMLElement;
  /** Place of the Share button on a wide window: the toolbar row, next to Settings. */
  toolbarSlot: HTMLElement;
  /** Place of the Share button on a compact window: the header row. */
  headerSlot: HTMLElement;
};

/**
 * The Share button is part of the layout (toolbar or header), not a fixed button in a corner,
 * so that it cannot sit on top of a panel. Its popover opens next to it.
 */
export function bindShareButtonPlacement(options: ShareButtonPlacementOptions): void {
  const narrow = compactWindowQuery();
  const place = () => {
    const slot = narrow.matches ? options.headerSlot : options.toolbarSlot;
    if (options.control.parentElement !== slot) slot.append(options.control);
    // The slot with no button takes no cell in its row.
    options.toolbarSlot.hidden = slot !== options.toolbarSlot;
    options.headerSlot.hidden = slot !== options.headerSlot;
  };
  narrow.addEventListener("change", place);
  place();
  keepPopoverNear(options.popover, () => options.button, () => narrow.matches ? "below" : "above");
}
