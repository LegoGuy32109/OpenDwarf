import { chromiumLaunchArgs } from "./tests/helpers/chromium.ts";

export default {
  testDir: "./tests",
  testMatch: "**/*.test.ts",
  testIgnore: "**/unit/**",
  outputDir: "./exports/playwright-results",
  workers: 16,
  reporter: [["html", {
    outputFolder: "exports/playwright-report",
    open: "never",
  }]],
  webServer: {
    command: "deno run -A dev.ts",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    video: "off",
    screenshot: "on",
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: chromiumLaunchArgs,
    },
  },
};
