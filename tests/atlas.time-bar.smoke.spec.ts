import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable, skyEphemerisFixture } from "./atlas-test-utils";

const mapDate = (page: Page) => page.locator("#time-bar .time-bar__date-text");
const skyDate = (page: Page) => page.locator("#sky-time-bar .time-bar__date-text");

/**
 * The ephemeris for each atlas time comes from a fixture (the Sun and Earth at the requested time).
 * A real ephemeris for a new time is a heavy calculation with calls to an external service, and
 * these tests are about the time controls, not about the positions.
 */
async function routeTimeFixture(context: BrowserContext) {
  const json = (payload: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  await context.route(/\/api\/ephemeris(?:\?.*)?$/, (route) => {
    const timestamp = new URL(route.request().url()).searchParams.get("timestamp") ?? new Date().toISOString();
    return route.fulfill(json(skyEphemerisFixture(timestamp)));
  });
  await context.route("**/api/catalog/sky?**", (route) => route.fulfill(json({ returned: 0, points: [] })));
  await context.route("**/api/catalog/viewport?**", (route) => route.fulfill(json({ bounds: {}, limit: 0, total: 0, objects: [] })));
  await context.route("**/api/spacecraft?**", (route) => route.fulfill(json({ bodies: [] })));
  await context.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
}

test.describe("permanent time bar", () => {
  test.beforeEach(async ({ request, context }) => {
    await skipIfAtlasUnavailable(request);
    await routeTimeFixture(context);
  });

  test("a time step in Sky view shows on the 2D map, and Now sets the current time again", async ({ page }) => {
    test.setTimeout(120_000);
    await openAtlas(page);
    const issues = collectBrowserIssues(page);

    // The 2D header shows the atlas time in UTC with no panel open.
    await expect(mapDate(page)).toBeVisible();
    await expect(mapDate(page)).toHaveText(/\d{4}.*UTC$/);
    await expect(page.locator("#time-bar")).toHaveAttribute("data-time-state", "now");
    await expect(page.locator("#time-now")).toHaveAttribute("aria-pressed", "true");
    // Step back and step forward have the same style (the old Back button looked like a primary action).
    const stepStyles = await page.locator("#time-step-back, #time-step-forward").evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      return `${style.backgroundColor}|${style.color}|${style.borderTopColor}`;
    }));
    expect(stepStyles[0]).toBe(stepStyles[1]);

    await selectCatalogObject(page, "Earth", "earth");
    await page.locator("#view-sky-selected").click();
    await expect(page.locator("#sky-view")).toBeVisible();
    const startDate = await skyDate(page).textContent();
    await expect(page.locator("#sky-time-back")).toHaveAccessibleName("Step back 1 month");
    await page.locator("#sky-time-forward").click();
    await expect(skyDate(page)).not.toHaveText(startDate!, { timeout: 45_000 });
    const steppedDate = await skyDate(page).textContent();
    await expect(page.locator("#sky-time-bar")).toHaveAttribute("data-time-state", "not-now");

    // After the exit from Sky view, the 2D map shows the same date and shows that it is not the current time.
    await page.locator("#sky-view-close").click();
    await expect(page.locator("#sky-view")).toBeHidden();
    await expect(mapDate(page)).toHaveText(steppedDate!);
    await expect(page.locator("#time-bar")).toHaveAttribute("data-time-state", "not-now");
    await expect(page.locator("#time-now")).toHaveAttribute("aria-pressed", "false");

    // One click corrects it.
    await page.locator("#time-now").click();
    await expect(page.locator("#time-bar")).toHaveAttribute("data-time-state", "now", { timeout: 45_000 });
    await expect(mapDate(page)).not.toHaveText(steppedDate!);
    issues.assertClean();
  });

  test("the date opens the date and time field, and the step size is in the bar", async ({ page }) => {
    test.setTimeout(120_000);
    await openAtlas(page);
    const issues = collectBrowserIssues(page);
    await expect(page.locator("#map-settings #time-input")).toHaveCount(0);

    await page.locator("#time-date").click();
    await expect(page.locator("#time-popover")).toBeVisible();
    await page.locator("#time-input").fill("2031-03-04T05:06:07");
    await page.locator("#apply-time").click();
    await expect(page.locator("#time-popover")).toBeHidden();
    await expect(mapDate(page)).toHaveText(/2031/, { timeout: 45_000 });
    await expect(page.locator("#time-bar")).toHaveAttribute("data-time-state", "not-now");

    // The step size menu changes the step of the two step buttons.
    await page.locator("#time-step-size").selectOption({ label: "1 year" });
    await expect(page.locator("#time-step-back")).toHaveAccessibleName("Step back 1 year");
    await expect(page.locator("#time-step-forward")).toContainText("1 year");
    await page.locator("#time-step-back").click();
    await expect(mapDate(page)).toHaveText(/2030/, { timeout: 45_000 });
    issues.assertClean();
  });

  test("play steps the time and pause stops it", async ({ page }) => {
    test.setTimeout(120_000);
    await openAtlas(page);
    const issues = collectBrowserIssues(page);
    const startDate = await mapDate(page).textContent();
    await expect(page.locator("#time-play")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#time-play").click();
    await expect(page.locator("#time-play")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#time-play")).toHaveText("Pause");
    await expect(mapDate(page)).not.toHaveText(startDate!, { timeout: 45_000 });
    await page.locator("#time-play").click();
    await expect(page.locator("#time-play")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
    const pausedDate = await mapDate(page).textContent();
    await page.waitForTimeout(2_500);
    await expect(mapDate(page), "the time does not change after the pause").toHaveText(pausedDate!);
    issues.assertClean();
  });
});
