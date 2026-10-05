import { expect, test } from "@playwright/test";
import { openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

const POINT_COUNT = 12_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
test.use({ video: "off", trace: "off", screenshot: "off" });

test("3D flight stays responsive with a full catalog sample", async ({ page, context }) => {
  test.setTimeout(180_000);
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
    if (url.pathname === "/api/catalog/sky") payload = url.searchParams.has("local_only")
      ? { returned: 0, nearby_returned: 0, points: [] }
      : { returned: POINT_COUNT, nearby_returned: 0, points };
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));

  await openAtlas(page, "/?perf=1");
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-status")).toHaveText(`${POINT_COUNT} sampled catalog positions loaded`, { timeout: 45_000 });
  const sharedUrl = new URL(page.url());
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ returned: POINT_COUNT, nearby_returned: 0, points })).length;
  for (const scene of [
    { label: "Solar System", position: "1,0,0", step: "1" },
    { label: "local stars", position: "63241,0,0", step: "1000" },
    { label: "Galactic", position: "63241000000,0,0", step: "10000000" },
    { label: "extragalactic", position: "63241000000000000,0,0", step: "10000000000000" },
  ]) {
    const sceneUrl = new URL(sharedUrl);
    sceneUrl.searchParams.set("u3", scene.position);
    sceneUrl.searchParams.set("u3c", `180,0,72,${scene.step}`);
    sceneUrl.searchParams.delete("u3t");
    sceneUrl.searchParams.delete("o");
    await page.goto(sceneUrl.toString(), { waitUntil: "domcontentloaded" });
    await expect(page.locator("#load-state")).toHaveText("ready", { timeout: 45_000 });
    // Cold texture uploads and software-WebGL setup are outside the flight
    // sample; use the same readiness allowance as the initial atlas load.
    await expect(page.locator("#universe-status")).toHaveText(`${POINT_COUNT} sampled catalog positions loaded`, { timeout: 45_000 });
    await page.waitForTimeout(250);
    await page.evaluate(() => { (window as Window & { __universePerf?: unknown[] }).__universePerf = []; });
    const initialPosition = await page.locator("#universe-position").textContent();
    await page.locator("#universe-map").focus();
    await page.keyboard.down("w");
    await page.waitForTimeout(1500);
    const samples = await page.evaluate(() =>
      (window as Window & { __universePerf?: Array<{ base: number; points: number; labels: number; webgl: boolean }> }).__universePerf ?? []);
    await page.keyboard.up("w");
    await expect(page.locator("#universe-position")).not.toHaveText(initialPosition!);
    expect(samples.length, `${scene.label} rendered frames`).toBeGreaterThanOrEqual(2);
    const durations = samples.map((sample) => sample.points).sort((left, right) => left - right);
    const p75 = durations[Math.floor((durations.length - 1) * 0.75)]!;
    const totals = samples.map((sample) => sample.base + sample.points + sample.labels).sort((left, right) => left - right);
    const totalP75 = totals[Math.floor((totals.length - 1) * 0.75)]!;
    const metrics = await page.evaluate(() => ({
      queryMs: performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/api/catalog/sky?") && !entry.name.includes("local_only="))[0]?.duration ?? 0,
      heapMb: ((performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6,
    }));
    console.log(`${scene.label}: ${(samples.length / 1.5).toFixed(1)} measured frames/s, ${POINT_COUNT} synthetic points, ${payloadBytes} response bytes, query ${metrics.queryMs.toFixed(1)} ms, heap ${metrics.heapMb.toFixed(1)} MB, p75 point CPU ${p75.toFixed(1)} ms, p75 total CPU ${totalP75.toFixed(1)} ms`);
    expect(p75).toBeLessThan(40);
  }
});
