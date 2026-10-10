import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectCatalogObject, skipIfAtlasUnavailable } from "./atlas-test-utils";

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

/** Screen pixels (CSS px) where the WebGL point layer shows a bright marker. */
async function pointLayerMarkers(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLCanvasElement>("#point-map")!;
    const copy = document.createElement("canvas");
    copy.width = layer.width;
    copy.height = layer.height;
    const context = copy.getContext("2d")!;
    context.drawImage(layer, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    const scale = layer.width / window.innerWidth;
    const markers: { x: number; y: number }[] = [];
    for (let y = 0; y < copy.height; y += 1) {
      for (let x = 0; x < copy.width; x += 1) {
        const offset = (y * copy.width + x) * 4;
        const brightness = Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) * (pixels[offset + 3]! / 255);
        if (brightness > 110) markers.push({ x: (x + 0.5) / scale, y: (y + 0.5) / scale });
      }
    }
    return markers;
  });
}

/** Share of the screen marker pixels that are bright at the same place of an exported PNG. */
async function markerShareInExport(page: Page, png: Buffer, markers: { x: number; y: number }[], scale: number) {
  return page.evaluate(async ({ base64, markers, scale }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matched = 0;
    for (const marker of markers) {
      const centerX = Math.floor(marker.x * scale);
      const centerY = Math.floor(marker.y * scale);
      let brightness = 0;
      // The export draws each marker again at its own resolution, so its edge can be one pixel different.
      const reach = Math.ceil(scale);
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const offset = ((centerY + dy) * canvas.width + centerX + dx) * 4;
          brightness = Math.max(brightness, pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
        }
      }
      if (brightness > 70) matched += 1;
    }
    return matched / markers.length;
  }, { base64: png.toString("base64"), markers, scale });
}

async function exportPng(page: Page, tier: "current" | "4k") {
  if (!(await page.locator("#share-popover").isVisible())) await page.locator("#share-menu-button").click();
  await expect(page.locator("#export-image")).toBeVisible();
  await page.locator("#export-resolution").selectOption(tier);
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator("#export-image").click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  await expect(page.locator("#export-status")).toContainText("downloaded");
  return Buffer.concat(chunks);
}

test.describe("PNG export position", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // The object markers are in the WebGL point layer. The labels and the orbit rings are in the overlay canvas.
  // The map centre is at the centre of the free map area, not of the window, so the export must use the same centre.
  for (const withInspector of [false, true]) {
    test(`the point layer of the export is where the screen shows it${withInspector ? " with the inspector open" : ""}`, async ({ page, request }) => {
      await skipIfAtlasUnavailable(request);
      await openAtlas(page, "/?perf=1");
      if (withInspector) await selectCatalogObject(page, "Jupiter", "jupiter");
      // Wait for the end of the camera animation that follows a selection.
      let sun = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.bodyScreen("sun"));
      await expect.poll(async () => {
        const previous = sun;
        sun = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.bodyScreen("sun"));
        return Math.hypot(sun!.x - previous!.x, sun!.y - previous!.y);
      }, { intervals: [500] }).toBeLessThan(0.01);
      const geometry = await page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.selectionGeometry());
      const centerOffset = {
        x: (geometry.usable.left + geometry.usable.right) / 2 - 720,
        y: (geometry.usable.top + geometry.usable.bottom) / 2 - 450,
      };
      expect(Math.hypot(centerOffset.x, centerOffset.y), "the free map area must be off the window centre, or the test checks nothing").toBeGreaterThan(20);
      if (withInspector) expect(Math.abs(centerOffset.x), "an open inspector moves the free map area to the left").toBeGreaterThan(100);

      // The exported image has the labels and the edge pointers above the point layer, and a label box makes
      // a point below it dark. With the full catalog many small bodies are below the labels of the inner planets.
      // This test is about the position of the point layer, so the two text layers are off.
      await page.evaluate(() => {
        for (const layer of ["labels", "references"]) {
          for (const input of document.querySelectorAll<HTMLInputElement>(`input[data-layer="${layer}"]`)) {
            if (!input.checked) continue;
            input.checked = false;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      await expect.poll(() => page.evaluate(() => window.__ATLAS_DIAGNOSTICS__!.drawnLabels().length), { message: "the labels must be off" }).toBe(0);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

      const markers = await pointLayerMarkers(page);
      expect(markers.length, "the point layer must show markers").toBeGreaterThan(4);
      for (const tier of ["current", "4k"] as const) {
        const png = await exportPng(page, tier);
        const share = await markerShareInExport(page, png, markers, pngDimensions(png).width / 1440);
        expect(share, `${tier}: share of the screen markers that the export shows at the same place`).toBeGreaterThanOrEqual(0.85);
      }
    });
  }
});
