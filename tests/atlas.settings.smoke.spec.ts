import { expect, test, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

const EMPTY_SMP2_TILE = "SMP2\u0000\u0000\u0000\u0000";

/** A manifest with the five point layers that have a plain name and a caveat text. */
async function routeLayerManifest(page: Page) {
  const layer = (id: string, groups: string[], types: string[], count: number) => ({
    id,
    tile_url_template: `/catalog-tiles/v1/layers/${id}/s{span_log2}/x{x}/y{y}.bin`,
    groups,
    types,
    source_counts: Object.fromEntries(groups.map((group) => [group, count])),
    // Levels from the Solar System scale to the cosmic web scale, so that each zoom has a level with few tiles.
    levels: [24, 30, 36, 40, 44, 48].map((span) => ({ span_log2: span, span_au: 2 ** span, max_points_per_tile: 4096, sample_buckets: 2, point_count: Math.ceil(count / 2), raw_point_count: count })),
  });
  await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      version: "settings-fixture-2026-10",
      format: "SMP2",
      layers: [
        layer("gaia_stars", ["gaia_dr3_bulk"], ["star"], 12_000),
        layer("desi_dr1", ["desi_dr1_galaxies"], ["galaxy"], 4_000),
        layer("quaia_g20", ["quaia_g20_quasars"], ["quasar"], 2_000),
        layer("deep_sky", ["simbad_extragalactic"], ["galaxy"], 800),
        layer("xray", ["erosita_dr2"], ["xray"], 600),
      ],
    }),
  }));
  await page.route("**/catalog-tiles/v1/**/*.bin", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: EMPTY_SMP2_TILE }));
}

test.describe("Settings", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await routeLayerManifest(page);
    await openAtlas(page);
    await page.locator("#map-settings-toggle").click();
    await expect(page.locator("#map-settings")).toBeVisible();
  });

  test("the layer section shows plain names, the counts, and no technical words", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await page.locator('[aria-controls="scale-science-layers"]').click();
    const section = page.locator("#scale-science-layers");
    await expect(section).toBeVisible();
    const disclosure = page.locator("#science-layer-disclosure");
    await expect(disclosure.locator("[data-science-layer]")).toHaveCount(5);
    for (const name of ["Gaia stars", "DESI galaxies and quasars", "Quaia quasar candidates", "Deep-sky catalogs", "X-ray sources"]) {
      await expect(disclosure.locator("strong", { hasText: name })).toHaveCount(1);
    }
    await expect(disclosure).toContainText("Shown / available at this zoom level");
    await expect(disclosure).toContainText("Catalog release");
    // 12,000 has a group separator, as the one number rule gives it.
    await expect(disclosure).toContainText("12,000");
    const text = (await disclosure.textContent()) ?? "";
    expect(text).not.toMatch(/[a-z]_[a-z]/);
    expect(text).not.toMatch(/\bLOD\b/);
    expect(text.replace(/Catalog release/g, "")).not.toMatch(/\bRelease\b/i);
    // The counts that were in the header are at the top of this section.
    await expect(section.locator("#atlas-stats")).toBeVisible();
    await expect(section.locator("#atlas-stats")).toContainText("Mapped");

    // The section is not built again for each frame: its nodes stay the same while the map draws.
    await disclosure.locator("[data-science-layer]").first().evaluate((node) => { (node as HTMLElement).dataset.kept = "yes"; });
    await page.waitForTimeout(700);
    await expect(disclosure.locator("[data-science-layer]").first()).toHaveAttribute("data-kept", "yes");
    issues.assertClean();
  });

  test("the diagnostics are in Advanced, and one filter chip is active", async ({ page }) => {
    await page.locator('[aria-controls="scale-context-diagnostics"]').click();
    const advanced = page.locator("#scale-context-diagnostics");
    await expect(advanced).toBeVisible();
    await expect(page.locator('[aria-controls="scale-context-diagnostics"]')).toContainText("Advanced");
    await expect(advanced.locator("#diagnostics-toggle")).toBeVisible();
    await expect(advanced.locator("#context-mode-status")).not.toBeEmpty();

    await page.locator('[aria-controls="scale-object-types"]').click();
    const chips = page.locator("#map-filter-buttons");
    await expect(chips).toBeVisible();
    // The list shows all types: it has no scroll of its own.
    expect(await chips.evaluate((list) => list.scrollHeight - list.clientHeight)).toBeLessThanOrEqual(1);
    await chips.locator('[data-body-filter="galaxy"]').click();
    await expect(chips.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(chips.locator('[data-body-filter="galaxy"]')).toHaveAttribute("aria-pressed", "true");
    // The pointer on a different chip does not make that chip look active.
    const galaxyColor = await chips.locator('[data-body-filter="galaxy"]').evaluate((chip) => getComputedStyle(chip).color);
    await chips.locator('[data-body-filter="star"]').hover();
    expect(await chips.locator('[data-body-filter="star"]').evaluate((chip) => getComputedStyle(chip).color)).not.toBe(galaxyColor);
  });

  test("the help text of a section does not cover the next row", async ({ page }) => {
    const info = page.locator('[data-scale-disclosure]:has([aria-controls="scale-object-types"]) .info-tip');
    await info.click();
    const tooltip = page.locator("#control-info-tooltip");
    await expect(tooltip).toBeVisible();
    const tip = (await tooltip.boundingBox())!;
    const next = (await page.locator('[aria-controls="scale-map-overlays"]').boundingBox())!;
    const settings = (await page.locator("#map-settings").boundingBox())!;
    const overlap = tip.x < next.x + next.width && next.x < tip.x + tip.width && tip.y < next.y + next.height && next.y < tip.y + tip.height;
    expect(overlap, "the help text is not on the next section header").toBe(false);
    // On a wide window the help text is at the side of the Settings popover.
    expect(tip.x).toBeGreaterThanOrEqual(settings.x + settings.width);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
  });
});
