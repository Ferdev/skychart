import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.route("**/api/ephemeris**", async (route) => {
  if (route.request().url().includes("timestamp=")) {
    await new Promise((r) => setTimeout(r, 4000));
  }
  await route.continue();
});
await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
await page.locator("#loading-screen").waitFor({ state: "hidden", timeout: 60000 });
const toggle = page.locator('button[aria-controls="scale-time-controls"]');
if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
await page.locator("#time-step-forward").click();
await page.locator("#time-busy").waitFor({ state: "visible", timeout: 5000 });
const info = await page.locator("#time-busy").evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: cs.display, color: cs.color, text: el.textContent, hidden: el.hidden };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/full.png" });
await browser.close();
