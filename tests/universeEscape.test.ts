import assert from "node:assert/strict";
import { EXIT_CONFIRM_WINDOW_MS, ExitConfirmation, universeEscapeAction } from "../src/universe/universeEscape.ts";

// Order of one Escape press: inspector, then flight, then the exit confirmation.
assert.equal(universeEscapeAction({ inspectorOpen: true, flying: true }), "close-inspector");
assert.equal(universeEscapeAction({ inspectorOpen: true, flying: false }), "close-inspector");
assert.equal(universeEscapeAction({ inspectorOpen: false, flying: true }), "stop-flight");
assert.equal(universeEscapeAction({ inspectorOpen: false, flying: false }), "confirm-exit");

// The exit needs a second press in 2 s.
{
  let time = 1_000;
  const confirmation = new ExitConfirmation(EXIT_CONFIRM_WINDOW_MS, () => time);
  assert.equal(EXIT_CONFIRM_WINDOW_MS, 2_000);
  assert.equal(confirmation.armed, false);
  assert.equal(confirmation.press(), false, "the first press only arms the exit");
  assert.equal(confirmation.armed, true);
  time += 1_999;
  assert.equal(confirmation.press(), true, "a second press in the window exits");
  assert.equal(confirmation.armed, false);

  // A press after the window is a first press again.
  assert.equal(confirmation.press(), false);
  time += 2_001;
  assert.equal(confirmation.armed, false);
  assert.equal(confirmation.press(), false);
  time += 500;
  assert.equal(confirmation.press(), true);

  // A different action between the two presses cancels the confirmation.
  assert.equal(confirmation.press(), false);
  confirmation.reset();
  assert.equal(confirmation.press(), false);
}

console.log("universe escape tests passed");
