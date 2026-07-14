import { expect, test } from "@playwright/test";
import { ATLAS_BASE_URL, installAtlasPerfInstrumentation, openAtlas, readAtlasPerf, skipIfAtlasUnavailable, waitForCatalogRequestsToSettle } from "./atlas-test-utils";

const state = "v=1&c=0%2C0&z=24&t=now&L=grid.1~labels.1~orbits.1";

test.describe("cross-origin atlas embed", () => {
  test.beforeEach(async ({ request }) => { await skipIfAtlasUnavailable(request); });

  test("loads with attribution and requires activation before capturing interaction", async ({ page }) => {
    const hostUrl = new URL("/about", ATLAS_BASE_URL);
    hostUrl.hostname = hostUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
    await page.goto(hostUrl.toString());
    await page.setContent(`<style>body{height:3000px;margin:0}iframe{display:block;margin-top:700px;width:960px;height:600px}</style><iframe title="hosted atlas" src="${ATLAS_BASE_URL}/embed?${state}"></iframe>`);
    await page.evaluate(() => scrollTo(0, 650));
    const frame = page.frameLocator('iframe[title="hosted atlas"]');
    await expect(frame.locator("#embed-attribution")).toBeVisible();
    await expect(frame.locator("#embed-canonical-link")).toHaveAttribute("target", "_blank");
    await expect(frame.locator("#embed-activation")).toBeVisible();
    await expect(frame.locator("body")).toHaveAttribute("data-embed-active", "false");

    const before = await page.evaluate(() => scrollY);
    const iframe = page.locator('iframe[title="hosted atlas"]');
    const box = await iframe.boundingBox();
    if (!box) throw new Error("embed iframe was unavailable");
    await page.waitForTimeout(400);
    const embedPage = page.frames().find((candidate) => candidate.url().includes("/embed"));
    if (!embedPage) throw new Error("embedded atlas frame was unavailable");
    const zoomBeforeWheel = new URL(embedPage.url()).searchParams.get("z");
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(350);
    expect(new URL(embedPage.url()).searchParams.get("z")).toBe(zoomBeforeWheel);
    await page.mouse.move(Math.min(box.x + box.width + 40, 1400), box.y + 80);
    await page.mouse.wheel(0, 240);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);

    await frame.locator("#embed-activation").click();
    await expect(frame.locator("body")).toHaveAttribute("data-embed-active", "true");
    await expect(frame.locator("#embed-activation")).toBeHidden();

    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await expect(frame.locator("body")).toHaveAttribute("data-embed-visible", "false");
  });

  test("uses no more than half the equivalent full-view tile request budget", async ({ browser }) => {
    const fullContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const full = await fullContext.newPage();
    await installAtlasPerfInstrumentation(full);
    await openAtlas(full, `/?${state}`);
    await waitForCatalogRequestsToSettle(full);
    const fullCount = (await readAtlasPerf(full)).fetches.filter((entry) => /catalog-tiles.*\.(bin|smpk)/.test(entry.url)).length;

    const embedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const embed = await embedContext.newPage();
    await installAtlasPerfInstrumentation(embed);
    await openAtlas(embed, `/embed?${state}`);
    await waitForCatalogRequestsToSettle(embed);
    const embedCount = (await readAtlasPerf(embed)).fetches.filter((entry) => /catalog-tiles.*\.(bin|smpk)/.test(entry.url)).length;
    expect(embedCount).toBeLessThanOrEqual(Math.ceil(fullCount / 2));
    await fullContext.close();
    await embedContext.close();
  });
});
