import { compactWindowQuery } from "./windowLayout";

type LocaleControlPlacementOptions = {
  /** The language menu with its label. */
  control: HTMLElement;
  /** The header card. On a wide window the language menu is in its first row. */
  header: HTMLElement;
  /** The tools of the header card. The language menu is before them in the document. */
  headerTools: HTMLElement;
  /** Place of the language menu on a compact window: a row in Settings. */
  settingsSlot: HTMLElement;
};

/**
 * On a compact window the header card is one row of tools, so that it covers little of the map.
 * The language menu is then a row in Settings.
 */
export function bindLocaleControlPlacement(options: LocaleControlPlacementOptions): void {
  const compact = compactWindowQuery();
  const place = () => {
    if (compact.matches) {
      if (options.control.parentElement !== options.settingsSlot) options.settingsSlot.append(options.control);
    } else if (options.control.parentElement !== options.header) {
      options.header.insertBefore(options.control, options.headerTools);
    }
    options.settingsSlot.hidden = !compact.matches;
  };
  compact.addEventListener("change", place);
  place();
}
