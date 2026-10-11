import { expect, test, type Page } from "@playwright/test";
import { collectBrowserIssues, expandObjectSheet, openAtlas, openSearchWorkspace, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

type Box = { x: number; y: number; width: number; height: number };

/** The part of an element that is in the window, or null when the element does not show. */
async function visibleBox(page: Page, selector: string): Promise<Box | null> {
  const locator = page.locator(selector).first();
  if (!(await locator.count()) || !(await locator.isVisible())) return null;
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  if (!box) return null;
  const left = Math.max(0, box.x), top = Math.max(0, box.y);
  const right = Math.min(viewport.width, box.x + box.width), bottom = Math.min(viewport.height, box.y + box.height);
  return right - left > 1 && bottom - top > 1 ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** The fixed controls that must not be on top of an open panel or on top of each other. */
async function expectNoOverlap(page: Page, state: string) {
  const parts: Record<string, Box | null> = {
    panel: await visibleBox(page, "#workspace-panel"),
    toolbar: await visibleBox(page, ".atlas-toolbar"),
    share: await visibleBox(page, "#share-menu-button"),
    footer: await visibleBox(page, ".atlas-footer"),
    header: await visibleBox(page, ".atlas-bar"),
  };
  const names = Object.keys(parts);
  for (let first = 0; first < names.length; first += 1) {
    for (let second = first + 1; second < names.length; second += 1) {
      const a = parts[names[first]!], b = parts[names[second]!];
      // The Share button is a part of the toolbar on a wide window and a part of the header on a narrow window.
      if (!a || !b || (names[second] === "share" && (names[first] === "toolbar" || names[first] === "header")) || (names[first] === "toolbar" && names[second] === "share")) continue;
      if (names[first] === "share" || names[second] === "share") {
        const other = names[first] === "share" ? names[second]! : names[first]!;
        if (other === "toolbar" || other === "header") continue;
      }
      expect(intersects(a, b), `${state}: ${names[first]} and ${names[second]} overlap`).toBe(false);
    }
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test.describe(`layout at ${viewport.width}px`, () => {
    test.use({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });

    test(`no fixed control is on top of an open panel at ${viewport.width}px`, async ({ page, request }) => {
      await skipIfAtlasUnavailable(request);
      const issues = collectBrowserIssues(page);
      await openAtlas(page);
      await expectNoOverlap(page, "home");
      // The header shows the title, the search field, the language, and the time bar. It shows no counts.
      await expect(page.locator(".atlas-bar #atlas-stats")).toHaveCount(0);
      await expect(page.locator(".atlas-bar #header-search")).toHaveCount(1);
      await expect(page.locator(".atlas-bar #time-bar")).toBeVisible();

      await openSearchWorkspace(page);
      await expectNoOverlap(page, "search");

      await selectCatalogObject(page, "Mars", "mars", "Mars");
      await expectNoOverlap(page, "inspector");
      // A compact window opens the inspector as a short sheet. The Details button shows all data.
      await expandObjectSheet(page);
      await expectNoOverlap(page, "inspector with all data");

      await page.locator("#compare-selected").click();
      await expect(page.locator("#selection-compare")).toBeVisible();
      await expectNoOverlap(page, "compare");
      // All controls stay in the window.
      for (const selector of ["#share-menu-button", "#map-settings-toggle", "#zoom-in", "#time-date"]) {
        const box = await page.locator(selector).boundingBox();
        if (!box || !(await page.locator(selector).isVisible())) continue;
        expect(box.x, selector).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width + 1);
      }
      issues.assertClean();
    });
  });
}

test.describe("header search and Search panel", () => {
  test.beforeEach(async ({ request }) => { await skipIfAtlasUnavailable(request); });

  test("the / key and Ctrl+K open the search, and a typed text goes into the field", async ({ page }) => {
    await openAtlas(page);
    await page.locator("#map").focus();
    await page.keyboard.press("/");
    await expect(page.locator("#tab-catalog")).toBeVisible();
    await expect(page.locator("#body-search")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.locator("#close-panel").click();
    await expect(page.locator("#tab-catalog")).toBeHidden();
    await page.keyboard.press("Control+k");
    await expect(page.locator("#body-search")).toBeFocused();
    await page.locator("#close-panel").click();
    await expect(page.locator("#tab-catalog")).toBeHidden();
    // Cmd+K is the same shortcut on macOS.
    await page.keyboard.press("Meta+k");
    await expect(page.locator("#body-search")).toBeFocused();
    await page.locator("#close-panel").click();
    // A text that the user types into the header field goes into the Search panel field.
    await page.locator("#header-search").click();
    await page.keyboard.type("Mars");
    await expect(page.locator("#body-search")).toHaveValue("Mars");
    await expect(page.locator('#body-picker [data-body-key="mars"]').first()).toBeVisible();
  });

  test("the panel has one scroll area, and the results are directly below the field", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
    await openSearchWorkspace(page);
    // With an empty field the panel shows Happening now, Explore, and Guided tours.
    await expect(page.locator("#search-discovery")).toBeVisible();
    await expect(page.locator("#search-results")).toBeHidden();
    await expect(page.locator("#explore-domains")).toBeVisible();
    await expect(page.locator("#guided-tour-list [data-tour-slug]")).toHaveCount(2);
    await expect(page.locator("#now-events > li")).not.toHaveCount(4);

    await page.locator("#body-search").fill("Mars");
    await expect(page.locator('#body-picker [data-body-key="mars"]').first()).toBeVisible();
    await expect(page.locator("#search-discovery")).toBeHidden();
    const results = (await page.locator("#search-scroll").boundingBox())!;
    expect(results.height, "the result list has 400 px or more").toBeGreaterThanOrEqual(400);
    const field = (await page.locator("#body-search").boundingBox())!;
    const firstRow = (await page.locator('#body-picker [data-body-key="mars"]').first().boundingBox())!;
    expect(firstRow.y - (field.y + field.height), "the first result is near the field").toBeLessThan(160);

    // Only one element of the panel scrolls in the vertical direction. (The chip row scrolls sideways only.)
    const scrollers = await page.locator("#tab-catalog, #tab-catalog *").evaluateAll((elements) => elements
      .filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.id || element.className));
    expect(scrollers).toEqual(["search-scroll"]);
    // No row shows an unknown value.
    await expect(page.locator("#body-picker")).not.toContainText(/unknown/i);

    // A query with no result shows the query, and three example queries.
    await page.locator("#body-search").fill("zzzzqqqq");
    await expect(page.locator("#body-picker .empty-state")).toContainText("zzzzqqqq");
    await expect(page.locator("#body-picker [data-search-example]")).toHaveText(["Mars", "M31", "Sirius"]);
    await page.locator('#body-picker [data-search-example="Sirius"]').click();
    await expect(page.locator("#body-search")).toHaveValue("Sirius");
  });

  test("the More types menu sets a filter that shows as an active chip, and Clear filters removes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
    await openSearchWorkspace(page);
    const chips = page.locator("#body-filter-buttons");
    // Eight main types are chips. The other types are in the menu.
    await expect(chips.locator("[data-body-filter]")).toHaveCount(9);
    await expect(chips.locator('[data-body-filter="dwarf_planet"]')).toHaveCount(0);
    await chips.locator("[data-body-filter-menu]").selectOption("dwarf_planet");
    // The filter from the menu is now a chip, and it is the only active chip.
    await expect(chips.locator('[data-body-filter="dwarf_planet"]')).toHaveAttribute("aria-pressed", "true");
    await expect(chips.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator("#search-results")).toBeVisible();
    await expect(page.locator('#body-picker [data-body-key="pluto"]').first()).toBeVisible();

    // A query with no result in this filter offers to remove the filter. The query text stays.
    await page.locator("#body-search").fill("Sirius");
    await expect(page.locator("#body-picker .empty-state")).toContainText("Sirius");
    await page.locator("#body-picker [data-search-clear-filters]").click();
    await expect(chips.locator('[data-body-filter="all"]')).toHaveAttribute("aria-pressed", "true");
    await expect(chips.locator('[data-body-filter="dwarf_planet"]')).toHaveCount(0);
    await expect(page.locator("#body-search")).toHaveValue("Sirius");
    await expect(page.locator("#body-picker [data-body-key]").filter({ hasText: "Sirius" }).first()).toBeVisible();
    await expect(page.locator("#body-picker [data-search-clear-filters]")).toHaveCount(0);
  });

  test("below 900 px the fixed footer is hidden and its links are at the end of Settings", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openAtlas(page);
    await expect(page.locator(".atlas-footer")).toBeHidden();
    await page.locator("#map-settings-toggle").click();
    const settings = page.locator("#map-settings");
    await expect(settings).toBeVisible();
    for (const href of ["/methodology", "/about", "/agents", "https://ferdev.com/", "https://github.com/Ferdev/skychart"]) {
      const link = settings.locator(`.settings-footer-links a[href="${href}"]`);
      await link.scrollIntoViewIfNeeded();
      await expect(link, href).toBeVisible();
    }
  });

  test("a guided tour starts from the Search panel", async ({ page }) => {
    await openAtlas(page);
    await openSearchWorkspace(page);
    await page.locator('#guided-tour-list [data-tour-slug="near-the-sun"]').click();
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    await expect(page).toHaveURL(/tour=near-the-sun/);
  });

  test("the Spanish interface has Spanish text, and Marte finds Mars first", async ({ page }) => {
    await openAtlas(page);
    await page.locator("#locale-select").selectOption("es");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator("#time-now")).toHaveText("Ahora");
    await expect(page.locator(".atlas-footer")).not.toContainText("Guide for AI agents");
    await openSearchWorkspace(page);
    await page.locator("#body-search").fill("Marte");
    const first = page.locator("#body-picker [data-body-key]").first();
    await expect(first).toHaveAttribute("data-body-key", "mars");
    // The row shows the local name as second text.
    await expect(first.locator(".destination-picker__local-name")).toHaveText("Marte");
    await first.click();
    await expect(page.locator("#selected-summary-name")).toContainText("Mars");
    // The inspector tabs and the curated text are in Spanish.
    for (const tab of await page.locator("#body-info [role=tab]").allTextContents()) expect(tab).not.toMatch(/^(Overview|Position|Observe|Sources|Science)$/);
    await expect(page.locator("#body-info .object-summary-card")).toContainText("Marte");
  });
});

