import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("Cosmic Atlas mobile layout", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("centers the map in the space between top controls and the bottom scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    const balance = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map");
      const context = canvas?.getContext("2d");
      const headerBottom = Math.max(
        document.querySelector<HTMLElement>(".atlas-bar")?.getBoundingClientRect().bottom ?? 0,
        document.querySelector<HTMLElement>(".mode-rail:not([hidden])")?.getBoundingClientRect().bottom ?? 0
      );
      const scaleTop = document.querySelector<HTMLElement>(".scale-rail")?.getBoundingClientRect().top ?? window.innerHeight;
      if (!canvas || !context) return { topPixels: 0, bottomPixels: 0, usableHeight: 0, ratio: 0 };

      const top = Math.ceil(headerBottom + 8);
      const bottom = Math.floor(scaleTop - 10);
      const middle = (top + bottom) / 2;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let topPixels = 0;
      let bottomPixels = 0;

      for (let y = top; y < bottom; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const red = data[offset] ?? 255;
          const green = data[offset + 1] ?? 255;
          const blue = data[offset + 2] ?? 255;
          const alpha = data[offset + 3] ?? 0;
          const isBackground = red > 238 && green > 238 && blue > 238;
          if (alpha > 20 && !isBackground) {
            if (y < middle) topPixels += 1;
            else bottomPixels += 1;
          }
        }
      }

      return {
        topPixels,
        bottomPixels,
        usableHeight: bottom - top,
        ratio: bottomPixels / Math.max(1, topPixels)
      };
    });

    expect(balance.usableHeight, "mobile usable map height").toBeGreaterThan(500);
    expect(balance.topPixels, "map content in upper half").toBeGreaterThan(1_000);
    expect(balance.bottomPixels, "map content in lower half").toBeGreaterThan(1_000);
    expect(balance.ratio, "lower-half map content should not collapse after header controls").toBeGreaterThan(0.35);

    issues.assertClean();
  });

  test("keeps the physical frame and zoom controls legible in the compact scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await expect(page.locator(".map-frame-status")).toHaveText("Heliocentric ecliptic plane");
    await expect(page.locator('[data-projection-mode="sky-sphere"]')).toHaveCount(0);
    const slider = page.locator("#zoom-scale-slider");
    const box = await slider.boundingBox();
    expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    issues.assertClean();
  });

  test("keeps footer links clear of the bottom scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const mobileScaleToggle = page.locator("#mobile-scale-toggle");
    const collapsed = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".atlas-footer")?.getBoundingClientRect();
      const scale = document.querySelector<HTMLElement>(".scale-rail")?.getBoundingClientRect();
      return footer && scale ? footer.bottom <= scale.top - 8 : false;
    });
    expect(collapsed, "footer must sit above the compact scale sheet").toBe(true);

    await mobileScaleToggle.click();
    await expect(page.locator("#controls")).toHaveClass(/scale-expanded/);
    await expect(page.locator(".atlas-footer")).toHaveCSS("pointer-events", "none");
    await expect(page.locator(".atlas-footer")).toHaveCSS("opacity", "0");
    issues.assertClean();
  });

  test("keeps the compact share trigger clear of navigation and reveals export actions on demand", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || element.hidden) return null;
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
      };
      const intersects = (left: NonNullable<ReturnType<typeof rect>>, right: NonNullable<ReturnType<typeof rect>>) =>
        left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;

      const shareTrigger = rect("#share-menu-button");
      const protectedSurfaces = [".atlas-bar", ".mode-rail:not([hidden])", ".scale-rail", ".atlas-footer"]
        .map((selector) => ({ selector, bounds: rect(selector) }))
        .filter((entry): entry is { selector: string; bounds: NonNullable<ReturnType<typeof rect>> } => entry.bounds !== null);

      return {
        shareTrigger,
        collisions: shareTrigger ? protectedSurfaces.filter((entry) => intersects(shareTrigger, entry.bounds)).map((entry) => entry.selector) : [],
        viewport: { width: window.innerWidth, height: window.innerHeight }
      };
    });

    expect(geometry.viewport).toEqual({ width: 390, height: 844 });
    expect(geometry.shareTrigger, "mobile share trigger bounds").not.toBeNull();
    expect(geometry.shareTrigger?.height, "compact share trigger height").toBeLessThanOrEqual(46);
    expect(geometry.collisions, "share trigger must not cover mobile controls or footer").toEqual([]);

    await page.locator("#share-menu-button").click();
    await expect(page.locator("#share-popover")).toBeVisible();
    await expect(page.locator("#export-image")).toBeVisible();
    await page.locator("#export-resolution").selectOption("4k");
    await expect(page.locator("#export-resolution")).toHaveValue("4k");
    await page.locator("#close-share-popover").click();

    await page.locator('[data-tab="catalog"]').click();
    await expect(page.locator("#workspace-panel")).toBeVisible();
    const workspaceGap = await page.evaluate(() => {
      const exportBounds = document.querySelector<HTMLElement>("#share-menu-button")?.getBoundingClientRect();
      const workspaceBounds = document.querySelector<HTMLElement>("#workspace-panel")?.getBoundingClientRect();
      return exportBounds && workspaceBounds ? workspaceBounds.top - exportBounds.bottom : -1;
    });
    expect(workspaceGap, "share trigger must stay above the open mobile workspace").toBeGreaterThanOrEqual(8);

    issues.assertClean();
  });

  test("keeps the selected object visible above its mobile detail sheet", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);
    const initialJupiter = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.bodyScreen("jupiter"));
    expect(initialJupiter, "Jupiter should be rendered in the initial atlas view").not.toBeNull();
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? "", initialJupiter!)).toBe("map");
    await page.mouse.click(initialJupiter!.x, initialJupiter!.y);
    await expect(page.locator("#selected-object-panel")).toBeVisible();
    await expect(page.locator("#selected-summary-name")).toContainText("Jupiter");

    const geometry = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(geometry.workspaceTop, "mobile object sheet top").not.toBeNull();
    expect(geometry.workspaceTop!, "object sheet should leave a meaningful map region visible").toBeGreaterThan(320);
    expect(geometry.selected, "selected object screen position").not.toBeNull();
    expect(geometry.selected!.x).toBeGreaterThanOrEqual(geometry.usable.left + 12);
    expect(geometry.selected!.x).toBeLessThanOrEqual(geometry.usable.right - 12);
    expect(geometry.selected!.y).toBeGreaterThanOrEqual(geometry.usable.top + 12);
    expect(geometry.selected!.y).toBeLessThanOrEqual(geometry.usable.bottom - 12);
    expect(geometry.selected!.y, "selected object must stay above the detail sheet").toBeLessThan(geometry.workspaceTop! - 12);

    const hitTarget = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { id: element?.id ?? "", insideWorkspace: Boolean(element?.closest("#workspace-panel")) };
    }, geometry.selected!);
    expect(hitTarget).toEqual({ id: "map", insideWorkspace: false });

    await expect(page.locator("#body-popover")).toHaveCount(0);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const landscape = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(landscape.workspaceTop, "landscape object sheet top").not.toBeNull();
    expect(landscape.usable.bottom, "usable map must stop above the sheet even when less than 160px tall").toBeLessThanOrEqual(landscape.workspaceTop! - 10);
    expect(landscape.selected!.y).toBeLessThan(landscape.workspaceTop! - 10);
    issues.assertClean();
  });

  test("pinches the atlas itself to zoom on touch screens", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);
    const before = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    const client = await page.context().newCDPSession(page);
    const center = {
      x: (before.usable.left + before.usable.right) / 2,
      y: (before.usable.top + before.usable.bottom) / 2
    };
    const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? "", center);
    expect(target, "pinch center must hit the atlas canvas").toBe("map");

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 1, x: center.x - 35, y: center.y, radiusX: 4, radiusY: 4, force: 1 },
        { id: 2, x: center.x + 35, y: center.y, radiusX: 4, radiusY: 4, force: 1 }
      ]
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { id: 1, x: center.x - 70, y: center.y, radiusX: 4, radiusY: 4, force: 1 },
        { id: 2, x: center.x + 70, y: center.y, radiusX: 4, radiusY: 4, force: 1 }
      ]
    });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    const after = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(after.camera.pxPerAu).toBeGreaterThan(before.camera.pxPerAu * 1.4);
    expect(after.selected, "pinching must not select an object").toBeNull();

    await page.evaluate(({ x, y }) => {
      const map = document.querySelector<HTMLCanvasElement>("#map");
      if (!map) return;
      const dispatch = (type: string, pointerId: number, clientX: number, isPrimary: boolean) =>
        map.dispatchEvent(new PointerEvent(type, { bubbles: true, buttons: type === "pointerup" ? 0 : 1, clientX, clientY: y, isPrimary, pointerId, pointerType: "touch" }));
      dispatch("pointerdown", 101, x - 35, true);
      dispatch("pointerdown", 102, x + 35, false);
      dispatch("pointerup", 102, x + 35, false);
    }, center);
    expect(await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.gestureState().activePointerIds)).toEqual([101]);
    const tailStart = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    await page.evaluate(({ x, y }) => {
      const map = document.querySelector<HTMLCanvasElement>("#map");
      map?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: x, clientY: y, isPrimary: true, pointerId: 101, pointerType: "touch" }));
      map?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, isPrimary: true, pointerId: 101, pointerType: "touch" }));
    }, { x: center.x, y: center.y });
    const tailEnd = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(Math.abs(tailEnd.camera.xAu - tailStart.camera.xAu), "remaining finger should continue panning after a pinch").toBeGreaterThan(0.01);
    expect(tailEnd.selected, "pinch-to-pan must not end as a click").toBeNull();

    await page.evaluate(({ x, y }) => {
      const map = document.querySelector<HTMLCanvasElement>("#map");
      map?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, buttons: 1, clientX: x, clientY: y, isPrimary: true, pointerId: 103, pointerType: "touch" }));
      map?.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 103 }));
    }, center);
    await expect.poll(() => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.gestureState().activePointerIds)).toEqual([]);

    await expect(page.locator("#map")).toBeVisible();
    issues.assertClean();
  });
});
