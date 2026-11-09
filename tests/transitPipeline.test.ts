import assert from "node:assert/strict";
import { test } from "node:test";
import { frameMidTimeJd, headerWcs, readFrame, saturationLimit, scaledWcs, skyToPixel, type FrameWcs } from "../src/transit/fitsFrame.ts";
import { lightCurveSvg } from "../src/transit/lightCurve.ts";
import { apertureRadius, detectStars, measureAperture, measureFrame, pixelMapping, placeStars, relativeLightCurve, typicalWidth, type FrameMeasure } from "../src/transit/photometry.ts";

function fitsFile(cards: Record<string, string | number | boolean>, width: number, height: number, pixels: number[]): ArrayBuffer {
  const lines = Object.entries({ SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: width, NAXIS2: height, ...cards }).map(([key, value]) => {
    const text = typeof value === "string" ? `'${value}'` : typeof value === "boolean" ? (value ? "T" : "F") : String(value);
    return `${key.padEnd(8)}= ${text}`.padEnd(80);
  });
  lines.push("END".padEnd(80));
  const header = lines.join("").padEnd(Math.ceil((lines.length * 80) / 2880) * 2880);
  const buffer = new ArrayBuffer(header.length + Math.ceil((width * height * 2) / 2880) * 2880);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < header.length; index += 1) bytes[index] = header.charCodeAt(index);
  const view = new DataView(buffer);
  pixels.forEach((value, index) => view.setInt16(header.length + index * 2, value));
  return buffer;
}

function starField(width: number, height: number, stars: { x: number; y: number; flux: number }[], sky = 100, seed = 7): Float32Array {
  const pixels = new Float32Array(width * height);
  let state = seed;
  const noise = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296 - 0.5) * 4;
  };
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let value = sky + noise();
      for (const star of stars) value += (star.flux / (2 * Math.PI * 2.25)) * Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * 2.25));
      pixels[y * width + x] = value;
    }
  return pixels;
}

test("a 16-bit FITS frame gives its pixels with BZERO", () => {
  const frame = readFrame(fitsFile({ BZERO: 32768, BSCALE: 1 }, 2, 2, [-32768, 0, 1000, 32767]));
  assert.deepEqual([...frame.pixels], [0, 32768, 33768, 65535]);
});

test("a file that is not FITS is refused", () => {
  assert.throws(() => readFrame(new ArrayBuffer(4000)), /not_fits/);
});

test("the frame time is the middle of the exposure in UTC", () => {
  const jd = frameMidTimeJd({ "DATE-OBS": "2026-12-05T08:00:00", EXPTIME: 60 })!;
  assert.ok(Math.abs(jd - (2461379.8333333 + 30 / 86400)) < 1e-6);
  assert.equal(frameMidTimeJd({ "DATE-OBS": "2026-12-05T08:00:00" }), null);
  assert.equal(frameMidTimeJd({ "DATE-OBS": "2026-12-05T08:00:00", EXPTIME: 60, TIMESYS: "TAI" }), null);
  assert.ok(frameMidTimeJd({ "DATE-AVG": "2026-12-05T08:00:30" })! > 0);
});

const WCS: FrameWcs = { crval: [97.64, 29.67], crpix: [150.5, 100.5], cd: [-2 / 3600, 0, 0, 2 / 3600] };

test("a sky position maps to its pixel, also on a small copy of the frame", () => {
  const center = skyToPixel(WCS, 97.64, 29.67)!;
  assert.ok(Math.abs(center.x - 149.5) < 1e-6 && Math.abs(center.y - 99.5) < 1e-6);
  const north = skyToPixel(WCS, 97.64, 29.67 + 20 / 3600)!;
  assert.ok(Math.abs(north.y - 109.5) < 1e-3);
  const small = scaledWcs(WCS, 2);
  assert.ok(Math.abs(skyToPixel(small, 97.64, 29.67 + 20 / 3600)!.y + 0.5 - (north.y + 0.5) * 2) < 1e-3);
  assert.ok(Math.abs(skyToPixel(small, 97.64, 29.67)!.y - 200) < 0.6);
  assert.equal(headerWcs({ CTYPE1: "RA---SIN", CTYPE2: "DEC--SIN" }), null);
  const cdelt = headerWcs({ CTYPE1: "RA---TAN", CTYPE2: "DEC--TAN", CRVAL1: 1, CRVAL2: 2, CRPIX1: 3, CRPIX2: 4, CDELT1: -0.001, CDELT2: 0.001 })!;
  assert.deepEqual(cdelt.cd.map((value) => Math.abs(value) < 1e-12 ? 0 : value), [-0.001, 0, 0, 0.001]);
});

