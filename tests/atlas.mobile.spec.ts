import { expect, test } from "@playwright/test";
import { collectBrowserIssues, expandObjectSheet, openAtlas, selectCatalogObject, skipIfAtlasUnavailable, skyEphemerisFixture } from "./atlas-test-utils";

test.describe("Cosmic Atlas mobile layout", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("centers the map in the space between top controls and the bottom scale sheet", async ({ page }) => {
    // `perf=1` gives the diagnostics with the free map area.
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);

    // The map centre is the middle of the free area between the header card and the toolbar.
    const centre = await page.evaluate(() => {
      const headerBottom = document.querySelector<HTMLElement>(".atlas-bar")!.getBoundingClientRect().bottom;
      const scaleTop = document.querySelector<HTMLElement>(".scale-rail")!.getBoundingClientRect().top;
      const { usable } = window.__ATLAS_DIAGNOSTICS__!.selectionGeometry();
      return { free: (headerBottom + 8 + scaleTop - 10) / 2, map: usable.top + usable.height / 2, usableTop: usable.top, usableBottom: usable.top + usable.height, headerBottom, scaleTop };
    });
    expect(Math.abs(centre.map - centre.free), "map centre is the middle of the free area").toBeLessThanOrEqual(2);
    expect(centre.usableTop).toBeGreaterThanOrEqual(centre.headerBottom);
    expect(centre.usableBottom).toBeLessThanOrEqual(centre.scaleTop);

    // The atlas is ready before its first frame is drawn on a slow browser: wait for map content.
    await expect.poll(() => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map");
      const data = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      let drawn = 0;
      if (data) for (let offset = 3; offset < data.length; offset += 4) if (data[offset]! > 20) drawn += 1;
      return drawn;
    }), { message: "the map must have its first frame", timeout: 30_000 }).toBeGreaterThan(2_000);

    const balance = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map");
      const context = canvas?.getContext("2d");
      const headerBottom = document.querySelector<HTMLElement>(".atlas-bar")?.getBoundingClientRect().bottom ?? 0;
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
    // The labels of the inner planets are near the Sun, which is above the centre in the first view.
    // The lower half has map content also: it does not collapse.
    expect(balance.ratio, "lower-half map content should not collapse after header controls").toBeGreaterThan(0.2);

    issues.assertClean();
  });

  test("keeps the physical frame and zoom controls legible in the compact scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.locator("#map-settings-toggle").click();
    await expect(page.locator(".map-frame-status")).toHaveText("Heliocentric ecliptic plane");
    await expect(page.locator('[data-projection-mode="sky-sphere"]')).toHaveCount(0);
    const slider = page.locator("#zoom-scale-slider");
    const box = await slider.boundingBox();
    expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    issues.assertClean();
  });

  test("keeps footer links clear of the bottom scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const settingsToggle = page.locator("#map-settings-toggle");
    const collapsed = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".atlas-footer")?.getBoundingClientRect();
      const scale = document.querySelector<HTMLElement>(".scale-rail")?.getBoundingClientRect();
      return footer && scale ? footer.bottom <= scale.top - 8 : false;
    });
    expect(collapsed, "footer must sit above the compact scale sheet").toBe(true);

    await settingsToggle.click();
    await expect(page.locator("#map-settings")).toBeVisible();
    await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#map-settings")).toBeHidden();
    await expect(settingsToggle).toBeFocused();
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

      // On a phone the Share button is a part of the header card, in the row of the search button and the time bar.
      const shareTrigger = rect("#share-menu-button");
      const protectedSurfaces = [".header-search", "#time-bar", "#locale-select", ".scale-rail", ".atlas-footer"]
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
    await expect(page.locator(".atlas-bar #share-menu-button")).toHaveCount(1);
    expect(geometry.shareTrigger!.width, "44 px touch target").toBeGreaterThanOrEqual(44);
    expect(geometry.shareTrigger!.height, "44 px touch target").toBeGreaterThanOrEqual(44);

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

  test("keeps Sky sharing keyboard-reachable and contained on a narrow viewport", async ({ page, context }) => {
    const issues = collectBrowserIssues(page);
    await context.route("**/api/ephemeris?**", (route) => {
      const timestamp = new URL(route.request().url()).searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(skyEphemerisFixture(timestamp))
      });
    });
    await context.route("**/api/catalog/sky?**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ returned: 0, points: [] })
    }));
    await openAtlas(page, "/sky/earth?v=1&t=2026-08-26T12%3A00%3A00.000Z&sc=0%2C0%2C72&lang=en");
    await expect(page.locator("#sky-view")).toBeVisible();
    // On a narrow window Share is in the More menu. The keyboard opens the menu and then the dialog.
    await expect(page.locator("#sky-share-button")).toBeHidden();
    await page.locator("#sky-more-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sky-more-button")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#sky-share-button")).toBeVisible();
    await page.locator("#sky-share-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sky-share-popover")).toBeVisible();
    await expect(page.locator("#sky-share-close")).toBeFocused();
    await expect(page.locator("#sky-copy-link")).toBeVisible();
    await expect(page.locator("#sky-download-card")).toBeVisible();

    const geometry = await page.locator("#sky-share-popover").evaluate((popover) => {
      const bounds = popover.getBoundingClientRect();
      const actions = [...popover.querySelectorAll<HTMLButtonElement>(".sky-share__actions button")]
        .filter((button) => !button.hidden)
        .map((button) => button.getBoundingClientRect().height);
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, actions };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(390);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(844);
    expect(geometry.actions.every((height) => height >= 44)).toBe(true);
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
    await expect(page.locator("#selection-connector")).toBeHidden();

    // The sheet opens short: the name and the actions of the object. The map has most of the window.
    const toggle = page.locator("#object-sheet-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#center-selected")).toBeVisible();
    await expect(page.locator("#body-info")).toBeHidden();
    const short = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(short.workspaceTop, "mobile object sheet top").not.toBeNull();
    expect(844 - short.workspaceTop!, "the short sheet covers less than a quarter of the window").toBeLessThan(211);
    expect(short.usable.height, "free map area with the short sheet").toBeGreaterThan(500);
    expect(short.selected!.y, "selected object must stay above the short sheet").toBeLessThan(short.workspaceTop! - 12);

    // The Details button shows all data. The selected object stays in view above the tall sheet.
    await expandObjectSheet(page);
    await expect(page.locator("#body-info")).toBeVisible();
    const geometry = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(geometry.workspaceTop!, "object sheet should leave a meaningful map region visible").toBeGreaterThan(320);
    expect(geometry.selected, "selected object screen position").not.toBeNull();
    // The camera can move to the object when the tall sheet covers it: wait for the end of the move.
    await expect.poll(async () => {
      const { selected, usable, workspaceTop } = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
      return selected!.x >= usable.left + 12 && selected!.x <= usable.right - 12
        && selected!.y >= usable.top + 12 && selected!.y <= usable.bottom - 12 && selected!.y < workspaceTop! - 12;
    }, { message: "selected object must stay in the free map area above the detail sheet" }).toBe(true);

    const selected = (await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry())).selected!;
    const hitTarget = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { id: element?.id ?? "", insideWorkspace: Boolean(element?.closest("#workspace-panel")) };
    }, selected);
    expect(hitTarget).toEqual({ id: "map", insideWorkspace: false });

    await expect(page.locator("#body-popover")).toHaveCount(0);

    // The button closes the tall sheet again.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#body-info")).toBeHidden();

    // A phone in landscape has no room for a bottom sheet: the inspector is a panel at the side of the map.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(toggle).toBeHidden();
    await expect(page.locator("#body-info")).toBeVisible();
    const landscape = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("#workspace-panel")!.getBoundingClientRect();
      const toolbar = document.querySelector<HTMLElement>(".scale-rail")!.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".atlas-bar")!.getBoundingClientRect();
      return { ...window.__ATLAS_DIAGNOSTICS__!.selectionGeometry(), panelLeft: panel.left, panelBottom: panel.bottom, toolbarRight: toolbar.right, headerRight: header.right };
    });
    expect(landscape.panelLeft, "the side panel leaves more than half of the window to the map").toBeGreaterThan(422);
    expect(landscape.panelBottom).toBeLessThanOrEqual(390);
    expect(landscape.usable.right, "usable map must stop at the left of the side panel").toBeLessThanOrEqual(landscape.panelLeft - 10);
    expect(landscape.usable.height, "free map height in landscape").toBeGreaterThan(200);
    expect(landscape.headerRight, "header card is at the left of the side panel").toBeLessThanOrEqual(landscape.panelLeft);
    expect(landscape.toolbarRight, "toolbar is at the left of the side panel").toBeLessThanOrEqual(landscape.panelLeft);
    issues.assertClean();
  });

  test("scrolls the object sheet by touch and keeps each detail tab in reach", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    const issues = collectBrowserIssues(page);
    await selectCatalogObject(page, "Mars", "mars");
    await expandObjectSheet(page);
    const bodyInfo = page.locator("#body-info");
    const metrics = () => bodyInfo.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    const initial = await metrics();
    expect(initial.scrollHeight, "the Mars overview must be longer than the sheet").toBeGreaterThan(initial.clientHeight + 40);
    expect(initial.scrollTop).toBe(0);

    const client = await page.context().newCDPSession(page);
    const x = (initial.left + initial.right) / 2;
    const startY = initial.bottom - 30;
    const touch = (y: number) => [{ id: 1, x, y, radiusX: 4, radiusY: 4, force: 1 }];
    const swipe = async () => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(startY) });
      for (let step = 1; step <= 8; step += 1) {
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(startY - step * 30) });
      }
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe();
    await expect.poll(async () => (await metrics()).scrollTop, { message: "one swipe must scroll the sheet content" }).toBeGreaterThan(0);

    // After one swipe the sticky tab row is inside the sheet, and each tab opens its view.
    const afterSwipe = await metrics();
    const tabRow = await page.locator("#body-info .object-view-tabs").boundingBox();
    expect(tabRow, "detail tab row").not.toBeNull();
    expect(tabRow!.y).toBeGreaterThanOrEqual(afterSwipe.top - 1);
    expect(tabRow!.y + tabRow!.height).toBeLessThanOrEqual(afterSwipe.bottom + 1);
    const views = await page.locator("#body-info [data-object-view]").evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset.objectView ?? ""));
    const scrolledViews: string[] = [];
    expect(views.length).toBeGreaterThanOrEqual(4);
    for (const view of views) {
      const tab = page.locator(`#body-info [data-object-view="${view}"]`);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#object-view-panel-${view}`)).toBeVisible();
      const box = await tab.boundingBox();
      expect(box!.height, `${view} tab touch target`).toBeGreaterThanOrEqual(44);
      // A view that is longer than the sheet scrolls with a touch drag also (Position and Sources of Mars).
      await bodyInfo.evaluate((element) => { element.scrollTop = 0; });
      const viewMetrics = await metrics();
      if (viewMetrics.scrollHeight > viewMetrics.clientHeight + 40) {
        await swipe();
        await expect.poll(async () => (await metrics()).scrollTop, { message: `one swipe must scroll the ${view} view` }).toBeGreaterThan(0);
        scrolledViews.push(view);
      }
    }
    expect(scrolledViews, "the long views scroll by touch").toEqual(expect.arrayContaining(["position", "sources"]));

    const geometry = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
    expect(geometry.workspaceTop!, "object sheet should leave a meaningful map region visible").toBeGreaterThan(320);
    issues.assertClean();
  });

  test("shows the comparison header in full on a narrow screen", async ({ page }) => {
    await openAtlas(page);
    await selectCatalogObject(page, "Jupiter", "jupiter");
    await expandObjectSheet(page);
    await page.locator("#compare-selected").click();
    await expect(page.locator("#compare-heading")).toBeVisible();
    await page.locator("#compare-search").fill("Mars");
    await page.locator('#compare-picker [data-body-key="mars"]').first().click();
    await expect(page.locator("#compare-actions")).toBeVisible();
    await page.locator("#compare-heading").scrollIntoViewIfNeeded();
    // The title is in view, and no text of the title or of an action is cut.
    for (const selector of ["#compare-heading", "#share-compare", "#clear-compare"]) {
      const element = page.locator(selector);
      await expect(element, selector).toBeInViewport();
      expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `${selector} text is not cut`).toBe(true);
      const box = (await element.boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(390);
    }
    // A phone shows the short text of the copy action.
    await expect(page.locator("#share-compare .label-narrow")).toBeVisible();
    await expect(page.locator("#share-compare .label-wide")).toBeHidden();
    for (const selector of ["#share-compare", "#clear-compare"]) {
      expect((await page.locator(selector).boundingBox())!.height, `${selector} touch target`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the header card is one row, and the language menu is in Settings", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const header = (await page.locator(".atlas-bar").boundingBox())!;
    expect(header.height, "header card of one row").toBeLessThanOrEqual(60);
    // The title stays for a screen reader.
    await expect(page.getByRole("heading", { level: 1, name: "Cosmic Atlas" })).toHaveCount(1);
    for (const selector of [".header-search", "#time-date", "#share-menu-button"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y, `${selector} is in the header row`).toBeGreaterThanOrEqual(header.y);
      expect(box.y + box.height, `${selector} is in the header row`).toBeLessThanOrEqual(header.y + header.height);
      expect(box.height, `${selector} touch target`).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator(".atlas-bar #locale-select")).toHaveCount(0);
    await page.locator("#map-settings-toggle").click();
    const language = page.locator("#map-settings #locale-select");
    await language.scrollIntoViewIfNeeded();
    await expect(language).toBeVisible();
    expect((await language.boundingBox())!.height, "language menu touch target").toBeGreaterThanOrEqual(44);
    await language.selectOption("es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator("#map-settings-title")).toHaveText("Ajustes");
    await language.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    issues.assertClean();
  });

  for (const viewport of [{ width: 844, height: 390 }, { width: 932, height: 430 }, { width: 768, height: 1024 }]) {
    test(`the controls leave most of a ${viewport.width} x ${viewport.height} window to the map`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openAtlas(page, "/?perf=1");
      const issues = collectBrowserIssues(page);
      const layout = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>(".atlas-bar")!.getBoundingClientRect();
        const toolbar = document.querySelector<HTMLElement>(".scale-rail")!.getBoundingClientRect();
        const { usable } = window.__ATLAS_DIAGNOSTICS__!.selectionGeometry();
        const centre = { x: (usable.left + usable.right) / 2, y: (usable.top + usable.bottom) / 2 };
        return {
          headerHeight: header.height, toolbarHeight: toolbar.height, toolbarBottom: toolbar.bottom, toolbarRight: toolbar.right,
          usableHeight: usable.height, centreTarget: document.elementFromPoint(centre.x, centre.y)?.id ?? "",
        };
      });
      expect(layout.headerHeight, "header card of one row").toBeLessThanOrEqual(60);
      expect(layout.toolbarBottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.toolbarRight).toBeLessThanOrEqual(viewport.width);
      // A short window has a toolbar of one row. A tablet in portrait has two rows.
      expect(layout.toolbarHeight, "toolbar height").toBeLessThanOrEqual(viewport.height <= 560 ? 62 : 124);
      expect(layout.usableHeight / viewport.height, "part of the window height that is free map").toBeGreaterThan(viewport.height <= 560 ? 0.6 : 0.75);
      expect(layout.centreTarget, "the centre of the free area is the map").toBe("map");
      issues.assertClean();
    });
  }

  test("the 3D view keeps its centre free of controls on a phone", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.locator("#universe-3d-toggle").click();
    await expect(page.locator("#universe-view")).toBeVisible();
    await expect(page.locator("#universe-close")).toBeVisible();
    // The trip map starts hidden on a phone. Its button shows it.
    await expect(page.locator("#universe-minimap")).toBeHidden();
    await expect(page.locator("#universe-minimap-toggle")).toHaveAttribute("aria-expanded", "false");
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      const controls = [...document.querySelectorAll<HTMLElement>(".universe-view__flight > *")].filter((control) => control.getClientRects().length > 0)
        .map((control) => control.getBoundingClientRect());
      return {
        header: box(".universe-view__header"),
        flightTop: Math.min(...controls.map((rect) => rect.top)),
        flightInside: controls.every((rect) => rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight),
        minimap: box("#universe-minimap-panel"),
        centreTarget: document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.id ?? "",
      };
    });
    expect(layout.header.bottom, "3D header with no title block").toBeLessThanOrEqual(150);
    expect(layout.flightTop, "flight controls are in the lower third of the window").toBeGreaterThanOrEqual(844 * 0.66);
    expect(layout.flightInside, "flight controls are in the window").toBe(true);
    expect(layout.minimap.top, "trip map is below the view centre").toBeGreaterThan(422 + 60);
    expect(layout.centreTarget, "the view centre is the 3D canvas").toBe("universe-map");
    await page.locator("#universe-close").click();
    await expect(page.locator("#universe-view")).toBeHidden();
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
