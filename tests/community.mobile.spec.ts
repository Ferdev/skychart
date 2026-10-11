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
  for (const button of await menu.locator("button:visible").all()) {
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

test("the community window and its tabs fit the mobile screen", async ({ page }) => {
  await communityFixture(page);
  await openAtlas(page);
  await page.locator("header.atlas-bar .community-menu-toggle").click();
  await page.locator('[data-community-tab="coverage"]').click();
  const hub = page.getByRole("dialog", { name: "Community photos" });
  await expect(hub.getByRole("tab", { name: "Coverage" })).toHaveAttribute("aria-selected", "true");
  await expect(hub.getByRole("row")).toHaveCount(4);
  const box = (await hub.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  // The page does not scroll sideways below the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const tab of await hub.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await hub.getByRole("tab", { name: "Gallery" }).click();
  const card = (await hub.locator(".community-card").first().boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(box.x);
  expect(card.x + card.width).toBeLessThanOrEqual(box.x + box.width);
});
