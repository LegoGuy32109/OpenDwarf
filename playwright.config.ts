import { existsSync } from "node:fs";

// Use hardware Vulkan if a DRI render node is present, otherwise fall back to
// SwiftShader so tests still run on headless CI machines without a GPU.
const gpu = existsSync("/dev/dri/renderD128");

const launchArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--force-color-profile=srgb",
  ...(gpu
    ? [
      "--use-angle=vulkan",
      "--enable-gpu-rasterization",
      "--disable-gpu-sandbox",
    ]
    : [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-partial-raster",
    ]),
];

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
      args: launchArgs,
    },
  },
};
