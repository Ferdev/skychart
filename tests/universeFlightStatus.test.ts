import assert from "node:assert/strict";
import { test } from "node:test";
import { brightnessGroup, brightnessGroupKey } from "../src/universe/universeBrightness.ts";
import { autopilotControlState, isAtTarget, isAtViewingDistance, StatusMessageHold } from "../src/universe/universeFlightStatus.ts";

test("with no target the autopilot button says that it cruises forward", () => {
  assert.deepEqual(autopilotControlState({ hasTarget: false, active: false, atTarget: false }),
    { labelKey: "universe3d.cruiseForward", disabled: false, noteKey: null });
  assert.deepEqual(autopilotControlState({ hasTarget: false, active: true, atTarget: false }),
    { labelKey: "universe3d.autopilotStop", disabled: false, noteKey: "universe3d.cruisingNoDestination" });
});

test("with a target the autopilot flies to it, and at the target it has nothing to do", () => {
  assert.deepEqual(autopilotControlState({ hasTarget: true, active: false, atTarget: false }),
    { labelKey: "universe3d.autopilotStart", disabled: false, noteKey: null });
  assert.equal(autopilotControlState({ hasTarget: true, active: false, atTarget: true }).disabled, true);
  // A running autopilot can always be stopped.
  assert.equal(autopilotControlState({ hasTarget: true, active: true, atTarget: true }).disabled, false);
  assert.equal(autopilotControlState({ hasTarget: true, active: true, atTarget: false }).noteKey, null);
});

test("the craft is at the target inside the standoff distance with a small margin", () => {
  assert.equal(isAtTarget(1, 1), true);
  assert.equal(isAtTarget(1.0009, 1), true);
  assert.equal(isAtTarget(1.01, 1), false);
  assert.equal(isAtTarget(0, 0), false);
  assert.equal(isAtTarget(Number.NaN, 1), false);
});

test("a jump has a use inside the standoff distance, and no use at that distance", () => {
  assert.equal(isAtViewingDistance(1, 1), true);
  assert.equal(isAtViewingDistance(1.0005, 1), true);
  assert.equal(isAtViewingDistance(0.5, 1), false);
  assert.equal(isAtViewingDistance(2, 1), false);
  assert.equal(isAtViewingDistance(0, 0), false);
});

test("an arrival message stays for four seconds", () => {
  let now = 1_000;
  const hold = new StatusMessageHold(() => now);
  assert.equal(hold.canReplace(), true);
  hold.hold();
  now += 3_999;
  assert.equal(hold.canReplace(), false);
  now += 1;
  assert.equal(hold.canReplace(), true);
  hold.hold();
  hold.release();
  assert.equal(hold.canReplace(), true);
});

test("a magnitude has a plain word group", () => {
  assert.equal(brightnessGroup(-26.7), "brighterThanFullMoon");
  assert.equal(brightnessGroup(-12.7), "nakedEye");
  assert.equal(brightnessGroup(-1.5), "nakedEye");
  assert.equal(brightnessGroup(6), "nakedEye");
  assert.equal(brightnessGroup(6.1), "binoculars");
  assert.equal(brightnessGroup(10), "binoculars");
  assert.equal(brightnessGroup(14.2), "telescope");
  assert.equal(brightnessGroupKey(3), "universe3d.brightness.nakedEye");
});
