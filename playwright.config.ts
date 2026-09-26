import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  reporter: "list",
  outputDir: "exports/playwright-results",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}-{projectName}{ext}",
  webServer: {
    command: "deno task start",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [{ name: "chromium" }],
});
