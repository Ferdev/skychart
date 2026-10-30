import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

const START = "/?v=1&c=-5,0&z=24&t=2026-08-26T12:00:00.000Z&L=&perf=1";
const FIXTURE_A = {
  key: "fixture-a", name: "Fixture A", object_type: "star", catalog_group: "bright_stars",
  source_type: "test_catalog", position_model: "catalog_distance", color: "#f8cb65",
  astrometry: { apparent_magnitude: 1, distance_ly: 0.000158 }, position: { x_au: -10, y_au: 0, z_au: 0 },
};

/** The Sun and Earth from the ephemeris, and one catalog star at x = -10 AU. */
async function installFixtures(context: BrowserContext) {
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: url.searchParams.get("q")?.toLowerCase().includes("fixture") ? [FIXTURE_A] : [], total: 1, has_more: false };
    if (url.pathname === "/api/objects/fixture-a") payload = { object: FIXTURE_A };
    if (url.pathname === "/api/catalog/sky") {
      const observer = { x: Number(url.searchParams.get("observer_x_au")), y: Number(url.searchParams.get("observer_y_au")), z: Number(url.searchParams.get("observer_z_au")) };
      const delta = { x: -10 - observer.x, y: -observer.y, z: -observer.z };
      const distance = Math.hypot(delta.x, delta.y, delta.z) || 1;
      payload = { returned: 1, nearby_returned: 1, points: [{ key: "fixture-a", name: "Fixture A", object_type: "star", color: "#f8cb65", apparent_magnitude: 1,
        distance_au: distance, direction: { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance } }] };
    }
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
}

async function enter3d(page: Page) {
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-status")).toHaveText("1 sampled catalog positions loaded");
}

async function expectFlightKeysWork(page: Page) {
  await expect(page.locator("#universe-map")).toBeFocused();
  await page.keyboard.down("w");
  await expect(page.locator("#universe-speed")).not.toHaveText("0 km/s · 0 c");
  await page.keyboard.up("w");
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c", { timeout: 30_000 });
}

async function chooseFixtureA(page: Page) {
  await page.locator("#universe-find").click();
  await page.locator("#universe-search-input").fill("Fixture A");
  await expect(page.locator("#universe-search-results [role=option]")).toContainText("Fixture A");
  await page.locator("#universe-search-input").press("Enter");
  await expect(page.locator("#universe-target-name")).toHaveText("Fixture A");
}

