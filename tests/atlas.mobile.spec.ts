import { expect, test } from "@playwright/test";
import { collectBrowserIssues, openAtlas, skipIfAtlasUnavailable } from "./atlas-test-utils";

test.describe("Cosmic Atlas mobile layout", () => {
  test.beforeEach(async ({ page, request }) => {
    await skipIfAtlasUnavailable(request);
    await openAtlas(page);
  });

  test("centers the map in the space between top controls and the bottom scale sheet", async ({ page }) => {
    const issues = collectBrowserIssues(page);

    const balance = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#map");
      const context = canvas?.getContext("2d");
      const headerBottom = Math.max(
        document.querySelector<HTMLElement>(".atlas-bar")?.getBoundingClientRect().bottom ?? 0,
        document.querySelector<HTMLElement>(".mode-rail:not([hidden])")?.getBoundingClientRect().bottom ?? 0
      );
      const scaleTop = document.querySelector<HTMLElement>(".scale-rail")?.getBoundingClientRect().top ?? window.innerHeight;
      if (!canvas || !context) return { topPixels: 0, bottomPixels: 0, usableHeight: 0, ratio: 0 };

      const top = Math.ceil(headerBottom + 8);
      const bottom = Math.floor(scaleTop - 10);
      const middle = (top + bottom) / 2;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let topPixels = 0;
      let bottomPixels = 0;

      for (let y = top; y < bottom; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const red = data[offset] ?? 255;
          const green = data[offset + 1] ?? 255;
          const blue = data[offset + 2] ?? 255;
          const alpha = data[offset + 3] ?? 0;
          const isBackground = red > 238 && green > 238 && blue > 238;
          if (alpha > 20 && !isBackground) {
            if (y < middle) topPixels += 1;
            else bottomPixels += 1;
          }
        }
      }

      return {
        topPixels,
        bottomPixels,
        usableHeight: bottom - top,
        ratio: bottomPixels / Math.max(1, topPixels)
      };
    });

    expect(balance.usableHeight, "mobile usable map height").toBeGreaterThan(500);
    expect(balance.topPixels, "map content in upper half").toBeGreaterThan(1_000);
    expect(balance.bottomPixels, "map content in lower half").toBeGreaterThan(1_000);
    expect(balance.ratio, "lower-half map content should not collapse after header controls").toBeGreaterThan(0.35);

    issues.assertClean();
  });
});
