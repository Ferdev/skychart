import { readFileSync, existsSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openAtlas, openSearchWorkspace, selectCatalogObject } from "./atlas-test-utils";
import { communityFixture, photo } from "./community-fixtures";

const SHOTS = process.env.FEATURE_SHOTS;
const DEMO = process.env.DEEP_FIELD_DEMO;
const ownedPhoto = { ...photo, author: { handle: "reader", name: "Reader" } };
const wcs = { ra_deg: 266.4, dec_deg: -29.0, pixel_scale_arcsec: 2, rotation_deg: 0, width: 1600, height: 1200, cd: [-0.00055, 0, 0, 0.00055], crpix: [800.5, 600.5], projection: "TAN", frame: "ICRS", epoch: "J2000", status: "solved" };
const field = {
  slug: "andromeda",
  title: "Andromeda",
  key: "sun",
  status: "open",
  opened_at: "2026-11-01T00:00:00Z",
  wcs,
  build: {
    version: 3,
    built_at: "2026-11-02T04:00:00Z",
    frames: 16,
    max_coverage: 16,
    limiting_mag: 18.4,
    best_limiting_mag: 17.2,
    gain_mag: 1.2,
    stack_url: "/deep-demo/stack.webp",
    best_url: "/deep-demo/best.webp",
    depth_url: "/deep-demo/depth.webp",
  },
  contributors: [
    { handle: "observer", name: "Observer", frames: 2, photos: [{ id: photo.id, title: "Sun portrait", licence: "CC BY 4.0" }] },
    { handle: "<b>", name: "<b>Vera</b>", frames: 1, photos: [{ id: "b", title: "First light", licence: "All rights reserved" }] },
  ],
};

async function deepRoutes(page: Page) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNgYGD4//8/AAYBAv4CsjmuAAAAAElFTkSuQmCC", "base64");
  await page.route("**/deep-demo/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    const file = DEMO ? `${DEMO}/${name}` : "";
    return file && existsSync(file) ? route.fulfill({ contentType: "image/webp", body: readFileSync(file) }) : route.fulfill({ contentType: "image/png", body: pixel });
  });
  await page.route("**/api/deep-fields/*", (route) => route.fulfill({ json: field }));
  await page.route("**/api/objects/*/photos", (route) => route.fulfill({ json: { photos: [photo], deep_field: { slug: "andromeda", title: "Andromeda", frames: 16, contributors: 2, limiting_mag: 18.4, thumbnail_url: "/deep-demo/thumb.webp" } } }));
  await page.route(`**/api/photos/${photo.id}`, (route) => route.fulfill({ json: { ...ownedPhoto, deep_field_open: { slug: "andromeda", title: "Andromeda" } } }));
  await page.route("**/api/community/photos/*/deep-frame", (route) => {
    const request = route.request();
    calls.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
    const frame = { slug: "andromeda", title: "Andromeda", consent_at: "2026-11-02T00:00:00Z", withdrawn_at: request.method() === "DELETE" ? "2026-11-02T00:00:00Z" : null, weight: null, rejection_reason: null };
    return route.fulfill({ json: request.method() === "GET" ? { field: { slug: "andromeda", title: "Andromeda" }, frame: null, future: false } : frame });
  });
  return calls;
}

