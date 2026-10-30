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

  test("shows the active zoom preset in gold and a hover as a light surface", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const galaxy = page.locator('[data-zoom-preset="galaxy"]');
    const nearby = page.locator('[data-zoom-preset="nearby"]');
    await galaxy.click();
    await expect(galaxy).toHaveAttribute("aria-pressed", "true");
    await expect(nearby).toHaveAttribute("aria-pressed", "false");

    await page.mouse.move(0, 0);
    await expect(galaxy).toHaveCSS("color", "rgb(239, 196, 104)");
    await expect(galaxy).toHaveCSS("border-top-color", "rgb(239, 196, 104)");
    await expect(galaxy).toHaveCSS("box-shadow", "rgb(239, 196, 104) 0px -2px 0px 0px inset");

    await nearby.hover();
    await expect(nearby).toHaveCSS("background-color", "rgba(242, 237, 223, 0.1)");
    await expect(nearby).toHaveCSS("color", "rgb(243, 238, 223)");
    await expect(nearby).toHaveCSS("box-shadow", "none");

    await galaxy.hover();
    await expect(galaxy).toHaveCSS("color", "rgb(239, 196, 104)");
    issues.assertClean();
  });

  test("keeps gold for the active state of the header and the 3D controls", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const language = page.locator(".locale-control select");
    await language.hover();
    await expect(language).toHaveCSS("border-top-color", "rgba(242, 237, 223, 0.22)");
    await expect(language).toHaveCSS("background-color", "rgba(12, 16, 13, 0.82)");
    await expect(language).not.toHaveCSS("background-image", "none");

    const play = page.locator(".atlas-bar .time-bar__play");
    await play.click();
    await play.hover();
    await expect(play).toHaveCSS("border-top-color", "rgb(239, 196, 104)");
    await play.click();
    const now = page.locator(".atlas-bar .time-bar__now");
    await now.hover();
    await expect(now).toHaveCSS("background-color", "rgb(239, 196, 104)");

    await page.locator("#universe-3d-toggle").click();
    const find = page.locator("#universe-find");
    await expect(find).toBeVisible();
    await find.hover();
    await expect(find).toHaveCSS("color", "rgb(238, 242, 234)");
    await expect(find).toHaveCSS("border-top-color", "rgba(130, 203, 179, 0.28)");
    await expect(find).not.toHaveCSS("background-image", "none");

    await page.mouse.move(0, 0);
    for (const control of [find, page.locator("#universe-gravity"), page.locator("#universe-minimap-toggle")]) {
      await page.keyboard.press("Shift");
      await control.focus();
      await expect(control).toHaveCSS("outline", "rgb(130, 203, 179) solid 2px");
      await expect(control).toHaveCSS("color", /238, 242, 234/);
    }
    issues.assertClean();
  });

  test("shows the guided sets in panel text on the dark panel", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.locator("#header-search").click();
    const set = page.locator("#guided-tours button").first();
    await expect(set).toBeVisible();
    await expect(set).toHaveCSS("color", "rgb(243, 238, 223)");
    await expect(set.locator("span")).toHaveCSS("color", "rgba(243, 238, 223, 0.68)");
    issues.assertClean();
  });

  test("marks the active scale section without moving the scale panel", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    const scalePanel = page.locator(".scale-rail");
    const before = await scalePanel.boundingBox();
    await page.locator("#map-settings-toggle").click();
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
    await page.locator("#map-settings-toggle").click();
    const infoButton = page.getByRole("button", { name: "Explain object size modes" });
    await infoButton.click();
    await expect(page.locator("#control-info-tooltip")).toBeVisible();
    await expect(page.locator("#control-info-tooltip")).toContainText("Readable enlarges tiny objects");
    await page.keyboard.press("Escape");
    await expect(page.locator("#control-info-tooltip")).toBeHidden();
    issues.assertClean();
  });

  test("filters map objects by type from the scale panel", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.locator("#map-settings-toggle").click();
    const section = page.locator('[data-scale-disclosure]:has([aria-controls="scale-object-types"])');
    await section.locator(".scale-collapse__toggle").click();
    await expect(page.locator("#scale-object-types")).toBeVisible();

    const filterKeys = await page.locator("#map-filter-buttons [data-body-filter]").evaluateAll((buttons) =>
      buttons.map((button) => (button as HTMLElement).dataset.bodyFilter)
    );
    expect(filterKeys).toEqual([
      "all",
      "star",
      "planet",
      "moon",
      "dwarf_planet",
      "asteroid",
      "comet",
      "galaxy",
      "quasar",
      "active_galaxy",
      "black_hole",
      "pulsar",
      "nebula",
      "star_cluster",
      "xray"
    ]);
    await expect(page.locator('#map-filter-buttons [data-body-filter="gaia_star"]')).toHaveCount(0);
    await expect(page.locator('#map-filter-buttons [data-body-filter="bright_star"]')).toHaveCount(0);
    await expect(page.locator('#map-filter-buttons [data-body-filter="deep_sky"]')).toHaveCount(0);

    const catalogSummary = await page.request.get("/api/catalog").then((response) => response.json()) as {
      type_counts?: Record<string, number>;
    };
    const starCount = catalogSummary.type_counts?.star ?? 0;
    const planetCount = catalogSummary.type_counts?.planet ?? 0;
    expect(catalogSummary.type_counts?.black_hole).toBe(806);
    expect(catalogSummary.type_counts?.dwarf_planet).toBe(4);
    const appLocale = await page.locator("html").getAttribute("lang") ?? "en";
    const exactStarCount = new Intl.NumberFormat(appLocale, { maximumFractionDigits: 0 }).format(starCount);
    const starFilter = page.locator('#map-filter-buttons [data-body-filter="star"]');
    await expect(starFilter.locator(".map-filter-count")).toHaveText(exactStarCount);
    await expect(starFilter).toHaveAccessibleName(`Stars, available objects: ${exactStarCount}`);
    await expect(starFilter).toHaveAttribute("data-available-count", String(starCount));
    await expect(starFilter.locator(".map-filter-count")).toHaveAttribute("aria-hidden", "true");
    const countStyle = await starFilter.locator(".map-filter-count").evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: Number.parseFloat(style.fontSize), display: style.display };
    });
    expect(countStyle.fontSize).toBeGreaterThanOrEqual(11.5);
    expect(["flex", "inline-flex"]).toContain(countStyle.display);

    const availablePlanetCount = Number(await page.locator('#map-filter-buttons [data-body-filter="planet"]').getAttribute("data-available-count"));
    expect(availablePlanetCount, "planet count adds loaded Solar System planets to indexed exoplanets").toBeGreaterThan(planetCount);
    await expect(page.locator('#map-filter-buttons [data-body-filter="moon"] .map-filter-count')).not.toHaveText("0");
    const availableDwarfCount = Number(await page.locator('#map-filter-buttons [data-body-filter="dwarf_planet"]').getAttribute("data-available-count"));
    expect(availableDwarfCount, "dwarf count adds dynamic Pluto to four static recognized dwarfs").toBe(5);
    await expect(page.locator('#map-filter-buttons [data-body-filter="dwarf_planet"]')).toHaveAccessibleName(
      `Dwarf planets, available objects: ${new Intl.NumberFormat(appLocale, { maximumFractionDigits: 0 }).format(availableDwarfCount)}`
    );
    await expect(page.locator('#map-filter-buttons [data-body-filter="black_hole"]')).toHaveAttribute("data-available-count", "806");

    await page.locator('#map-filter-buttons [data-body-filter="galaxy"]').click();
    await expect(page.locator('#map-filter-buttons [data-body-filter="galaxy"]')).toHaveClass(/active/);
    await expect(page.locator('#body-filter-buttons [data-body-filter="galaxy"]')).toHaveClass(/active/);
    await expect(page.locator('[data-zoom-preset="cosmicWeb"]')).toHaveClass(/active/);
    await expect.poll(() => new URL(page.url()).searchParams.get("F")).toMatch(/^galaxy\./);
    issues.assertClean();
  });

  for (const width of [900, 1024, 1100, 1440]) {
    test(`keeps footer links outside the scale panel at ${width}px`, async ({ page }) => {
      const issues = collectBrowserIssues(page);
      await page.setViewportSize({ width, height: 680 });
      const authorLink = page.getByRole("link", { name: "By Ferdev" });
      await expect(authorLink).toBeVisible();
      await expect(authorLink).toHaveAttribute("href", "https://ferdev.com/");
      await expect(authorLink).toHaveAttribute("target", "_blank");
      await page.locator("#map-settings-toggle").click();
      const section = page.locator('[data-scale-disclosure]:has([aria-controls="scale-object-types"])');
      await section.locator(".scale-collapse__toggle").click();

      const collisions = await page.evaluate(() => {
        const footer = document.querySelector<HTMLElement>(".atlas-footer")?.getBoundingClientRect();
        const protectedSurfaces = [".scale-rail", "#share-menu-button"]
          .map((selector) => ({ selector, rect: document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() }))
          .filter((entry): entry is { selector: string; rect: DOMRect } => Boolean(entry.rect));
        if (!footer) return ["missing footer"];
        return protectedSurfaces
          .filter(({ rect }) => footer.left < rect.right && footer.right > rect.left && footer.top < rect.bottom && footer.bottom > rect.top)
          .map(({ selector }) => selector);
      });

      expect(collisions, "footer must not intersect scale or share controls").toEqual([]);
      issues.assertClean();
    });
  }
});
