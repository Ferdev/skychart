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
  await openAtlas(page, "/?v=1&c=-5,0&z=24&t=2026-08-26T12:00:00.000Z&L=&perf=1");
  await expect(page.locator("#universe-3d-toggle")).toHaveAccessibleName("Explore the universe in 3D");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-map")).toBeFocused();
  await expect(page.locator("#universe-status")).toHaveText("2 sampled catalog positions loaded");
  await expect(page.locator("#universe-minimap")).toHaveAttribute("data-route", "none");
  // With no selected object the view starts with the Sun in its centre, and the autopilot says that it has no target.
  await expect(page.locator("#universe-autopilot")).toHaveText("Cruise forward");
  await expect.poll(async () => (await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.universeLabels())).map((label) => label.name)).toContain("Sun");
  await page.locator("#universe-map").click({ position: { x: 720, y: 500 } });
  await expect(page.locator("#universe-target")).toBeVisible();
  await expect(page.locator("#universe-target-name")).toHaveText("Sun");
  // A destination from the search is the new target, and the view turns to it.
  await page.locator("#universe-find").click();
  await page.locator("#universe-search-input").fill("Fixture A");
  await expect(page.locator("#universe-search-results [role=option]")).toContainText("Fixture A");
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  await expect(page.locator("#universe-autopilot")).toHaveText("Start autopilot");
  // The trip map shows the route to a newly selected object at once.
  await expect(page.locator("#universe-minimap")).toHaveAttribute("data-route", "direct");
  // A selection shows the target card only: no panel covers the object. `Details` opens the inspector.
  await expect(page.locator("#selected-object-panel")).toBeHidden();
  await expect(page.locator("#universe-selection-summary")).toHaveCount(0);
  await expect(page.locator("#universe-target-magnitude")).toContainText("Brightness from here: magnitude");
  await expect(page.locator("#universe-target-magnitude")).toContainText(/\((brighter than the full Moon|visible with the eye|visible with binoculars|needs a telescope)\)$/);
  const flightBefore = await page.locator(".universe-view__flight").boundingBox();
  await page.locator("#universe-details").click();
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#body-info [data-object-view=\"science\"]")).toHaveCount(1);
  await expect(page.locator("#universe-selection-connector")).toBeVisible();
  await expect(page.locator("#universe-selection-connector")).toHaveAttribute("data-source-key", "fixture-a");
  await expect(page.locator("#universe-target")).toBeVisible();
  expect(await page.locator(".universe-view__flight").boundingBox(), "the flight panel does not move when the inspector opens").toEqual(flightBefore);
  // The labels show names only, and no label is on a control.
  const labels = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.universeLabels());
  for (const label of labels) expect(label.name).not.toMatch(/ · -?\d/);
  const controlBoxes = await page.locator(".universe-view__header, #universe-minimap-panel, .universe-view__flight, #universe-target").evaluateAll((controls) =>
    controls.map((control) => control.getBoundingClientRect()).filter((box) => box.width > 0).map((box) => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })));
  for (const label of labels) {
    for (const box of controlBoxes) {
      expect(label.rect.left < box.right && box.left < label.rect.right && label.rect.top < box.bottom && box.top < label.rect.bottom, `${label.name} is on a control`).toBe(false);
    }
  }
  await page.locator("#close-panel").click();
  await expect(page.locator("#selected-object-panel")).toBeHidden();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
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
  // The full catalog sample loads one time. A new target or `Details` can ask for the nearby objects again.
  expect(observerRequests.filter((request) => !request.localOnly)).toHaveLength(1);

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
  // The flight above can end at the target, where the autopilot has nothing to do. Start again from the entry position.
  await page.locator("#universe-reset").click();
  await expect(page.locator("#universe-autopilot")).toBeEnabled();
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
  await page.locator("#universe-close").click();

  await page.goto(replayUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  await expect(page.locator("#universe-sky")).toBeEnabled();

  // Sky view that opens from 3D goes back to the same 3D position and target.
  const beforeSky = { position: await page.locator("#universe-position").textContent(), target: await page.locator("#universe-target-name").textContent() };
  await expect.poll(() => new URL(page.url()).searchParams.has("u3")).toBe(true);
  const beforeSkyPositionParam = new URL(page.url()).searchParams.get("u3");
  await page.locator("#universe-sky").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#universe-view")).toBeHidden();
  await expect(page.locator("#sky-view-close-label")).toHaveText("Back to 3D");
  await page.locator("#sky-view-close").click();
  await expect(page.locator("#sky-view")).toBeHidden();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).toHaveText(beforeSky.position!);
  await expect(page.locator("#universe-target-name")).toHaveText(beforeSky.target!);
  await expect.poll(() => new URL(page.url()).searchParams.get("u3")).toBe(beforeSkyPositionParam);
  // The same return with the keyboard only.
  await page.locator("#universe-sky").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await page.locator("#sky-map").press("Escape");
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).toHaveText(beforeSky.position!);

  // The destination search works with the keyboard, and a destination does not move the observer.
  const beforeSearchPosition = await page.locator("#universe-position").textContent();
  await page.locator("#universe-find").click();
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  await expect(page.locator("#universe-search-input")).toBeFocused();
  await expect(page.locator("#universe-search-input")).toHaveAttribute("role", "combobox");
  // With an empty field the dialog shows suggestions and recent destinations, with the type name of each object.
  const suggestion = page.locator("#universe-search-results").getByRole("option", { name: /^Earth/ });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("Planet");
  await expect(page.locator("#universe-search-results")).toContainText("Suggestions");
  await page.locator("#universe-search-input").fill("Shell");
  await expect(page.locator("#universe-search-results")).toHaveAttribute("role", "listbox");
  await expect(page.locator("#universe-search-results [role=option]")).toHaveAttribute("aria-disabled", "true");
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  await page.locator("#universe-search-input").fill("Fixture B");
  await expect(page.locator("#universe-search-results [role=option]")).toContainText("Fixture B");
  await expect(page.locator("#universe-search-results [role=option]")).toContainText("Galaxy");
  // Enter with no active option selects the first result.
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-search-dialog")).toBeHidden();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture B");
  await expect(page.locator("#universe-map")).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("u3t")).toBe("fixture-b");
  await page.waitForTimeout(400);
  await expect(page.locator("#universe-position"), "a selected destination does not move the observer").toHaveText(beforeSearchPosition!);
  // `Jump there` moves the observer to the destination.
  await expect(page.locator("#universe-fly")).toHaveText("Fly there");
  await expect(page.locator("#universe-focus")).toHaveText("Jump there");
  await page.locator("#universe-focus").click();
  await expect(page.locator("#universe-position")).not.toHaveText(beforeSearchPosition!);
  const positionAtFixtureB = await page.locator("#universe-position").textContent();

  await page.locator("#universe-find").click();
  await expect(page.locator("#universe-search-dialog")).toBeVisible();
  await page.locator("#universe-search-input").fill("Fixture A");
  const option = page.locator("#universe-search-results").getByRole("option", { name: /^Fixture A/ });
  await expect(option).toBeVisible();
  await page.locator("#universe-search-input").press("ArrowDown");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#universe-search-input")).toHaveAttribute("aria-activedescendant", await option.getAttribute("id") ?? "");
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-search-dialog")).toBeHidden();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  await expect.poll(() => new URL(page.url()).searchParams.get("u3t")).toBe("fixture-a");
  await page.waitForTimeout(400);
  await expect(page.locator("#universe-position")).toHaveText(positionAtFixtureB!);

  // One Escape press does not exit 3D during a flight. The exit needs a second press.
  // The first press closes the inspector and keeps 3D and its target.
  await page.locator("#universe-details").click();
  await expect(page.locator("#workspace-panel")).toBeVisible();
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#workspace-panel")).toBeHidden();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  await page.locator("#universe-fly").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#universe-view")).toBeVisible();
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#universe-status")).toHaveText("Press Esc again to exit 3D");
  await expect(page.locator("#universe-view")).toBeVisible();
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#universe-view")).toBeHidden();
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  // After 2 s the first press does not count any more.
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#universe-status")).toHaveText("Press Esc again to exit 3D");
  await page.waitForTimeout(2_300);
  await page.locator("#universe-map").press("Escape");
  await expect(page.locator("#universe-view")).toBeVisible();
  await page.locator("#universe-find").click();
  await page.locator("#universe-search-input").fill("Fixture A");
  await expect(page.locator("#universe-search-results [role=option]")).toContainText("Fixture A");
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-search-dialog")).toBeHidden();
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
  await expect.poll(() => new URL(page.url()).searchParams.get("u3t")).toBe("fixture-a");
  // `Inspect in 2D` leaves 3D with the target as the selected object of the map.
  await page.locator("#universe-inspect").click();
  await expect(page.locator("#universe-view")).toBeHidden();
  await expect(page.locator("#selected-object-panel")).toHaveAttribute("data-selected-key", "fixture-a");
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