test("the inspector row opens a deep field with a slider, a depth map, a zoom and credits", async ({ page }) => {
  await communityFixture(page);
  await deepRoutes(page);
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  const row = page.locator("[data-deep-field]");
  await expect(row).toContainText("Frames: 16 · contributors: 2");
  await row.click();

  const view = page.getByRole("dialog", { name: "Andromeda: deep field" });
  await expect(view.getByText("Limiting magnitude")).toBeVisible();
  await expect(view).toContainText("1.20 mag");
  await expect(view).toContainText("<b>Vera</b>");
  await expect(view.locator(".deep-field__wall b")).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/deep-field-desktop.png` });

  const stack = view.locator("[data-layer='stack']");
  await view.getByRole("slider", { name: "From the best single frame to the full stack" }).fill("25");
  await expect(stack).toHaveCSS("opacity", "0.25");

  await expect(view.getByText(/black is none, white is 16/)).toBeHidden();
  await view.getByRole("button", { name: "Depth map" }).click();
  await expect(view.locator("[data-layer='depth']")).toBeVisible();
  await expect(view.getByText(/black is none, white is 16/)).toBeVisible();

  const image = view.locator(".deep-field__image");
  await view.getByRole("button", { name: "Zoom in" }).click();
  await expect(image).toHaveCSS("transform", /matrix\(1\.5,/);
  await view.locator(".deep-field__stage").press("-");
  await expect(image).toHaveCSS("transform", /matrix\(1,/);
});

test("the owner adds a frame with consent and can remove it", async ({ page }) => {
  await communityFixture(page);
  const calls = await deepRoutes(page);
  await page.route("**/api/community/session", (route) => route.fulfill({ json: { user: { id: "user", handle: "reader", name: "Reader", role: "member" }, csrf: "test-csrf", review_count: 0 } }));
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-photo]").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await viewer.getByRole("button", { name: "Add my frame" }).click();

  const consent = page.getByRole("dialog", { name: "Add this photo to Andromeda" });
  await expect(consent).toContainText("You can remove the frame at any time");
  await consent.getByLabel("Also add my future approved photos of open deep fields").check();
  await consent.getByRole("button", { name: "Add my frame" }).click();

  await expect(viewer).toContainText("It joins the image at the next rebuild");
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ future: true });
  await viewer.getByRole("button", { name: "Remove my frame" }).click();
  await expect(viewer).toContainText("leaves the image at the next rebuild");
  expect(calls.some((call) => call.method === "DELETE")).toBe(true);
});

async function openAsk(page: Page) {
  await openSearchWorkspace(page);
  return page.locator("#ask-section");
}

test("a moderator opens a target, and an owner adds a frame in My photos", async ({ page }) => {
  await communityFixture(page, { role: "moderator" });
  await deepRoutes(page);
  const sent: string[] = [];
  let open = false;
  await page.route("**/api/community/review/deep-fields", (route) =>
    route.fulfill({
      json: {
        current: open ? { slug: "andromeda", title: "Andromeda", frames: 3, builds: [{ version: 1, status: "published", stop: null, frames_used: 2, frames_rejected: 1, limiting_mag: 18, gain_mag: 0.9, inserted_at: "2026-11-02T04:00:00Z" }] } : null,
        candidates: [{ key: "m31", name: "Andromeda", solved_photos: 7 }],
      },
    }),
  );
  await page.route("**/api/community/deep-fields**", (route) => {
    sent.push(new URL(route.request().url()).pathname);
    open = true;
    return route.fulfill({ json: { slug: "andromeda" } });
  });
  await page.route("**/api/community/me", (route) =>
    route.fulfill({
      json: {
        user: { id: "user", handle: "reader", name: "Reader", role: "moderator" },
        csrf: "test-csrf",
        deep_field_future: false,
        photos: [
          { id: "first", title: "Weighted frame", status: "published", deep_field_open: { slug: "andromeda", title: "Andromeda" }, deep_frame: { slug: "andromeda", title: "Andromeda", consent_at: "2026-11-01T00:00:00Z", withdrawn_at: null, weight: 0.125, rejection_reason: null } },
          { id: "second", title: "New frame", status: "published", deep_field_open: { slug: "andromeda", title: "Andromeda" }, deep_frame: null },
          { id: "third", title: "Soft frame", status: "published", deep_field_open: null, deep_frame: { slug: "andromeda", title: "Andromeda", consent_at: "2026-11-01T00:00:00Z", withdrawn_at: null, weight: null, rejection_reason: "poor_alignment" } },
        ],
      },
    }),
  );
  await page.route("**/api/community/session", (route) => route.fulfill({ json: { user: { id: "user", handle: "reader", name: "Reader", role: "moderator" }, csrf: "test-csrf", review_count: 0 } }));
  await openAtlas(page);
  await page.getByRole("button", { name: /^Review/ }).first().click();
  const hub = page.locator(".community-dialog--hub");
  await hub.getByRole("button", { name: "Deep fields" }).click();
  await expect(hub).toContainText("7 solved photos");
  await hub.getByRole("button", { name: "Open field" }).click();
  await expect(hub).toContainText("Open field: Andromeda");
  await expect(hub).toContainText("2 used");
  await expect(hub).toContainText("1 not used");
  await hub.getByRole("button", { name: "Rebuild now" }).click();
  await expect(hub).toContainText("Rebuild queued.");
  expect(sent).toEqual(["/api/community/deep-fields", "/api/community/deep-fields/andromeda/rebuild"]);

  await hub.getByRole("tab", { name: "My photos" }).or(hub.getByRole("button", { name: "My photos" })).first().click();
  await expect(hub).toContainText("weight of your frame 12.5%");
  await expect(hub).toContainText("not used: the alignment is not precise enough");
  await expect(hub.locator("[data-frame-add]")).toHaveCount(1);
  await expect(hub.locator("[data-frame-remove]")).toHaveCount(2);
  await hub.locator("[data-frame-add]").click();
  await expect(page.getByRole("dialog", { name: "Add this photo to Andromeda" })).toBeVisible();
});

test("the Sky overlay shows the stack as one photo that opens the deep field", async ({ page }) => {
  await communityFixture(page);
  await deepRoutes(page);
  const stack = { id: "deep-field:andromeda", deep_field: "andromeda", title: "Andromeda", author: "", licence: "", captured_at: "2026-11-02T04:00:00Z", wcs: { ...wcs, ra_deg: 82, dec_deg: 5, cd: [-0.0125, 0, 0, 0.0125], crpix: [800.5, 600.5] }, thumbnail_url: "/deep-demo/thumb.webp", image_url: "/deep-demo/stack.webp" };
  await page.route("**/api/photos/sky**", (route) => route.fulfill({ json: { photos: [stack] } }));
  await openAtlas(page, "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=82.0,-28.7,40.0");
  const focus = page.getByRole("button", { name: "Andromeda: deep field" });
  await focus.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Andromeda: deep field" }).getByText("Limiting magnitude")).toBeVisible();
});

const narration = (name: string) => [[
  { kind: "object", key: "sun", text: name },
  { kind: "text", text: " is " },
  { kind: "fact", value: 2537000, unit: "ly", keys: ["sun"], as_of: "2026-11-01T00:00:00Z" },
  { kind: "text", text: " from us." },
]];
const flight = {
  slug: "answer-abc123",
  flight: "abc123",
  status: "published",
  narrated: true,
  question: "How far is the Andromeda Galaxy?",
  title: "To the neighbour galaxy",
  description: "How far is the Andromeda Galaxy?",
  steps: [1, 2, 3, 4].map((step) => ({
    viewState: "v=1&c=0%2C0&z=24&t=now",
    title: `Step ${step}`,
    body: "Plain text",
    sentences: narration("Andromeda Galaxy"),
    sources: step === 4 ? [{ key: "sun", name: "Andromeda Galaxy", catalog: "OpenNGC", url: "/o/sun" }] : null,
  })),
};

async function flightRoutes(page: Page, answer: (route: Route) => unknown) {
  await page.route("**/api/flights", (route) => route.fulfill({ status: 202, json: { slug: "answer-abc123", flight: "abc123", status: "queued" } }));
  let reads = 0;
  await page.route("**/api/flights/abc123", (route) => {
    reads += 1;
    return reads === 1 ? route.fulfill({ json: { slug: "answer-abc123", flight: "abc123", status: "running" } }) : (answer(route) as Promise<void>);
  });
}

test("a question shows its progress and plays a flight with chips, sources and speech", async ({ page }) => {
  await communityFixture(page, { flights: true });
  await flightRoutes(page, (route) => route.fulfill({ json: flight }));
  await page.addInitScript(() => {
    (window as unknown as { spoken: string[] }).spoken = [];
    const spoken = (window as unknown as { spoken: string[] }).spoken;
    window.speechSynthesis.speak = ((value: SpeechSynthesisUtterance) => void spoken.push(value.text)) as typeof window.speechSynthesis.speak;
  });
  await openAtlas(page);
  const section = await openAsk(page);
  await expect(section).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ask-form-desktop.png` });
  await section.getByLabel("Ask a question about the sky").fill("How far is the Andromeda Galaxy?");
  await section.getByRole("button", { name: "Ask" }).click();
  await expect(section.getByRole("status")).toContainText(/Reading the catalog records|queue/);

  const player = page.locator("#tour-player");
  await expect(player.getByRole("heading", { name: "Step 1" })).toBeVisible({ timeout: 15_000 });
  const chip = player.getByRole("button", { name: "2.537 million light-years" });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", /value of 2026-11-01/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/answer-flight-desktop.png` });

  await chip.click();
  await expect(page.locator("#selected-summary-name")).toContainText("Sun");

  await player.getByRole("button", { name: "Listen" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken[0])).toContain("Andromeda Galaxy is 2.537 million light-years from us");

  for (const step of [2, 3, 4]) {
    await player.getByRole("button", { name: "Next" }).click();
    await expect(player.getByRole("heading", { name: `Step ${step}` })).toBeVisible();
  }
  await expect(player.locator(".tour-player__sources")).toContainText("OpenNGC");
  await expect(player.getByRole("link", { name: "Flight page" })).toHaveAttribute("href", "/flights/abc123");
});

