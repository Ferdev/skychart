import { expect, test } from "@playwright/test";
import { openAtlas } from "./atlas-test-utils";
import { communityFixture } from "./community-fixtures";
test("community sign-in dialog fits the mobile screen and returns focus", async ({
  page,
}) => {
  await communityFixture(page);
  await openAtlas(page);
  const panel = page.locator("header.atlas-bar");
  await panel.locator(".community-menu-toggle").click();
  const menu = panel.locator(".community-menu");
  await expect(menu).toBeVisible();
  for (const button of await menu.locator("button:visible, a:visible").all()) {
    const b = (await button.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  }
  await page.locator("[data-community-account]").click();
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
