import { expect, test, type Locator } from "@playwright/test";
import { openAtlas, selectCatalogObject } from "./atlas-test-utils";
import { communityFixture, photo, reviewPhoto } from "./community-fixtures";

type Box = { x: number; y: number; width: number; height: number };

test("object gallery keeps credit, escapes author text, and does not taint map export", async ({
  page,
}) => {
  const state = await communityFixture(page);
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await expect(page.locator(".community-gallery")).toContainText("Observer");
  await page.locator(".community-gallery [data-photo]").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await expect(viewer).toContainText("<script>author text</script>");
  await expect(viewer.locator("script")).toHaveCount(0);
  await expect(viewer).toContainText("CC BY 4.0");
  await viewer.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-layer="photos"]').check({ force: true });
  await expect(
    page.locator("#app > .community-marker-layer button").first(),
  ).toBeVisible();
  const requests = state.indexRequests;
  await page.mouse.move(900, 450);
  await page.mouse.wheel(0, -150);
  await expect.poll(() => state.indexRequests).toBe(requests);
  expect(
    await page
      .locator("#map")
      .evaluate((canvas: HTMLCanvasElement) =>
        canvas.toDataURL().startsWith("data:image/png"),
      ),
  ).toBe(true);
  state.removed = true;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".community-gallery")).toContainText(
    "No community photos",
  );
  await expect(
    page.locator("#app > .community-marker-layer button"),
  ).toHaveCount(0);
});

test("typed email code unlocks voting and direct upload", async ({ page }) => {
  const state = await communityFixture(page);
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-upload]").click();
  const login = page.getByRole("dialog", { name: "Sign in" });
  await login.getByLabel("Email").fill("reader@example.com");
  await login.getByRole("button", { name: "Send code" }).click();
  await login.getByLabel("Code", { exact: true }).fill("123456");
  await login.getByRole("button", { name: "Verify code" }).click();
  const upload = page.getByRole("dialog", { name: "Publish a photo · Sun" });
  await upload
    .getByLabel("Image", { exact: true })
    .setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("test fixture"),
    });
  await upload.getByLabel("Title", { exact: true }).fill("My Sun");
  await upload.getByLabel("Capture time (UTC)").fill("2026-10-08T12:00");
  await upload.locator('[name="rights"]').check();
  await upload
    .getByRole("button", { name: "Publish a photo", exact: true })
    .click();
  await expect(upload).toContainText("Upload received");
  expect(state.uploads).toBe(1);
  expect(state.csrfSeen).toBe(true);
  await upload.getByRole("button", { name: "Close" }).click();
  await page.locator(".community-gallery [data-photo]").first().click();
  await page
    .getByRole("dialog", { name: "Sun portrait" })
    .getByRole("button", { name: /Appreciate/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Appreciate · 4" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(state.votes).toBe(4);
});

test("disabled community keeps the atlas usable", async ({ page }) => {
  await communityFixture(page);
  await page.route("**/api/community/config", (r) =>
    r.fulfill({ contentType: "application/json", body: '{"enabled":false}' }),
  );
  await openAtlas(page);
  await expect(page.locator(".community-bar")).toHaveCount(0);
  await expect(page.locator(".community-opacity")).toHaveCount(0);
  await expect(page.locator(".community-toggle")).toBeHidden();
});

