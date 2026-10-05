import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("free-flight 3D universe navigation moves through catalog coordinates and restores from history", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  const observerRequests: Array<{ x: number; y: number; z: number; localOnly: boolean }> = [];
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: url.searchParams.get("q")?.toLowerCase().includes("fixture a") ? [{
      key: "fixture-a", name: "Fixture A", object_type: "star", catalog_group: "bright_stars",
      source_type: "test_catalog", position_model: "catalog_distance", color: "#f8cb65",
      astrometry: { apparent_magnitude: 1, distance_ly: 0.000158 }, position: { x_au: -10, y_au: 0, z_au: 0 },
    }] : url.searchParams.get("q")?.toLowerCase().includes("fixture b") ? [{
      key: "fixture-b", name: "Fixture B", object_type: "galaxy", catalog_group: "deep_sky",
      source_type: "test_catalog", position_model: "catalog_distance", color: "#82cbb3",
      astrometry: { apparent_magnitude: 3, distance_ly: 0.0016 }, position: { x_au: -95, y_au: 30, z_au: 8 },
    }] : url.searchParams.get("q")?.toLowerCase().includes("shell") ? [{
      key: "shell", name: "Shell", object_type: "galaxy", catalog_group: "deep_sky",
      source_type: "test_catalog", position_model: "catalog_sky_position_reference_shell",
      position: { x_au: -20, y_au: 0, z_au: 0 },
    }] : [], total: 1, has_more: false };
    if (url.pathname === "/api/catalog/sky") {
      if (!url.searchParams.has("observer_key")) {
        expect(url.searchParams.get("physical_only")).toBe("1");
        expect(Number(url.searchParams.get("near_radius_au"))).toBeGreaterThan(0);
      }
      const observer = {
        x: Number(url.searchParams.get("observer_x_au")),
        y: Number(url.searchParams.get("observer_y_au")),
        z: Number(url.searchParams.get("observer_z_au")),
        localOnly: url.searchParams.get("local_only") === "1",
      };
      observerRequests.push(observer);
      const catalogPoint = (key: string, name: string, type: string, color: string,
        magnitude: number, position: { x: number; y: number; z: number }) => {
        const delta = { x: position.x - observer.x, y: position.y - observer.y, z: position.z - observer.z };
        const distance = Math.hypot(delta.x, delta.y, delta.z);
        return { key, name, object_type: type, color, apparent_magnitude: magnitude,
          distance_au: distance, direction: { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance } };
      };
      payload = {
        returned: 2,
        nearby_returned: 2,
        points: [
          catalogPoint("fixture-a", "Fixture A", "star", "#f8cb65", 1, { x: -10, y: 0, z: 0 }),
          catalogPoint("fixture-b", "Fixture B", "galaxy", "#82cbb3", 3, { x: -95, y: 30, z: 8 }),
        ],
      };
    }
    if (url.pathname === "/api/objects/fixture-a") payload = { object: {
      key: "fixture-a", name: "Fixture A", object_type: "star", catalog_group: "bright_stars",
      source_type: "test_catalog", position_model: "catalog_distance", color: "#f8cb65",
      astrometry: { apparent_magnitude: 1, distance_ly: 0.000158 },
      position: { x_au: -10, y_au: 0, z_au: 0 },
    } };
    if (url.pathname === "/api/objects/fixture-b") payload = { object: {
      key: "fixture-b", name: "Fixture B", object_type: "galaxy", catalog_group: "deep_sky",
      source_type: "test_catalog", position_model: "catalog_distance", color: "#82cbb3",
      astrometry: { apparent_magnitude: 3, distance_ly: 0.0016 }, position: { x_au: -95, y_au: 30, z_au: 8 },
    } };
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));

  // Begin between the Sun and Fixture A; the Sun now correctly occludes stars
  // behind its disk, so the old collinear Sun-origin fixture is not selectable.
  await openAtlas(page, "/?v=1&c=-5,0&z=24&t=2026-08-26T12:00:00.000Z&L=");
  await expect(page.locator("#universe-3d-toggle")).toHaveAccessibleName("Explore the universe in 3D");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-map")).toBeFocused();
  await expect(page.locator("#universe-status")).toHaveText("2 sampled catalog positions loaded");
  await expect(page.locator("#universe-minimap")).toHaveAttribute("data-route", "none");
  await page.locator("#universe-map").click({ position: { x: 720, y: 500 } });
  await expect(page.locator("#universe-target")).toBeVisible();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  // The trip map shows the route to a newly selected object at once.
  await expect(page.locator("#universe-minimap")).toHaveAttribute("data-route", "direct");
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#body-info [data-object-view=\"science\"]")).toHaveCount(1);
  await expect(page.locator("#universe-selection-connector")).toBeVisible();
  await expect(page.locator("#universe-selection-connector")).toHaveAttribute("data-source-key", "fixture-a");
  await expect(page.locator("#universe-target-magnitude")).toContainText("Estimated from here");
  await page.screenshot({ path: testInfo.outputPath("universe-3d.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileControlsInsideViewport = await page.locator("#universe-view button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight;
  }));
  expect(mobileControlsInsideViewport).toBe(true);
  await page.locator("#universe-find").click();
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  const mobileDialog = await page.locator("#universe-search-dialog").boundingBox();
  expect(mobileDialog!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDialog!.x + mobileDialog!.width).toBeLessThanOrEqual(390);
  await page.locator("#universe-search-close").click();
  await page.screenshot({ path: testInfo.outputPath("universe-3d-mobile.png") });
  await expect.poll(() => new URL(page.url()).searchParams.has("u3")).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.has("u3c")).toBe(true);
  expect(observerRequests).toHaveLength(1);

  const initialPosition = await page.locator("#universe-position").textContent();
  await page.locator("#universe-map").press("w");
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  const movedUrl = new URL(page.url());
  expect(movedUrl.searchParams.get("u3")).not.toBe("0,0,0");

  await page.locator("#universe-map").focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(70);
  const startOfHold = await page.locator("#universe-position").textContent();
  await page.waitForTimeout(350);
  const endOfHold = await page.locator("#universe-position").textContent();
  await page.keyboard.up("w");
  expect(endOfHold).not.toBe(startOfHold);

  // The speed gauge is an indicator, not a control: it returns to zero at rest.
  await expect(page.locator("#universe-speed-gauge")).toHaveAttribute("role", "meter");
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c", { timeout: 30_000 });
  await expect(page.locator("#universe-speed-gauge")).toHaveAttribute("aria-valuenow", "0.000");
  const beforeAutopilot = await page.locator("#universe-position").textContent();
  await page.locator("#universe-autopilot").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#universe-position")).not.toHaveText(beforeAutopilot!);
  await page.locator("#universe-autopilot").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#universe-map").press("ArrowRight");
  await expect.poll(() => new URL(page.url()).searchParams.get("u3c")).not.toBe(movedUrl.searchParams.get("u3c"));

  await page.setViewportSize({ width: 1280, height: 800 });
  const beforeFocus = await page.locator("#universe-position").textContent();
  await page.locator("#universe-focus").click();
  await expect(page.locator("#universe-position")).not.toHaveText(beforeFocus!);
  await expect.poll(() => observerRequests.length).toBeGreaterThan(1);
  expect(observerRequests.slice(1).some((request) => request.localOnly)).toBe(true);

  const replayUrl = page.url();
  await page.locator("#universe-close").click();
  await expect(page.locator("#universe-view")).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("u3")).toBe(false);
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#universe-selection-connector")).toBeVisible();
  await page.locator("#universe-close").click();

  await page.goto(replayUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  await expect(page.locator("#universe-sky")).toBeEnabled();
  await page.locator("#universe-sky").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await page.locator("#sky-view-close").click();
  await page.locator("#universe-3d-toggle").click();
  const beforeSearchPosition = await page.locator("#universe-position").textContent();
  await page.locator("#universe-find").click();
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  await page.locator("#universe-search-input").fill("Shell");
  await expect(page.locator("#universe-search-results button")).toBeDisabled();
  await page.locator("#universe-search-input").fill("Fixture B");
  await page.locator("#universe-search-results button").click();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture B");
  await page.locator("#universe-find").click();
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  await page.locator("#universe-search-input").fill("Fixture A");
  await page.locator("#universe-search-results").getByRole("button", { name: /^Fixture A/ }).click();
  await expect(page.locator("#universe-search-dialog")).toBeHidden();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  await expect(page.locator("#universe-position")).not.toHaveText(beforeSearchPosition!);
  await expect.poll(() => new URL(page.url()).searchParams.get("u3t")).toBe("fixture-a");
  await expect(page.locator("#selected-object-panel")).toHaveAttribute("data-selected-key", "fixture-a");
  await page.locator("#universe-inspect").click();
  await expect(page.locator("#universe-view")).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get("c")).toBe("-10,0");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  const missingTargetUrl = new URL(page.url());
  missingTargetUrl.searchParams.set("u3t", "missing-target");
  missingTargetUrl.searchParams.delete("o");
  await page.goto(missingTargetUrl.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#universe-status")).toContainText("Destination missing-target is unavailable");
  await expect(page.locator("#universe-target")).toBeHidden();
  issues.assertClean();
});
