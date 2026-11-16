import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("backend_phoenix/priv/spacecraft.json", "utf8"));
const event = { key: "fixture-transit", host_key: "fixture-star", name: "Fixture transit", host_name: "Fixture Star", status: "confirmed", ra_deg: 101.287, dec_deg: -16.716, magnitude: 8, magnitude_band: "V", depth_ppt: 12, duration_hours: 2, epoch: 20, coverage: "partial", ingress_utc: "2026-11-16T00:00:00Z", mid_utc: "2026-11-16T01:00:00Z", egress_utc: "2026-11-16T02:00:00Z", uncertainty_minutes: 4.2, altitude_ingress_deg: 30, altitude_mid_deg: 45, altitude_egress_deg: 35, moon_separation_deg: 60 };
async function fleet(page: Page) {
  await page.route("**/api/spacecraft?**", async route => {
    const timestamp = new URL(route.request().url()).searchParams.get("timestamp")!;
    await route.fulfill({ json: { timestamp_utc: timestamp, bodies: manifest.spacecraft.map((craft: Record<string, unknown>) => ({
      key: craft.key, name: craft.name, object_type: "spacecraft", radius_km: null, color: "#77d9d0", parent_key: "sun",
      distance_from_earth_km: craft.key === "spacecraft-31" ? 299792458 : null,
      position: craft.key === "spacecraft-31" ? { x_au: 1, y_au: 2, z_au: 3, x_km: 1, y_km: 2, z_km: 3, heliocentric_distance_km: 598000000 } : null,
      spacecraft: { ...craft, availability: craft.key === "spacecraft-31" ? "available" : "out_of_coverage", position_epoch: timestamp, heliocentric_speed_km_s: 17, earth_relative_speed_km_s: 42 }
    })) } });
  });
}
async function night(page: Page, enabled: boolean) {
  await page.route("**/api/community/config", route => route.fulfill({ json: { enabled } }));
  await page.route("**/api/community/session", route => route.fulfill({ json: { user: null, csrf: "fixture" } }));
  await page.route("**/api/observe/plan", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { date: request.date, min_altitude_deg: 30, darkness: "astronomical", window: { start_utc: "2026-11-15T18:00:00Z", end_utc: "2026-11-16T06:00:00Z" }, moon: null, total: 0, targets: [], transits: { total: 1, transits: [event] }, accuracy_note: "Fixture" } });
  });
  await page.goto("/tonight?date=2026-11-16&target=fixture-transit");
  await page.getByLabel("Latitude").fill("52.52");
  await page.getByLabel("Longitude").fill("13.405");
  await page.getByRole("button", { name: "Plan the night" }).click();
}

test("public guides load their production entry and fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  for (const path of ["/mcp-guide", "/tonight", "/targets", "/tours/sun-to-survey-field"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("A");
  }
  expect(errors).toEqual([]);
});

test("spacecraft fixtures retain units, epoch and explicit gaps", async ({ page }) => {
  await fleet(page);
  await page.goto("/spacecraft/voyager-1");
  await expect(page.locator("#craft-detail")).toContainText("1,000.000 seconds");
  await expect(page.locator("#craft-detail")).toContainText("17.000 km/s");
  await page.getByLabel("UTC epoch").fill("2026-11-16T12:35");
  await page.getByRole("button", { name: "Load epoch" }).click();
  await expect(page.locator("#craft-detail")).toContainText("2026-11-16T12:35:00.000Z");
  const link = new URL(await page.locator("#craft-detail a").getAttribute("href") ?? "", "http://fixture");
  expect(link.searchParams.get("o")).toBe("spacecraft-31"); expect(link.searchParams.get("t")).toBe("2026-11-16T12:35:00.000Z");
  await page.goto("/spacecraft/voyager-2");
  await expect(page.locator("#craft-detail")).toContainText("Outside trajectory coverage");
  await expect(page.locator("#craft-detail a")).toHaveCount(0);
  await page.goto("/spacecraft");
  await expect(page.locator("tbody tr")).toHaveCount(manifest.spacecraft.length);
  await expect(page.locator('[data-key="spacecraft-31"] [data-distance] a')).toBeVisible();
});

