import { expect, test } from "@playwright/test";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 680 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test.describe(`toolbar at ${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
    test(`compact toolbar keeps common controls reachable at ${viewport.width}px`, async ({ page, context }, testInfo) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/api/**", route => {
        const url = new URL(route.request().url());
        let payload: unknown = {};
        if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
        if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
        if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
        if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
        if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
        if (url.pathname === "/api/now") payload = { events: [] };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      });
      await context.route("**/catalog-tiles/**", route => route.fulfill({ status: 404, body: "" }));
      await openAtlas(page);
      const toolbar = page.locator(".atlas-toolbar");
      const settings = page.getByRole("dialog", { name: "Settings", exact: true });
      const settingsToggle = page.locator("#map-settings-toggle");
      const before = await toolbar.boundingBox();
      expect(before!.height).toBeLessThanOrEqual(viewport.width < 900 ? 175 : 125);
      expect(before!.x).toBeGreaterThanOrEqual(0);
      expect(before!.x + before!.width).toBeLessThanOrEqual(viewport.width);
      await expect(settings).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath("toolbar.png") });
      await toolbar.screenshot({ path: testInfo.outputPath("toolbar-detail.png") });
      for (const layer of ["constellations", "labels", "grid"]) {
        await expect(toolbar.locator(`.toolbar-quick-layers input[data-layer="${layer}"]`)).toBeVisible();
      }
      await expect(page.locator("#zoom-scale-slider")).toBeVisible();
      await expect(page.locator("#zoom-presets button")).toHaveCount(4);
      await page.locator('.toolbar-quick-layers input[data-layer="constellations"]').check();
      await page.locator('input[data-layer="grid"]').uncheck();
      await expect(page).toHaveURL(/constellations.1/);
      await expect(page).toHaveURL(/grid.0/);
      const zoom = await page.locator("#zoom-view-scale").textContent();
      await page.locator("#zoom-in").click();
      await expect(page.locator("#zoom-view-scale")).not.toHaveText(zoom!);
      await page.locator('[data-zoom-preset="nearby"]').click();
      await expect(page.locator('[data-zoom-preset="nearby"]')).toHaveAttribute("aria-pressed", "true");
      if (viewport.width < 900) await settingsToggle.tap();
      else await settingsToggle.click();
      await expect(settings).toBeVisible();
      await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
      await page.locator('[aria-controls="scale-map-overlays"]').click();
      await page.locator('input[data-layer="orbits"]').uncheck();
      await expect(page).toHaveURL(/orbits.0/);
      await page.locator('[aria-controls="scale-object-display"]').click();
      await page.locator('[data-size-mode="readable"]').click();
      await expect(page.locator('[data-size-mode="readable"]')).toHaveClass(/active/);
      await page.screenshot({ path: testInfo.outputPath("settings.png") });
      const panelBounds = await settings.boundingBox();
      expect(panelBounds!.y).toBeGreaterThanOrEqual(0);
      expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(panelBounds!.y + panelBounds!.height).toBeLessThanOrEqual(before!.y);
      expect(await toolbar.boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();
      await expect(settingsToggle).toBeFocused();
      await settingsToggle.click();
      await page.locator("#zoom-out").click();
      await expect(settings).toBeHidden();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator('.toolbar-quick-layers input[data-layer="constellations"]')).toBeChecked();
      await expect(page.locator('input[data-layer="grid"]')).not.toBeChecked();
      await settingsToggle.click();
      await page.locator('[aria-controls="scale-map-overlays"]').click();
      await expect(page.locator('input[data-layer="orbits"]')).not.toBeChecked();
      await page.keyboard.press("Escape");
      await page.locator("#locale-select").selectOption("de");
      await expect(settingsToggle).toHaveText("Einstellungen");
      const overflow = await toolbar.locator("button, label, input[type=range]").evaluateAll(elements => elements
        .filter(element => element.getClientRects().length > 0)
        .some(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < 0 || rect.right > window.innerWidth;
        }));
      expect(overflow, "translated controls stay inside the viewport").toBe(false);
      await settingsToggle.click();
      await page.locator('[aria-controls="scale-constellations"]').click();
      await page.locator("#constellations-hide-all").click();
      await page.locator("#constellation-search").fill("orion");
      const orion = page.locator('[data-constellation="orion"]');
      await orion.check();
      await expect(page.locator("#constellation-count")).toHaveText("1 von 87 ausgewählt");
      await expect(page.locator("#constellation-list label:visible")).toHaveCount(1);
      await expect(page.locator('#scale-constellations input[data-layer="constellations"]')).toBeChecked();
      const row = await orion.locator("..").boundingBox();
      const panel = await page.locator("#map-settings").boundingBox();
      expect(row!.height).toBeGreaterThanOrEqual(44);
      expect(row!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(row!.x + row!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
      expect(row!.y + row!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
      await page.screenshot({ path: testInfo.outputPath("constellation-settings.png") });
      expect(errors).toEqual([]);
    });
  });
}
