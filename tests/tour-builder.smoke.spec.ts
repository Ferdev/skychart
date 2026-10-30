import { expect, test, type Page } from "@playwright/test";
import { openAtlas } from "./atlas-test-utils";

const view = "v=1&c=0%2C0&z=24&t=2026-10-30T00%3A00%3A00.000Z&L=grid.1";
const token = "0123456789abcdef0123456789abcdef";
const caption = "<img src=x onerror=alert(1)> plain text";

/** The community routes that the tour builder uses, with a store of one account. */
async function tourFixture(page: Page) {
  const state = { tours: [] as Record<string, unknown>[], reports: 0, shared: true };
  const user = { id: "u1", handle: "teacher", name: "Teacher", role: "member" };
  await page.route("**/api/community/config", (route) => route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/community/session", (route) => route.fulfill({ json: { user, csrf: "csrf", review_count: 0 } }));
  await page.route("**/api/photos/index?**", (route) => route.fulfill({ json: { version: 1, more: false, items: [] } }));
  await page.route("**/api/community/tours", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { tours: state.tours } });
    const tour = { ...route.request().postDataJSON(), id: "t1", status: "shared", url: `/?tour=shared-${token}` };
    state.tours = [tour];
    return route.fulfill({ json: tour });
  });
  await page.route("**/api/community/tours/t1", (route) => {
    const tour = { ...state.tours[0], ...route.request().postDataJSON() };
    state.tours = [tour];
    return route.fulfill({ json: tour });
  });
  await page.route(`**/api/community/shared-tours/${token}`, (route) => {
    const tour = state.tours[0];
    return state.shared && tour
      ? route.fulfill({ json: { slug: `shared-${token}`, title: tour.title, description: tour.description, author: "Teacher", steps: tour.steps } })
      : route.fulfill({ status: 404, json: { error: "not_found" } });
  });
  await page.route(`**/api/community/shared-tours/${token}/report`, (route) => {
    state.reports += 1;
    state.shared = false;
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

test("a tour is built from the current view, previewed, shared, and reported", async ({ page }) => {
  test.setTimeout(120_000);
  const state = await tourFixture(page);
  await openAtlas(page);
  await page.locator('[data-community-tab="gallery"]').click({ force: true });
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await hub.getByRole("tab", { name: "Tours" }).click();
  await hub.getByRole("button", { name: "New tour" }).click();
  await hub.getByLabel("Tour title").fill("Lesson one");
  await hub.getByRole("button", { name: "Add step" }).click();
  await hub.getByLabel("Step title").fill("The first view");
  await hub.getByLabel("Caption").fill(caption);
  await expect(hub.locator(".tour-builder__step").first()).toContainText("2D map");
  await hub.getByRole("button", { name: "Add step" }).click();
  await hub.getByLabel("Step title").nth(1).fill("The second view");
  await hub.getByRole("button", { name: "Move up" }).nth(1).click();
  await expect(hub.getByLabel("Step title").first()).toHaveValue("The second view");
  await hub.getByRole("button", { name: "Save tour" }).click();
  await expect(hub.locator(".community-message")).toHaveText("Tour saved");
  expect((state.tours[0]!.steps as { viewState: string }[])[0]!.viewState).toContain("v=1");

  await hub.getByRole("button", { name: "Preview" }).click();
  const player = page.locator("#tour-player");
  await expect(player).toContainText("The second view", { timeout: 20_000 });
  await player.getByRole("button", { name: "Next" }).click();
  await expect(player.getByRole("heading")).toHaveText("The first view", { timeout: 20_000 });
  await expect(player.locator(".tour-player__body")).toHaveText(caption);
  await expect(player.locator(".tour-player__body img")).toHaveCount(0);
  await player.locator("[data-tour-action='close']").click();

  await page.goto(`/?tour=shared-${token}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(player).toContainText("A tour by Teacher", { timeout: 20_000 });
  await player.getByRole("button", { name: "Report" }).click();
  const report = page.getByRole("dialog", { name: "Report" });
  await report.locator("textarea").fill("This is not a lesson");
  await report.getByRole("button", { name: /report/i }).last().click();
  await expect(player).toBeHidden();
  expect(state.reports).toBe(1);

  await page.goto(`/?tour=shared-${token}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator("#tour-player [role='alert']")).toBeVisible({ timeout: 20_000 });
});

test("a shared tour moves across the map, Sky view, and the 3D view, with the time of each step", async ({ page }) => {
  test.setTimeout(120_000);
  const state = await tourFixture(page);
  const time = encodeURIComponent("2026-10-30T20:00:00.000Z");
  const base = `v=1&c=1,1&z=24&t=${time}&L=grid.1`;
  state.tours = [{ title: "Three views", description: "", steps: [
    { viewState: base, title: "Map step", body: "" },
    { viewState: `${base}&sky=earth&sc=82.0,-28.7,40.0`, title: "Sky step", body: "" },
    { viewState: `${base}&u3=1,1,1&u3c=30,5,60,0.5`, title: "3D step", body: "" },
  ] }];
  await openAtlas(page, `/?tour=shared-${token}`);
  const player = page.locator("#tour-player");
  await expect(player.getByRole("heading")).toHaveText("Map step", { timeout: 20_000 });
  await player.getByRole("button", { name: "Next" }).click();
  await expect(player.getByRole("heading")).toHaveText("Sky step", { timeout: 20_000 });
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-time-bar .time-bar__date-text")).toContainText("8:00");
  await player.getByRole("button", { name: "Next" }).click();
  await expect(player.getByRole("heading")).toHaveText("3D step", { timeout: 25_000 });
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#sky-view")).toBeHidden();
  await player.getByRole("button", { name: "Previous" }).click();
  await expect(player.getByRole("heading")).toHaveText("Sky step", { timeout: 20_000 });
  await expect(page.locator("#sky-view")).toBeVisible();
});

test("a step that the user skips during the camera move does not lose the time of the tour", async ({ page }) => {
  test.setTimeout(120_000);
  const state = await tourFixture(page);
  const time = encodeURIComponent("2026-10-30T20:00:00.000Z");
  const base = `v=1&c=1,1&z=24&t=${time}&L=grid.1`;
  state.tours = [{ title: "Quick steps", description: "", steps: [
    { viewState: base, title: "First step", body: "" },
    { viewState: `${base}&sky=earth&sc=82.0,-28.7,40.0`, title: "Second step", body: "" },
  ] }];
  // The click comes as soon as the card shows, while the camera of the first step still moves.
  await page.addInitScript(() => {
    const timer = window.setInterval(() => {
      const next = document.querySelector<HTMLButtonElement>("#tour-player [data-tour-action='next']");
      if (!next) return;
      window.clearInterval(timer);
      next.click();
    }, 10);
  });
  await openAtlas(page, `/?tour=shared-${token}`);
  await expect(page.locator("#tour-player").getByRole("heading")).toHaveText("Second step", { timeout: 20_000 });
  await expect(page.locator("#sky-time-bar .time-bar__date-text")).toContainText("8:00");
  await expect(page.locator("#sky-time-bar")).toHaveAttribute("data-time-state", "not-now");
});
