import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.route("**/api/ephemeris**", async (route) => {
  if (route.request().url().includes("timestamp=")) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  await route.continue();
});
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.locator("#loading-screen").waitFor({ state: "hidden", timeout: 60000 });
const toggle = page.locator('button[aria-controls="scale-time-controls"]');
if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
await page.locator("#time-step-forward").click();
await page.locator("#time-busy").waitFor({ state: "visible", timeout: 5000 });
const section = page.locator(".scale-time");
await page.locator("#scale-time-controls").screenshot({ path: "/tmp/time-busy.png" });
await browser.close();
console.log("screenshot saved");
