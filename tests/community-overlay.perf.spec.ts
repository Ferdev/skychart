import { expect, test, type Page } from "@playwright/test";
import { openAtlas } from "./atlas-test-utils";

const EARTH_SKY = "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=82.0,-28.7,72.0";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC", "base64");

function footprints(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    return {
      id, title: `Photo ${index}`, author: "Observer", licence: "CC BY 4.0", captured_at: "2026-10-08T00:00:00Z",
      thumbnail_url: "/overlay-image.png", image_url: "/overlay-image.png",
      wcs: {
        ra_deg: 40 + (index % 20) * 4.5, dec_deg: -40 + Math.floor(index / 20) * 8, pixel_scale_arcsec: 3.6, rotation_deg: 0, width: 1600, height: 1067,
        cd: [-0.001, 0, 0, 0.001], crpix: [800.5, 534], projection: "TAN", frame: "ICRS", epoch: "J2000", status: "solved",
      },
    };
  });
}

/** Frame intervals while the view moves. The drag makes one new Sky frame for each animation frame. */
async function moveAndSample(page: Page) {
  await page.mouse.move(800, 500);
  await page.mouse.down();
  const samples = page.evaluate(async () => {
    const intervals: number[] = [];
    let before = performance.now();
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      if (frame > 10) intervals.push(now - before);
      before = now;
    }
    return intervals.sort((a, b) => a - b);
  });
  for (let step = 0; step < 90; step += 1) await page.mouse.move(800 + Math.sin(step / 8) * 90, 500 + Math.cos(step / 8) * 40);
  const intervals = await samples;
  await page.mouse.up();
  return { median: intervals[Math.floor(intervals.length / 2)]!, p95: intervals[Math.floor(intervals.length * 0.95)]! };
}

test("200 footprints in view stay near the frame rate of the same Sky view with no photos", async ({ page }) => {
  test.setTimeout(180_000);
  let photos: unknown[] = [];
  await page.route("**/api/community/config", (route) => route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/community/session", (route) => route.fulfill({ json: { user: null, csrf: "", review_count: 0 } }));
  await page.route("**/api/photos/index?**", (route) => route.fulfill({ json: { version: 1, more: false, items: [] } }));
  await page.route("**/overlay-image.png", (route) => route.fulfill({ contentType: "image/png", body: image }));
  await page.route("**/api/photos/sky?**", (route) => route.fulfill({ json: { photos } }));
  await openAtlas(page, EARTH_SKY);
  await expect(page.locator("#sky-view-status")).toContainText("loaded", { timeout: 30_000 });
  const without = await moveAndSample(page);

  photos = footprints(200);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.reload();
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#sky-view-status")).toContainText("loaded", { timeout: 30_000 });
  await expect.poll(() => page.locator(".community-sky-photo").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const withPhotos = await moveAndSample(page);
  console.log(`Sky frame intervals in ms: no photos ${JSON.stringify(without)}, 200 footprints ${JSON.stringify(withPhotos)}`);
  expect(withPhotos.p95).toBeLessThan(without.p95 * 1.5 + 20);
});
