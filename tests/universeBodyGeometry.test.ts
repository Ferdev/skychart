import assert from "node:assert/strict";
import type { Body } from "../src/atlas/contracts.ts";
import { approachDistance, AU_KM, framingDistance, hasRenderableRadius, projectPhysicalBody, projectSphericalExtent, safeUniverseEntryPosition } from "../src/universe/universeBodyGeometry.ts";

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
const galaxyExtent = projectSphericalExtent({ x: -5, y: 0, z: 0 }, radiusAu,
  { x: -5 + radiusAu * 10, y: 0, z: 0 }, camera, 1280, 800);
assert.ok(galaxyExtent && galaxyExtent.radiusPx > 10, "a non-solid volume still has a geometric angular extent");
assert.equal(hasRenderableRadius({ ...jupiter, radiusKm: null }), false);
const inside = projectPhysicalBody(jupiter, { x: -5, y: 0, z: 0 }, camera, 1280, 800);
assert.ok(inside?.inside && inside.radiusPx > 1280);
const safeEntry = safeUniverseEntryPosition({ x: 0, y: 0, z: 0 }, camera, [{
  key: "sun", object_type: "star", radius_km: 695_700, position: { x_au: 0, y_au: 0, z_au: 0 },
} as Body]);
assert.ok(Math.hypot(safeEntry.x, safeEntry.y, safeEntry.z) >= 3 * 695_700 / AU_KM - 1e-12);
// Approach distance frames every object at the same apparent size. Rigel and
// Antares differ fivefold in radius, yet both arrive as a disk that spans 22%
// of the shorter view side, and the result does not depend on the start point.
const star = (name: string, radiusSolar: number) => ({ key: name, object_type: "star", position: { x: 5e7, y: 0, z: 0 }, radiusKm: radiusSolar * 695_700 });
for (const giant of [star("rigel", 60.8), star("antares", 318.4), star("sirius", 1.57)]) {
  const distance = approachDistance(giant, null, 72);
  const disk = projectPhysicalBody(giant, { x: 5e7 - distance, y: 0, z: 0 }, { yawDeg: 0, pitchDeg: 0, fovDeg: 72 }, 1440, 1000)!;
  assert.ok(Math.abs(disk.radiusPx * 2 / 1000 - 0.22) < 1e-6, `${giant.key} spans ${disk.radiusPx * 2 / 1000} of the view`);
}
assert.ok(approachDistance(star("antares", 318.4), null, 72) / approachDistance(star("rigel", 60.8), null, 72) > 5);
// A planet fills a little more of the view than a star, a deep-sky form half of it.
const planetDistance = approachDistance(jupiter, null, 72);
assert.ok(Math.abs(projectPhysicalBody(jupiter, { x: -5 + planetDistance, y: 0, z: 0 }, camera, 390, 844)!.radiusPx * 2 / 390 - 0.3) < 1e-6);
assert.ok(Math.abs(framingDistance(1, 72, 0.5) - approachDistance({ ...jupiter, object_type: "star_cluster" }, 1, 72)) < 1e-12);
assert.ok(framingDistance(1, 72, 0.5) > 2.8 && framingDistance(1, 72, 0.5) < 3.1);
// A narrower field of view keeps the same framing from farther away.
assert.ok(approachDistance(jupiter, null, 30) > planetDistance * 2);
// Records with no size use a distance typical for their type.
const unsized = (object_type: string) => approachDistance({ key: "x", object_type, position: { x: 0, y: 0, z: 0 }, radiusKm: 0 }, null, 72);
assert.equal(unsized("star"), 1);
assert.equal(unsized("pulsar"), 1);
assert.ok(unsized("comet") < 1e-5);
assert.ok(unsized("galaxy") > 1e9 && unsized("galaxy") > unsized("nebula"));
// A sized galaxy without a 3D form is framed by its extent, not as a solid body.
assert.ok(Math.abs(approachDistance({ key: "g", object_type: "galaxy", position: { x: 0, y: 0, z: 0 }, radiusKm: AU_KM }, null, 72) - framingDistance(1, 72, 0.5)) < 1e-12);

console.log("universe body geometry tests passed");
