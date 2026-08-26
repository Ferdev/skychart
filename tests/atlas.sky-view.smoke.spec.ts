import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

test("selected objects open an interactive object-centered sky view", async ({ page, request }) => {
  await skipIfAtlasUnavailable(request);
  const issues = collectBrowserIssues(page);
  let skyRequests = 0;
  await page.route("**/api/catalog/sky?**", (route) => {
    skyRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        returned: 1,
        points: [{
          key: "fixture-star",
          name: "Fixture Star",
          object_type: "star",
          color: "#f8cb65",
          apparent_magnitude: 1,
          direction: { x: 1, y: 0, z: 0 }
        }]
      })
    });
  });

  await openAtlas(page);
  await selectCatalogObject(page, "Earth", "earth", "Earth");
  await expect(page.locator("#view-sky-selected")).toBeEnabled();
  await page.locator("#view-sky-selected").click();

  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-view-title")).toContainText("Earth");
  await expect(page.locator("#sky-view-status")).toContainText("1 catalog directions loaded");
  await expect(page.locator("#sky-map")).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("sky")).toBe("earth");

  await page.locator("#sky-time-forward").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect.poll(() => skyRequests).toBeGreaterThan(1);
  await expect(page.locator("#sky-view-title")).toContainText("Earth");

  await page.locator("#sky-view-close").click();
  await expect(page.locator("#sky-view")).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("sky")).toBe(false);
  issues.assertClean();
});
