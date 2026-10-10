import { expect, test, type BrowserContext } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skyEphemerisFixture } from "./atlas-test-utils";

type CatalogRequest = { x: number; local: boolean; at: number };

async function installFixtures(context: BrowserContext, requests: CatalogRequest[]) {
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") {
      const timestamp = url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z";
      const fixture = skyEphemerisFixture(timestamp);
      if (new Date(timestamp).getUTCFullYear() >= 2027) {
        const earth = fixture.bodies.find((body) => body.key === "earth")!;
        earth.position.x_au = 2;
        earth.position.x_km = 2 * fixture.au_km;
        earth.position.heliocentric_distance_km = 2 * fixture.au_km;
      }
      payload = fixture;
    }
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/catalog/sky") {
      const local = url.searchParams.get("local_only") === "1";
      requests.push({ x: Number(url.searchParams.get("observer_x_au")), local, at: Date.now() });
      const discoverNearby = local && requests.filter((request) => request.local).length >= 3;
      const points = !local || discoverNearby ? [{
        key: local ? "new-nearby" : "landmark", name: local ? "New nearby star" : "Distant landmark",
        object_type: "star", position_model: "catalog_coordinates", apparent_magnitude: 4,
        distance_au: local ? 10 : 100_000, direction: { x: 1, y: 0, z: 0 },
      }] : [];
      // A slower response must be allowed to finish while flight continues.
      if (local) await new Promise((resolve) => setTimeout(resolve, 250));
      payload = { points, returned: points.length, nearby_returned: local ? points.length : 0 };
    }
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
}

test("held flight and autopilot keep discovering nearby objects without reloading landmarks", async ({ page, context }) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  const requests: CatalogRequest[] = [];
  await installFixtures(context, requests);
  await openAtlas(page);
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-status")).toHaveText("1 sampled catalog positions loaded");
  await page.locator("#universe-map").focus();
  await page.keyboard.down("w");
  try {
    await expect.poll(() => requests.filter((request) => request.local).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
    await expect(page.locator("#universe-status")).toHaveText("2 sampled catalog positions loaded");
  } finally {
    await page.keyboard.up("w");
  }
  const localRequests = requests.filter((request) => request.local);
  expect(new Set(localRequests.map((request) => request.x)).size).toBeGreaterThanOrEqual(3);
  expect(localRequests[2]!.at - localRequests[1]!.at).toBeGreaterThanOrEqual(1000);

  const beforeAutopilot = requests.length;
  await page.locator("#universe-autopilot").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requests.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(beforeAutopilot + 3);
  await page.locator("#universe-autopilot").click();
  expect(requests.filter((request) => !request.local)).toHaveLength(1);
  issues.assertClean();
});

test("3D URLs and browser history restore the selected object and ephemeris time", async ({ page, context }) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  await installFixtures(context, []);
  const state = new URLSearchParams({
    v: "1", c: "-10,0", z: "20", t: "2026-08-26T12:00:00.000Z", o: "earth", L: "",
    u3: "-10,0,0", u3c: "0,0,72,1", u3t: "earth",
  });
  await openAtlas(page, `/?${state}`);
  await expect(page.locator("#universe-target-name")).toHaveText("Earth");
  await expect(page.locator("#universe-target-meta")).toContainText("11 AU from center");
  const position = await page.locator("#universe-position").textContent();
  const initialUrl = page.url();
  await page.locator("#universe-close").click();
  await expect(page.locator("#universe-view")).toBeHidden();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect(page.locator("#universe-position")).toHaveText(position!);
  await expect(page.locator("#universe-target-name")).toHaveText("Earth");
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#universe-view")).toBeHidden();

  const later = new URL(initialUrl);
  later.searchParams.set("t", "2027-08-26T12:00:00.000Z");
  await page.goto(later.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.locator("#load-state")).toHaveText("ready");
  await expect(page.locator("#universe-position")).toHaveText(position!);
  await expect(page.locator("#universe-target-meta")).toContainText("12 AU from center");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#universe-view")).toBeHidden();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#universe-target-meta")).toContainText("11 AU from center");
  issues.assertClean();
});

