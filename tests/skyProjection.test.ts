import assert from "node:assert/strict";
import {
  cameraForDirection,
  directionFromEcliptic,
  normalizeCamera,
  projectDirection,
  relativeDirection,
} from "../src/sky/skyProjection.ts";

assert.deepEqual(relativeDirection({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }), null);
assert.deepEqual(relativeDirection({ x: 1, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });

const camera = cameraForDirection({ x: 0, y: 1, z: 0 }, 72);
assert.equal(camera.yawDeg, 90);
assert.equal(camera.pitchDeg, 0);
const center = projectDirection({ x: 0, y: 1, z: 0 }, camera, 1000, 600);
assert.ok(center);
assert.ok(Math.abs(center.x - 500) < 1e-8);
assert.ok(Math.abs(center.y - 300) < 1e-8);
assert.equal(projectDirection({ x: 0, y: -1, z: 0 }, camera, 1000, 600), null);

const north = projectDirection(directionFromEcliptic(90, 30), camera, 1000, 600);
assert.ok(north && north.y < 300, "positive ecliptic latitude projects upward");
assert.deepEqual(normalizeCamera({ yawDeg: -10, pitchDeg: 120, fovDeg: 5 }), { yawDeg: 350, pitchDeg: 89.5, fovDeg: 20 });

console.log("sky projection tests passed");
