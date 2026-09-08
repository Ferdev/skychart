import { expect, test } from "@playwright/test";
import { openAtlas, selectCatalogObject, skyEphemerisFixture } from "./atlas-test-utils";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let payload: unknown = {};
    if (path === "/api/ephemeris") payload = skyEphemerisFixture("2026-09-08T00:00:00Z");
    if (path === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {} };
    if (path === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (path === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (path === "/api/spacecraft") payload = { bodies: [] };
    if (path === "/api/now") payload = { events: [], stale: false };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/catalog-tiles/**", route => route.fulfill({ status: 404, body: "" }));
});

for (const width of [1440, 2048]) {
  test(`desktop map renders and hit-tests objects beside the scale panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "Sun", "sun");

    const geometry = await page.evaluate(() => {
      const scale = document.querySelector(".scale-rail")!.getBoundingClientRect();
      return { ...window.__ATLAS_DIAGNOSTICS__!.selectionGeometry(), scaleTop: scale.top, scaleRight: scale.right };
    });
    const target = { x: (geometry.scaleRight + geometry.usable.right) / 2, y: (geometry.scaleTop + 990) / 2 };
    expect(target.y).toBeGreaterThan(geometry.scaleTop + 80);
    const sun = geometry.selected!;
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, sun)).toBe("map");
    await page.mouse.move(sun.x, sun.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();
    await page.mouse.move(target.x + 20, target.y);
    await page.mouse.move(target.x, target.y);
    await expect(page.locator("#map")).toHaveCSS("cursor", "pointer");
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
      const dpr = canvas.width / innerWidth;
      const pixels = canvas.getContext("2d")!.getImageData(Math.floor((x - 4) * dpr), Math.floor((y - 4) * dpr), Math.ceil(8 * dpr), Math.ceil(8 * dpr)).data;
      return pixels.some((value, index) => index % 4 === 0 && value > 180);
    }, target)).toBe(true);
  });
}

test("mobile map still stops above the object detail sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAtlas(page, "/?perf=1");
  await selectCatalogObject(page, "Sun", "sun");
  const geometry = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
  expect(geometry.workspaceTop).not.toBeNull();
  expect(geometry.usable.bottom).toBeLessThanOrEqual(geometry.workspaceTop! - 10);
  expect(geometry.selected!.y).toBeLessThan(geometry.usable.bottom);
});
