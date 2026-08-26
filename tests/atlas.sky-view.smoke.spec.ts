import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

test("selected objects open an interactive object-centered sky view", async ({ page, request }) => {
  await skipIfAtlasUnavailable(request);
  const issues = collectBrowserIssues(page);
  let skyRequests = 0;
  await page.route(/\/api\/catalog(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] })
  }));
  await page.route("**/api/catalog/search?**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: url.searchParams.get("q") ?? "",
        groups: [], types: [], offset: 0, limit: 50, total: 0, has_more: false, objects: []
      })
    });
  });
  await page.route("**/api/catalog/viewport?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] })
  }));
  await page.route("**/api/ephemeris?**", (route) => {
    const timestamp = new URL(route.request().url()).searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ephemerisFixture(timestamp))
    });
  });
  await page.route("**/api/events", (route) => route.fulfill({ status: 202, contentType: "application/json", body: "{}" }));
  await page.route("**/api/now", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ stale: false, refreshed_at: new Date().toISOString(), events: [] })
  }));
  await page.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/catalog/sky?**", (route) => {
    skyRequests += 1;
    const url = new URL(route.request().url());
    const observer = {
      x: Number(url.searchParams.get("observer_x_au")),
      y: Number(url.searchParams.get("observer_y_au")),
      z: Number(url.searchParams.get("observer_z_au")),
    };
    const length = Math.hypot(observer.x, observer.y, observer.z) || 1;
    const forward = { x: -observer.x / length, y: -observer.y / length, z: -observer.z / length };
    const tangentLength = Math.hypot(forward.y, forward.x) || 1;
    const tangent = { x: -forward.y / tangentLength, y: forward.x / tangentLength, z: 0 };
    const direction = (offset: number) => {
      const vector = { x: forward.x + tangent.x * offset, y: forward.y + tangent.y * offset, z: forward.z };
      const vectorLength = Math.hypot(vector.x, vector.y, vector.z);
      return { x: vector.x / vectorLength, y: vector.y / vectorLength, z: vector.z / vectorLength };
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        returned: 4,
        points: [{
          key: "hip-22449",
          name: "Orion endpoint A",
          object_type: "star",
          color: "#f8cb65",
          apparent_magnitude: 1,
          direction: direction(-0.12)
        }, {
          key: "hip-25336",
          name: "Orion endpoint B",
          object_type: "star",
          color: "#f8cb65",
          apparent_magnitude: 1.2,
          direction: direction(0)
        }, {
          key: "hip-26207",
          name: "Orion endpoint C",
          object_type: "star",
          color: "#f8cb65",
          apparent_magnitude: 1.4,
          direction: direction(0.12)
        }, {
          key: "fixture-asteroid",
          name: "Fixture Asteroid",
          object_type: "asteroid",
          color: "#c9a27c",
          apparent_magnitude: 3,
          direction: direction(0.2)
        }]
      })
    });
  });

  await openAtlas(page);
  await selectCatalogObject(page, "Earth", "earth", "Earth");
  await expect(page.locator("#view-sky-selected")).toBeEnabled();
  await page.locator("#view-sky-selected").click();

  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-view-title")).toContainText("Earth");
  await expect(page.locator("#sky-view-status")).toContainText("4 catalog directions loaded");
  await expect(page.locator("#sky-map")).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get("sky")).toBe("earth");

  await expect(page.locator("#sky-layer-controls")).toBeVisible();
  await expect(page.locator("#sky-constellations-toggle")).toBeChecked();
  await expect(page.locator('#sky-object-type-filters input[value="planet"]')).toBeChecked();
  const asteroidToggle = page.locator('#sky-object-type-filters input[value="asteroid"]');
  await expect(asteroidToggle).toBeChecked();
  await asteroidToggle.uncheck();
  await expect(asteroidToggle).not.toBeChecked();

  const canvasHash = () => page.locator("#sky-map").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 16) hash = Math.imul(hash ^ pixels[index]!, 16777619);
    return hash >>> 0;
  });
  const withConstellations = await canvasHash();
  await page.locator("#sky-constellations-toggle").uncheck();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(canvasHash).not.toBe(withConstellations);

  await page.locator("#sky-time-forward").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect.poll(() => skyRequests).toBeGreaterThan(1);
  await expect(page.locator("#sky-view-title")).toContainText("Earth");

  await page.locator("#sky-view-close").click();
  await expect(page.locator("#sky-view")).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("sky")).toBe(false);
  issues.assertClean();
});

function ephemerisFixture(timestamp: string) {
  const position = (xAu: number) => ({
    x_au: xAu, y_au: 0, z_au: 0,
    x_km: xAu * 149_597_870.7, y_km: 0, z_km: 0,
    heliocentric_distance_km: Math.abs(xAu) * 149_597_870.7,
  });
  return {
    timestamp_utc: new Date(timestamp).toISOString(),
    generated_at_utc: "2026-08-26T12:00:00.000Z",
    data_source: "Sky view smoke fixture",
    coordinate_frame: "Heliocentric ecliptic Cartesian coordinates",
    au_km: 149_597_870.7,
    catalog: { groups: {}, object_count: 2, group_counts: { core: 2 } },
    bodies: [{
      key: "sun", name: "Sun", radius_km: 695_700, color: "#ffd166",
      object_type: "star", catalog_group: "core", position: position(0),
      distance_from_earth_km: 149_597_870.7,
    }, {
      key: "earth", name: "Earth", radius_km: 6_371, color: "#62a8ff",
      object_type: "planet", parent_key: "sun", catalog_group: "core", position: position(1),
      distance_from_earth_km: 0,
    }],
  };
}
