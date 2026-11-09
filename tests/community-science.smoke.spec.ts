import { deflateSync } from "node:zlib";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openAtlas, selectCatalogObject, serveSourceModules } from "./atlas-test-utils";
import { communityFixture, photo } from "./community-fixtures";

/** The API of the Python service: the fit in this test is the real fit. */
const PYTHON = process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8765";
const SHOTS = process.env.SCIENCE_SHOTS;
const EARTH_SKY = "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=82.0,-28.7,40.0";
const RA = 97.636645;
const DEC = 29.6722662;
const WIDTH = 200;
const HEIGHT = 150;
const STARS = [
  { x: 100, y: 75, flux: 60000 },
  { x: 40, y: 40, flux: 52000 },
  { x: 160, y: 35, flux: 57000 },
  { x: 45, y: 115, flux: 50000 },
  { x: 155, y: 112, flux: 62000 },
];
const skyOf = (x: number, y: number) => ({ ra: RA - ((x - 99.5) * 2) / 3600 / Math.cos((DEC * Math.PI) / 180), dec: DEC + ((y - 74.5) * 2) / 3600 });
/** The ephemeris of WASP-12 b puts epoch 3000 at this UTC time. The frames have the transit 2 minutes late. */
const MID_UTC = Date.parse("2025-07-25T06:43:55Z");
const LATE_MINUTES = 2;

const transit = {
  key: "exoplanet-wasp-12-b", host_key: "exosys-wasp-12", name: "WASP-12 b", host_name: "WASP-12", status: "confirmed",
  ra_deg: RA, dec_deg: DEC, magnitude: 11.57, magnitude_band: "V", depth_ppt: 15.4, duration_hours: 3, epoch: 3000, coverage: "full",
  ingress_utc: "2025-07-25T05:13:55Z", mid_utc: "2025-07-25T06:43:55Z", egress_utc: "2025-07-25T08:13:55Z", uncertainty_minutes: 0.1,
  altitude_ingress_deg: 41.2, altitude_mid_deg: 56.8, altitude_egress_deg: 63.1, moon_separation_deg: 74.4,
};

function fitsFrame(minutes: number, seed: number): Buffer {
  const cards = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: WIDTH, NAXIS2: HEIGHT, BZERO: 32768, BSCALE: 1, "DATE-OBS": new Date(MID_UTC + (minutes - 0.5) * 60_000).toISOString().slice(0, 19), EXPTIME: 60, GAIN: 1, CTYPE1: "RA---TAN", CTYPE2: "DEC--TAN", CRVAL1: RA, CRVAL2: DEC, CRPIX1: 100.5, CRPIX2: 75.5, CD1_1: -2 / 3600, CD1_2: 0, CD2_1: 0, CD2_2: 2 / 3600 };
  const lines = Object.entries(cards).map(([key, value]) => `${key.padEnd(8)}= ${typeof value === "string" ? `'${value}'` : value === true ? "T" : value}`.padEnd(80));
  lines.push("END".padEnd(80));
  const header = lines.join("").padEnd(Math.ceil((lines.length * 80) / 2880) * 2880);
  const data = Buffer.alloc(Math.ceil((WIDTH * HEIGHT * 2) / 2880) * 2880);
  const offset = Math.abs(minutes - LATE_MINUTES);
  const dip = 1 - 0.0154 * Math.min(1, Math.max(0, (90 - offset) / 25));
  let state = seed * 7919 + 13;
  const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
  // Thin cloud changes each star by the same share, so only the ratio can show the dip.
  const sky = 1 - 0.1 * random();
  for (let y = 0; y < HEIGHT; y += 1)
    for (let x = 0; x < WIDTH; x += 1) {
      let value = 300 + (random() + random() + random() - 1.5) * 8;
      STARS.forEach((star, index) => {
        const flux = star.flux * sky * (index === 0 ? dip : 1);
        value += (flux / (2 * Math.PI * 3.2)) * Math.exp(-((x - star.x) ** 2 + (y - star.y) ** 2) / (2 * 3.2));
      });
      data.writeInt16BE(Math.round(value) - 32768, (y * WIDTH + x) * 2);
    }
  return Buffer.concat([Buffer.from(header, "latin1"), data]);
}

