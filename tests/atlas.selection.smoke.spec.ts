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
    // The atlas is ready before its first frame is drawn on a slow browser: wait for the label.
    await expect.poll(async () => (await drawnLabels(page)).some((entry) => entry.key === "jupiter"),
      { message: "the Jupiter label must be drawn at the Solar preset", timeout: 30_000 }).toBe(true);
    const label = (await drawnLabels(page)).find((entry) => entry.key === "jupiter");
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
    // The Moon is in the first ephemeris of the atlas (the moons of the outer planets come later from a
    // different service). At the Solar preset it is on top of Earth and has no marker.
    await expect.poll(() => bodyScreen(page, "moon"), { message: "the ephemeris of the Moon must load", timeout: 45_000 }).not.toBeNull();
    expect(await visibleKeys(page)).not.toContain("moon");

    let separation = 0;
    for (let step = 0; step < 60 && separation < 16; step += 1) {
      const earth = await bodyScreen(page, "earth");
      await expectOnMap(page, earth!, "Earth");
      await page.mouse.move(earth!.x, earth!.y);
      await page.mouse.wheel(0, -320);
      await nextFrame(page);
      const [planet, moon] = [await bodyScreen(page, "earth"), await bodyScreen(page, "moon")];
      separation = Math.hypot(planet!.x - moon!.x, planet!.y - moon!.y);
    }
    expect(separation, "the zoom must resolve the Moon from Earth").toBeGreaterThanOrEqual(16);
    await expect.poll(() => visibleKeys(page)).toContain("moon");

    const moon = await bodyScreen(page, "moon");
    await expectOnMap(page, moon!, "the Moon");
    await page.mouse.click(moon!.x, moon!.y);
    await expect(page.locator("#selected-summary-name")).toHaveText("Moon");
    issues.assertClean();
  });
});
