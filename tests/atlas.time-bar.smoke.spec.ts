import { expect, test, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

const mapDate = (page: Page) => page.locator("#time-bar .time-bar__date-text");
const skyDate = (page: Page) => page.locator("#sky-time-bar .time-bar__date-text");

test.describe("permanent time bar", () => {
  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
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

    await selectCatalogObject(page, "Mars", "mars");
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
