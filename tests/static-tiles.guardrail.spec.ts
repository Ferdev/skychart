import { expect, test } from "@playwright/test";
import { installAtlasPerfInstrumentation, openAtlas, readAtlasPerf, waitForCatalogRequestsToSettle } from "./atlas-test-utils";

const EMPTY_SMP2_TILE = "SMP2\u0000\u0000\u0000\u0000";

function smp3ContainerFixture(options: { spanLog2?: number; tileX?: number; tileY?: number; qx?: number; qy?: number; sourceId?: bigint } = {}) {
  const spanLog2 = options.spanLog2 ?? 24;
  const tileX = options.tileX ?? 0;
  const tileY = options.tileY ?? 0;
  const tile = Buffer.alloc(40 + (options.sourceId == null ? 0 : 8));
  tile.write("SMP3", 0, "ascii");
  tile.writeUInt16LE(1, 4);
  tile.writeUInt16LE(options.sourceId == null ? 0 : 1, 6);
  tile.writeDoubleLE((options.tileX ?? 0) * 2 ** spanLog2, 8);
  tile.writeDoubleLE((options.tileY ?? 0) * 2 ** spanLog2, 16);
  tile.writeFloatLE(2 ** spanLog2, 24);
  tile.writeUInt32LE(1, 28);
  tile.writeUInt16LE(options.qx ?? 32768, 32);
  tile.writeUInt16LE(options.qy ?? 32768, 34);
  tile.writeUInt8(20, 36);
  tile.writeUInt8(16, 37);
  if (options.sourceId != null) tile.writeBigUInt64LE(options.sourceId, 40);

  const container = Buffer.alloc(16 + 24 + tile.length);
  container.write("SMPK1", 0, "ascii");
  container.writeUInt32LE(1, 8);
  container.writeUInt32LE(1, 12);
  container.writeUInt8(spanLog2, 16);
  container.writeInt32LE(tileX, 20);
  container.writeInt32LE(tileY, 24);
  container.writeBigUInt64LE(40n, 28);
  container.writeUInt32LE(tile.length, 36);
  tile.copy(container, 40);
  return container;
}

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
  test("opens dense tile-point details immediately while the stable object hydrates", async ({ page }) => {
    const sourceId = 5_931_842_930_184_739_845n;
    const container = smp3ContainerFixture({ spanLog2: 8, tileX: 0, tileY: 0, qx: 128, qy: 128, sourceId });
    let releaseSourceId = () => {};
    let releaseDetail = () => {};
    const sourceIdCanFinish = new Promise<void>((resolve) => { releaseSourceId = resolve; });
    const detailCanFinish = new Promise<void>((resolve) => { releaseDetail = resolve; });

    await page.route("**/api/ephemeris**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) }));
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: {}, available_groups: [] }) }));
    await page.route("**/api/catalog/viewport**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) }));
    await page.route("**/api/catalog/nearest**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object: null }) }));
    await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "instant-selection-fixture",
        format: "SMP3",
        color_lut: Array.from({ length: 256 }, () => [224, 196, 128]),
        layers: [{
          id: "gaia_stars",
          container: "/catalog-tiles/instant/gaia_stars.smpk",
          groups: ["gaia_dr3_bulk"],
          types: ["star"],
          levels: [{ span_log2: 8, span_au: 2 ** 8, max_points_per_tile: 65_000, sample_buckets: 1024 }]
        }]
      })
    }));
    await page.route("**/catalog-tiles/instant/gaia_stars.smpk", async (route) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), container.length - 1) : container.length - 1;
      if (start === 80) await sourceIdCanFinish;
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: { "content-range": `bytes ${start}-${end}/${container.length}`, "accept-ranges": "bytes" },
        body: container.subarray(start, end + 1)
      });
    });
    await page.route(`**/api/objects/gaia/${sourceId}`, async (route) => {
      await detailCanFinish;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: `gaia_dr3_${sourceId}`,
          name: `Gaia DR3 ${sourceId}`,
          object_type: "star",
          catalog_group: "gaia_dr3_bulk",
          source_type: "gaia_dr3",
          position_model: "catalog_astrometry",
          color: "#e0c480",
          astrometry: { distance_ly: 12.5, apparent_magnitude: 0 },
          position: { x_au: 0.5, y_au: 0.5, z_au: 0 }
        })
      });
    });

    await openAtlas(page, "/?perf=1");
    await expect.poll(async () => page.locator("#perf-hud").textContent(), { timeout: 10_000 }).toMatch(/Pipeline\s*1 available .* 1 decoded/);
    const fixtureScreenPoint = () => page.evaluate(() => {
      const pointAu = 128 / 65_535 * 256;
      const { camera, usable } = window.__ATLAS_DIAGNOSTICS__!.selectionGeometry();
      return {
        x: usable.left + usable.width / 2 + (pointAu - camera.xAu) * camera.pxPerAu,
        y: usable.top + usable.height / 2 - (pointAu - camera.yAu) * camera.pxPerAu
      };
    });
    const hit = await fixtureScreenPoint();

    await page.mouse.click(hit.x, hit.y);
    await expect(page.locator("#selected-summary-name")).toHaveText("Gaia DR3 star");
    await expect(page.locator(".object-detail-state--loading")).toContainText("Loading object detail");
    await expect(page.locator("#close-panel")).toHaveText("×");
    await expect(page.locator("#close-panel")).toHaveAccessibleName("Deselect current object");
    expect(new URL(page.url()).searchParams.get("o"), "transient tile key must not enter history").toBeNull();

    const repeatedHit = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry().selected);
    expect(repeatedHit).not.toBeNull();
    const retryHit = await fixtureScreenPoint();
    await page.mouse.click(retryHit.x, retryHit.y);
    await page.locator('#display-toggles [data-layer="labels"]').evaluate((input: HTMLInputElement) => {
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => new URL(page.url()).searchParams.get("L")).toContain("labels.0");
    expect(new URL(page.url()).searchParams.get("o"), "repeat selection and state writes must keep transient keys out of history").toBeNull();

    const emptyHit = await page.evaluate(() => {
      const { usable } = window.__ATLAS_DIAGNOSTICS__!.selectionGeometry();
      return { x: usable.left + usable.width * 0.75, y: usable.top + usable.height * 0.25 };
    });
    await page.mouse.click(emptyHit.x, emptyHit.y);
    await expect(page.locator("#workspace-panel")).toBeHidden();
    await expect(page.locator(".object-detail-state--loading")).toHaveCount(0);

    const finalHit = await fixtureScreenPoint();
    await page.mouse.click(finalHit.x, finalHit.y);
    await expect(page.locator("#selected-summary-name")).toHaveText("Gaia DR3 star");

    releaseSourceId();
    releaseDetail();
    await expect(page.locator("#selected-summary-name")).toHaveText(`Gaia DR3 ${sourceId}`);
    await expect(page.locator(".object-detail-state--loading")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("o")).toBe(`gaia_dr3_${sourceId}`);
  });

  test("catalog point tiles remain eligible at Solar scale", async ({ page }) => {
    const container = smp3ContainerFixture({ spanLog2: 20, tileX: 0, tileY: 0, qx: 0, qy: 0 });
    await page.route("**/api/ephemeris**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) }));
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: {}, available_groups: [] }) }));
    await page.route("**/api/catalog/viewport**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) }));
    await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "solar-scale-fixture",
        format: "SMP3",
        color_lut: Array.from({ length: 256 }, () => [224, 196, 128]),
        layers: [{
          id: "gaia_stars",
          container: "/catalog-tiles/solar/gaia_stars.smpk",
          groups: ["gaia_local_stars"],
          types: ["star"],
          levels: [{ span_log2: 20, span_au: 2 ** 20, max_points_per_tile: 65_000, sample_buckets: 1024 }]
        }]
      })
    }));
    await page.route("**/catalog-tiles/solar/gaia_stars.smpk", async (route) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), container.length - 1) : container.length - 1;
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: { "content-range": `bytes ${start}-${end}/${container.length}`, "accept-ranges": "bytes" },
        body: container.subarray(start, end + 1)
      });
    });

    await openAtlas(page, "/?perf=1");
    await expect.poll(async () => page.locator("#perf-hud").textContent(), { timeout: 10_000 }).toMatch(/Pipeline\s*1 available .* 1 decoded/);
    await expect(page.locator("#atlas-stats")).toContainText(/Shown\s*3/);
  });

  test("header distinguishes searchable objects from mapped manifest records without double-counting subtype layers", async ({ page }) => {
    const gaia = { ...staticLayer("gaia_stars", ["gaia_dr3_bulk"], ["star"]), source_counts: { gaia_dr3_bulk: 10 } };
    const desi = { ...staticLayer("desi_dr1", ["desi_dr1_galaxies", "desi_dr1_quasars"], ["galaxy", "quasar"]), source_counts: { desi_dr1_galaxies: 2, desi_dr1_quasars: 1 } };
    const quaia = { ...staticLayer("quaia_g20", ["quaia_g20_quasars"], ["quasar"]), source_counts: { quaia_g20_quasars: 2 } };
    const deepSky = { ...staticLayer("deep_sky", ["simbad_extragalactic"], ["galaxy", "quasar", "active_galaxy"]), source_counts: { simbad_extragalactic: 1 } };
    const duplicateGalaxies = { ...staticLayer("galaxies", ["simbad_extragalactic"], ["galaxy"]), source_counts: { simbad_extragalactic: 1 } };
    await routeStaticTileFixture(page, [gaia, desi, quaia, deepSky, duplicateGalaxies]);
    await page.route("**/catalog-tiles/v1/**/*.bin", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE }));

    await openAtlas(page);
    await expect(page.locator("#atlas-stats")).toContainText(/Searchable\s*2\s*Mapped\s*16/);
    await expect(page.locator("#atlas-stats")).toContainText("Stars10");
    await expect(page.locator("#atlas-stats")).toContainText("Galaxies + QSOs6");
    await expect(page.locator("#atlas-stats [aria-label*='16 mapped catalog records']")).toHaveCount(1);
  });

  test("versionless manifest bypasses a previously cached catalog release", async ({ page }) => {
    let mappedStars = 10;
    let manifestRequests = 0;
    await page.route("**/api/ephemeris**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) }));
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: {}, available_groups: [] }) }));
    await page.route("**/api/catalog/viewport**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) }));
    await page.route("**/catalog-tiles/v1/manifest.json", async (route) => {
      manifestRequests += 1;
      const gaia = { ...staticLayer("gaia_stars", ["gaia_dr3_bulk"], ["star"]), source_counts: { gaia_dr3_bulk: mappedStars } };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body: JSON.stringify({ version: `cached-${mappedStars}`, format: "SMP2", layers: [gaia] })
      });
    });
    await page.route("**/catalog-tiles/v1/**/*.bin", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE }));

    await openAtlas(page);
    await expect(page.locator("#atlas-stats")).toContainText(/Mapped\s*10/);

    mappedStars = 20;
    await page.reload();
    await expect(page.locator("#atlas-stats")).toContainText(/Mapped\s*20/);
    expect(manifestRequests).toBe(2);
  });

  test("SMP3 source-ID ranges address the trailing block without unsafe number conversion", async ({ page }) => {
    await routeStaticTileFixture(page, []);
    await openAtlas(page, "/?perf");

    const result = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.smp3SourceIdFixture());

    expect(result).toEqual({
      range: { offset: 1_072, length: 8 },
      sourceId: "5931842930184739845",
      absent: null
    });
  });

  test("WebGL point renderer clears the full canvas and clips drawing to the usable map viewport", async ({ page }) => {
    await routeStaticTileFixture(page, []);
    await openAtlas(page, "/?perf");

    const pixels = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.webglClipFixture());

    expect(pixels, "Chromium should provide a WebGL context for the point renderer").not.toBeNull();
    expect(pixels?.centerAlpha).toBeGreaterThan(0);
    expect(pixels?.outsideAlpha).toBe(0);
    expect(pixels?.pointsInViewport).toBe(1);
    expect(pixels?.occupiedPixels).toBeGreaterThan(0);
    expect(pixels?.preserveDrawingBuffer).toBe(true);
    expect(pixels?.contextLossFallback).not.toBe(false);
  });

  test("SMP3 manifest loads an SMPK index and magnitude prefix with Range requests", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);
    const container = smp3ContainerFixture();
    const ranges: string[] = [];
    await page.route("**/api/ephemeris**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) }));
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: {}, available_groups: [] }) }));
    await page.route("**/api/catalog/viewport**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) }));
    await page.route("**/api/catalog/points.bin**", (route) => route.fulfill({ status: 599, body: "dynamic fallback forbidden" }));
    await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "v5-test",
        format: "SMP3",
        color_lut: Array.from({ length: 256 }, () => [224, 196, 128]),
        layers: [{
          id: "gaia_stars",
          container: "/catalog-tiles/v5/gaia_stars.smpk",
          groups: ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"],
          types: ["star"],
          levels: [{ span_log2: 24, span_au: 2 ** 24, max_points_per_tile: 65_000, sample_buckets: 1024 }]
        }]
      })
    }));
    await page.route("**/catalog-tiles/v5/gaia_stars.smpk", async (route) => {
      const range = route.request().headers().range ?? "bytes=0-";
      ranges.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), container.length - 1) : container.length - 1;
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: { "content-range": `bytes ${start}-${end}/${container.length}`, "accept-ranges": "bytes" },
        body: container.subarray(start, end + 1)
      });
    });

    await openAtlas(page);
    await page.locator('[data-zoom-preset="galaxy"]').click();
    await waitForCatalogRequestsToSettle(page);
    await expect.poll(() => ranges.length).toBeGreaterThanOrEqual(3);
    expect(ranges).toContain("bytes=0-15");
    expect(ranges).toContain("bytes=16-39");
    expect(ranges.some((range) => range.startsWith("bytes=40-"))).toBe(true);
    expect((await readAtlasPerf(page)).fetches.some((entry) => entry.url.includes("/api/catalog/points.bin"))).toBe(false);
  });

  test("settled SMP3 points stop reloading and expose a dense animated hover target", async ({ page }) => {
    const container = smp3ContainerFixture({ spanLog2: 42, tileX: 8, tileY: 0 });
    const ranges: string[] = [];
    await page.route("**/api/ephemeris**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EPHEMERIS_FIXTURE) }));
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ object_count: 2, group_counts: {}, available_groups: [] }) }));
    await page.route("**/api/catalog/viewport**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] }) }));
    await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "stable-hover-fixture",
        format: "SMP3",
        color_lut: Array.from({ length: 256 }, () => [224, 196, 128]),
        layers: [{
          id: "deep_sky",
          container: "/catalog-tiles/stable/deep_sky.smpk",
          groups: ["curated_extragalactic_survey"],
          types: ["galaxy"],
          levels: [{ span_log2: 42, span_au: 2 ** 42, max_points_per_tile: 12_000, sample_buckets: 1024 }]
        }]
      })
    }));
    await page.route("**/catalog-tiles/stable/deep_sky.smpk", async (route) => {
      const range = route.request().headers().range ?? "bytes=0-";
      ranges.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), container.length - 1) : container.length - 1;
      await route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: { "content-range": `bytes ${start}-${end}/${container.length}`, "accept-ranges": "bytes" },
        body: container.subarray(start, end + 1)
      });
    });

    await openAtlas(page, "/?perf=1");
    await page.locator('[data-zoom-preset="cosmicWeb"]').click();
    await waitForCatalogRequestsToSettle(page, 500, 15_000);
    await expect.poll(async () => page.locator("#perf-hud").textContent(), { timeout: 10_000 }).toMatch(/Pipeline\s*1 available .* 1 decoded/);
    const settledRangeCount = ranges.length;
    await page.waitForTimeout(2_400);
    expect(ranges.length, "a stable camera must not reload SMP3 prefixes as frame timing changes").toBe(settledRangeCount);

    const hit = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map");
      const marker = document.querySelector<HTMLElement>("#catalog-point-hover");
      if (!canvas || !marker) return null;
      const rect = canvas.getBoundingClientRect();
      for (let y = 160; y < rect.height - 80; y += 4) {
        for (let x = 520; x < rect.width - 80; x += 4) {
          const clientX = rect.left + x;
          const clientY = rect.top + y;
          canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX, clientY }));
          if (marker.dataset.visible === "true") return { clientX, clientY };
        }
      }
      return null;
    });
    expect(hit, "every distinguishable rendered catalog point should have a pointer target").not.toBeNull();
    if (hit) await page.mouse.move(hit.clientX, hit.clientY);
    const canvas = page.locator("#map");
    await expect(page.locator("#catalog-point-hover")).toHaveCSS("animation-name", "catalog-point-hover-pulse");
    await expect(canvas).toHaveCSS("cursor", "pointer");
  });

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
      staticLayer("deep_sky", ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "bass_dr2_black_holes", "curated_extragalactic_survey"], [
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
    staticTileUrls.clear();
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

  test("Solar-System filters use precise viewport objects instead of legacy point tiles", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);
    const tileUrls = new Set<string>();
    const viewportUrls = new Set<string>();
    await routeStaticTileFixture(page, [
      staticLayer("exoplanet_systems", ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"], []),
      staticLayer("small_bodies", ["jpl_small_bodies"], ["asteroid", "comet", "small_body"]),
      staticLayer("dwarf_planets", ["jpl_small_bodies"], ["dwarf_planet"]),
      staticLayer("black_holes", ["simbad_compact_objects", "bass_dr2_black_holes"], ["black_hole"])
    ]);
    await page.route("**/api/catalog/viewport?**", async (route) => {
      viewportUrls.add(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ objects: [] }) });
    });
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      tileUrls.add(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE });
    });

    await openAtlas(page);
    await waitForCatalogRequestsToSettle(page, 300, 10_000);
    tileUrls.clear();
    await page.locator('[data-scale-disclosure]:has([aria-controls="scale-object-types"]) .scale-collapse__toggle').click();
    await page.locator('#map-filter-buttons [data-body-filter="asteroid"]').click();
    await expect.poll(
      () => Array.from(viewportUrls).some((url) => url.includes("groups=jpl_small_bodies") && url.includes("types=asteroid")),
      { timeout: 10_000 },
    ).toBe(true);
    tileUrls.clear();
    await page.locator("#zoom-in").click();
    await page.waitForTimeout(500);

    expect(Array.from(tileUrls).filter((url) => url.includes("/layers/small_bodies/"))).toEqual([]);

    tileUrls.clear();
    await page.locator('#map-filter-buttons [data-body-filter="dwarf_planet"]').click();
    await expect.poll(
      () => Array.from(viewportUrls).some((url) => url.includes("jpl_small_bodies") && url.includes("types=dwarf_planet")),
      { timeout: 10_000 },
    ).toBe(true);
    await page.waitForTimeout(300);
    expect(Array.from(tileUrls).some((url) => url.includes("/layers/dwarf_planets/"))).toBe(false);
    expect(Array.from(tileUrls).some((url) => url.includes("/layers/small_bodies/"))).toBe(false);

    tileUrls.clear();
    await page.locator('#map-filter-buttons [data-body-filter="black_hole"]').click();
    await expect.poll(() => Array.from(tileUrls).some((url) => url.includes("/layers/black_holes/")), { timeout: 10_000 }).toBe(true);
  });

  test("broad universe view does not request overlapping subtype layers or prefetch hundreds of tiles", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);

    let dynamicPointRequests = 0;
    const staticTileUrls = new Set<string>();
    const layers = [
      staticLayer("gaia_stars", ["gaia_local_stars", "gaia_500pc_stars", "gaia_10kpc_bright_stars"], ["star"]),
      staticLayer("exoplanet_systems", ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"], []),
      staticLayer("small_bodies", ["jpl_small_bodies"], ["asteroid", "comet", "small_body"]),
      staticLayer("deep_sky", ["messier_deep_sky", "ngc_ic_deep_sky", "simbad_extragalactic", "simbad_compact_objects", "bass_dr2_black_holes", "curated_extragalactic_survey"], [
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
      staticLayer("black_holes", ["simbad_compact_objects", "bass_dr2_black_holes"], ["black_hole"]),
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
    staticTileUrls.clear();
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

  test("Universe selects dense DESI and Quaia levels that cover the full viewport within bounded fanout", async ({ page }) => {
    await installAtlasPerfInstrumentation(page);
    const urls = new Set<string>();
    const desi = {
      id: "desi_dr1",
      tile_url_template: "/catalog-tiles/v1/layers/desi_dr1/s{span_log2}/x{x}/y{y}.bin",
      groups: ["desi_dr1_galaxies", "desi_dr1_quasars"],
      types: ["galaxy", "quasar"],
      levels: [
        { span_log2: 44, span_au: 2 ** 44, max_points_per_tile: 40_000, point_count: 10_000_000 },
        { span_log2: 46, span_au: 2 ** 46, max_points_per_tile: 30_000, point_count: 650_000 },
        { span_log2: 50, span_au: 2 ** 50, max_points_per_tile: 18_000, point_count: 35_000 }
      ]
    };
    const quaia = {
      ...desi,
      id: "quaia_g20",
      tile_url_template: "/catalog-tiles/v1/layers/quaia_g20/s{span_log2}/x{x}/y{y}.bin",
      groups: ["quaia_g20_quasars"],
      types: ["quasar"]
    };
    await routeStaticTileFixture(page, [desi, quaia]);
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      urls.add(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE });
    });

    await openAtlas(page);
    urls.clear();
    await page.locator('[data-zoom-preset="cosmicWeb"]').click();
    await expect.poll(() => urls.size, { timeout: 10_000 }).toBeGreaterThan(6);
    await waitForCatalogRequestsToSettle(page, 500, 20_000);

    expect(Array.from(urls).some((url) => url.includes("/desi_dr1/s46/"))).toBe(true);
    expect(Array.from(urls).some((url) => url.includes("/quaia_g20/s46/"))).toBe(true);
    expect(Array.from(urls).filter((url) => url.includes("/desi_dr1/s44/"))).toEqual([]);
    expect(urls.size).toBeLessThanOrEqual(396);
  });

  test("portrait cosmological views avoid survey levels dense enough to expose square tile artifacts", async ({ page }) => {
    await page.setViewportSize({ width: 1_356, height: 2_048 });
    const urls = new Set<string>();
    const desi = {
      id: "desi_dr1",
      tile_url_template: "/catalog-tiles/v1/layers/desi_dr1/s{span_log2}/x{x}/y{y}.bin",
      groups: ["desi_dr1_galaxies", "desi_dr1_quasars"],
      types: ["galaxy", "quasar"],
      levels: [
        { span_log2: 44, span_au: 2 ** 44, max_points_per_tile: 40_000, point_count: 10_308_425 },
        { span_log2: 46, span_au: 2 ** 46, max_points_per_tile: 30_000, point_count: 651_791 },
        { span_log2: 48, span_au: 2 ** 48, max_points_per_tile: 800_000, point_count: 1_498_783 },
        { span_log2: 50, span_au: 2 ** 50, max_points_per_tile: 800_000, point_count: 1_498_783 }
      ]
    };
    await routeStaticTileFixture(page, [desi]);
    await page.route("**/catalog-tiles/v1/**/*.bin", async (route) => {
      urls.add(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE });
    });

    await openAtlas(page);
    urls.clear();
    await page.locator("#zoom-scale-slider").fill("148");
    await expect.poll(() => urls.size, { timeout: 10_000 }).toBeGreaterThan(0);
    await waitForCatalogRequestsToSettle(page, 500, 20_000);

    expect(Array.from(urls).some((url) => url.includes("/desi_dr1/s48/"))).toBe(true);
    expect(Array.from(urls).filter((url) => url.includes("/desi_dr1/s44/"))).toEqual([]);
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
