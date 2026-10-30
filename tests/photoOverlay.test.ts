import assert from "node:assert/strict";
import { test } from "node:test";
import { directionFromEquatorial } from "../src/coordinates.ts";
import { overlayArea, overlayPlacements, quadContains } from "../src/community/photoOverlay.ts";
import { planeTransform } from "../src/community/photoPlane.ts";
import type { OverlayPhoto } from "../src/community/api.ts";
import type { Wcs } from "../src/community/photoFootprint.ts";
import { cameraForDirection, createSkyProjector, type SkyCamera } from "../src/sky/skyProjection.ts";

const WIDTH = 1600, HEIGHT = 1000;
const r = Math.PI / 180;

/** A solver solution with a rotation, a mirror image, and a reference pixel that is not in the center. */
function solution(ra: number, dec: number, rotationDeg: number, parity: 1 | -1, scaleDeg: number): Wcs {
  const c = Math.cos(rotationDeg * r) * scaleDeg, s = Math.sin(rotationDeg * r) * scaleDeg;
  return {
    ra_deg: ra, dec_deg: dec, pixel_scale_arcsec: scaleDeg * 3600, rotation_deg: rotationDeg, width: 1600, height: 1067,
    frame: "ICRS", epoch: "J2000", projection: "TAN", status: "solved",
    cd: [parity * c, -s, parity * s, c], crpix: [700.5, 610.5],
  };
}

function photo(wcs: Wcs, id = "a"): OverlayPhoto {
  return { id, title: "Photo", author: "Author", licence: "CC0", captured_at: "2026-01-01T00:00:00Z", wcs, thumbnail_url: "/t", image_url: "/i" };
}

/** The sky position of a pixel, by the TAN projection of the FITS WCS paper. */
function pixelDirection(wcs: Wcs, px: number, py: number) {
  const dx = px - wcs.crpix![0], dy = py - wcs.crpix![1], cd = wcs.cd!;
  const xi = (cd[0] * dx + cd[1] * dy) * r, eta = (cd[2] * dx + cd[3] * dy) * r;
  const dec0 = wcs.dec_deg * r;
  const ra = wcs.ra_deg + Math.atan2(xi, Math.cos(dec0) - eta * Math.sin(dec0)) / r;
  const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(xi, Math.cos(dec0) - eta * Math.sin(dec0))) / r;
  return directionFromEquatorial(ra, dec);
}

/** Applies the CSS `matrix3d` of an aligned image to a place on the image, in the unit square. */
function applyMatrix(matrix: string, u: number, v: number) {
  const m = matrix.slice("matrix3d(".length, -1).split(",").map(Number);
  const w = m[3]! * u + m[7]! * v + m[15]!;
  return { x: (m[0]! * u + m[4]! * v + m[12]!) / w, y: (m[1]! * u + m[5]! * v + m[13]!) / w };
}

for (const fovDeg of [20, 40, 72]) {
  for (const [rotation, parity] of [[0, 1], [37, -1], [-120, 1]] as const) {
    test(`a known star of the photo is under its catalog position at ${fovDeg} degrees, rotation ${rotation}, parity ${parity}`, () => {
      const wcs = solution(83.8, -5.4, rotation, parity, 0.002);
      const center = cameraForDirection(directionFromEquatorial(84.5, -5), fovDeg);
      const [place] = overlayPlacements([photo(wcs)], center, WIDTH, HEIGHT);
      assert.ok(place);
      const matrix = planeTransform(place.corners);
      assert.ok(matrix);
      const project = createSkyProjector(center, WIDTH, HEIGHT, Number.POSITIVE_INFINITY);
      for (const [px, py] of [[1, 1], [1600, 1], [1600, 1067], [1, 1067], [800, 533], [120.25, 910.75], [1411.5, 77.5]]) {
        const expected = project(pixelDirection(wcs, px!, py!))!;
        // FITS pixels have their centers at whole numbers; image y goes down on the screen.
        const placed = applyMatrix(matrix, (px! - 0.5) / wcs.width, 1 - (py! - 0.5) / wcs.height);
        assert.ok(Math.hypot(placed.x - expected.x, placed.y - expected.y) < 0.5, `pixel ${px},${py}`);
      }
    });
  }
}

test("a photo with a corner outside the view stays aligned", () => {
  const wcs = solution(83.8, -5.4, 20, 1, 0.01);
  const camera = cameraForDirection(directionFromEquatorial(105, -5), 20);
  const [place] = overlayPlacements([photo(wcs)], camera, WIDTH, HEIGHT);
  assert.ok(place);
  assert.ok(place.corners.some((corner) => corner.x < 0 || corner.x > WIDTH || corner.y < 0 || corner.y > HEIGHT));
  assert.ok(planeTransform(place.corners));
});

test("a photo behind the camera or far from the view is not placed", () => {
  const camera = cameraForDirection(directionFromEquatorial(264, 5.4), 72);
  assert.deepEqual(overlayPlacements([photo(solution(83.8, -5.4, 0, 1, 0.002))], camera, WIDTH, HEIGHT), []);
});

test("a large photo is an image and a small photo is a footprint", () => {
  const camera = cameraForDirection(directionFromEquatorial(83.8, -5.4), 40);
  const [large, small] = overlayPlacements([photo(solution(83.8, -5.4, 0, 1, 0.0002), "small"), photo(solution(83.8, -5.4, 0, 1, 0.002), "large")], camera, WIDTH, HEIGHT);
  assert.equal(large!.photo.id, "large");
  assert.equal(large!.image, true);
  assert.equal(small!.image, false);
});

test("a frame has at most six images and 24 keyboard stops", () => {
  const camera = cameraForDirection(directionFromEquatorial(83.8, -5.4), 40);
  const photos = Array.from({ length: 200 }, (_, index) => photo(solution(83.8 + index * 0.05, -5.4, 0, 1, 0.002), String(index)));
  const placed = overlayPlacements(photos, camera, WIDTH, HEIGHT);
  assert.equal(placed.length, 200);
  assert.equal(placed.filter((item) => item.image).length, 6);
  assert.equal(placed.filter((item) => item.focusable).length, 24);
});

test("a small movement of the view keeps the same query area", () => {
  const camera = (ra: number, fovDeg: number): SkyCamera => cameraForDirection(directionFromEquatorial(ra, 10), fovDeg);
  assert.equal(overlayArea(camera(101, 40), WIDTH, HEIGHT).key, overlayArea(camera(103, 40), WIDTH, HEIGHT).key);
  assert.notEqual(overlayArea(camera(101, 40), WIDTH, HEIGHT).key, overlayArea(camera(121, 40), WIDTH, HEIGHT).key);
  assert.ok(overlayArea(camera(101, 110), WIDTH, HEIGHT).radius > overlayArea(camera(101, 20), WIDTH, HEIGHT).radius);
});

test("the query area stays inside the limits of the endpoint", () => {
  for (const ra of [0, 359, 359.9]) {
    const area = overlayArea(cameraForDirection(directionFromEquatorial(ra, 89), 110), WIDTH, 200);
    assert.ok(area.ra >= 0 && area.ra < 360 && Math.abs(area.dec) <= 90 && area.radius >= 1 && area.radius <= 180, area.key);
  }
});

test("a point test works in both winding directions", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(quadContains(square, { x: 5, y: 5 }), true);
  assert.equal(quadContains([...square].reverse(), { x: 5, y: 5 }), true);
  assert.equal(quadContains(square, { x: 11, y: 5 }), false);
});
