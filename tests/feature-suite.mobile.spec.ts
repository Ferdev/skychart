import { expect, test } from "@playwright/test";
import { openAtlas } from "./atlas-test-utils";

const EARTH_SKY = "/?v=1&c=0,0&z=24&t=2026-01-15T22:00:00.000Z&L=grid.1~photos.1&sky=earth&sc=82.0,-28.7,40.0";

test("the planner opens from the More menu of a phone and fits the window", async ({ page }) => {
  await openAtlas(page, EARTH_SKY);
  await page.locator("#sky-more-button").click();
  await page.locator("#sky-planner-button").click();
  const panel = page.getByRole("dialog", { name: "Tonight's planner" });
  await panel.getByLabel("Latitude").fill("-33.86");
  await panel.getByLabel("Longitude").fill("151.21");
  await panel.getByLabel("Night (evening date)").fill("2026-10-30");
  await panel.getByRole("button", { name: "Plan the night" }).click();
  const open = panel.locator(".planner-row [data-target]").first();
  await expect(open).toBeVisible({ timeout: 20_000 });
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const width = await panel.evaluate((node) => [node.scrollWidth, node.clientWidth, node.getBoundingClientRect().right]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);
  expect(width[2]).toBeLessThanOrEqual(390);
});

test("the target list fits a phone", async ({ page }) => {
  await openAtlas(page);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#target-list-open")!.click();
  });
  const panel = page.getByRole("dialog", { name: "Target list" });
  await panel.getByLabel("Targets").fill("M 42\nNot an object\n83.82 -5.39");
  await panel.getByRole("button", { name: "Match list" }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(3, { timeout: 20_000 });
  const right = await panel.evaluate((node) => node.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(390);
});
