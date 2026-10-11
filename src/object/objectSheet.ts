type ObjectSheetOptions = {
  /** The panel that is a bottom sheet on a compact window. */
  panel: HTMLElement;
  /** The Details button in the row of object actions. */
  toggle: HTMLButtonElement;
  /** The areas that take a swipe: the grip of the sheet and the inspector header. */
  swipeAreas: readonly HTMLElement[];
  /** The sheet has a different height, so the map has a different free area. */
  changed: (expanded: boolean) => void;
};

export type ObjectSheet = {
  expanded(): boolean;
  setExpanded(expanded: boolean): void;
};

/** A swipe shorter than this is a tap. */
const SWIPE_DISTANCE_PX = 24;

/**
 * On a compact window the inspector is a bottom sheet. It opens as a short card with the name and the
 * actions of the object, so that the map stays in view. The Details button, or a swipe up, shows all data.
 * The style sheet uses the state only where the panel is a sheet.
 */
export function bindObjectSheet(options: ObjectSheetOptions): ObjectSheet {
  let expanded = false;
  const show = () => {
    options.panel.dataset.sheet = expanded ? "open" : "peek";
    options.toggle.setAttribute("aria-expanded", String(expanded));
  };
  const setExpanded = (next: boolean) => {
    if (next === expanded) return;
    expanded = next;
    show();
    options.changed(expanded);
  };
  options.toggle.addEventListener("click", () => setExpanded(!expanded));

  for (const area of options.swipeAreas) {
    let start: { id: number; y: number } | null = null;
    area.addEventListener("pointerdown", (event) => {
      start = event.isPrimary ? { id: event.pointerId, y: event.clientY } : null;
    });
    area.addEventListener("pointerup", (event) => {
      if (!start || start.id !== event.pointerId) return;
      const distance = event.clientY - start.y;
      start = null;
      // The Details button shows only where the panel is a sheet. In other layouts a drag on the header does nothing.
      if (options.toggle.offsetParent === null) return;
      if (Math.abs(distance) >= SWIPE_DISTANCE_PX) setExpanded(distance < 0);
    });
    area.addEventListener("pointercancel", () => { start = null; });
  }
  show();
  return { expanded: () => expanded, setExpanded };
}
