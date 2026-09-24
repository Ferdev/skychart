import assert from "node:assert/strict";
import { moveUniversePosition, universeCameraBasis } from "../src/navigation/universeNavigation.ts";

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

console.log("universe navigation tests passed");
