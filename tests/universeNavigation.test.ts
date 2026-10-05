import assert from "node:assert/strict";
import { moveUniversePosition, universeCameraBasis, universeEntryState } from "../src/navigation/universeNavigation.ts";

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

const coincident = universeEntryState({ x: 2, y: 3 }, 5, { x: 2, y: 3, z: 0 });
assert.deepEqual(coincident.positionAu, { x: 7, y: 3, z: 0 });
near(coincident.yawDeg, 180);

for (const [scale, step] of [[1, 0.001], [63_241, 1], [6.324e10, 1e7], [6.324e16, 1e13]]) {
  const moved = moveUniversePosition({ x: scale, y: 0, z: 0 }, 0, 0, "forward", step);
  assert.ok(Number.isFinite(moved.x) && moved.x > scale, `movement must remain representable at ${scale} AU`);
}

console.log("universe navigation tests passed");
