import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, openSearchWorkspace, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

const STATIC_POINT_TILE_WITH_ONE_POINT = (() => {
  const tile = Buffer.alloc(20);
  tile.write("SMP2", 0, "ascii");
  tile.writeUInt32LE(1, 4);
  tile.writeFloatLE(0, 8);
  tile.writeFloatLE(0, 12);
  tile.writeUInt8(224, 16);
  tile.writeUInt8(196, 17);
  tile.writeUInt8(128, 18);
  // The 4th color byte is the sprite type code; 0 renders a plain star disc.
  tile.writeUInt8(0, 19);
  return tile;
})();

const TIME_CHANGE_EPHEMERIS = {
  timestamp_utc: "2026-01-01T00:00:00Z",
  generated_at_utc: "2026-01-01T00:00:00Z",
  data_source: "playwright fixture",
  coordinate_frame: "heliocentric_ecliptic_cartesian_au",
  au_km: 149_597_870.7,
  bodies: []
};

test("time changes remain responsive while positions update", async ({ page, request }) => {
  await skipIfAtlasUnavailable(request);
  let releaseTimeUpdate: (() => void) | null = null;

  await page.route("**/api/ephemeris?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("timestamp")) {
      await new Promise<void>((resolve) => {
        releaseTimeUpdate = resolve;
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TIME_CHANGE_EPHEMERIS)
    });
  });

  await openAtlas(page);
  const timeToggle = page.locator('[aria-controls="scale-time-controls"]');
  if (await timeToggle.getAttribute("aria-expanded") !== "true") await timeToggle.click();

  await page.locator("#time-step-forward").click();
  await expect(page.locator("#time-busy")).toContainText("Updating positions");
  await expect(page.locator("#time-busy")).toBeVisible();
  await expect(page.locator("#time-step-back")).toBeDisabled();
  await expect(page.locator("#time-step-forward")).toBeDisabled();
  await expect(page.locator("#loading-screen")).toBeHidden();

  await expect.poll(() => Boolean(releaseTimeUpdate)).toBe(true);
  releaseTimeUpdate?.();

  await expect(page.locator("#time-busy")).toBeHidden();
  await expect(page.locator("#time-step-forward")).toBeEnabled();
  await expect(page.locator("#load-state")).toHaveText("ready");
});

