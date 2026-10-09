import assert from "node:assert/strict";
import { moveUniversePosition, universeCameraBasis, universeEntryAim, universeEntryState } from "../src/navigation/universeNavigation.ts";

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

console.log("universe navigation tests passed");
