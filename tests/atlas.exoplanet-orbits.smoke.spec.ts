import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ATLAS_BASE_URL, collectBrowserIssues, openAtlas, selectCatalogObject, serveSourceModules, skipIfAtlasUnavailable } from "./atlas-test-utils";

type ScreenPoint = { x: number; y: number };
type Ring = {
  key: string;
  displayState: string;
  marker: string;
  phaseUncertaintyOrbits: number | null;
  semiMajorAxisAu: number | null;
  host: ScreenPoint;
  position: ScreenPoint;
};
type CatalogObject = {
  key: string;
  position: { x_au: number; y_au: number; z_au: number };
  position_model: string;
  facts: Record<string, unknown>;
};

// The inspector asks third-party hosts for a survey image of each selected object. A fixture keeps these tests
// independent of those hosts.
const SURVEY_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC",
  "base64"
);
const ATLAS_TIME = "2026-10-08T12:00:00.000Z";
const LAYERS = "labels.1~orbits.1~grid.1";
const TRAPPIST_PLANETS = ["b", "c", "d", "e", "f", "g", "h"].map((letter) => `exoplanet-trappist-1-${letter}`);
const HR_8799_PLANETS = ["b", "c", "d", "e"].map((letter) => `exoplanet-hr-8799-${letter}`);

async function catalogObject(request: APIRequestContext, key: string): Promise<CatalogObject> {
  const response = await request.get(`/api/objects/${key}`);
  expect(response.ok(), `catalog object ${key}`).toBe(true);
  return (await response.json()).object as CatalogObject;
}

function viewUrl(center: { x_au: number; y_au: number }, pxPerAu: number, extra = "") {
  return `/?v=1&c=${center.x_au},${center.y_au}&z=${pxPerAu}&t=${encodeURIComponent(ATLAS_TIME)}&L=${LAYERS}&perf=1${extra}`;
}

const rings = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.exoplanetOrbits() as Ring[]);
const visibleKeys = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.visibleBodyKeys());
const labelKeys = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.labelBodyKeys());
const camera = (page: Page) => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry().camera);

async function waitForRings(page: Page, keys: readonly string[]) {
  await expect.poll(async () => (await rings(page)).map((ring) => ring.key).sort(), { timeout: 30_000 }).toEqual([...keys].sort());
}

/** Counts overlay pixels with the blue of an exoplanet ring or marker. Grid lines and labels are neutral. */
function ringPixelCount(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3]! > 40 && pixels[offset + 2]! - pixels[offset]! > 30 && pixels[offset + 1]! - pixels[offset]! > 15) count += 1;
    }
    return count;
  });
}

async function openScienceView(page: Page) {
  await page.locator('#body-info [data-object-view="science"]').click();
  await expect(page.locator("#body-info .exoplanet-orbit")).toBeVisible();
}

