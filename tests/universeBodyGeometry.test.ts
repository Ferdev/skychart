import assert from "node:assert/strict";
import type { Body } from "../src/atlas/contracts.ts";
import { AU_KM, hasRenderableRadius, projectPhysicalBody, safeUniverseEntryPosition } from "../src/universe/universeBodyGeometry.ts";

const jupiter = {
  key: "jupiter", object_type: "planet", position: { x: -5, y: 0, z: 0 }, radiusKm: 69_911,
};
const radiusAu = jupiter.radiusKm / AU_KM;
const camera = { yawDeg: 180, pitchDeg: 0, fovDeg: 72 };
const near = projectPhysicalBody(jupiter, { x: -5 + radiusAu + 30 / AU_KM, y: 0, z: 0 }, camera, 1280, 800);
assert.ok(near && near.radiusPx > 1280, "Jupiter should fill the frame 30 km above its modeled radius");
assert.equal(near.inside, false);
const far = projectPhysicalBody(jupiter, { x: -5 + radiusAu * 10, y: 0, z: 0 }, camera, 1280, 800);
assert.ok(far && far.radiusPx > 10 && far.radiusPx < near.radiusPx);
assert.equal(projectPhysicalBody(jupiter, { x: -5 + radiusAu * 10, y: 0, z: 0 },
  { yawDeg: 0, pitchDeg: 0, fovDeg: 72 }, 1280, 800), null);
assert.equal(projectPhysicalBody({ ...jupiter, object_type: "galaxy" }, { x: -4, y: 0, z: 0 }, camera, 1280, 800), null);
assert.equal(hasRenderableRadius({ ...jupiter, radiusKm: null }), false);
const inside = projectPhysicalBody(jupiter, { x: -5, y: 0, z: 0 }, camera, 1280, 800);
assert.ok(inside?.inside && inside.radiusPx > 1280);
const safeEntry = safeUniverseEntryPosition({ x: 0, y: 0, z: 0 }, camera, [{
  key: "sun", object_type: "star", radius_km: 695_700, position: { x_au: 0, y_au: 0, z_au: 0 },
} as Body]);
assert.ok(Math.hypot(safeEntry.x, safeEntry.y, safeEntry.z) >= 3 * 695_700 / AU_KM - 1e-12);
console.log("universe body geometry tests passed");