function png(width: number, height: number, color: (x: number, y: number) => number): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) rows.fill(color(x, y), y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 1 + x * 3 + 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (data: Buffer) => { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (kind: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(kind), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([size, body, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const blob = (x: number, y: number, cx: number, cy: number) => Math.round(200 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 8));
const CELL = 48;
const depthLayers = {
  photo_id: photo.id, width: 480, height: 320, cell: CELL, detected: 12, plane_distance_ly: 1344,
  base_url: "/depth-base.png", sprites_url: "/depth-sprites.png",
  credit: { name: "Observer", handle: "observer", licence: "CC BY 4.0", title: photo.title },
  sources: [
    { key: "gaia-dr3-1", name: "Gaia DR3 1", x: 0.25, y: 0.3, cell: [0, 0], distance_ly: 82, distance_method: "parallax" },
    { key: "m42", name: "M42", x: 0.75, y: 0.7, cell: [1, 0], distance_ly: 1344, distance_method: "catalog" },
  ],
};
const candidate = { id: "f1", kind: "candidate", designation: null, ra_deg: 83.8, dec_deg: -5.4, x: 0.4, y: 0.6, magnitude: 17.2, near_key: "ngc-2000", near_name: "NGC 2000", state: "reviewed", report: "Unconfirmed point source from an amateur image." };
const body = { id: "f2", kind: "known_body", designation: "(433) Eros", ra_deg: 83.7, dec_deg: -5.3, x: 0.7, y: 0.3, magnitude: 12.1, recovered: true, state: "proposed" };
const wcs = { ra_deg: 83.8, dec_deg: -5.4, pixel_scale_arcsec: 2, rotation_deg: 0, width: 480, height: 320, frame: "ICRS", epoch: "J2000", projection: "TAN", status: "solved" };

async function scienceRoutes(page: Page, state: { fits: unknown[]; submitted: unknown[]; shown: unknown[]; reviewed: string[] }) {
  await page.route("**/depth-base.png", (route) => route.fulfill({ contentType: "image/png", body: png(480, 320, () => 20) }));
  await page.route("**/depth-sprites.png", (route) => route.fulfill({ contentType: "image/png", body: png(CELL * 2, CELL, (x, y) => blob(x, y, x < CELL ? 24 : 72, 24)) }));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/observe/plan")
      return json({ date: "2025-07-24", min_altitude_deg: 30, darkness: "astronomical", window: { start_utc: "2025-07-25T02:00:00Z", end_utc: "2025-07-25T11:00:00Z" }, moon: { illuminated_fraction: 0.2, windows: [] }, total: 0, targets: [], transits: { total: 1, transits: [transit] }, accuracy_note: "" });
    if (path === "/api/transits/comparison-stars")
      return json({ stars: STARS.map((star, index) => ({ key: `gaia-${index}`, ...skyOf(star.x, star.y), magnitude: 11.6 - Math.log10(star.flux / 60000) * 2.5, bp_rp: 0.8 })) });
    if (path === "/api/community/transits/fit") {
      const payload = route.request().postDataJSON();
      state.fits.push(payload);
      const response = await fetch(`${PYTHON}/api/observe/transit-fit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: payload.key, points: payload.points }) });
      return json(await response.json());
    }
    if (path === "/api/community/transits" && route.request().method() === "GET") return json({ transits: [] });
    if (path === "/api/community/transits") {
      state.submitted.push(route.request().postDataJSON());
      return json({ id: "t1", review_state: "review" });
    }
    if (path === "/api/objects/exosys-wasp-12/transits" || path === "/api/objects/exoplanet-wasp-12-b/transits")
      return json({ timings: [{ id: "t1", object_key: transit.key, object_name: "WASP-12 b", target_status: "confirmed", mid_time_utc: "2025-07-25T06:45:55Z", uncertainty_minutes: 0.42, o_minus_c_minutes: 2, frame_count: 100, instrument: "Seestar S50", method_version: "trapezoid-1", observer: { handle: "observer", name: "Observer" } }], planets: [{ key: transit.key, count: 1, observers: 1, mean_o_minus_c_minutes: 2, archive_uncertainty_minutes: 0.09, community_uncertainty_minutes: 0.09 }] });
    if (path === `/api/photos/${photo.id}`)
      return json({ ...photo, depth_ready: true, wcs, author: { handle: "reader", name: "Reader" } });
    if (path === `/api/photos/${photo.id}/depth`) return json(depthLayers);
    if (path === `/api/community/photos/${photo.id}/findings`) return json({ findings: [body, candidate] });
    if (path.startsWith("/api/community/findings/") && path.endsWith("/public")) {
      state.shown.push(route.request().postDataJSON());
      return json({ ...body, state: "approved" });
    }
    if (path === "/api/community/review/transits" && url.searchParams.get("state") === "approved") return json({ transits: [] });
    if (path === "/api/community/review/transits")
      return json({ transits: [{ id: "t1", review_state: "review", object_name: "WASP-12 b", target_status: "confirmed", night: "2025-07-24", mid_time_utc: "2025-07-25T06:45:55Z", uncertainty_minutes: 0.42, o_minus_c_minutes: 2, predicted_uncertainty_minutes: 0.09, depth_ppt: 15.2, duration_minutes: 180, frame_count: 100, instrument: "Seestar S50", method_version: "trapezoid-1", observer: { handle: "vera", name: "Vera R." }, submitted_at: "2025-07-26T10:00:00Z", checks: { baseline_rms_ppt: 2.1, comparison_rms_ppt: 3.1, reduced_chi_square: 1.1, red_noise_factor: 1.2, frames_dropped: 1 }, measurements: { points: Array.from({ length: 80 }, (_, index) => [2460881.7 + index / 480, 1 - (index > 25 && index < 55 ? 0.015 : 0), 0.002]), model: null } }] });
    if (path === "/api/community/review/findings")
      return json({ findings: [{ ...candidate, state: "review", photo_id: photo.id, photo_title: "Field A", captured_at: "2025-07-25T02:00:00Z", image_url: "/test-community-image.png", wcs, author: { handle: "vera", name: "Vera R." }, second_frame: { id: "p2", title: "Field B", captured_at: "2025-07-28T02:00:00Z", image_url: "/test-community-image.png", wcs, x: 0.4, y: 0.6 } }] });
    if (/\/api\/community\/(transits|findings)\/[^/]+\/review$/.test(path)) {
      state.reviewed.push(path);
      return json({ id: "x", state: "reviewed" });
    }
    return route.fallback();
  });
}

async function openEarthSky(page: Page) {
  await openAtlas(page, EARTH_SKY);
  await expect(page.locator("#sky-view")).toBeVisible();
}

const signIn = async (page: Page) => {
  await page.getByRole("button", { name: "Sign in" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await dialog.getByLabel("Email").fill("reader@example.com");
  await dialog.getByRole("button", { name: "Send code" }).click();
  await dialog.getByLabel("Code").fill("123456");
  await dialog.getByRole("button", { name: "Verify code" }).click();
  await expect(dialog).toBeHidden();
};

/** A picture for a person to check, at desktop and at phone width. It does nothing in a normal run. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const size = page.viewportSize()!;
  await page.screenshot({ path: `${SHOTS}/${name}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  await page.setViewportSize(size);
}

const newState = () => ({ fits: [] as { points: number[][] }[], submitted: [] as Record<string, unknown>[], shown: [] as unknown[], reviewed: [] as string[] });

test("a transit runs from the planner to the review, and only measurements leave the browser", async ({ page }) => {
  test.setTimeout(120_000);
  const state = newState();
  await communityFixture(page);
  await scienceRoutes(page, state);
  await openAtlas(page);
  await signIn(page);
  await openEarthSky(page);
  await page.locator("#sky-planner-button").click();
  const planner = page.getByRole("dialog", { name: "Tonight's planner" });
  await planner.locator('input[name="latitude"]').fill("19.8");
  await planner.locator('input[name="longitude"]').fill("-155.5");
  await planner.locator('input[name="date"]').fill("2025-07-24");
  await planner.getByRole("button", { name: /Plan|Calculate/ }).last().click();
  await planner.getByRole("button", { name: /^Transits/ }).click();
  await expect(planner.locator(".planner-row")).toContainText("WASP-12 b");
  await expect(planner.locator(".planner-row")).toContainText("Confirmed planet");
  await shot(page, "transit-planner");
  await planner.getByRole("button", { name: /Record transit/ }).click();

  const flow = page.getByRole("dialog", { name: /Record transit/ });
  const files = Array.from({ length: 100 }, (_, index) => {
    const minutes = -150 + index * 3;
    return { name: `frame-${String(index).padStart(3, "0")}.fits`, mimeType: "application/fits", buffer: fitsFrame(minutes, index + 1) };
  });
  await flow.locator('input[type="file"]').setInputFiles(files);
  await flow.locator('input[name="instrument"]').fill("Seestar S50");
  await flow.getByRole("button", { name: "Read frames" }).click();
  await expect(flow.getByText("Check the star field")).toBeVisible({ timeout: 20_000 });
  await shot(page, "transit-field");
  await flow.getByRole("button", { name: "Measure all frames" }).click();
  await expect(flow.getByText("Light curve")).toBeVisible({ timeout: 60_000 });
  await expect(flow.locator(".transit-curve circle")).toHaveCount(100);
  await shot(page, "transit-curve");

  const oc = (await flow.locator("dt", { hasText: "Observed minus predicted" }).locator("+ dd").textContent())!;
  expect(Math.abs(parseFloat(oc) - LATE_MINUTES)).toBeLessThan(1.5);
  await flow.getByRole("button", { name: "Send for review" }).click();
  await expect(flow).toContainText("A moderator reviews this timing");
  expect(state.submitted).toHaveLength(1);
  const sent = state.submitted[0]!;
  expect(Object.keys(sent).sort()).toEqual(["comparison", "frame_count", "frames_dropped", "host_key", "instrument", "key", "name", "night", "pipeline_version", "points", "status"]);
  expect(sent.frame_count).toBe(100);
  expect(JSON.stringify(sent).length).toBeLessThan(20_000);
});

test("the depth flight starts on the photo, moves, and keeps the credit", async ({ page }) => {
  const state = newState();
  await communityFixture(page);
  await scienceRoutes(page, state);
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-photo]").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await viewer.getByRole("button", { name: "Enter this photo" }).click();
  const flight = page.getByRole("dialog", { name: "Depth flight" });
  const canvas = flight.locator("canvas");
  await expect(canvas).toBeVisible();
  const pixel = (x: number, y: number) => canvas.evaluate((node: HTMLCanvasElement, at) => Array.from(node.getContext("2d")!.getImageData(at[0]!, at[1]!, 1, 1).data), [x, y]);
  const size = await canvas.evaluate((node: HTMLCanvasElement) => [node.width, node.height]);
  // At the start, the base and the sprite add to the sky and the star of the photo at their place.
  await expect.poll(async () => (await pixel(size[0]! * 0.25, size[1]! * 0.3))[0]).toBeGreaterThan(200);
  expect((await pixel(size[0]! * 0.5, size[1]! * 0.5))[0]).toBeLessThan(40);
  await shot(page, "depth-start");
  const before = await pixel(size[0]! * 0.25, size[1]! * 0.3);
  await flight.locator("[data-progress]").fill("0.45");
  await expect(flight.locator("[data-distance]")).toContainText("Camera");
  expect((await pixel(size[0]! * 0.25, size[1]! * 0.3))[0]).toBeLessThan(before[0]!);
  await shot(page, "depth-flight");
  await expect(flight).toContainText("Gaia DR3 1");
  await expect(flight).toContainText("M42");
  const hasCredit = await canvas.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext("2d")!.getImageData(8, node.height - 20, 120, 14).data;
    return data.some((value, index) => index % 4 === 0 && value > 180);
  });
  expect(hasCredit).toBe(true);
  await flight.getByRole("button", { name: "Save clip" }).click();
  await expect(flight.locator("~ *").or(flight.locator(".community-message"))).toContainText("Recording the flight");
});

test("the author sees private findings, and a moderator reviews timings and candidates", async ({ page }) => {
  const state = newState();
  await communityFixture(page, { role: "moderator" });
  await scienceRoutes(page, state);
  await openAtlas(page);
  await signIn(page);
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-photo]").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await expect(viewer.getByRole("heading", { name: "Found in this photo" })).toBeVisible();
  await expect(viewer.locator(".community-finding-mark")).toHaveCount(2);
  const candidateMark = viewer.locator('.community-finding-mark[data-kind="candidate"]');
  const bodyMark = viewer.locator('.community-finding-mark[data-kind="known_body"]');
  await expect(candidateMark).toHaveAccessibleName("Unconfirmed candidate");
  await expect(bodyMark).toHaveAccessibleName("(433) Eros · Known asteroid or comet");
  expect(await candidateMark.evaluate((mark) => getComputedStyle(mark).borderStyle)).toBe("dashed");
  expect(await candidateMark.evaluate((mark) => getComputedStyle(mark).borderRadius)).toBe("4px");
  expect(await bodyMark.evaluate((mark) => getComputedStyle(mark).borderStyle)).toBe("solid");
  expect(await bodyMark.evaluate((mark) => getComputedStyle(mark).borderRadius)).toBe("50%");
  await expect(viewer).toContainText("(433) Eros");
  await expect(viewer).toContainText("Unconfirmed candidate");
  await expect(viewer.getByText("Unconfirmed point source")).toBeHidden();
  await viewer.locator(".finding-blink").first().scrollIntoViewIfNeeded();
  await shot(page, "findings");
  await viewer.getByRole("button", { name: "Show on my photo" }).first().click();
  await expect.poll(() => state.shown.length).toBe(1);
  await viewer.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Review/ }).first().click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await hub.getByRole("button", { name: /^Transits/ }).click();
  await expect(hub.locator(".transit-curve circle")).toHaveCount(80);
  await expect(hub).toContainText("Comparison star scatter");
  await shot(page, "review-transit");
  await hub.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => state.reviewed.length).toBe(1);
  await hub.getByRole("button", { name: /^Candidates/ }).click();
  await expect(hub.locator(".finding-blink")).toHaveCount(2);
  await expect(hub).toContainText("Second frame: Field B");
  await hub.getByRole("button", { name: "Blink" }).first().click();
  await expect(hub.locator("[data-blink-label]").first()).toContainText("Legacy Surveys DR11");
  await expect(hub.locator(".finding-blink__photo").first()).toBeHidden();
  await hub.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => state.reviewed.length).toBe(2);
});

test("the inspector marks a transit timing as a community result", async ({ page }) => {
  const state = newState();
  await communityFixture(page);
  await scienceRoutes(page, state);
  await serveSourceModules(page);
  await openAtlas(page);
  const text = await page.evaluate(async () => {
    const { mountTransitTimings } = await import("/src/transit/transitTimings.ts" as string);
    const { CommunityApi } = await import("/src/community/api.ts" as string);
    const box = document.createElement("div");
    const after = document.createElement("section");
    box.append(after);
    document.body.append(box);
    await mountTransitTimings(new CommunityApi(), after, "exosys-wasp-12", () => false);
    return box.textContent;
  });
  expect(text).toContain("Transit timings");
  expect(text).toContain("Observer @observer");
  expect(text).toContain("Community result");
  expect(text).toContain("archive ±0.09 min");
});
