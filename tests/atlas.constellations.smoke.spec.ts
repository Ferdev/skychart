import { expect, test } from "@playwright/test";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("heliocentric constellation lines toggle, retain missing-star gaps, and replay in links", async ({ page, context }, testInfo) => {
  let constellationRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(() => {
    const state = { segments: 0, colors: [] as string[], labels: [] as string[] };
    (window as typeof window & { constellationDrawing: typeof state }).constellationDrawing = state;
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    const begin = proto.beginPath;
    const line = proto.lineTo;
    const stroke = proto.stroke;
    const text = proto.fillText;
    let segments = 0;
    proto.clearRect = function (...args) {
      if (this.canvas.id === "map") { state.segments = 0; state.labels = []; state.colors = []; }
      return clear.apply(this, args);
    };
    proto.beginPath = function () { segments = 0; return begin.call(this); };
    proto.lineTo = function (...args) { segments += 1; return line.apply(this, args); };
    proto.stroke = function (...args: Parameters<typeof stroke>) {
      if (this.canvas.id === "map" && Math.abs(this.lineWidth - 1.15) < 0.001 && this.globalAlpha === 0.6 && segments > 0) {
        state.segments += segments;
        state.colors.push(String(this.strokeStyle));
      }
      return stroke.apply(this, args);
    };
    proto.fillText = function (...args) {
      if (this.canvas.id === "map") state.labels.push(args[0]);
      return text.apply(this, args);
    };
  });
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture("2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    if (url.pathname === "/api/catalog/viewport") {
      const constellationLoad = url.searchParams.get("groups") === "bright_stars" && url.searchParams.get("limit") === "10000";
      if (constellationLoad) constellationRequests += 1;
      // Only one adjacent Orion edge exists. The absent HIP 26207 must break
      // the path; the isolated HIP 27913 and unrelated stars must be ignored.
      const objects = constellationLoad ? [
        { key: "hip-22449", position: { x_au: -1_000_000, y_au: 0 } },
        { key: "hip-25336", position: { x_au: 1_000_000, y_au: 1_000_000 } },
        { key: "hip-26207", position: { x_au: null, y_au: null } },
        { key: "hip-27913", position: { x_au: 2_000_000, y_au: -1_000_000 } },
        { key: "hip-13209", position: { x_au: -1_000_000, y_au: -1_500_000 } },
        { key: "hip-9884", position: { x_au: 1_000_000, y_au: -2_000_000 } },
        { key: "unrelated-star", position: { x_au: 0, y_au: 0 } },
      ] : [];
      payload = { objects, total: objects.length };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
  const drawing = () => page.evaluate(() => (window as typeof window & {
    constellationDrawing: { segments: number; colors: string[]; labels: string[] };
  }).constellationDrawing);
  await openAtlas(page, "/?v=1&c=0,0&z=0.0001&t=now&L=grid.0~orbits.0~milkyWay.0~references.0");
  const toggle = page.locator('.toolbar-quick-layers input[data-layer="constellations"]');
  await expect(toggle).not.toBeChecked();
  expect(constellationRequests).toBe(0);
  await expect(page.locator("#map-settings")).toBeHidden();
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect.poll(async () => (await drawing()).segments).toBe(2);
  await expect.poll(async () => (await drawing()).labels).toContain("Orion");
  expect(constellationRequests).toBe(1);
  await expect(page).toHaveURL(/constellations.1/);
  const enabledUrl = page.url();
  expect(new Set((await drawing()).colors).size).toBe(2);
  const originalColors = (await drawing()).colors;
  await page.locator("#map-settings-toggle").click();
  await page.locator('[aria-controls="scale-constellations"]').click();
  const orion = page.locator('[data-constellation="orion"]');
  const search = page.locator("#constellation-search");
  await search.fill("orion");
  await expect(page.locator("#constellation-list label:visible")).toHaveCount(1);
  await orion.uncheck();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  await expect.poll(async () => (await drawing()).labels).not.toContain("Orion");
  await expect(page).toHaveURL(/hc=orion/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  await page.locator("#map-settings-toggle").click();
  await page.locator('[aria-controls="scale-constellations"]').click();
  await search.fill("orion");
  await expect(orion).not.toBeChecked();
  await orion.check();
  await expect.poll(async () => (await drawing()).segments).toBe(2);
  expect((await drawing()).colors).toEqual(originalColors);
  await page.locator("#constellations-hide-all").click();
  await expect.poll(async () => (await drawing()).segments).toBe(0);
  await expect(page.locator("#constellation-count")).toHaveText("0 of 87 selected");
  await orion.check();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  await page.keyboard.press("Escape");
  await toggle.uncheck();
  await toggle.check();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  await page.locator("#map-settings-toggle").click();
  await expect(orion).toBeChecked();
  await page.locator("#constellations-show-all").click();
  await expect(page.locator("#constellation-count")).toHaveText("87 of 87 selected");
  await expect.poll(async () => (await drawing()).segments).toBe(2);
  await search.fill("no such constellation");
  await expect(page.locator("#constellation-empty")).toBeVisible();
  await search.fill("bootes");
  await expect(page.locator("#constellation-list label:visible")).toHaveText(["Boötes"]);
  await search.fill("");
  await page.screenshot({ path: testInfo.outputPath("constellation-settings.png") });
  await page.keyboard.press("Escape");
  // Selecting an individual figure also enables the master layer.
  await toggle.uncheck();
  await page.locator("#map-settings-toggle").click();
  await search.fill("orion");
  await orion.uncheck();
  await orion.check();
  await expect(toggle).toBeChecked();
  await page.keyboard.press("Escape");
  expect(constellationRequests).toBe(2); // One request per page load.
  await page.locator('input[data-layer="labels"]').uncheck();
  await expect.poll(async () => (await drawing()).labels).not.toContain("Orion");
  expect((await drawing()).segments).toBe(2);
  await toggle.uncheck();
  await expect.poll(async () => (await drawing()).segments).toBe(0);
  await toggle.check();
  await expect.poll(async () => (await drawing()).segments).toBe(2);
  expect(constellationRequests).toBe(2);
  await toggle.uncheck();
  await expect(page).toHaveURL(/constellations.0/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(toggle).not.toBeChecked();
  expect(constellationRequests).toBe(2);
  await page.goto(enabledUrl, { waitUntil: "domcontentloaded" });
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await drawing()).segments).toBe(2);
  expect(errors).toEqual([]);
});
