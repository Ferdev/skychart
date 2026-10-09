import { expect, test } from "@playwright/test";
import { skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("server pages", () => {
  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
  });

  test("the tour pages are standalone pages with a list and no map", async ({ page }) => {
    await page.goto("/tours");
    await expect(page.locator("h1")).toHaveText("Guided tours");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator("#app")).toHaveCount(0);
    await expect(page.locator(".back")).toHaveText("← Back to the atlas");
    await expect(page.locator("ol.steps > li")).toHaveCount(2);
    // One sans-serif font stack: no serif heading.
    const headingFont = await page.locator("h1").evaluate((heading) => getComputedStyle(heading).fontFamily);
    expect(headingFont).not.toMatch(/Georgia|(^|,\s*)serif/);

    await page.locator('a[href="/tours/near-the-sun"]').click();
    await expect(page.locator("h1")).toHaveText("What is actually near the Sun");
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.locator("a.action").click();
    await expect(page).toHaveURL(/[?&]tour=near-the-sun/);
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
  });

  for (const key of ["mars", "Mars"]) {
    test(`/o/${key} opens Mars, and the server text is not on the map`, async ({ page }) => {
      await page.goto(`/o/${key}`);
      await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
      await expect(page.locator("#selected-summary-name")).toHaveText("Mars");
      // The server article stays in the page for crawlers. It takes no room on the map.
      const article = page.locator("#app > article");
      await expect(article).toHaveCount(1);
      const box = await article.boundingBox();
      expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
      // The application keeps the title of the server page.
      await expect(page).toHaveTitle(/Mars/);
    });
  }

  test("/o/m31 shows the full galaxy", async ({ page }) => {
    await page.goto("/o/m31");
    await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
    await expect(page.locator("#selected-summary-name")).toContainText(/Andromeda|M31/);
    // The galaxy has a diameter of about 150,000 to 220,000 light-years. The view is wider than
    // the galaxy and not so wide that the galaxy is a point.
    await expect.poll(async () => {
      const text = (await page.locator("#zoom-view-scale").textContent()) ?? "";
      const match = /([\d.,]+)\s*(million)?\s*ly/.exec(text);
      if (!match) return 0;
      return Number(match[1]!.replace(/,/g, "")) * (match[2] ? 1_000_000 : 1);
    }, { timeout: 20_000 }).toBeGreaterThan(250_000);
    const viewWidthLy = await page.locator("#zoom-view-scale").textContent().then((text) => {
      const match = /([\d.,]+)\s*(million)?\s*ly/.exec(text ?? "")!;
      return Number(match[1]!.replace(/,/g, "")) * (match[2] ? 1_000_000 : 1);
    });
    expect(viewWidthLy).toBeLessThan(4_000_000);
  });

  test("not-found pages have the page style, and an unknown API address returns JSON", async ({ request }) => {
    for (const [path, heading] of [["/o/not-a-real-object", "Object not found"], ["/tours/not-a-tour", "Tour not found"]] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      const body = await response.text();
      expect(body).toContain(`<h1>${heading}</h1>`);
      expect(body).toContain("Back to the atlas");
      expect(body).not.toContain('id="app"');
    }
    for (const accept of ["application/json", "*/*", "text/html"]) {
      const response = await request.get("/api/no-such-endpoint", { headers: { accept } });
      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect(await response.json()).toEqual({ errors: { detail: "Not Found" } });
    }
  });
});
