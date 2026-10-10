import assert from "node:assert/strict";
import { test } from "node:test";
import { isSkyLabelCandidate, rankSkyLabelCandidates, SKY_DETAIL_FOV_DEG, skyLabelLimit } from "../src/sky/skyLabels.ts";
import type { RenderedHit, SkyPoint } from "../src/sky/skyPoint.ts";
import { universeLabelLimit } from "../src/universe/universeLabelLimit.ts";

function point(key: string, name: string, objectType: string, magnitude: number | null, dynamic = false): SkyPoint {
  return { key, name, object_type: objectType, apparent_magnitude: magnitude, dynamic, direction: [1, 0, 0] };
}
const hit = (skyPoint: SkyPoint): RenderedHit => ({ point: skyPoint, x: 0, y: 0, radius: 2 });

const sun = point("sun", "Sun", "star", -26.7, true);
const jupiter = point("jupiter", "Jupiter", "planet", -2.2, true);
const sirius = point("hip-32349", "Sirius", "star", -1.46);
const faintNamedStar = point("hip-1", "Alrescha", "star", 5.2);
const vesta = point("vesta", "Vesta", "asteroid", 6.1, true);
const designation = point("hip-10234", "HIP 10234", "star", 4.0);
const wide = { fovDeg: 72, selectedKey: null };
const smallest = { fovDeg: SKY_DETAIL_FOV_DEG, selectedKey: null };

test("the label limit is 28, and 12 on a narrow screen", () => {
  assert.equal(skyLabelLimit(1440), 28);
  assert.equal(skyLabelLimit(521), 28);
  assert.equal(skyLabelLimit(520), 12);
  assert.equal(skyLabelLimit(390), 12);
});

test("the 3D label limit is 30, and 12 on a narrow screen", () => {
  assert.equal(universeLabelLimit(1440), 30);
  assert.equal(universeLabelLimit(641), 30);
  assert.equal(universeLabelLimit(640), 12);
  assert.equal(universeLabelLimit(390), 12);
});

test("the Sun, the planets, and bright named objects are candidates at each field of view", () => {
  for (const rule of [wide, smallest]) {
    assert.equal(isSkyLabelCandidate(sun, rule), true);
    assert.equal(isSkyLabelCandidate(jupiter, rule), true);
    assert.equal(isSkyLabelCandidate(sirius, rule), true);
  }
});

test("a small body or a catalog designation is a candidate only at the smallest field of view or when it is selected", () => {
  assert.equal(isSkyLabelCandidate(vesta, wide), false);
  assert.equal(isSkyLabelCandidate(designation, wide), false);
  assert.equal(isSkyLabelCandidate(faintNamedStar, wide), false, "a faint star has no label in a wide view");
  // The smallest field of view of the camera is the detail view. The rule must apply there.
  assert.equal(isSkyLabelCandidate(vesta, smallest), true);
  assert.equal(isSkyLabelCandidate(designation, smallest), true);
  assert.equal(isSkyLabelCandidate(faintNamedStar, smallest), true);
  assert.equal(isSkyLabelCandidate(vesta, { fovDeg: SKY_DETAIL_FOV_DEG + 1, selectedKey: null }), false);
  assert.equal(isSkyLabelCandidate(designation, { fovDeg: 72, selectedKey: "hip-10234" }), true);
  assert.equal(isSkyLabelCandidate(vesta, { fovDeg: 72, selectedKey: "vesta" }), true);
});

test("the order is: selected object, Sun and planets, named objects by magnitude, small bodies, designations", () => {
  const ranked = rankSkyLabelCandidates([designation, vesta, faintNamedStar, sirius, jupiter, sun].map(hit), smallest).map((entry) => entry.point.name);
  assert.deepEqual(ranked, ["Sun", "Jupiter", "Sirius", "Alrescha", "Vesta", "HIP 10234"]);
  const withSelection = rankSkyLabelCandidates([sirius, sun, designation].map(hit), { fovDeg: 72, selectedKey: "hip-10234" }).map((entry) => entry.point.name);
  assert.deepEqual(withSelection, ["HIP 10234", "Sun", "Sirius"]);
});
