/**
 * A compact window is narrow (a phone, or a tablet in portrait) or short (a phone in landscape).
 * The style sheets use the same condition for the compact layout: a header card of one row,
 * a toolbar across the bottom, and a panel that is a sheet or a side panel.
 */
export const COMPACT_WINDOW = "(max-width: 899px), (max-height: 560px)";

let compactWindow: MediaQueryList | null = null;

export function compactWindowQuery(): MediaQueryList {
  compactWindow ??= window.matchMedia(COMPACT_WINDOW);
  return compactWindow;
}

export function isCompactWindow(): boolean {
  return compactWindowQuery().matches;
}