test("thrusters accelerate while held and autopilot decelerates into its destination", async ({ page, context }) => {
  test.setTimeout(180_000);
  const issues = collectBrowserIssues(page);
  await installFixtures(context, []);
  const timestamp = "2026-08-26T12:00:00.000Z";
  const state = new URLSearchParams({
    v: "1", c: "-10,0", z: "20", t: timestamp, o: "earth", L: "",
    u3: "-10,0,0", u3c: "90,0,72,1", u3t: "earth",
  });
  await openAtlas(page, `/?${state}`);
  await expect(page.locator("#universe-target-name")).toHaveText("Earth");
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c");
  // The URL is written only after a pause in movement; the trip map carries the live position.
  const position = async () => (await page.locator("#universe-minimap").getAttribute("data-position"))!.split(",").map(Number);
  const earth = skyEphemerisFixture(timestamp).bodies.find((body) => body.key === "earth")!.position;
  const range = ([x, y, z]: number[]) => Math.hypot(x! - earth.x_au, y! - earth.y_au, z! - earth.z_au);

  // Held thrust keeps accelerating and the gauge follows it; frame pacing varies
  // in headless runs, so read the speed readout instead of timing fixed windows.
  const speedAu = async () => {
    const text = await page.locator("#universe-speed").textContent() ?? "";
    return text.includes(" AU/s") ? Number.parseFloat(text) : 0;
  };
  await page.locator("#universe-map").focus();
  await page.keyboard.down("w");
  try {
    await expect.poll(speedAu, { timeout: 30_000 }).toBeGreaterThan(20);
    expect(Number(await page.locator("#universe-speed-gauge").getAttribute("aria-valuenow"))).toBeGreaterThan(0.36);
    await expect(page.locator("#universe-speed-gauge")).toHaveAttribute("data-faster-than-light", "true");
  } finally {
    await page.keyboard.up("w");
  }
  const atRelease = (await position())[1]!;
  expect(atRelease).toBeGreaterThan(0);
  // Release coasts on, then comes to rest; the gauge falls back to zero.
  await expect.poll(async () => (await position())[1]!).toBeGreaterThan(atRelease);
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c", { timeout: 30_000 });
  await expect(page.locator("#universe-speed-gauge")).toHaveAttribute("aria-valuenow", "0.000");

  const startRange = range(await position());
  await page.evaluate(() => {
    const samples: { at: number; u3: string }[] = [];
    (window as Window & { __flightSamples?: typeof samples }).__flightSamples = samples;
    window.setInterval(() => {
      const u3 = document.querySelector<HTMLElement>("#universe-minimap")?.dataset.position ?? "";
      if (samples.at(-1)?.u3 !== u3) samples.push({ at: performance.now(), u3 });
    }, 50);
  });
  await page.locator("#universe-autopilot").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "true");
  // The arrival status is soon replaced by the destination's catalog refresh,
  // so the released autopilot control is the durable arrival signal.
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "false", { timeout: 120_000 });
  const samples = await page.evaluate(() =>
    (window as Window & { __flightSamples?: { at: number; u3: string }[] }).__flightSamples ?? []);
  const ranges = samples.map((sample) => ({ at: sample.at, range: range(sample.u3.split(",").map(Number)) }));
  expect(ranges.length).toBeGreaterThan(8);
  const speeds = ranges.slice(1).map((sample, index) => (ranges[index]!.range - sample.range) / (sample.at - ranges[index]!.at));
  expect(speeds.every((speed) => speed >= 0)).toBe(true);
  const peak = Math.max(...speeds);
  expect(speeds[0]!).toBeLessThan(peak);
  expect(speeds.at(-1)!).toBeLessThan(peak * 0.2);
  const arrivalRange = range(await position());
  expect(arrivalRange).toBeGreaterThan(0);
  expect(arrivalRange).toBeLessThan(startRange * 0.01);
  // Thrusters rescale to the destination: a tap beside Earth is a small step,
  // not the 10 AU-scale push it would be at the departure point.
  await page.locator("#universe-map").press("w");
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c", { timeout: 30_000 });
  expect(range(await position())).toBeLessThan(startRange * 0.01);
  issues.assertClean();
});