test("detection finds the stars of a field and the aperture measures the flux", () => {
  const stars = [{ x: 60, y: 50, flux: 20000 }, { x: 120, y: 90, flux: 9000 }, { x: 200, y: 60, flux: 15000 }];
  const pixels = starField(260, 160, stars);
  const found = detectStars(pixels, 260, 160);
  assert.equal(found.length, 3);
  assert.ok(Math.hypot(found[0]!.x - 60, found[0]!.y - 50) < 0.3);
  const radius = apertureRadius(typicalWidth(found));
  const measure = measureAperture(pixels, 260, 160, 60, 50, radius)!;
  assert.ok(Math.abs(measure.flux - 20000) / 20000 < 0.04, `flux ${measure.flux}`);
  assert.ok(Math.abs(measure.sky - 100) < 1);
});

test("a star follows a drift from frame to frame, and a lost star drops the frame", () => {
  const pixels = starField(260, 160, [{ x: 63, y: 52, flux: 20000 }, { x: 203, y: 62, flux: 15000 }]);
  const stars = measureFrame(pixels, 260, 160, [{ x: 60, y: 50 }, { x: 200, y: 60 }], 5)!;
  assert.ok(Math.hypot(stars[0]!.x - 63, stars[0]!.y - 52) < 0.5);
  assert.equal(measureFrame(pixels, 260, 160, [{ x: 60, y: 50 }, { x: 120, y: 130 }], 5), null);
  assert.equal(measureFrame(pixels, 260, 160, [{ x: 60, y: 50 }, { x: 200, y: 60 }], 5, 1, 110), null);
});

test("the saturation limit comes from DATAMAX or from the 16-bit range of the frame", () => {
  assert.equal(saturationLimit({ BITPIX: 16, BZERO: 32768, DATAMAX: 4095 }), 4095 * 0.95);
  assert.equal(saturationLimit({ BITPIX: 16, BZERO: 32768, BSCALE: 1 }), 65535 * 0.95);
  assert.equal(saturationLimit({ BITPIX: 16 }), 32767 * 0.95);
  assert.equal(saturationLimit({ BITPIX: -32 }), Infinity);
});

test("a 16-bit frame without DATAMAX is kept below the limit and dropped above it", () => {
  const limit = 65535 * 0.95;
  const frameWithPeak = (peak: number) => {
    const sky = 100;
    const pixels = starField(260, 160, [{ x: 60, y: 50, flux: (peak - sky) * 2 * Math.PI * 2.25 }, { x: 200, y: 60, flux: 15000 }], sky);
    return readFrame(fitsFile({ BZERO: 32768, BSCALE: 1 }, 260, 160, [...pixels].map((value) => Math.round(value) - 32768)));
  };
  const places = [{ x: 60, y: 50 }, { x: 200, y: 60 }];
  for (const [peak, kept] of [[limit - 60, true], [limit + 60, false]] as const) {
    const frame = frameWithPeak(peak);
    const stars = measureFrame(frame.pixels, frame.width, frame.height, places, 5, 1, saturationLimit(frame.header));
    assert.equal(stars !== null, kept, `peak ${peak}`);
  }
});

