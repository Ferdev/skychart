import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable, skyEphemerisFixture } from "./atlas-test-utils";

test("selected objects open and replay a shareable object-centered sky view", async ({ page, request, context }) => {
  await skipIfAtlasUnavailable(request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const methods: string[] = [];
    (window as Window & { __skyShareMethods?: string[] }).__skyShareMethods = methods;
    window.addEventListener("cosmic-atlas:analytics", (event) => {
      const detail = (event as CustomEvent<{ event?: string; method?: string }>).detail;
      if (detail?.event === "share" && detail.method) methods.push(detail.method);
    });
  });
  const issues = collectBrowserIssues(page);
  let skyRequests = 0;
  await context.route(/\/api\/catalog(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] })
  }));
  await context.route("**/api/catalog/search?**", (route) => {
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
  await context.route("**/api/catalog/viewport?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ bounds: {}, limit: 0, total: 0, objects: [] })
  }));
  await context.route("**/api/ephemeris?**", (route) => {
    const timestamp = new URL(route.request().url()).searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(skyEphemerisFixture(timestamp))
    });
  });
  await context.route("**/api/events", (route) => route.fulfill({ status: 202, contentType: "application/json", body: "{}" }));
  await context.route("**/api/now", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ stale: false, refreshed_at: new Date().toISOString(), events: [] })
  }));
  await context.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/api/catalog/sky?**", (route) => {
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

  await page.locator("#sky-map").focus();
  await page.locator("#sky-map").press("ArrowRight");
  await expect.poll(() => new URL(page.url()).searchParams.get("sl")).toBe("0");
  await expect.poll(() => new URL(page.url()).searchParams.get("sf")).toBe("asteroid");

  await expect(page.locator("#sky-share-button")).toHaveAccessibleName("Share this sky");
  await page.locator("#sky-share-button").click();
  await expect(page.locator("#sky-share-popover")).toBeVisible();
  await expect(page.locator("#sky-share-preview")).toHaveAttribute("width", "1200");
  await expect(page.locator("#sky-share-preview")).toHaveAttribute("height", "630");
  await expect.poll(() => page.locator("#sky-share-preview").evaluate((canvas: HTMLCanvasElement) => {
    const pixel = canvas.getContext("2d")!.getImageData(60, 50, 1, 1).data;
    return pixel[0]! + pixel[1]! + pixel[2]!;
  })).toBeGreaterThan(0);

  await page.locator("#sky-copy-link").click();
  await expect(page.locator("#sky-share-status")).toHaveText("Sky viewpoint link copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const copiedUrl = new URL(copied);
  expect(copiedUrl.pathname).toBe("/sky/earth");
  expect(copiedUrl.searchParams.get("t")).not.toBe("now");
  expect(Number.isNaN(Date.parse(copiedUrl.searchParams.get("t") ?? ""))).toBe(false);
  expect(copiedUrl.searchParams.get("sl")).toBe("0");
  expect(copiedUrl.searchParams.get("sf")).toBe("asteroid");
  expect(copiedUrl.searchParams.has("c")).toBe(false);
  expect(copiedUrl.searchParams.has("z")).toBe(false);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#sky-download-card").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^cosmic-atlas-sky-from-earth-\d{4}-\d{2}-\d{2}\.png$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  await expect.poll(() => page.evaluate(() => (window as Window & { __skyShareMethods?: string[] }).__skyShareMethods ?? []))
    .toEqual(expect.arrayContaining(["sky_link", "sky_card"]));

  await page.locator("#sky-share-close").click();
  const replay = await context.newPage();
  const replayIssues = collectBrowserIssues(replay);
  await openAtlas(replay, copied);
  await expect(replay.locator("#sky-view")).toBeVisible();
  await expect(replay.locator("#sky-view-title")).toContainText("Earth");
  await expect(replay.locator("#sky-constellations-toggle")).not.toBeChecked();
  await expect(replay.locator('#sky-object-type-filters input[value="asteroid"]')).not.toBeChecked();
  expect(new URL(replay.url()).searchParams.get("t")).toBe(copiedUrl.searchParams.get("t"));
  expect(new URL(replay.url()).searchParams.get("sc")).toBe(copiedUrl.searchParams.get("sc"));

  await replay.locator("#sky-view-close").click();
  await expect(replay.locator("#sky-view")).toBeHidden();
  await expect.poll(() => new URL(replay.url()).pathname).toBe("/");
  await replay.goBack();
  await expect(replay.locator("#sky-view")).toBeVisible();
  replayIssues.assertClean();
  issues.assertClean();
});
