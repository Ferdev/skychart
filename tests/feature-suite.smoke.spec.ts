import { expect, test, type Page } from "@playwright/test";
import { openAtlas, openSearchWorkspace } from "./atlas-test-utils";

const SITE = { latitude: "-33.8568", longitude: "151.2153" };

/** The sky from Earth, with the camera on the Orion Nebula at 40 degrees. */
const EARTH_SKY = "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=82.0,-28.7,40.0";

async function openEarthSky(page: Page) {
  await openAtlas(page, EARTH_SKY);
  await expect(page.locator("#sky-view")).toBeVisible();
}

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC", "base64");

function overlayPhoto(id: string, ra: number, dec: number, scaleDeg: number) {
  return {
    id, title: `Photo ${id}`, author: "Observer", licence: "CC BY 4.0", captured_at: "2026-10-08T00:00:00Z",
    thumbnail_url: "/overlay-image.png", image_url: "/overlay-image.png",
    wcs: {
      ra_deg: ra, dec_deg: dec, pixel_scale_arcsec: scaleDeg * 3600, rotation_deg: 0, width: 1600, height: 1067,
      cd: [-scaleDeg, 0, 0, scaleDeg], crpix: [800.5, 534], projection: "TAN", frame: "ICRS", epoch: "J2000", status: "solved",
    },
  };
}

async function overlayFixture(page: Page, photos: unknown[]) {
  await page.route("**/overlay-image.png", (route) => route.fulfill({ contentType: "image/png", body: image }));
  const state = { requests: 0 };
  await page.route("**/api/photos/sky?**", (route) => {
    state.requests += 1;
    return route.fulfill({ json: { photos } });
  });
  return state;
}

test("the planner keeps the site private, ranks targets, and opens a target in Sky view", async ({ page }) => {
  test.setTimeout(120_000);
  const events: string[] = [];
  const addresses: string[] = [];
  page.on("request", (request) => {
    addresses.push(request.url());
    if (request.url().includes("/api/events")) events.push(request.postData() ?? "");
  });
  await openEarthSky(page);
  await page.locator("#sky-planner-button").click();
  const panel = page.getByRole("dialog", { name: "Tonight's planner" });
  await panel.getByLabel("Latitude").fill(SITE.latitude);
  await panel.getByLabel("Longitude").fill(SITE.longitude);
  await panel.getByLabel("Night (evening date)").fill("2026-10-30");
  await panel.getByLabel("Object type").selectOption("galaxy");
  await panel.getByRole("button", { name: "Plan the night" }).click();
  await expect(panel.locator(".planner-row").first()).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator(".planner-summary")).toContainText("Astronomical night");
  const stored = await page.evaluate(() => localStorage.getItem("cosmic-atlas:planner-site"));
  expect(JSON.parse(stored!)).toEqual({ latitude: -33.8568, longitude: 151.2153 });

  const name = await panel.locator(".planner-row strong").first().textContent();
  await panel.locator(".planner-row [data-target]").first().click();
  await expect(panel).toBeHidden();
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-view")).toHaveAttribute("data-object-inspector", "true", { timeout: 20_000 });
  await expect(page.locator("#body-info")).toContainText(name!.split(" ").slice(0, 2).join(" "), { timeout: 20_000 });
  await expect(page.locator("#sky-time-bar")).toHaveAttribute("data-time-state", "not-now");
  await expect.poll(() => new URL(page.url()).searchParams.get("t")).toMatch(/^2026-10-3[01]T/);
  expect(new URL(page.url()).searchParams.get("sky")).toBe("earth");

  await page.waitForTimeout(500);
  for (const text of [...events, ...addresses, page.url()]) {
    expect(text).not.toContain("33.85");
    expect(text).not.toContain("151.21");
  }
});

test("the planner shows a site with no astronomical darkness, and forgets a site", async ({ page }) => {
  await openEarthSky(page);
  await page.locator("#sky-planner-button").click();
  const panel = page.getByRole("dialog", { name: "Tonight's planner" });
  await panel.getByLabel("Latitude").fill("60.2");
  await panel.getByLabel("Longitude").fill("24.9");
  await panel.getByLabel("Night (evening date)").fill("2026-06-21");
  await panel.getByRole("button", { name: "Plan the night" }).click();
  await expect(panel.locator(".planner-note")).toContainText("no astronomical darkness", { timeout: 20_000 });
  await panel.getByRole("button", { name: "Forget this site" }).click();
  expect(await page.evaluate(() => localStorage.getItem("cosmic-atlas:planner-site"))).toBeNull();
});

