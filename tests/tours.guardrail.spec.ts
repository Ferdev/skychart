import { expect, test } from "@playwright/test";
import { skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("guided tours", () => {
  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
  });

  test("plays captions with history-backed steps", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");

    await page.locator("[data-tour-action='next']").click();
    await expect(page.locator("#tour-player h2")).toHaveText("The nearest measured stars");
    expect(new URL(page.url()).searchParams.get("step")).toBe("1");

    await page.goBack();
    await expect(page).toHaveURL(/(?:\?|&)step=0(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
  });

  test("reduced motion cuts between views", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await page.locator("[data-tour-action='next']").click();
    await expect(page.locator("#tour-player")).toHaveAttribute("data-motion", "cut");
  });

  test("only the latest rapid tour transition commits", async ({ page }) => {
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    const next = page.locator("[data-tour-action='next']");

    await next.click();
    await next.click();

    await expect(page).toHaveURL(/(?:\?|&)step=2(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("Nearby stellar space");
  });

  test("rapid forward then backward navigation keeps the latest step", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    await expect(page).toHaveURL(/(?:\?|&)step=0(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
  });

  test("closing during a transition prevents its history commit", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });

    await page.locator("[data-tour-action='next']").click();
    await page.locator("[data-tour-action='close']").click();
    await page.waitForTimeout(900);

    await expect(page.locator("#tour-player")).toBeHidden();
    expect(new URL(page.url()).searchParams.get("step")).toBe("0");
  });
});
