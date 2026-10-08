import { expect, test } from "@playwright/test";
import { openAtlas, selectCatalogObject } from "./atlas-test-utils";
import { communityFixture } from "./community-fixtures";

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
