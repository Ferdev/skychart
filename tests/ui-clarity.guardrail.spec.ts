import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("compact and understandable atlas controls", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("opens sharing in a compact popover", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await expect(page.locator("#share-popover")).toBeHidden();
    await expect(page.locator("#share-menu-button")).toBeVisible();

    await page.locator("#share-menu-button").click();
    await expect(page.locator("#share-popover")).toBeVisible();
    await expect(page.locator("#share-menu-button")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#copy-link")).toBeVisible();
    await expect(page.locator("#export-image")).toBeVisible();

    await page.locator("#close-share-popover").click();
    await expect(page.locator("#share-popover")).toBeHidden();
    await expect(page.locator("#share-menu-button")).toHaveAttribute("aria-expanded", "false");
    issues.assertClean();
  });

  test("marks the active scale section without moving the scale panel", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const scalePanel = page.locator(".scale-rail");
    const before = await scalePanel.boundingBox();
    const objectSection = page.locator('[data-scale-disclosure]:has([aria-controls="scale-object-display"])');

    await objectSection.locator(".scale-collapse__toggle").click();
    await expect(objectSection).toHaveClass(/is-open/);
    await expect(objectSection.locator(".scale-collapse__toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#scale-object-display")).toBeVisible();
    const after = await scalePanel.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), "scale panel top remains stable").toBeLessThanOrEqual(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0)), "scale panel height remains stable").toBeLessThanOrEqual(1);

    const overlaySection = page.locator('[data-scale-disclosure]:has([aria-controls="scale-map-overlays"])');
    await overlaySection.locator(".scale-collapse__toggle").click();
    await expect(overlaySection).toHaveClass(/is-open/);
    await expect(objectSection).not.toHaveClass(/is-open/);
    await expect(page.locator("#scale-object-display")).toBeHidden();
    issues.assertClean();
  });

  test("explains ambiguous object size modes with an accessible info tip", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const infoButton = page.getByRole("button", { name: "Explain object size modes" });
    await infoButton.click();
    await expect(page.locator("#control-info-tooltip")).toBeVisible();
    await expect(page.locator("#control-info-tooltip")).toContainText("Readable enlarges tiny objects");
    await page.keyboard.press("Escape");
    await expect(page.locator("#control-info-tooltip")).toBeHidden();
    issues.assertClean();
  });
});
