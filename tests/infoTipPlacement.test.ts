import assert from "node:assert/strict";
import { test } from "node:test";
import { placeInfoTip } from "../src/atlas/infoTipPlacement.ts";

const tip = { width: 260, height: 80 };
const button = { left: 300, top: 400, width: 20, height: 20 };

test("the help text goes to the right side of the panel when there is room", () => {
  const placed = placeInfoTip({ button, tip, panel: { left: 16, top: 100, width: 360, height: 600 }, viewport: { width: 1440, height: 900 } });
  assert.equal(placed.side, "right");
  assert.equal(placed.left, 16 + 360 + 8);
  assert.equal(placed.top, 400 + 10 - 40);
});

test("the help text goes to the left side when the right side has no room", () => {
  const placed = placeInfoTip({ button: { ...button, left: 1300 }, tip, panel: { left: 1060, top: 100, width: 364, height: 600 }, viewport: { width: 1440, height: 900 } });
  assert.equal(placed.side, "left");
  assert.equal(placed.left, 1060 - 8 - 260);
});

test("on a narrow window the help text goes above the button and does not cover the next row", () => {
  const placed = placeInfoTip({ button: { ...button, left: 340 }, tip, panel: { left: 8, top: 100, width: 374, height: 600 }, viewport: { width: 390, height: 844 } });
  assert.equal(placed.side, "above");
  assert.ok(placed.top + tip.height <= button.top);
  assert.ok(placed.left >= 12 && placed.left + tip.width <= 390 - 12);
});

test("the help text goes below the button only when there is no room above", () => {
  const placed = placeInfoTip({ button: { ...button, top: 30 }, tip, panel: null, viewport: { width: 390, height: 844 } });
  assert.equal(placed.side, "below");
  assert.equal(placed.top, 30 + 20 + 8);
});

test("the help text stays inside the window", () => {
  const placed = placeInfoTip({ button: { ...button, top: 880 }, tip, panel: { left: 16, top: 100, width: 360, height: 790 }, viewport: { width: 1440, height: 900 } });
  assert.ok(placed.top + tip.height <= 900 - 12);
});