test("the Subscribe control gives a copyable address and a webcal link for the chosen types", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openAtlas(page);
  await openSearchWorkspace(page);
  const control = page.locator("#now-subscribe");
  await control.locator("summary").click();
  const address = control.getByLabel("Calendar address");
  await expect(address).toHaveValue(/\/calendar\.ics$/);
  await control.getByLabel("New exoplanets").uncheck();
  await expect(address).toHaveValue(/\/calendar\.ics\?types=close_approach$/);
  await expect(control.getByRole("link", { name: "Open in calendar app" })).toHaveAttribute("href", /^webcal:\/\/.*\/calendar\.ics\?types=close_approach$/);
  await control.getByRole("button", { name: "Copy address" }).click();
  await expect(control.getByRole("status")).toHaveText("Address copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/calendar\.ics\?types=close_approach$/);
  // The last type stays selected: an empty choice has no calendar.
  await control.getByLabel("Asteroid close approaches").click();
  await expect(control.getByLabel("Asteroid close approaches")).toBeChecked();
  await expect(address).toHaveValue(/types=close_approach$/);

  const calendar = await page.request.get("/calendar.ics?types=close_approach");
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("BEGIN:VCALENDAR");
});

test("the Sky overlay aligns a photo, opens the viewer, and follows the L parameter", async ({ page }) => {
  test.setTimeout(120_000);
  await overlayFixture(page, [overlayPhoto("11111111-1111-4111-8111-111111111111", 83.8, -5.4, 0.008), overlayPhoto("22222222-2222-4222-8222-222222222222", 200, -40, 0.001)]);
  await page.route("**/api/photos/11111111-1111-4111-8111-111111111111", (route) => route.fulfill({ json: {
    ...overlayPhoto("11111111-1111-4111-8111-111111111111", 83.8, -5.4, 0.008), declared_key: "m42", caption: "", equipment: "", processing: "", composite: false, author: { handle: "observer", name: "Observer" }, votes: 1,
  } }));
  await openEarthSky(page);
  const image = page.locator(".community-sky-photo img").first();
  await expect(image).toHaveCount(1, { timeout: 20_000 });
  await expect(image).toHaveCSS("mix-blend-mode", "screen");
  expect(await image.evaluate((node: HTMLElement) => node.style.transform)).toContain("matrix3d");
  expect(new URL(page.url()).searchParams.get("L")).toContain("photos.1");

  await page.locator("#sky-layer-controls summary").click();
  const opacity = page.locator("#sky-photo-opacity");
  await expect(opacity).toBeVisible();
  await opacity.fill("0.3");
  await expect.poll(() => image.evaluate((node: HTMLElement) => node.style.opacity)).toBe("0.3");

  const box = await image.boundingBox();
  await page.locator("#sky-layer-controls summary").click();
  await page.locator(".community-sky-photo__focus").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Photo 11111111-1111-4111-8111-111111111111" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(box!.width).toBeGreaterThan(40);

  await page.locator("#sky-layer-controls summary").click();
  await page.locator("#sky-photos-toggle").uncheck();
  await expect(page.locator(".community-sky-photo img")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("L")).toContain("photos.0");

  const shared = page.url();
  await page.goto(shared);
  await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
  await expect(page.locator(".community-sky-photo img")).toHaveCount(0);
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-photos-toggle")).not.toBeChecked();
});

test("a target list resolves names and positions, corrects a row, plots a layer, and exports a CSV", async ({ page }) => {
  test.setTimeout(120_000);
  await openAtlas(page);
  await openSearchWorkspace(page);
  await page.locator("#target-list-open").click();
  const panel = page.getByRole("dialog", { name: "Target list" });
  await panel.getByLabel("Targets").fill("M 42\nOrion Nebula\nAndromdea\nNebula\n83.82 -5.39\n");
  await panel.getByRole("button", { name: "Match list" }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(5, { timeout: 30_000 });
  const rows = panel.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("Matched");
  await expect(rows.nth(1)).toContainText("Same object as row 1");
  await expect(rows.nth(2)).toContainText("Unmatched");
  await expect(rows.nth(3)).toContainText("Ambiguous");
  await expect(rows.nth(4)).toContainText("arcsec");
  await expect(rows.nth(0)).toContainText("Messier");

  await rows.nth(2).getByRole("textbox").fill("Andromeda Galaxy");
  await rows.nth(2).getByRole("button", { name: "Try again" }).click();
  await expect(rows.nth(2)).toContainText("Matched");

  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("cosmic-atlas-target-list.csv");
  const text = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  expect(text.split("\r\n")[0]).toContain("source,source_url");
  expect(text).toContain("Messier");

  await rows.nth(0).locator("[data-select]").click();
  await expect(panel).toBeHidden();
  await expect(page.locator("#body-info")).toContainText("M42", { timeout: 20_000 });
});

test("the row limit refuses an oversized list with a clear message", async ({ page }) => {
  await openAtlas(page);
  await openSearchWorkspace(page);
  await page.locator("#target-list-open").click();
  const panel = page.getByRole("dialog", { name: "Target list" });
  await panel.getByLabel("Targets").fill(Array.from({ length: 501 }, (_, index) => `NGC ${index + 1}`).join("\n"));
  await panel.getByRole("button", { name: "Match list" }).click();
  await expect(panel.locator(".community-message")).toContainText("The limit is 500");
});
