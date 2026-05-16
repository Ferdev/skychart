import { expect, test } from "@playwright/test";
import { installAtlasPerfInstrumentation, openAtlas, readAtlasPerf, waitForCatalogRequestsToSettle } from "./atlas-test-utils";

const EMPTY_SMP2_TILE = "SMP2\u0000\u0000\u0000\u0000";

const EPHEMERIS_FIXTURE = {
  timestamp_utc: "2026-01-01T00:00:00Z",
  generated_at_utc: "2026-01-01T00:00:00Z",
  data_source: "playwright fixture",
  coordinate_frame: "heliocentric_ecliptic_cartesian_au",
  au_km: 149_597_870.7,
  catalog: {
    object_count: 2,
    group_counts: { solar_system: 2 }
  },
  bodies: [
    {
      key: "sun",
      name: "Sun",
      object_type: "star",
      catalog_group: "solar_system",
      color: "#ffd36a",
      radius_km: 695_700,
      position: { x_au: 0, y_au: 0, z_au: 0 },
      state_vector: { x_au: 0, y_au: 0, z_au: 0, vx_au_per_day: 0, vy_au_per_day: 0, vz_au_per_day: 0 }
    },
    {
      key: "earth",
      name: "Earth",
      object_type: "planet",
      parent_key: "sun",
      catalog_group: "solar_system",
      color: "#86b7ff",
      radius_km: 6_371,
      position: { x_au: 1, y_au: 0, z_au: 0 },
      state_vector: { x_au: 1, y_au: 0, z_au: 0, vx_au_per_day: 0, vy_au_per_day: 0.0172, vz_au_per_day: 0 }
    }
  ]
};

test.describe("static catalog tile guardrails", () => {
  test("valid static manifest uses catalog-tiles and never calls dynamic points fallback", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);

    let dynamicPointRequests = 0;
    let staticTileRequests = 0;

    await page.route("**/api/ephemeris**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) });
    });
    await page.route("**/api/catalog", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: { solar_system: 2 }, available_groups: [] }) });
    });
    await page.route("**/api/catalog/viewport**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) });
    });
    await page.route("**/api/catalog/points.bin**", async (route) => {
      dynamicPointRequests += 1;
      await route.fulfill({ status: 599, body: "dynamic point fallback must not be used when a static tile manifest is valid" });
    });
    await page.route("**/catalog-tiles/v1/manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: "test-static-tiles",
          format: "SMP2",
          tile_url_template: "/catalog-tiles/v1/s{span_log2}/x{x}/y{y}.bin",
          groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"],
          levels: [
            { span_log2: 18, span_au: 262_144, max_points_per_tile: 4096, sample_buckets: 4 },
            { span_log2: 22, span_au: 4_194_304, max_points_per_tile: 4096, sample_buckets: 3 },
            { span_log2: 26, span_au: 67_108_864, max_points_per_tile: 4096, sample_buckets: 2 }
          ]
        })
      });
    });
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      staticTileRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "x-starsmap-total": "0", "x-starsmap-returned": "0" },
        body: EMPTY_SMP2_TILE
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="galaxy"]').click();
    await expect
      .poll(() => staticTileRequests, { timeout: 15_000, message: "static catalog tile requests" })
      .toBeGreaterThan(0);
    await waitForCatalogRequestsToSettle(page, 400, 15_000);

    const perf = await readAtlasPerf(page);
    expect(perf.fetches.some((entry) => entry.url.includes("/catalog-tiles/v1/") && entry.url.endsWith(".bin"))).toBe(true);
    expect(dynamicPointRequests, "dynamic /api/catalog/points.bin requests").toBe(0);
    expect(perf.fetches.filter((entry) => entry.url.includes("/api/catalog/points.bin"))).toEqual([]);
  });
});
