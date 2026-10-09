import { expect, test, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

type Point = { x: number; y: number };

const bodyScreen = (page: Page, key: string) => page.evaluate((bodyKey) => window.__ATLAS_DIAGNOSTICS__!.bodyScreen(bodyKey), key);
const visibleKeys = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.visibleBodyKeys());
const drawnLabels = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.drawnLabels());
const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const mapCursor = (page: Page) => page.locator("#map").evaluate((canvas) => (canvas as HTMLElement).style.cursor);

async function expectOnMap(page: Page, point: Point, what: string) {
  const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? "", point);
  expect(target, `${what} must be on the free map area`).toBe("map");
}

test.describe("object and label selection on the 2D map", () => {
  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
  });

  test("a click on a planet at the Solar preset selects the planet, not one of its moons", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);

    // At this scale no moon is resolved from its planet, so no moon has a marker or a label.
    const moons = ["moon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "titan", "rhea", "iapetus"];
    const visible = await visibleKeys(page);
    expect(visible).toEqual(expect.arrayContaining(["sun", "earth", "jupiter", "saturn"]));
    expect(visible.filter((key) => moons.includes(key))).toEqual([]);
    expect((await drawnLabels(page)).map((label) => label.key).filter((key) => moons.includes(key))).toEqual([]);

    const saturn = await bodyScreen(page, "saturn");
    expect(saturn, "Saturn must be in the Solar preset view").not.toBeNull();
    await expectOnMap(page, saturn!, "Saturn");
    await page.mouse.move(saturn!.x + 1, saturn!.y + 1);
    await expect.poll(() => mapCursor(page)).toBe("pointer");
    await page.mouse.click(saturn!.x + 1, saturn!.y + 1);
    await expect(page.locator("#selected-object-panel")).toBeVisible();
    await expect(page.locator("#selected-summary-name")).toHaveText("Saturn");
    issues.assertClean();
  });

  test("a click on a visible label selects its object, and the pointer changes on the label", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);
    const label = (await drawnLabels(page)).find((entry) => entry.key === "jupiter");
    expect(label, "the Jupiter label must be drawn at the Solar preset").toBeTruthy();
    const jupiter = await bodyScreen(page, "jupiter");
    // The far end of the label is well outside the marker hit radius, so only the label rectangle can react here.
    const point = { x: label!.rect.right - 4, y: (label!.rect.top + label!.rect.bottom) / 2 };
    expect(Math.hypot(point.x - jupiter!.x, point.y - jupiter!.y)).toBeGreaterThan(20);
    await expectOnMap(page, point, "the Jupiter label");

    await page.mouse.move(point.x, point.y);
    await expect.poll(() => mapCursor(page)).toBe("pointer");
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#selected-summary-name")).toHaveText("Jupiter");
    issues.assertClean();
  });

  test("a moon can be selected when the zoom resolves it from its planet", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);
    expect(await visibleKeys(page)).not.toContain("iapetus");
    // The moons of the outer planets load after the first frame. Wait for the data of Iapetus.
    await expect.poll(() => bodyScreen(page, "iapetus"), { message: "the ephemeris of Iapetus must load", timeout: 45_000 }).not.toBeNull();

    let separation = 0;
    for (let step = 0; step < 40 && separation < 16; step += 1) {
      const saturn = await bodyScreen(page, "saturn");
      await expectOnMap(page, saturn!, "Saturn");
      await page.mouse.move(saturn!.x, saturn!.y);
      await page.mouse.wheel(0, -320);
      await nextFrame(page);
      const [planet, moon] = [await bodyScreen(page, "saturn"), await bodyScreen(page, "iapetus")];
      separation = Math.hypot(planet!.x - moon!.x, planet!.y - moon!.y);
    }
    expect(separation, "the zoom must resolve Iapetus from Saturn").toBeGreaterThanOrEqual(16);
    await expect.poll(() => visibleKeys(page)).toContain("iapetus");

    const iapetus = await bodyScreen(page, "iapetus");
    await expectOnMap(page, iapetus!, "Iapetus");
    await page.mouse.click(iapetus!.x, iapetus!.y);
    await expect(page.locator("#selected-summary-name")).toHaveText("Iapetus");
    issues.assertClean();
  });
});
