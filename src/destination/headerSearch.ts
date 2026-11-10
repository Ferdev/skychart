type HeaderSearchOptions = {
  /** The search field of the header. */
  field: HTMLInputElement;
  /** The search field of the Search panel. It does the search. */
  panelField: HTMLInputElement;
  /** Opens the Search panel and puts the focus in its field. */
  openSearch: () => void;
  /** False while a full-screen view (Sky, 3D) or the embed frame has the keyboard. */
  shortcutsEnabled: () => boolean;
};

/**
 * The header search field opens the Search panel: by a click, by text, by the `/` key, and by Ctrl+K (Cmd+K).
 * Text that the user types in the header field moves to the field of the panel.
 * Text of an input method (Japanese, Chinese, Korean) moves when the composition ends.
 */
export function bindHeaderSearch(options: HeaderSearchOptions): void {
  const { field, panelField } = options;

  const moveTextToPanel = () => {
    const text = field.value;
    field.value = "";
    options.openSearch();
    if (!text) return;
    panelField.value = text;
    panelField.setSelectionRange(text.length, text.length);
    panelField.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // An input method (IME) composes a word in the field. The word moves to the panel when it is complete.
  field.addEventListener("input", (event) => {
    if ((event as InputEvent).isComposing) return;
    moveTextToPanel();
  });
  field.addEventListener("compositionend", moveTextToPanel);
  field.addEventListener("keydown", (event) => {
    // Enter during a composition selects the word of the input method.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    event.preventDefault();
    options.openSearch();
  });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !options.shortcutsEnabled()) return;
    const commandK = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!commandK && !slash) return;
    // "/" is text in a field. Ctrl+K works from each place.
    if (slash && (isTextEntry(event.target) || document.querySelector("dialog[open]"))) return;
    event.preventDefault();
    options.openSearch();
    panelField.select();
  });
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit"].includes(target.type);
}
