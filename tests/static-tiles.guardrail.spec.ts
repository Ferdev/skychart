import { expect, test } from "@playwright/test";
import { installAtlasPerfInstrumentation, openAtlas, readAtlasPerf, waitForCatalogRequestsToSettle } from "./atlas-test-utils";

const EMPTY_SMP2_TILE = "SMP2\u0000\u0000\u0000\u0000";

const TEST_TILE_LEVELS = [
  { span_log2: 38, span_au: 274_877_906_944, max_points_per_tile: 4096, sample_buckets: 2 },
  { span_log2: 40, span_au: 1_099_511_627_776, max_points_per_tile: 4096, sample_buckets: 2 },
  { span_log2: 42, span_au: 4_398_046_511_104, max_points_per_tile: 4096, sample_buckets: 2 },
  { span_log2: 44, span_au: 17_592_186_044_416, max_points_per_tile: 4096, sample_buckets: 2 },
  { span_log2: 46, span_au: 70_368_744_177_664, max_points_per_tile: 4096, sample_buckets: 2 },
  { span_log2: 48, span_au: 281_474_976_710_656, max_points_per_tile: 4096, sample_buckets: 2 }
];

function staticLayer(id: string, groups: string[], types: string[]) {
  return {
    id,
    tile_url_template: `/catalog-tiles/v1/layers/${id}/s{span_log2}/x{x}/y{y}.bin`,
    groups,
    types,
    levels: TEST_TILE_LEVELS
  };
}

