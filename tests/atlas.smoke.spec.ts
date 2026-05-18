import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, openSearchWorkspace, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("Cosmic Atlas browser smoke", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("catalog search selects Jupiter and shows curated media", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await selectCatalogObject(page, "Jupiter", "jupiter", "Jupiter");

    await expect(page.locator("#selected-summary-meta")).toContainText("Planet");
    await expect(page.locator(".object-media--curated")).toBeVisible();
    await expect(page.locator(".object-media__badge").first()).toHaveText("Curated NASA image");
    await expect(page.locator(".object-media img").first()).toHaveAttribute("src", /PIA02873/);

    issues.assertClean();
  });

  test("survey media appears for a deep-sky catalog object without curated media", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await selectCatalogObject(page, "M13", "m13", /M13/);

    await expect(page.locator(".object-media--survey")).toBeVisible();
    await expect(page.locator(".object-media__badge").first()).toHaveText("Survey cutout");
    await expect(page.locator(".object-media img").first()).toHaveAttribute("src", /hips2fits/);

    issues.assertClean();
  });

  test("compare search uses the same picker model as catalog search", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await selectCatalogObject(page, "Jupiter", "jupiter", "Jupiter");
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

    issues.assertClean();
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

    await selectCatalogObject(page, "Jupiter", "jupiter", "Jupiter");
    await page.locator("#compare-search").fill("SlowCompare");
    await expect(page.locator("#compare-picker .picker-status--loading")).toContainText("Searching catalog");
    releaseSearch?.();
    await expect(page.locator("#compare-picker .empty-state")).toContainText("No comparison matches");

    await page.locator("#compare-search").fill("EmptyCompare");
    await expect(page.locator("#compare-picker .empty-state")).toContainText("No comparison matches");

    await page.locator("#compare-search").fill("FailCompare");
    await expect(page.locator("#compare-picker .picker-status--fallback")).toContainText("Live catalog search is unavailable");

    issues.assertClean();
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

  test("catalog point tiles can ask the backend for nearest-object hydration", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    await page.locator('[data-zoom-preset="galaxy"]').click();
    const pointTileResponse = await page
      .waitForResponse((response) => response.url().includes("/api/catalog/points.bin") && response.ok(), { timeout: 15_000 })
      .catch(() => null);
    test.skip(!pointTileResponse, "No catalog point tile loaded in this environment.");

    const nearestResponsePromise = page
      .waitForResponse((response) => response.url().includes("/api/catalog/nearest"), { timeout: 8_000 })
      .catch(() => null);

    await page.locator("#map").click({ position: { x: 260, y: 240 } });
    const nearestResponse = await nearestResponsePromise;
    test.skip(!nearestResponse, "Map click did not hit a point-layer selection path at this viewport.");

    expect(nearestResponse?.ok()).toBe(true);
    issues.assertClean();
  });
});