test("trip map, light-speed mark, gravity route and the 2D start crosshair", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  const issues = collectBrowserIssues(page);
  await installFixtures(context, []);
  const timestamp = "2026-08-26T12:00:00.000Z";
  await openAtlas(page, `/?${new URLSearchParams({ v: "1", c: "-10,0", z: "20", t: timestamp, o: "earth", L: "" })}`);

  // The 2D crosshair marks the map center, which is where 3D places the observer.
  // The mark shows while the pointer or the focus is on the 3D button.
  const marker = page.locator("#universe-entry-marker");
  await expect(marker).toBeHidden();
  await page.locator("#universe-3d-toggle").hover();
  await expect(marker).toBeVisible();
  const markerBox = (await marker.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(markerBox.x).toBeGreaterThan(0);
  expect(markerBox.x + markerBox.width).toBeLessThan(viewport.width);
  expect(markerBox.y).toBeGreaterThan(0);
  expect(markerBox.y + markerBox.height).toBeLessThan(viewport.height);
  await page.screenshot({ path: testInfo.outputPath("start-crosshair.png") });
  await page.locator("#universe-3d-toggle").click();
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("u3")).toBe("-10,0,0");
  await expect(page.locator("#universe-target-name")).toHaveText("Earth");

  // Trip map: a straight planned route until the gravity route is enabled.
  const minimap = page.locator("#universe-minimap");
  await expect(minimap).toBeVisible();
  await expect(minimap).toHaveAttribute("data-route", "direct");
  await expect(page.locator("#universe-route")).toHaveText("Trip map · top view");
  const inked = await minimap.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) pixels += 1;
    return pixels;
  });
  expect(inked).toBeGreaterThan(100);

  // The speed gauge is a logarithmic indicator; its "c" mark sits at light speed.
  const gauge = page.locator("#universe-speed-gauge");
  await expect(page.locator("#universe-speed")).toHaveText("0 km/s · 0 c");
  await expect(page.locator("#universe-speed-input")).toHaveCount(0);
  const track = (await gauge.boundingBox())!;
  const mark = (await page.locator(".universe-view__light-speed").boundingBox())!;
  const lightSpeedExponent = Math.log10(299_792.458 / 149_597_870.7);
  expect(Math.abs(mark.x - (track.x + track.width * (lightSpeedExponent + 9) / 25))).toBeLessThan(2);
  await expect(page.locator(".universe-view__gauge-tick")).toHaveText(["AU/s", "ly/s", "Mly/s"]);

  // Gravity route: a half orbit of the Sun from 10 AU to Earth, previewed before departure.
  await page.locator("#universe-gravity").click();
  await expect(page.locator("#universe-gravity")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#universe-route")).toHaveText(/^Orbit around Sun · 6\.\d+ yr$/);
  await expect(minimap).toHaveAttribute("data-route", "gravity");
  await page.screenshot({ path: testInfo.outputPath("gravity-route-preview.png") });
  // A 3D selection shows the target card only. The trip map and every flight control must fit a phone screen.
  await expect(page.locator("#selected-object-panel")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("gravity-route-mobile.png") });
  const mobileControlsInsideViewport = await page.locator(".universe-view__flight > *, .universe-view__minimap").evaluateAll((controls) => controls.every((control) => {
    const bounds = control.getBoundingClientRect();
    return bounds.width === 0 || (bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight);
  }));
  expect(mobileControlsInsideViewport).toBe(true);
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    const samples: string[] = [];
    (window as Window & { __routeSamples?: string[] }).__routeSamples = samples;
    window.setInterval(() => {
      const position = document.querySelector<HTMLElement>("#universe-minimap")?.dataset.position ?? "";
      if (samples[samples.length - 1] !== position) samples.push(position);
    }, 50);
  });
  await page.locator("#universe-autopilot").click();
  await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#universe-status")).toHaveText(/^Gravity route to Earth · .+ of 6\.\d+ yr · .+ per second$/, { timeout: 30_000 });
  // On a gravity route the gauge shows the real orbital speed, far below light speed.
  // The speed has no exponent form.
  await expect(page.locator("#universe-speed")).toHaveText(/ km\/s · 0\.0000\d+ c$/);
  await expect(gauge).toHaveAttribute("data-faster-than-light", "false");
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: testInfo.outputPath("gravity-route-flight.png") });
  // Holding forward raises the time compression; it does not leave the orbit.
  await page.locator("#universe-map").focus();
  await page.keyboard.down("w");
  try {
    await expect(page.locator("#universe-autopilot")).toHaveAttribute("aria-pressed", "false", { timeout: 180_000 });
  } finally {
    await page.keyboard.up("w");
  }
  const flown = (await page.evaluate(() => (window as Window & { __routeSamples?: string[] }).__routeSamples ?? []))
    .map((sample) => sample.split(",").map(Number));
  expect(flown.length).toBeGreaterThan(8);
  // A straight flight would stay on the x axis; the orbit swings far around the Sun.
  expect(Math.max(...flown.map(([, y]) => Math.abs(y!)))).toBeGreaterThan(2);
  expect(flown.every(([x, y, z]) => Math.hypot(x!, y!, z!) > 0.9)).toBe(true);
  const [x, y, z] = (await minimap.getAttribute("data-position"))!.split(",").map(Number);
  expect(Math.hypot(x! - 1, y!, z!)).toBeLessThan(0.05);
  await expect(page.locator("#universe-route")).toHaveText(/^Orbit around Sun · 6\.\d+ yr$/);
  expect(Number(await minimap.getAttribute("data-trail-points"))).toBeGreaterThan(8);

  await page.locator("#universe-gravity").click();
  await expect(page.locator("#universe-gravity")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#universe-route")).toHaveText("Trip map · top view");
  issues.assertClean();
});
