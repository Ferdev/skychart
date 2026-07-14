import { expect, test } from "@playwright/test";
import { openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

function pngDimensions(buffer: Buffer) {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("image export produces PNGs with provenance at three resolution tiers", async ({ page, request }) => {
  await skipIfAtlasUnavailable(request);
  await openAtlas(page);
  await page.locator("#share-menu-button").click();
  await expect(page.locator("#share-popover")).toBeVisible();
  await expect(page.locator("#export-image")).toBeVisible();

  for (const tier of ["current", "4k", "8k"]) {
    await page.locator("#export-resolution").selectOption(tier);
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.locator("#export-image").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const dimensions = pngDimensions(Buffer.concat(chunks));
    const expectedWidth = tier === "8k" ? 8000 : tier === "4k" ? 3840 : 1440;
    expect(dimensions.width).toBe(expectedWidth);
    expect(dimensions.height).toBeGreaterThan(1000);
    await expect(page.locator("#export-status")).toHaveAttribute("data-provenance", /.+\|.+/);
    await expect(page.locator("#export-status")).toContainText("downloaded");
  }
});