test.describe("Search panel on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the first result is in view after a query", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
    await page.locator("#header-search").tap();
    await expect(page.locator("#body-search")).toBeVisible();
    await page.locator("#body-search").fill("Mars");
    const first = page.locator('#body-picker [data-body-key="mars"]').first();
    await expect(first).toBeVisible();
    const box = (await first.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    const topmost = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-body-key]")?.getAttribute("data-body-key") ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(topmost, "no panel covers the first result").toBe("mars");
  });
});

test.describe("2D map labels and pointers", () => {
  test("labels and edge pointers do not overlap, stay out of the controls, and the pointers have a limit", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page, "/?perf=1");
    const read = () => page.evaluate(() => {
      const diagnostics = window.__ATLAS_DIAGNOSTICS__!;
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      return { labels: diagnostics.drawnLabels(), pointers: diagnostics.drawnEdgePointers(), toolbar: box(".atlas-toolbar"), header: box(".atlas-bar") };
    });
    type Rect = { left: number; top: number; right: number; bottom: number };
    const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    for (const preset of ["solar", "nearby", "galaxy"]) {
      await page.locator(`[data-zoom-preset="${preset}"]`).click();
      await expect(page.locator(`[data-zoom-preset="${preset}"]`)).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(2_500);
      const { labels, pointers, toolbar, header } = await read();
      expect(pointers.length, `${preset}: five pointers at most on a wide window`).toBeLessThanOrEqual(5);
      for (let first = 0; first < labels.length; first += 1) {
        for (let second = first + 1; second < labels.length; second += 1) {
          expect(overlap(labels[first]!.rect, labels[second]!.rect), `${preset}: ${labels[first]!.name} and ${labels[second]!.name} overlap`).toBe(false);
        }
        expect(overlap(labels[first]!.rect, toolbar), `${preset}: ${labels[first]!.name} is on the toolbar`).toBe(false);
        expect(overlap(labels[first]!.rect, header), `${preset}: ${labels[first]!.name} is on the header`).toBe(false);
      }
    }
    // At the Solar preset the Sun and the planets have labels, and a small body of a crowd has none.
    await page.locator('[data-zoom-preset="solar"]').click();
    // The zoom animation and the next frame can take some seconds on a slow browser: wait for the labels.
    const majorNames = ["Sun", "Jupiter", "Saturn", "Uranus", "Neptune"];
    await expect.poll(async () => {
      const drawn = (await read()).labels.map((label) => label.name);
      return majorNames.filter((name) => !drawn.includes(name));
    }, { message: "labels of the Sun and the outer planets at the Solar preset", timeout: 30_000 }).toEqual([]);
    expect((await read()).labels.length).toBeLessThanOrEqual(20);
  });

  const drawnLabelTexts = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.drawnLabels().map((label) => label.text));

  test("the first view has labels for the Sun and the inner planets", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page, "/?perf=1");
    const inner = ["Sun", "Mercury", "Venus", "Earth", "Mars"];
    await expect.poll(async () => { const texts = await drawnLabelTexts(page); return inner.filter((name) => !texts.includes(name)); }, { message: "labels of the Sun and the inner planets", timeout: 30_000 }).toEqual([]);
  });

  test("a phone has labels for the Sun and Earth, and three edge pointers at most", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await openAtlas(page, "/?perf=1");
    await expect.poll(async () => { const texts = await drawnLabelTexts(page); return ["Sun", "Earth"].filter((name) => !texts.includes(name)); }, { message: "labels of the Sun and Earth", timeout: 30_000 }).toEqual([]);
    const pointers = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.drawnEdgePointers());
    expect(pointers.length).toBeLessThanOrEqual(3);
    type Rect = { left: number; top: number; right: number; bottom: number };
    const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (let first = 0; first < pointers.length; first += 1) {
      for (let second = first + 1; second < pointers.length; second += 1) {
        expect(overlap(pointers[first]!.rect, pointers[second]!.rect), `${pointers[first]!.key} and ${pointers[second]!.key} overlap`).toBe(false);
      }
    }
  });

  for (const preset of ["nearby", "galaxy"]) {
    test(`at the ${preset} preset the home label is Solar System, with no planet labels`, async ({ page, request }) => {
      await skipIfAtlasUnavailable(request);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAtlas(page, "/?perf=1");
      await page.locator(`[data-zoom-preset="${preset}"]`).click();
      await expect.poll(() => drawnLabelTexts(page), { message: "the Solar System label", timeout: 30_000 }).toContain("Solar System");
      const texts = await drawnLabelTexts(page);
      for (const planet of ["Sun", "Earth", "Mars", "Jupiter", "Saturn"]) expect(texts, `${planet} has no label at this scale`).not.toContain(planet);
    });
  }

  test("the Universe preset shows its view width in words", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
    await page.locator('[data-zoom-preset="cosmicWeb"]').click();
    await expect(page.locator("#zoom-view-scale")).toContainText(/billion ly/, { timeout: 15_000 });
    await expect(page.locator("#zoom-view-scale")).not.toContainText(/Gly|e\+|kly|Mly/);
  });
});

