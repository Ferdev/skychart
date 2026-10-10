import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

async function useSpanish(page: Page) {
  await page.locator("#locale-select").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
}

/** English words of the interface. A Spanish view must not show them. */
async function expectNoEnglish(page: Page, selector: string, words: readonly string[]) {
  const text = await page.locator(selector).innerText();
  for (const word of words) expect(text, `"${word}" in ${selector}`).not.toContain(word);
}

test.describe("Spanish interface", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("the 3D controls and the Sky header have Spanish text", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    await useSpanish(page);

    await page.locator("#universe-3d-toggle").click();
    await expect(page.locator("#universe-view")).toBeVisible();
    await page.locator("#universe-find").click();
    await expect(page.locator("#universe-search-results")).toContainText("Sugerencias");
    // The search row shows the Spanish name as second text.
    await expect(page.locator("#universe-search-results [role=option]").filter({ hasText: "Mars" }).first()).toContainText("Marte");
    await page.locator("#universe-search-results [role=option]").filter({ hasText: "Mars" }).first().click();
    await expect(page.locator("#universe-target")).toBeVisible();
    await expectNoEnglish(page, "#universe-view", [
      "Free-flight view", "3D Universe", "Find destination", "Reset flight", "Exit 3D", "Fly there", "Jump there", "Details", "Inspect in 2D",
      "Sky from object", "Cruise forward", "Gravity route", "Speed", "Trip map", "Brightness from here", "Catalog positions",
    ]);
    await page.locator("#universe-close").click();
    await expect(page.locator("#universe-view")).toBeHidden();

    await selectCatalogObject(page, "Tierra", "earth", "Earth");
    await page.locator("#view-sky-selected").click();
    await expect(page.locator("#sky-view")).toBeVisible();
    await expect(page.locator("#sky-view-close-label")).toHaveText("Volver al mapa");
    await expectNoEnglish(page, "#sky-view .sky-view__header", ["Back to map", "Sky from", "Share this sky", "Reset view", "More"]);
    await expectNoEnglish(page, "#sky-layer-controls", ["Stars", "Planets", "Galaxies", "Layers", "Constellations"]);
    // The constellation names on the sky are Spanish names, not the Latin names.
    const latinOnly = ["Ursa Major", "Ursa Minor", "Canis Major", "Canis Minor", "Cygnus", "Aquila", "Scorpius", "Sagittarius", "Capricornus", "Aquarius", "Pisces", "Cetus",
      "Eridanus", "Pegasus", "Draco", "Cassiopeia", "Cepheus", "Taurus", "Gemini", "Hydra", "Lyra", "Crux", "Centaurus", "Lepus", "Monoceros", "Ophiuchus"];
    await expect.poll(async () => (await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.skyLabels())).filter((label) => label.key.startsWith("constellation:")).length,
      { message: "constellation names on the sky", timeout: 30_000 }).toBeGreaterThan(0);
    const constellationLabels = (await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.skyLabels())).filter((label) => label.key.startsWith("constellation:")).map((label) => label.name);
    for (const name of constellationLabels) expect(latinOnly, `${name} is a Latin name`).not.toContain(name);
  });

  test("the media card, the source links, and the uncertainty sentence of the inspector are Spanish", async ({ page }) => {
    await openAtlas(page);
    await useSpanish(page);
    await selectCatalogObject(page, "Marte", "mars", "Mars");
    // The text of the curated image comes from the Spanish module, which loads after the language change.
    const media = page.locator("#body-info .object-media--curated").first();
    await expect(media.locator(".object-media__badge")).toHaveText("Imagen seleccionada de la NASA", { timeout: 15_000 });
    await expect(media.locator(".object-media__title")).not.toHaveText("Tharsis Volcanoes and Valles Marineris", { timeout: 15_000 });
    await expect(media.locator("img")).not.toHaveAttribute("alt", /^Global Mars view/);
    // The name of the image library is a proper name.
    await expect(media.locator(".object-media__source")).toContainText("NASA Image and Video Library");

    await page.locator('#body-info [data-object-view="sources"]').click();
    const sources = page.locator("#object-view-panel-sources");
    await expect(sources).toContainText("Esta fuente del atlas no proporciona la incertidumbre.");
    await expect(sources).not.toContainText("Uncertainty not supplied");

    // A star gets the link to SIMBAD with a Spanish label.
    await page.locator("#workspace-search-link").click();
    await page.locator("#body-search").fill("Sirius");
    await page.locator("#body-picker [data-body-key]").filter({ hasText: "Sirius" }).first().click();
    await page.locator('#body-info [data-object-view="sources"]').click();
    await expect(sources).toContainText("SIMBAD");
    await expect(sources).not.toContainText("SIMBAD object lookup");
  });

  test("the constellation list of Settings has Spanish names, and a search finds the Spanish and the Latin name", async ({ page }) => {
    await openAtlas(page);
    await useSpanish(page);
    await page.locator("#map-settings-toggle").click();
    await page.locator('[aria-controls="scale-constellations"]').click();
    const list = page.locator("#constellation-list");
    await expect(list.locator("label").filter({ hasText: "Osa Mayor" })).toHaveCount(1);
    await expect(list).not.toContainText("Ursa Major");
    // The list is in the order of the Spanish names.
    const names = await list.locator("label").allInnerTexts();
    expect(names.map((name) => name.trim())).toEqual([...names].map((name) => name.trim()).sort((a, b) => a.localeCompare(b, "es")));
    const visible = () => list.locator("label:not([hidden])").allInnerTexts().then((rows) => rows.map((row) => row.trim()).sort());
    await page.locator("#constellation-search").fill("osa");
    await expect.poll(visible).toEqual(["Osa Mayor", "Osa Menor"]);
    await page.locator("#constellation-search").fill("ursa");
    await expect.poll(visible).toEqual(["Osa Mayor", "Osa Menor"]);
    // English uses the Latin names again.
    await page.locator("#constellation-search").fill("");
    await page.keyboard.press("Escape");
    await page.locator("#locale-select").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator("#map-settings-toggle").click();
    await expect(list.locator("label").filter({ hasText: "Ursa Major" })).toHaveCount(1);
  });
});
