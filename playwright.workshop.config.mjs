import { defineConfig } from "@playwright/test";

const port = Number(process.env.WORKSHOP_TEST_PORT || 3137);
export default defineConfig({
  testDir: "./scripts/browser", testMatch: "workshop.spec.mjs", workers: 1,
  timeout: 120_000, retries: 0, reporter: "list",
  outputDir: ".refactor-test-results/workshop-browser",
  use: {
    browserName: "chromium", channel: process.env.WORKSHOP_BROWSER_CHANNEL || (process.platform === "win32" ? "chrome" : undefined),
    headless: true, locale: "zh-CN", timezoneId: "Asia/Shanghai", deviceScaleFactor: 1,
    reducedMotion: "reduce", baseURL: `http://127.0.0.1:${port}`, trace: "off"
  }
});
