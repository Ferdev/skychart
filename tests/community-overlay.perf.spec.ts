import { expect, test, type Page } from "@playwright/test";
import { openAtlas } from "./atlas-test-utils";

/** The camera is at the center of one step of the photo query, so the drag makes no new request. */
const EARTH_SKY = "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=78.2,-33.0,72.0";
/** The app draws each footprint with one stroke of this color. */
const FOOTPRINT_COLOR = "#82cbb3";
/** The ID that Chromium gives to the mouse. The moves of the page continue the drag of this pointer. */
const MOUSE_POINTER_ID = 1;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC", "base64");

function footprints(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    return {
      id, title: `Photo ${index}`, author: "Observer", licence: "CC BY 4.0", captured_at: "2026-10-08T00:00:00Z",
      thumbnail_url: "/overlay-image.png", image_url: "/overlay-image.png",
      wcs: {
        ra_deg: 52 + (index % 20) * 3, dec_deg: -32 + Math.floor(index / 20) * 5, pixel_scale_arcsec: 3.6, rotation_deg: 0, width: 1600, height: 1067,
        cd: [-0.001, 0, 0, 0.001], crpix: [800.5, 534], projection: "TAN", frame: "ICRS", epoch: "J2000", status: "solved",
      },
    };
  });
}

/** Counts the strokes on the Sky canvas. A frame with no strokes shows no new Sky frame. */
async function countSkyStrokes(page: Page) {
  await page.addInitScript((footprintColor) => {
    const strokes = { all: 0, footprints: 0 };
    Object.assign(window, { skyStrokes: strokes });
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (this: CanvasRenderingContext2D, ...path: []) {
      if (this.canvas.id === "sky-map") {
        strokes.all += 1;
        if (this.strokeStyle === footprintColor) strokes.footprints += 1;
      }
      stroke.apply(this, path);
    };
  }, FOOTPRINT_COLOR);
}

/**
 * Frame intervals while the view moves. A mouse move from the test takes about two frames, so the page makes the
 * moves: one move before each animation frame gives one new Sky frame for each sampled frame.
 */
async function moveAndSample(page: Page) {
  await page.mouse.move(800, 500);
  await page.mouse.down();
  const sample = await page.evaluate(async (pointerId) => {
    const canvas = document.querySelector("#sky-map")!;
    const strokes = (window as unknown as { skyStrokes: { all: number; footprints: number } }).skyStrokes;
    const intervals: number[] = [];
    const footprints = new Set<number>();
    let skyFrames = 0;
    let before = performance.now();
    for (let frame = 0; frame < 120; frame += 1) {
      canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId, clientX: 800 + Math.sin(frame / 8) * 40, clientY: 500 + Math.sin(frame / 5) * 30 }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      if (frame > 10) {
        intervals.push(now - before);
        footprints.add(strokes.footprints);
        if (strokes.all > 0) skyFrames += 1;
      }
      strokes.all = 0;
      strokes.footprints = 0;
      before = now;
    }
    return { intervals: intervals.sort((a, b) => a - b), skyFrames, footprints: [...footprints] };
  }, MOUSE_POINTER_ID);
  await page.mouse.up();
  const { intervals, skyFrames, footprints: placed } = sample;
  // The budget is valid only when each sampled frame is a frame of the movement.
  expect(skyFrames).toBe(intervals.length);
  return { median: intervals[Math.floor(intervals.length / 2)]!, p95: intervals[Math.floor(intervals.length * 0.95)]!, placed };
}

test("200 footprints in view stay near the frame rate of the same Sky view with no photos", async ({ page }) => {
  test.setTimeout(180_000);
  let photos: unknown[] = [];
  await countSkyStrokes(page);
  await page.route("**/api/community/config", (route) => route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/community/session", (route) => route.fulfill({ json: { user: null, csrf: "", review_count: 0 } }));
  await page.route("**/api/photos/index?**", (route) => route.fulfill({ json: { version: 1, more: false, items: [] } }));
  await page.route("**/overlay-image.png", (route) => route.fulfill({ contentType: "image/png", body: image }));
  await page.route("**/api/photos/sky?**", (route) => route.fulfill({ json: { photos } }));
  await openAtlas(page, EARTH_SKY);
  await expect(page.locator("#sky-view-status")).toContainText("loaded", { timeout: 30_000 });
  const without = await moveAndSample(page);
  expect(without.placed).toEqual([0]);

  photos = footprints(200);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.reload();
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#sky-view-status")).toContainText("loaded", { timeout: 30_000 });
  await expect.poll(() => page.locator(".community-sky-photo").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const withPhotos = await moveAndSample(page);
  expect(withPhotos.placed).toEqual([200]);
  console.log(`Sky frame intervals in ms: no photos ${JSON.stringify(without)}, 200 footprints ${JSON.stringify(withPhotos)}`);
  expect(withPhotos.p95).toBeLessThan(without.p95 * 1.5 + 20);
});
