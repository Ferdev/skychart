import { expect, test, type Locator } from "@playwright/test";
import { openAtlas, selectCatalogObject } from "./atlas-test-utils";
import { communityFixture, photo } from "./community-fixtures";

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
  await expect(page.locator(".community-account-actions")).toHaveCount(0);
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
  await expect(page.locator('.community-account-actions')).toContainText('Normas de la comunidad');
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
  const row = panel.locator(".community-account-actions");
  await expect(row.locator("[data-community-review]")).toBeVisible();
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
  const buttons = row.locator("button:visible, a:visible");
  expect(await buttons.count()).toBe(5);
  for (const button of await buttons.all()) {
    const b = await box(button);
    expect(b.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(b.y).toBeGreaterThanOrEqual(panelBox.y);
    expect(b.x + b.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    expect(b.y + b.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
  }
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
  for (const button of await page.locator(".community-menu").locator("button:visible, a:visible").all()) {
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(820);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".community-menu")).toBeHidden();
});
