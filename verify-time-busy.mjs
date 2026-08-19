import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage();

// Delay ephemeris responses for explicit timestamps (time changes) so the busy
// state is observable deterministically; the boot load stays fast.
await page.route("**/api/ephemeris**", async (route) => {
  const url = route.request().url();
  if (url.includes("timestamp=")) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await route.continue();
});

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator("#loading-screen").waitFor({ state: "hidden", timeout: 60000 });
check("boot: loading screen hidden", true);

const busy = page.locator("#time-busy");
check("boot: time-busy hidden after load", await busy.isHidden());

const summaryBefore = (await page.locator("#time-summary").textContent()) ?? "";

// Expand the time controls disclosure if collapsed, then step forward.
const toggle = page.locator('button[aria-controls="scale-time-controls"]');
if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();

await page.locator("#time-step-forward").click();

await busy.waitFor({ state: "visible", timeout: 5000 });
check("step: spinner visible while recalculating", true);
check(
  "step: step buttons disabled while busy",
  await page.locator("#time-step-forward").isDisabled() &&
    await page.locator("#time-step-back").isDisabled() &&
    await page.locator("#apply-time").isDisabled() &&
    await page.locator("#time-now").isDisabled(),
);

await busy.waitFor({ state: "hidden", timeout: 30000 });
check("step: spinner hidden after update", true);
check("step: buttons re-enabled", await page.locator("#time-step-forward").isEnabled());

const summaryAfter = (await page.locator("#time-summary").textContent()) ?? "";
check(`time summary changed ("${summaryBefore.trim()}" -> "${summaryAfter.trim()}")`, summaryBefore !== summaryAfter);

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
