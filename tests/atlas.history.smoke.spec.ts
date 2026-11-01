import { expect, test, type Page } from "@playwright/test";
import { openAtlas, openSearchWorkspace, selectCatalogObject } from "./atlas-test-utils";

const SECOND_STEP = "The nearest measured stars";
const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);

async function dragMap(page: Page) {
  const box = (await page.locator("#map").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
}

test.describe("Back, Forward, and the address of a tour", () => {
  test("Back to a view with no object closes the inspector", async ({ page }) => {
    await openAtlas(page);
    await expect.poll(() => param(page, "o")).toBeNull();
    await selectCatalogObject(page, "Mars", "mars");
    await expect.poll(() => param(page, "o")).toBe("mars");
    await page.goBack();
    await expect.poll(() => param(page, "o")).toBeNull();
    await expect(page.locator("#selected-object")).toBeHidden();
    await expect(page.locator("#workspace-panel")).toBeHidden();
  });

  test("a failed object request during Back does not stop address updates", async ({ page }) => {
    await openAtlas(page);
    await selectCatalogObject(page, "Mars", "mars");
    await expect.poll(() => param(page, "o")).toBe("mars");
    await selectCatalogObject(page, "Venus", "venus");
    await expect.poll(() => param(page, "o")).toBe("venus");
    await page.route("**/api/objects/**", (route) => route.abort());
    await page.goBack();
    await expect.poll(() => param(page, "o")).toBe("mars");
    const before = param(page, "c");
    await dragMap(page);
    await expect.poll(() => param(page, "c")).not.toBe(before);
  });

  test("a tour keeps its step and language when the user selects an object and reloads", async ({ page }) => {
    // The helper that opens the atlas waits for English text, and this page is in Spanish.
    await page.goto("/?tour=near-the-sun&lang=es", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center", { timeout: 45_000 });
    await page.locator('[data-tour-action="next"]').click();
    await expect.poll(() => param(page, "step")).toBe("1");
    expect(param(page, "lang")).toBe("es");
    const address = page.url();

    // This step shows only stars, so the search needs the All filter to find a planet.
    await openSearchWorkspace(page);
    await page.locator('#tab-catalog [data-body-filter="all"]').click();
    await selectCatalogObject(page, "Venus", "venus");
    await expect(page.locator("#selected-summary-name")).toContainText("Venus");
    await expect.poll(() => page.url()).toBe(address);

    await page.reload();
    await expect(page.locator("#tour-player h2")).toHaveText(SECOND_STEP);
    expect(param(page, "tour")).toBe("near-the-sun");
    expect(param(page, "step")).toBe("1");
  });

  test("after a tour closes, Back to its address does not stop address updates", async ({ page }) => {
    await openAtlas(page);
    await page.goto("/?tour=near-the-sun");
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    await page.locator('[data-tour-action="next"]').click();
    await expect.poll(() => param(page, "step")).toBe("1");
    await page.locator('[data-tour-action="next"]').click();
    await expect.poll(() => param(page, "step")).toBe("2");
    await page.locator('[data-tour-action="close"]').click();
    await expect.poll(() => param(page, "tour")).toBeNull();
    await page.goBack();
    await expect.poll(() => param(page, "tour")).toBe("near-the-sun");
    await dragMap(page);
    await expect.poll(() => param(page, "tour")).toBeNull();
  });
});