test("tonight share excludes site and sign-in keeps the selected event", async ({ page }) => {
  await night(page, true);
  await expect(page.locator("[data-results]")).toContainText("Fixture transit");
  await expect(page.locator("[data-results]")).toContainText("4.2");
  const share = await page.getByRole("link", { name: "Share this event" }).getAttribute("href");
  expect(share).toBe("/tonight?date=2026-11-16&target=fixture-transit");
  expect(share).not.toContain("52.52");
  await page.route("**/api/community/code", route => route.fulfill({ json: {} }));
  await page.route("**/api/community/verify", route => route.fulfill({ json: { user: { id: "fixture", handle: "fixture", name: "Fixture", role: "user" }, csrf: "fixture" } }));
  await page.getByRole("button", { name: /Record transit/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Sign in");
  await page.getByRole("dialog").locator('input[type="email"]').fill("fixture@example.invalid");
  await page.getByRole("dialog").getByRole("button", { name: "Send code" }).click();
  await page.getByRole("dialog").locator('input[name="code"]').fill("123456");
  await page.getByRole("dialog").locator("form button").click();
  await expect(page.getByRole("dialog")).toContainText("Fixture transit");
  await expect(page.getByRole("dialog").locator('input[type="file"]')).toBeVisible();
});

test("community-off, zero-event and invalid site cases remain clear", async ({ page }) => {
  await night(page, false);
  await expect(page.locator("[data-results]")).toContainText("Record transit is unavailable");
  await expect(page.locator("[data-record]")).toHaveCount(0);
  await page.getByRole("button", { name: "Forget this site" }).click();
  await expect(page.getByLabel("Latitude")).toHaveValue("");
  await expect(page.locator("[data-results]")).toBeEmpty();
  await page.getByLabel("Latitude").fill("91"); await page.getByLabel("Longitude").fill("0");
  await page.getByRole("button", { name: "Plan the night" }).click();
  await expect(page.locator('[role="status"]')).toContainText(/latitude|Latitude/);
});

test("a shared target snapshot restores CSV in a new browser context", async ({ page, browser }) => {
  await page.goto("/targets");
  await page.getByRole("textbox", { name: "Names or RA and Dec" }).fill("M31\nno-such-target-144\nM31\n<script>bad</script>");
  await page.getByRole("button", { name: "Match list" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.locator("tbody")).toContainText("Duplicate of row 1");
  const download1 = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sourced CSV" }).click();
  const csv1 = readFileSync((await (await download1).path())!, "utf8");
  await page.getByRole("button", { name: "Create share link" }).click();
  const share = page.locator("[data-share-result] a"); await expect(share).toBeVisible();
  const href = await share.getAttribute("href");
  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await fresh.newPage();
  const response = await other.goto(href!);
  expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(other.locator("tbody tr")).toHaveCount(4);
  const download2 = other.waitForEvent("download");
  await other.getByRole("button", { name: "Download sourced CSV" }).click();
  expect(readFileSync((await (await download2).path())!, "utf8")).toBe(csv1);
  await other.getByRole("button", { name: "Open matches on the map" }).click();
  await expect(other.locator("#loading-screen")).toBeHidden({ timeout: 45000 });
  await expect(other.locator("#selected-summary-name")).toContainText("Andromeda");
  expect(other.url()).not.toContain("targets=");
  await fresh.close();
});

test("stale night results are discarded and a zero-event UTC day has no old actions", async ({ page }) => {
  await night(page, false);
  await expect(page.locator("[data-results]")).toContainText("Fixture transit");
  await page.getByLabel("UTC date of mid-transit").fill("2026-11-17");
  await expect(page.locator("[data-results]")).toBeEmpty();
  await page.getByRole("button", { name: "Plan the night" }).click();
  await expect(page.locator('[role="status"]')).toContainText(/No transits|no visible event/);
  await expect(page.locator("[data-sky]")).toHaveCount(0);
  await page.route("**/api/observe/plan", async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, body: "unavailable" }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Plan the night" }).click();
  await page.getByLabel("Latitude").fill("0");
  await page.waitForTimeout(400);
  await expect(page.locator("[data-results]")).toBeEmpty();
  await expect(page.locator('[role="status"]')).toBeEmpty();
});

test("transit measurement sends no site and counts one completion", async ({ page }) => {
  const events: Record<string, unknown>[] = [];
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.route("**/api/events", async route => { events.push(route.request().postDataJSON()); await route.continue(); });
  await night(page, false);
  await expect(page.locator("[data-results]")).toContainText("Fixture transit");
  await expect.poll(() => events.filter(e => e.name === "calculation_completed").length).toBe(1);
  expect(JSON.stringify(events)).not.toContain("52.52");
  expect(JSON.stringify(events)).not.toContain("13.405");
  expect(JSON.stringify(events)).not.toContain("fixture-transit");
});

test("survey flight has three stops, source chips, reduced motion and a labeled fallback", async ({ page }) => {
  await fleet(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/survey-image?**", async route => {
    if (route.request().url().includes("legacy-dr11")) return route.fulfill({ status: 503, body: "unavailable" });
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="320"><rect width="512" height="320" fill="#456"/><rect width="256" height="160" fill="#abc"/></svg>' });
  });
  await page.goto("/?tour=sun-to-survey-field&step=0");
  await expect(page.locator("#loading-screen")).toBeHidden({ timeout: 45000 });
  await expect(page.locator("#tour-player h2")).toHaveText("Start at the Sun");
  await page.locator('[data-tour-action="next"]').click();
  await expect(page.locator("#tour-player h2")).toHaveText("Andromeda in the Messier catalog");
  await expect(page.locator('[data-tour-object="m31"]').first()).toBeVisible();
  await page.locator('[data-tour-action="next"]').click();
  await expect(page.locator("#tour-player h2")).toHaveText("3C 273 and the DR11 field");
  await expect(page.locator("#tour-player")).toHaveAttribute("data-motion", "cut");
  await expect(page.locator("[data-survey-flight] figcaption")).toContainText("AllWISE");
  await expect(page.locator("[data-survey-flight]")).toContainText("curated landmark set");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-tour-action="previous"]').click();
  await expect(page.locator("#tour-player h2")).toHaveText("Andromeda in the Messier catalog");
  await expect(page.locator("[data-survey-flight] img")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#tour-player")).toBeHidden();
});
