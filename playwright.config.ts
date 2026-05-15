import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:4020";
const chromiumExecutablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROMIUM_BIN,
  "/etc/profiles/per-user/fer/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome"
].find((candidate) => candidate && existsSync(candidate));
const chromiumLaunchOptions = chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 12_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "smoke",
      testMatch: /.*\.smoke\.spec\.ts/,
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "perf",
      testMatch: /.*\.perf\.spec\.ts/,
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 1600, height: 1000 }
      }
    },
    {
      name: "mobile",
      testMatch: /.*\.mobile\.spec\.ts/,
      use: {
        browserName: "chromium",
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 390, height: 844 },
        isMobile: true
      }
    }
  ]
});
