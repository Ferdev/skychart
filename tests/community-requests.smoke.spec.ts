import { expect, test } from "@playwright/test";
import { openAtlas, selectCatalogObject } from "./atlas-test-utils";
import { communityFixture, reviewPhoto } from "./community-fixtures";

test("a failed approval lets the moderator try again", async ({ page }) => {
  const state = await communityFixture(page, { role: "admin" });
  state.signed = true;
  let failures = 1;
  await page.route("**/api/community/photos/*/review", (route) =>
    failures-- > 0 ? route.fulfill({ status: 500, json: { error: "unknown" } }) : route.fallback(),
  );
  await openAtlas(page);
  await page.locator("[data-community-review]").click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  const card = hub.locator(".community-review-card").filter({ hasText: reviewPhoto.title });
  const approve = card.getByRole("button", { name: "Approve" });
  await approve.click();
  await expect(hub.locator(".community-message")).not.toHaveText("");
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(hub).toContainText("No photos need review.");
  expect(state.reviews).toHaveLength(1);
});

test("the appreciate button shows a saved vote, and a click removes it", async ({ page }) => {
  const state = await communityFixture(page);
  state.signed = true;
  const methods: string[] = [];
  await page.route("**/api/community/photos/*/vote", async (route) => {
    const method = route.request().method();
    methods.push(method);
    // A slow answer: a click before it must not send a second vote.
    if (method === "GET") await new Promise((resolve) => setTimeout(resolve, 1500));
    return route.fulfill({ json: method === "GET" ? { present: true } : { votes: 2 } });
  });
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-photo]").first().click();
  const button = page.getByRole("dialog", { name: "Sun portrait" }).getByRole("button", { name: /Appreciate/ });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(methods).toEqual(["GET", "DELETE"]);
});

test("a moderator stays signed in when the session refresh after the code fails", async ({ page }) => {
  await communityFixture(page, { role: "moderator" });
  let verified = false;
  await page.route("**/api/community/verify", (route) => {
    verified = true;
    return route.fallback();
  });
  await page.route("**/api/community/session", (route) => (verified ? route.fulfill({ status: 500, json: {} }) : route.fallback()));
  await openAtlas(page);
  await selectCatalogObject(page, "Sun", "sun");
  await page.locator(".community-gallery [data-upload]").click();
  const login = page.getByRole("dialog", { name: "Sign in" });
  await login.getByLabel("Email").fill("reader@example.com");
  await login.getByRole("button", { name: "Send code" }).click();
  await login.getByLabel("Code", { exact: true }).fill("123456");
  await login.getByRole("button", { name: "Verify code" }).click();
  await expect(login).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Publish a photo · Sun" })).toBeVisible();
});
