/**
 * The one sans-serif stack of the interface, for canvas text (docs/ui-style.md).
 * `--font-sans` in src/styles/foundations.css has the same value; a guard test compares the two.
 */
export const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A canvas `font` value in the interface font, for example `canvasFont(12, 600)`. */
export function canvasFont(sizePx: number, weight: number | string = 400): string {
  return `${weight} ${sizePx}px ${FONT_SANS}`;
}
