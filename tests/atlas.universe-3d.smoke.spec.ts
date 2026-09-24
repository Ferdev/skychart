import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("free-flight 3D universe navigation moves through catalog coordinates and restores from history", async ({ page, context }, testInfo) => {
  const issues = collectBrowserIssues(page);
  const observerRequests: Array<{ x: number; y: number; z: number }> = [];
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/catalog/sky") {
      const observer = {
        x: Number(url.searchParams.get("observer_x_au")),
        y: Number(url.searchParams.get("observer_y_au")),
        z: Number(url.searchParams.get("observer_z_au")),
      };
      observerRequests.push(observer);
      payload = {
        returned: 2,
        points: [{
          key: "fixture-a",
          name: "Fixture A",
          object_type: "star",
          color: "#f8cb65",
          apparent_magnitude: 1,
          distance_au: 10,
          direction: { x: -1, y: 0, z: 0 },
        }, {
          key: "fixture-b",
          name: "Fixture B",
          object_type: "galaxy",
          color: "#82cbb3",
          apparent_magnitude: 3,
          distance_au: 100,
          direction: { x: -0.95, y: 0.3, z: 0.08 },
        }],
      };
    }
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));

  await openAtlas(page);
  await expect(page.locator("#universe-3d-toggle")).toHaveAccessibleName("Explore the universe in 3D");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-map")).toBeFocused();
  await expect(page.locator("#universe-status")).toHaveText("2 catalog positions loaded");
  await page.screenshot({ path: testInfo.outputPath("universe-3d.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileControlsInsideViewport = await page.locator("#universe-view button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
  }));
  expect(mobileControlsInsideViewport).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("universe-3d-mobile.png") });
  await expect.poll(() => new URL(page.url()).searchParams.has("u3")).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.has("u3c")).toBe(true);
  expect(observerRequests).toHaveLength(1);

  const initialPosition = await page.locator("#universe-position").textContent();
  await page.locator("#universe-map").press("w");
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  const movedUrl = new URL(page.url());
  expect(movedUrl.searchParams.get("u3")).not.toBe("0,0,0");

  const initialStep = await page.locator("#universe-speed").textContent();
  await page.locator('[data-universe-speed="faster"]').click();
  await expect(page.locator("#universe-speed")).not.toHaveText(initialStep!);
  await page.locator("#universe-map").press("ArrowRight");
  await expect.poll(() => new URL(page.url()).searchParams.get("u3c")).not.toBe(movedUrl.searchParams.get("u3c"));

  const replayUrl = page.url();
  await page.locator("#universe-close").click();
  await expect(page.locator("#universe-view")).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("u3")).toBe(false);

  await page.goto(replayUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  issues.assertClean();
});
