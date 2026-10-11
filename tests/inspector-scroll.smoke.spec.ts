import { expect, test, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable, expandObjectSheet } from "./atlas-test-utils";

async function scrollMetrics(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
  }));
}

async function wheelOver(page: Page, selector: string, deltaY: number) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must be on the screen`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, deltaY);
}

test.describe("object inspector scroll", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
  });

  test("the inspector body scrolls with the wheel and the keyboard, and the tabs stay at the top", async ({ page }) => {
    await openAtlas(page);
    const issues = collectBrowserIssues(page);
    await selectCatalogObject(page, "Mars", "mars");

    const initial = await scrollMetrics(page, "#body-info");
    expect(initial.scrollHeight, "the Mars overview must be longer than the panel").toBeGreaterThan(initial.clientHeight + 40);
    expect(initial.scrollTop).toBe(0);

    await wheelOver(page, "#body-info", 480);
    await expect.poll(async () => (await scrollMetrics(page, "#body-info")).scrollTop).toBeGreaterThan(0);

    // The tab row is sticky: after a long scroll it is at the top edge of the scroll container.
    await wheelOver(page, "#body-info", 4_000);
    await expect.poll(async () => {
      const container = await scrollMetrics(page, "#body-info");
      const tabs = await page.locator("#body-info .object-view-tabs").boundingBox();
      return tabs ? Math.abs(tabs.y - container.top) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(1);

    for (const view of ["position", "sources"]) {
      await page.locator(`#body-info [data-object-view="${view}"]`).click();
      await expect(page.locator(`#object-view-panel-${view}`)).toBeVisible();
      await wheelOver(page, "#body-info", 6_000);
      await expect.poll(async () => {
        const container = await scrollMetrics(page, "#body-info");
        return container.scrollHeight - container.clientHeight - container.scrollTop;
      }, { message: `${view} must scroll to its end` }).toBeLessThanOrEqual(1);
      const lastRow = page.locator(`#object-view-panel-${view} :is(dd, a, button)`).last();
      const container = await scrollMetrics(page, "#body-info");
      const rowBox = await lastRow.boundingBox();
      expect(rowBox, `last row of ${view}`).not.toBeNull();
      expect(rowBox!.y + rowBox!.height, `last row of ${view} must be in view`).toBeLessThanOrEqual(container.bottom + 1);
      expect(rowBox!.y).toBeGreaterThanOrEqual(container.top);
    }

    // Keyboard: Page Up on a focused tab scrolls the same container. The overview is the long view.
    await page.locator('#body-info [data-object-view="overview"]').click();
    await wheelOver(page, "#body-info", 4_000);
    // The wheel scroll is not immediate: wait for it before the position is read.
    await expect.poll(async () => (await scrollMetrics(page, "#body-info")).scrollTop).toBeGreaterThan(100);
    await page.waitForTimeout(300);
    const beforeKeyboard = (await scrollMetrics(page, "#body-info")).scrollTop;
    expect(beforeKeyboard).toBeGreaterThan(100);
    await page.locator('#body-info [data-object-view="overview"]').focus();
    await page.keyboard.press("PageUp");
    await expect.poll(async () => (await scrollMetrics(page, "#body-info")).scrollTop).toBeLessThan(beforeKeyboard);
    issues.assertClean();
  });

  test("the comparison panel continues to scroll", async ({ page }) => {
    await openAtlas(page);
    const issues = collectBrowserIssues(page);
    await selectCatalogObject(page, "Mars", "mars");
    // A low window, so that the comparison content is longer than the panel.
    await page.setViewportSize({ width: 1440, height: 640 });
    await page.locator("#compare-selected").click();
    await expect(page.locator("#selection-compare")).toBeVisible();

    const initial = await scrollMetrics(page, "#selection-compare");
    expect(initial.scrollHeight, "the comparison content must be longer than the panel").toBeGreaterThan(initial.clientHeight + 40);
    await wheelOver(page, "#selection-compare", 480);
    await expect.poll(async () => (await scrollMetrics(page, "#selection-compare")).scrollTop).toBeGreaterThan(0);
    issues.assertClean();
  });
});

test.describe("object inspector scroll on a tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("Overview, Position, and Sources scroll at 768x1024", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
    await selectCatalogObject(page, "Mars", "mars");
    // A tablet in portrait opens the inspector as a short sheet. The Details button shows all data.
    await expandObjectSheet(page);
    for (const view of ["overview", "position", "sources"]) {
      await page.locator(`#body-info [data-object-view="${view}"]`).click();
      await expect(page.locator(`#object-view-panel-${view}`)).toBeVisible();
      await page.locator("#body-info").evaluate((element) => { element.scrollTop = 0; });
      const metrics = await scrollMetrics(page, "#body-info");
      expect(metrics.scrollHeight, `the ${view} view is longer than the sheet`).toBeGreaterThan(metrics.clientHeight + 40);
      await wheelOver(page, "#body-info", 480);
      await expect.poll(async () => (await scrollMetrics(page, "#body-info")).scrollTop, { message: `${view} scrolls` }).toBeGreaterThan(0);
    }
    // The last row of Sources can come into view.
    const last = page.locator("#object-view-panel-sources").locator("a, button, dd").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});