test("the target is matched to Gaia and comparison stars are near it in brightness", () => {
  const field: { x: number; y: number; flux: number }[] = [{ x: 150, y: 100, flux: 30000 }, { x: 60, y: 50, flux: 25000 }, { x: 240, y: 60, flux: 28000 }, { x: 60, y: 150, flux: 26000 }, { x: 240, y: 150, flux: 300 * 100 * 40 }];
  const pixels = starField(300, 200, field);
  const detections = detectStars(pixels, 300, 200);
  const sky = (x: number, y: number) => ({ ra: 97.64 - ((x - 149.5) * (2 / 3600)) / Math.cos(29.67 * Math.PI / 180), dec: 29.67 + ((y - 99.5) * 2) / 3600 });
  const gaia = [
    { key: "a", ...sky(60, 50), magnitude: 11.7, bp_rp: 0.8 },
    { key: "b", ...sky(240, 60), magnitude: 11.6, bp_rp: 0.9 },
    { key: "c", ...sky(60, 150), magnitude: 11.7, bp_rp: 0.7 },
    { key: "bright", ...sky(240, 150), magnitude: 7.5, bp_rp: 0.8 },
    { key: "target-star", ...sky(150, 100), magnitude: 11.5, bp_rp: 0.8 },
  ];
  const places = placeStars({ ...sky(150, 100), magnitude: 11.5 }, gaia, detections, WCS, 300, 200, 5);
  assert.equal(places[0]!.role, "target");
  assert.ok(Math.hypot(places[0]!.x - 150, places[0]!.y - 100) < 1);
  assert.deepEqual(places.slice(1).map((place) => place.key).sort(), ["a", "b", "c"]);
});

test("a solution with rows from the other side is detected", () => {
  const detections = [{ x: 149.5, y: 199 - 120, peak: 1, flux: 1, width: 2 }];
  const star = { key: "a", ra: 97.64, dec: 29.67 + 20.5 * 2 / 3600, magnitude: 10 };
  const mapping = pixelMapping(WCS, 200, [star], detections, 3);
  const pixel = mapping(skyToPixel(WCS, star.ra, star.dec)!);
  assert.ok(Math.abs(pixel.y - 79) < 2, `row ${pixel.y}`);
});

test("the light curve is the target over the comparison stars and a clear sky gives a flat check", () => {
  const frames: FrameMeasure[] = [];
  for (let index = 0; index < 40; index += 1) {
    const transparency = 1 - 0.2 * Math.sin(index / 6);
    const dip = index >= 15 && index < 25 ? 0.985 : 1;
    const star = (flux: number) => ({ x: 0, y: 0, flux: flux * transparency, error: 20, sky: 0, peak: 0 });
    frames.push({ time: 2461000 + index / 1440, stars: [star(10000 * dip), star(9000), star(11000), star(8000)] });
  }
  const curve = relativeLightCurve(frames, 2);
  assert.equal(curve.dropped, 2);
  assert.ok(Math.abs(curve.points[0]![1] - 10000 / 28000) < 1e-9);
  assert.ok(Math.abs(curve.points[20]![1] / curve.points[0]![1] - 0.985) < 1e-9);
  assert.ok(curve.checkRmsPpt! < 1e-6);
});

test("the model of the fit and the points of a curve have one scale", () => {
  const points: [number, number, number][] = Array.from({ length: 41 }, (_, index) => [2461000 + index / 1440, index % 2 ? 1.001 : 0.999, 0.001]);
  const svg = lightCurveSvg(points, { minutes: [-20, 0, 20], flux: [1, 1, 1] }, "x");
  const heights = /<polyline[^>]* points="([^"]+)"/.exec(svg)![1]!.split(" ").map((pair) => Number(pair.split(",")[1]));
  assert.ok(heights.length === 3 && new Set(heights).size === 1);
  // The median of these points is 0.999, so a point of that flux has the height of a model at 1.
  const dot = Number(/<circle[^>]* cy="([\d.]+)"/.exec(svg)![1]);
  assert.ok(Math.abs(heights[0]! - dot) < 0.2);
});

test("the light curve drawing has a point for each measurement and escapes its label", () => {
  const points: [number, number, number][] = Array.from({ length: 30 }, (_, index) => [2461000 + index / 1440, 1 + index * 1e-4, 0.001]);
  const svg = lightCurveSvg(points, { minutes: [-10, 0, 10], flux: [1, 1, 1] }, 'a "b"');
  assert.equal(svg.match(/<circle/g)!.length, 30);
  assert.ok(svg.includes("<polyline") && svg.includes("a &quot;b&quot;"));
  assert.equal(lightCurveSvg([], null, "x"), "");
});
