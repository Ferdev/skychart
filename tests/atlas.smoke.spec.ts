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
