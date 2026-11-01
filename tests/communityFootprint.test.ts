import assert from "node:assert/strict";
import test from "node:test";
import { footprintAlpha, footprintDirections, footprintWcs } from "../src/community/photoFootprint.ts";
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
test("footprints keep a readable alpha at a low photo opacity and follow it above the floor", () => {
  assert.equal(footprintAlpha(0), 0.35);
  assert.equal(footprintAlpha(0.2), 0.35);
  assert.equal(footprintAlpha(0.35), 0.35);
  assert.equal(footprintAlpha(0.65), 0.65);
  assert.equal(footprintAlpha(1), 1);
});
test("unsupported astrometry never draws a footprint", () => {
  assert.deepEqual(footprintDirections({ ...wcs, frame: "unknown" }), []);
  assert.deepEqual(footprintDirections({ ...wcs, projection: "SIP" }), []);
});
test("the footprint scan stops at the limit and looks up no later points", () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ key: `k${index}` }));
  const frames = [{ points: points.slice(0, 20) }, { points: points.slice(20) }];
  const lookups: string[] = [];
  const result = footprintWcs(frames, (key) => {
    lookups.push(key);
    return { subject_id: `subject-${key}`, cover: { wcs: { ...wcs, width: Number(key.slice(1)) + 1 } } };
  });
  assert.deepEqual(lookups, points.slice(0, 24).map((point) => point.key));
  assert.deepEqual(result.map((item) => item.width), Array.from({ length: 24 }, (_, index) => index + 1));
});
test("the footprint limit counts one entry for each subject, without solved or missing covers", () => {
  const covers = new Map<string, { subject_id: string; cover?: { wcs?: typeof wcs | null } | null }>([
    ["none", { subject_id: "none", cover: null }],
    ["solved", { subject_id: "solved", cover: { wcs: { ...wcs, status: "solved" } } }],
  ]);
  const keys = ["unknown", "none", "solved"];
  for (let index = 0; index < 30; index += 1) {
    for (const key of [`a${index}`, `b${index}`]) {
      covers.set(key, { subject_id: `subject-${index}`, cover: { wcs } });
      keys.push(key);
    }
  }
  const lookups: string[] = [];
  const result = footprintWcs([{ points: keys.map((key) => ({ key })) }], (key) => {
    lookups.push(key);
    return covers.get(key);
  });
  assert.equal(result.length, 24);
  assert.equal(lookups.at(-1), "a23");
  assert.equal(footprintWcs([{ points: [{ key: "a0" }, { key: "b0" }] }], (key) => covers.get(key)).length, 1);
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
