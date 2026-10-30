import assert from "node:assert/strict";
import { test } from "node:test";
import { moveStep, stepViewKey } from "../src/community/tourSteps.ts";
import { decodeViewState, encodeViewState } from "../src/viewState.ts";

const base = { center: { x: 1, y: 2 }, zoom: 24, time: "2026-10-30T12:00:00.000Z", layers: { grid: true } };
const sky = { observerKey: "earth", yawDeg: 10, pitchDeg: 5, fovDeg: 40, constellations: true, hiddenObjectTypes: [] };
const universe = { positionAu: { x: 1, y: 2, z: 3 }, yawDeg: 1, pitchDeg: 2, fovDeg: 60, moveStepAu: 1 };

test("the captured state of a map, Sky, and 3D view opens as a tour step", () => {
  for (const [view, key] of [[base, "map"], [{ ...base, sky }, "sky"], [{ ...base, universe }, "universe"]] as const) {
    const state = encodeViewState({ ...view, tour: undefined, step: undefined });
    const decoded = decodeViewState(state);
    assert.ok(decoded);
    assert.equal(decoded.time, base.time);
    assert.equal(decoded.tour, undefined);
    assert.equal(stepViewKey(state), `community.tours.view.${key}`);
  }
});

test("a step moves up and down and stays in the list", () => {
  assert.deepEqual(moveStep(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveStep(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveStep(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(moveStep(["a", "b"], 1, 1), ["a", "b"]);
});