test.describe("exoplanet orbits on the 2D map", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.route("**/api/survey-image?**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: SURVEY_IMAGE }));
    const planet = await request.get("/api/objects/exoplanet-trappist-1-e");
    const model = planet.ok() ? (await planet.json()).object?.position_model : null;
    test.skip(model !== "exoplanet_archive_host_relative_orbit", "The catalog under test has no exoplanet orbit facts (snapshot schema 2).");
  });

  test("search finds a planet and the system view shows seven rings and seven separate markers", async ({ page }) => {
    const issues = collectBrowserIssues(page);
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "TRAPPIST-1 e", "exoplanet-trappist-1-e", "TRAPPIST-1 e");
    await page.locator("#body-info [data-planetary-system]").click();
    await waitForRings(page, TRAPPIST_PLANETS);
    // The camera animation is complete when the largest orbit fits the view.
    await expect.poll(async () => (await camera(page)).pxPerAu, { timeout: 20_000 }).toBeGreaterThan(1_000);
    await expect.poll(async () => {
      const first = (await camera(page)).pxPerAu;
      await page.waitForTimeout(250);
      return Math.abs((await camera(page)).pxPerAu - first);
    }, { timeout: 20_000 }).toBe(0);

    const state = await rings(page);
    const { pxPerAu } = await camera(page);
    const visible = await visibleKeys(page);
    const viewport = page.viewportSize()!;
    for (const ring of state) {
      expect(ring.displayState, ring.key).toBe("position");
      expect(ring.marker, ring.key).toBe("solid");
      expect(visible, "each planet has a marker").toContain(ring.key);
      // TRAPPIST-1 is near the ecliptic and its orbits are near-circular, so
      // each marker is at its orbit radius from the star on the top-down map.
      const radiusPx = Math.hypot(ring.position.x - ring.host.x, ring.position.y - ring.host.y);
      expect(radiusPx / (ring.semiMajorAxisAu! * pxPerAu), ring.key).toBeGreaterThan(0.97);
      expect(radiusPx / (ring.semiMajorAxisAu! * pxPerAu), ring.key).toBeLessThan(1.03);
      expect(radiusPx, "the planet is apart from its star").toBeGreaterThan(20);
    }
    for (let left = 0; left < state.length; left += 1) {
      for (let right = left + 1; right < state.length; right += 1) {
        const separation = Math.hypot(state[left]!.position.x - state[right]!.position.x, state[left]!.position.y - state[right]!.position.y);
        expect(separation, `${state[left]!.key} and ${state[right]!.key} are separate`).toBeGreaterThan(6);
      }
    }
    const largestPx = Math.max(...state.map((ring) => ring.semiMajorAxisAu! * pxPerAu));
    expect(largestPx * 2, "the largest orbit fits the view with a margin").toBeLessThan(Math.min(viewport.width, viewport.height));
    expect(largestPx * 2).toBeGreaterThan(Math.min(viewport.width, viewport.height) * 0.4);

    // One star marker for the host, with its label.
    expect(visible).toContain("exosys-trappist-1");
    expect(await labelKeys(page)).toContain("exosys-trappist-1");

    // The rings are on the canvas. They go away with the orbits layer.
    const withRings = await ringPixelCount(page);
    expect(withRings).toBeGreaterThan(800);
    await page.evaluate(() => document.querySelector<HTMLInputElement>('input[data-layer="orbits"]')!.click());
    await expect(page.locator("#exoplanet-orbit-note")).toBeHidden();
    await expect.poll(() => ringPixelCount(page)).toBeLessThan(withRings * 0.4);
    issues.assertClean();
  });

  test("a one-day time step moves each planet by one day of its period", async ({ page, request }) => {
    const host = await catalogObject(request, "exosys-trappist-1");
    const viewportGroups = new Set<string>();
    page.on("request", (viewportRequest) => {
      const url = new URL(viewportRequest.url());
      if (url.pathname === "/api/catalog/viewport") viewportGroups.add(url.searchParams.get("groups") ?? "");
    });
    await openAtlas(page, viewUrl(host.position, 5_200));
    await waitForRings(page, TRAPPIST_PLANETS);
    // Far from the Sun, a system-scale view asks for the hosts and their planets, not for small bodies.
    expect([...viewportGroups]).toContain("exoplanet_systems,exoplanets,exoplanet_candidate_hosts,exoplanet_candidates");
    // The map says that the ring direction is a convention. The toolbar covers the canvas line here, so the page shows it.
    await expect(page.locator("#exoplanet-orbit-note")).toBeVisible();
    await expect(page.locator("#exoplanet-orbit-note")).toContainText("display convention");
    const before = await rings(page);

    await page.evaluate(() => {
      const slider = document.querySelector<HTMLInputElement>("#time-step-slider")!;
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#time-step-forward")!.click();
    });
    await expect.poll(async () => {
      const now = await rings(page);
      const moved = now.find((ring) => ring.key === "exoplanet-trappist-1-b");
      const start = before.find((ring) => ring.key === "exoplanet-trappist-1-b")!;
      return moved ? Math.hypot(moved.position.x - start.position.x, moved.position.y - start.position.y) : 0;
    }, { timeout: 30_000 }).toBeGreaterThan(20);
    await waitForRings(page, TRAPPIST_PLANETS);
    const after = await rings(page);

    // The angle from the node, from the map position. `n` is the node
    // direction and `s` the direction from the Sun, in the map plane.
    const length = Math.hypot(host.position.x_au, host.position.y_au);
    const s = { x: host.position.x_au / length, y: host.position.y_au / length };
    const n = { x: -s.y, y: s.x };
    const angleFromNode = (ring: Ring) => {
      const offset = { x: ring.position.x - ring.host.x, y: -(ring.position.y - ring.host.y) };
      return Math.atan2(-(offset.x * s.x + offset.y * s.y), offset.x * n.x + offset.y * n.y);
    };
    for (const key of TRAPPIST_PLANETS) {
      const planet = await catalogObject(request, key);
      const periodDays = planet.facts.ephemeris_period_days as number;
      const start = before.find((ring) => ring.key === key)!;
      const end = after.find((ring) => ring.key === key)!;
      const expected = ((2 * Math.PI) / periodDays) % (2 * Math.PI);
      const moved = (((angleFromNode(end) - angleFromNode(start)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const error = Math.abs(((moved - expected + Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(error, `${key} moves ${(expected * 180 / Math.PI).toFixed(1)} degrees in one day`).toBeLessThan(3 * Math.PI / 180);
      const startRadius = Math.hypot(start.position.x - start.host.x, start.position.y - start.host.y);
      const endRadius = Math.hypot(end.position.x - end.host.x, end.position.y - end.host.y);
      expect(Math.abs(endRadius - startRadius) / startRadius, `${key} stays on its ring`).toBeLessThan(0.03);
    }
  });

  test("a planet with no timing has a ring, no marker, and a reason in the inspector", async ({ page, request }) => {
    const planet = await catalogObject(request, "exoplanet-hr-8799-b");
    expect(planet.facts.orbit_display_state).toBe("orbit_only");
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "HR 8799 b", "exoplanet-hr-8799-b", "HR 8799 b");
    await page.locator("#body-info [data-planetary-system]").click();
    await waitForRings(page, HR_8799_PLANETS);
    const state = await rings(page);
    for (const ring of state) {
      expect(ring.displayState, ring.key).toBe("orbit_only");
      expect(ring.marker, ring.key).toBe("none");
      expect(Math.hypot(ring.position.x - ring.host.x, ring.position.y - ring.host.y), "no invented position").toBe(0);
    }
    // Only the selected planet stays in the body list, and it has no marker on its resolved ring.
    const visible = await visibleKeys(page);
    expect(visible.filter((key) => key.startsWith("exoplanet-"))).toEqual(["exoplanet-hr-8799-b"]);
    // Nothing marks a position for this planet: the inspector connector does not point at the star.
    await expect(page.locator("#selection-connector")).toBeHidden();

    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toHaveAttribute("data-exoplanet-state", "orbit_only");
    await expect(section).toHaveAttribute("data-exoplanet-marker", "none");
    await expect(section).toContainText("The archive gives no usable timing");
    await expect(section).toContainText("Orbit size (semi-major axis)");
    await expect(section).toContainText("Orbit direction: the archive gives no node angle");
  });

  test("a planet with no orbit size has no ring and the inspector says so", async ({ page, request }) => {
    const planet = await catalogObject(request, "exoplanet-gaia-4-b");
    expect(planet.facts.orbit_display_state).toBe("none");
    expect(planet.position_model).toBe("exoplanet_archive_host_coordinates");
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "Gaia-4 b", "exoplanet-gaia-4-b", "Gaia-4 b");
    await expect(page.locator("#body-info [data-planetary-system]")).toHaveCount(0);
    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toHaveAttribute("data-exoplanet-state", "none");
    await expect(section).toContainText("The archive gives no orbit size");
    expect((await rings(page)).map((ring) => ring.key)).not.toContain("exoplanet-gaia-4-b");
    await expect(page.locator("#exoplanet-orbit-note")).toBeHidden();
  });

  test("the inspector shows the orbit values, the flags, and the reference of a planet", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "TRAPPIST-1 e", "exoplanet-trappist-1-e", "TRAPPIST-1 e");
    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toHaveAttribute("data-exoplanet-state", "position");
    await expect(section).toContainText("Calculated for the atlas time");
    await expect(section).toContainText("Conjunction time");
    await expect(section).toContainText("BJD-TDB");
    await expect(section).toContainText("Phase uncertainty (1 sigma)");
    await expect(section).toContainText("Transit timing variations");
    await expect(section).toContainText("Orbit direction: the archive gives no node angle");
    await expect(section.locator('a[href^="https://ui.adsabs.harvard.edu/"]').first()).toBeVisible();
    // The inclination of this planet is measured, so the edge-on convention is not in use.
    await expect(section).not.toContainText("Inclination: not measured");
  });

  test("a radial-velocity planet shows its minimum mass and the archive-calculated radius", async ({ page, request }) => {
    const planet = await catalogObject(request, "exoplanet-proxima-cen-b");
    test.skip(planet.facts.minimum_mass !== true, "The archive no longer gives a minimum mass for this planet.");
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "Proxima Cen b", "exoplanet-proxima-cen-b", "Proxima Cen b");
    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toContainText("Minimum mass (M sin i)");
    await expect(section).toContainText("calculated by the archive");
    await expect(section).toContainText("Inclination: not measured");
  });

  test("each entry in the planet list of a host star selects that planet", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "TRAPPIST-1", "exosys-trappist-1", "TRAPPIST-1");
    await expect(page.locator("#body-info [data-planetary-system]")).toBeVisible();
    await page.locator('#body-info [data-object-view="science"]').click();
    const entry = page.locator('#body-info .planet-list [data-related-key="exoplanet-trappist-1-e"]');
    await expect(entry).toHaveAccessibleName("Select TRAPPIST-1 e");
    await expect(page.locator("#body-info .planet-list [data-related-key]")).toHaveCount(7);
    await entry.click();
    await expect(page.locator("#selected-summary-name")).toContainText("TRAPPIST-1 e");
  });

  test("at star scale the host star has the label, not a planet", async ({ page, request }) => {
    const host = await catalogObject(request, "exosys-trappist-1");
    await openAtlas(page, viewUrl(host.position, 0.001));
    await expect.poll(async () => (await labelKeys(page)).includes("exosys-trappist-1"), { timeout: 30_000 }).toBe(true);
    const labels = await labelKeys(page);
    expect(labels.filter((key) => key.startsWith("exoplanet-")), "no planet takes a label").toEqual([]);
    expect((await visibleKeys(page)).filter((key) => key.startsWith("exoplanet-")), "the host star represents its system").toEqual([]);
    expect(await rings(page)).toEqual([]);
    await expect(page.locator("#exoplanet-orbit-note")).toBeHidden();
  });

  test("at Proxima Centauri one star marker shows and the orbits are around it", async ({ page, request }) => {
    const host = await catalogObject(request, "exosys-proxima-cen");
    await openAtlas(page, viewUrl(host.position, 6_000));
    await waitForRings(page, ["exoplanet-proxima-cen-b", "exoplanet-proxima-cen-d"]);
    const visible = await visibleKeys(page);
    const stars = visible.filter((key) => key === "proxima-cen" || key === "exosys-proxima-cen");
    expect(stars, "the curated star and its archive record draw as one marker").toEqual(["proxima-cen"]);
    const star = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.bodyScreen("proxima-cen"));
    for (const ring of await rings(page)) {
      expect(Math.hypot(ring.host.x - star!.x, ring.host.y - star!.y), `${ring.key} is around the star marker`).toBeLessThan(0.5);
    }
  });

  test("Solar System planets keep their markers, labels, and orbits", async ({ page }) => {
    const viewportGroups = new Set<string>();
    page.on("request", (viewportRequest) => {
      const url = new URL(viewportRequest.url());
      if (url.pathname === "/api/catalog/viewport") viewportGroups.add(url.searchParams.get("groups") ?? "");
    });
    await openAtlas(page, "/?perf=1");
    const planets = ["mercury", "venus", "earth", "mars"];
    await expect.poll(async () => {
      const keys = await visibleKeys(page);
      return planets.every((key) => keys.includes(key));
    }, { timeout: 30_000 }).toBe(true);
    const visible = await visibleKeys(page);
    const labels = await labelKeys(page);
    for (const key of planets) {
      expect(visible, `${key} marker`).toContain(key);
      expect(labels, `${key} label`).toContain(key);
    }
    expect(visible.filter((key) => key.startsWith("exoplanet-"))).toEqual([]);
    expect(await rings(page)).toEqual([]);
    await expect(page.locator("#exoplanet-orbit-note")).toBeHidden();
    // The Solar System view asks for the same catalog group as before.
    await expect.poll(() => viewportGroups.size, { timeout: 15_000 }).toBeGreaterThan(0);
    expect([...viewportGroups]).toEqual(["jpl_small_bodies"]);
  });

  test("the PNG export contains the rings and the convention line", async ({ page, request }) => {
    const host = await catalogObject(request, "exosys-trappist-1");
    await openAtlas(page, viewUrl(host.position, 5_200));
    await waitForRings(page, TRAPPIST_PLANETS);
    await page.locator("#share-menu-button").click();
    await expect(page.locator("#export-image")).toBeVisible();
    await page.locator("#export-resolution").selectOption("current");
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.locator("#export-image").click();
    const stream = await (await downloadPromise).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ringPixels = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 2]! - pixels[offset]! > 30 && pixels[offset + 1]! - pixels[offset]! > 15) count += 1;
      }
      return count;
    }, Buffer.concat(chunks).toString("base64"));
    expect(ringPixels).toBeGreaterThan(800);
  });
});

