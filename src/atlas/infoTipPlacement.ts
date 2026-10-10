/**
 * Position of the help text of an info button.
 *
 * The text goes to the side of the panel that has the button, so that it does not cover the panel.
 * When no side has room (a phone), the text goes above the button, or below it when there is no room above.
 */

export type TipRect = { left: number; top: number; width: number; height: number };

export type InfoTipPlacementInput = {
  button: TipRect;
  tip: { width: number; height: number };
  /** The panel that has the button, or null when the button is not in a panel. */
  panel: TipRect | null;
  viewport: { width: number; height: number };
  gutter?: number;
  gap?: number;
};

export type InfoTipPlacement = { left: number; top: number; side: "right" | "left" | "above" | "below" };

export function placeInfoTip(input: InfoTipPlacementInput): InfoTipPlacement {
  const { button, tip, panel, viewport } = input;
  const gutter = input.gutter ?? 12;
  const gap = input.gap ?? 8;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));
  const centredTop = clamp(button.top + button.height / 2 - tip.height / 2, gutter, viewport.height - tip.height - gutter);
  if (panel) {
    const right = panel.left + panel.width + gap;
    if (right + tip.width <= viewport.width - gutter) return { left: right, top: centredTop, side: "right" };
    const left = panel.left - gap - tip.width;
    if (left >= gutter) return { left, top: centredTop, side: "left" };
  }
  const centredLeft = clamp(button.left + button.width / 2 - tip.width / 2, gutter, viewport.width - tip.width - gutter);
  const above = button.top - tip.height - gap;
  if (above >= gutter) return { left: centredLeft, top: above, side: "above" };
  return { left: centredLeft, top: Math.min(button.top + button.height + gap, Math.max(gutter, viewport.height - tip.height - gutter)), side: "below" };
}
