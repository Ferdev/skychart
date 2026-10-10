type ViewEscapeKeyOptions = {
  /** The full-screen view (Sky or 3D) is open. */
  active: () => boolean;
  /** The canvas of the view. It has its own key listener. */
  canvas: HTMLElement;
  /** The Escape rule of the view. */
  escape: () => void;
};

/** The focus is in a control that uses the Escape key for itself. */
function keepsEscape(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable]") !== null;
}

/**
 * The Escape rule of a full-screen view also applies when the focus is on one of its buttons or in the
 * object inspector. An open dialog or popover, and a text field, keep the key.
 */
export function bindViewEscapeKey(options: ViewEscapeKeyOptions): void {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !options.active()) return;
    if (event.target === options.canvas || keepsEscape(event.target)) return;
    if (document.querySelector("dialog[open], [popover]:popover-open")) return;
    event.preventDefault();
    options.escape();
  });
}