test("community controls and upload fields follow the atlas language", async ({page}) => {
  const state = await communityFixture(page);
  state.signed = true;
  await openAtlas(page);
  await selectCatalogObject(page,"Sun","sun");
  for (const [locale,label] of Object.entries({es:"Fotos",fr:"Photos",de:"Fotos","pt-BR":"Fotos",it:"Foto","zh-Hans":"照片",ja:"写真",ko:"사진"})) {
    await page.locator('#locale-select').selectOption(locale);
    await expect(page.locator('.community-toggle span')).toHaveText(label);
  }
  await page.locator('#locale-select').selectOption('es');
  await expect(page.locator('.community-bar')).toContainText('Fotos de la comunidad');
  await expect(page.locator('.community-bar')).toContainText('Galería');
  await page.locator('.community-gallery [data-upload]').click();
  const dialog=page.getByRole('dialog',{name:/Publicar una foto/});
  await expect(dialog.getByLabel('Imagen',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Título',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'Condiciones'})).toBeVisible();
  await expect(page.locator('.community-gallery')).toContainText('Observer');
});

test('photo markers follow Sky and 3D view objects',async({page})=>{
  await communityFixture(page);await openAtlas(page);
  await page.locator('[data-layer="photos"]').check({force:true});
  await selectCatalogObject(page,'Earth','earth');await page.locator('#view-sky-selected').click();
  await expect(page.locator('#sky-view')).toBeVisible();await expect(page.locator('#sky-view .community-marker-layer button').first()).toBeVisible();
  await page.locator('#sky-view-close').click();await page.locator('#universe-3d-toggle').click();
  await expect(page.locator('#universe-view')).toBeVisible();await expect(page.locator('#universe-view .community-marker-layer button').first()).toBeVisible();
});

test("community row sits inside the atlas panel and clear of its content", async ({ page }) => {
  const state = await communityFixture(page, { role: "admin" });
  state.signed = true;
  await openAtlas(page);
  const panel = page.locator("header.atlas-bar");
  const row = panel.locator(".community-bar");
  const review = row.locator("[data-community-review]");
  await expect(review).toBeVisible();
  // One photo waits for the moderator.
  await expect(review.locator(".community-count")).toHaveText("1");
  await expect(row.locator("[data-community-account]")).toHaveText("Reader");
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const panelBox = await box(panel);
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const rowBox = await box(row);
  // The panel holds the title, the language, the search field, and the time bar. The counts are in Settings.
  for (const selector of ["h1", ".locale-control", ".header-search", "#time-bar"]) {
    expect(overlaps(rowBox, await box(panel.locator(selector))), selector).toBe(false);
  }
  expect(rowBox.y).toBeGreaterThan((await box(panel.locator("#time-bar"))).y);
  const buttons = row.locator("button:visible");
  // Gallery, Photographers, Coverage, Rules, Review, and the account.
  expect(await buttons.count()).toBe(6);
  for (const button of await buttons.all()) {
    const b = await box(button);
    expect(b.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(b.y).toBeGreaterThanOrEqual(panelBox.y);
    expect(b.x + b.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    expect(b.y + b.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
  }
});

test("community controls have the look of the header controls and of the atlas panels", async ({ page }) => {
  await communityFixture(page);
  await openAtlas(page);
  const look = (selector: string) =>
    page.locator(selector).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderTopLeftRadius, border: style.borderTopColor, height: Math.round(element.getBoundingClientRect().height), font: style.fontFamily };
    });
  // The buttons of the community row and the lists of the header are one family with the time bar.
  const step = await look("#time-bar select");
  const timeButton = await look("#time-bar button");
  expect(await look("#locale-select")).toEqual(step);
  expect(await look(".community-bar button[data-community-tab]")).toEqual(timeButton);
  await page.locator('[data-community-tab="gallery"]').click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await expect(hub).toBeVisible();
  const heading = await hub.locator("h2").evaluate((element) => getComputedStyle(element).fontFamily);
  expect(heading).toBe(timeButton.font);
  expect(heading).not.toMatch(/Georgia|serif\b(?<!sans-serif)/);
  // The window is in #app, so that its controls get the base look of the interface.
  expect(await hub.evaluate((element) => Boolean(element.closest("#app")))).toBe(true);
});

test("photo opacity lives in the settings overlays group", async ({ page }) => {
  await communityFixture(page);
  await openAtlas(page);
  await expect(page.locator(".community-account-actions .community-opacity")).toHaveCount(0);
  await page.locator("#map-settings-toggle").click();
  await page.locator('button[aria-controls="scale-map-overlays"]').click();
  const opacity = page.locator("#scale-map-overlays .community-opacity");
  await expect(opacity).toContainText("Photo opacity");
  await expect(opacity.locator('input[type="range"]')).toBeVisible();
  await page.locator("#locale-select").selectOption("es");
  await expect(opacity).not.toContainText("Photo opacity");
});

test("moderators can hide a public photo with a reason", async ({ page }) => {
  const state = await communityFixture(page, { role: "moderator" });
  state.signed = true;
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator('[data-layer="photos"]').check({ force: true });
  await expect(page.locator("#app > .community-marker-layer button").first()).toBeVisible();
  await page.locator(".community-gallery [data-photo]").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await viewer.getByRole("button", { name: "Hide" }).click();
  const form = page.getByRole("dialog", { name: "Hide", exact: true });
  const reason = form.getByLabel("Reason");
  await expect(reason).toHaveAttribute("minlength", "3");
  await expect(reason).toHaveAttribute("maxlength", "2000");
  await expect(reason).toHaveAttribute("required", "");
  await reason.fill("Not an astronomical photo");
  await form.getByRole("button", { name: "Hide" }).click();
  await expect(page.locator("dialog.community-dialog")).toHaveCount(0);
  expect(state.reviews).toEqual([
    {
      path: `/api/community/photos/${photo.id}/review`,
      body: { action: "hide", reason: "Not an astronomical photo" },
    },
  ]);
  await expect(page.locator(".community-gallery")).toContainText("No community photos");
  await expect(page.locator("#app > .community-marker-layer button")).toHaveCount(0);
});

for (const [name, role, signed] of [
  ["members", "member", true],
  ["signed-out visitors", "member", false],
] as const) {
  test(`${name} do not get a Hide button`, async ({ page }) => {
    const state = await communityFixture(page, { role });
    state.signed = signed;
    await openAtlas(page);
    await selectCatalogObject(page, "Sun", "sun");
    await page.locator(".community-gallery [data-photo]").first().click();
    const viewer = page.getByRole("dialog", { name: "Sun portrait" });
    await expect(viewer.getByRole("button", { name: "Report" })).toBeVisible();
    await expect(viewer.locator("[data-hide]")).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Hide" })).toHaveCount(0);
  });
}

test("community row stays reachable on a tablet-width screen", async ({ page }) => {
  const state = await communityFixture(page, { role: "admin" });
  state.signed = true;
  await page.setViewportSize({ width: 820, height: 1180 });
  await openAtlas(page);
  const panel = page.locator("header.atlas-bar");
  const toggle = panel.locator(".community-menu-toggle");
  await expect(toggle).toBeVisible();
  await expect(page.locator(".community-menu")).toBeHidden();
  await toggle.click();
  await expect(page.locator(".community-menu")).toBeVisible();
  for (const button of await page.locator(".community-menu").locator("button:visible").all()) {
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(820);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".community-menu")).toBeHidden();
});

test("the community window shows the gallery, the photographers, and the coverage", async ({ page }) => {
  const state = await communityFixture(page);
  await openAtlas(page);
  await page.locator('[data-community-tab="gallery"]').click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  const tabs = hub.getByRole("tab");
  await expect(tabs).toHaveText(["Gallery", "Photographers", "Coverage", "Rules", "My photos"]);
  await expect(hub.getByRole("tab", { name: "Gallery" })).toHaveAttribute("aria-selected", "true");
  const card = hub.locator(".community-card").first();
  await expect(card).toContainText("Sun portrait");
  await expect(card).toContainText("Sun · Observer");
  await expect(card.locator(".community-card__rank")).toHaveText("1");
  await hub.getByRole("button", { name: "Newest" }).click();
  await expect(hub.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.rankingRequests).toEqual(["all", "new"]);
  await expect(hub.locator(".community-card__rank")).toHaveCount(0);

  await hub.getByRole("tab", { name: "Photographers" }).click();
  const row = hub.getByRole("row", { name: /Observer/ });
  await expect(row).toContainText("@observer");
  await expect(row.getByRole("cell")).toHaveText(["1", "12", "9", "31", "4", "2", "2"]);
  await row.getByRole("button", { name: "Observer" }).click();
  await expect(hub.locator(".community-profile")).toContainText("Member since Sep 1, 2026");
  await expect(hub.locator(".community-profile .community-card")).toHaveCount(1);
  await hub.getByRole("button", { name: "All photographers" }).click();
  await expect(hub.getByRole("row", { name: /Observer/ })).toBeVisible();

  await hub.getByRole("tab", { name: "Coverage" }).click();
  await expect(hub.locator(".community-stats")).toContainText("3 of 110 have a photo");
  await expect(hub.getByRole("row")).toHaveCount(4);
  await hub.getByRole("button", { name: "Messier", exact: true }).click();
  await expect(hub.getByRole("row")).toHaveCount(3);
  await hub.getByPlaceholder("Filter by name or constellation").fill("pleiades");
  await expect(hub.getByRole("row")).toHaveCount(2);
  expect(state.coverageRequests.at(-1)).toBe("catalog=messier&q=pleiades");
  await expect(hub).toContainText("1 of 1 objects");

  await hub.getByRole("tab", { name: "Rules" }).click();
  await expect(hub.getByRole("heading", { name: "What you can publish" })).toBeVisible();
  await expect(hub.getByRole("link", { name: "Reports and removal" })).toHaveAttribute("href", "/community/takedown");

  await hub.getByRole("tab", { name: "My photos" }).click();
  await expect(hub.getByRole("button", { name: "Sign in" })).toBeVisible();
  await hub.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog.community-dialog")).toHaveCount(0);
});

test("a signed-in photographer sees the status of each photo in the account", async ({ page }) => {
  const state = await communityFixture(page);
  state.signed = true;
  await openAtlas(page);
  await page.locator("[data-community-account]").click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await expect(hub.getByRole("tab", { name: "My photos" })).toHaveAttribute("aria-selected", "true");
  const own = hub.locator(".community-own");
  await expect(own).toContainText("My Moon");
  await expect(own.locator(".community-status")).toHaveText("In review");
  await expect(hub.getByLabel("Public handle")).toHaveValue("reader");
  // A member has no review tools.
  await expect(hub.getByRole("tab", { name: /Review/ })).toHaveCount(0);
  await expect(page.locator("[data-community-review]")).toBeHidden();
});

test("a moderator approves and rejects the photos that wait for publication", async ({ page }) => {
  const state = await communityFixture(page, { role: "admin" });
  state.signed = true;
  const second = { ...reviewPhoto, id: "7a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", title: "Second photo" };
  state.queue = [reviewPhoto, second];
  await openAtlas(page);
  await page.locator("[data-community-review]").click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await expect(hub.getByRole("tab", { name: /Review/ })).toHaveAttribute("aria-selected", "true");
  await expect(hub.getByRole("button", { name: /Waiting/ })).toHaveAttribute("aria-pressed", "true");
  const cards = hub.locator(".community-review-card");
  await expect(cards).toHaveCount(2);
  const first = cards.filter({ hasText: "Orion Nebula, first light" });
  await expect(first).toContainText("M42 Orion Nebula");
  await expect(first).toContainText("@vera · 2 published · 0 rejected or hidden · member since Sep 1, 2026");
  await expect(first).toContainText("4,096 × 2,731 px");
  // The caption of the photographer is text, not markup.
  await expect(first.locator("script")).toHaveCount(0);

  // Approval needs no typed reason.
  await first.getByRole("button", { name: "Approve" }).click();
  await expect(cards).toHaveCount(1);
  await expect(hub.locator(".community-message")).toHaveText("Decision saved.");
  expect(state.reviews[0]).toEqual({ path: `/api/community/photos/${reviewPhoto.id}/review`, body: { action: "approve", reason: "" } });

  // Rejection needs a reason, because the photographer reads it.
  const last = cards.first();
  await last.getByRole("button", { name: "Reject" }).click();
  const reason = last.getByLabel("Reason for the photographer");
  await expect(reason).toHaveAttribute("required", "");
  await last.getByRole("button", { name: "Cancel" }).click();
  await expect(last.getByRole("button", { name: "Approve" })).toBeVisible();
  await last.getByRole("button", { name: "Reject" }).click();
  await last.getByRole("button", { name: "Wrong object" }).click();
  await expect(last.getByLabel("Reason for the photographer")).toHaveValue("Wrong object");
  await last.getByRole("button", { name: "Reject photo" }).click();
  await expect(hub).toContainText("No photos need review.");
  expect(state.reviews[1]).toEqual({ path: `/api/community/photos/${second.id}/review`, body: { action: "reject", reason: "Wrong object" } });
  // The count on the header button goes away with the last photo.
  await expect(page.locator("[data-community-review] .community-count")).toBeHidden();

  await hub.getByRole("button", { name: /Decision log/ }).click();
  await expect(hub.getByRole("row", { name: /Sun portrait/ })).toContainText("Approved");
  await hub.getByRole("button", { name: /Members/ }).click();
  await expect(hub.getByRole("button", { name: "Suspend" })).toBeVisible();
});

test("the photo viewer goes to the photographer and to the object with no page load", async ({ page }) => {
  await communityFixture(page);
  await openAtlas(page);
  await page.locator('[data-community-tab="gallery"]').click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await hub.locator(".community-card").first().click();
  const viewer = page.getByRole("dialog", { name: "Sun portrait" });
  await expect(viewer.locator(".community-facts")).toContainText("CC BY 4.0");
  await viewer.getByRole("button", { name: "Observer" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(hub.getByRole("tab", { name: "Photographers" })).toHaveAttribute("aria-selected", "true");
  await expect(hub.locator(".community-profile")).toContainText("@observer");
  await hub.locator(".community-profile .community-card").first().click();
  let loads = 0;
  page.on("load", () => loads++);
  await viewer.getByRole("button", { name: "Open object" }).click();
  await expect(page.locator("dialog.community-dialog")).toHaveCount(0);
  await expect(page.locator("#selected-object-panel")).toBeVisible();
  await expect(page.locator("#selected-object-panel")).toContainText("Sun");
  expect(loads).toBe(0);
});
