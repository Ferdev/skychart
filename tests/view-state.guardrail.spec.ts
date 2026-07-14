import { expect, test } from "@playwright/test";
import { openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("shareable atlas view state", () => {
  test.beforeEach(async ({ request }) => { await skipIfAtlasUnavailable(request); });

  test("deep link round-trips camera, epoch, layers, filters, and selection", async ({ page, context }) => {
    const timestamp = "2042-04-05T06:07:08.000Z";
    await page.goto(`/?v=1&c=12.5%2C-7.25&z=0.125&t=${encodeURIComponent(timestamp)}&o=mars&r=v9&L=grid.0~labels.1~milkyWay.1~milkyWayArms.1~milkyWayDust.1~milkyWayGuides.1~orbits.1~references.1&F=planet.all`);
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#selected-summary-name")).toHaveText("Mars");
    await expect(page.locator('input[data-layer="grid"]')).not.toBeChecked();
    await expect(page.locator('#body-filter-buttons [data-body-filter="planet"]')).toHaveClass(/active/);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#share-menu-button").click();
    await page.locator("#copy-link").click();
    await expect(page.locator("#share-feedback")).toHaveText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const restored = await context.newPage();
    await restored.goto(copied);
    await expect(restored.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(restored.locator("#selected-summary-name")).toHaveText("Mars");
    await expect(restored.locator('input[data-layer="grid"]')).not.toBeChecked();
    expect(new URL(restored.url()).searchParams.get("c")?.split(",").map(Number)).toEqual([12.5, -7.25]);
    expect(Number(new URL(restored.url()).searchParams.get("z"))).toBe(0.125);
    expect(new URL(restored.url()).searchParams.get("t")).toBe(timestamp);
  });

  test("panning replaces history while selection pushes a navigable entry", async ({ page }) => {
    await openAtlas(page);
    const initialLength = await page.evaluate(() => history.length);
    const box = await page.locator("#map").boundingBox();
    if (!box) throw new Error("map canvas was unavailable");
    for (let index = 0; index < 5; index += 1) {
      await page.mouse.move(box.x + 500, box.y + 450); await page.mouse.down();
      await page.mouse.move(box.x + 510 + index * 2, box.y + 455); await page.mouse.up();
    }
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => history.length)).toBe(initialLength);
    await selectCatalogObject(page, "Mars", "mars", "Mars");
    expect(await page.evaluate(() => history.length)).toBe(initialLength + 1);
    await page.goBack();
    await expect(page.locator("#selected-object-panel")).toBeHidden();
  });
});
