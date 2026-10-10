import assert from "node:assert/strict";
import { test } from "node:test";
import { joystickMoves, UniversePinch } from "../src/universe/universeTouchControls.ts";

test("the joystick gives no move in its dead zone", () => {
  assert.deepEqual(joystickMoves(0, 0), []);
  assert.deepEqual(joystickMoves(0.2, -0.2), []);
});

test("the joystick gives one or two moves for a direction", () => {
  assert.deepEqual(joystickMoves(0, -1), ["forward"]);
  assert.deepEqual(joystickMoves(0, 1), ["back"]);
  assert.deepEqual(joystickMoves(-1, 0), ["left"]);
  assert.deepEqual(joystickMoves(1, 0), ["right"]);
  assert.deepEqual(joystickMoves(0.7, -0.7), ["forward", "right"]);
});

test("fingers that move apart go forward and fingers that move together go back", () => {
  const pinch = new UniversePinch();
  assert.equal(pinch.update([{ x: 0, y: 0 }, { x: 100, y: 0 }]), null);
  assert.equal(pinch.update([{ x: 0, y: 0 }, { x: 103, y: 0 }]), null);
  assert.equal(pinch.update([{ x: 0, y: 0 }, { x: 148, y: 0 }])?.move, "forward");
  assert.equal(pinch.update([{ x: 0, y: 0 }, { x: 100, y: 0 }])?.move, "back");
  pinch.reset();
  assert.equal(pinch.update([{ x: 0, y: 0 }, { x: 40, y: 0 }]), null);
  assert.equal(pinch.update([{ x: 0, y: 0 }]), null);
});