test.describe("Cosmic Atlas browser smoke", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("catalog search selects Jupiter and shows curated media", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Jupiter");
    await expect(page.locator('#body-picker [data-body-key="jupiter"]')).toBeVisible();
    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-summary-name")).toContainText("Jupiter");

    await expect(page.locator("#selected-summary-meta")).toContainText("Planet");
    await expect(page.locator(".object-media--curated")).toBeVisible();
    await expect(page.locator(".object-media__badge").first()).toHaveText("Curated NASA image");
    await expect(page.locator(".object-media img").first()).toHaveAttribute("src", /PIA02873/);
    const position = page.locator(".data-section").filter({ has: page.getByRole("heading", { name: "Position", exact: true }) });
    await expect(position).toContainText("Ecliptic longitude");
    await expect(position).toContainText("Ecliptic latitude");

    issues.assertClean();
  });

  test("curated media and coordinate readouts appear for M13", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.route("**/viewer/jpeg-cutout?**", (route) => route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC", "base64")
    }));

    await selectCatalogObject(page, "M13", "m13", /M13/);

    await expect(page.locator(".object-media--curated")).toBeVisible();
    await expect(page.locator(".object-media__badge").first()).toHaveText("Curated NASA image");
    await expect(page.locator(".object-media img").first()).toHaveAttribute("src", /m13-xlarge_web/);
    const dr11Media = page.locator('[data-media-provider="legacy-dr11"]');
    await expect(dr11Media).toBeVisible();
    await expect(dr11Media.locator(".object-media__badge")).toHaveText("Legacy Surveys DR11");
    await expect(dr11Media.locator("img")).toHaveAttribute("src", /legacysurvey\.org\/viewer\/jpeg-cutout\?.*layer=ls-dr11/);
    await expect(dr11Media.locator("a")).toHaveAttribute("href", /legacysurvey\.org\/viewer\?.*layer=ls-dr11/);
    await expect(page.locator(".object-summary-card")).toContainText("dense star cluster");
    const position = page.locator(".data-section").filter({ has: page.getByRole("heading", { name: "Position", exact: true }) });
    await expect(position).toContainText("Right ascension");
    await expect(position).toContainText("Galactic longitude");

    issues.assertClean();
  });

  test("DR11 failures keep two useful survey views by falling back to AllWISE", async ({ page }) => {
    await page.route("**/viewer/jpeg-cutout?**", (route) => route.fulfill({ status: 429, contentType: "text/plain", body: "rate limited" }));

    await selectCatalogObject(page, "M1", "m1", /M1/);

    const media = page.locator(".object-media-list .object-media");
    await expect(media).toHaveCount(2);
    await expect(media.nth(0)).toHaveAttribute("data-media-provider", "dss2");
    const fallback = page.locator('[data-media-provider="allwise"]');
    await expect(fallback).toBeVisible();
    await expect(fallback.locator(".object-media__badge")).toHaveText("AllWISE fallback");
    await expect(fallback.locator("img")).toHaveAttribute("src", /alasky\.cds\.unistra\.fr\/.*allWISE%2Fcolor/);
    await expect(fallback.locator(".object-media__description")).toContainText("DR11 did not return a usable field");
  });

  test("DR11 no-data images fall back instead of showing a blank field", async ({ page }) => {
    await page.route("**/viewer/jpeg-cutout?**", (route) => route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    }));

    await selectCatalogObject(page, "M1", "m1", /M1/);

    const fallback = page.locator('[data-media-provider="allwise"]');
    await expect(fallback).toBeVisible();
    await expect(fallback.locator(".object-media__badge")).toHaveText("AllWISE fallback");
    await expect(fallback.locator(".object-media__description")).toContainText("DR11 did not return a usable field");
  });

  test("server-driven object detail hydration exposes loading and error states", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    let releaseHydration: (() => void) | null = null;

    await page.route("**/api/catalog/search?**", async (route) => {
      const url = route.request().url();
      if (!url.includes("q=Hydrate")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Hydrate",
          objects: [
            {
              key: "hydration-preview",
              name: "Hydration Preview",
              object_type: "star_cluster",
              catalog_group: "messier_deep_sky",
              source_type: "test_catalog",
              position_model: "catalog_astrometry",
              astrometry: { ra_deg: 250.42, dec_deg: 36.46, distance_ly: 25000 },
              position: { x_au: 1, y_au: 2, z_au: 0.5 },
              facts: { deep_sky_type_label: "Globular cluster", constellation: "Hercules" }
            }
          ],
          total: 1,
          offset: 0,
          limit: 80,
          has_more: false
        })
      });
    });

    await page.route("**/api/ephemeris?**", async (route) => {
      const url = route.request().url();
      if (!url.includes("keys=hydration-preview")) {
        await route.continue();
        return;
      }
      await new Promise<void>((resolve) => {
        releaseHydration = resolve;
      });
      await route.fulfill({ status: 503, body: "detail unavailable" });
    });

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Hydrate");
    await expect(page.locator('#body-picker [data-body-key="hydration-preview"]')).toBeVisible();
    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-summary-name")).toContainText("Hydration Preview");
    await expect(page.locator(".object-detail-state--loading")).toContainText("Loading object detail");
    releaseHydration?.();
    await expect(page.locator(".object-detail-state--error")).toContainText("Object detail unavailable");
    const position = page.locator(".data-section").filter({ has: page.getByRole("heading", { name: "Position", exact: true }) });
    await expect(position).toContainText("Right ascension");

    expect(issues.errors.filter((message) => !message.includes("503")), "unexpected browser errors").toEqual([]);
  });

  test("server-rendered catalog permalinks hydrate from Phoenix without an invalid Python lookup", async ({ page }) => {
    const pythonDetailRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/ephemeris?") && request.url().includes("keys=ngc-224")) {
        pythonDetailRequests.push(request.url());
      }
    });

    await openAtlas(page, "/o/ngc-224");
    await expect(page.locator("#selected-summary-name")).toContainText("Andromeda");
    await expect(page.locator(".object-detail-state--error")).toHaveCount(0);
    expect(pythonDetailRequests).toEqual([]);
  });

  test("compare search uses the same picker model as catalog search", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Jupiter");
    await expect(page.locator('#body-picker [data-body-key="jupiter"]')).toBeVisible();
    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-summary-name")).toContainText("Jupiter");
    await page.locator("#compare-search").fill("Mars");

    const marsResult = page.locator('#compare-picker [data-body-key="mars"]').first();
    await expect(marsResult).toBeVisible();
    await marsResult.click();

    await expect(page.locator("#compare-heading")).toHaveText("Compare Jupiter");
    await expect(page.locator("#compare-panel")).toContainText("Mars");
    await expect(page.locator("#compare-panel")).toContainText(/True diameter ratio|Current distance/);

    issues.assertClean();
  });

  test("catalog search supports keyboard result navigation", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Mar");
    await expect(page.locator('#body-picker [data-body-key="mars"]')).toBeVisible();

    await page.locator("#body-search").press("ArrowDown");
    await expect(page.locator("#body-search")).toHaveAttribute("aria-activedescendant", /body-picker-option-/);
    await expect(page.locator('#body-picker [role="option"][aria-selected="true"]')).toHaveCount(1);

    await page.locator("#body-search").press("Home");
    await page.locator("#body-search").press("End");
    await page.locator("#body-search").press("ArrowUp");
    await page.locator("#body-search").press("Escape");
    await expect(page.locator("#body-search")).not.toHaveAttribute("aria-activedescendant", /.+/);

    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-object-panel")).toBeVisible();
    await expect(page.locator("#selected-summary-name")).not.toBeEmpty();

    issues.assertClean();
  });

  test("compare search supports keyboard result navigation", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await selectCatalogObject(page, "Jupiter", "jupiter", "Jupiter");
    await page.locator("#compare-search").fill("Mars");
    await expect(page.locator('#compare-picker [data-body-key="mars"]')).toBeVisible();

    await page.locator("#compare-search").press("ArrowDown");
    await expect(page.locator("#compare-search")).toHaveAttribute("aria-activedescendant", /compare-picker-option-/);
    await expect(page.locator('#compare-picker [role="option"][aria-selected="true"]')).toHaveCount(1);
    await page.locator("#compare-search").press("Enter");

    await expect(page.locator("#compare-panel")).toContainText("Mars");

    issues.assertClean();
  });

  test("catalog search exposes loading, empty, and fallback states", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    let releaseSearch: (() => void) | null = null;

    await page.route("**/api/catalog/search?**", async (route) => {
      const url = route.request().url();
      if (url.includes("q=Slow")) {
        await new Promise<void>((resolve) => {
          releaseSearch = resolve;
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ query: "Slow", bodies: [], objects: [], total: 0, offset: 0, limit: 80, has_more: false }) });
        return;
      }
      if (url.includes("q=Empty")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ query: "Empty", bodies: [], objects: [], total: 0, offset: 0, limit: 80, has_more: false }) });
        return;
      }
      if (url.includes("q=Fail")) {
        await route.fulfill({ status: 503, body: "search unavailable" });
        return;
      }
      await route.continue();
    });

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Slow");
    await expect(page.locator("#body-picker .picker-status--loading")).toContainText("Searching catalog");
    releaseSearch?.();
    await expect(page.locator("#body-picker .empty-state")).toContainText("No objects match");

    await page.locator("#body-search").fill("Empty");
    await expect(page.locator("#body-picker .empty-state")).toContainText("No objects match");

    await page.locator("#body-search").fill("Fail");
    await expect(page.locator("#body-picker .picker-status--fallback")).toContainText("Live catalog search is unavailable");

    expect(issues.errors.filter((message) => !message.includes("503")), "unexpected browser errors").toEqual([]);
  });

  test("compare search exposes loading, empty, and fallback states", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    let releaseSearch: (() => void) | null = null;

    await page.route("**/api/catalog/search?**", async (route) => {
      const url = route.request().url();
      if (url.includes("q=SlowCompare")) {
        await new Promise<void>((resolve) => {
          releaseSearch = resolve;
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ query: "SlowCompare", bodies: [], objects: [], total: 0, offset: 0, limit: 80, has_more: false }) });
        return;
      }
      if (url.includes("q=EmptyCompare")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ query: "EmptyCompare", bodies: [], objects: [], total: 0, offset: 0, limit: 80, has_more: false }) });
        return;
      }
      if (url.includes("q=FailCompare")) {
        await route.fulfill({ status: 503, body: "search unavailable" });
        return;
      }
      await route.continue();
    });

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Jupiter");
    await expect(page.locator('#body-picker [data-body-key="jupiter"]')).toBeVisible();
    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-summary-name")).toContainText("Jupiter");
    await page.locator("#compare-search").fill("SlowCompare");
    await expect(page.locator("#compare-picker .picker-status--loading")).toContainText("Searching catalog");
    releaseSearch?.();
    await expect(page.locator("#compare-picker .empty-state")).toContainText("No comparison matches");

    await page.locator("#compare-search").fill("EmptyCompare");
    await expect(page.locator("#compare-picker .empty-state")).toContainText("No comparison matches");

    await page.locator("#compare-search").fill("FailCompare");
    await expect(page.locator("#compare-picker .picker-status--fallback")).toContainText("Live catalog search is unavailable");

    expect(issues.errors.filter((message) => !message.includes("503")), "unexpected browser errors").toEqual([]);
  });

  test("language selector localizes common controls", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await page.locator("#locale-select").selectOption("es");

    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator('[data-tab="catalog"]')).toHaveText("Buscar");
    await expect(page.locator("#focus-body")).toHaveText("Enfocar");
    await expect(page.locator("#body-search")).toHaveAttribute("placeholder", "Nombre del objeto o designación de catálogo");

    issues.assertClean();
  });

  test("catalog filters constrain the picker to the selected object family", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openSearchWorkspace(page);
    await page.locator('#body-filter-buttons [data-body-filter="galaxy"]').click();

    await expect(page.locator('#body-picker [data-body-key="m31"]').first()).toBeVisible();
    await expect(page.locator('#body-picker [data-body-key="jupiter"]')).toHaveCount(0);

    await page.locator('#body-filter-buttons [data-body-filter="planet"]').click();
    await expect(page.locator('#body-picker [data-body-key="jupiter"]').first()).toBeVisible();
    await expect(page.locator('#body-picker [data-body-key="m31"]')).toHaveCount(0);

    issues.assertClean();
  });

  test("catalog broad search paginates and preserves selected object across filters", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const searchOffsets: string[] = [];

    await page.route("**/api/catalog/search?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("q") !== "Paged") {
        await route.continue();
        return;
      }

      const offset = url.searchParams.get("offset") ?? "0";
      searchOffsets.push(offset);
      const objects =
        offset === "0"
          ? [
              {
                key: "paged-alpha",
                name: "Paged Alpha",
                object_type: "star",
                catalog_group: "bright_stars",
                color: "#d9b86f",
                radius_km: 700_000,
                position: { x_au: 12, y_au: 0, z_au: 0 },
                astrometry: { distance_ly: 12 }
              }
            ]
          : [
              {
                key: "paged-beta",
                name: "Paged Beta",
                object_type: "star",
                catalog_group: "bright_stars",
                color: "#82cbb3",
                radius_km: 640_000,
                position: { x_au: 16, y_au: 0, z_au: 0 },
                astrometry: { distance_ly: 16 }
              }
            ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ query: "Paged", bodies: [], objects, total: 2, offset: Number(offset), limit: 1, has_more: offset === "0" })
      });
    });

    await page.route("**/api/ephemeris?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("keys") !== "paged-alpha") {
        await route.continue();
        return;
      }

      const auKm = 149_597_870.7;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timestamp_utc: "2026-07-14T10:30:00Z",
          generated_at_utc: "2026-07-14T10:30:00Z",
          data_source: "test fixture",
          coordinate_frame: "heliocentric ecliptic J2000",
          au_km: auKm,
          bodies: [
            {
              key: "paged-alpha",
              name: "Paged Alpha",
              object_type: "star",
              catalog_group: "bright_stars",
              color: "#d9b86f",
              radius_km: 700_000,
              aliases: [],
              catalog: {
                source_type: "test_catalog",
                position_model: "catalog_astrometry",
                catalog_group: "bright_stars",
                aliases: []
              },
              stellar: { distance_ly: 12 },
              position: {
                x_au: 12,
                y_au: 0,
                z_au: 0,
                x_km: 12 * auKm,
                y_km: 0,
                z_km: 0,
                heliocentric_distance_km: 12 * auKm
              },
              distance_from_earth_km: 11 * auKm
            }
          ]
        })
      });
    });

    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Paged");
    await expect(page.locator('#body-picker [data-body-key="paged-alpha"]')).toBeVisible();
    await expect(page.locator("#body-picker .picker-load-more")).toContainText("1 of 2 loaded");
    await page.locator("#body-picker [data-picker-load-more]").click();
    await expect(page.locator('#body-picker [data-body-key="paged-beta"]')).toBeVisible();
    expect(searchOffsets).toEqual(["0", "1"]);

    await page.locator("#body-search").press("Home");
    await page.locator("#body-search").press("ArrowDown");
    await page.locator("#body-search").press("Enter");
    await expect(page.locator("#selected-summary-name")).toHaveText("Paged Alpha");
    await openSearchWorkspace(page);
    await page.locator('#body-filter-buttons [data-body-filter="galaxy"]').click();
    await expect(page.locator("#selected-summary-name")).toHaveText("Paged Alpha");

    issues.assertClean();
  });

  test("explore domain cards apply aligned catalog filters and guided results", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openSearchWorkspace(page);
    await page.locator('[data-explore-domain="galaxies"]').click();

    await expect(page.locator('[data-explore-domain="galaxies"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#body-filter-buttons [data-body-filter="galaxy"]')).toHaveClass(/active/);
    await expect(page.locator("#body-picker")).toContainText("Galaxies");
    await expect(page.locator('#body-picker [data-body-key="m31"]')).toBeVisible();
    await expect(page.locator('#body-picker [data-body-key="jupiter"]')).toHaveCount(0);

    await page.locator('[data-explore-domain="small-bodies"]').press("Enter");

    await expect(page.locator('[data-explore-domain="small-bodies"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#body-filter-buttons [data-body-filter="small_body"]')).toHaveClass(/active/);
    await expect(page.locator("#body-picker")).toContainText("Small bodies");
    await expect(page.locator('#body-picker [data-body-key="jpl-sbdb-20000001"]')).toBeVisible();
    await expect(page.locator('#body-picker [data-body-key="m31"]')).toHaveCount(0);

    issues.assertClean();
  });

  test("shared view-state links restore a selected small body", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await openAtlas(page, "/?v=1&c=0%2C0&z=24&t=now&o=jpl-sbdb-20000001&L=");

    await expect(page.locator("#selected-object-panel")).toBeVisible();
    await expect(page.locator("#selected-summary-name")).toContainText("Ceres");
    issues.assertClean();
  });

  test("catalog point tiles can ask the backend for nearest-object hydration", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    let staticTileRequests = 0;
    let nearestRequests = 0;

    await page.route("**/catalog-tiles/v1/manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: "smoke-static-tiles",
          format: "SMP2",
          layers: [
            {
              id: "gaia_stars",
              tile_url_template: "/catalog-tiles/v1/layers/gaia_stars/s{span_log2}/x{x}/y{y}.bin",
              groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"],
              types: ["star"],
              levels: [
                { span_log2: 36, span_au: 68_719_476_736, max_points_per_tile: 4096, sample_buckets: 2 },
                { span_log2: 40, span_au: 1_099_511_627_776, max_points_per_tile: 4096, sample_buckets: 2 },
                { span_log2: 44, span_au: 17_592_186_044_416, max_points_per_tile: 4096, sample_buckets: 1 }
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
        headers: { "x-starsmap-total": "1", "x-starsmap-returned": "1" },
        body: STATIC_POINT_TILE_WITH_ONE_POINT
      });
    });
    await page.route("**/api/catalog/points.bin**", async (route) => {
      await route.fulfill({ status: 599, body: "dynamic point fallback should not be used by this smoke test" });
    });
    await page.route("**/api/catalog/nearest?**", async (route) => {
      nearestRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          object: {
            key: "smoke-gaia-point",
            name: "Smoke Gaia Point",
            object_type: "star",
            catalog_group: "gaia_local_stars",
            color: "#e0c480",
            radius_km: 695_700,
            position: { x_au: 0, y_au: 0, z_au: 0 },
            astrometry: { ra_deg: 0, dec_deg: 0, distance_ly: 1 },
            source: { catalog: "Smoke static point tile fixture" }
          }
        })
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="galaxy"]').click();
    await expect.poll(() => staticTileRequests, { timeout: 15_000, message: "static point tile requests" }).toBeGreaterThan(0);

    const nearestResponsePromise = page
      .waitForResponse((response) => response.url().includes("/api/catalog/nearest"), { timeout: 8_000 })
      .catch(() => null);

    await page.locator("#map").click({ position: { x: 260, y: 240 } });
    const nearestResponse = await nearestResponsePromise;

    expect(nearestResponse?.ok()).toBe(true);
    expect(nearestRequests).toBeGreaterThan(0);
    await expect(page.locator("#selected-summary-name")).toHaveText("Smoke Gaia Point");
    issues.assertClean();
  });
});
