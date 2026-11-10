import { expect, test } from "@playwright/test";
import { skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("guided tours", () => {
  test.beforeEach(async ({ request }) => {
    await skipIfAtlasUnavailable(request);
  });

  test("plays captions with history-backed steps", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");

    await page.locator("[data-tour-action='next']").click();
    await expect(page.locator("#tour-player h2")).toHaveText("The nearest measured stars");
    expect(new URL(page.url()).searchParams.get("step")).toBe("1");

    await page.goBack();
    await expect(page).toHaveURL(/(?:\?|&)step=0(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
  });

  test("reduced motion cuts between views", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await page.locator("[data-tour-action='next']").click();
    await expect(page.locator("#tour-player")).toHaveAttribute("data-motion", "cut");
  });

  test("only the latest rapid tour transition commits", async ({ page }) => {
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    const next = page.locator("[data-tour-action='next']");

    await next.click();
    await next.click();

    await expect(page).toHaveURL(/(?:\?|&)step=2(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("Nearby stellar space");
  });

  test("rapid forward then backward navigation keeps the latest step", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    await expect(page).toHaveURL(/(?:\?|&)step=0(?:&|$)/);
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
  });

  test("the arrow keys and Escape stay with a tab or a dialog that has the focus", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    await expect(page.locator("#selected-summary-name")).toHaveText("Sun");
    // The tour puts the focus on Next when the first step arrives.
    await expect(page.locator("[data-tour-action='next']")).toBeFocused();

    // An inspector tab uses the arrow keys to move between the tabs.
    const tabs = page.locator("#body-info [data-object-view]");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(500);
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    expect(new URL(page.url()).searchParams.get("step")).toBe("0");

    // Escape closes the dialog, not the tour.
    await page.evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.id = "test-dialog";
      dialog.innerHTML = "<button type=\"button\">OK</button>";
      document.body.append(dialog);
      dialog.showModal();
    });
    await expect(page.locator("#test-dialog button")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#test-dialog")).toBeHidden();
    await expect(page.locator("#tour-player")).toBeVisible();

    // With the focus in the tour card, the keys go to the tour.
    await page.locator("[data-tour-action='next']").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tour-player h2")).toHaveText("The nearest measured stars");
    await page.keyboard.press("Escape");
    await expect(page.locator("#tour-player")).toBeHidden();
  });

  test("the focus stays on the same tour control, and only the new step is announced", async ({ page }) => {
    const token = "0123456789abcdef0123456789abcdef";
    const view = "v=1&c=0%2C0&z=24&t=2026-10-30T00%3A00%3A00.000Z&L=grid.1";
    await page.route("**/api/community/config", (route) => route.fulfill({ json: { enabled: true } }));
    await page.route(`**/api/community/shared-tours/${token}`, (route) => route.fulfill({
      json: {
        slug: `shared-${token}`, title: "Three steps", description: "", author: "Teacher", narrated: true,
        steps: ["One", "Two", "Three"].map((title) => ({ viewState: view, title, body: "", sentences: [[{ kind: "text", text: `${title}.` }]] })),
      },
    }));
    await page.goto(`/?tour=shared-${token}`);
    const plate = page.locator("#tour-player");
    const status = page.locator("#tour-player-status");
    await expect(plate.locator("h2")).toHaveText("One", { timeout: 45_000 });
    await expect(plate).not.toHaveAttribute("aria-live");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveText("Step 1 of 3: One");

    const next = plate.locator("[data-tour-action='next']");
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(plate.locator("h2")).toHaveText("Two");
    await expect(next).toBeFocused();
    await expect(status).toHaveText("Step 2 of 3: Two");

    // A step dot keeps the focus on the same dot.
    await plate.locator("[data-tour-step='0']").focus();
    await page.keyboard.press("Enter");
    await expect(plate.locator("h2")).toHaveText("One");
    await expect(plate.locator("[data-tour-step='0']")).toBeFocused();

    // The speech button keeps the focus, and the step is not announced again.
    await page.evaluate(() => {
      window.speechSynthesis.speak = () => {};
      window.speechSynthesis.cancel = () => {};
    });
    const speak = plate.locator("[data-tour-action='speak']");
    await speak.focus();
    await page.keyboard.press("Enter");
    await expect(speak).toHaveAttribute("aria-pressed", "true");
    await expect(speak).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(speak).toHaveAttribute("aria-pressed", "false");
    await expect(status).toHaveText("Step 1 of 3: One");

    // Next is disabled on the last step, so the title of the step gets the focus.
    await plate.locator("[data-tour-step='1']").click();
    await expect(plate.locator("h2")).toHaveText("Two");
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(plate.locator("h2")).toHaveText("Three");
    await expect(next).toBeDisabled();
    await expect(plate.locator("h2")).toBeFocused();
  });

  test("closing during a transition prevents its history commit", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });

    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    // Both clicks are in one task, so that the close is during the transition on a slow computer also.
    const entriesBefore = await page.evaluate(() => {
      const entries = history.length;
      document.querySelector<HTMLButtonElement>("[data-tour-action='next']")!.click();
      document.querySelector<HTMLButtonElement>("[data-tour-action='close']")!.click();
      return entries;
    });
    await page.waitForTimeout(1_500);

    await expect(page.locator("#tour-player")).toBeHidden();
    expect(await page.evaluate(() => history.length), "the cancelled step must not add a history entry").toBe(entriesBefore);
    // A closed tour is not in the address, so that the address follows the map again.
    const params = new URL(page.url()).searchParams;
    expect(params.get("tour")).toBeNull();
    expect(params.get("step")).toBeNull();
  });

  test("the address follows the map again after the tour is closed", async ({ page }) => {
    await page.goto("/?tour=near-the-sun&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("The Sun at the center");
    await page.locator("[data-tour-action='close']").click();
    await expect(page.locator("#tour-player")).toBeHidden();
    await expect(page).not.toHaveURL(/tour=/);

    await page.locator('.toolbar-quick-layers input[data-layer="grid"]').uncheck();
    await expect(page).toHaveURL(/grid\.0/);
    await expect(page).not.toHaveURL(/tour=/);
  });

  test("a step with no object shows no object of an earlier step", async ({ page }) => {
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#selected-summary-name")).toHaveText("Earth");
    await expect(page.locator("#selected-object-panel")).toBeVisible();

    await page.locator('#tour-player [data-tour-step="2"]').click();
    await expect(page.locator("#tour-player h2")).toHaveText("Nearby stellar space");
    await expect(page.locator("#selected-object-panel")).toBeHidden();
    expect(new URL(page.url()).searchParams.get("o")).toBeNull();
    // The step changes the object type filter. The filter chips show it.
    await expect(page.locator('#map-filter-buttons [data-body-filter="star"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#map-filter-buttons [aria-pressed="true"]')).toHaveCount(1);
  });

  test("on a phone the tour card and the inspector sheet of a step with an object do not overlap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?tour=earth-to-observable-universe&step=0");
    await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator("#tour-player h2")).toHaveText("Earth as the starting scale");
    await expect(page.locator("#selected-summary-name")).toHaveText("Earth");
    await expect(page.locator("#selected-object-panel")).toBeVisible();

    const card = (await page.locator("#tour-player").boundingBox())!;
    const sheet = (await page.locator("#workspace-panel").boundingBox())!;
    const header = (await page.locator(".atlas-bar").boundingBox())!;
    expect(sheet.y + sheet.height, "the sheet ends where the card starts").toBeLessThanOrEqual(card.y + 1);
    expect(card.y + card.height, "the card is in the window").toBeLessThanOrEqual(844);
    expect(sheet.y - (header.y + header.height), "the map shows between the header and the sheet").toBeGreaterThanOrEqual(120);
    // The step buttons are in the card and work.
    await expect(page.locator('#tour-player [data-tour-action="next"]')).toBeInViewport({ ratio: 1 });
    await page.locator('#tour-player [data-tour-action="next"]').click();
    await expect(page.locator("#tour-player h2")).toHaveText("The planetary neighborhood");
    // A step with no object closes the sheet, and the card goes back above the toolbar.
    await expect(page.locator("#selected-object-panel")).toBeHidden();
    const toolbar = (await page.locator(".atlas-toolbar").boundingBox())!;
    await expect.poll(async () => { const box = (await page.locator("#tour-player").boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(toolbar.y);
  });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`the tour card has the atlas style and is clear of the controls at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/?tour=earth-to-observable-universe&step=1");
      await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45_000 });
      await expect(page.locator("#tour-player h2")).toHaveText("The planetary neighborhood");

      const card = (await page.locator("#tour-player").boundingBox())!;
      const intersects = (other: { x: number; y: number; width: number; height: number }) =>
        card.x < other.x + other.width && other.x < card.x + card.width && card.y < other.y + other.height && other.y < card.y + card.height;
      for (const selector of [".atlas-toolbar", "#share-menu-button", ".atlas-bar"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box, selector).not.toBeNull();
        expect(intersects(box!), `the tour card must not be on ${selector}`).toBe(false);
      }
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);

      // The current step has a fill, and a step that is not done has none.
      const dotFill = (step: number) => page.locator(`#tour-player [data-tour-step="${step}"]`).evaluate((dot) => getComputedStyle(dot, "::before").backgroundColor);
      expect(await dotFill(1)).not.toBe("rgba(0, 0, 0, 0)");
      expect(await dotFill(0)).not.toBe("rgba(0, 0, 0, 0)");
      expect(await dotFill(3)).toBe("rgba(0, 0, 0, 0)");
      await expect(page.locator('#tour-player [data-tour-step="1"]')).toHaveAttribute("aria-current", "step");
      // The card uses the dark panel style, not the paper style.
      const background = await page.locator("#tour-player").evaluate((card) => getComputedStyle(card).backgroundColor);
      expect(background).toMatch(/^rgba?\(1[0-9], 1[0-9], 1[0-9]/);
      await expect(page.locator("#tour-player .tour-player__progress")).toHaveText("Step 2 of 5");
    });
  }
});
