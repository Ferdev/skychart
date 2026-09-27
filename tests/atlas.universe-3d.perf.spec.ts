import { expect, test } from "@playwright/test";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

const POINT_COUNT = 12_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
test.use({ video: "off", trace: "off", screenshot: "off" });

test("3D flight stays responsive with a full catalog sample", async ({ page, context }) => {
  const points = Array.from({ length: POINT_COUNT }, (_, index) => {
    const y = 1 - 2 * (index + 0.5) / POINT_COUNT;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * GOLDEN_ANGLE;
    return {
      key: `perf-star-${index}`, name: `Star ${index}`, object_type: "star",
      color: "#e4c98d", apparent_magnitude: 10,
      distance_au: 10_000 + index * 100,
      direction: { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: y },
    };
  });
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture("2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/catalog/sky") payload = { returned: POINT_COUNT, points };
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));

  await openAtlas(page, "/?perf=1");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-status")).toHaveText(`${POINT_COUNT} sampled catalog positions loaded`);
  await page.evaluate(() => { (window as Window & { __universePerf?: unknown[] }).__universePerf = []; });
  const initialPosition = await page.locator("#universe-position").textContent();
  await page.locator("#universe-map").focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(1200);
  const samples = await page.evaluate(() =>
    (window as Window & { __universePerf?: Array<{ points: number; webgl: boolean }> }).__universePerf ?? []);
  await page.keyboard.up("w");
  await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
  expect(samples.length).toBeGreaterThanOrEqual(4);
  const durations = samples.map((sample) => sample.points).sort((left, right) => left - right);
  const p75 = durations[Math.floor((durations.length - 1) * 0.75)]!;
  console.log(`3D motion: ${samples.length} frames, ${POINT_COUNT} loaded points, p75 point-render CPU ${p75.toFixed(1)} ms`);
  expect(p75).toBeLessThan(40);
});