/** Counts overlay pixels with the violet of a planet candidate ring or marker. A confirmed-planet ring is blue. */
function candidatePixelCount(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3]! > 40 && pixels[offset + 2]! - pixels[offset + 1]! > 25 && pixels[offset]! - pixels[offset + 1]! > 6) count += 1;
    }
    return count;
  });
}

test.describe("planet candidates", () => {
  const TOI_119_CANDIDATES = ["toi-119-01", "toi-119-02"];

  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await page.route("**/api/survey-image?**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: SURVEY_IMAGE }));
    const candidate = await request.get("/api/objects/toi-119-01");
    test.skip(!candidate.ok(), "The catalog under test has no planet candidates.");
  });

  test("search finds a candidate, the inspector says that it is not confirmed, and the system view shows violet rings", async ({ page, request }) => {
    const candidate = await catalogObject(request, "toi-119-01");
    const host = await catalogObject(request, "toi-119");
    expect(candidate.position_model).toBe("tess_toi_host_relative_orbit");
    expect(candidate.position).toEqual(host.position);
    expect(candidate.facts.disposition).toBe("planet_candidate");
    expect(candidate.facts.semi_major_axis_atlas_calculated).toBe(true);

    const issues = collectBrowserIssues(page);
    await openAtlas(page, `/?perf=1&t=${encodeURIComponent(ATLAS_TIME)}`);
    await selectCatalogObject(page, "TOI-119.01", "toi-119-01", "TOI-119.01");
    await expect(page.locator("#selected-object-panel")).toContainText("Planet candidate");
    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toHaveAttribute("data-planet-candidate", "");
    await expect(section).toHaveAttribute("data-exoplanet-state", "position");
    await expect(section.locator(".planet-candidate-notice")).toContainText("not a confirmed planet");
    await expect(section).toContainText("Planet candidate (TFOPWG disposition PC)");
    await expect(section).toContainText("calculated by the atlas");
    await expect(section).toContainText("Transit depth");
    await expect(section).toContainText("BJD-TDB");
    await expect(page.locator("#body-info")).not.toContainText("Confirmed exoplanets");

    await page.locator("#body-info [data-planetary-system]").click();
    await waitForRings(page, TOI_119_CANDIDATES);
    await expect.poll(async () => (await camera(page)).pxPerAu, { timeout: 20_000 }).toBeGreaterThan(1_000);
    await expect.poll(async () => {
      const first = (await camera(page)).pxPerAu;
      await page.waitForTimeout(250);
      return Math.abs((await camera(page)).pxPerAu - first);
    }, { timeout: 20_000 }).toBe(0);
    const state = await rings(page);
    const visible = await visibleKeys(page);
    for (const ring of state) {
      expect(ring.displayState, ring.key).toBe("position");
      expect(visible, "each candidate has a marker").toContain(ring.key);
      expect(Math.hypot(ring.position.x - ring.host.x, ring.position.y - ring.host.y), "the candidate is apart from its star").toBeGreaterThan(20);
    }
    // One star marker for the host, with its label. The rings are violet, not the blue of a confirmed planet.
    expect(visible).toContain("toi-119");
    expect(await labelKeys(page)).toContain("toi-119");
    expect(await candidatePixelCount(page)).toBeGreaterThan(300);
    issues.assertClean();
  });

  test("the star of a candidate lists its candidates as not confirmed, and each entry selects that candidate", async ({ page }) => {
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "TOI-119", "toi-119", "TOI-119");
    await expect(page.locator("#body-info [data-planetary-system]")).toBeVisible();
    await page.locator('#body-info [data-object-view="science"]').click();
    const list = page.locator("#body-info .planet-candidates");
    await expect(list).toHaveAttribute("data-planet-candidate-count", "2");
    await expect(list.locator("h3")).toContainText("not confirmed");
    await expect(list.locator(".planet-candidate-notice")).toContainText("not confirmed planets");
    await expect(page.locator("#body-info")).not.toContainText("Confirmed exoplanets");
    await list.locator('[data-related-key="toi-119-02"]').click();
    await expect(page.locator("#selected-summary-name")).toContainText("TOI-119.02");
  });

  test("a confirmed host star keeps its planet list and shows its candidates in a separate list", async ({ page, request }) => {
    // HIP 56998 (TOI-6276) has confirmed planets and one more TESS candidate. The test stops when the archive changes that.
    const response = await request.get("/api/objects/toi-6276-03");
    test.skip(!response.ok() || (await response.json()).object?.parent_key !== "exosys-hip-56998", "TOI-6276.03 is not a candidate of HIP 56998 in this catalog.");
    const candidate = await catalogObject(request, "toi-6276-03");
    const host = await catalogObject(request, "exosys-hip-56998");
    expect(candidate.position).toEqual(host.position);
    await expect.poll(async () => (await request.get("/api/objects/toi-6276")).status()).toBe(404);

    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "HIP 56998", "exosys-hip-56998", "HIP 56998");
    await page.locator('#body-info [data-object-view="science"]').click();
    await expect(page.locator("#body-info")).toContainText("Confirmed exoplanets");
    await expect(page.locator("#body-info .planet-candidates [data-related-key]")).toHaveCount(1);
    await expect(page.locator('#body-info .planet-candidates [data-related-key="toi-6276-03"]')).toBeVisible();
    // The confirmed planets stay in their own list, with no candidate in it.
    await expect(page.locator('#body-info .planet-list [data-related-key^="exoplanet-"]')).toHaveCount(2);
    await expect(page.locator('#body-info [data-related-key="toi-6276-03"]')).toHaveCount(1);
  });

  test("a candidate with no period has no ring and the inspector says so", async ({ page, request }) => {
    const response = await request.get("/api/objects/toi-125-04");
    test.skip(!response.ok() || (await response.json()).object?.facts?.orbit_display_state !== "none", "TOI-125.04 has an orbit in this catalog.");
    const candidate = await catalogObject(request, "toi-125-04");
    expect(candidate.position_model).toBe("tess_toi_host_coordinates");
    await openAtlas(page, "/?perf=1");
    await selectCatalogObject(page, "TOI-125.04", "toi-125-04", "TOI-125.04");
    await expect(page.locator("#body-info [data-planetary-system]")).toHaveCount(0);
    await openScienceView(page);
    const section = page.locator("#body-info .exoplanet-orbit");
    await expect(section).toHaveAttribute("data-exoplanet-state", "none");
    await expect(section).toContainText("the atlas calculates no orbit");
    await expect(section.locator(".planet-candidate-notice")).toContainText("not a confirmed planet");
    expect((await rings(page)).map((ring) => ring.key)).not.toContain("toi-125-04");
  });
});

