import assert from "node:assert/strict";
import { isUnresolvedSeparation, pickBody, pickMapTarget, type BodyPickHit, UNRESOLVED_SEPARATION_PX } from "../src/rendering/bodyPick.ts";

function hit(key: string, parentKey: string | null, x: number, y: number, pointer: { x: number; y: number }, priority: number): BodyPickHit {
  return { key, parentKey, x, y, distancePx: Math.hypot(x - pointer.x, y - pointer.y), priority };
}

const PLANET = 70;
const MOON = 42;
const STAR = 36;
const DEEP_SKY = 20;

assert.equal(pickBody([]), null);
assert.equal(UNRESOLVED_SEPARATION_PX, 6);
assert.equal(isUnresolvedSeparation({ x: 0, y: 0 }, { x: 5.9, y: 0 }), true);
assert.equal(isUnresolvedSeparation({ x: 0, y: 0 }, { x: 6, y: 0 }), false);

// A planet and its moons at the same pixel: the planet wins, also when a moon is nearer to the pointer.
{
  const pointer = { x: 100.4, y: 100 };
  const saturn = hit("saturn", "sun", 100, 100, { x: 103, y: 100 }, PLANET);
  const titan = hit("titan", "saturn", 100.4, 100, pointer, MOON);
  const iapetus = hit("iapetus", "saturn", 101, 100.5, pointer, MOON);
  assert.equal(pickBody([titan, iapetus, saturn])?.key, "saturn");
  assert.equal(pickBody([saturn, titan])?.key, "saturn");
}

// A moon that is resolved from its planet can be selected when only the moon is below the pointer.
{
  const pointer = { x: 140, y: 100 };
  assert.equal(pickBody([hit("iapetus", "saturn", 141, 100, pointer, MOON)])?.key, "iapetus");
}

// A resolved moon and its planet below the same pointer: the type rank decides.
{
  const pointer = { x: 106, y: 100 };
  const saturn = hit("saturn", "sun", 100, 100, pointer, PLANET);
  const titan = hit("titan", "saturn", 107, 100, pointer, MOON);
  assert.equal(pickBody([titan, saturn])?.key, "saturn");
}

// Two bodies with no relation: the higher rank is first, then the nearer marker.
{
  const pointer = { x: 50, y: 50 };
  const star = hit("sirius", null, 53, 50, pointer, STAR);
  const galaxy = hit("m31", null, 50.5, 50, pointer, DEEP_SKY);
  assert.equal(pickBody([galaxy, star])?.key, "sirius");
  const nearStar = hit("vega", null, 51, 50, pointer, STAR);
  assert.equal(pickBody([star, nearStar])?.key, "vega");
  assert.equal(pickBody([nearStar, star])?.key, "vega");
}

// A selected moon stays on the map when it is not resolved. A click at that pixel selects the planet.
{
  const pointer = { x: 200, y: 200 };
  const mars = hit("mars", "sun", 200, 200, pointer, PLANET);
  const phobos = hit("phobos", "mars", 200.1, 200, pointer, MOON);
  assert.equal(pickBody([phobos, mars])?.key, "mars");
}

// The rule follows the full ancestor chain, and a parent that is not below the pointer does not matter.
{
  const pointer = { x: 10, y: 10 };
  const sun = hit("sun", null, 10, 10, pointer, 80);
  const earth = hit("earth", "sun", 11, 10, pointer, PLANET);
  const moon = hit("moon", "earth", 12, 10, pointer, MOON);
  assert.equal(pickBody([moon, earth, sun])?.key, "sun");
  assert.equal(pickBody([moon, earth])?.key, "earth");
  assert.equal(pickBody([moon])?.key, "moon");
}

// A parent loop in the data does not stop the function.
{
  const pointer = { x: 0, y: 0 };
  const a = hit("a", "b", 0, 0, pointer, 20);
  const b = hit("b", "a", 20, 0, pointer, 20);
  assert.equal(pickBody([a, b])?.key, "a");
}

console.log("body pick tests passed");

// The pointer directly on a marker selects that marker, also below the label of a different object.
assert.deepEqual(pickMapTarget({ marker: { body: "iapetus", distancePx: 2 }, labelled: "saturn", catalogPointDistancePx: null }), { body: "iapetus", distancePx: 2 });
// A label is first when the pointer is not directly on a marker.
assert.deepEqual(pickMapTarget({ marker: { body: "io", distancePx: 9 }, labelled: "jupiter", catalogPointDistancePx: 1 }), { body: "jupiter", distancePx: 0 });
assert.deepEqual(pickMapTarget({ marker: null, labelled: "jupiter", catalogPointDistancePx: null }), { body: "jupiter", distancePx: 0 });
// A catalog point that is nearer than the marker is the selection: the result has no body.
assert.equal(pickMapTarget({ marker: { body: "sun", distancePx: 8.7 }, labelled: null, catalogPointDistancePx: 0 }), null);
assert.deepEqual(pickMapTarget({ marker: { body: "sun", distancePx: 8.7 }, labelled: null, catalogPointDistancePx: 9 }), { body: "sun", distancePx: 8.7 });
assert.deepEqual(pickMapTarget({ marker: { body: "sun", distancePx: 8.7 }, labelled: null, catalogPointDistancePx: null }), { body: "sun", distancePx: 8.7 });
assert.equal(pickMapTarget({ marker: null, labelled: null, catalogPointDistancePx: 3 }), null);

