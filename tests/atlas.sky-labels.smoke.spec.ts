import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { collectBrowserIssues, openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

const AU_KM = 149_597_870.7;

type LabelRect = { left: number; top: number; right: number; bottom: number };
type SkyLabel = { key: string; name: string; rect: LabelRect };

function fixtureBody(key: string, name: string, objectType: string, xAu: number, yAu: number, group = "core") {
  return {
    key, name, radius_km: 1_000, color: "#d8c9a3", object_type: objectType, catalog_group: group,
    ...(key === "sun" ? {} : { parent_key: "sun" }),
    position: { x_au: xAu, y_au: yAu, z_au: 0, x_km: xAu * AU_KM, y_km: yAu * AU_KM, z_km: 0, heliocentric_distance_km: Math.hypot(xAu, yAu) * AU_KM },
    distance_from_earth_km: Math.hypot(xAu - 1, yAu - 0.3) * AU_KM,
  };
}

/** Mars is the observer at x = 3 AU. The first Sky view looks at the Sun, and the other bodies are near that direction. */
function ephemerisFixture(timestamp: string) {
  return {
    timestamp_utc: new Date(timestamp).toISOString(),
    generated_at_utc: "2026-08-26T12:00:00.000Z",
    data_source: "Sky label fixture",
    coordinate_frame: "Heliocentric ecliptic Cartesian coordinates",
    au_km: AU_KM,
    catalog: { groups: {}, object_count: 7, group_counts: { core: 5, jpl_small_bodies: 2 } },
    bodies: [
      fixtureBody("sun", "Sun", "star", 0, 0),
      fixtureBody("earth", "Earth", "planet", 1, 0.3),
      fixtureBody("venus", "Venus", "planet", 0.7, -0.25),
      fixtureBody("mars", "Mars", "planet", 3, 0),
      fixtureBody("jupiter", "Jupiter", "planet", -5, 1.8),
      fixtureBody("vesta", "Vesta", "asteroid", 0.5, 0.75, "jpl_small_bodies"),
      fixtureBody("jpl-sbdb-2010-bo127", "(2010 BO127)", "asteroid", 0.2, -0.8, "jpl_small_bodies"),
    ],
  };
}

async function routeFixture(context: BrowserContext) {
  const json = (payload: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  await context.route(/\/api\/catalog(?:\?.*)?$/, (route) => route.fulfill(json({ object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] })));
  await context.route("**/api/catalog/search?**", (route) => route.fulfill(json({ query: "", groups: [], types: [], offset: 0, limit: 50, total: 0, has_more: false, objects: [] })));
  await context.route("**/api/catalog/viewport?**", (route) => route.fulfill(json({ bounds: {}, limit: 0, total: 0, objects: [] })));
  await context.route("**/api/ephemeris?**", (route) =>
    route.fulfill(json(ephemerisFixture(new URL(route.request().url()).searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z"))));
  await context.route("**/api/spacecraft?**", (route) => route.fulfill(json({ bodies: [] })));
  await context.route("**/api/events", (route) => route.fulfill({ status: 202, contentType: "application/json", body: "{}" }));
  await context.route("**/api/now", (route) => route.fulfill(json({ stale: false, refreshed_at: new Date().toISOString(), events: [] })));
  await context.route("**/catalog-tiles/v1/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/api/catalog/sky?**", (route) => {
    const url = new URL(route.request().url());
    const observer = { x: Number(url.searchParams.get("observer_x_au")), y: Number(url.searchParams.get("observer_y_au")) };
    const length = Math.hypot(observer.x, observer.y) || 1;
    const forward = { x: -observer.x / length, y: -observer.y / length };
    const tangent = { x: -forward.y, y: forward.x };
    // `across` moves the star to the side of the view, and `up` moves it out of the ecliptic plane.
    const direction = (across: number, up: number) => {
      const vector = { x: forward.x + tangent.x * across, y: forward.y + tangent.y * across, z: up };
      const size = Math.hypot(vector.x, vector.y, vector.z);
      return { x: vector.x / size, y: vector.y / size, z: vector.z / size };
    };
    const star = (key: string, name: string, magnitude: number, across: number, up: number) =>
      ({ key, name, object_type: "star", color: "#f8cb65", apparent_magnitude: magnitude, direction: direction(across, up) });
    return route.fulfill(json({
      returned: 5,
      points: [
        // Three stars of the Orion figure, so that the view has one constellation name.
        star("hip-22449", "Orion endpoint A", 1, -0.22, 0.2),
        star("hip-25336", "Orion endpoint B", 1.2, -0.05, 0.24),
        star("hip-26207", "Orion endpoint C", 1.4, 0.12, 0.2),
        star("hip-80763", "Antares", 1.1, 0.3, -0.25),
        star("hip-10234", "HIP 10234", 2, -0.3, -0.2),
      ],
    }));
  });
}

async function openSkyFromMars(page: Page) {
  // `perf=1` gives the diagnostics that list the drawn labels.
  await openAtlas(page, "/?perf=1");
  await selectCatalogObject(page, "Mars", "mars", "Mars");
  await page.locator("#view-sky-selected").click();
  await expect(page.locator("#sky-view")).toBeVisible();
  await expect(page.locator("#sky-view-status")).toContainText("5");
}

const skyLabels = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.skyLabels() as SkyLabel[]);
const overlap = (a: LabelRect, b: LabelRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test.describe("Sky view labels, layers, and header", () => {
  test.beforeEach(async ({ request, context }) => {
    await skipIfAtlasUnavailable(request);
    await routeFixture(context);
  });

  test("the Sun and the planets get labels first, and no catalog code or small body shows at the default field of view", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await openSkyFromMars(page);
    await expect.poll(async () => (await skyLabels(page)).map((label) => label.name)).toContain("Antares");
    const labels = await skyLabels(page);
    const names = labels.map((label) => label.name);

    for (const major of ["Sun", "Earth", "Venus", "Jupiter"]) expect(names, `${major} must have a label`).toContain(major);
    const lastMajor = Math.max(...["Sun", "Earth", "Venus", "Jupiter"].map((name) => names.indexOf(name)));
    expect(lastMajor, "the Sun and the planets are drawn before a star").toBeLessThan(names.indexOf("Antares"));
    for (const hidden of ["Vesta", "(2010 BO127)", "HIP 10234"]) expect(names, `${hidden} must have no label at 72 degrees`).not.toContain(hidden);
    expect(names, "the observer is not in its own sky").not.toContain("Mars");

    // One occupancy list: no object label and no constellation name is on a different label.
    expect(labels.some((label) => label.key.startsWith("constellation:")), "a constellation name must be in the view").toBe(true);
    for (let first = 0; first < labels.length; first += 1) {
      for (let second = first + 1; second < labels.length; second += 1) {
        expect(overlap(labels[first]!.rect, labels[second]!.rect), `${labels[first]!.name} and ${labels[second]!.name} overlap`).toBe(false);
      }
    }
    // The labels stay below the header and above the footer text.
    const header = (await page.locator(".sky-view__header").boundingBox())!;
    for (const label of labels) expect(label.rect.top, `${label.name} is below the header`).toBeGreaterThanOrEqual(header.y + header.height - 1);
    issues.assertClean();
  });

  test("the layer list has no row with a count of zero, keeps a hidden type, and fits the window", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 520 });
    await openSkyFromMars(page);
    const panel = page.locator("#sky-layer-controls");
    await panel.locator("summary").click();
    await expect(panel).toHaveAttribute("open", "");

    const rows = page.locator("#sky-object-type-filters .sky-view__filter");
    await expect(rows.first()).toBeVisible();
    const rowTexts = await rows.evaluateAll((elements) => elements.map((element) => ({
      type: element.querySelector("input")!.value,
      label: element.querySelector("span")!.textContent,
      count: element.querySelector(".sky-view__filter-count")!.textContent,
    })));
    expect(rowTexts.map((row) => row.type).sort()).toEqual(["asteroid", "planet", "star"]);
    for (const row of rowTexts) expect(row.count, `${row.type} count`).not.toBe("0");
    // The rows use the plural type names.
    expect(rowTexts.find((row) => row.type === "planet")!.label).toBe("Planets");
    expect(rowTexts.find((row) => row.type === "asteroid")!.label).toBe("Asteroids");

    // A type that the user hid stays in the list, so that the user can show it again.
    await page.locator('#sky-object-type-filters input[value="asteroid"]').uncheck();
    await expect(page.locator('#sky-object-type-filters input[value="asteroid"]')).toHaveCount(1);
    await expect(page.locator('#sky-object-type-filters input[value="asteroid"]')).not.toBeChecked();

    // The panel uses the available height and scrolls inside: it does not go below the window.
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(520);
  });

  test("Share this sky is a secondary button, and the status line takes no room when it is empty", async ({ page }) => {
    await openSkyFromMars(page);
    const colors = async (selector: string) => page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
    // The exit button is the main (gold) control. Share has the outline style.
    expect(await colors("#sky-view-close")).not.toBe(await colors("#sky-share-button"));
    expect(await colors("#sky-share-button")).toBe(await colors("#sky-view-reset"));
    await page.locator("#sky-share-button").click();
    await expect(page.locator("#sky-share-popover")).toBeVisible();
    await expect(page.locator("#sky-share-status")).toBeEmpty();
    expect(await page.locator("#sky-share-status").evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
    // No empty column: the visible buttons use the full width of the row.
    const actions = (await page.locator(".sky-share__actions").boundingBox())!;
    const buttons = await page.locator(".sky-share__actions button:visible").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
    expect(Math.max(...buttons)).toBeGreaterThan(actions.x + actions.width - 4);
  });
});

test.describe("Sky view on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the header is one row of 64 px or less with back, title, time bar, and More", async ({ page, request, context }) => {
    await skipIfAtlasUnavailable(request);
    await routeFixture(context);
    await openSkyFromMars(page);

    const header = (await page.locator(".sky-view__header").boundingBox())!;
    expect(header.height).toBeLessThanOrEqual(64);
    const controls = ["#sky-view-close", "#sky-view-title", "#sky-time-back", "#time-date-sky, #sky-time-bar .time-bar__date", "#sky-time-forward", "#sky-more-button"];
    let previousRight = 0;
    for (const selector of controls) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y, `${selector} is in the header row`).toBeGreaterThanOrEqual(header.y);
      expect(box!.y + box!.height, `${selector} is in the header row`).toBeLessThanOrEqual(header.y + header.height + 1);
      expect(box!.x, `${selector} comes after the control before it`).toBeGreaterThanOrEqual(previousRight - 1);
      previousRight = box!.x + box!.width;
    }
    expect(previousRight).toBeLessThanOrEqual(390);
    for (const selector of ["#sky-view-close", "#sky-time-back", "#sky-time-forward", "#sky-more-button"]) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(Math.min(box.width, box.height), `${selector} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }

    // Share and Reset are in the More menu.
    await expect(page.locator("#sky-share-button")).toBeHidden();
    await page.locator("#sky-more-button").tap();
    await expect(page.locator("#sky-more-button")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#sky-share-button")).toBeVisible();
    await expect(page.locator("#sky-view-reset")).toBeVisible();
    await page.locator("#sky-view-reset").tap();
    await expect(page.locator("#sky-more-button")).toHaveAttribute("aria-expanded", "false");

    // Fewer labels on a narrow window.
    expect((await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.skyLabels())).filter((label) => !label.key.startsWith("constellation:")).length).toBeLessThanOrEqual(12);

    // The exit button goes back to the map.
    await page.locator("#sky-view-close").tap();
    await expect(page.locator("#sky-view")).toBeHidden();
  });
});
