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

  test("filters map objects by type from the scale panel", async ({ page }) => {
    const issues = collectBrowserIssues(page);
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

  test("keeps footer links outside the scale panel at tablet and desktop widths", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.setViewportSize({ width: 1024, height: 680 });
    const authorLink = page.getByRole("link", { name: "By Ferdev" });
    await expect(authorLink).toBeVisible();
    await expect(authorLink).toHaveAttribute("href", "https://ferdev.com/");
    await expect(authorLink).toHaveAttribute("target", "_blank");
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
});
