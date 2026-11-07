import assert from "node:assert/strict";
import {
  cameraForDirection,
  createSkyProjector,
  directionFromEcliptic,
  normalizeCamera,
  normalizeFreeCamera,
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
const cachedProjector = createSkyProjector(camera, 1000, 600);
assert.deepEqual(cachedProjector({ x: 0, y: 1, z: 0 }), center);
assert.equal(cachedProjector({ x: 0, y: -1, z: 0 }), null);

const nearObserver = relativeDirection({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 });
const shiftedObserver = relativeDirection({ x: 0, y: 5, z: 0 }, { x: 10, y: 10, z: 0 });
assert.ok(nearObserver && shiftedObserver);
const nearScreen = projectDirection(nearObserver, { yawDeg: 0, pitchDeg: 0, fovDeg: 90 }, 1000, 600);
const shiftedScreen = projectDirection(shiftedObserver, { yawDeg: 0, pitchDeg: 0, fovDeg: 90 }, 1000, 600);
assert.ok(nearScreen && shiftedScreen && shiftedScreen.x < nearScreen.x, "observer translation creates parallax");

const north = projectDirection(directionFromEcliptic(90, 30), camera, 1000, 600);
assert.ok(north && north.y < 300, "positive ecliptic latitude projects upward");
assert.deepEqual(normalizeCamera({ yawDeg: -10, pitchDeg: 120, fovDeg: 5 }), { yawDeg: 350, pitchDeg: 89.5, fovDeg: 20 });

// The 3D camera has no pitch limit. It wraps over the poles.
assert.deepEqual(normalizeFreeCamera({ yawDeg: -10, pitchDeg: 120, fovDeg: 5 }), { yawDeg: 350, pitchDeg: 120, fovDeg: 20 });
assert.equal(normalizeFreeCamera({ yawDeg: 0, pitchDeg: 200, fovDeg: 72 }).pitchDeg, -160);
assert.equal(normalizeFreeCamera({ yawDeg: 0, pitchDeg: -190, fovDeg: 72 }).pitchDeg, 170);
assert.equal(normalizeFreeCamera({ yawDeg: 0, pitchDeg: 180, fovDeg: 72 }).pitchDeg, -180);
// At pitch 90 the ecliptic north pole is at the center of the view.
const zenith = projectDirection({ x: 0, y: 0, z: 1 }, { yawDeg: 0, pitchDeg: 90, fovDeg: 72 }, 1000, 600);
assert.ok(zenith && Math.abs(zenith.x - 500) < 1e-8 && Math.abs(zenith.y - 300) < 1e-8, "the view can look straight at the pole");
// Over the pole (pitch 120, yaw 0) the view looks back toward -x, upside down.
const overPole = { yawDeg: 0, pitchDeg: 120, fovDeg: 72 };
const behind = projectDirection(directionFromEcliptic(180, 60), overPole, 1000, 600);
assert.ok(behind && Math.abs(behind.x - 500) < 1e-8 && Math.abs(behind.y - 300) < 1e-8, "pitch past 90 degrees looks over the pole");
const pole = projectDirection({ x: 0, y: 0, z: 1 }, overPole, 1000, 600);
assert.ok(pole && pole.y > 300, "over the pole, the pole is below the view center");

console.log("sky projection tests passed");
