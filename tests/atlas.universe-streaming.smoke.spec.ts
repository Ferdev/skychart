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