test("a refused question explains the reason and offers a tour", async ({ page }) => {
  await communityFixture(page, { flights: true });
  await flightRoutes(page, (route) => route.fulfill({ json: { slug: "answer-abc123", flight: "abc123", status: "refused", refusal: "off_topic", suggested_tour: { slug: "near-the-sun", title: "What is actually near the Sun" } } }));
  await openAtlas(page);
  const section = await openAsk(page);
  await section.getByLabel("Ask a question about the sky").fill("What is the best pizza?");
  await section.getByRole("button", { name: "Ask" }).click();
  await expect(section).toContainText("outside the atlas", { timeout: 15_000 });
  await expect(section.getByRole("link", { name: "What is actually near the Sun" })).toBeVisible();
  await expect(page.locator("#tour-player")).toBeHidden();
});

test("with no model key the form stays hidden", async ({ page }) => {
  await communityFixture(page);
  await openAtlas(page);
  await openAsk(page);
  await expect(page.locator("#ask-section")).toBeHidden();
  await expect(page.locator(".guided-tours-section")).toBeVisible();
});

test("the address of a deep field opens its window, and it fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await communityFixture(page);
  await deepRoutes(page);
  await page.route("**/deep-field/andromeda", async (route) => route.fulfill({ response: await route.fetch({ url: new URL("/", route.request().url()).toString() }) }));
  await openAtlas(page, "/deep-field/andromeda");
  const view = page.getByRole("dialog", { name: "Andromeda: deep field" });
  await expect(view.locator(".deep-field__stage")).toBeVisible();
  const scrolls = await view.locator(".deep-field").evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(scrolls).toBe(false);
  const box = (await view.locator("[data-blend]").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/deep-field-phone.png` });
});

test("the Ask form fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await communityFixture(page, { flights: true });
  await flightRoutes(page, (route) => route.fulfill({ json: flight }));
  await openAtlas(page);
  const section = await openAsk(page);
  const box = (await section.locator("button").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await section.getByLabel("Ask a question about the sky").fill("How far is the Andromeda Galaxy?");
  await section.getByRole("button", { name: "Ask" }).click();
  const player = page.locator("#tour-player");
  await expect(player.getByRole("heading", { name: "Step 1" })).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/answer-flight-phone.png` });
  const card = (await player.boundingBox())!;
  expect(card.x + card.width).toBeLessThanOrEqual(390);
});

test("a long object name in the narration wraps inside the card, and a number stays on one line", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  const name = "2MASX J00424433+4116074 Andromeda Galaxy (Messier 31, NGC 224)";
  await communityFixture(page, { flights: true });
  await flightRoutes(page, (route) => route.fulfill({ json: { ...flight, steps: flight.steps.map((step) => ({ ...step, sentences: narration(name) })) } }));
  await openAtlas(page);
  const section = await openAsk(page);
  await section.getByLabel("Ask a question about the sky").fill("How far is the Andromeda Galaxy?");
  await section.getByRole("button", { name: "Ask" }).click();
  const player = page.locator("#tour-player");
  await expect(player.getByRole("heading", { name: "Step 1" })).toBeVisible({ timeout: 15_000 });
  const body = player.locator(".tour-player__body").first();
  expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth), "the narration does not scroll sideways").toBe(true);
  const card = (await player.boundingBox())!;
  const objectChip = (await player.getByRole("button", { name }).boundingBox())!;
  expect(objectChip.x + objectChip.width).toBeLessThanOrEqual(card.x + card.width);
  const fact = player.getByRole("button", { name: "2.537 million light-years" });
  expect(await fact.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe("nowrap");
});
