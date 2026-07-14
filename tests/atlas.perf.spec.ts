import { expect, test } from "@playwright/test";
import {
  catalogEndpointEntries,
  collectBrowserIssues,
  installAtlasPerfInstrumentation,
  openAtlas,
  readAtlasPerf,
  resetAtlasPerf,
  skipIfAtlasUnavailable,
  waitForCatalogRequestsToSettle
} from "./atlas-test-utils";

test.describe("Cosmic Atlas performance guardrails", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await installAtlasPerfInstrumentation(page);
    await openAtlas(page);
    await waitForCatalogRequestsToSettle(page);
    await resetAtlasPerf(page);
  });

  test("idle atlas rendering settles instead of continuously scheduling frames", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await page.waitForTimeout(1_000);
    const settled = await readAtlasPerf(page);
    await page.waitForTimeout(1_500);
    const idle = await readAtlasPerf(page);

    expect(idle.rafCount - settled.rafCount, "requestAnimationFrame calls while idle").toBeLessThanOrEqual(2);
    expect(catalogEndpointEntries(idle), "catalog endpoint requests while idle").toHaveLength(0);
    issues.assertClean();
  });

  test("common zoom controls do not issue runaway catalog loads", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    for (let index = 0; index < 4; index += 1) {
      await page.locator("#zoom-in").click();
    }
    for (let index = 0; index < 3; index += 1) {
      await page.locator("#zoom-out").click();
    }

    await waitForCatalogRequestsToSettle(page, 1_000);
    const afterZoom = await readAtlasPerf(page);
    const catalogRequests = catalogEndpointEntries(afterZoom);
    const pointTileRequests = catalogRequests.filter((entry) => entry.url.includes("/api/catalog/points.bin"));
    const viewportRequests = catalogRequests.filter((entry) => entry.url.includes("/api/catalog/viewport"));

    // Budget: SMP2 can issue up to 28 primary + 28 secondary active tiles and
    // 12 prefetches per settled zoom level. SMP3 uses the same logical fanout;
    // its one-time index and Range prefixes stay under this looser two-level
    // envelope as well.
    expect(catalogRequests.length, "total point/viewport catalog requests for seven zoom actions").toBeLessThanOrEqual(120);
    expect(pointTileRequests, "dynamic point tile requests for seven zoom actions").toEqual([]);
    expect(viewportRequests.length, "viewport object requests for seven zoom actions").toBeLessThanOrEqual(8);
    expect(catalogRequests.filter((entry) => entry.failed || (entry.status !== null && entry.status >= 500))).toEqual([]);

    await resetAtlasPerf(page);
    await page.waitForTimeout(2_000);
    await waitForCatalogRequestsToSettle(page, 1_000);
    const finalDeferredRefresh = catalogEndpointEntries(await readAtlasPerf(page));
    // One deferred full-coverage refresh plus its adjacent-level prefetch batch.
    expect(finalDeferredRefresh.length, "final debounced catalog refresh after zoom").toBeLessThanOrEqual(70);

    await resetAtlasPerf(page);
    await page.waitForTimeout(1_500);
    const idleAfterZoom = await readAtlasPerf(page);
    expect(catalogEndpointEntries(idleAfterZoom), "catalog endpoint requests after final refresh settles").toHaveLength(0);

    issues.assertClean();
  });

  test("zoom changes start replacement point tiles before the camera debounce", async ({ page }) => {
    // Local and CI test stacks do not ship the production bucket's static
    // catalog-tile manifest. Exercise the same immediate scheduling path via
    // the explicitly supported dynamic fallback instead of making this
    // guardrail depend on external release assets.
    await openAtlas(page, "/?dynamicPointFallback=1");
    await waitForCatalogRequestsToSettle(page);
    const issues = collectBrowserIssues(page);
    await resetAtlasPerf(page);
    const before = await page.evaluate(() => performance.now());
    await page.locator('[data-zoom-preset="nearby"]').click();

    await page.waitForFunction(
      ({ before }) => {
        const state = (window as Window & { __atlasPerf?: { fetches: { url: string; startedAt: number }[] } }).__atlasPerf;
        return Boolean(
          state?.fetches.some(
            (entry) => entry.startedAt >= before && /(?:\/api\/catalog\/points\.bin|\/catalog-tiles\/[^/]+\/.*\.(?:bin|smpk))/.test(entry.url)
          )
        );
      },
      { before },
      { timeout: 150 }
    );

    const afterZoom = await readAtlasPerf(page);
    const firstPointTile = catalogEndpointEntries(afterZoom)
      .filter((entry) => entry.startedAt >= before && /(?:\/api\/catalog\/points\.bin|\/catalog-tiles\/[^/]+\/.*\.(?:bin|smpk))/.test(entry.url))
      .sort((a, b) => a.startedAt - b.startedAt)[0];

    expect(firstPointTile, "replacement point tile request after zoom change").toBeTruthy();
    expect(firstPointTile.startedAt - before, "replacement point tile request delay").toBeLessThan(150);
    issues.assertClean();
  });

  test("galaxy-scale point layer loads with a bounded tile fanout", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await page.locator('[data-zoom-preset="galaxy"]').click();
    await waitForCatalogRequestsToSettle(page, 1_200, 20_000);

    const afterGalaxyZoom = await readAtlasPerf(page);
    const pointTileRequests = catalogEndpointEntries(afterGalaxyZoom).filter((entry) => entry.url.includes("/api/catalog/points.bin"));

    expect(pointTileRequests, "wide galaxy preset dynamic point tile requests").toEqual([]);
    expect(pointTileRequests.filter((entry) => entry.failed || (entry.status !== null && entry.status >= 500))).toEqual([]);

    issues.assertClean();
  });
});
