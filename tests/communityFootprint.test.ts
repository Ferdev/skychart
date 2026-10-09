import assert from "node:assert/strict";
import test from "node:test";
import { footprintDirections } from "../src/community/photoFootprint.ts";
import { planeTransform } from "../src/community/photoPlane.ts";
const wcs = {
  ra_deg: 359.9,
  dec_deg: 89,
  pixel_scale_arcsec: 1,
  rotation_deg: 0,
  width: 100,
  height: 100,
  frame: "ICRS",
  epoch: "J2000",
  projection: "TAN",
  status: "author_supplied",
};
test("small TAN footprints stay finite at RA wrap and near the pole", () => {
  const corners = footprintDirections(wcs);
  assert.equal(corners.length, 4);
  for (const p of corners) {
    assert.ok([p.x, p.y, p.z].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 0.001);
  }
});
test("unsupported astrometry never draws a footprint", () => {
  assert.deepEqual(footprintDirections({ ...wcs, frame: "unknown" }), []);
  assert.deepEqual(footprintDirections({ ...wcs, projection: "SIP" }), []);
});
test("photo plane homography maps all four image corners with perspective", () => {
  const points = [{ x: 10, y: 15 }, { x: 170, y: 30 }, { x: 150, y: 180 }, { x: 30, y: 150 }];
  const transform = planeTransform(points)!;
  const m = transform.slice(9, -1).split(",").map(Number);
  for (const [i, [x, y]] of [[0,0],[1,0],[1,1],[0,1]].entries()) {
    const divisor = m[3] * x + m[7] * y + m[15];
    assert.ok(Math.abs((m[0] * x + m[4] * y + m[12]) / divisor - points[i].x) < 1e-8);
    assert.ok(Math.abs((m[1] * x + m[5] * y + m[13]) / divisor - points[i].y) < 1e-8);
  }
  assert.equal(planeTransform([{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}]), null);
});
