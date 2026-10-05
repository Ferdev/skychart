import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("Jupiter becomes a shaded 3D body near its physical surface", async ({ page, context }, testInfo) => {
  const issues = collectBrowserIssues(page);
  const jupiterRadiusKm = 69_911;
  const auKm = 149_597_870.7;
  const jupiterX = -5;
  const observerX = jupiterX + (jupiterRadiusKm + 30) / auKm;
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") {
      const fixture = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
      payload = { ...fixture, bodies: [...fixture.bodies, {
        key: "jupiter", name: "Jupiter", radius_km: jupiterRadiusKm, color: "#d5a87a",
        object_type: "planet", parent_key: "sun", catalog_group: "core",
        position: { x_au: jupiterX, y_au: 0, z_au: 0, x_km: jupiterX * auKm, y_km: 0, z_km: 0,
          heliocentric_distance_km: Math.abs(jupiterX) * auKm },
      }] };
    }
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/catalog/sky") payload = { points: [], returned: 0, nearby_returned: 0 };
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));

  const state = new URLSearchParams({
    v: "1", c: "-5,0", z: "1000000", t: "2026-08-26T12:00:00.000Z", o: "jupiter", L: "",
    u3: `${observerX},0,0`, u3c: "180,0,72,0.00001", u3t: "jupiter",
  });
  await openAtlas(page, `/?${state}`);
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect.poll(() => page.locator("#universe-bodies").getAttribute("data-visible-bodies"))
    .toContain("jupiter");
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeGreaterThan(1280);
  await expect(page.locator("#universe-selection-connector")).toHaveAttribute("data-sphere", "true");
  await expect(page.locator("#universe-target-meta")).toContainText("30 km above modeled surface");
  const centerPixel = await page.locator("#universe-bodies").evaluate((canvas: HTMLCanvasElement) => {
    const x = Math.floor(canvas.width / 2), y = Math.floor(canvas.height / 2);
    const webgl = canvas.getContext("webgl");
    if (webgl) {
      const color = new Uint8Array(4);
      webgl.readPixels(x, y, 1, 1, webgl.RGBA, webgl.UNSIGNED_BYTE, color);
      return [...color];
    }
    return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data];
  });
  expect(centerPixel[3]).toBeGreaterThan(200);
  expect(centerPixel[0]).toBeGreaterThan(centerPixel[2]);
  await page.screenshot({ path: testInfo.outputPath("jupiter-30km-surface.png") });

  await page.locator("#universe-focus").click();
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeLessThan(500);
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeGreaterThan(100);
  await expect(page.locator("#universe-target-meta")).not.toContainText("inside modeled radius");
  await page.screenshot({ path: testInfo.outputPath("jupiter-focused-sphere.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeGreaterThan(50);
  await expect(page.locator("#universe-bodies")).toHaveCSS("width", "390px");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#universe-close").click();
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeLessThan(500);
  await expect.poll(async () => Number(await page.locator("#universe-bodies").getAttribute("data-largest-radius-px")))
    .toBeGreaterThan(100);
  issues.assertClean();
});
