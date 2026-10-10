import { expect, test, type Page } from "@playwright/test";
import { openAtlas, openSearchWorkspace, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

/** Selects the first search result whose row has the given name. Use it when the catalog key is not a fixed text. */
async function selectFirstResult(page: Page, query: string) {
  await openSearchWorkspace(page);
  await page.locator("#body-search").fill(query);
  await page.locator("#body-picker [data-body-key]").filter({ hasText: query }).first().click();
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#selected-summary-name")).toContainText(query);
}

test.describe("object inspector", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAtlas(page);
  });

  test("a view shows only when it has data, and Sources gives the source of the object", async ({ page }) => {
    await selectCatalogObject(page, "Mars", "mars");
    // Mars has no science notes, so there is no empty Science view.
    await expect(page.locator("#body-info [role=tab]")).toHaveText(["Overview", "Position", "Observe", "Sources"]);
    await page.locator('#body-info [data-object-view="sources"]').click();
    const sources = page.locator("#object-view-panel-sources");
    await expect(sources).toBeVisible();
    await expect(sources).toContainText("SPICE SPK");
    await expect(sources).toContainText("NASA/JPL");
    // The source of Mars only, not the sources of the star and galaxy catalogs.
    await expect(sources).not.toContainText(/Gaia|SIMBAD|Hipparcos|DESI/);
    await expect(sources).toContainText("Uncertainty not supplied by this atlas source.");

    // The observation service has no result for Earth as seen from Earth: no Observe view.
    await selectCatalogObject(page, "Earth", "earth");
    await expect(page.locator('#body-info [data-object-view="overview"]')).toBeVisible();
    await expect(page.locator('#body-info [data-object-view="observe"]')).toHaveCount(0);
  });

  test("a long name shows in full, and the subtitle has its full text as a tooltip", async ({ page }) => {
    await selectCatalogObject(page, "M31", "m31", /M31/);
    const name = page.locator("#selected-summary-name");
    await expect(name).toHaveText(/Andromeda Galaxy/);
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "the name is not cut").toBe(true);
    const subtitle = page.locator("#selected-summary-meta");
    await expect(subtitle).toHaveAttribute("title", /\S/);
    // The three actions are in a row below the name.
    const nameBox = (await name.boundingBox())!;
    for (const action of ["#center-selected", "#zoom-selected"]) {
      const box = await page.locator(action).boundingBox();
      if (box) expect(box.y, `${action} is below the name`).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
    }
  });

  test("only curated text gets the card with a title, and a star with no curated text gets the context list", async ({ page }) => {
    await selectCatalogObject(page, "Mars", "mars");
    await expect(page.locator("#body-info .object-summary-card")).toContainText("Why this matters");
    await selectFirstResult(page, "Sirius");
    await expect(page.locator("#body-info [role=tab]").first()).toBeVisible();
    // Sirius has no curated text: no card title and no sentence from a template.
    await expect(page.locator("#body-info")).not.toContainText("Why this matters");
    await expect(page.locator("#body-info .object-summary-card:not(.object-summary-card--context)")).toHaveCount(0);
  });

  test("Observe gives a table with local time and UTC, and an error shows as an alert", async ({ page }) => {
    let fail = false;
    await page.route("**/api/observe?**", async (route) => {
      if (fail) return route.fulfill({ status: 503, body: "unavailable" });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "mars", altitude_deg: 31.24, azimuth_deg: 181.5, rise_utc: "2026-10-10T18:05:00Z", transit_utc: "2026-10-10T23:40:00Z", set_utc: null,
          summary: "Fixture.", accuracy_note: "Fixture accuracy note.",
        }),
      });
    });
    await selectCatalogObject(page, "Mars", "mars");
    await page.locator('#body-info [data-object-view="observe"]').click();

    // A field with no number gives an error with the alert role, and no request.
    await page.locator('[data-observe-location="manual"]').click();
    await expect(page.locator("#observe-error")).toBeVisible();
    await expect(page.locator("#observe-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#observe-result")).toBeHidden();

    await page.locator("#observe-lat").fill("40.4");
    await page.locator("#observe-lon").fill("-3.7");
    await page.locator('[data-observe-location="manual"]').click();
    const result = page.locator("#observe-result");
    await expect(result).toBeVisible();
    await expect(page.locator("#observe-error")).toBeHidden();
    await expect(result.locator(".observe-now")).toContainText("31.2");
    await expect(result.locator(".observe-table thead th")).toHaveText(["Event", "Local time", "UTC"]);
    const rows = result.locator(".observe-table tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("th")).toHaveText("Rise");
    // The second column is the time of the browser, and the third column is UTC.
    await expect(rows.nth(0).locator("td").nth(0)).toHaveText(/\d{1,2}:\d{2}/);
    await expect(rows.nth(0).locator("td").nth(1)).toHaveText(/(06|18):05/);
    await expect(rows.nth(1).locator("td").nth(1)).toHaveText(/(11|23):40/);
    await expect(rows.nth(2).locator("td").nth(0)).toHaveText("Not in the next 24 hours");
    await expect(result).toContainText("Fixture accuracy note.");

    fail = true;
    await page.locator('[data-observe-location="manual"]').click();
    await expect(page.locator("#observe-error")).toBeVisible();
    await expect(result).toBeHidden();
  });

  test("the comparison actions show only when they can work, and the footer button goes back to the details", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await selectCatalogObject(page, "Jupiter", "jupiter");
    const compareButton = page.locator("#compare-selected");
    await expect(compareButton).toHaveAttribute("aria-expanded", "false");
    await compareButton.click();
    // Compare is open: the button goes back to the details and shows its on state.
    await expect(compareButton).toContainText("Back to details");
    await expect(compareButton).toHaveAttribute("aria-expanded", "true");
    // There is no object B: the two actions do not show.
    await expect(page.locator("#share-compare")).toBeHidden();
    await expect(page.locator("#clear-compare")).toBeHidden();

    await page.locator("#compare-search").fill("Mars");
    await page.locator('#compare-picker [data-body-key="mars"]').first().click();
    await expect(page.locator("#compare-panel")).toContainText("Mars");
    await expect(page.locator("#share-compare")).toBeVisible();
    await expect(page.locator("#clear-compare")).toBeVisible();
    // The message shows next to the button, not in the Share menu.
    await page.locator("#share-compare").click();
    const message = page.locator("#compare-feedback");
    await expect(message).toContainText(/copied/i);
    const buttonBox = (await page.locator("#share-compare").boundingBox())!;
    const messageBox = (await message.boundingBox())!;
    expect(Math.abs(messageBox.y - buttonBox.y), "the message is near the button").toBeLessThan(80);

    await page.locator("#clear-compare").click();
    await expect(page.locator("#share-compare")).toBeHidden();
    await compareButton.click();
    await expect(compareButton).toHaveAttribute("aria-expanded", "false");
    await expect(compareButton).toContainText("Compare");
    await expect(page.locator('#body-info [data-object-view="overview"]')).toBeVisible();
  });
});