test.describe("3D mark and map notes", () => {
  test.beforeEach(async ({ request }) => { await skipIfAtlasUnavailable(request); });

  test("the 3D mark shows on demand and after a change of the map centre, and not on a selected object", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
    const marker = page.locator("#universe-entry-marker");
    const button = page.locator("#universe-3d-toggle");
    await expect(button).toHaveAttribute("title", "The 3D view starts at the map centre");
    await expect(marker).toBeHidden({ timeout: 10_000 });
    // The focus on the 3D button shows the mark, as the pointer does.
    await button.focus();
    await expect(marker).toBeVisible();
    await button.evaluate((element) => (element as HTMLElement).blur());
    await expect(marker).toBeHidden();
    // A drag changes the map centre: the mark shows for a short time.
    await page.mouse.move(500, 450);
    await page.mouse.down();
    await page.mouse.move(620, 520, { steps: 6 });
    await page.mouse.up();
    await expect(marker).toBeVisible();
    await expect(marker).toBeHidden({ timeout: 6_000 });
    // With the selected object at the map centre there is no mark on its label.
    await selectCatalogObject(page, "Mars", "mars");
    await page.locator("#center-selected").click();
    await button.hover();
    await page.waitForTimeout(500);
    await expect(marker).toBeHidden();
  });

  test("the constellation layer shows its note while it is on", async ({ page }) => {
    // On a wide window the toolbar covers the canvas line of the note, so the note is a page element also.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
    const note = page.locator("#exoplanet-orbit-note");
    await expect(note).toBeHidden();
    const layer = page.locator('.toolbar-quick-layers input[data-layer="constellations"]');
    await layer.check();
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText("Constellation lines join the stars at their catalog distances");
    await layer.uncheck();
    await expect(note).toBeHidden();
  });
});

