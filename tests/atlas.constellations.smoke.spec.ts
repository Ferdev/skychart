import { expect, test } from "@playwright/test";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

test("heliocentric constellation lines toggle, retain missing-star gaps, and replay in links", async ({ page, context }) => {
  let constellationRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(() => {
    const state = { segments: 0, labels: [] as string[] };
    (window as typeof window & { constellationDrawing: typeof state }).constellationDrawing = state;
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    const begin = proto.beginPath;
    const line = proto.lineTo;
    const stroke = proto.stroke;
    const text = proto.fillText;
    let segments = 0;
    proto.clearRect = function (...args) {
      if (this.canvas.id === "map") { state.segments = 0; state.labels = []; }
      return clear.apply(this, args);
    };
    proto.beginPath = function () { segments = 0; return begin.call(this); };
    proto.lineTo = function (...args) { segments += 1; return line.apply(this, args); };
    proto.stroke = function (...args: Parameters<typeof stroke>) {
      if (this.canvas.id === "map" && this.strokeStyle === "rgba(248, 203, 101, 0.48)") state.segments += segments;
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
        { key: "unrelated-star", position: { x_au: 0, y_au: 0 } },
      ] : [];
      payload = { objects, total: objects.length };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
  const drawing = () => page.evaluate(() => (window as typeof window & {
    constellationDrawing: { segments: number; labels: string[] };
  }).constellationDrawing);
  await openAtlas(page, "/?v=1&c=0,0&z=0.0001&t=now&L=grid.0~orbits.0~milkyWay.0~references.0");
  const toggle = page.locator('input[data-layer="constellations"]');
  await expect(toggle).not.toBeChecked();
  expect(constellationRequests).toBe(0);
  await expect(page.locator("#map-settings")).toBeHidden();
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  await expect.poll(async () => (await drawing()).labels).toContain("Orion");
  expect(constellationRequests).toBe(1);
  await expect(page).toHaveURL(/constellations.1/);
  const enabledUrl = page.url();
  await page.locator('input[data-layer="labels"]').uncheck();
  await expect.poll(async () => (await drawing()).labels).not.toContain("Orion");
  expect((await drawing()).segments).toBe(1);
  await toggle.uncheck();
  await expect.poll(async () => (await drawing()).segments).toBe(0);
  await toggle.check();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  expect(constellationRequests).toBe(1);
  await toggle.uncheck();
  await expect(page).toHaveURL(/constellations.0/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(toggle).not.toBeChecked();
  expect(constellationRequests).toBe(1);
  await page.goto(enabledUrl, { waitUntil: "domcontentloaded" });
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await drawing()).segments).toBe(1);
  expect(errors).toEqual([]);
});
