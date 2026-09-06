import { expect, test } from "@playwright/test";
import { openAtlas, selectCatalogObject, skyEphemerisFixture } from "./atlas-test-utils";
import { spacecraftBodies } from "../src/catalog/spacecraftCatalog";

for (const width of [1440, 390]) {
  test(`spacecraft reuse search and details at ${width}px with historical availability`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const timestamp = url.searchParams.get("timestamp") ?? "2026-09-06T00:00:00Z";
      let payload: unknown = {};
      if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(timestamp);
      if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {} };
      if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, offset: 0, limit: 50, has_more: false };
      if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
      if (url.pathname === "/api/now") payload = { events: [], stale: false };
      if (url.pathname === "/api/spacecraft") {
        const bodies = spacecraftBodies(timestamp).map(body => {
          const available = body.key === "spacecraft-31" || (body.key === "spacecraft-82" && timestamp.startsWith("2010"));
          return { ...body, spacecraft: { ...body.spacecraft, availability: available ? "available" : "out_of_coverage" },
            position: available ? { x_au: 150, y_au: 30, z_au: 40, x_km: 150*149597870.7, y_km: 30*149597870.7, z_km: 40*149597870.7, heliocentric_distance_km: 158*149597870.7 } : null,
            distance_from_earth_km: available ? 25_000_000_000 : null };
        });
        payload = { timestamp_utc: timestamp, bodies };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    });
    await context.route("**/catalog-tiles/**", route => route.fulfill({ status: 404, body: "" }));
    await openAtlas(page);
    await selectCatalogObject(page, "Voyager 1", "spacecraft-31");
    await expect(page.locator("#body-info")).toContainText("Estimated one-way light time");
    await expect(page.locator("#body-info")).toContainText("Spacecraft");
    await expect(page.locator("#center-selected")).toBeEnabled();
    const replayUrl = page.url();
    await openAtlas(page, replayUrl);
    await expect(page.locator("#selected-summary-name")).toHaveText("Voyager 1");
    await selectCatalogObject(page, "Cassini", "spacecraft-82");
    await expect(page.locator("#body-info")).toContainText("Outside trajectory coverage");
    await expect(page.locator("#center-selected")).toBeDisabled();
    await expect(page.locator("#body-info")).not.toContainText("NaN");
    // Exercise the existing time controls, even when collapsed on mobile.
    await page.locator("#time-input").evaluate((input: HTMLInputElement) => { input.value = "2010-01-01T00:00:00"; });
    await page.locator("#apply-time").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#center-selected")).toBeEnabled();
    await expect(page.locator("#body-info")).toContainText("Position available");
    await page.locator("#time-input").evaluate((input: HTMLInputElement) => { input.value = "2026-09-06T00:00:00"; });
    await page.locator("#apply-time").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#center-selected")).toBeDisabled();
    await expect(page.locator("#body-info")).toContainText("Outside trajectory coverage");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
