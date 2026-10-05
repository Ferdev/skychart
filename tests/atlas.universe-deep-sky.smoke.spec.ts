import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, serveSourceModules, skyEphemerisFixture } from "./atlas-test-utils";

test("guided deep-sky highlights become navigable 3D volumes", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const issues = collectBrowserIssues(page);
  const auKm = 149_597_870.7;
  const objects = [
    { key: "m31", name: "M31 Andromeda Galaxy", object_type: "galaxy", x: -100, y: 0, z: 0, radius: 10, color: "#d9b86f" },
    { key: "m42", name: "M42 Orion Nebula", object_type: "nebula", x: -100, y: 25, z: 0, radius: 5, color: "#d79bdc" },
    { key: "m45", name: "M45 Pleiades", object_type: "star_cluster", x: -100, y: -25, z: 0, radius: 5, color: "#9ec8ff" },
    { key: "simbad-3c-273", name: "3C 273", object_type: "active_galaxy", x: -1e12, y: 0, z: 0, radius: 0, color: "#b7b5ff" },
  ];
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = {};
    if (url.pathname === "/api/ephemeris") payload = skyEphemerisFixture(url.searchParams.get("timestamp") ?? "2026-08-26T12:00:00.000Z");
    if (url.pathname === "/api/catalog") payload = { object_count: 0, group_counts: {}, type_counts: {}, available_groups: [] };
    if (url.pathname === "/api/catalog/viewport") payload = { objects: [], total: 0 };
    if (url.pathname === "/api/catalog/search") payload = { objects: [], total: 0, has_more: false };
    if (url.pathname === "/api/catalog/sky") {
      if (url.searchParams.get("local_only") !== "1") expect(url.searchParams.get("featured_keys")).toContain("m31");
      const observer = { x: Number(url.searchParams.get("observer_x_au")),
        y: Number(url.searchParams.get("observer_y_au")), z: Number(url.searchParams.get("observer_z_au")) };
      payload = { nearby_returned: 0, points: objects.map((object) => {
        const delta = { x: object.x - observer.x, y: object.y - observer.y, z: object.z - observer.z };
        const distance = Math.hypot(delta.x, delta.y, delta.z);
        return { key: object.key, name: object.name, object_type: object.object_type,
          position_model: "deep_sky_catalog_coordinates", catalog_group: "messier_deep_sky",
          color: object.color, apparent_magnitude: 4, radius_km: object.radius * auKm,
          distance_au: distance,
          direction: { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance } };
      }) };
    }
    if (url.pathname === "/api/spacecraft") payload = { bodies: [] };
    if (url.pathname === "/api/now") payload = { events: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await context.route("**/catalog-tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
  await serveSourceModules(page);

  const state = new URLSearchParams({
    v: "1", c: "-40,0", z: "1000000", t: "2026-08-26T12:00:00.000Z", L: "",
    u3: "-40,0,0", u3c: "180,0,72,1", u3t: "m31",
  });
  await openAtlas(page, `/?${state}`);
  await expect(page.locator("#universe-view")).toBeVisible();
  await expect.poll(() => page.locator("#universe-deep-sky").getAttribute("data-visible-objects"))
    .toContain("m31");
  await expect.poll(async () => Number(await page.locator("#universe-deep-sky").getAttribute("data-particle-count")))
    .toBeGreaterThan(1_000);
  await expect(page.locator("#universe-target-meta")).toContainText("3D structure illustrative");
  const coverage = await page.evaluate(async (auKm) => {
    const { GUIDED_DEEP_SKY_KEYS } = await import("/src/atlas/atlasDefinitions.ts");
    const { deepSkyModel, makeDeepSkyCloud } = await import("/src/universe/universeDeepSkyModel.ts");
    return GUIDED_DEEP_SKY_KEYS.map((key) => {
      const object_type = ["m1", "m8", "m17", "m20", "m42", "m57"].includes(key) ? "nebula"
        : ["m13", "m16", "m45"].includes(key) ? "star_cluster"
          : key.startsWith("simbad-") ? "active_galaxy" : "galaxy";
      const model = deepSkyModel({ key, object_type, position: { x: 1, y: 0, z: 0 },
        radiusKm: key.startsWith("simbad-3c-") ? 0 : auKm });
      const cloud = model ? makeDeepSkyCloud(key, model.kind) : [];
      const depth = cloud.length ? Math.max(...cloud.map((particle) => particle.z))
        - Math.min(...cloud.map((particle) => particle.z)) : 0;
      return { key, hasModel: Boolean(model), depth };
    });
  }, auKm);
  expect(coverage).toHaveLength(19);
  expect(coverage.every((item) => item.hasModel && item.depth > 0.1)).toBe(true);
  // Forms are not limited to the guided highlights: any deep-sky object with a
  // catalog morphology and a derived size gets one. M55 is a globular cluster.
  const kinds = await page.evaluate(async (auKm) => {
    const { deepSkyModel } = await import("/src/universe/universeDeepSkyModel.ts");
    const kind = (key: string, object_type: string, radiusKm: number, deepSkyType?: string) =>
      deepSkyModel({ key, object_type, position: { x: 1, y: 0, z: 0 }, radiusKm, deepSkyType })?.kind ?? null;
    return {
      m55: kind("m55", "star_cluster", auKm), m55Unsized: kind("m55", "star_cluster", 0),
      m13: kind("m13", "star_cluster", auKm), m45: kind("m45", "star_cluster", auKm), m11: kind("m11", "star_cluster", auKm),
      m104: kind("m104", "galaxy", auKm), m49: kind("m49", "galaxy", auKm), m27: kind("m27", "nebula", auKm),
      m40: kind("m40", "asterism", auKm),
      ngcGlobular: kind("ngc-104", "star_cluster", auKm, "GCl"), ngcUntyped: kind("ngc-104", "star_cluster", auKm),
      ngcPair: kind("ngc-1", "galaxy", auKm, "GPair"), unsizedActive: kind("simbad-x", "active_galaxy", 0),
    };
  }, auKm);
  expect(kinds).toEqual({
    m55: "globular", m55Unsized: null, m13: "globular", m45: "open", m11: "open", m104: "spiral", m49: "elliptical", m27: "ring",
    m40: null, ngcGlobular: "globular", ngcUntyped: null, ngcPair: null, unsizedActive: null,
  });
  await page.screenshot({ path: testInfo.outputPath("guided-deep-sky.png") });

  const positionBefore = await page.locator("#universe-position").textContent();
  await page.locator("#universe-focus").click();
  await expect(page.locator("#universe-position")).not.toHaveText(positionBefore!);
  await expect.poll(async () => Number(await page.locator("#universe-deep-sky").getAttribute("data-particle-count")))
    .toBeGreaterThan(1_000);

  const activeObserver = -1e12 + 3 * 50_000 * 63_241.077;
  state.set("u3", `${activeObserver},0,0`);
  state.set("u3t", "simbad-3c-273");
  await openAtlas(page, `/?${state}`);
  await expect.poll(() => page.locator("#universe-deep-sky").getAttribute("data-visible-objects"))
    .toContain("simbad-3c-273");
  await expect(page.locator("#universe-target-meta")).toContainText("structure and size schematic");
  await page.screenshot({ path: testInfo.outputPath("schematic-active-galaxy.png") });
  issues.assertClean();
});