test.describe("exoplanet tile layers and the viewport-object path", () => {
  test("the tile plan yields to precise objects from one pixel of tile quantization", async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await serveSourceModules(page);
    await page.route("**/exoplanet-planner-fixture", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Planner fixture</title>" }));
    await page.goto(`${ATLAS_BASE_URL}/exoplanet-planner-fixture`);
    const result = await page.evaluate(async () => {
      const { CatalogPointPlanner } = await import("/src/catalog/catalogPointPlanner.ts");
      // The level set of the deployed manifest: the finest tile is 2^24 AU wide, so one quantization step is 256 AU.
      const levels = Array.from({ length: 14 }, (_, index) => 24 + index * 2).map((span) => ({ span_log2: span, span_au: 2 ** span }));
      const layer = (id: string, groups: string[], types: string[]) => ({
        id, groups, types, levels, source_counts: {}, tile_url_template: `/tiles/${id}/s{span_log2}/x{x}/y{y}.bin`,
      });
      const manifest = {
        state: "ready", allowDynamicFallback: false,
        value: {
          version: "fixture", format: "SMP3", color_lut: [], source_counts: {},
          layers: [
            layer("gaia_stars", ["gaia_local_stars"], ["star"]),
            layer("exoplanet_stars", ["nearby_exoplanet_systems", "exoplanet_systems"], ["star"]),
            layer("planets", ["exoplanets"], ["planet"]),
          ],
        },
      };
      const planner = new CatalogPointPlanner(manifest as never);
      const center = { x: 2_484_666.23, y: -631_632.11 };
      const viewport = (pxPerAu: number, resolvedExoplanetOrbits = false) => {
        const halfWidth = 640 / pxPerAu, halfHeight = 400 / pxPerAu;
        return {
          camera: { xAu: center.x, yAu: center.y, pxPerAu },
          viewportWidthPx: 1280, viewportHeightPx: 800, viewWidthLy: (2 * halfWidth) / 63_241.077,
          visibleBounds: { minXAu: center.x - halfWidth, maxXAu: center.x + halfWidth, minYAu: center.y - halfHeight, maxYAu: center.y + halfHeight },
          filter: { key: "all" as const, labelKey: "filters.all" }, embed: false, resolvedExoplanetOrbits,
        };
      };
      const layersAt = (pxPerAu: number, resolved = false) =>
        [...new Set(planner.plan(viewport(pxPerAu, resolved) as never).map((request) => request.staticLayerId))].sort();
      const onePixel = 65_535 / 2 ** 24;
      return {
        starScale: layersAt(0.001),
        starScaleWithResolvedOrbit: layersAt(0.001, true),
        belowOnePixel: layersAt(onePixel * 0.99),
        atOnePixel: layersAt(onePixel),
        systemScale: layersAt(5_200),
        ownsAtStarScale: ["exoplanet_systems", "nearby_exoplanet_systems", "exoplanets", "gaia_local_stars"].map((group) => planner.ownsCatalogGroup(group, 0.001)),
        ownsAtSystemScale: ["exoplanet_systems", "nearby_exoplanet_systems", "exoplanets", "gaia_local_stars"].map((group) => planner.ownsCatalogGroup(group, 5_200)),
        ownsWithoutScale: planner.ownsCatalogGroup("exoplanets"),
      };
    });
    expect(result.starScale).toEqual(["exoplanet_stars", "gaia_stars", "planets"]);
    // A resolved orbit in view removes the planet points, which are at the host stars.
    expect(result.starScaleWithResolvedOrbit).toEqual(["exoplanet_stars", "gaia_stars"]);
    expect(result.belowOnePixel).toEqual(["exoplanet_stars", "gaia_stars", "planets"]);
    expect(result.atOnePixel).toEqual(["gaia_stars"]);
    expect(result.systemScale).toEqual(["gaia_stars"]);
    expect(result.ownsAtStarScale).toEqual([true, true, true, true]);
    expect(result.ownsAtSystemScale).toEqual([false, false, false, true]);
    expect(result.ownsWithoutScale).toBe(true);
  });
});
