import assert from "node:assert/strict";
import { test } from "node:test";
import { apparentScale, cameraDistance, depthSpan, place, sourceAt, type DepthSource } from "../src/community/depthFlightModel.ts";
import { blinkTransform, BLINK_HEIGHT, BLINK_WIDTH, surveyFov } from "../src/community/findingBlink.ts";

const source = (key: string, x: number, y: number, distance: number): DepthSource => ({ key, name: key, x, y, cell: [0, 0], distance_ly: distance, distance_method: "parallax" });
const sources = [source("near", 0.2, 0.3, 40), source("mid", 0.7, 0.6, 900), source("far", 0.55, 0.45, 3_000_000)];

test("the first frame of the flight has each source at its place in the photo", () => {
  assert.equal(cameraDistance(0, 40, 3_000_000), 0);
  for (const item of sources) {
    const point = place(item.x, item.y, item.distance_ly, 0)!;
    assert.equal(point.x, item.x);
    assert.equal(point.y, item.y);
    assert.equal(point.scale, 1);
    assert.equal(point.alpha, 1);
  }
});

test("the camera has a logarithmic pace and passes the farthest source", () => {
  const near = 40, far = 3_000_000;
  const quarter = cameraDistance(0.25, near, far), half = cameraDistance(0.5, near, far), end = cameraDistance(1, near, far);
  assert.ok(end > far);
  assert.ok((half + near / 2) / (quarter + near / 2) > 10);
  assert.ok(Math.abs((half + near / 2) / (quarter + near / 2) - (end + near / 2) / (cameraDistance(0.75, near, far) + near / 2)) < 1e-6);
  assert.equal(cameraDistance(-1, near, far), 0);
  assert.equal(cameraDistance(2, near, far), end);
});

test("a nearer source moves faster than a farther source, and a passed source leaves", () => {
  assert.ok(apparentScale(40, 20)! > apparentScale(900, 20)!);
  assert.equal(apparentScale(40, 40), null);
  assert.equal(place(0.2, 0.3, 40, 41), null);
  const near = place(0.2, 0.3, 40, 20)!;
  assert.ok(Math.abs(near.x - 0.5) > Math.abs(0.2 - 0.5));
});

test("a source fades near the camera", () => {
  assert.ok(place(0.5, 0.5, 100, 90)!.alpha < 1);
  assert.equal(place(0.5, 0.5, 100, 99.9), null);
});

test("the span has the plane of the main subject", () => {
  const span = depthSpan({ sources, plane_distance_ly: 5_000_000 });
  assert.equal(span.nearest.key, "near");
  assert.equal(span.farthest.key, "far");
  assert.equal(span.high, 5_000_000);
});

test("a click selects the nearest source at that place", () => {
  assert.equal(sourceAt(sources, 0, 0.71, 0.61, 0.02)?.key, "mid");
  assert.equal(sourceAt(sources, 0, 0.9, 0.9, 0.02), null);
});

test("the blink puts the finding at the center of the stage with north up", () => {
  const wcs = { ra_deg: 150, dec_deg: 2, pixel_scale_arcsec: 2, rotation_deg: 0, width: 800, height: 600, frame: "ICRS", epoch: "J2000", projection: "TAN", status: "solved" };
  const fov = surveyFov(wcs);
  const matrix = blinkTransform(wcs, 0.25, 0.5, fov).match(/matrix\((.*)\)/)![1]!.split(",").map(Number);
  const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
  const at = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
  const center = at(200, 300);
  assert.ok(Math.abs(center[0]! - BLINK_WIDTH / 2) < 1e-6 && Math.abs(center[1]! - BLINK_HEIGHT / 2) < 1e-6);
  // A row nearer the top of the photo is farther north, so it stays above the center.
  assert.ok(at(200, 280)[1]! < center[1]!);
  // A photo with east to the right is mirrored to east left, as in a survey cutout.
  assert.ok(at(220, 300)[0]! < center[0]!);
  assert.ok(Math.abs(Math.hypot(a, b) - 2) < 1e-6);
});
