import assert from "node:assert/strict";
import { isMajorSolarBody, observerApparentMagnitude, rankUniverseLabels } from "../src/universe/universePhotometry.ts";

const origin = { x: 0, y: 0, z: 0 };
const near = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-8, `${actual} ≈ ${expected}`);
};

near(observerApparentMagnitude({ key: "sun", position: origin }, { x: 1, y: 0, z: 0 }), -26.74);
near(observerApparentMagnitude({ key: "sun", position: origin }, { x: 10, y: 0, z: 0 }), -21.74);
near(observerApparentMagnitude({ key: "mars", position: { x: 1, y: 0, z: 0 } }, origin), -1.52);
assert.ok(observerApparentMagnitude({ key: "mars", position: { x: 1, y: 0, z: 0 } },
  { x: 2, y: 0, z: 0 })! > 10, "the unlit side is much fainter");
near(observerApparentMagnitude({ key: "star", object_type: "star", position: { x: 100, y: 0, z: 0 },
  apparent_magnitude: 5 }, { x: 90, y: 0, z: 0 }), 0);
near(observerApparentMagnitude({ key: "asteroid", position: { x: 2, y: 0, z: 0 },
  absoluteMagnitudeH: 10 }, origin), 10 + 5 * Math.log10(4));
assert.equal(observerApparentMagnitude({ key: "unknown", position: { x: 1, y: 0, z: 0 } }, origin), null);
assert.equal(isMajorSolarBody({ key: "earth", position: origin }), true);
assert.equal(isMajorSolarBody({ key: "sirius", position: origin }), false);

const label = (key: string, object_type: string, magnitude: number | null, distance: number) => ({
  point: { key, object_type, position: { x: distance, y: 0, z: 0 } }, magnitude, distance,
});
const candidates = [
  label("faint-star", "star", 12, 10), label("bright-star", "star", 1, 100),
  label("near-galaxy", "galaxy", 15, 1000), label("mars", "planet", 9, 2),
  label("selected", "nebula", null, 900), label("faint-nebula", "nebula", 12, 200),
];
assert.deepEqual(rankUniverseLabels(candidates, origin, "selected").map((hit) => hit.point.key),
  ["selected", "mars", "bright-star", "faint-star", "near-galaxy"]);
assert.deepEqual(rankUniverseLabels(candidates, { x: 1000, y: 0, z: 0 }).map((hit) => hit.point.key),
  ["bright-star"]);

console.log("universe photometry tests passed");
