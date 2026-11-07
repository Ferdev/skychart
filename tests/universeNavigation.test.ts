import assert from "node:assert/strict";
import {
  cameraHeadingDeg, cameraUpsideDown, lookYawDelta, moveUniversePosition, universeCameraBasis, universeEntryAim, universeEntryState,
} from "../src/navigation/universeNavigation.ts";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

const basis = universeCameraBasis(0, 0);
near(basis.forward.x, 1);
near(basis.forward.y, 0);
near(basis.forward.z, 0);
near(basis.right.x, 0);
near(basis.right.y, 1);
near(basis.up.z, 1);

assert.deepEqual(moveUniversePosition({ x: 1, y: 2, z: 3 }, 0, 0, "forward", 4), { x: 5, y: 2, z: 3 });
assert.deepEqual(moveUniversePosition({ x: 1, y: 2, z: 3 }, 0, 0, "back", 4), { x: -3, y: 2, z: 3 });
assert.deepEqual(moveUniversePosition({ x: 1, y: 2, z: 3 }, 0, 0, "right", 4), { x: 1, y: 6, z: 3 });
assert.deepEqual(moveUniversePosition({ x: 1, y: 2, z: 3 }, 0, 0, "up", 4), { x: 1, y: 2, z: 7 });

const pitched = moveUniversePosition({ x: 0, y: 0, z: 0 }, 90, 30, "forward", 2);
near(pitched.x, 0);
near(pitched.y, Math.sqrt(3));
near(pitched.z, 1);

const entry = universeEntryState({ x: 2, y: 3 }, 5, { x: 102, y: 3, z: 0 });
assert.deepEqual(entry.positionAu, { x: 2, y: 3, z: 0 });
near(entry.yawDeg, 0);
assert.equal(entry.moveStepAu, 5);

// With no selected object the view aims at the fallback object, and the position stays at the map centre.
const aimed = universeEntryState({ x: -10, y: 0 }, 5, undefined, { x: 0, y: 0, z: 0 });
assert.deepEqual(aimed.positionAu, { x: -10, y: 0, z: 0 });
near(aimed.yawDeg, 0);
const selectedWins = universeEntryState({ x: 0, y: -10 }, 5, { x: 0, y: 90, z: 0 }, { x: 50, y: -10, z: 0 });
near(selectedWins.yawDeg, 90);
assert.equal(universeEntryState({ x: 2, y: 3 }, 5).yawDeg, 180);

// The Sun is the aim when it is in the 2D view. In other cases the nearest major object is the aim.
const sun = { key: "sun", position: { x: 0, y: 0, z: 0 }, major: true };
const jupiter = { key: "jupiter", position: { x: 5, y: 0, z: 0 }, major: true };
const asteroid = { key: "ceres", position: { x: 29, y: 0, z: 0 }, major: false };
const neptune = { key: "neptune", position: { x: 30, y: 2, z: 0 }, major: true };
assert.equal(universeEntryAim({ x: 3, y: 1 }, 10, [jupiter, sun, neptune]), sun.position);
assert.equal(universeEntryAim({ x: 28, y: 0 }, 4, [sun, jupiter, asteroid, neptune]), neptune.position);
assert.equal(universeEntryAim({ x: 28, y: 0 }, 4, [asteroid]), undefined);
// An object at the entry position is not an aim: it has no direction.
assert.equal(universeEntryAim({ x: 5, y: 0 }, 1, [jupiter, neptune]), neptune.position);

const coincident = universeEntryState({ x: 2, y: 3 }, 5, { x: 2, y: 3, z: 0 });
assert.deepEqual(coincident.positionAu, { x: 7, y: 3, z: 0 });
near(coincident.yawDeg, 180);

for (const [scale, step] of [[1, 0.001], [63_241, 1], [6.324e10, 1e7], [6.324e16, 1e13]]) {
  const moved = moveUniversePosition({ x: scale, y: 0, z: 0 }, 0, 0, "forward", step);
  assert.ok(Number.isFinite(moved.x) && moved.x > scale, `movement must remain representable at ${scale} AU`);
}


// Free look: the basis turns over a pole with no stop at 89.5 degrees.
const straightUp = universeCameraBasis(0, 90);
near(straightUp.forward.z, 1);
near(straightUp.up.x, -1);
const overPole = universeCameraBasis(0, 120);
near(overPole.forward.x, Math.cos(120 * Math.PI / 180));
near(overPole.forward.z, Math.sin(120 * Math.PI / 180));
assert.ok(overPole.forward.x < 0 && overPole.up.z < 0, "past 90 degrees the camera looks back over the pole, upside down");
near(overPole.right.y, 1);
// The basis stays orthonormal for every pitch.
for (const pitch of [-179, -120, -90, -45, 0, 60, 90, 135, 179]) {
  const b = universeCameraBasis(37, pitch);
  const dot = (a: typeof b.up, c: typeof b.up) => a.x * c.x + a.y * c.y + a.z * c.z;
  near(dot(b.forward, b.right), 0);
  near(dot(b.forward, b.up), 0);
  near(dot(b.right, b.up), 0);
  near(dot(b.forward, b.forward), 1);
  near(dot(b.up, b.up), 1);
}
const climbed = moveUniversePosition({ x: 0, y: 0, z: 0 }, 0, 150, "forward", 2);
assert.ok(climbed.x < 0 && climbed.z > 0, "flight follows the camera over the pole");

assert.equal(cameraUpsideDown(0), false);
assert.equal(cameraUpsideDown(89.5), false);
assert.equal(cameraUpsideDown(120), true);
assert.equal(cameraUpsideDown(-120), true);
// A drag to the right turns left upright; upside down the yaw sign changes so the sky still follows the pointer.
assert.equal(lookYawDelta(10, 5), -5);
assert.equal(lookYawDelta(150, 5), 5);
assert.equal(cameraHeadingDeg(30, 10), 30);
assert.equal(cameraHeadingDeg(30, 150), 210);
assert.equal(cameraHeadingDeg(270, -150), 90);
console.log("universe navigation tests passed");