test.describe("3D view controls", () => {
  test.beforeEach(async ({ context }) => { await installFixtures(context); });

  test("the first entry shows the flight controls one time", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    // The shared helper closes the card for the other tests. This test keeps it.
    await page.addInitScript(() => sessionStorage.setItem("test:keep-universe-hint", "1"));
    await openAtlas(page, START);
    await enter3d(page);
    const hint = page.locator("#universe-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("How to fly");
    await expect(page.locator("#universe-hint-text")).toContainText("Hold W to go faster");
    // The card is not on the object in the centre of the view.
    const box = (await hint.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height).toBeLessThan(viewport.height / 2 - 20);

    await page.locator("#universe-hint-close").click();
    await expect(hint).toBeHidden();
    // The flight keys work at once, with no click on the view.
    await expectFlightKeysWork(page);
    await page.locator("#universe-close").click();
    await enter3d(page);
    await expect(hint).toBeHidden();
    issues.assertClean();
  });

  test("the gravity route shows its on state with a mark, and keeps its name", async ({ page }) => {
    await openAtlas(page, START);
    await enter3d(page);
    const gravity = page.locator("#universe-gravity");
    const mark = () => gravity.evaluate((button) => getComputedStyle(button, "::before").content);
    await expect(gravity).toHaveAccessibleName("Gravity route");
    expect(await mark()).toBe("none");
    await gravity.click();
    await expect(gravity).toHaveAttribute("aria-pressed", "true");
    await expect(gravity).toHaveAccessibleName("Gravity route");
    // The mark is a CSS shape with no text. Text would go into the accessible name.
    expect(await mark()).toBe('""');
    await gravity.click();
    await expect(gravity).toHaveAttribute("aria-pressed", "false");
    expect(await mark()).toBe("none");
  });

  test("the autopilot says what it does with no target, with a target, and at the target", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await openAtlas(page, START);
    await enter3d(page);
    const autopilot = page.locator("#universe-autopilot");
    const note = page.locator("#universe-flight-note");

    await expect(autopilot).toHaveText("Cruise forward");
    await expect(note).toBeEmpty();
    await autopilot.click();
    await expect(autopilot).toHaveAttribute("aria-pressed", "true");
    await expect(note).toHaveText("Cruising forward, no destination");
    await autopilot.click();
    await expect(autopilot).toHaveAttribute("aria-pressed", "false");
    await expect(note).toBeEmpty();

    await chooseFixtureA(page);
    await expect(autopilot).toHaveText("Start autopilot");
    await expect(autopilot).toBeEnabled();
    await expect(page.locator("#universe-fly")).toBeEnabled();

    // At the target the flight buttons have nothing to do, and the card says where the user is.
    await page.locator("#universe-focus").click();
    await expect(page.locator("#universe-target-meta")).toContainText("You are at Fixture A");
    await expect(page.locator("#universe-fly")).toBeDisabled();
    await expect(page.locator("#universe-focus")).toBeDisabled();
    await expect(autopilot).toBeDisabled();
    // A move away from the target makes the buttons active again.
    await page.locator("#universe-map").focus();
    await page.keyboard.down("s");
    await expect(page.locator("#universe-fly")).toBeEnabled({ timeout: 20_000 });
    await page.keyboard.up("s");
    issues.assertClean();
  });

  test("the speed panel explains its scale, the gravity route has an explanation, and the trip map can be hidden", async ({ page }) => {
    await openAtlas(page, START);
    await enter3d(page);
    await expect(page.locator(".universe-view__speed-caption")).toBeVisible();
    await expect(page.locator(".universe-view__speed-caption")).toContainText("speed of light");
    await expect(page.locator(".universe-view__gauge-tick").first()).toHaveAttribute("title", "1 astronomical unit each second");

    await page.locator("#universe-gravity-info").click();
    await expect(page.locator("#control-info-tooltip")).toBeVisible();
    await expect(page.locator("#control-info-tooltip")).toContainText("orbit around the Sun or a planet");
    await page.keyboard.press("Escape");

    const toggle = page.locator("#universe-minimap-toggle");
    await expect(page.locator("#universe-minimap")).toBeVisible();
    await expect(toggle).toHaveAccessibleName("Hide trip map");
    await toggle.click();
    await expect(page.locator("#universe-minimap")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAccessibleName("Show trip map");
    await expectFlightKeysWork(page);
    // The choice stays after a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
    await expect(page.locator("#universe-view")).toBeVisible();
    await expect(page.locator("#universe-minimap")).toBeHidden();
    await page.locator("#universe-minimap-toggle").click();
    await expect(page.locator("#universe-minimap")).toBeVisible();
  });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1366, height: 1024 }]) {
  test.describe(`3D view on a touch screen of ${viewport.width} x ${viewport.height} px`, () => {
    test.use({ viewport, isMobile: viewport.width < 900, hasTouch: true });

    test("the header, the search close button, and the hint button are 44 px targets", async ({ page, context }) => {
      await installFixtures(context);
      await page.addInitScript(() => sessionStorage.setItem("test:keep-universe-hint", "1"));
      await openAtlas(page, START);
      await page.locator("#universe-3d-toggle").tap();
      await expect(page.locator("#universe-view")).toBeVisible();
      const expectTarget = async (control: Locator) => {
        const box = (await control.boundingBox())!;
        const name = await control.evaluate((element) => element.id || element.className);
        expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width);
        return box;
      };

      const header = await page.locator(".universe-view__actions :is(button, select):visible").all();
      expect(header.length).toBeGreaterThan(3);
      const tops = new Set<number>();
      for (const control of header) tops.add(Math.round((await expectTarget(control)).y));
      expect(tops.size, "the header is one row").toBe(1);

      await expectTarget(page.locator("#universe-hint-close"));
      await page.locator("#universe-hint-close").tap();
      await page.locator("#universe-find").tap();
      await expectTarget(page.locator("#universe-search-close"));
    });
  });
}

