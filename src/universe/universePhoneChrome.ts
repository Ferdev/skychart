type Translate = (key: string) => string;

/** A phone in portrait. The 3D style sheet uses the same condition. */
export const PHONE_PORTRAIT = "(max-width: 640px)";

export type UniverseMoreMenuOptions = {
  /** The `More` button of the header. The style sheet shows it on a phone in portrait only. */
  toggle: HTMLButtonElement;
  menu: HTMLElement;
  /** The place in the menu for the texts that have no room in the view on a phone. */
  notesSlot: HTMLElement;
  /** Each text with its place on a wider window. The text is the last element of that place. */
  notes: readonly { note: HTMLElement; home: HTMLElement }[];
  /** The focus goes back to the view when the menu closes after an action. */
  canvas: HTMLElement;
};

/**
 * On a phone in portrait the 3D header is one row. `Reset flight`, the trip map switch, the position text,
 * and the data disclosure are then in the `More` menu, so that the controls cover little of the view.
 */
export function bindUniverseMoreMenu(options: UniverseMoreMenuOptions): void {
  const { toggle, menu } = options;
  const phone = window.matchMedia(PHONE_PORTRAIT);
  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const setOpen = (open: boolean) => toggle.setAttribute("aria-expanded", String(open));
  const place = () => {
    setOpen(false);
    for (const { note, home } of options.notes) {
      const parent = phone.matches ? options.notesSlot : home;
      if (note.parentElement !== parent) parent.append(note);
    }
  };
  toggle.addEventListener("click", () => setOpen(!isOpen()));
  // An action of the menu closes it. A link (the image credits) opens a new tab, and the menu stays.
  menu.addEventListener("click", (event) => {
    if (!isOpen() || !(event.target instanceof Element) || !event.target.closest("button")) return;
    setOpen(false);
    options.canvas.focus({ preventScroll: true });
  });
  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && event.target instanceof Node && !menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  }, true);
  // Escape closes the open menu only. It does not stop the flight, and it does not start the exit.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle.focus({ preventScroll: true });
  }, true);
  phone.addEventListener("change", place);
  place();
}

/**
 * On a phone the target card is short: the name, the distance, `Fly there`, and `Details`.
 * The button shows the other actions and the brightness. On a wider window the card always shows all.
 */
export function bindTargetCardToggle(card: HTMLElement, button: HTMLButtonElement, translate: Translate): void {
  const show = (expanded: boolean) => {
    card.dataset.expanded = String(expanded);
    button.setAttribute("aria-expanded", String(expanded));
    const label = translate(expanded ? "universe3d.targetLess" : "universe3d.targetMore");
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  button.addEventListener("click", () => show(card.dataset.expanded !== "true"));
  window.addEventListener("cosmic-atlas:locale-change", () => show(card.dataset.expanded === "true"));
  show(false);
}