async function routeStaticTileFixture(page: import("@playwright/test").Page, layers: ReturnType<typeof staticLayer>[]) {
  await page.route("**/api/ephemeris**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) });
  });
  await page.route("**/api/catalog", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: { solar_system: 2 }, available_groups: [] }) });
  });
  await page.route("**/api/catalog/viewport**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) });
  });
  await page.route("**/catalog-tiles/v1/manifest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: "test-static-tiles", format: "SMP2", layers })
    });
  });
}

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
          layers: [
            {
              id: "gaia_stars",
              tile_url_template: "/catalog-tiles/v1/layers/gaia_stars/s{span_log2}/x{x}/y{y}.bin",
              groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"],
              types: ["star"],
              levels: [
                { span_log2: 18, span_au: 262_144, max_points_per_tile: 4096, sample_buckets: 4 },
                { span_log2: 22, span_au: 4_194_304, max_points_per_tile: 4096, sample_buckets: 3 },
                { span_log2: 26, span_au: 67_108_864, max_points_per_tile: 4096, sample_buckets: 2 }
              ]
            },
            {
              id: "deep_sky",
              tile_url_template: "/catalog-tiles/v1/layers/deep_sky/s{span_log2}/x{x}/y{y}.bin",
              groups: ["messier_deep_sky", "simbad_extragalactic"],
              types: ["galaxy", "quasar", "active_galaxy", "nebula", "star_cluster"],
              levels: [
                { span_log2: 18, span_au: 262_144, max_points_per_tile: 4096, sample_buckets: 4 },
                { span_log2: 22, span_au: 4_194_304, max_points_per_tile: 4096, sample_buckets: 3 },
                { span_log2: 26, span_au: 67_108_864, max_points_per_tile: 4096, sample_buckets: 2 }
              ]
            }
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

    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Object filters"] [data-body-filter="deep_sky"]')?.click();
    });
    await expect
      .poll(() => staticTileRequests, { timeout: 15_000, message: "deep-sky static catalog tile requests" })
      .toBeGreaterThan(1);
    await waitForCatalogRequestsToSettle(page, 400, 15_000);

    const perf = await readAtlasPerf(page);
    expect(perf.fetches.some((entry) => entry.url.includes("/catalog-tiles/v1/layers/gaia_stars/") && entry.url.endsWith(".bin"))).toBe(true);
    expect(perf.fetches.some((entry) => entry.url.includes("/catalog-tiles/v1/layers/deep_sky/") && entry.url.endsWith(".bin"))).toBe(true);
    expect(dynamicPointRequests, "dynamic /api/catalog/points.bin requests").toBe(0);
    expect(perf.fetches.filter((entry) => entry.url.includes("/api/catalog/points.bin"))).toEqual([]);
  });

  test("wide galaxy view caps static tile requests globally and skips low-priority default layers", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);

    const staticTileUrls = new Set<string>();
    const layers = [
      staticLayer("gaia_stars", ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"], ["star"]),
      staticLayer("exoplanet_systems", ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"], []),
      staticLayer("small_bodies", ["jpl_small_bodies"], ["asteroid", "comet", "small_body"]),
      staticLayer("deep_sky", ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "curated_extragalactic_survey"], [
        "galaxy",
        "quasar",
        "active_galaxy",
        "black_hole",
        "pulsar",
        "nebula",
        "star_cluster"
      ])
    ];

    await routeStaticTileFixture(page, layers);
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      staticTileUrls.add(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "x-starsmap-total": "0", "x-starsmap-returned": "0" },
        body: EMPTY_SMP2_TILE
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="galaxy"]').click();
    await expect.poll(() => staticTileUrls.size, { timeout: 10_000, message: "wide static tile requests" }).toBeGreaterThan(0);
    await page.waitForTimeout(350);

    const urls = Array.from(staticTileUrls);
    expect(urls.length, "wide-view active static tile URLs should use one global cap, not per-layer caps").toBeLessThanOrEqual(8);
    expect(urls.some((url) => url.includes("/layers/gaia_stars/"))).toBe(true);
    expect(urls.some((url) => url.includes("/layers/deep_sky/"))).toBe(true);
    expect(urls.some((url) => url.includes("/layers/exoplanet_systems/"))).toBe(false);
    expect(urls.some((url) => url.includes("/layers/small_bodies/"))).toBe(false);
  });

  test("broad universe view does not request overlapping subtype layers or prefetch hundreds of tiles", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);

    let dynamicPointRequests = 0;
    const staticTileUrls = new Set<string>();
    const layers = [
      staticLayer("gaia_stars", ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"], ["star"]),
      staticLayer("exoplanet_systems", ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"], []),
      staticLayer("small_bodies", ["jpl_small_bodies"], ["asteroid", "comet", "small_body"]),
      staticLayer("deep_sky", ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "curated_extragalactic_survey"], [
        "galaxy",
        "quasar",
        "active_galaxy",
        "black_hole",
        "pulsar",
        "nebula",
        "star_cluster"
      ]),
      staticLayer("galaxies", ["messier_deep_sky", "simbad_extragalactic", "curated_extragalactic_survey"], ["galaxy"]),
      staticLayer("quasars", ["simbad_extragalactic", "curated_extragalactic_survey"], ["quasar"]),
      staticLayer("active_galaxies", ["simbad_extragalactic", "curated_extragalactic_survey"], ["active_galaxy"]),
      staticLayer("black_holes", ["simbad_compact_objects"], ["black_hole"]),
      staticLayer("pulsars", ["simbad_compact_objects"], ["pulsar"]),
      staticLayer("nebulae", ["messier_deep_sky"], ["nebula"]),
      staticLayer("star_clusters", ["messier_deep_sky"], ["star_cluster"])
    ];

    await routeStaticTileFixture(page, layers);
    await page.route("**/api/catalog/points.bin**", async (route) => {
      dynamicPointRequests += 1;
      await route.fulfill({ status: 599, body: "dynamic point fallback must not be used when a static tile manifest is valid" });
    });
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      staticTileUrls.add(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "x-starsmap-total": "0", "x-starsmap-returned": "0" },
        body: EMPTY_SMP2_TILE
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="cosmicWeb"]').click();
    await waitForCatalogRequestsToSettle(page, 1_200, 20_000);

    const urls = Array.from(staticTileUrls);
    expect(dynamicPointRequests, "dynamic /api/catalog/points.bin requests").toBe(0);
    expect(urls.length, "unique static tile URLs for a broad universe view").toBeLessThanOrEqual(24);
    expect(urls.some((url) => url.includes("/layers/deep_sky/"))).toBe(true);
    expect(urls.some((url) => url.includes("/layers/quasars/"))).toBe(false);
    expect(urls.some((url) => url.includes("/layers/black_holes/"))).toBe(false);
    expect(urls.some((url) => url.includes("/layers/nebulae/"))).toBe(false);
  });

  test("renders catalog point tiles progressively while a sibling tile is still pending", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);

    const layers = [staticLayer("progressive_deep_sky", ["messier_deep_sky", "simbad_extragalactic", "simbad_compact_objects"], [])];
    let tileRequests = 0;
    let releaseLoadedTiles = () => {};
    const loadedTilesCanFinish = new Promise<void>((resolve) => {
      releaseLoadedTiles = resolve;
    });

    await routeStaticTileFixture(page, layers);
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      tileRequests += 1;
      if (tileRequests === 1) return;
      await loadedTilesCanFinish;
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "x-starsmap-total": "0", "x-starsmap-returned": "0" },
        body: EMPTY_SMP2_TILE
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="cosmicWeb"]').click();
    await expect.poll(() => tileRequests, { timeout: 10_000, message: "multiple static tile requests" }).toBeGreaterThan(1);
    await expect.poll(async () => (await readAtlasPerf(page)).rafCount, { timeout: 5_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(100);

    await page.evaluate(() => (window as Window & { __resetAtlasPerf?: () => void }).__resetAtlasPerf?.());
    releaseLoadedTiles();

    await expect
      .poll(async () => (await readAtlasPerf(page)).rafCount, {
        timeout: 5_000,
        message: "a loaded tile should schedule a render even while another tile is still pending"
      })
      .toBeGreaterThan(0);
  });

  test("opening the search workspace focuses the catalog search field", async ({ page }) => {
    await routeStaticTileFixture(page, []);
    await openAtlas(page);

    await page.locator('[data-tab="catalog"]').click();
    await page.keyboard.type("m31");

    await expect(page.locator("#body-search")).toHaveValue("m31");
  });
});