test.describe("3D view on a touch tablet in French", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test("the 44 px controls of a long header stay in the window", async ({ page, context }) => {
    await installFixtures(context);
    await openAtlas(page, START);
    await page.locator("#locale-select").selectOption("fr");
    await page.locator("#universe-3d-toggle").tap();
    await expect(page.locator("#universe-view")).toBeVisible();
    const close = (await page.locator("#universe-close").boundingBox())!;
    expect(close.x + close.width).toBeLessThanOrEqual(1280);
  });
});

test.describe("3D view: time bar, search, Sky return, and target card", () => {
  test.beforeEach(async ({ context }) => { await installFixtures(context); });

  test("the 3D header has the time bar of the atlas", async ({ page }) => {
    await openAtlas(page, START);
    const date2d = (await page.locator("#time-date").innerText()).trim();
    await enter3d(page);
    const bar = page.locator("#universe-time-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(".time-bar__date")).toBeVisible();
    // The same atlas time as the 2D header, and the two step buttons.
    await expect(bar.locator(".time-bar__date-text")).toHaveText(new RegExp(date2d.split("\n")[0]!.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(bar.locator(".time-bar__step")).toHaveCount(2);
    // One step changes the date in the bar. The fixture gives an ephemeris for each time.
    const before = await bar.locator(".time-bar__date-text").innerText();
    await bar.locator(".time-bar__step").last().click();
    await expect(bar.locator(".time-bar__date-text")).not.toHaveText(before);
    await expect(bar.locator(".time-bar__date")).toHaveClass(/not-now|is-not-now|time-bar__date/);
    await expect(page.locator("#universe-view")).toBeVisible();
  });

  test("the search shows a recent destination, and Escape closes only the open dialog", async ({ page }) => {
    await openAtlas(page, START);
    await enter3d(page);
    // `Details` of a target makes it a recent destination.
    await page.locator("#universe-find").click();
    await page.locator("#universe-search-results").getByRole("option", { name: /^Earth/ }).click();
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");
    await page.locator("#universe-details").click();
    await expect(page.locator("#workspace-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#workspace-panel")).toBeHidden();

    await page.locator("#universe-find").click();
    const dialog = page.locator("#universe-search-dialog");
    await expect(dialog).toBeVisible();
    const results = page.locator("#universe-search-results");
    await expect(results).toContainText("Recent");
    await expect(results.locator("[role=option]").first()).toContainText("Earth");
    // Escape closes the dialog. It does not stop the 3D view and does not ask for a second press.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#universe-view")).toBeVisible();
    await expect(page.locator("#universe-status")).not.toHaveText("Press Esc again to exit 3D");
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");
  });

  test("the Sky button of the inspector goes to Sky view and back to the same 3D target", async ({ page }) => {
    await openAtlas(page, START);
    await enter3d(page);
    await page.locator("#universe-find").click();
    await page.locator("#universe-search-results").getByRole("option", { name: /^Earth/ }).click();
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");
    const position = await page.locator("#universe-position").textContent();
    await page.locator("#universe-details").click();
    await expect(page.locator("#workspace-panel")).toBeVisible();
    await page.locator("#view-sky-selected").click();
    await expect(page.locator("#sky-view")).toBeVisible();
    await expect(page.locator("#universe-view")).toBeHidden();
    await expect(page.locator("#sky-view-close-label")).toHaveText("Back to 3D");
    await page.locator("#sky-view-close").click();
    await expect(page.locator("#sky-view")).toBeHidden();
    await expect(page.locator("#universe-view")).toBeVisible();
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");
    await expect(page.locator("#universe-position")).toHaveText(position!);
  });

  test("Sky view from the 2D map goes back to the map, and Escape closes the inspector first", async ({ page }) => {
    await openAtlas(page, START);
    await page.locator("#header-search").click();
    await page.locator("#body-search").fill("Earth");
    await page.locator('#body-picker [data-body-key="earth"]').first().click();
    await expect(page.locator("#selected-summary-name")).toHaveText("Earth");
    await page.locator("#view-sky-selected").click();
    await expect(page.locator("#sky-view")).toBeVisible();
    await expect(page.locator("#sky-view-close-label")).toHaveText("Back to map");
    await page.locator("#sky-view-close").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#sky-view")).toBeHidden();
    await expect(page.locator("#universe-view")).toBeHidden();
    await expect(page.locator("#map")).toBeVisible();
  });

  test("at 1200 px the target card stays in view with the inspector open, and the position line has no exponent", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openAtlas(page, START);
    await enter3d(page);
    await chooseFixtureA(page);
    await expect(page.locator("#universe-position")).toContainText("AU");
    await expect(page.locator("#universe-position")).not.toHaveText(/\de[+-]?\d/);
    await page.locator("#universe-details").click();
    const panel = page.locator("#workspace-panel");
    await expect(panel).toBeVisible();
    const card = page.locator("#universe-target");
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport({ ratio: 1 });
    const cardBox = (await card.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    const overlap = cardBox.x < panelBox.x + panelBox.width && panelBox.x < cardBox.x + cardBox.width && cardBox.y < panelBox.y + panelBox.height && panelBox.y < cardBox.y + cardBox.height;
    expect(overlap, "the inspector does not cover the target card").toBe(false);
    // The flight panel does not move when the inspector opens.
    await expect(page.locator("#universe-autopilot")).toBeInViewport({ ratio: 1 });
  });
});

test.describe("3D view on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("on a phone the inspector is a sheet of half the window at most", async ({ page, context }) => {
    await installFixtures(context);
    await openAtlas(page, START);
    await page.locator("#universe-3d-toggle").tap();
    await expect(page.locator("#universe-view")).toBeVisible();
    await page.locator("#universe-find").tap();
    await page.locator("#universe-search-results").getByRole("option", { name: /^Earth/ }).tap();
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");
    await page.locator("#universe-details").tap();
    const panel = page.locator("#workspace-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.height, "the sheet is half the window at most").toBeLessThanOrEqual(844 / 2 + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    // The header controls stay in view above the sheet.
    await expect(page.locator("#universe-close")).toBeInViewport({ ratio: 1 });
    expect((await page.locator("#universe-close").boundingBox())!.y, "the exit button is above the sheet").toBeLessThan(box.y);
  });

  test("on a phone the target card is one row, and its switch shows all actions", async ({ page, context }) => {
    await installFixtures(context);
    await openAtlas(page, START);
    await page.locator("#universe-3d-toggle").tap();
    await expect(page.locator("#universe-view")).toBeVisible();
    await page.locator("#universe-find").tap();
    await page.locator("#universe-search-results").getByRole("option", { name: /^Earth/ }).tap();
    await expect(page.locator("#universe-target-name")).toHaveText("Earth");

    const card = page.locator("#universe-target");
    const toggle = page.locator("#universe-target-toggle");
    const extras = ["#universe-focus", "#universe-inspect", "#universe-sky", "#universe-target-magnitude"];
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAccessibleName("Show all actions");
    for (const selector of ["#universe-fly", "#universe-details"]) await expect(page.locator(selector)).toBeVisible();
    for (const selector of extras) await expect(page.locator(selector)).toBeHidden();
    const header = (await page.locator(".universe-view__header").boundingBox())!;
    const speed = (await page.locator(".universe-view__speed").boundingBox())!;
    const short = (await card.boundingBox())!;
    expect(short.height, "the short card is one row").toBeLessThanOrEqual(66);
    expect(short.y + short.height, "the card is above the flight controls").toBeLessThanOrEqual(speed.y);
    expect((short.y - header.y - header.height) / 844, "part of the window height that is free view, with a target").toBeGreaterThan(0.55);
    const centre = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.id ?? "");
    expect(centre, "the view centre is the 3D canvas").toBe("universe-map");

    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAccessibleName("Show fewer actions");
    for (const selector of ["#universe-fly", "#universe-details", ...extras]) await expect(page.locator(selector)).toBeVisible();
    await expect(card).toBeInViewport({ ratio: 1 });
    const full = (await card.boundingBox())!;
    // The card opens up: its bottom edge and the flight controls do not move.
    expect(Math.abs(full.y + full.height - short.y - short.height)).toBeLessThanOrEqual(1);
    expect((await page.locator(".universe-view__speed").boundingBox())!.y).toBeCloseTo(speed.y, 0);
    const switchBox = (await toggle.boundingBox())!;
    expect(Math.min(switchBox.width, switchBox.height)).toBeGreaterThanOrEqual(44);

    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const selector of extras) await expect(page.locator(selector)).toBeHidden();
  });

  test("a phone flies with the joystick, and every control is in the window", async ({ page, context }) => {
    await installFixtures(context);
    await openAtlas(page, START);
    await page.locator("#universe-3d-toggle").tap();
    await expect(page.locator("#universe-view")).toBeVisible();

    await expect(page.locator(".universe-view__move-pad")).toBeHidden();
    const joystick = page.locator("#universe-joystick");
    await expect(joystick).toBeVisible();
    const inWindow = async (selector: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(390);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(844);
      // A touch target is 44 x 44 px minimum.
      expect(Math.min(box.width, box.height), selector).toBeGreaterThanOrEqual(44);
    };
    for (const selector of ["#universe-close", "#universe-find", "#universe-more-button", "#universe-autopilot", "#universe-joystick", '.universe-view__touch [data-universe-move="up"]', '.universe-view__touch [data-universe-move="down"]']) await inWindow(selector);
    // `Reset flight` and the trip map switch are rows of the More menu.
    await page.locator("#universe-more-button").tap();
    await inWindow("#universe-reset");
    await inWindow("#universe-minimap-menu-toggle");
    await page.locator("#universe-minimap-menu-toggle").tap();
    await expect(page.locator("#universe-minimap")).toBeVisible();
    // The joystick does not go across the trip map.
    const stick = (await joystick.boundingBox())!;
    const map = (await page.locator("#universe-minimap-panel").boundingBox())!;
    expect(stick.x >= map.x + map.width || stick.y >= map.y + map.height || map.x >= stick.x + stick.width || map.y >= stick.y + stick.height).toBe(true);

    // A push of the joystick to the top moves the craft forward.
    const before = await page.locator("#universe-position").textContent();
    const centre = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    await joystick.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: centre.x, clientY: centre.y, bubbles: true });
    await joystick.dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", clientX: centre.x, clientY: centre.y - 50, bubbles: true });
    await expect(page.locator("#universe-position")).not.toHaveText(before!, { timeout: 20_000 });
    await joystick.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: centre.x, clientY: centre.y - 50, bubbles: true });
    await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c", { timeout: 30_000 });

    // The hint for a touch screen names the joystick.
    await page.evaluate(() => { localStorage.removeItem("cosmic-atlas:universe-hint-seen"); sessionStorage.setItem("test:keep-universe-hint", "1"); });
    await page.locator("#universe-close").tap();
    await page.locator("#universe-3d-toggle").tap();
    await expect(page.locator("#universe-hint-text")).toContainText("joystick");
  });
});
